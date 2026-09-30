import { html, useEffect, useLayoutEffect, useRef, useState } from "../vendor/htm-preact.js";
import { sectionHref, useCanon } from "../canon.js";
import { defineSlice, dispatch, getState, useStore } from "../store.js";
import { CanonState, fold, setTitle } from "../card.js";
import { MEASURE, Masonry } from "../masonry.js";
import { EDITS_FIELD, editText, mapEdits } from "../map_edits.js";
import { mapHref } from "./map.js";
import { DOUBLES_FIELD } from "../doubles.js";
import { DoublesSummary } from "./doubles.js";

// World state (canon.state, parsed by tools/site_state.py from the GM's sheet
// of P2): the sheet's groups with a control for each field by its kind — a
// choice of variants, a number (with its limit), a short or long note.
//
// A field starts at its canon value (field.start, from "Исходное состояние
// Корабля" in P2) or empty. What the party changed is party state: the event
// "world-set" { field, value } sets it, value null drops the change and the
// field is back at its start, so undo, the journal and every window follow.
// Setting a field to its start value drops the change too, and "" is a note
// deliberately emptied. A field is keyed by its schema key "ГРУППА · Поле";
// values whose field the canon no longer has are listed at the bottom, so a
// renamed field loses nothing unseen. Notes and numbers are sent when the
// field is left (or on Enter), not on every key, so the journal gets one entry
// per change. The room pages show a room's fields with the same Group panels.
// Under the field EDITS_FIELD the changes of the ship map are listed: the map
// keeps them (site/map_edits.js), the note is for what the graph cannot show.
// Under DOUBLES_FIELD the registry of temporal doubles is summed up the same
// way (site/doubles.js); the note keeps what old saves wrote there.

defineSlice("world", () => ({}), {
  "world-set": (world, data) => {
    if (data.value === null) delete world[data.field];
    else world[data.field] = data.value;
  },
});

export function worldHref() {
  return "#/game/world";
}

// How the journal writes a value.
export function worldValue(value) {
  if (value === null) return "как на старте";
  if (value === "") return "пусто";
  const text = String(value).replace(/\s+/g, " ");
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

// The party's change of a field, or null when the field is at its start.
const changeOf = (key) => getState().world?.[key] ?? null;
const plain = (markdown) => markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

// Values sent but not yet back from the server: a quick second click compares
// against them, not against the state that has not caught up.
const pending = new Map();

// field: { key, start }; value null goes back to the start.
function set(field, value, onError) {
  const next = value === field.start ? null : value;
  if (next === (pending.has(field.key) ? pending.get(field.key) : changeOf(field.key))) return;
  pending.set(field.key, next);
  dispatch("world-set", { field: field.key, value: next })
    .catch((e) => onError(e.message))
    .finally(() => { if (pending.get(field.key) === next) pending.delete(field.key); });
}

// Clicking the marked variant drops the change: back to the start, or unmarked.
function Choice({ field, value, onError }) {
  const hint = (o) => (o !== value ? "" : field.start === null ? "Щелчок снимает отметку"
    : o === field.start ? "Так на старте" : "Щелчок возвращает исходное");
  return html`
    <div class="choice" role="group" aria-label=${field.label ?? field.key}>
      ${field.options.map((o) => html`
        <button key=${o} class=${`small${o === value ? " on" : ""}`} aria-pressed=${o === value}
                title=${hint(o)} onClick=${() => set(field, o === value ? null : o, onError)}>${o}</button>
      `)}
    </div>
  `;
}

// A note as tall as its text: one line when empty, otherwise as many lines
// as the text takes, wrapped ones included. It is measured again when the
// text changes, when the panel changes width (the text rewraps) and before
// the panels are laid out.
function Note({ field, props }) {
  const box = useRef(null);
  const width = useRef(0);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  useLayoutEffect(fit, [props.value]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w !== width.current) { width.current = w; fit(); }
    });
    observer.observe(box.current);
    document.addEventListener(MEASURE, fit);
    return () => { observer.disconnect(); document.removeEventListener(MEASURE, fit); };
  }, []);
  // A short note is one paragraph: a pasted line break becomes a space.
  const onInput = field.long ? props.onInput
    : (e) => props.onInput({ target: { value: e.target.value.replace(/\s*\n\s*/g, " ") } });
  return html`
    <textarea ref=${box} rows="1" class=${field.long ? "long" : "short"}
              placeholder=${field.long ? "Ctrl+Enter — записать" : ""} ...${props} onInput=${onInput} />
  `;
}

// A number or a note: a local draft while the field has focus, sent on leave
// by `save` (field, value, onError) — a sheet field by default; the room notes
// give their own.
export function Entry({ field, value, onError, save = set }) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const editing = useRef(false);
  const cancel = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(shown); }, [shown]);

  const commit = () => {
    editing.current = false;
    if (cancel.current) {
      cancel.current = false;
      setDraft(shown);
      return;
    }
    if (field.kind !== "number") {
      // An emptied note stays empty even when the canon gives it a start.
      save(field, draft.trim() ? draft.replace(/\s+$/, "") : field.start === null ? null : "", onError);
      return;
    }
    if (!draft.trim()) return save(field, null, onError);
    const n = Math.round(Number(draft));
    if (!Number.isFinite(n)) return setDraft(shown);
    const clamped = Math.max(0, field.max === null ? n : Math.min(n, field.max));
    setDraft(String(clamped));
    save(field, clamped, onError);
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") { cancel.current = true; e.target.blur(); }
    else if (e.key === "Enter" && !(field.long && !e.ctrlKey)) { e.preventDefault(); e.target.blur(); }
  };
  const props = {
    value: draft,
    "aria-label": field.label ?? field.key,
    onFocus: () => { editing.current = true; },
    onInput: (e) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown,
  };
  if (field.kind === "number") {
    return html`
      <span class="number">
        <input type="number" min="0" max=${field.max ?? undefined} step="1" ...${props} />
        ${field.max !== null && html`<span class="muted">/ ${field.max}</span>`}
      </span>
    `;
  }
  return html`<${Note} field=${field} props=${props} />`;
}

