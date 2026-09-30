import { defineSlice, dispatch, getState } from "./store.js";
import { ECHO_ROW, ECHO_SHIFT, happened } from "./encounters.js";

export { ECHO_SHIFT };

// The party's characters, imported from Pathbuilder 2e exports (the players
// send them before the first game and again at level 4, see the player's
// book). A character is party state, not canon: the export goes into the
// event log, trimmed to what the site uses. The import page is
// site/pages/pathbuilder.js; the quick fields of "Вы сами" keep their own
// state next to the build.
//
// Party state as events; each carries the names the journal writes:
// - "pc-import" { id, build, counters }: a character comes in, or an
//   existing one (id) gets a new build. id null is a new character, whose id
//   is the event's seq. build is fromPathbuilder() with the numbers the GM
//   checked; counters [{ name, max }] are the consumables the site counts,
//   which the export does not mark. A new build keeps everything else the
//   character has, so re-importing at level 4 keeps the damage taken.
// - "pc-remove" { id, name }: the import was a mistake. A character who dies
//   or drops out is not removed: that is "персонаж выбыл" (substep 19f).
//
// The quick fields of the "Вы сами" page (site/pages/yourselves.js):
// - "pc-hp" { id, name, delta }: damage (negative) or healing. Damage takes
//   the temporary hit points first; hit points stay within 0 and the maximum.
// - "pc-temp" { id, name, value }: temporary hit points, 0 takes them off.
// - "pc-spend" { id, name, what, key, label, delta }: delta used (positive)
//   or given back (negative) of a limited resource, kept within 0 and its
//   limit. what is "slot" (key "<caster>|<rank>"), "focus" (key null) or
//   "counter" (key: the counter's name); label is how the journal names it.
// - "pc-condition" { id, name, condition, value }: as in the scene
//   (site/scene.js): a number, true, or null to take it off.
// - "pc-note" { id, name, text }: what the character carries and knows
//   (P6, 9.4); null clears it.
// - "pc-prepare" { id, name }: daily preparations; spent slots and focus
//   points come back. Counters and hit points do not: the GM sets them.
//
// The quick state is kept apart from the build: damage, not current hit
// points, and spent, not left, so a new build keeps them.
//
// Snapshots (P6, 9.4) are not events: the slice counts the turns of the
// tracker ("turns", site/turns.js) and, when the count reaches k, copies the
// party as the snapshot of turn k, the state at the start of that turn. It
// keeps turns N - 6 to N, N being the turn now: the page shows the six before
// it, and the start of this turn is what "персонаж выбыл" (19f) needs. The
// snapshot of turn 0 is taken at the first turn: before it the party is only
// being imported. Undo and a loaded save rebuild them like any state.
// - "encounter-check" (site/encounters.js): when a random check comes up
//   No. 12 "Вы сами", the slice keeps the snapshot six turns before it with
//   that check (echo12), so later turns do not push it out; null when there
//   is none yet (P6, 9.3).
// - "echo-d8" { check, rolls: [{ id, name, roll }] }: the d8 of P6, 9.5 for
//   everyone in that snapshot; 1 means dead in the other branch.
//
// The guaranteed echo (P6, 10.8; topic 1.17 of the register):
// - "pc-out" { id, name, reason }: the character dropped out for good. They
//   stay in the party marked out, with the turn, and join the queue with
//   their snapshot of that turn (atDrop), which later turns may push out of
//   the ring. reason is one of OUT_REASONS.
// - "encounter-check" with echo: true takes the head of the queue: the echo
//   comes from the snapshot six turns before this check but no later than
//   the turn of dropping out, with half the maximum hit points (rounded
//   down) and wounded 1 at least; the rest is as in the snapshot. It is kept
//   as arrived until the GM confirms it joined.
// - "pc-echo-join" { check, id, name }: the echo joined the group: the
//   character takes its state and is an echo of the ship, bound to the
//   crystal walls.
// - "pc-echo-anchor" { id, name, anchored }: the Shell with control made the
//   echo a lasting version (P8, 9.6); the binding is gone.

const blank = () => ({ damage: 0, temp: 0, spent: {}, conditions: {}, note: null });

function limitOf(pc, what, key) {
  if (what === "focus") return pc.build.focus.max;
  if (what === "counter") return pc.counters.find((c) => c.name === key)?.max ?? 0;
  const [caster, rank] = key.split("|");
  return pc.build.casters.find((c) => c.name === caster)?.slots.find((s) => s.rank === Number(rank))?.count ?? 0;
}

export const spentKey = (what, key) => (key === null ? what : `${what}|${key}`);

// Applies a quick field event to the character it names.
const quick = (apply) => (p, data) => {
  const pc = p.list.find((x) => x.id === data.id);
  if (pc) apply(pc, data);
};

