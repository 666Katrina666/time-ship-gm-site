import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/htm-preact.js";
import { decode, sectionHref, useCanon } from "../canon.js";
import { CanonState, setTitle } from "../card.js";
import { dispatch, getState, useStore } from "../store.js";
import { FLICKER, STABLE, needsRoll, rollWalls, wallState, wallWord, wallsOf, wallsStable } from "../walls.js";
import { editText, mapEdits } from "../map_edits.js";
import { EditBar, EditList, edgeLabel, sidesOf, snap } from "./map_edit_panel.js";
import { SECRET, secretFound, secretsOf } from "../secrets.js";
import { initials, tokensOf } from "../tokens.js";
import { TokenPanel, move } from "./map_token_panel.js";
import { roomHref } from "./rooms.js";
import { Group } from "./world.js";

// The ship map: the graph of karta_graf.json as the builder gives it
// (canon.map). "#/game/map" shows it all, "#/game/map/<number>" marks a room.
// The graph fits the screen whole, without zoom or scrolling; next to it
// stands a column of the passages that matter in play: the flicker walls, the
// secret doors, the locked and the special passages. The layers and panels
// are under the map. Every passage type is a layer that can be hidden; the
// corridors, the secret doors and the special passages start hidden. A
// passage of a hidden layer still shows while it has a halo (picked or under
// the pointer in the column). Under the graph lies the
// photo of the paper map it was traced over (canon.map.photo), turned and
// scaled by the builder; it has its own checkbox and brightness, full at the
// start. The layers and the photo are the page's view, not party state:
// nothing goes to the journal. The flicker walls are live (site/walls.js):
// each is drawn by its state, and its row in the column rolls and marks it.
// A secret door is dashed until the party found it (site/secrets.js). A click
// on a wall, a secret door, a locked or a special passage on the map picks it
// in the column and opens a popup at the click with the same controls and a
// change of the map with it as the target; a click on the map elsewhere,
// Escape or a map change mode closes it. Shift with a click on a flicker
// wall, on the map or its number in the column, adds it to the picked walls
// or takes it out; while several are picked, a bar at the top of the column
// marks them in view, out of view or rolls them together. The picked
// passages, and the one under the pointer in the column, have a halo. The changes of the map
// (site/map_edits.js, site/pages/map_edit_panel.js: the modes at the top of
// the column, the list at its end) are drawn over the graph: a wall gone for
// good, a closed passage, a new passage; while a mode is on, a click on the
// graph picks its target instead.
// The tokens (site/tokens.js, panel site/pages/map_token_panel.js) stand
// under their rooms; a token picked on the map or in the panel is the target
// of the mode "move", and a click on a room moves it there.

// Corridors and open passages are most of the lines, and the photo shows
// them; secret doors and special passages the GM turns on when needed.
const HIDDEN_AT_START = ["corridor", "secret", "special"];

export function mapHref(room) {
  return `#/game/map${room ? `/${room}` : ""}`;
}

const tip = (...parts) => parts.filter(Boolean).join(" — ");

function Layers({ types, hidden, onToggle }) {
  return html`
    <div class="row map-layers">
      ${types.map((t) => html`
        <label key=${t.id}>
          <input type="checkbox" checked=${!hidden.has(t.id)} onChange=${() => onToggle(t.id)} />
          <svg class="map-swatch" viewBox="0 0 24 8"><line class=${`edge edge-${t.id}`} x1="0" y1="4" x2="24" y2="4" /></svg>
          ${t.title} <span class="muted">${t.count}</span>
        </label>
      `)}
    </div>
  `;
}

const WALL_STATES = [
  ["wall-on", "существует"], ["wall-off", "отсутствует"], ["wall-unknown", "не определена"],
  ["wall-on wall-stale", "нужен бросок"], ["wall-on wall-seen", "на виду"], ["wall-gone", "убрана навсегда"],
];