function MapEdits() {
  const edits = useStore(() => mapEdits());
  return html`
    <div class="map-edits-note muted">
      <a href=${mapHref()}>На карте</a>: ${edits.length ? `правок ${edits.length}` : "правок нет"}
      ${edits.map((e) => html`<div key=${e.id}>${editText(e)}</div>`)}
    </div>
  `;
}

function Field({ field, onError }) {
  const change = useStore(() => changeOf(field.key));
  const value = change ?? field.start;
  const changed = change !== null;
  const wide = field.kind === "text" && field.long;
  const Control = field.kind === "choice" ? Choice : Entry;
  const start = field.start === null ? null : `На старте: ${worldValue(field.start)} · ${plain(field.source ?? "")}`;
  const state = changed ? " set" : field.start !== null ? " initial" : "";
  return html`
    <div class=${`field${wide ? " wide" : ""}${state}`}>
      ${field.label && html`<label title=${start ?? ""}>${field.label}</label>`}
      <${Control} field=${field} value=${value} onError=${onError} />
      ${changed && field.start !== null && html`
        <button class="small reset" title=${start} onClick=${() => set(field, null, onError)}>исходное</button>`}
      ${field.key === EDITS_FIELD && html`<${MapEdits} />`}
      ${field.key === DOUBLES_FIELD && html`<${DoublesSummary} />`}
    </div>
  `;
}

export function Group({ canon, group, fields, onError }) {
  return html`
    <section class="card world-group">
      <header>
        <h2>${group.title}</h2>
        <span class="more">
          ${group.more.map((m) => html`
            <a key=${m.key} href=${sectionHref(m.doc, m.key)} title=${m.key}>
              ${canon.byId.get(m.doc).short.split(".")[0]}, ${m.key.split(" ")[0].replace(/\.$/, "")}
            </a>
          `)}
        </span>
      </header>
      ${fields.map((f) => html`<${Field} key=${f.key} field=${f} onError=${onError} />`)}
    </section>
  `;
}

// Values whose field is gone from the sheet: shown so they can be read and cleared.
function Orphans({ state, onError }) {
  const world = useStore(() => getState().world ?? {});
  const known = new Set(state.groups.flatMap((g) => g.fields.map((f) => f.key)));
  const orphans = Object.entries(world).filter(([key]) => !known.has(key));
  if (!orphans.length) return null;
  return html`
    <section class="card world-group">
      <h2 class="bad">Поля, которых больше нет в листе</h2>
      <p class="muted">Поле переименовали или убрали в каноне; его значение осталось в сохранении.</p>
      ${orphans.map(([key, value]) => html`
        <div key=${key} class="row">
          <span>${key}: ${worldValue(value)}</span>
          <button class="small" onClick=${() => set({ key, start: null }, null, onError)}>Убрать</button>
        </div>
      `)}
    </section>
  `;
}

// A filter word matches a label or group title, and a number matches a room too.
function matches(group, field, words) {
  const text = fold(`${group.title} ${field.label ?? ""}`);
  return words.every((w) => text.includes(w) || (/^\d+$/.test(w) && field.rooms.includes(Number(w))));
}

function World({ canon }) {
  const [filter, setFilter] = useState("");
  const [error, setError] = useState(null);
  const state = canon.state;
  const world = useStore(() => getState().world ?? {});
  useEffect(() => { setTitle("Состояние мира"); }, []);
  const count = state.groups.reduce((n, g) => n + g.fields.filter((f) => f.key in world).length, 0);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const groups = state.groups
    .map((g) => ({ group: g, fields: g.fields.filter((f) => matches(g, f, words)) }))
    .filter((g) => g.fields.length);
  const total = state.groups.reduce((n, g) => n + g.fields.length, 0);
  return html`
    <section class="page world">
      <h1>Состояние мира</h1>
      <p class="muted">
        <a href=${sectionHref(state.doc, state.key)}>Лист состояния Мастера из П2</a>.
        Поля начинаются с ${state.start_key
          ? html`<a href=${sectionHref(state.doc, state.start_key)}>исходного состояния Корабля</a>`
          : "пустого листа"}, откуда значение — в подсказке у названия поля.
        Каждое изменение попадает в журнал и отменяется Ctrl+Z; записи и числа сохраняются,
        когда уходишь из поля или жмёшь Enter.
      </p>
      <div class="row">
        <input type="search" placeholder="Поле, группа или номер комнаты" value=${filter}
               onInput=${(e) => setFilter(e.target.value)} />
        <span class="muted">изменено ${count} из ${total}</span>
      </div>
      ${error && html`<p class="bad">${error}</p>`}
      <${Masonry} items=${groups.map(({ group, fields }) => ({
        key: group.title,
        node: html`<${Group} canon=${canon} group=${group} fields=${fields} onError=${setError} />`,
      }))} />
      ${groups.length === 0 && html`<p class="muted">Ничего не найдено.</p>`}
      <${Orphans} state=${state} onError=${setError} />
    </section>
  `;
}

export function WorldPage() {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Состояние мира" error=${error} />`;
  if (!canon.state) return html`<${CanonState} title="Состояние мира" error="Сборщик не нашёл лист состояния в П2." />`;
  return html`<${World} canon=${canon} />`;
}
