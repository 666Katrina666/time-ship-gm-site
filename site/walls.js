import { defineSlice, getState } from "./store.js";
import { rollDie } from "./encounters.js";

// Flicker walls (P5, section 6) on the live map. The walls are the passages
// of the graph with the type "flicker" (canon.map, karta_graf.json); a wall is
// addressed by the id of its passage. The page is site/pages/map.js.
//
// Before stabilization a wall exists or is absent for the current exploration
// turn, 50% each. The GM resolves it lazily (P5, 6.2): a turn boundary that
// the wall spends out of the party's view makes its state stale, and it is
// rolled again when it matters. A wall in view keeps its state over any
// number of turns (P5, 6.1); whether it is in view is the GM's call, so it is
// a mark the GM sets and takes off. The first structural use of the Bracelet
// stabilizes all walls (P5, 6.8-6.10): the sheet field below says so. Then
// turns change nothing; a wall whose state was known in that turn keeps it for
// good, a stale or unknown wall is rolled once more and keeps that.
//
// Party state as events:
// - "wall-roll" { list: [{ id, exists }] }: 50% rolls of the site, one or more
//   walls at once.
// - "wall-set" { id, exists }: the GM sets the state: real dice, or a volume
//   taken by a creature or an object, where a wall does not appear (P5, 6.6).
// - "wall-seen" { list: [id], seen }: walls come into or out of the party's view.
// - "turns" (the tracker, site/turns.js): a turn boundary. Every wall with a
//   known state out of view becomes stale, unless the walls are stable.
// - "world-set" (site/pages/world.js) for the field STABLE: the walls are
//   stable when it is "да". The sheet starts at "нет" (P2, initial state), so
//   a change dropped back to the start (value null) is "нет" too.
//
// A wall's state: { exists: true | false | null (never rolled), stale, seen }.

export const FLICKER = "flicker";
export const STABLE = "ХРУСТАЛЬ · Мерцающие Стены стабилизированы";

const wallOf = (w, id) => (w.walls[id] ??= { exists: null, stale: false, seen: false });

defineSlice("walls", () => ({ stable: false, walls: {} }), {
  "wall-roll": (w, data) => {
    for (const { id, exists } of data.list) Object.assign(wallOf(w, id), { exists, stale: false });
  },
  "wall-set": (w, data) => { Object.assign(wallOf(w, data.id), { exists: data.exists, stale: false }); },
  "wall-seen": (w, data) => {
    for (const id of data.list) wallOf(w, id).seen = data.seen;
  },
  turns: (w) => {
    if (w.stable) return;
    for (const wall of Object.values(w.walls)) if (wall.exists !== null && !wall.seen) wall.stale = true;
  },
  "world-set": (w, data) => {
    if (data.field === STABLE) w.stable = data.value === "да";
  },
});

const NONE = { exists: null, stale: false, seen: false };

// The walls of the graph: [{ id, x1, y1, x2, y2, ... }].
export const wallsOf = (map) => map.edges.filter((e) => e.type === FLICKER);

export const wallState = (id) => getState().walls?.walls[id] ?? NONE;
export const wallsStable = () => Boolean(getState().walls?.stable);

// A wall needs a roll when its state is unknown or went stale.
export const needsRoll = (wall) => wall.exists === null || wall.stale;

// One 50% roll for each id: the data of a "wall-roll" event.
export const rollWalls = (ids) => ({ list: ids.map((id) => ({ id, exists: rollDie(2) === 1 })) });

// "существует", "отсутствует", "не определена"; a stale one shows its last state.
export function wallWord(wall) {
  if (wall.exists === null) return "не определена";
  const word = wall.exists ? "существует" : "отсутствует";
  return wall.stale ? `была: ${word}, нужен бросок` : word;
}

const existsWord = (exists) => (exists ? "существует" : "отсутствует");

// How the journal writes a wall event, or null for another event.
export function wallText(type, data) {
  if (type === "wall-roll") {
    return `Мерцающие стены, бросок: ${data.list.map((r) => `№ ${r.id} ${existsWord(r.exists)}`).join(", ")}`;
  }
  if (type === "wall-set") return `Мерцающая стена № ${data.id}: ${existsWord(data.exists)} (задано)`;
  if (type === "wall-seen") {
    const ids = data.list.map((id) => `№ ${id}`).join(", ");
    return data.seen ? `На виду у группы: ${ids}` : `Больше не на виду: ${ids}`;
  }
  return null;
}
