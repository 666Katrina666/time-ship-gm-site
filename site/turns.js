import { html, useEffect, useState } from "./vendor/htm-preact.js";
import { sectionHref, useCanon } from "./canon.js";
import { checksWord, dueOf, echoOf, placeHint } from "./encounters.js";
import { defineSlice, dispatch, getState, undo, useStore } from "./store.js";

// Turn tracker of the sidebar (P3, section 1): the GM marks an exploration
// turn when about 10 minutes of meaningful activity have passed; the tracker
// shows how many turns and how much time have gone by, the time of day and
// the time since the last rest.
//
// Party state as events:
// - "turns" { count, noisy, rest }: count turns pass. A noisy turn (P3,
//   section 9) is a single turn with noisy: true, and the random encounter
//   counter (site/encounters.js) moves one step further. rest: true is a long
//   rest (P3, section 4, topic 1.14 of the register): 48 ordinary turns, and
//   the time since rest starts again.
// - "clock-set" { start, at }: the time of day at turn 0, in minutes from
//   midnight of day 1 (the day the party arrives; it may be negative), or
//   null. The canon gives no hour, so the GM sets it; `at` is the time the GM
//   entered, for the journal.
//
// Under the buttons the tracker shows the random encounter checks due, which
// these turns bring (site/encounters.js), with a link to their page.

export const TURN_MINUTES = 10;
const HOUR = 60 / TURN_MINUTES;
const REST = 8 * HOUR;
const DAY = 24 * 60;

defineSlice("turns", () => ({ count: 0, restAt: null, start: null, last: null }), {
  turns: (t, data, event) => {
    t.count += data.count;
    if (data.rest) t.restAt = t.count;
    t.last = { seq: event.seq, ...data };
  },
  "clock-set": (t, data) => { t.start = data.start; },
});

// "2 ч 20 мин", "1 сут 3 ч", "0 мин".
export function duration(minutes) {
  const days = Math.floor(minutes / DAY);
  const hours = Math.floor((minutes % DAY) / 60);
  const mins = minutes % 60;
  const parts = [days && `${days} сут`, hours && `${hours} ч`, (mins || !(days || hours)) && `${mins} мин`];
  return parts.filter(Boolean).join(" ");
}

const pad = (n) => String(n).padStart(2, "0");
// "1 ход", "3 хода", "5 ходов", "21 ход".
export function turnsWord(n) {
  const [ten, one] = [n % 100, n % 10];
  if (ten >= 11 && ten <= 14) return "ходов";
  return one === 1 ? "ход" : one >= 2 && one <= 4 ? "хода" : "ходов";
}
const clockOf = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const mod = (n, m) => ((n % m) + m) % m;

// How the journal writes a "turns" event.
export function turnsText({ count, noisy, rest }) {
  if (rest) return `Отдых ${count / HOUR} ч (${count} ${turnsWord(count)})`;
  if (count === 1) return noisy ? "Ход исследования, шумный" : "Ход исследования";
  if (count === HOUR) return `Прошёл час (${HOUR} ${turnsWord(HOUR)})`;
  return `Прошло ${count} ${turnsWord(count)}`;
}

function pass(data, onError) {
  dispatch("turns", { count: 1, noisy: false, rest: false, ...data }).catch((e) => onError(e.message));
}

// The time of day, set by the GM: kept as the time at turn 0, so every
// later turn moves it on. A draft while typing, sent on leave or Enter.
function Clock({ t, onError }) {
  const now = t.start === null ? null : t.start + t.count * TURN_MINUTES;
  const shown = now === null ? "" : clockOf(mod(now, DAY));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  // The value is read from the field: a blur right after typing comes before the draft is rendered.
  const commit = (value) => {
    if (value === shown) return;
    if (!value) {
      dispatch("clock-set", { start: null, at: null }).catch((e) => onError(e.message));
      return;
    }
    const [h, m] = value.split(":").map(Number);
    // The day stays the same: only the hour and minute change.
    const day = now === null ? 0 : Math.floor(now / DAY);
    const start = day * DAY + h * 60 + m - t.count * TURN_MINUTES;
    dispatch("clock-set", { start, at: value }).catch((e) => onError(e.message));
  };
  return html`
    <div class="tracker-clock">
      ${now !== null && html`<span title="День 1 — день прихода партии">день ${Math.floor(now / DAY) + 1}</span>`}
      <input type="time" value=${draft} aria-label="Время суток" title="Время суток сейчас; в каноне его нет, его задаёт Мастер"
             onInput=${(e) => setDraft(e.target.value)} onBlur=${(e) => commit(e.target.value)}
             onKeyDown=${(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = shown; setDraft(shown); e.target.blur(); } }} />
    </div>
  `;
}