// How a character drops out for good (P6, 10.8, "Условие").
export const OUT_REASONS = [
  "погиб, воскрешение недоступно",
  "результат 19 пульта",
  "временные двери 39",
  "застрял в прошлом без связи",
];

// A copy of the party for a snapshot: builds, counters and the out mark are
// replaced, never changed in place, so they are shared; the quick fields and
// the echo mark are copied.
const copyPc = (pc) => ({ ...pc, spent: { ...pc.spent }, conditions: { ...pc.conditions }, echo: pc.echo && { ...pc.echo } });
const copyList = (list) => list.map(copyPc);

const WOUNDED = "ранен";

// The echo of the guaranteed "Вы сами": the snapshot with the penalty of
// P6, 10.8. Wounded 1 at least: a snapshot already wounded more keeps it.
function echoFrom(pc) {
  const max = pc.build.numbers.hp;
  const echo = copyPc(pc);
  echo.damage = max - Math.floor(max / 2);
  echo.temp = 0;
  echo.conditions[WOUNDED] = Math.max(1, Number(echo.conditions[WOUNDED]) || 0);
  echo.out = null;
  return echo;
}

const snapshotAt = (p, turn) => p.snapshots.find((x) => x.turn === turn) ?? null;

defineSlice("party", () => ({ list: [], turn: 0, snapshots: [], echo12: null, queue: [], arrived: null }), {
  turns: (p, data) => {
    const from = p.turn;
    p.turn += data.count;
    if (from === 0 && !snapshotAt(p, 0)) p.snapshots.push({ turn: 0, list: copyList(p.list) });
    for (let k = Math.max(from + 1, p.turn - ECHO_SHIFT); k <= p.turn; k++) {
      p.snapshots.push({ turn: k, list: copyList(p.list) });
    }
    p.snapshots = p.snapshots.filter((x) => x.turn >= p.turn - ECHO_SHIFT);
  },
  "encounter-check": (p, data, event) => {
    if (data.echo) {
      const head = p.queue.shift();
      if (!head) {
        p.arrived = { check: event.seq, id: null };
        return;
      }
      const from = Math.min(p.turn - ECHO_SHIFT, head.turn);
      const source = from === head.turn ? head.atDrop
        : snapshotAt(p, from)?.list.find((x) => x.id === head.id) ?? head.atDrop;
      p.arrived = { check: event.seq, id: head.id, name: head.name, from, pc: echoFrom(source), joined: false };
      return;
    }
    const last = data.rolls.at(-1);
    if (data.echo || !happened(last) || last.row !== ECHO_ROW) return;
    const from = p.turn - ECHO_SHIFT;
    const snapshot = snapshotAt(p, from);
    p.echo12 = { check: event.seq, from, list: snapshot ? copyList(snapshot.list) : null, rolls: null };
  },
  "echo-d8": (p, data) => {
    if (p.echo12?.check === data.check) p.echo12.rolls = data.rolls;
  },
  "pc-import": (p, data, event) => {
    const pc = data.id === null ? null : p.list.find((x) => x.id === data.id);
    if (pc) {
      pc.build = data.build;
      pc.counters = data.counters;
    } else {
      p.list.push({ id: String(event.seq), build: data.build, counters: data.counters, ...blank() });
    }
  },
  "pc-out": (p, data, event) => {
    const pc = p.list.find((x) => x.id === data.id);
    if (!pc || pc.out) return;
    pc.out = { turn: p.turn, seq: event.seq, reason: data.reason };
    const atDrop = snapshotAt(p, p.turn)?.list.find((x) => x.id === pc.id) ?? pc;
    p.queue.push({ id: pc.id, name: pc.build.name, turn: p.turn, seq: event.seq, atDrop: copyPc(atDrop) });
  },
  "pc-echo-join": (p, data) => {
    const a = p.arrived;
    const pc = p.list.find((x) => x.id === data.id);
    if (!a || a.check !== data.check || a.joined || !pc) return;
    const { build, counters, damage, temp, spent, conditions, note } = copyPc(a.pc);
    Object.assign(pc, { build, counters, damage, temp, spent, conditions, note, out: null, echo: { anchored: false } });
    a.joined = true;
  },
  "pc-echo-anchor": quick((pc, { anchored }) => { if (pc.echo) pc.echo.anchored = anchored; }),
  // A mistaken import leaves no trace, in the snapshots either.
  "pc-remove": (p, data) => {
    const keep = (list) => list.filter((x) => x.id !== data.id);
    p.list = keep(p.list);
    p.queue = keep(p.queue);
    if (p.arrived?.id === data.id) p.arrived = null;
    for (const x of p.snapshots) x.list = keep(x.list);
    if (p.echo12?.list) p.echo12.list = keep(p.echo12.list);
  },
  "pc-hp": quick((pc, { delta }) => {
    const max = pc.build.numbers.hp;
    if (delta < 0) {
      const absorbed = Math.min(pc.temp, -delta);
      pc.temp -= absorbed;
      delta += absorbed;
    }
    pc.damage = Math.min(max, Math.max(0, Math.min(pc.damage, max) - delta));
  }),
  "pc-temp": quick((pc, { value }) => { pc.temp = Math.max(0, value); }),
  "pc-spend": quick((pc, { what, key, delta }) => {
    const k = spentKey(what, key);
    const spent = Math.min(limitOf(pc, what, key), Math.max(0, (pc.spent[k] ?? 0) + delta));
    if (spent) pc.spent[k] = spent;
    else delete pc.spent[k];
  }),
  "pc-condition": quick((pc, { condition, value }) => {
    if (value === null) delete pc.conditions[condition];
    else pc.conditions[condition] = value;
  }),
  "pc-note": quick((pc, { text }) => { pc.note = text; }),
  "pc-prepare": quick((pc) => {
    for (const k of Object.keys(pc.spent)) if (!k.startsWith("counter|")) delete pc.spent[k];
  }),
});

