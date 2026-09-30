import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { sectionHref, useCanon } from "../canon.js";
import { CanonState, setTitle, signed } from "../card.js";
import { dispatch, getState, undo, useStore } from "../store.js";
import { addToScene, fromCharacter, inScene } from "../scene.js";
import { ECHO_SHIFT, OUT_REASONS, classLine, hitPoints, left, partyState, recentSnapshots } from "../party.js";
import { echoOf, rollDie } from "../encounters.js";
import { turnsWord } from "../turns.js";
import { Conditions, HitPoints, conditionsOf } from "./scene.js";

// "Игра → Вы сами": the party's quick fields (site/party.js): hit points,
// spell slots and focus, counters, conditions and a note of what each
// character carries and knows. They are what the echo of "Вы сами" is
// restored from (P6, 9.4); below them, the snapshots of the last six turns.
// "персонаж выбыл" puts a character in the queue of the guaranteed echo
// (P6, 10.8). For the encounters page: EchoCheck is the d8 panel of a random
// No. 12, EchoArrival the echo that came on a check.

function run(promise, onError) {
  promise.catch((e) => onError(e.message));
}

// "осталось 2 из 3" with a button to spend one and one to give it back.
function Resource({ label, left: n, limit, onSpend }) {
  return html`
    <div class="pc-resource">
      <span class="pc-resource-name">${label}</span>
      <span class=${n === 0 ? "muted" : ""}><strong>${n}</strong><span class="muted"> из ${limit}</span></span>
      <button class="small" title="Потратить одно" disabled=${n === 0} onClick=${() => onSpend(1)}>−1</button>
      <button class="small" title="Вернуть одно" disabled=${n === limit} onClick=${() => onSpend(-1)}>+1</button>
    </div>
  `;
}

// The note, a draft while typing, sent on leave.
function Note({ pc, onError }) {
  const [draft, setDraft] = useState(pc.note ?? "");
  useEffect(() => setDraft(pc.note ?? ""), [pc.note]);
  const commit = (value) => {
    const text = value.trim() || null;
    if (text !== pc.note) run(dispatch("pc-note", { id: pc.id, name: pc.build.name, text }), onError);
  };
  return html`
    <textarea class="pc-note" rows="2" value=${draft} placeholder="Что при себе и что знает: найденные вещи, важные сведения"
              onInput=${(e) => setDraft(e.target.value)} onBlur=${(e) => commit(e.target.value)} />
  `;
}

// Temporary hit points: a number field sent on leave or Enter.
function Temp({ pc, onError }) {
  const [draft, setDraft] = useState(pc.temp || "");
  useEffect(() => setDraft(pc.temp || ""), [pc.temp]);
  const commit = (raw) => {
    const value = Math.max(0, Math.floor(Number(raw) || 0));
    if (value !== pc.temp) run(dispatch("pc-temp", { id: pc.id, name: pc.build.name, value }), onError);
  };
  return html`
    <label class="pc-temp" title="Временные ПЗ: урон снимает их первыми">
      врем. <input type="number" min="0" class="narrow" value=${draft} aria-label="Временные ПЗ"
                   onInput=${(e) => setDraft(e.target.value)} onBlur=${(e) => commit(e.target.value)}
                   onKeyDown=${(e) => e.key === "Enter" && e.target.blur()} />
    </label>
  `;
}

// "в сцену": the character joins the fight of the "Сцена" page.
function ToScene({ pc, onError }) {
  const there = useStore(() => inScene(getState().scene, pc));
  if (there) return html`<a class="muted" href="#/game/scene">в сцене</a>`;
  return html`<button class="small" onClick=${() => run(addToScene([fromCharacter(pc)]), onError)}>в сцену</button>`;
}

const p6 = (key) => sectionHref("p6", key);

