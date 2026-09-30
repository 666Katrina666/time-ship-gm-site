import { html, useState } from "../vendor/htm-preact.js";
import { dispatch, getState, useStore } from "../store.js";
import { ACTIVATED, CAUSES, KINDS, editText, mapEdits, sendEdit } from "../map_edits.js";

// "Правка карты" of the map page (site/pages/map.js), in its column next to
// the map: at the top a mode for the next click on the graph, the target it
// picked, the cause and a note (EditBar); at the end the changes made so far,
// each of which can be taken back (EditList). The state of the changes is
// site/map_edits.js.
//
// Modes: "wall-gone" picks a flicker wall, "closed" a passage of another
// type, "passage" two spots of a new passage. A spot sticks to the nearest
// point of the graph within SNAP; farther away it stays where it was clicked,
// in solid crystal.

export const SNAP = 40;

// The points of the graph: every point is an end of a passage.
function pointsOf(map) {
  const points = new Map();
  for (const e of map.edges) {
    points.set(e.a, { x: e.x1, y: e.y1 });
    points.set(e.b, { x: e.x2, y: e.y2 });
  }
  return points;
}

const roomsOf = (map) => new Map(map.nodes.filter((n) => n.room !== undefined).map((n) => [n.id, n.room]));

// A clicked spot: { x, y, point, label }, point null in solid crystal.
export function snap(map, x, y) {
  let best = null;
  let dist = SNAP;
  for (const [id, p] of pointsOf(map)) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= dist) [best, dist] = [{ id, ...p }, d];
  }
  if (!best) return { x: Math.round(x), y: Math.round(y), point: null, label: "глухой хрусталь" };
  const room = roomsOf(map).get(best.id);
  return { x: best.x, y: best.y, point: best.id, label: room ? `комната ${room}` : `точка ${best.id}` };
}

// The room each point of the graph leads to: the first room reached from it
// along corridors and doors, or none. The ends of a wall or a secret door
// are bends of corridors, so the room is found by a walk, not by the point.
const WALK = new Set(["corridor", "door"]);
const reached = new WeakMap();

function roomOfPoint(map) {
  if (reached.has(map)) return reached.get(map);
  const next = new Map();
  const link = (a, b) => next.set(a, [...(next.get(a) ?? []), b]);
  for (const e of map.edges) {
    if (!WALK.has(e.type)) continue;
    link(e.a, e.b);
    link(e.b, e.a);
  }
  const rooms = roomsOf(map);
  const walk = (from) => {
    const seen = new Set([from]);
    for (const queue = [from]; queue.length;) {
      const at = queue.shift();
      if (rooms.has(at)) return rooms.get(at);
      for (const to of next.get(at) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        queue.push(to);
      }
    }
    return null;
  };
  const found = new Map();
  const of = (point) => {
    if (!found.has(point)) found.set(point, walk(point));
    return found.get(point);
  };
  reached.set(map, of);
  return of;
}

// The rooms on both sides of a passage: [4, 13], one room if both sides lead
// to it, [] if neither leads to a room.
export function sidesOf(map, edge) {
  const of = roomOfPoint(map);
  return [...new Set([of(edge.a), of(edge.b)].filter((r) => r !== null))];
}

// "Дверь № 45 (4 — 13)": the passage with the rooms on its sides, if any.
export function edgeLabel(map, edge) {
  const title = map.types.find((t) => t.id === edge.type)?.title ?? edge.type;
  const sides = sidesOf(map, edge);
  return `${title} № ${edge.id}${sides.length ? ` (${sides.join(" — ")})` : ""}`;
}

const HINTS = {
  "wall-gone": "Щёлкните по Мерцающей стене на карте. Убранная стена больше не мерцает и не бросается: проход открыт.",
  closed: "Щёлкните по переходу на карте: хрусталь зарос поверх него.",
  passage: `Щёлкните по карте дважды — начало и конец прохода. Конец цепляется к точке графа ближе ${SNAP}, иначе встаёт в глухой хрусталь.`,
};

// What the next change would be: { data, label } or null while the target is missing.
function draft(map, mode, target, spots) {
  if (mode === "passage") {
    if (spots.length < 2) return null;
    const [a, b] = spots;
    const label = `Новый проход: ${a.label} — ${b.label}`;
    return { label, data: { kind: mode, x1: a.x, y1: a.y, x2: b.x, y2: b.y, a: a.point, b: b.point, label } };
  }
  const edge = map.edges.find((e) => e.id === target);
  if (!edge) return null;
  const what = edgeLabel(map, edge);
  const label = mode === "wall-gone" ? `${what} убрана навсегда` : `Переход закрыт: ${what}`;
  return { label: what, data: { kind: mode, edge: edge.id, label } };
}

