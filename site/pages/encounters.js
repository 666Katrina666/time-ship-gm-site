import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { sectionHref, useCanon } from "../canon.js";
import { dispatch, getState, undo, useStore } from "../store.js";
import { CanonState, Markdown, setTitle } from "../card.js";
import {
  CHECK_DIE, CULT_ROW, ECHO_ROW, ECHO_SHIFT, HIT, checksWord, dueOf, echoOf, frequency, happened, levelOf,
  rollCount, rollDie,
} from "../encounters.js";
import { creatureHref } from "./creatures.js";
import { itemHref } from "./items.js";
import { npcHref } from "./npcs.js";
import { roomHref } from "./rooms.js";
import { Group } from "./world.js";
import { addToScene, fromCard } from "../scene.js";
import { EchoArrival, EchoCheck } from "./yourselves.js";
import { CultBonus } from "./doubles.js";

// "Игра → Случайные встречи": the checks of P10, section 2, and the table of
// section 4.2 (canon.encounters). The state and the rules live in
// site/encounters.js. The GM either rolls on the site — the check die and the
// table die together — or types the dice rolled at the table; a check that
// did not come up 1 shows its table die greyed and does not count as a
// result. An encounter shows its card: composition rolled, variants, the
// cards of its related line and the sheet fields it names, in the same panels
// as the world state page.

function send(type, data, onError) {
  dispatch(type, data).catch((e) => onError(e.message));
}

// Up to `limit` checks, stopping at the first encounter; a due echo is the first check.
function rollChecks(canon, limit, onError) {
  const { period } = frequency(canon);
  const { level, die } = levelOf(canon);
  const base = { period, level, die, entered: false };
  if (echoOf().due) {
    send("encounter-check", { ...base, rolls: [{ check: null, row: ECHO_ROW }], count: null, echo: true }, onError);
    return;
  }
  const rolls = [];
  while (rolls.length < limit) {
    rolls.push({ check: rollDie(CHECK_DIE), row: rollDie(die) });
    if (rolls.at(-1).check === HIT) break;
  }
  const last = rolls.at(-1);
  const row = canon.encounters.rows.find((r) => r.number === last.row);
  const count = last.check === HIT && row ? rollCount(row.count) : null;
  send("encounter-check", { ...base, rolls, count, echo: false }, onError);
}

function Status({ canon, onError }) {
  // useStore re-renders on every change, the world state included.
  const e = useStore(() => getState().encounters);
  const freq = frequency(canon);
  const { level } = levelOf(canon);
  const due = dueOf(canon);
  const { doc, procedure, stop } = canon.encounters;
  return html`
    <section class="card encounter-status">
      <div class="row">
        <span>Уровень партии:</span>
        <div class="choice" role="group" aria-label="Уровень партии">
          ${canon.encounters.levels.map((l) => html`
            <button key=${l.level} class=${`small${l.level === level ? " on" : ""}`} aria-pressed=${l.level === level}
                    onClick=${() => l.level !== level && send("party-level", { level: l.level }, onError)}>
              ${l.level}-й · d${l.die}
            </button>
          `)}
        </div>
      </div>
      ${freq.missing.length > 0 && html`<p class="bad">В листе П2 нет полей: ${freq.missing.join(", ")}.</p>`}
      ${freq.stopped
        ? html`<p class="bad">Корабль отделён: процедура случайных встреч прекращена
            (<a href=${sectionHref(doc, stop)}>П10, раздел 18</a>).</p>`
        : html`<p>
            Проверка раз в <strong>${freq.period}</strong> хода: ${freq.reason}${" "}
            (<a href=${sectionHref(doc, procedure)}>П10, раздел 2</a>).
            Шумный ход — ещё шаг счётчика.
          </p>`}
      <div class="encounter-due">
        <strong>${due}</strong>
        <span>${checksWord(due)} к броску</span>
        <span class="muted">· в счётчике ${e.steps % freq.period} из ${freq.period}</span>
      </div>
      <div class="row">
        <button class=${`small${e.outside ? " on" : ""}`} aria-pressed=${e.outside}
                title="Вся группа вне Корабля, например в 41: ходы не двигают счётчик (П10, раздел 2)"
                onClick=${() => send("encounter-outside", { outside: !e.outside }, onError)}>группа вне Корабля</button>
        ${e.echo && html`
          <button class="small on" aria-pressed="true" title="Отметка из сохранения до подшага 19f: теперь эхо ставит «персонаж выбыл»"
                  onClick=${() => send("encounter-echo", { pending: false }, onError)}>ждёт гарантированное эхо</button>`}
      </div>
      <${EchoQueue} />
    </section>
  `;
}

// Who waits for the guaranteed echo (P6, 10.8): the queue of "персонаж выбыл".
function EchoQueue() {
  const echo = useStore(echoOf);
  if (echo.queue.length === 0) return null;
  return html`
    <p class="encounter-echo">
      <strong>Гарантированное эхо:</strong> ${echo.queue.map((q) => `${q.name} (выбыл на ходу ${q.turn})`).join(", ")}.
      ${echo.waiting
        ? html` <span class="muted">Снимка ${ECHO_SHIFT} ходов назад ещё нет: проверки идут как обычно, эхо придёт на первой проверке с ${ECHO_SHIFT}-го хода.</span>`
        : html` Ближайшая проверка — № ${ECHO_ROW} без броска${echo.queue.length > 1 ? ", по одному эху на проверку" : ""}.`}
    </p>
  `;
}

