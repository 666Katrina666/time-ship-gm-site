import { defineSlice, getState } from "./store.js";

// Registry of temporal doubles (P6, sections 6 and 7; topic 1.18 of the
// register). An object is one individual thing whose versions from different
// times may meet; a pair is two live versions of one object. The registry
// keeps items only, as P6, section 6 and the P2 sheet do: versions of
// characters are the "Вы сами" page. The page is site/pages/doubles.js.
//
// Objects and versions are party state; the GM enters them. Pairs are not
// stored: they come from the live versions of each object, so a version that
// leaves takes its pairs with it and a new one brings new pairs (P6, 7.6).
//
// Party state as events; each carries the names the journal writes:
// - "double-object" { id, number, name, item, note, changed }: a new object
//   (id null; its id is the event's seq, number the next "Объект-N") or new
//   fields of an existing one. item is the id of a canon item (canon.items)
//   or null; changed names the edited fields for the journal.
// - "double-object-remove" { id, number, name }: the object was a mistake.
// - "double-version" { object, id, number, name, fields, changed }: a new
//   version of the object (id null; number the next "В-N") or new fields of
//   one. fields are those of P6, 6.7 (FIELDS below): era, order (the personal
//   order on the object's world line, 1 the earliest; equal numbers are
//   versions that cannot be ordered, P6, 7.9), origin, carrier { id, name } of
//   a party character or null, where, hidden (in a closed opaque container,
//   P6, 6.6), residue (a temporal residue, P6, 2.2) and echo (the thing of an
//   echo, which vanishes beyond the crystal walls, P6, 9.8).
// - "double-version-gone" { object, id, number, name, label, reason, turn }:
//   the version is gone (GONE_REASONS) at that turn of the tracker; it stays
//   in the registry marked, without pairs. Bringing it back is an undo.
// - "double-version-remove" { object, id, number, name, label }: the version
//   was a mistake.
// - "double-check" { object, number, name, a, b, pair, roll, entered, result,
//   survivor, vanished, tie, at, turn }: the collapse check of the pair of
//   versions a and b at their first joint observation (P6, 7.4): roll is the
//   d100, rolled by the site or typed in (entered); result "stable" or
//   "collapse" (1-50). A stable pair keeps it for good; a collapse leaves the
//   survivor { id, label }, the later version (P6, 7.9; tie is null, or
//   { entered } when equal order was settled by 50/50), and the vanished one
//   is gone with reason COLLAPSE. at is the place of the survivor, the centre
//   of the P7 discharge (topic 1.18). One event per pair: a joint observation
//   of three versions or more is a series of them, in the order of topic 1.18.

// Suggestions for the era of a version; the GM may write another.
export const ERAS = ["настоящее", "54 года назад (41)", "эпоха хронопризрака"];

export const GONE_REASONS = ["исчезла", "уничтожена", "история переписала"];

// The reason of a version that vanished in a collapse; not one of the GM's.
export const COLLAPSE = "коллапс";

// d100 of the collapse check: 1-50 is a collapse (P6, 7.4).
export const COLLAPSE_AT = 50;

// The P7 card of the discharge.
export const DISCHARGE = "razryad-kollapsa-vremennykh-dubley";

// The field of the P2 sheet that the registry replaces: the world state and
// the room pages show the registry's summary under it; the note stays for
// what old saves wrote there.
export const DOUBLES_FIELD = "СТЫКОВКА 39 / ВРЕМЯ 41 · Временные дубли";

// The fields of a version with the names the journal gives them.
export const FIELDS = {
  era: "эпоха",
  order: "порядок",
  origin: "как попала",
  carrier: "у кого",
  where: "где",
  hidden: "контейнер",
  residue: "остаток",
  echo: "вещь эха",
};

export const OBJECT_FIELDS = { name: "название", item: "предмет канона", note: "заметка" };

const findObject = (d, id) => d.objects.find((o) => o.id === id);

