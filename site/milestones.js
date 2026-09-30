import { defineSlice, getState } from "./store.js";

// Milestones of the campaign (P14; canon.milestones, parsed by
// tools/site_milestones.py). The page is site/pages/milestones.js; this module
// holds the state and the thresholds.
//
// The level itself is not kept here: it is the party level of the encounter
// page ("party-level", site/encounters.js). Applying the level-up sends that
// event, so "applied" means the party is at the level the threshold leads to,
// and both pages always agree.
//
// Party state as events; each carries the names the journal writes:
// - "milestone-mark" { id, name, level, note }: a condition of the catalog is
//   reached, at the party level of that moment, with a short note of the
//   world state (the development register, P14, section 14, step 3).
// - "milestone-drop" { id, name }: the mark was a mistake.
// - "milestone-path" { id, name, what, on }: a declared path of P14, 5.2;
//   what is "claimed" (the party named it) or "made" (its first irreversible
//   step is made). Paths do not exclude each other, so each keeps its own.
// - "milestone-ready" { index, on }: one of the three conditions of readiness
//   for the finale (P14, 3.5), by its index.

defineSlice("milestones", () => ({ marked: [], paths: {}, ready: [] }), {
  "milestone-mark": (m, data, event) => {
    if (!m.marked.some((x) => x.id === data.id)) m.marked.push({ ...data, seq: event.seq });
  },
  "milestone-drop": (m, data) => { m.marked = m.marked.filter((x) => x.id !== data.id); },
  "milestone-path": (m, data) => {
    m.paths[data.id] = { ...(m.paths[data.id] ?? { claimed: false, made: false }), [data.what]: data.on };
  },
  "milestone-ready": (m, data) => { m.ready[data.index] = data.on; },
});

export const milestonesState = () => getState().milestones ?? { marked: [], paths: {}, ready: [] };

// Both thresholds of the level-up (P14, 3.4) for the marks as they are now:
// { primary: { crash, paths, via, met }, fallback: { count, categories, strong, met }, met }.
export function thresholds(canon) {
  const m = canon.milestones;
  const { marked, paths } = milestonesState();
  const items = marked.map((x) => m.items.find((i) => i.id === x.id)).filter(Boolean);
  const crash = marked.some((x) => x.id === m.crash);
  const list = m.paths_items.map((p) => ({ ...p, claimed: false, made: false, ...paths[p.id] }));
  const via = list.find((p) => p.claimed && p.made) ?? null;
  const rule = m.fallback_rule;
  const categories = new Set(items.map((i) => i.category)).size;
  // Only a strong condition that changed the world counts, not knowledge (topic 1.16).
  const strong = items.filter((i) => rule.strong.includes(i.scale) && i.category !== m.knowledge);
  const fallback = {
    count: items.length, categories, strong,
    met: items.length >= rule.conditions && categories >= rule.categories && strong.length > 0,
  };
  const primary = { crash, paths: list, via, met: crash && via !== null };
  return { primary, fallback, met: primary.met || fallback.met };
}

// How the journal writes a milestone event, or null for another event.
export function milestoneText(type, data) {
  if (type === "milestone-mark") {
    return `Веха «${data.name}» получена на ${data.level}-м уровне${data.note ? `: ${data.note}` : ""}`;
  }
  if (type === "milestone-drop") return `Веха «${data.name}» снята`;
  if (type === "milestone-path") {
    const what = data.what === "claimed" ? (data.on ? "заявлен" : "больше не заявлен")
      : (data.on ? "сделан первый необратимый шаг" : "первый шаг снят");
    return `Путь «${data.name}»: ${what}`;
  }
  if (type === "milestone-ready") {
    return `Готовность к развязке, условие ${data.index + 1}: ${data.on ? "да" : "нет"}`;
  }
  return null;
}