// The dice rolled at the table, typed in: one check at a time.
function Entered({ canon, due, onError }) {
  const { level, die } = levelOf(canon);
  const [check, setCheck] = useState("");
  const [row, setRow] = useState("");
  const [count, setCount] = useState("");
  const c = Number(check);
  const r = Number(row);
  const okCheck = Number.isInteger(c) && c >= 1 && c <= CHECK_DIE;
  const okRow = row === "" ? c !== HIT : Number.isInteger(r) && r >= 1 && r <= die;
  const okCount = count === "" || /^\d+$/.test(count);
  const ok = due > 0 && okCheck && okRow && okCount && !echoOf().due;
  const submit = (e) => {
    e.preventDefault();
    if (!ok) return;
    const hit = c === HIT;
    send("encounter-check", {
      period: frequency(canon).period, level, die, entered: true, echo: false,
      rolls: [{ check: c, row: row === "" ? null : r }], count: hit && count !== "" ? Number(count) : null,
    }, onError);
    setCheck(""); setRow(""); setCount("");
  };
  return html`
    <form class="row encounter-entered" onSubmit=${submit}>
      <span class="muted">Бросали сами:</span>
      <label>d${CHECK_DIE} <input type="number" min="1" max=${CHECK_DIE} value=${check} onInput=${(e) => setCheck(e.target.value)} /></label>
      <label>d${die} <input type="number" min="1" max=${die} value=${row} onInput=${(e) => setRow(e.target.value)} /></label>
      <label title="Если не бросали — оставьте пустым">состав <input type="number" min="0" value=${count} onInput=${(e) => setCount(e.target.value)} /></label>
      <button type="submit" disabled=${!ok}>записать</button>
    </form>
  `;
}

function Roll({ canon, onError }) {
  const echo = useStore(() => echoOf().due);
  const due = dueOf(canon);
  return html`
    <section class="card">
      <div class="row">
        <button disabled=${due === 0} onClick=${() => rollChecks(canon, 1, onError)}
                title=${`d${CHECK_DIE} проверки и кубик таблицы вместе`}>
          ${echo ? "гарантированное эхо" : "бросить проверку"}
        </button>
        ${due > 1 && !echo && html`
          <button onClick=${() => rollChecks(canon, due, onError)}
                  title="Проверки по порядку, пока не выпадет встреча">бросать до встречи (${due})</button>`}
        ${due === 0 && html`<span class="muted">Проверок к броску нет.</span>`}
      </div>
      <${Entered} canon=${canon} due=${due} onError=${onError} />
    </section>
  `;
}

function CardLinks({ canon, row }) {
  const find = (list, id) => list.find((c) => c.id === id);
  const parts = [
    ...row.npcs.map((id) => find(canon.npcs, id)).filter(Boolean).map((n) => html`<a href=${npcHref(n.id)}>${n.name}</a>`),
    ...row.items.map((id) => find(canon.items, id)).filter(Boolean).map((i) => html`<a href=${itemHref(i.id)}>${i.name}</a>`),
    ...row.rooms.map((n) => html`<a href=${roomHref(n)}>комната ${n}</a>`),
  ];
  return parts.length > 0 && html`<p class="encounter-links"><span class="muted">Ещё:</span> ${parts.map((p, i) => html`<span key=${i}>${p}</span>`)}</p>`;
}

function Creatures({ canon, ids }) {
  const list = ids.map((id) => canon.creatures.find((c) => c.id === id)).filter(Boolean);
  const add = () => addToScene(list.map((c) => fromCard("creature", c))).catch((e) => alert(e.message));
  return html`
    ${list.map((c, i) => html`${i > 0 && ", "}<a href=${creatureHref(c.id)}>${c.name}</a> <span class="muted">${c.level}</span>`)}
    ${list.length > 0 && html` <button class="small" title="По одному экземпляру каждого; ещё — на странице «Сцена»" onClick=${add}>в сцену</button>`}
  `;
}