function WallLegend() {
  return html`
    <div class="row map-layers">
      <span class="muted">Мерцающие стены:</span>
      ${WALL_STATES.map(([cls, word]) => html`
        <span key=${word} class="map-legend">
          <svg class="map-swatch" viewBox="0 0 24 8">
            <g class=${`wall ${cls}`}>
              <line class="wall-halo" x1="2" y1="4" x2="22" y2="4" />
              <line class=${`edge edge-${FLICKER}`} x1="2" y1="4" x2="22" y2="4" />
            </g>
          </svg>
          ${word}
        </span>
      `)}
      <span class="muted">Потайные двери:</span>
      <span class="map-legend">
        <svg class="map-swatch" viewBox="0 0 24 8"><g class="passage secret-hidden"><line class="edge edge-secret" x1="2" y1="4" x2="22" y2="4" /></g></svg>
        не найдена
      </span>
      <span class="map-legend">
        <svg class="map-swatch" viewBox="0 0 24 8"><line class="edge edge-secret" x1="2" y1="4" x2="22" y2="4" /></svg>
        найдена
      </span>
      <span class="muted">Правки:</span>
      <span class="map-legend">
        <svg class="map-swatch" viewBox="0 0 24 8"><g class="passage closed"><line class="edge edge-door" x1="2" y1="4" x2="22" y2="4" /></g></svg>
        переход закрыт
      </span>
      <span class="map-legend">
        <svg class="map-swatch" viewBox="0 0 24 8"><line class="edge edge-new" x1="2" y1="4" x2="22" y2="4" /></svg>
        новый проход
      </span>
    </div>
  `;
}

const PHOTO_LEVELS = { min: 0.15, max: 1, step: 0.05, start: 1 };

function PhotoLayer({ photo, shown, setShown, level, setLevel }) {
  if (!photo) return null;
  return html`
    <div class="row map-layers">
      <label title=${photo.file}>
        <input type="checkbox" checked=${shown} onChange=${() => setShown(!shown)} />
        Фото карты
      </label>
      <label class=${shown ? "" : "muted"}>
        яркость
        <input type="range" min=${PHOTO_LEVELS.min} max=${PHOTO_LEVELS.max} step=${PHOTO_LEVELS.step} value=${level}
               disabled=${!shown} onInput=${(e) => setLevel(Number(e.target.value))} />
      </label>
    </div>
  `;
}

// Classes of a flicker wall by its state.
function wallClass(wall, picked, gone) {
  if (gone) return `wall-gone${picked ? " wall-picked" : ""}`;
  const state = wall.exists === null ? "wall-unknown" : wall.exists ? "wall-on" : "wall-off";
  return `${state}${wall.stale ? " wall-stale" : ""}${wall.seen ? " wall-seen" : ""}${picked ? " wall-picked" : ""}`;
}

// A flicker wall: a halo under it (in view, picked), the line, and a wide
// transparent line on top, so a thin wall is easy to click.
function Wall({ edge, title, picked, gone, onPick }) {
  const onClick = (event) => {
    event.stopPropagation();
    onPick(edge.id, graphPoint(event), event.shiftKey);
  };
  const wall = useStore(() => wallState(edge.id));
  const at = { x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2 };
  const word = gone ? "убрана навсегда" : wallWord(wall);
  return html`
    <g class=${`wall ${wallClass(wall, picked, gone)}`} onClick=${onClick} data-wall=${edge.id}>
      <title>${tip(`${title} № ${edge.id}: ${word}`, !gone && wall.seen && "на виду")}</title>
      <line class="wall-halo" ...${at} vector-effect="non-scaling-stroke" />
      <line class=${`edge edge-${FLICKER}`} ...${at} vector-effect="non-scaling-stroke" />
      <line class="wall-hit" ...${at} vector-effect="non-scaling-stroke" />
    </g>
  `;
}

// The changes of the map by kind: { gone: Set, closed: Set, passages: [] }.
function editsOf(edits) {
  const pick = (kind) => edits.filter((e) => e.kind === kind);
  return {
    gone: new Set(pick("wall-gone").map((e) => e.edge)),
    closed: new Set(pick("closed").map((e) => e.edge)),
    passages: pick("passage"),
  };
}

// A cross over the middle of a closed passage.
function Cross({ edge }) {
  const [x, y] = [(edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2];
  const r = 12;
  return html`
    <line class="edge-cross" x1=${x - r} y1=${y - r} x2=${x + r} y2=${y + r} vector-effect="non-scaling-stroke" />
    <line class="edge-cross" x1=${x - r} y1=${y + r} x2=${x + r} y2=${y - r} vector-effect="non-scaling-stroke" />
  `;
}

// A point of the SVG under the mouse, in the graph's coordinates.
function graphPoint(event) {
  const svg = event.target.ownerSVGElement ?? event.target;
  const point = svg.createSVGPoint();
  [point.x, point.y] = [event.clientX, event.clientY];
  const { x, y } = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x, y };
}

// Tokens under their room: a row of marks, centred.
const TOKEN_GAP = 44;
const TOKEN_DROP = 52;

