import { defineSlice, getState } from "./store.js";
import { tokensOf } from "./tokens.js";

// Random encounter checks (P10, section 2; canon.encounters, parsed by
// tools/site_encounters.py). The page is site/pages/encounters.js; this
// module holds the state and the rules, so the sidebar tracker can show the
// checks due as well.
//
// The counter moves with the turn tracker: every exploration turn inside the
// ship is one step, a noisy turn one more (P3, section 9). While the whole
// party is outside the ship (in 41) the counter stands (P10, section 2). A
// check is due every 2 steps, or every 4 once the crystal of 39 is removed or
// its aggregate destroyed; when the ship is detached the procedure stops.
// These fields are read from the P2 sheet, as P10, section 2, names them.
//
// Party state as events:
// - "party-level" { level }: the party's level, which picks the table die
//   (canon.encounters.levels). Before the first one the party has the lowest
//   level of the table; the level-up of the milestones page sets it the same
//   way (site/milestones.js).
// - "encounter-outside" { outside }: the whole party is outside the ship.
// - "encounter-echo" { pending }: the GM's own flag of a guaranteed echo,
//   from before step 19f; saves that have it still read. Now the echo comes
//   from the queue of the party slice (site/party.js): a character who drops
//   out waits there, and echoOf() tells when the next check is the echo.
// - "encounter-check" { period, level, die, rolls, count, entered, echo }: one
//   or more checks resolved, each using up `period` steps. rolls is
//   [{ check, row }]: the check die (d6, an encounter on 1) and the table die
//   rolled together; a row with a check other than 1 did not happen and does
//   not count as a result. Only the last roll can be an encounter. count is
//   the composition roll of that encounter or null; entered: the GM rolled
//   real dice and typed the result; echo: the guaranteed echo, rolls [{ check:
//   null, row: 12 }].

export const CHECK_DIE = 6;
export const HIT = 1;
export const ECHO_ROW = 12;
// "Служители Парадокса": stable doubles give +1 to their reaction roll.
export const CULT_ROW = 10;
// "Вы сами" comes from the party six turns back (P6, 9.3).
export const ECHO_SHIFT = 6;
export const FIELDS = {
  crystal: "СТЫКОВКА 39 / ВРЕМЯ 41 · Кристалл 39",
  aggregate: "СТЫКОВКА 39 / ВРЕМЯ 41 · Агрегат 39",
  detached: "ОБОЛОЧКА · Корабль отделён",
};

defineSlice("encounters", () => ({ steps: 0, outside: false, echo: false, level: null, history: [] }), {
  turns: (e, data) => {
    if (!e.outside) e.steps += data.count + (data.noisy ? 1 : 0);
  },
  "party-level": (e, data) => { e.level = data.level; },
  "encounter-outside": (e, data) => { e.outside = data.outside; },
  "encounter-echo": (e, data) => { e.echo = data.pending; },
  "encounter-check": (e, data, event) => {
    e.steps = Math.max(0, e.steps - data.period * data.rolls.length);
    if (data.echo) e.echo = false;
    e.history.push({ seq: event.seq, ...data });
  },
});

// A sheet field's value as the party has it now: its change or its start.
function fieldValue(canon, key) {
  const field = canon.state?.groups.flatMap((g) => g.fields).find((f) => f.key === key);
  if (!field) return { missing: key };
  return { value: getState().world?.[key] ?? field.start };
}

// How often checks come now: { period, reason, stopped, missing }.
export function frequency(canon) {
  const [crystal, aggregate, detached] = [FIELDS.crystal, FIELDS.aggregate, FIELDS.detached]
    .map((key) => fieldValue(canon, key));
  const missing = [crystal, aggregate, detached].map((f) => f.missing).filter(Boolean);
  const stopped = detached.value === "да";
  if (crystal.value === "снят") return { period: 4, reason: "Кристалл 39 снят", stopped, missing };
  if (aggregate.value === "разрушен") return { period: 4, reason: "агрегат 39 разрушен", stopped, missing };
  return { period: 2, reason: "Кристалл 39 стоит в исправном агрегате", stopped, missing };
}