// "персонаж выбыл": the reason of P6, 10.8, then the character waits for the echo.
function DropOut({ pc, onError }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(OUT_REASONS[0]);
  if (!open) {
    return html`<button class="small" title="Выбыл необратимо: придёт гарантированное эхо (П6, 10.8)"
                        onClick=${() => setOpen(true)}>персонаж выбыл</button>`;
  }
  const send = () => {
    run(dispatch("pc-out", { id: pc.id, name: pc.build.name, reason }), onError);
    setOpen(false);
  };
  return html`
    <span class="pc-drop">
      <select value=${reason} onChange=${(e) => setReason(e.target.value)} aria-label="Как выбыл">
        ${OUT_REASONS.map((r) => html`<option key=${r} value=${r}>${r}</option>`)}
      </select>
      <button class="small" onClick=${send}>выбыл</button>
      <button class="small" onClick=${() => setOpen(false)}>отмена</button>
    </span>
  `;
}

// An echo of the ship is bound to the crystal walls until the Shell with
// control makes it a lasting version (P6, 10.8; P8, 9.6).
function EchoMark({ pc, onError }) {
  const { anchored } = pc.echo;
  const toggle = () => run(dispatch("pc-echo-anchor", { id: pc.id, name: pc.build.name, anchored: !anchored }), onError);
  return html`
    <span class="pc-echo">
      <a href=${p6("10.8. Гарантированное эхо")}
         title=${anchored ? "Оболочка закрепила эхо как постоянную версию" : "За хрустальными стенами — наружу или в 41 — эхо исчезает"}>
        ${anchored ? "эхо, закреплено Оболочкой" : "эхо Корабля"}</a>
      <button class="small" onClick=${toggle}
              title="После получения управления Оболочка закрепляет эхо как постоянную версию (П8, 9.6)">
        ${anchored ? "снять закрепление" : "закрепить"}</button>
    </span>
  `;
}