// Hit points now: the maximum of the build less the damage.
export function hitPoints(pc) {
  const max = pc.build.numbers.hp;
  return { hp: Math.max(0, max - pc.damage), max, temp: pc.temp };
}

// What is left of a resource: { left, limit }.
export function left(pc, what, key) {
  const limit = limitOf(pc, what, key);
  return { left: Math.max(0, limit - (pc.spent[spentKey(what, key)] ?? 0)), limit };
}

export const partyState = () => getState().party ?? { list: [], turn: 0, snapshots: [], echo12: null, queue: [], arrived: null };

// The six snapshots before this turn, the latest first: [{ turn, ago, list }].
export function recentSnapshots() {
  const p = partyState();
  return p.snapshots.filter((x) => x.turn < p.turn).map((x) => ({ ...x, ago: p.turn - x.turn })).reverse();
}

// The numbers the site shows and the scene uses, in their order.
export const NUMBERS = [
  ["hp", "ПЗ"], ["ac", "КБ"], ["fortitude", "Стойкость"], ["reflex", "Рефлекс"],
  ["will", "Воля"], ["perception", "Восприятие"],
];

const modOf = (score) => Math.floor((score - 10) / 2);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const text = (x) => (typeof x === "string" && x.trim() ? x.trim() : null);

// A proficiency rank of Pathbuilder (0, 2, 4, 6, 8) to its bonus: untrained adds nothing.
const proficient = (rank, level) => (num(rank) > 0 ? num(rank) + level : 0);

// Every string under "focusSpells" and "focusCantrips", however deep the
// tradition and ability keys nest them.
function focusSpells(node, found = []) {
  if (!node || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    if ((key === "focusSpells" || key === "focusCantrips") && Array.isArray(value)) {
      found.push(...value.filter((x) => typeof x === "string"));
    } else {
      focusSpells(value, found);
    }
  }
  return found;
}