// "2 проверки к броску" when checks are due; the rolls are on the encounters page.
function Due() {
  const { canon } = useCanon();
  useStore(() => getState().encounters);
  if (!canon?.encounters || !canon.state) return null;
  const due = dueOf(canon);
  const echo = echoOf().due;
  if (!due && !echo) return null;
  return html`
    <p class="tracker-due">
      <a href="#/game/encounters">
        ${due ? `Встречи: ${due} ${checksWord(due)} к броску${echo ? ", первая — гарантированное эхо" : ""}` : "Встречи: ждёт гарантированное эхо"}
      </a>
    </p>
  `;
}

// A hint when the party's token and "группа вне Корабля" disagree (placeHint).
// It is here in the tracker, so every page shows it; the button sends the
// same event as the switch on the encounters page.
function PlaceHint() {
  const { canon } = useCanon();
  const [error, setError] = useState(null);
  useStore(() => getState().encounters);
  if (!canon?.rooms || !canon.state) return null;
  const hint = placeHint(canon);
  if (!hint) return null;
  const room = html`<a href=${`#/game/rooms/${hint.room.number}`}>${hint.room.number}. ${hint.room.title}</a>`;
  const send = () => dispatch("encounter-outside", { outside: hint.outside }).catch((e) => setError(e.message));
  return html`
    <p class="tracker-place">
      ${hint.outside
        ? html`${hint.name} на карте в ${room}: по П13 встречи Корабля здесь не проверяются.`
        : html`${hint.name} на карте в ${room}, внутри Корабля, а счётчик встреч стоит.`}${" "}
      <button class="small" onClick=${send}>${hint.outside ? "группа вне Корабля" : "группа вернулась в Корабль"}</button>
      ${error && html`<span class="bad"> ${error}</span>`}
    </p>
  `;
}

export function Tracker() {
  const t = useStore(() => getState().turns);
  const [error, setError] = useState(null);
  const since = t.restAt === null ? null : (t.count - t.restAt) * TURN_MINUTES;
  return html`
    <section class="tracker">
      <h2>
        Ходы
        <a class="muted" href=${sectionHref("p3", "1. Ход исследования")} title="П3, раздел 1">П3</a>
      </h2>
      <div class="tracker-count">
        <strong>${t.count}</strong>
        <span class="muted">${turnsWord(t.count)} · ${duration(t.count * TURN_MINUTES)}</span>
      </div>
      <${Clock} t=${t} onError=${setError} />
      <p class="muted tracker-rest">
        ${since === null ? "Долгого отдыха ещё не было" : `С отдыха: ${duration(since)}`}
      </p>
      <div class="tracker-buttons">
        <button title="Прошло около 10 минут значимой деятельности" onClick=${() => pass({}, setError)}>+1 ход</button>
        <button title="Ход с боем, взрывом, разбитой дверью и т. п.: счётчик встреч уходит на 1 дальше (П3, раздел 9)"
                onClick=${() => pass({ noisy: true }, setError)}>шумный ход</button>
        <button title=${`${HOUR} ${turnsWord(HOUR)}`} onClick=${() => pass({ count: HOUR }, setError)}>+1 час</button>
        <button title=${`${REST} обычных ${turnsWord(REST)} со счётчиком встреч (П3, раздел 4)`}
                onClick=${() => pass({ count: REST, rest: true }, setError)}>отдых 8 ч</button>
      </div>
      <${Due} />
      <${PlaceHint} />
      ${t.last && html`
        <p class="muted tracker-last">
          ${turnsText(t.last)}
          <button class="small" onClick=${() => undo(t.last.seq).catch((e) => setError(e.message))}>отменить</button>
        </p>`}
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}