// The buttons of the modes: short, as they stand in the column next to the
// map; the full words of KINDS are their tooltips and go to the journal.
const BUTTONS = { "wall-gone": "Убрать стену", closed: "Закрыть переход", passage: "Новый проход" };

// The modes of the change and the change being made: at the top of the
// column next to the map. mode may also be "move" of the tokens: that one is
// not a change here.
export function EditBar({ canon, map, mode: shared, setMode, target, spots, onReset }) {
  const mode = KINDS[shared] ? shared : null;
  const [cause, setCause] = useState("bracelet");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const activated = useStore(() => getState().world?.[ACTIVATED]);
  const start = canon.state?.groups.flatMap((g) => g.fields).find((f) => f.key === ACTIVATED)?.start;
  const first = cause === "bracelet" && (activated ?? start) !== "да";
  const causes = Object.entries(CAUSES).filter(([id]) => id !== "console" || mode === "wall-gone");
  const next = mode && draft(map, mode, target, spots);
  // The console acts on flicker walls only.
  const reason = cause === "console" && mode !== "wall-gone" ? "bracelet" : cause;

  const choose = (m) => {
    setMode(m === mode ? null : m);
    onReset();
  };
  const apply = async () => {
    if (!next || busy) return;
    setBusy(true);
    try {
      await sendEdit(canon, { ...next.data, cause: reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setNote("");
      setError(null);
      onReset();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const where = mode === "passage"
    ? (spots.length ? spots.map((s) => s.label).join(" — ") : "не выбран")
    : (next?.label ?? "не выбрана");

  return html`
    <section class=${`map-edit-bar${mode ? " active" : ""}`}>
      <div class="row">
        <strong>Правка карты</strong>
        ${Object.entries(BUTTONS).map(([id, word]) => html`
          <button key=${id} class=${`small${mode === id ? " on" : ""}`} aria-pressed=${mode === id} title=${KINDS[id]}
                  onClick=${() => choose(id)}>${word}</button>
        `)}
      </div>
      ${mode && html`
        <p class="muted">${HINTS[mode]}</p>
        <p>${mode === "passage" ? "Проход" : "Цель"}: <strong>${where}</strong></p>
        <div class="row">
          <label>Причина
            <select value=${reason} onChange=${(e) => setCause(e.target.value)}>
              ${causes.map(([id, word]) => html`<option key=${id} value=${id}>${word}</option>`)}
            </select>
          </label>
          <input class="map-edit-note" value=${note} placeholder="Заметка, если нужна" onInput=${(e) => setNote(e.target.value)} />
        </div>
        <div class="row">
          <button disabled=${!next || busy} onClick=${apply}>Применить</button>
          <button onClick=${onReset} disabled=${!target && !spots.length}>Сбросить цель</button>
          <button onClick=${() => choose(mode)}>Отмена</button>
        </div>
        ${first && html`<p class="muted">Первое применение Браслета: сайт выставит и поля листа «Браслет уже активирован» и «Мерцающие Стены стабилизированы» (П13, комната 11).</p>`}
      `}
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

// The changes made so far, each of which can be taken back: at the end of
// the column.
export function EditList() {
  const [error, setError] = useState(null);
  const edits = useStore(() => mapEdits());
  const drop = (e) => dispatch("map-edit-drop", { id: e.id, label: e.label }).then(() => setError(null), (x) => setError(x.message));
  return html`
    <section class="card map-edits">
      <h2>Правки карты <span class="muted">${edits.length}</span></h2>
      <p class="muted">
        Прямые изменения мира (П5, 4.6 и 4.11): держатся на виду у группы и поверх стабилизации стен, сами не возвращаются.
        Чего граф не покажет — наросты, форму комнат — пишите в поле листа «Изменённые стены/двери».
      </p>
      ${error && html`<p class="bad">${error}</p>`}
      ${edits.length > 0 && html`
        <ul class="map-edit-list">
          ${edits.map((e) => html`
            <li key=${e.id}>
              ${editText(e)}${e.note && html` <span class="muted">— ${e.note}</span>`}
              <button class="small" title="Граф в этом месте снова как был" onClick=${() => drop(e)}>снять</button>
            </li>
          `)}
        </ul>`}
    </section>
  `;
}
