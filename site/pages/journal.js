import { html, useEffect, useRef, useState } from "../vendor/htm-preact.js";
import { defineSlice, dispatch, getLog, getState, getStatus, redoLast, undo, undoLast, useStore } from "../store.js";
import { worldValue } from "./world.js";
import { turnsText } from "../turns.js";
import { encounterText } from "../encounters.js";
import { sceneText } from "../scene.js";
import { wallText } from "../walls.js";
import { mapEditText } from "../map_edits.js";
import { tokenText } from "../tokens.js";
import { secretText } from "../secrets.js";
import { milestoneText } from "../milestones.js";
import { partyText } from "../party.js";
import { doubleText } from "../doubles.js";

// "Игра → Журнал": every event of the save, newest first, in words. The GM
// searches it, comments a row and undoes or brings back a row from here.
//
// Party state as events:
// - "note" { text }: a free Master note, a row of its own.
// - "journal-comment" { target, text }: the comment of row target; the last
//   one in force wins, text null takes it away. A comment belongs to its row
//   and is not a row itself; undoing it (Ctrl+Z too) brings the previous one.

defineSlice("notes", () => [], {
  note: (notes, data, event) => {
    notes.push({ seq: event.seq, text: data.text });
  },
});

defineSlice("comments", () => ({}), {
  "journal-comment": (comments, data) => {
    if (data.text === null) delete comments[data.target];
    else comments[data.target] = data.text;
  },
});

export function journalHref() {
  return "#/game/journal";
}

const PAGE = 100;

export function describe(event, bySeq) {
  if (event.type === "note") return `Заметка: ${event.data.text}`;
  if (event.type === "journal-comment") {
    const { target, text } = event.data;
    return text === null ? `Комментарий к записи ${target} убран` : `Комментарий к записи ${target}: ${text}`;
  }
  if (event.type === "item-layer") {
    const { name, row, known } = event.data;
    // The critical failure row is a false conclusion the players believe.
    const lie = row.startsWith("Критический провал");
    const what = known ? (lie ? "поверили ложному выводу" : "знают") : (lie ? "больше не верят ложному выводу" : "больше не знают");
    return `${name}: игроки ${what} «${row}»`;
  }
  if (event.type === "world-set") return `Состояние мира: ${event.data.field} — ${worldValue(event.data.value)}`;
  if (event.type === "turns") return turnsText(event.data);
  if (event.type === "clock-set") return event.data.at ? `Время суток: сейчас ${event.data.at}` : "Время суток снято";
  if (event.type === "room-note") {
    const { room, text } = event.data;
    return text === null ? `Комната ${room}: заметка убрана` : `Комната ${room}, заметка: ${worldValue(text)}`;
  }
  const text = encounterText(event.type, event.data)
    ?? sceneText(event.type, event.data)
    ?? wallText(event.type, event.data)
    ?? mapEditText(event.type, event.data)
    ?? tokenText(event.type, event.data)
    ?? secretText(event.type, event.data)
    ?? milestoneText(event.type, event.data)
    ?? partyText(event.type, event.data)
    ?? doubleText(event.type, event.data);
  if (text) return text;
  if (event.type === "undo") {
    const target = bySeq.get(event.data.target);
    if (!target) return `Отмена записи ${event.data.target}`;
    // An undo of an undo brings back what the first one cancelled.
    if (target.type === "undo") {
      const back = bySeq.get(target.data.target);
      return `Возврат записи ${target.data.target}${back ? `: ${describe(back, bySeq)}` : ""}`;
    }
    return `Отмена записи ${target.seq}: ${describe(target, bySeq)}`;
  }
  return `${event.type} ${JSON.stringify(event.data)}`;
}

function time(ts) {
  return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// Search ignores case and ё.
const fold = (s) => s.toLowerCase().replaceAll("ё", "е");

// The journal rows: every event but comments, newest first, each with its
// words, the exploration turn it came on, its comment and the live undo that
// cancels it (to bring it back). An undo row has no buttons of its own: its
// target row undoes and brings back.
function rowsOf(log, comments) {
  const bySeq = new Map(log.map((e) => [e.seq, e]));
  const undoneBy = new Map();
  for (const event of log) {
    if (event.type === "undo" && !event.cancelled) undoneBy.set(event.data.target, event.seq);
  }
  let turn = 0;
  const rows = [];
  for (const event of log) {
    if (event.type === "turns" && !event.cancelled) turn += event.data.count;
    if (event.type === "journal-comment") continue;
    const text = describe(event, bySeq);
    const comment = comments[event.seq] ?? null;
    rows.push({
      event, text, turn, comment,
      undoneBy: event.cancelled ? undoneBy.get(event.seq) ?? null : null,
      haystack: fold(`${event.seq} ${text} ${comment ?? ""}`),
    });
  }
  return rows.reverse();
}

function run(promise, onError) {
  promise?.catch((e) => onError(e.message));
}

function NoteForm({ onError }) {
  const [text, setText] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    run(dispatch("note", { text: value }).then(() => setText("")), onError);
  };
  return html`
    <form class="row" onSubmit=${submit}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder="Заметка в журнал" />
      <button type="submit">Записать</button>
    </form>
  `;
}

