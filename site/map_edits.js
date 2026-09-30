import { defineSlice, dispatch, getState } from "./store.js";
import { STABLE } from "./walls.js";

// Direct changes of the ship map (P5, 4.6 and 4.11): what the Bracelet, the
// console of the control room or plain tools did to the graph. A change of
// the world, not a phase: it holds in view of the party and over the
// stabilization of the flicker walls (P5, 6.1 and 6.11), and nothing brings
// the old geometry back by itself. The page is site/pages/map.js.
//
// The map is the record of these changes. The sheet field EDITS_FIELD stays
// for what the graph cannot show (growths, the shape of a room), and the
// world page lists the map's changes under it.
//
// Party state as events; each carries the words the journal writes:
// - "map-edit" { kind, cause, label, ... }: one change, its id is the seq of
//   the event.
//   kind "wall-gone" { edge }: a flicker wall is gone for good: it no longer
//   flickers and the passage is open (the Bracelet, result 6 of the console
//   of 19);
//   kind "closed" { edge }: a passage is closed, crystal grew over it;
//   kind "passage" { x1, y1, x2, y2, a, b }: a new passage between two spots;
//   a and b are the points of the graph it joins, or null for a spot in solid
//   crystal.
//   cause: "bracelet", "console" or "other"; label: what changed, in words.
// - "map-edit-drop" { id, label }: the change is taken back, the graph is as
//   it was there.
//
// The first structural use of the Bracelet sets ACTIVATED and the
// stabilization of the walls (P13, room 11: the trigger of P5, 6.8): a change
// with the cause "bracelet" while ACTIVATED is not "да" sends both fields
// right after it, as events of their own.

export const EDITS_FIELD = "ХРУСТАЛЬ · Изменённые стены/двери";
export const ACTIVATED = "ХРУСТАЛЬ · Браслет уже активирован";

export const CAUSES = { bracelet: "Браслет", console: "пульт Зала управления", other: "иное" };
export const KINDS = { "wall-gone": "Мерцающая стена убрана навсегда", closed: "Переход закрыт", passage: "Новый проход" };

defineSlice("mapEdits", () => [], {
  "map-edit": (list, data, event) => {
    // One change per passage of the graph: a second one is a double click.
    if (data.edge !== undefined && list.some((e) => e.edge === data.edge)) return;
    list.push({ id: event.seq, ...data });
  },
  "map-edit-drop": (list, data) => list.filter((e) => e.id !== data.id),
});

export const mapEdits = () => getState().mapEdits ?? [];

// The passage ids a change holds, by kind: { gone: Set, closed: Set }.
export function editedEdges() {
  const gone = new Set();
  const closed = new Set();
  for (const e of mapEdits()) {
    if (e.kind === "wall-gone") gone.add(e.edge);
    if (e.kind === "closed") closed.add(e.edge);
  }
  return { gone, closed };
}

// A sheet field as the party has it now: its change or its start.
function fieldValue(canon, key) {
  const field = canon.state?.groups.flatMap((g) => g.fields).find((f) => f.key === key);
  return getState().world?.[key] ?? field?.start ?? null;
}

// Sends a change; the first one of the Bracelet also sets the two fields.
export async function sendEdit(canon, data) {
  const first = data.cause === "bracelet" && fieldValue(canon, ACTIVATED) !== "да";
  await dispatch("map-edit", data);
  if (!first) return;
  await dispatch("world-set", { field: ACTIVATED, value: "да" });
  if (fieldValue(canon, STABLE) !== "да") await dispatch("world-set", { field: STABLE, value: "да" });
}

export const editText = (e) => `${e.label} (${CAUSES[e.cause] ?? e.cause})`;

// How the journal writes a change, or null for another event.
export function mapEditText(type, data) {
  if (type === "map-edit") return `Карта: ${editText(data)}`;
  if (type === "map-edit-drop") return `Карта: правка снята — ${data.label}`;
  return null;
}
