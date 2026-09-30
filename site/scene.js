import { defineSlice, dispatch } from "./store.js";

// Combat scene: the creatures and hazards of one fight, each instance with its
// own hit points and conditions, in initiative order (the "Сцена" page).
// The numbers come from the canon card; the instances are party state.
//
// Party state as events; every one carries the names the journal writes:
// - "scene-add" { list: [{ kind, ref, name, max, mod }] }: new combatants.
//   kind is "creature", "hazard", "pc" or "other" (anyone without a card:
//   ref, max and mod are null); max is the hit points of the card; mod the
//   initiative modifier (Perception of a creature, Stealth of a hazard).
//   A "pc" is a character of the party (site/party.js), ref its id: its hit
//   points and conditions are the party's, changed by the party's events,
//   so the scene keeps no copy (max null). Players roll their own
//   initiative, so mod is null and the GM types the result.
//   An instance gets id "<seq>.<n>"; a second one of the same name is
//   numbered: "Пёс", "Пёс 2"; a character keeps its name.
// - "scene-hp" { id, name, delta }: damage (negative) or healing, kept
//   within 0 and the maximum.
// - "scene-init" { list: [{ id, name, value }] }: initiative, null clears it.
// - "scene-condition" { id, name, condition, value }: condition is the
//   glossary name without " N"; value is a number for a condition with a
//   value, true for one without, null takes it off.
// - "scene-remove" { id, name }, "scene-turn" { id, name, round },
//   "scene-clear" {}: the scene is over and empties.
//
// active is the id whose turn it is, null before the fight, or START: the
// round goes on from the top of the order.

export const START = "start";

defineSlice("scene", () => ({ list: [], active: null, round: 0, counts: {} }), {
  "scene-add": (s, data, event) => {
    data.list.forEach((c, n) => {
      const count = c.kind === "pc" ? 1 : (s.counts[c.name] || 0) + 1;
      if (c.kind !== "pc") s.counts[c.name] = count;
      s.list.push({
        ...c, id: `${event.seq}.${n}`, name: count > 1 ? `${c.name} ${count}` : c.name,
        hp: c.max, init: null, conditions: {},
      });
    });
  },
  "scene-hp": (s, data) => {
    const c = s.list.find((x) => x.id === data.id);
    if (c && c.max !== null) c.hp = Math.min(c.max, Math.max(0, c.hp + data.delta));
  },
  "scene-init": (s, data) => {
    for (const { id, value } of data.list) {
      const c = s.list.find((x) => x.id === id);
      if (c) c.init = value;
    }
  },
  "scene-condition": (s, data) => {
    const c = s.list.find((x) => x.id === data.id);
    if (!c) return;
    if (data.value === null) delete c.conditions[data.condition];
    else c.conditions[data.condition] = data.value;
  },
  // Removing the one whose turn it is hands the turn marker to the one
  // before, so the next turn goes on in the same round.
  "scene-remove": (s, data) => {
    if (s.active === data.id) {
      const order = ordered(s.list);
      const at = order.findIndex((x) => x.id === data.id);
      s.active = at > 0 ? order[at - 1].id : START;
    }
    s.list = s.list.filter((x) => x.id !== data.id);
  },
  "scene-turn": (s, data) => {
    s.active = data.id;
    s.round = data.round;
  },
  "scene-clear": () => ({ list: [], active: null, round: 0, counts: {} }),
});

// Initiative order: higher first, ties and those without initiative in the
// order they came in.
export function ordered(list) {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.init ?? -Infinity) - (a.c.init ?? -Infinity) || a.i - b.i)
    .map(({ c }) => c);
}

// A combatant of a canon card: a creature or a hazard of canon.json.
export function fromCard(kind, card) {
  const n = card.numbers;
  return {
    kind, ref: card.id, name: card.name, max: n.hp ?? null,
    mod: (kind === "hazard" ? n.stealth : n.perception) ?? null,
  };
}

// A character of the party as a combatant.
export function fromCharacter(pc) {
  return { kind: "pc", ref: pc.id, name: pc.build.name, max: null, mod: null };
}

// Whether a character of the party is in the scene already.
export const inScene = (scene, pc) => scene.list.some((c) => c.kind === "pc" && c.ref === pc.id);

export function addToScene(list) {
  return dispatch("scene-add", { list });
}

const signedDelta = (n) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));

// "Хрустальный Паук ×3, Sir Cider": equal names once, with their number.
function namesText(list) {
  const counts = new Map();
  for (const c of list) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
}

// How the journal writes a scene event, or null for another event.
export function sceneText(type, data) {
  if (type === "scene-add") return `Сцена: вошли ${namesText(data.list)}`;
  if (type === "scene-hp") return `Сцена: ${data.name} ${data.delta < 0 ? "урон" : "лечение"} ${signedDelta(data.delta)} ПЗ`;
  if (type === "scene-init") {
    return `Сцена, инициатива: ${data.list.map((c) => `${c.name} ${c.value ?? "—"}`).join(", ")}`;
  }
  if (type === "scene-condition") {
    const { name, condition, value } = data;
    if (value === null) return `Сцена: ${name} — снято «${condition}»`;
    return `Сцена: ${name} — ${condition}${value === true ? "" : ` ${value}`}`;
  }
  if (type === "scene-remove") return `Сцена: участник ${data.name} удалён`;
  if (type === "scene-turn") return `Сцена, раунд ${data.round}: ходит ${data.name}`;
  if (type === "scene-clear") return "Сцена завершена";
  return null;
}