// edit: { mode, target, spots, onEdge, onSpot, onToken, onRoom }; mode null —
// clicks as usual. lit: the passages with a halo (picked, under the pointer).
// onPick(id, point, shift): a wall; onPassage(id, point): a passage of the column
// clicked while there is no mode; onBlank: a click anywhere else.
function Graph({ canon, map, hidden, active, lit, onPick, onPassage, onBlank, edit, photo }) {
  const titles = new Map(map.types.map((t) => [t.id, t.title]));
  const names = new Map(canon.rooms.map((r) => [r.number, r.title]));
  const { gone, closed, passages } = editsOf(useStore(() => mapEdits()));
  const found = useStore(() => new Set(secretsOf(map).filter((e) => secretFound(e.id)).map((e) => e.id)));
  const edges = map.edges.filter((e) => (!hidden.has(e.type) || lit.has(e.id)) && e.type !== FLICKER);
  const walls = hidden.has(FLICKER) ? [] : wallsOf(map);
  const rooms = map.nodes;
  const tokens = useStore(() => tokensOf(canon));
  const at = (room) => tokens.filter((t) => t.room === room);
  const picking = edit.mode === "closed";
  const [a, b] = edit.spots;
  const onClick = (event) => {
    if (!edit.mode) return onBlank();
    if (edit.mode !== "passage") return;
    const p = graphPoint(event);
    edit.onSpot(p.x, p.y);
  };
  const line = (e) => ({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, "vector-effect": "non-scaling-stroke" });
  return html`
    <svg class=${`ship-map${edit.mode ? " editing" : ""}`} viewBox=${map.box.join(" ")} onClick=${onClick}>
      ${photo && html`
        <image class="map-photo" href=${map.photo.src} width=${map.photo.width} height=${map.photo.height}
               transform=${`matrix(${map.photo.transform.join(" ")})`} preserveAspectRatio="none" opacity=${photo} />`}
      ${edges.map((e) => {
        const secret = e.type === SECRET && (found.has(e.id) ? "найдена" : "не найдена");
        const on = (picking && edit.target === e.id) || (!edit.mode && lit.has(e.id));
        const open = !edit.mode && COLUMN.includes(e.type);
        const onClick = (event) => {
          event.stopPropagation();
          onPassage(e.id, graphPoint(event));
        };
        return html`
        <g key=${e.id} class=${`passage${closed.has(e.id) ? " closed" : ""}${on ? " targeted" : ""}${secret === "не найдена" ? " secret-hidden" : ""}${open ? " clickable" : ""}`}
           data-edge=${e.id}>
          <title>${tip(edgeLabel(map, e), secret, closed.has(e.id) && "закрыт правкой")}</title>
          <line class="edge-halo" ...${line(e)} />
          <line class=${`edge edge-${e.type}`} ...${line(e)} />
          ${closed.has(e.id) && html`<${Cross} edge=${e} />`}
          ${picking && !closed.has(e.id) && html`<line class="wall-hit" ...${line(e)} onClick=${() => edit.onEdge(e.id)} />`}
          ${open && html`<line class="wall-hit" ...${line(e)} onClick=${onClick} />`}
        </g>
      `;
      })}
      ${walls.map((e) => html`
        <${Wall} key=${e.id} edge=${e} title=${titles.get(FLICKER)} gone=${gone.has(e.id)}
                 picked=${edit.mode === "wall-gone" ? e.id === edit.target : !edit.mode && lit.has(e.id)} onPick=${onPick} />
      `)}
      ${passages.map((e) => html`
        <line key=${e.id} class="edge edge-new" ...${line(e)}><title>${editText(e)}</title></line>
      `)}
      ${a && b && html`<line class="edge-draft" ...${line({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })} />`}
      ${edit.spots.map((s, i) => html`<circle key=${i} class="map-spot" cx=${s.x} cy=${s.y} r="12" />`)}
      ${rooms.map((n) => html`
        <a key=${n.id} href=${roomHref(n.room)} class=${`map-room${n.room === active ? " active" : ""}`}
           data-room=${n.room} onClick=${(event) => {
             if (!edit.mode) return;
             event.preventDefault();
             if (edit.mode === "move") edit.onRoom(n.room);
           }}>
          <title>${tip(`${n.room}. ${names.get(n.room) ?? ""}`, at(n.room).map((t) => t.name).join(", "))}</title>
          <circle cx=${n.x} cy=${n.y} r=${n.room === active ? 36 : 26} />
          <text x=${n.x} y=${n.y}>${n.room}</text>
        </a>
      `)}
      ${rooms.flatMap((n) => at(n.room).map((t, i, here) => {
        const x = n.x + (i - (here.length - 1) / 2) * TOKEN_GAP;
        const y = n.y + TOKEN_DROP;
        const on = edit.mode === "move" && edit.target === t.id;
        return html`
          <g key=${t.id} class=${`token token-${t.kind}${on ? " picked" : ""}`} data-token=${t.id}
             onClick=${(event) => { event.stopPropagation(); edit.onToken(t.id); }}>
            <title>${t.name}${on ? " — выбран: щёлкните по комнате" : ""}</title>
            <circle cx=${x} cy=${y} r="20" />
            <text x=${x} y=${y}>${initials(t.name)}</text>
          </g>
        `;
      }))}
    </svg>
  `;
}