// The comment of a row: a draft while typing, sent on Enter or "сохранить";
// Escape leaves it as it was.
function CommentForm({ row, onDone, onError }) {
  const [text, setText] = useState(row.comment ?? "");
  const input = useRef(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e) => {
    e.preventDefault();
    const value = text.trim() || null;
    if (value !== row.comment) run(dispatch("journal-comment", { target: row.event.seq, text: value }), onError);
    onDone();
  };
  const onKeyDown = (e) => { if (e.key === "Escape") onDone(); };
  return html`
    <form class="row journal-comment-form" onSubmit=${submit}>
      <input ref=${input} value=${text} onInput=${(e) => setText(e.target.value)} onKeyDown=${onKeyDown}
             placeholder="Комментарий к записи ${row.event.seq}" />
      <button type="submit" class="small">сохранить</button>
      <button type="button" class="small" onClick=${onDone}>отмена</button>
    </form>
  `;
}

function Row({ row, onError }) {
  const [editing, setEditing] = useState(false);
  const { event } = row;
  const isUndo = event.type === "undo";
  return html`
    <li class=${event.cancelled ? "cancelled" : ""}>
      <span class="muted">${event.seq} · ход ${row.turn} · ${time(event.ts)}</span>
      <span class="what">${row.text}</span>
      ${!event.cancelled && !isUndo && html`
        <button class="small" onClick=${() => run(undo(event.seq), onError)}>отменить</button>
      `}
      ${row.undoneBy !== null && !isUndo && html`
        <button class="small" title="Отменяет отмену: запись снова в силе"
                onClick=${() => run(undo(row.undoneBy), onError)}>вернуть</button>
      `}
      ${!editing && html`
        <button class="small" onClick=${() => setEditing(true)}>${row.comment === null ? "комментарий" : "изменить"}</button>
      `}
      ${!editing && row.comment !== null && html`
        <div class="journal-comment">
          ${row.comment}
          <button class="small" onClick=${() => run(dispatch("journal-comment", { target: event.seq, text: null }), onError)}>убрать</button>
        </div>
      `}
      ${editing && html`<${CommentForm} row=${row} onDone=${() => setEditing(false)} onError=${onError} />`}
    </li>
  `;
}

export function JournalPage() {
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [showCancelled, setShowCancelled] = useState(true);
  const [onlyCommented, setOnlyCommented] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const log = useStore(getLog);
  const status = useStore(getStatus);
  const comments = useStore(() => getState().comments);

  const rows = rowsOf(log, comments);
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const found = rows.filter((r) =>
    (showCancelled || (!r.event.cancelled && r.event.type !== "undo"))
    && (!onlyCommented || r.comment !== null)
    && terms.every((t) => r.haystack.includes(t)));
  const shown = found.slice(0, limit);
  const filtered = found.length !== rows.length;
  const commentEvents = log.length - rows.length;

  const onError = (message) => setError(message);
  const filter = (set) => (value) => { set(value); setLimit(PAGE); };

  return html`
    <section class="page">
      <h1>Журнал</h1>
      <p class="muted">
        Все действия сайта по порядку, новые сверху. Отменённая запись остаётся в журнале зачёркнутой, и её можно вернуть.
        Ход — сколько ходов исследования прошло к этой записи.
      </p>
      ${!status.connected && html`<p class="bad">Нет связи с сервером. Действия не запишутся, пока сайт не запущен.</p>`}
      ${error && html`<p class="bad">${error}</p>`}
      <${NoteForm} onError=${onError} />
      <div class="row">
        <button disabled=${!status.canUndo} onClick=${() => run(undoLast(), onError)}>Отменить</button>
        <button disabled=${!status.canRedo} onClick=${() => run(redoLast(), onError)}>Вернуть</button>
        <span class="muted">Ctrl+Z / Ctrl+Shift+Z</span>
      </div>
      <div class="row">
        <input type="search" class="journal-search" value=${query} placeholder="Поиск по журналу и комментариям"
               onInput=${(e) => filter(setQuery)(e.target.value)} />
        <label><input type="checkbox" checked=${showCancelled}
                      onChange=${(e) => filter(setShowCancelled)(e.target.checked)} /> отменённые и отмены</label>
        <label><input type="checkbox" checked=${onlyCommented}
                      onChange=${(e) => filter(setOnlyCommented)(e.target.checked)} /> только с комментарием</label>
      </div>
      <p class="muted">
        ${filtered ? `Найдено ${found.length} из ${rows.length}.` : `Записей: ${rows.length}.`}
        ${commentEvents > 0 && ` Ещё ${commentEvents} — правки комментариев, они стоят при своих строках.`}
      </p>
      ${rows.length === 0 && html`<p class="muted">Записей пока нет.</p>`}
      <ol class="log journal">
        ${shown.map((row) => html`<${Row} key=${row.event.seq} row=${row} onError=${onError} />`)}
      </ol>
      ${found.length > shown.length && html`
        <button onClick=${() => setLimit(limit + PAGE)}>Показать ещё ${Math.min(PAGE, found.length - shown.length)}</button>
      `}
    </section>
  `;
}