defineSlice("doubles", () => ({ objects: [], count: 0 }), {
  "double-object": (d, data, event) => {
    const { name, item, note } = data;
    if (data.id === null) {
      d.count += 1;
      d.objects.push({ id: event.seq, number: d.count, name, item, note, versions: [], count: 0, checks: [] });
      return;
    }
    const o = findObject(d, data.id);
    if (o) Object.assign(o, { name, item, note });
  },
  "double-object-remove": (d, data) => { d.objects = d.objects.filter((o) => o.id !== data.id); },
  "double-version": (d, data, event) => {
    const o = findObject(d, data.object);
    if (!o) return;
    if (data.id === null) {
      o.count += 1;
      o.versions.push({ ...data.fields, id: event.seq, number: o.count, gone: null });
      return;
    }
    const v = o.versions.find((x) => x.id === data.id);
    if (v) Object.assign(v, data.fields);
  },
  "double-version-gone": (d, data, event) => {
    const v = findObject(d, data.object)?.versions.find((x) => x.id === data.id);
    if (v) v.gone = { reason: data.reason, turn: data.turn, seq: event.seq };
  },
  "double-version-remove": (d, data) => {
    const o = findObject(d, data.object);
    if (o) o.versions = o.versions.filter((v) => v.id !== data.id);
  },
  "double-check": (d, data, event) => {
    const o = findObject(d, data.object);
    if (!o) return;
    const { a, b, pair, roll, entered, result, survivor, vanished, tie, at, turn } = data;
    o.checks.push({ key: pairKey(a, b), a, b, pair, roll, entered, result, survivor, vanished, tie, at, turn, seq: event.seq });
    const v = vanished && o.versions.find((x) => x.id === vanished.id);
    if (v) v.gone = { reason: COLLAPSE, turn, seq: event.seq, into: survivor.label };
  },
});

export const doublesState = () => getState().doubles ?? { objects: [], count: 0 };

export const objectLabel = (o) => `Объект-${o.number}`;
export const versionLabel = (o, v) => `${objectLabel(o)}/В${v.number}`;

// Earliest first on the personal world line; versions that cannot be ordered
// keep the order they were entered in.
const byOrder = (a, b) => a.order - b.order || a.number - b.number;

export const liveVersions = (o) => o.versions.filter((v) => !v.gone).sort(byOrder);

// key does not depend on the order, which the GM may change.
const pairKey = (a, b) => `${Math.min(a, b)}|${Math.max(a, b)}`;

// The stable check of a pair, or null: a pair checked as stable stays so.
const stableOf = (o, key) => o.checks.find((c) => c.key === key && c.result === "stable") ?? null;

// Pairs of versions in the order of topic 1.18: the earliest with each later
// one, then the second with each later one, and so on; versions sorted.
function pairsAmong(o, live) {
  const pairs = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]];
      const key = pairKey(a.id, b.id);
      pairs.push({ a, b, key, check: stableOf(o, key) });
    }
  }
  return pairs;
}

// The pairs of the live versions of an object, each with its stable check.
export const pairsOf = (o) => pairsAmong(o, liveVersions(o));

// The next pair to check in a joint observation of the versions seen (a Set
// of ids): the first unchecked pair of the live ones not in a container
// (P6, 6.6). After a collapse the vanished version is gone, so its pairs drop
// and the survivor goes on with the later versions (topic 1.18).
export function nextPair(o, seen) {
  const live = liveVersions(o).filter((v) => seen.has(v.id) && !v.hidden);
  return pairsAmong(o, live).find((p) => !p.check) ?? null;
}

// Equal personal order: the survivor is 50/50 (P6, 7.9).
export const tied = ({ a, b }) => a.order === b.order;