// A Pathbuilder export (the text of its JSON file) to the build the site
// keeps; throws an Error with a message for the GM. The derived numbers use
// the core rules only: item bonuses, runes and feats such as Incredible
// Initiative are not in the export in a form the site reads, so the GM
// checks the numbers before the import (derived keeps what was computed).
export function fromPathbuilder(source) {
  let json;
  try {
    json = JSON.parse(source);
  } catch {
    throw new Error("файл не JSON");
  }
  const b = json?.build;
  if (!b || typeof b !== "object" || !text(b.name)) {
    throw new Error("это не экспорт Pathbuilder: нет раздела build с именем персонажа");
  }
  const level = num(b.level);
  if (level < 1) throw new Error("в экспорте нет уровня персонажа");
  const scores = b.abilities ?? {};
  const mod = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k) => [k, modOf(num(scores[k] ?? 10))]));
  const a = b.attributes ?? {};
  const p = b.proficiencies ?? {};
  const derived = {
    hp: num(a.ancestryhp) + num(a.bonushp) + (num(a.classhp) + num(a.bonushpPerLevel) + mod.con) * level,
    ac: num(b.acTotal?.acTotal),
    fortitude: proficient(p.fortitude, level) + mod.con,
    reflex: proficient(p.reflex, level) + mod.dex,
    will: proficient(p.will, level) + mod.wis,
    perception: proficient(p.perception, level) + mod.wis,
  };
  const casters = (Array.isArray(b.spellCasters) ? b.spellCasters : []).map((c) => ({
    name: text(c.name) ?? "заклинания",
    tradition: text(c.magicTradition),
    type: text(c.spellcastingType),
    // perDay[0] is cantrips; the slots are ranks 1 and up.
    slots: (Array.isArray(c.perDay) ? c.perDay : []).map(num).slice(1)
      .map((count, i) => ({ rank: i + 1, count })).filter((s) => s.count > 0),
  })).filter((c) => c.slots.length > 0);
  const equipment = (Array.isArray(b.equipment) ? b.equipment : [])
    .filter((e) => Array.isArray(e) && text(e[0]))
    .map((e) => ({ name: e[0].trim(), qty: num(e[1]) || 1 }));
  const money = b.money ?? {};
  return {
    name: b.name.trim(),
    class: text(b.class),
    dualClass: text(b.dualClass),
    level,
    ancestry: text(b.ancestry),
    heritage: text(b.heritage),
    background: text(b.background),
    size: text(b.sizeName),
    speed: num(a.speed) + num(a.speedBonus) || null,
    derived,
    numbers: { ...derived },
    casters,
    focus: { max: num(b.focusPoints), spells: [...new Set(focusSpells(b.focus))] },
    weapons: (Array.isArray(b.weapons) ? b.weapons : []).map((w) => text(w.display) ?? text(w.name)).filter(Boolean),
    armor: (Array.isArray(b.armor) ? b.armor : []).map((x) => ({ name: text(x.display) ?? text(x.name), worn: !!x.worn }))
      .filter((x) => x.name),
    equipment,
    money: { pp: num(money.pp), gp: num(money.gp), sp: num(money.sp), cp: num(money.cp) },
  };
}

// Equipment that is usually spent: the first guess for the counters of a new
// character. Pathbuilder does not mark consumables, so the GM decides.
const CONSUMABLE = /potion|elixir|scroll|talisman|bomb|oil|mutagen|poison|bolts|arrows|sling bullets|blowgun darts|ammunition|snare|tincture|draught|salve/i;
export const looksConsumable = (name) => CONSUMABLE.test(name);

// "Thaumaturge 3", "Wizard/Fighter 4".
export function classLine(build) {
  const cls = [build.class, build.dualClass].filter(Boolean).join("/");
  return `${cls || "класс не указан"} ${build.level}`;
}

export function importCharacter(id, build, counters) {
  return dispatch("pc-import", { id, build, counters });
}

const signedDelta = (n) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));

// How the journal writes a party event, or null for another event.
export function partyText(type, data) {
  if (type === "pc-import") {
    const counters = data.counters.length ? `; счётчики: ${data.counters.map((c) => `${c.name} ${c.max}`).join(", ")}` : "";
    return `${data.id === null ? "Импорт из Pathbuilder" : "Персонаж обновлён из Pathbuilder"}: ${data.build.name}, ${classLine(data.build)}${counters}`;
  }
  if (type === "pc-remove") return `Персонаж ${data.name} удалён из партии`;
  const who = data.name;
  if (type === "pc-hp") return `${who}: ${data.delta < 0 ? "урон" : "лечение"} ${signedDelta(data.delta)} ПЗ`;
  if (type === "pc-temp") return data.value ? `${who}: временные ПЗ ${data.value}` : `${who}: временные ПЗ сняты`;
  if (type === "pc-spend") {
    const n = Math.abs(data.delta);
    return `${who}: ${data.delta > 0 ? "потрачено" : "возвращено"} — ${data.label}${n > 1 ? ` ×${n}` : ""}`;
  }
  if (type === "pc-condition") {
    const { condition, value } = data;
    if (value === null) return `${who} — снято «${condition}»`;
    return `${who} — ${condition}${value === true ? "" : ` ${value}`}`;
  }
  if (type === "pc-note") return data.text === null ? `${who}: заметка убрана` : `${who}, заметка: ${data.text}`;
  if (type === "pc-prepare") return `${who}: ежедневная подготовка — ячейки и фокус восстановлены`;
  if (type === "pc-out") return `${who} выбыл: ${data.reason} — ждёт гарантированное эхо`;
  if (type === "pc-echo-join") return `${who}: эхо присоединилось к группе`;
  if (type === "pc-echo-anchor") {
    return data.anchored ? `${who}: Оболочка закрепила эхо как постоянную версию` : `${who}: эхо снова привязано к хрустальным стенам`;
  }
  if (type === "echo-d8") {
    const dead = data.rolls.filter((r) => r.roll === 1).map((r) => r.name);
    return `«Вы сами», d8: ${data.rolls.map((r) => `${r.name} ${r.roll}`).join(", ")}${dead.length ? `; в ветке погибли: ${dead.join(", ")}` : ""}`;
  }
  return null;
}