// The row that came up: what the card needs at the table, the card itself one click away.
function Encounter({ canon, row, count, onError }) {
  const doc = canon.byId.get(canon.encounters.doc);
  const groups = canon.state.groups
    .map((g) => ({ group: g, fields: g.fields.filter((f) => row.fields.includes(f.key)) }))
    .filter((g) => g.fields.length);
  return html`
    <div class="encounter">
      <h2><a href=${sectionHref(doc.id, row.key)}>№ ${row.number}. ${row.name}</a></h2>
      <p>
        <strong>Состав:</strong> ${row.composition}
        ${count !== null && html` — <span class="encounter-count">${count}</span>`}
        ${row.main.length > 0 && html`<br /><${Creatures} canon=${canon} ids=${row.main} />`}
      </p>
      <p><strong>Признаки:</strong> ${row.signs}</p>
      <p><strong>Мотивация:</strong> ${row.motive}</p>
      <p class="muted">${row.type} · хронопризрак: ${row.chrono} · ${row.repeat} · бросок реакции: ${row.reaction}</p>
      ${row.number === CULT_ROW && html`<${CultBonus} />`}
      ${row.variants.length > 0 && html`
        <details>
          <summary>Варианты сцены (${row.variants.length}) — вместо обычного состава</summary>
          ${row.variants.map((v) => html`
            <div key=${v.name} class="encounter-variant">
              <p><strong>${v.name}:</strong> <${Creatures} canon=${canon} ids=${v.creatures} /></p>
              <${Markdown} canon=${canon} doc=${doc} text=${v.text} />
            </div>
          `)}
        </details>`}
      <${CardLinks} canon=${canon} row=${row} />
      ${groups.map(({ group, fields }) => html`
        <${Group} key=${group.title} canon=${canon} group=${group} fields=${fields} onError=${onError} />
      `)}
    </div>
  `;
}

function Dice({ roll, die }) {
  const hit = happened(roll);
  if (roll.check === null) return html`<span class="dice hit">без броска</span>`;
  return html`
    <span class=${`dice${hit ? " hit" : ""}`} title=${hit ? "Встреча" : "Встречи нет: кубик таблицы не считается"}>
      d${CHECK_DIE}: ${roll.check} · d${die}: ${roll.row ?? "—"}
    </span>
  `;
}

function Last({ canon, onError }) {
  const history = useStore(() => getState().encounters.history);
  const last = history.at(-1);
  if (!last) return null;
  const roll = last.rolls.at(-1);
  const row = happened(roll) && canon.encounters.rows.find((r) => r.number === roll.row);
  return html`
    <section class="card encounter-last">
      <div class="row">
        <span class="muted">${last.echo ? "Гарантированное эхо" : last.entered ? "Введено" : "Бросок"}:</span>
        ${last.rolls.map((r, i) => html`<${Dice} key=${i} roll=${r} die=${last.die} />`)}
        <button class="small" onClick=${() => undo(last.seq).catch((e) => onError(e.message))}>отменить</button>
      </div>
      ${row ? html`<${Encounter} canon=${canon} row=${row} count=${last.count} onError=${onError} />`
        : html`<p class="muted">Встречи нет.</p>`}
      ${row && row.number === ECHO_ROW && !last.echo && html`<${EchoCheck} check=${last.seq} />`}
      ${last.echo && html`<${EchoArrival} check=${last.seq} />`}
    </section>
  `;
}

function Table({ canon }) {
  const history = useStore(() => getState().encounters.history);
  const { level } = levelOf(canon);
  const times = new Map();
  for (const h of history) {
    const last = h.rolls.at(-1);
    if (happened(last)) times.set(last.row, (times.get(last.row) ?? 0) + 1);
  }
  const doc = canon.encounters.doc;
  return html`
    <div class="scroll">
      <table class="grid encounters">
        <thead><tr>
          <th>№</th><th>Встреча</th><th>Состав</th><th>С уровня</th><th>Повторяемость</th><th>Реакция</th><th>Было</th>
        </tr></thead>
        <tbody>
          ${canon.encounters.rows.map((r) => html`
            <tr key=${r.number} class=${r.level > level ? "muted" : ""}
                title=${r.level > level ? `Доступна с ${r.level}-го уровня` : ""}>
              <td>${r.number}</td>
              <td><a href=${sectionHref(doc, r.key)}>${r.name}</a></td>
              <td>${r.composition}</td>
              <td>${r.level}</td>
              <td>${r.repeat}</td>
              <td>${r.reaction}</td>
              <td>${times.get(r.number) ?? html`<span class="muted">—</span>`}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function Encounters({ canon }) {
  const [error, setError] = useState(null);
  useEffect(() => { setTitle("Случайные встречи"); }, []);
  const { doc, key, outside } = canon.encounters;
  return html`
    <section class="page encounters-page">
      <h1>Случайные встречи</h1>
      <p class="muted">
        <a href=${sectionHref(doc, key)}>Накопительная таблица П10</a>. Счётчик идёт по трекеру ходов;
        кубик проверки и кубик таблицы бросаются вместе, а таблица без встречи не считается выпадением.
        Когда встречи нет, а сцене нужна связка, — <a href=${sectionHref(doc, outside)}>сцены вне таблицы</a>.
      </p>
      ${error && html`<p class="bad">${error}</p>`}
      <${Status} canon=${canon} onError=${setError} />
      <${Roll} canon=${canon} onError=${setError} />
      <${Last} canon=${canon} onError=${setError} />
      <h2>Таблица</h2>
      <${Table} canon=${canon} />
    </section>
  `;
}

export function EncountersPage() {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Случайные встречи" error=${error} />`;
  if (!canon.encounters || !canon.state) {
    return html`<${CanonState} title="Случайные встречи" error="Сборщик не нашёл таблицу встреч П10 или лист П2." />`;
  }
  return html`<${Encounters} canon=${canon} />`;
}
