import { defineSlice, getState } from "./store.js";

// Tokens of the live map: which room the party and the NPCs are in. The page
// is site/pages/map.js, the panel site/pages/map_token_panel.js.
//
// Tokens of the canon:
// - "party": the party, starting in the room of P13 marked "Старт группы"
//   (canon.map.start; topic 1.15 of the register);
// - "npc:<id>": every NPC card of P8 whose field "Старт" names a room by
//   number (npc.start), starting there. An NPC that starts off the map (the
//   Time Ship, the Lady, the Master) is not listed until the GM puts it on
//   the map (offMapNpcs); from then on it stays listed.
// Tokens the GM adds: a character when the party splits, or anyone else, by
// name; the id is the seq of the event.
//
// Party state as events; each carries the name the journal writes:
// - "token-move" { id, name, room }: the token goes to a room; room null takes
//   it off the map.
// - "token-add" { name, kind, room }: kind "character" or "other".
// - "token-remove" { id, name }: an added token leaves the list; a token of
//   the canon only goes off the map.

export const PARTY = "party";
export const KIND_WORDS = { party: "группа", character: "персонаж", npc: "НПС", other: "другое" };

defineSlice("tokens", () => ({ moved: {}, added: [] }), {
  "token-move": (t, data) => { t.moved[data.id] = data.room; },
  "token-add": (t, data, event) => {
    t.added.push({ id: String(event.seq), name: data.name, kind: data.kind, start: data.room });
  },
  "token-remove": (t, data) => {
    t.added = t.added.filter((a) => a.id !== data.id);
    delete t.moved[data.id];
  },
});

// All tokens: [{ id, name, kind, room, start, npc? }], the canon ones first.
export function tokensOf(canon) {
  const { moved, added } = getState().tokens ?? { moved: {}, added: [] };
  const list = [
    { id: PARTY, name: "Группа", kind: "party", start: canon.map?.start ?? null },
    ...canon.npcs.map((n) => ({ id: `npc:${n.id}`, name: n.name, kind: "npc", start: n.start ?? null, npc: n.id }))
      .filter((t) => t.start !== null || t.id in moved),
    ...added,
  ];
  return list.map((t) => ({ ...t, room: t.id in moved ? moved[t.id] : t.start }));
}

// NPCs the list leaves out: they start off the map and never moved.
export function offMapNpcs(canon) {
  const { moved } = getState().tokens ?? { moved: {} };
  return canon.npcs.filter((n) => (n.start ?? null) === null && !(`npc:${n.id}` in moved))
    .map((n) => ({ id: `npc:${n.id}`, name: n.name, kind: "npc", start: null, room: null, npc: n.id }));
}

// "Механический Пёс" -> "МП": the mark of a token on the map.
export const initials = (name) => name.split(/\s+/).filter((w) => /^[\p{Lu}]/u.test(w)).slice(0, 2)
  .map((w) => w[0]).join("") || name[0].toUpperCase();

// How the journal writes a token event, or null for another event.
export function tokenText(type, data) {
  if (type === "token-move") {
    return data.room === null ? `Токен «${data.name}» убран с карты` : `Токен «${data.name}» → комната ${data.room}`;
  }
  if (type === "token-add") {
    return `Новый токен «${data.name}» (${KIND_WORDS[data.kind]})${data.room === null ? "" : ` в комнате ${data.room}`}`;
  }
  if (type === "token-remove") return `Токен «${data.name}» удалён`;
  return null;
}