function run(promise, onError) {
  promise.then(() => onError(null), (e) => onError(e.message));
}

// Walls whose event is on its way: a quick second click does not roll twice.
const pending = new Set();
function send(type, data, ids, onError) {
  if (ids.some((id) => pending.has(id))) return;
  ids.forEach((id) => pending.add(id));
  run(dispatch(type, data).finally(() => ids.forEach((id) => pending.delete(id))), onError);
}

// The rooms on both sides of a passage, "16 — 4", or null.
function sidesText(map, edge) {
  const sides = sidesOf(map, edge);
  return sides.length ? sides.join(" — ") : null;
}

// The number of a passage in the column: a click shows it on the map, a
// second click takes the halo off; with Shift a wall joins the picked ones.
function PassageName({ edge, map, picked, onPick }) {
  const where = sidesText(map, edge);
  return html`
    <button class=${`wall-id${picked ? " on" : ""}`} aria-pressed=${picked} title="Показать на карте"
            onClick=${(e) => onPick(picked && !e.shiftKey ? null : edge.id, e.shiftKey)}>№ ${edge.id}</button>
    ${where && html`<span class="muted">${where}</span>`}
  `;
}

// The row of the passage picked on the map scrolls into the column.
function useIntoView(picked) {
  const row = useRef(null);
  useEffect(() => { if (picked) row.current?.scrollIntoView({ block: "nearest" }); }, [picked]);
  return row;
}

// The state of a wall in words (the popup) and its controls (the popup and
// the row of the column): the state is the lit button, "существует" or
// "отсутствует"; a stale one stays lit but faded, and "бросить" is lit
// while a roll is due.
function WallWord({ id, stable }) {
  const wall = useStore(() => wallState(id));
  return html`<span class="wall-word">${wallWord(wall)}${stable && !needsRoll(wall) ? ", навсегда" : ""}</span>`;
}

function WallControls({ id, stable, onError }) {
  const wall = useStore(() => wallState(id));
  const due = needsRoll(wall);
  const on = wall.stale ? " on stale" : " on";
  const roll = () => {
    if (needsRoll(wallState(id))) send("wall-roll", rollWalls([id]), [id], onError);
  };
  const set = (exists) => send("wall-set", { id, exists }, [id], onError);
  const hint = stable ? "Стены стабилизированы: на виду они или нет, уже не важно"
    : "Стена на виду не меняется, сколько бы ходов ни прошло";
  return html`
    <div class="row">
      <button class=${`small${due ? " due" : ""}`} disabled=${!due} onClick=${roll}
              title=${due ? "Бросок 50%" : "Состояние известно до следующей границы хода не на виду"}>бросить</button>
      <button class=${`small${wall.exists === true ? on : ""}`} aria-pressed=${wall.exists === true}
              title="Задать руками: например, бросок настоящим кубиком"
              onClick=${() => set(true)}>существует</button>
      <button class=${`small${wall.exists === false ? on : ""}`} aria-pressed=${wall.exists === false}
              title="Задать руками; и если её объём занят — там стена не появляется" onClick=${() => set(false)}>отсутствует</button>
      <label title=${hint}>
        <input type="checkbox" checked=${wall.seen} disabled=${stable}
               onChange=${(e) => send("wall-seen", { list: [id], seen: e.target.checked }, [id], onError)} />
        на виду
      </label>
    </div>
  `;
}

const GONE_WORD = "убрана навсегда — правка карты";

// Pointer over a row of the column: the passage gets a halo on the map.
const hoverOf = (id, onHover) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null) });