// The party's level and its table die: { level, die }.
export function levelOf(canon) {
  const levels = canon.encounters.levels;
  const level = getState().encounters.level ?? levels[0].level;
  return levels.find((l) => l.level === level) ?? levels[0];
}

// Checks due now; zero while the procedure is stopped.
export function dueOf(canon) {
  const { period, stopped } = frequency(canon);
  return stopped ? 0 : Math.floor(getState().encounters.steps / period);
}

// Whether the live map disagrees with "группа вне Корабля": null, or
// { outside, room, name } — the value to suggest, the room of P13 that says
// so and the token that stands there.
// The party is outside when its token and every character token on the map
// stand in rooms whose "Случайные встречи" block says the P10 table is not
// checked there (room.outside: 1, 2, 38, 41); a token off the map does not
// count. Only a hint: tokens are optional, and in 41 it matters whether the
// whole party is there, so the GM switches the counter.
export function placeHint(canon) {
  if (frequency(canon).stopped) return null;
  const rooms = new Map(canon.rooms.map((r) => [r.number, r]));
  const placed = tokensOf(canon).filter((t) => (t.kind === "party" || t.kind === "character") && rooms.has(t.room));
  if (!placed.length) return null;
  const inside = placed.find((t) => !rooms.get(t.room).outside);
  const outside = !inside;
  if (outside === getState().encounters.outside) return null;
  const token = inside ?? placed[0];
  return { outside, room: rooms.get(token.room), name: token.name };
}

// The guaranteed echo (P6, 10.8; topic 1.17 of the register): { due, queue,
// waiting }. It is due when a character waits in the queue and a snapshot six
// turns back exists; until then it waits and the checks go as usual. The
// party state is read here, not imported: site/party.js imports this module.
export function echoOf() {
  const party = getState().party;
  const queue = party?.queue ?? [];
  const ready = queue.length > 0 && party.turn >= ECHO_SHIFT;
  return { due: getState().encounters.echo || ready, queue, waiting: queue.length > 0 && !ready };
}

// Whether a roll is an encounter that happened.
export const happened = (roll) => roll.check === null || roll.check === HIT;

export function rollDie(sides) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return 1 + (buffer[0] % sides);
}

// "3d6" -> the sum of three d6, "2" -> 2; null for no dice.
export function rollCount(count) {
  if (!count) return null;
  const m = count.match(/^(\d+)d(\d+)$/);
  if (!m) return Number(count);
  let sum = 0;
  for (let i = 0; i < Number(m[1]); i++) sum += rollDie(Number(m[2]));
  return sum;
}

// "1 проверка", "3 проверки", "5 проверок".
export function checksWord(n) {
  const [ten, one] = [n % 100, n % 10];
  if (ten >= 11 && ten <= 14) return "проверок";
  return one === 1 ? "проверка" : one >= 2 && one <= 4 ? "проверки" : "проверок";
}

// How the journal writes the events; rows are named by number, the canon is not at hand there.
export function encounterText(type, data) {
  if (type === "party-level") return `Уровень партии: ${data.level}`;
  if (type === "encounter-outside") return data.outside ? "Группа вне Корабля: счётчик встреч стоит" : "Группа вернулась в Корабль";
  if (type === "encounter-echo") return data.pending ? "Ждёт гарантированное эхо" : "Гарантированное эхо снято";
  if (type !== "encounter-check") return null;
  if (data.echo) return "Гарантированное эхо: встреча № 12 без броска";
  const last = data.rolls.at(-1);
  const misses = data.rolls.length - (happened(last) ? 1 : 0);
  const how = data.entered ? "введено" : `d${CHECK_DIE} и d${data.die}`;
  const head = misses ? `${misses} ${checksWord(misses)} без встречи` : "";
  if (!happened(last)) return `Случайные встречи (${how}): ${head}`;
  const count = data.count === null ? "" : `, состав ${data.count}`;
  return `Случайная встреча (${how}): ${head ? `${head}, затем ` : ""}№ ${last.row}${count}`;
}
