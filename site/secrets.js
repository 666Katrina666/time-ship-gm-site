import { defineSlice, getState } from "./store.js";

// Secret doors on the live map: the passages of the graph with the type
// "secret" (canon.map, karta_graf.json), addressed by the id of the passage.
// Whether the party found one (P3, section 5) is the GM's mark, like "in view"
// of a flicker wall; the P2 sheet has no field for it. The page is
// site/pages/map.js.
//
// Party state as events; each carries the words the journal writes:
// - "secret-found" { id, found, label }: the party found the door, or the
//   mark is taken off.

export const SECRET = "secret";

defineSlice("secrets", () => ({}), {
  "secret-found": (found, data) => {
    if (data.found) found[data.id] = true;
    else delete found[data.id];
  },
});

// The secret doors of the graph: [{ id, x1, y1, x2, y2, ... }].
export const secretsOf = (map) => map.edges.filter((e) => e.type === SECRET);

export const secretFound = (id) => Boolean(getState().secrets?.[id]);

// How the journal writes a secret door event, or null for another event.
export function secretText(type, data) {
  if (type !== "secret-found") return null;
  return data.found ? `${data.label}: найдена` : `${data.label}: отметка «найдена» снята`;
}