// One wall in the column.
function WallRow({ edge, map, stable, gone, picked, onPick, onHover, onError }) {
  const { id } = edge;
  const wall = useStore(() => wallState(id));
  const row = useIntoView(picked);
  const name = html`<${PassageName} edge=${edge} map=${map} picked=${picked} onPick=${onPick} />`;
  if (gone) {
    return html`
      <div class="map-side-row wall-row wall-gone" ref=${row} ...${hoverOf(id, onHover)}>
        <div class="row">${name}<span class="wall-word">${GONE_WORD}</span></div>
      </div>`;
  }
  return html`
    <div class=${`map-side-row wall-row ${wallClass(wall, false)}`} ref=${row} ...${hoverOf(id, onHover)}>
      <div class="row">${name}</div>
      <${WallControls} id=${id} stable=${stable} onError=${onError} />
    </div>
  `;
}

// The rules of the walls: the section above the one the sheet field names
// as its source (P5, 6.8 -> P5, 6), so no section key is written here.
function rulesOf(canon, field) {
  const m = field?.source?.match(/\]\(([^)#]*)#([^)]*)\)/);
  const doc = m && canon.byFile.get(decode(m[1]));
  const section = doc?.sections.find((sec) => sec.key === decode(m[2]));
  return section ? { doc: doc.id, key: section.parent ?? section.key } : null;
}

const NO_WALL = { exists: null, stale: false, seen: false };

function Walls({ canon, map, picked, onPick, onHover }) {
  const [error, setError] = useState(null);
  const state = useStore(() => getState().walls);
  const { gone } = editsOf(useStore(() => mapEdits()));
  const all = wallsOf(map);
  if (!all.length) return html`<p class="muted">На графе нет Мерцающих стен.</p>`;
  const walls = all.filter((w) => !gone.has(w.id));
  const stable = wallsStable();
  const group = canon.state?.groups.find((g) => g.fields.some((f) => f.key === STABLE));
  const field = group?.fields.find((f) => f.key === STABLE);
  const rules = rulesOf(canon, field);
  const of = (id) => state?.walls[id] ?? NO_WALL;
  const due = walls.filter((w) => needsRoll(of(w.id))).map((w) => w.id);
  const seen = walls.filter((w) => of(w.id).seen).map((w) => w.id);
  const count = (exists) => walls.filter((w) => of(w.id).exists === exists && !of(w.id).stale).length;
  return html`
    <section class="card map-walls">
      <h2>Мерцающие стены <span class="muted">${all.length}</span></h2>
      <p class="muted">
        ${stable
          ? "Стабилизированы: ходы стены больше не меняют. Неопределённая стена бросается ещё один раз, и это её состояние навсегда."
          : "Граница хода, которую стена провела не на виду у группы, требует нового броска 50%; стена на виду держит своё состояние."}
        ${rules && html` <a href=${sectionHref(rules.doc, rules.key)}>Правила</a>`}
      </p>
      ${field
        ? html`<${Group} canon=${canon} group=${group} fields=${[field]} onError=${setError} />`
        : html`<p class="bad">В листе П2 нет поля ${STABLE}.</p>`}
      <p>
        существует ${count(true)} · отсутствует ${count(false)} · нужен бросок ${due.length}${!stable && ` · на виду ${seen.length}`}${gone.size > 0 && ` · убрано навсегда ${gone.size}`}
      </p>
      <div class="row">
        <button disabled=${!due.length} onClick=${() => send("wall-roll", rollWalls(due), due, setError)}>
          Бросить все нужные${due.length ? ` (${due.length})` : ""}
        </button>
        ${!stable && html`
          <button disabled=${!seen.length} onClick=${() => send("wall-seen", { list: seen, seen: false }, seen, setError)}>
            Снять «на виду» со всех
          </button>`}
      </div>
      ${error && html`<p class="bad">${error}</p>`}
      ${all.map((w) => html`
        <${WallRow} key=${w.id} edge=${w} map=${map} stable=${stable} gone=${gone.has(w.id)}
                    picked=${picked.has(w.id)} onPick=${onPick} onHover=${onHover} onError=${setError} />`)}
    </section>
  `;
}

// The "found" mark of a secret door: in its row and in the popup on the map.
function SecretMark({ edge, map, onError }) {
  const found = useStore(() => secretFound(edge.id));
  const mark = (e) => {
    const data = { id: edge.id, found: e.target.checked, label: edgeLabel(map, edge) };
    send("secret-found", data, [edge.id], onError);
  };
  return html`
    <label title="Группа нашла дверь: скрытая проверка Восприятия или описанное действие (П3, раздел 5)">
      <input type="checkbox" checked=${found} onChange=${mark} />
      найдена
    </label>
  `;
}

function SecretRow({ edge, map, picked, onPick, onHover, onError }) {
  const found = useStore(() => secretFound(edge.id));
  const row = useIntoView(picked);
  return html`
    <div class=${`map-side-row row${found ? "" : " secret-hidden"}`} ref=${row} ...${hoverOf(edge.id, onHover)}>
      <${PassageName} edge=${edge} map=${map} picked=${picked} onPick=${onPick} />
      <${SecretMark} edge=${edge} map=${map} onError=${onError} />
    </div>
  `;
}

function Secrets({ map, picked, onPick, onHover }) {
  const [error, setError] = useState(null);
  const doors = secretsOf(map);
  if (!doors.length) return null;
  return html`
    <section class="card map-secrets">
      <h2>Потайные двери <span class="muted">${doors.length}</span></h2>
      ${doors.map((e) => html`
        <${SecretRow} key=${e.id} edge=${e} map=${map} picked=${picked.has(e.id)} onPick=${onPick} onHover=${onHover}
                      onError=${setError} />`)}
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

// Locked and special passages: no state of their own, only where they are.
const OTHER = ["locked", "special"];
// The passages of the column other than the walls: a click on the map opens them.
const COLUMN = [SECRET, ...OTHER];

// "Особый (лифт, портал, ...)" -> "Особый": the list in brackets is the legend's.
const shortTitle = (map, type) => map.types.find((t) => t.id === type)?.title.replace(/\s*\(.*\)$/, "") ?? type;

function OtherRow({ edge, map, title, picked, onPick, onHover }) {
  const row = useIntoView(picked);
  return html`
    <div class="map-side-row row" ref=${row} ...${hoverOf(edge.id, onHover)}>
      <${PassageName} edge=${edge} map=${map} picked=${picked} onPick=${onPick} />
      <span>${title}</span>
    </div>
  `;
}

function Others({ map, picked, onPick, onHover }) {
  const edges = map.edges.filter((e) => OTHER.includes(e.type));
  if (!edges.length) return null;
  return html`
    <section class="card map-others">
      <h2>Запертые и особые <span class="muted">${edges.length}</span></h2>
      ${edges.map((e) => html`
        <${OtherRow} key=${e.id} edge=${e} map=${map} title=${shortTitle(map, e.type)} picked=${picked.has(e.id)}
                     onPick=${onPick} onHover=${onHover} />`)}
    </section>
  `;
}

const POPUP_GAP = 10;

// Where the popup stands in the map's frame: beside the point clicked, to the
// right and below if it fits, otherwise to the left or above, and kept inside
// the frame. A popup taller than the frame hangs below it.
function place(at, size, frame) {
  const after = at + POPUP_GAP;
  const start = after + size <= frame ? after : at - POPUP_GAP - size;
  return Math.max(0, Math.min(start, frame - size));
}

// The popup of a passage on the map, at the point clicked: { id, x, y } in
// the graph's coordinates. It is measured after every draw, as its width
// follows the state it shows.
// onEdit(kind, id): a change of the map with this passage as its target.
function PassagePopup({ map, popup, onClose, onEdit }) {
  const [error, setError] = useState(null);
  const box = useRef(null);
  useLayoutEffect(() => {
    const el = box.current;
    const frame = el?.offsetParent;
    if (!frame) return;
    const [left, top, width, height] = map.box;
    const x = ((popup.x - left) / width) * frame.clientWidth;
    const y = ((popup.y - top) / height) * frame.clientHeight;
    el.style.left = `${place(x, el.offsetWidth, frame.clientWidth)}px`;
    el.style.top = `${place(y, el.offsetHeight, frame.clientHeight)}px`;
  });
  const { gone, closed } = editsOf(useStore(() => mapEdits()));
  const stable = useStore(() => wallsStable());
  const edge = map.edges.find((e) => e.id === popup.id);
  if (!edge) return null;
  let body;
  if (edge.type === FLICKER && gone.has(edge.id)) body = html`<p class="wall-word">${GONE_WORD}</p>`;
  else if (edge.type === FLICKER) {
    body = html`
      <p><${WallWord} id=${edge.id} stable=${stable} /></p>
      <${WallControls} id=${edge.id} stable=${stable} onError=${setError} />`;
  } else if (edge.type === SECRET) body = html`<${SecretMark} edge=${edge} map=${map} onError=${setError} />`;
  else body = html`<p class="muted">${shortTitle(map, edge.type)}: своего состояния нет.</p>`;
  const change = edge.type === FLICKER
    ? !gone.has(edge.id) && ["wall-gone", "убрать навсегда…"]
    : !closed.has(edge.id) && ["closed", "закрыть переход…"];
  return html`
    <div class="map-popup" ref=${box} role="dialog" aria-label=${edgeLabel(map, edge)}>
      <div class="map-popup-head">
        <strong>${edgeLabel(map, edge)}</strong>
        <button class="small" title="Закрыть (Esc)" onClick=${onClose}>×</button>
      </div>
      ${body}
      ${change && html`
        <div class="row">
          <button class="small" title="Правка карты с этой целью: причина и заметка — в колонке"
                  onClick=${() => onEdit(change[0], edge.id)}>${change[1]}</button>
        </div>`}
      ${error && html`<p class="bad">${error}</p>`}
    </div>
  `;
}

// Several flicker walls picked with Shift: their marks at once, one event
// each action. Walls gone for good are left out.
function WallGroup({ map, ids, onClear }) {
  const [error, setError] = useState(null);
  const state = useStore(() => getState().walls);
  const { gone } = editsOf(useStore(() => mapEdits()));
  const stable = useStore(() => wallsStable());
  const walls = ids.filter((id) => !gone.has(id));
  if (ids.length < 2) return null;
  const of = (id) => state?.walls[id] ?? NO_WALL;
  const due = walls.filter((id) => needsRoll(of(id)));
  const seen = (on) => walls.filter((id) => of(id).seen !== on);
  const mark = (on) => send("wall-seen", { list: seen(on), seen: on }, seen(on), setError);
  const hint = "Щелчок с Shift по стене добавляет её к выбранным или убирает";
  return html`
    <div class="map-wall-group" title=${hint}>
      <div class="row">
        <strong>Выбрано стен: ${ids.length}</strong>
        <button class="small" onClick=${onClear}>снять выбор</button>
      </div>
      <div class="row">
        <button class="small" disabled=${stable || !seen(true).length} onClick=${() => mark(true)}>на виду</button>
        <button class="small" disabled=${stable || !seen(false).length} onClick=${() => mark(false)}>не на виду</button>
        <button class="small" disabled=${!due.length} onClick=${() => send("wall-roll", rollWalls(due), due, setError)}>
          бросить нужные${due.length ? ` (${due.length})` : ""}
        </button>
      </div>
      ${error && html`<p class="bad">${error}</p>`}
    </div>
  `;
}

function ShipMap({ canon, map, active, unknown }) {
  const [hidden, setHidden] = useState(() => new Set(HIDDEN_AT_START));
  // The picked passages: one by a click, several flicker walls with Shift.
  const [picked, setPicked] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const [popup, setPopup] = useState(null);
  const [photoShown, setPhotoShown] = useState(true);
  const [photoLevel, setPhotoLevel] = useState(PHOTO_LEVELS.start);
  const [mode, setMode] = useState(null);
  const [target, setTarget] = useState(null);
  const [spots, setSpots] = useState([]);
  useEffect(() => { setTitle(active ? `Карта — комната ${active}` : "Карта"); }, [active]);
  // A mode of the map takes the clicks: the popup goes.
  useEffect(() => { if (mode) setPopup(null); }, [mode]);
  // Escape closes the popup, and without one drops the pick.
  useEffect(() => {
    if (!popup && !picked.size) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (popup) setPopup(null);
      else setPicked(new Set());
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [popup, picked]);
  const reset = () => { setTarget(null); setSpots([]); };
  // A change started from the popup: its mode with the passage as the target.
  const startEdit = (kind, id) => {
    setMode(kind);
    setSpots([]);
    setTarget(id);
  };
  const edits = useStore(() => mapEdits());
  const walls = new Set(wallsOf(map).map((w) => w.id));
  // Shift on a flicker wall: it joins the picked walls or leaves them, and
  // the popup goes; a passage of another kind is picked alone.
  const toggle = (id) => {
    setPopup(null);
    setPicked((p) => {
      const next = new Set([...p].filter((x) => walls.has(x)));
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };
  // A passage clicked on the map: picked alone, its popup opens; a second
  // click on it closes the popup.
  const open = (id, point, shift) => {
    if (shift && walls.has(id)) return toggle(id);
    setPicked(new Set([id]));
    setPopup((p) => (p?.id === id ? null : { id, ...point }));
  };
  // A pick in the column keeps the popup only if it is that passage's.
  const pick = (id, shift) => {
    if (shift && walls.has(id)) return toggle(id);
    setPicked(new Set(id === null ? [] : [id]));
    setPopup((p) => (p?.id === id ? p : null));
  };
  // Without a mode a click on a wall opens it; in the mode "wall-gone" it
  // picks the target of the change, in the others nothing.
  const onWall = (id, point, shift) => {
    if (!mode) return open(id, point, shift);
    if (mode === "wall-gone" && !edits.some((e) => e.kind === "wall-gone" && e.edge === id)) setTarget(id);
  };
  // A third spot starts a new passage.
  const onSpot = (x, y) => setSpots((s) => [...(s.length >= 2 ? [] : s), snap(map, x, y)]);
  // A token: a click picks it to move (a second click drops it), a room then takes it.
  const onToken = (id) => {
    reset();
    if (mode === "move" && target === id) return setMode(null);
    setMode("move");
    setTarget(id);
  };
  const onRoom = (room) => {
    const token = tokensOf(canon).find((t) => t.id === target);
    if (token) move(token, room, (message) => message && alert(message));
    setMode(null);
    reset();
  };
  const edit = { mode, target, spots, onEdge: setTarget, onSpot, onToken, onRoom };
  const toggleLayer = (id) => setHidden((h) => {
    const next = new Set(h);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const [, , width, height] = map.box;
  const lit = new Set([...picked, hover].filter((id) => id !== null));
  const group = [...picked].filter((id) => walls.has(id));
  return html`
    <section class="page map-page">
      <div class="map-stage" style=${{ "--map-ratio": `${width} / ${height}` }}>
        <div class="map-view">
          <${Graph} canon=${canon} map=${map} hidden=${hidden} active=${active} lit=${lit}
                    onPick=${onWall} onPassage=${open} onBlank=${() => { setPopup(null); setPicked(new Set()); }} edit=${edit}
                    photo=${map.photo && photoShown ? photoLevel : null} />
          ${popup && html`<${PassagePopup} map=${map} popup=${popup} onClose=${() => setPopup(null)} onEdit=${startEdit} />`}
        </div>
        <div class="map-side">
          <h1>Карта Корабля</h1>
          ${unknown && html`<p class="bad">Комнаты «${unknown}» на карте нет.</p>`}
          <div class="map-side-top">
            <${EditBar} canon=${canon} map=${map} mode=${mode} setMode=${setMode} target=${target} spots=${spots} onReset=${reset} />
            <${WallGroup} map=${map} ids=${group} onClear=${() => setPicked(new Set())} />
          </div>
          <${Walls} canon=${canon} map=${map} picked=${picked} onPick=${pick} onHover=${setHover} />
          <${Secrets} map=${map} picked=${picked} onPick=${pick} onHover=${setHover} />
          <${Others} map=${map} picked=${picked} onPick=${pick} onHover=${setHover} />
          <${EditList} />
        </div>
      </div>
      <p class="muted">
        ${map.doc && html`<a href=${sectionHref(map.doc, map.key)}>Граф карты</a>: `}
        кружки — комнаты, линии — переходы. Щелчок по комнате открывает её страницу,
        щелчок по Мерцающей стене или потайной двери открывает её состояние, щелчок с Shift выбирает несколько стен;
        значки под комнатами — токены.
      </p>
      <${Layers} types=${map.types} hidden=${hidden} onToggle=${toggleLayer} />
      <${PhotoLayer} photo=${map.photo} shown=${photoShown} setShown=${setPhotoShown} level=${photoLevel} setLevel=${setPhotoLevel} />
      <${WallLegend} />
      <${TokenPanel} canon=${canon} map=${map} picked=${mode === "move" ? target : null} onPick=${onToken} />
    </section>
  `;
}

export function MapPage({ rest }) {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Карта" error=${error} />`;
  if (!canon.map) {
    return html`
      <section class="page">
        <h1>Карта Корабля</h1>
        <p class="bad">Карты нет: сборщик не смог прочитать граф. <a href="#/tools/build-report">Отчёт сборщика</a></p>
      </section>
    `;
  }
  const id = decode(rest);
  const onMap = /^\d+$/.test(id) && canon.map.nodes.some((n) => n.room === Number(id));
  const active = onMap ? Number(id) : null;
  return html`<${ShipMap} canon=${canon} map=${canon.map} active=${active} unknown=${!onMap && id ? id : null} />`;
}