// A character who dropped out: why, and where their echo is.
function OutCard({ pc }) {
  const [error, setError] = useState(null);
  const { queue, waiting } = useStore(echoOf);
  const arrived = useStore(() => partyState().arrived);
  const place = queue.findIndex((q) => q.id === pc.id);
  const came = arrived?.id === pc.id && !arrived.joined;
  return html`
    <section class="card pc-card pc-out">
      <div class="row pc-head">
        <h2>${pc.build.name}</h2>
        <span class="muted">${classLine(pc.build)}</span>
        <span class="bad">выбыл на ходу ${pc.out.turn}: ${pc.out.reason}</span>
      </div>
      <p>
        ${came
          ? html`Эхо пришло: <a href="#/game/encounters">присоединить на странице встреч</a>.`
          : place >= 0
            ? html`Ждёт гарантированное эхо${queue.length > 1 ? ` (${place + 1}-й в очереди)` : ""}${waiting
                ? `: снимка ${ECHO_SHIFT} ходов назад ещё нет, эхо придёт на первой проверке с ${ECHO_SHIFT}-го хода`
                : ": оно придёт вместо проверки случайной встречи"}${" "}(<a href=${p6("10.8. Гарантированное эхо")}>П6, 10.8</a>).`
            : html`<span class="muted">Эхо уже пришло на проверке.</span>`}
      </p>
      <div class="row">
        <button class="small" title="Выбывание было ошибкой; то же, что отмена записи в журнале"
                onClick=${() => run(undo(pc.out.seq), setError)}>отменить выбывание</button>
      </div>
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

function Character({ pc, conditions }) {
  if (pc.out) return html`<${OutCard} pc=${pc} />`;
  return html`<${Present} pc=${pc} conditions=${conditions} />`;
}

function Present({ pc, conditions }) {
  const [error, setError] = useState(null);
  const b = pc.build;
  const n = b.numbers;
  const { hp, max } = hitPoints(pc);
  const send = (type, data) => run(dispatch(type, { id: pc.id, name: b.name, ...data }), setError);
  const spend = (what, key, label) => (delta) => send("pc-spend", { what, key, label, delta });
  const hasMagic = b.casters.length > 0 || b.focus.max > 0;
  return html`
    <section class=${`card pc-card${hp === 0 ? " pc-down" : ""}`}>
      <div class="row pc-head">
        <h2>${b.name}</h2>
        <span class="muted">${classLine(b)}</span>
        ${pc.echo && html`<${EchoMark} pc=${pc} onError=${setError} />`}
        <${ToScene} pc=${pc} onError=${setError} />
        <${DropOut} pc=${pc} onError=${setError} />
        <span class="pc-numbers">КБ <strong>${n.ac}</strong>${` · Стойк. ${signed(n.fortitude)} · Реф. ${signed(n.reflex)} · Воля ${signed(n.will)} · Восприятие ${signed(n.perception)}`}</span>
      </div>
      <div class="row">
        <span class="muted">ПЗ</span>
        <${HitPoints} hp=${hp} max=${max} onChange=${(delta) => send("pc-hp", { delta })} />
        <${Temp} pc=${pc} onError=${setError} />
      </div>
      <${Conditions} current=${pc.conditions} conditions=${conditions}
                     onSet=${(condition, value) => send("pc-condition", { condition, value })} />
      ${hasMagic && html`
        <div class="pc-resources">
          ${b.casters.flatMap((c) => c.slots.map((s) => {
            const key = `${c.name}|${s.rank}`;
            const label = `ячейка ${s.rank}-го ранга${b.casters.length > 1 ? ` (${c.name})` : ""}`;
            return html`<${Resource} key=${key} label=${label} ...${left(pc, "slot", key)} onSpend=${spend("slot", key, label)} />`;
          }))}
          ${b.focus.max > 0 && html`
            <${Resource} label="очки фокусировки" ...${left(pc, "focus", null)}
                         onSpend=${spend("focus", null, "очко фокусировки")} />`}
          <button class="small" title="Ячейки и фокус возвращаются; ПЗ и счётчики — нет"
                  onClick=${() => send("pc-prepare", {})}>ежедневная подготовка</button>
        </div>`}
      ${pc.counters.length > 0 && html`
        <div class="pc-resources">
          ${pc.counters.map((c) => html`
            <${Resource} key=${c.name} label=${c.name} ...${left(pc, "counter", c.name)}
                         onSpend=${spend("counter", c.name, c.name)} />`)}
        </div>`}
      <${Note} pc=${pc} onError=${setError} />
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

// One character of a snapshot as table cells, in words; the same words for
// the character now tell what changed since.
function cellsOf(pc) {
  const { hp, max, temp } = hitPoints(pc);
  const conditions = Object.entries(pc.conditions).map(([k, v]) => (v === true ? k : `${k} ${v}`)).join(", ");
  const magic = [
    ...pc.build.casters.flatMap((c) => c.slots.map((sl) => {
      const { left: n, limit } = left(pc, "slot", `${c.name}|${sl.rank}`);
      return `${sl.rank}-й ${n}/${limit}`;
    })),
    ...(pc.build.focus.max > 0 ? [`фокус ${left(pc, "focus", null).left}/${pc.build.focus.max}`] : []),
  ].join(" · ");
  const counters = pc.counters.map((c) => `${c.name} ${left(pc, "counter", c.name).left}/${c.max}`).join(" · ");
  return {
    hp: `${hp}/${max}${temp ? ` +${temp}` : ""}`, conditions: conditions || "—", magic: magic || "—",
    counters: counters || "—", note: pc.note ?? "—",
  };
}

const COLUMNS = [["hp", "ПЗ"], ["conditions", "Состояния"], ["magic", "Ячейки и фокус"], ["counters", "Расходники"], ["note", "Заметка"]];

// A snapshot as a table; with now, a cell that differs from the party now is marked.
export function SnapshotTable({ list, now, extra }) {
  return html`
    <div class="scroll">
      <table class="grid snapshot">
        <thead><tr><th>Персонаж</th>${COLUMNS.map(([, label]) => html`<th key=${label}>${label}</th>`)}${extra && html`<th>${extra.title}</th>`}</tr></thead>
        <tbody>
          ${list.map((pc) => {
            const cells = cellsOf(pc);
            const current = now?.find((x) => x.id === pc.id);
            const was = current && cellsOf(current);
            return html`
              <tr key=${pc.id}>
                <td>${pc.build.name} <span class="muted">${pc.build.level}</span></td>
                ${COLUMNS.map(([key]) => html`
                  <td key=${key} class=${was && was[key] !== cells[key] ? "changed" : ""}
                      title=${was && was[key] !== cells[key] ? `сейчас: ${was[key]}` : ""}>${cells[key]}</td>`)}
                ${extra && html`<td>${extra.cell(pc)}</td>`}
              </tr>`;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function Snapshots() {
  const p = useStore(partyState);
  const recent = recentSnapshots();
  const [ago, setAgo] = useState(null);
  const shown = recent.find((x) => x.ago === ago) ?? recent.at(-1);
  return html`
    <section class="card">
      <h2>Снимки</h2>
      <p class="muted">Партия на начало каждого из последних ${ECHO_SHIFT} ходов, сейчас ход ${p.turn}. Снимок берётся
        сам при каждом ходе трекера; эхо «Вы сами» идёт из снимка ${ECHO_SHIFT} ходов назад
        (<a href=${sectionHref("p6", "9.3. Какая версия используется")}>П6, 9.3</a>). Отличия от нынешнего
        состояния выделены, при наведении — как сейчас.</p>
      ${recent.length === 0
        ? html`<p class="muted">Снимков ещё нет: первый появится с первым ходом трекера.</p>`
        : html`
          <div class="row snapshot-pick" role="group" aria-label="Снимок">
            ${recent.map((x) => html`
              <button key=${x.turn} class=${`small${x === shown ? " on" : ""}`} aria-pressed=${x === shown}
                      onClick=${() => setAgo(x.ago)}>−${x.ago}</button>`)}
          </div>
          <p>Ход ${shown.turn}, ${shown.ago} ${turnsWord(shown.ago)} назад${shown.ago === ECHO_SHIFT ? " — снимок для эха" : ""}.
            ${recent.every((x) => x.ago < ECHO_SHIFT) && html` <span class="muted">Снимка ${ECHO_SHIFT} ходов назад ещё нет.</span>`}</p>
          ${shown.list.length === 0
            ? html`<p class="muted">В этом снимке персонажей нет.</p>`
            : html`<${SnapshotTable} list=${shown.list} now=${p.list} />`}`}
    </section>
  `;
}

// A random No. 12 (P10): who of the snapshot six turns back comes, by the d8
// of P6, 9.5. Companions without a sheet are rolled for at the table.
export function EchoCheck({ check }) {
  const echo = useStore(() => partyState().echo12);
  const [error, setError] = useState(null);
  if (!echo || echo.check !== check) return null;
  const rule = html`<a href=${sectionHref("p6", "9.5. Изменение состава")}>П6, 9.5</a>`;
  if (echo.list === null || echo.list.length === 0) {
    return html`
      <div class="echo-check">
        <p><strong>Снимка ${ECHO_SHIFT} ходов назад нет${echo.list ? " или в нём нет персонажей" : ""}:</strong> эху не из чего
          отделиться, встреча — несостоявшийся отголосок (<a href=${sectionHref("p6", "9.3. Какая версия используется")}>П6, 9.3</a>).</p>
      </div>`;
  }
  const roll = () => {
    const rolls = echo.list.map((pc) => ({ id: pc.id, name: pc.build.name, roll: rollDie(8) }));
    dispatch("echo-d8", { check, rolls }).catch((e) => setError(e.message));
  };
  const rolled = new Map((echo.rolls ?? []).map((r) => [r.id, r.roll]));
  const alive = echo.rolls && echo.rolls.filter((r) => r.roll !== 1);
  return html`
    <div class="echo-check">
      <h3>Снимок хода ${echo.from}, ${ECHO_SHIFT} ходов назад</h3>
      <p class="muted">На каждого d8 (${rule}): при 1 он погиб в альтернативной ветке и в эхе отсутствует. Наёмники и
        спутники без листа бросаются за столом.</p>
      <${SnapshotTable} list=${echo.list} extra=${echo.rolls && {
        title: "d8",
        cell: (pc) => html`<span class=${`dice${rolled.get(pc.id) === 1 ? "" : " hit"}`}>${rolled.get(pc.id)}${rolled.get(pc.id) === 1 ? " — погиб в ветке" : ""}</span>`,
      }} />
      <div class="row">
        ${echo.rolls
          ? html`<strong>${alive.length ? `Приходят: ${alive.map((r) => r.name).join(", ")}` : "Погибли все: несостоявшийся отголосок"}</strong>`
          : html`<button onClick=${roll}>бросить d8 на каждого</button>`}
      </div>
      ${error && html`<p class="bad">${error}</p>`}
    </div>
  `;
}

// The guaranteed echo that came on a check (P6, 10.8): the survivor from
// the snapshot, with the penalty, and the button that brings them back.
export function EchoArrival({ check }) {
  const arrived = useStore(() => partyState().arrived);
  const [error, setError] = useState(null);
  if (!arrived || arrived.check !== check) return null;
  if (arrived.id === null) {
    return html`
      <div class="echo-check">
        <p>В очереди эха никого нет: выбывание отменено или это отметка «ждёт гарантированное эхо» из старого
          сохранения. Состав и состояние — по <a href=${p6("10.8. Гарантированное эхо")}>П6, 10.8</a>; если
          проверка лишняя, отмените её.</p>
      </div>`;
  }
  const join = () => run(dispatch("pc-echo-join", { check, id: arrived.id, name: arrived.name }), setError);
  return html`
    <div class="echo-check">
      <h3>Эхо: ${arrived.name} из снимка хода ${arrived.from}</h3>
      <p class="muted">Снимок — ${ECHO_SHIFT} ходов до этой проверки, но не позже хода выбывания. Штраф уже учтён: половина
        максимума ПЗ и «ранен 1»; остальное — как в снимке.</p>
      <${SnapshotTable} list=${[arrived.pc]} />
      <ul class="echo-rules">
        <li>Остальные в ветке эха погибли, группа эха видит собственные тела; последний час основной линии эхо не
          помнит — Мастер коротко рассказывает его альтернативный час.</li>
        <li>Эхо — эхо Корабля: за хрустальными стенами, наружу или в 41, исчезает. Привязку снимает только Оболочка
          после получения управления (<a href=${sectionHref("p8", "9.6. После получения управления")}>П8, 9.6</a>).</li>
        <li>Тело и снаряжение выбывшего остаются (<a href=${p6("10.5. Что остаётся от погибшей версии")}>П6, 10.5</a>);
          одинаковые вещи эха и тела — временные дубли, остаются вещи с тела
          (<a href=${p6("7.9. Какой экземпляр остаётся")}>П6, 7.9</a>).</li>
      </ul>
      <div class="row">
        ${arrived.joined
          ? html`<strong>Эхо присоединилось к группе.</strong>`
          : html`<button onClick=${join}>эхо присоединилось</button>`}
      </div>
      <p class="muted">Вещи эха: предмет, другая версия которого уже есть у группы, — временной дубль. Заведите его
        версии в <a href="#/game/doubles">реестре дублей</a> с отметкой «вещь эха»: она сохраняет происхождение эха и
        при передаче, а за хрустальными стенами исчезает (<a href=${p6("9.8. Обмен предметами")}>П6, 9.8</a>).</p>
      ${error && html`<p class="bad">${error}</p>`}
    </div>
  `;
}

export function YourselvesPage() {
  const { canon, error } = useCanon();
  const { list } = useStore(partyState);
  useEffect(() => { setTitle("«Вы сами»"); }, []);
  if (!canon) return html`<${CanonState} error=${error} />`;
  const conditions = conditionsOf(canon);
  return html`
    <section class="page">
      <h1>«Вы сами»</h1>
      <p class="muted">Быстрые поля партии. Из них восстанавливается эхо встречи «Вы сами» —
        <a href=${sectionHref("p6", "9.4. Восстановление состояния 6 ходов назад")}>П6, 9.4</a>.
        Выбывший персонаж ждёт гарантированного эха (<a href=${sectionHref("p6", "10.8. Гарантированное эхо")}>П6, 10.8</a>).</p>
      ${list.length === 0
        ? html`<p class="muted">Персонажей ещё нет: их добавляет <a href="#/tools/pathbuilder">импорт из Pathbuilder</a>.</p>`
        : list.map((pc) => html`<${Character} key=${pc.id} pc=${pc} conditions=${conditions} />`)}
      <${Snapshots} />
    </section>
  `;
}