// The "double-check" event of a pair. pick is the survivor of a tied
// collapse; otherwise the later version b survives.
export function checkEvent(o, pair, { roll, entered, pick = null }) {
  const { a, b } = pair;
  const collapse = roll <= COLLAPSE_AT;
  const survivor = collapse ? (tied(pair) ? pick : b) : null;
  const vanished = survivor && (survivor === a ? b : a);
  const ref = (v) => v && { id: v.id, label: `В${v.number}` };
  return {
    object: o.id, number: o.number, name: o.name, a: a.id, b: b.id, pair: `В${a.number} ↔ В${b.number}`,
    roll, entered, result: collapse ? "collapse" : "stable",
    survivor: ref(survivor), vanished: ref(vanished),
    tie: collapse && tied(pair) ? { entered } : null,
    at: survivor ? placeOf(survivor) : null, turn: getState().party?.turn ?? 0,
  };
}

// The check of one pair rolled by the site: d100 and, for equal order, the
// 50/50. rollDie is passed in: dice live in encounters.js.
export function rollPair(o, pair, rollDie) {
  const pick = tied(pair) ? (rollDie(2) === 1 ? pair.a : pair.b) : null;
  return checkEvent(o, pair, { roll: rollDie(100), entered: false, pick });
}

// The checks of a joint observation rolled by the site, pair by pair in the
// order of topic 1.18, as events to dispatch one after another.
export function rollObservation(o, seen, rollDie) {
  const events = [];
  // Works on a copy: the state changes only when the events come back.
  const copy = { ...o, versions: o.versions.map((v) => ({ ...v })), checks: [...o.checks] };
  for (let pair = nextPair(copy, seen); pair; pair = nextPair(copy, seen)) {
    const event = rollPair(copy, pair, rollDie);
    events.push(event);
    copy.checks.push({ key: pair.key, result: event.result });
    if (event.vanished) copy.versions.find((v) => v.id === event.vanished.id).gone = { reason: COLLAPSE };
  }
  return events;
}

// The stable doubles that give the Cult's +1 (P8, 10.4; topic 1.18): a pair
// checked as stable whose versions both exist, one of them carried by a
// character of the party who has not dropped out. party is the party's list.
export function cultPairs(objects, party) {
  const carried = (v) => v.carrier && party.some((pc) => pc.id === v.carrier.id && !pc.out);
  return objects.flatMap((o) => pairsOf(o)
    .filter((p) => p.check && (carried(p.a) || carried(p.b)))
    .map((p) => ({ ...p, object: o })));
}

// "у Sir Cider, рюкзак" — who carries the version and where it is.
export function placeOf(v) {
  return [v.carrier && `у ${v.carrier.name}`, v.where].filter(Boolean).join(", ");
}

// How the journal writes a doubles event, or null for another event.
export function doubleText(type, data) {
  const object = `Объект-${data.number} «${data.name}»`;
  if (type === "double-object") {
    return data.id === null
      ? `Временные дубли: новый ${object}`
      : `Временные дубли, ${object}: изменено — ${data.changed.join(", ")}`;
  }
  if (type === "double-object-remove") return `Временные дубли: ${object} удалён`;
  if (type === "double-version") {
    if (data.id !== null) return `Временные дубли, ${object}, ${data.label}: изменено — ${data.changed.join(", ")}`;
    const f = data.fields;
    const place = placeOf(f);
    return `Временные дубли, ${object}: новая версия ${data.label} (${f.era || "эпоха не указана"}, порядок ${f.order}${place ? `, ${place}` : ""})`;
  }
  if (type === "double-version-gone") return `Временные дубли, ${object}, ${data.label}: ${data.reason}`;
  if (type === "double-version-remove") return `Временные дубли, ${object}: версия ${data.label} удалена`;
  if (type === "double-check") {
    const roll = `d100 ${data.roll}${data.entered ? " (введено)" : ""}`;
    if (data.result === "stable") return `Временные дубли, ${object}, ${data.pair}: ${roll} — устойчиво`;
    const tie = data.tie ? ` (50/50${data.tie.entered ? " за столом" : " сайта"})` : "";
    const at = data.at ? `: ${data.at}` : "";
    return `Временные дубли, ${object}, ${data.pair}: ${roll} — коллапс, осталась ${data.survivor.label}${tie}, разряд у ${data.survivor.label}${at}`;
  }
  return null;
}
