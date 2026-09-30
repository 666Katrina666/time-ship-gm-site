import { html, useEffect, useMemo, useState } from "../vendor/htm-preact.js";
import { canonLinks, sectionHref, useCanon } from "../canon.js";
import { dispatch, useStore } from "../store.js";
import { renderInline } from "../markdown.js";
import { CanonState, Subtree, fold, setTitle } from "../card.js";
import { levelOf } from "../encounters.js";
import { milestonesState, thresholds } from "../milestones.js";

// "Игра → Вехи": the level-up of P14 (canon.milestones). The GM marks the
// conditions of the catalog as the party reaches them, names the declared
// paths and their first irreversible step, and ticks the conditions of
// readiness for the finale; the page checks both thresholds of 3 → 4 and
// applies the level-up with the party level event of the encounter page.
// Marks, paths and readiness are the GM's call at the table: the P2 sheet
// does not hold "the claim was made" or "a blood sample was taken".

function send(type, data, onError) {
  dispatch(type, data).catch((e) => onError(e.message));
}

function Inline({ canon, doc, text }) {
  return html`<span dangerouslySetInnerHTML=${{ __html: renderInline(text, canonLinks(canon, doc)) }} />`;
}

const Yes = ({ on, children }) => html`<span class=${`milestone-check ${on ? "yes" : "no"}`}>${on ? "да" : "нет"}</span> ${children}`;

function Toggle({ on, label, title, onClick }) {
  return html`<button class=${`small${on ? " on" : ""}`} aria-pressed=${on} title=${title} onClick=${onClick}>${label}</button>`;
}

function Level({ canon, onError }) {
  const m = canon.milestones;
  useStore(milestonesState);
  const { level } = levelOf(canon);
  const t = thresholds(canon);
  const crash = m.items.find((i) => i.id === m.crash);
  const rule = m.fallback_rule;
  const applied = level >= m.levels.to;
  const href = (key) => sectionHref(m.doc, key);
  return html`
    <section class="card milestone-level">
      <div class="row">
        <span>Уровень партии: <strong>${level}</strong></span>
        ${applied
          ? html`<span class="milestone-status">повышение применено</span>`
          : t.met
            ? html`
              <span class="milestone-status ready">готово и ожидает применения</span>
              <button onClick=${() => send("party-level", { level: m.levels.to }, onError)}
                      title="То же, что уровень на странице встреч: таблица встреч переключится со следующей проверки">
                применить повышение до ${m.levels.to}-го уровня
              </button>`
            : html`<span class="milestone-status">не готово</span>`}
      </div>
      ${applied
        ? html`<p class="muted">Повышение в кампании одно: новые условия отмечаются и работают на
            готовность к развязке (<a href=${href(m.procedure)}>П14, 14</a>).</p>`
        : t.met && html`<p class="muted">Применять после сцены или на устойчивой передышке, не внутри боя;
            без полного восстановления ресурсов (<a href=${href(m.procedure)}>П14, 14</a>).</p>`}
      <div class="milestone-thresholds">
        <div>
          <h3><a href=${href(m.paths)}>Основной порог</a>${t.primary.met && " — выполнен"}</h3>
          <ul>
            <li><${Yes} on=${t.primary.crash}>засчитана веха «${crash?.name}»<//></li>
            <li><${Yes} on=${t.primary.via !== null}>назван путь и по нему сделан первый необратимый шаг${
              t.primary.via && html` — «${t.primary.via.name}»`}<//></li>
          </ul>
        </div>
        <div>
          <h3><a href=${href(m.fallback)}>Запасной порог</a>${t.fallback.met && " — выполнен"}</h3>
          <ul>
            <li><${Yes} on=${t.fallback.count >= rule.conditions}>условий ${t.fallback.count} из ${rule.conditions}<//></li>
            <li><${Yes} on=${t.fallback.categories >= rule.categories}>категорий ${t.fallback.categories} из ${rule.categories}<//></li>
            <li><${Yes} on=${t.fallback.strong.length > 0}>${rule.strong.join(" или ")} и не «${m.knowledge}»${
              t.fallback.strong.length > 0 && html` — ${t.fallback.strong.map((i) => `«${i.name}»`).join(", ")}`}<//></li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function Paths({ canon, onError }) {
  const m = canon.milestones;
  const doc = canon.byId.get(m.doc);
  useStore(milestonesState);
  const { paths } = thresholds(canon).primary;
  const set = (p, what) => send("milestone-path", { id: p.id, name: p.name, what, on: !p[what] }, onError);
  return html`
    <section class="card">
      <h2><a href=${sectionHref(m.doc, m.paths)}>Заявленный путь</a></h2>
      <p class="muted">Путь заявлен, когда за столом прозвучало решение, а не гипотеза. Пути не исключают друг
        друга: засчитывается тот, по которому первым сделан необратимый шаг.</p>
      <div class="scroll">
        <table class="grid milestone-paths">
          <thead><tr><th>Путь</th><th>Заявка</th><th>Первый шаг засчитан, когда</th><th></th></tr></thead>
          <tbody>
            ${paths.map((p) => html`
              <tr key=${p.id} class=${p.claimed && p.made ? "done" : ""}>
                <td><strong>${p.name}</strong></td>
                <td>${p.claim}</td>
                <td><${Inline} canon=${canon} doc=${doc} text=${p.step} /></td>
                <td class="milestone-toggles">
                  <${Toggle} on=${p.claimed} label="заявлен" onClick=${() => set(p, "claimed")} />
                  <${Toggle} on=${p.made} label="шаг сделан" onClick=${() => set(p, "made")} />
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// The address is the site route, so a register row opens its catalog entry by script.
function openMilestone(e, id) {
  e.preventDefault();
  const el = document.getElementById(`milestone-${id}`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ block: "start" });
}

function Register({ canon, onError }) {
  const m = canon.milestones;
  const { marked } = useStore(milestonesState);
  const byId = new Map(m.items.map((i) => [i.id, i]));
  return html`
    <section class="card">
      <h2><a href=${sectionHref(m.doc, m.procedure)}>Реестр развития</a></h2>
      ${marked.length === 0
        ? html`<p class="muted">Ни одна веха ещё не получена.</p>`
        : html`
          <div class="scroll">
            <table class="grid milestone-register">
              <thead><tr><th>Веха</th><th>Категория</th><th>Масштаб</th><th>Уровень</th><th>Состояние мира</th><th></th></tr></thead>
              <tbody>
                ${marked.map((x) => {
                  const item = byId.get(x.id);
                  return html`
                    <tr key=${x.id}>
                      <td><a href="" onClick=${(e) => openMilestone(e, x.id)}>${x.name}</a></td>
                      <td>${item?.category ?? html`<span class="bad">нет в каталоге</span>`}</td>
                      <td>${item?.scale}</td>
                      <td>${x.level}${x.level >= m.levels.to && html` <span class="muted">после повышения</span>`}</td>
                      <td>${x.note || html`<span class="muted">—</span>`}</td>
                      <td><button class="small" onClick=${() => send("milestone-drop", { id: x.id, name: x.name }, onError)}>снять</button></td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
          </div>`}
    </section>
  `;
}

function Readiness({ canon, onError }) {
  const m = canon.milestones;
  const doc = canon.byId.get(m.doc);
  const { ready } = useStore(milestonesState);
  const all = m.readiness_items.every((_, i) => ready[i]);
  return html`
    <section class="card">
      <h2><a href=${sectionHref(m.doc, m.readiness)}>Готовность к развязке</a>: ${all ? "да" : "нет"}</h2>
      <p class="muted">Нужны все три условия сразу; уровня флаг не даёт.</p>
      <ol class="milestone-ready">
        ${m.readiness_items.map((text, i) => html`
          <li key=${i}>
            <${Toggle} on=${!!ready[i]} label=${ready[i] ? "да" : "нет"}
                       onClick=${() => send("milestone-ready", { index: i, on: !ready[i] }, onError)} />
            <${Inline} canon=${canon} doc=${doc} text=${text} />
          </li>
        `)}
      </ol>
    </section>
  `;
}

// One condition of the catalog: its canon text folded, the mark with a note.
function Milestone({ canon, item, mark, onError }) {
  const m = canon.milestones;
  const doc = canon.byId.get(m.doc);
  const [note, setNote] = useState("");
  const submit = (e) => {
    e.preventDefault();
    send("milestone-mark", { id: item.id, name: item.name, level: levelOf(canon).level, note: note.trim() }, onError);
    setNote("");
  };
  return html`
    <details id=${`milestone-${item.id}`} class=${`milestone${mark ? " done" : ""}`}>
      <summary>
        <strong>${item.name}</strong> <span class="muted">— ${item.goal}</span>
        <span class="milestone-tags">${item.scale}${mark && html` · <span class="milestone-got">получена на ${mark.level}-м</span>`}</span>
      </summary>
      <div class="milestone-body">
        ${mark
          ? html`<div class="row">
              <span>Получена на ${mark.level}-м уровне${mark.note && html`: ${mark.note}`}</span>
              <button class="small" onClick=${() => send("milestone-drop", { id: item.id, name: item.name }, onError)}>снять</button>
            </div>`
          : html`<form class="row" onSubmit=${submit}>
              <input value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="Что теперь истинно в мире (коротко)" />
              <button type="submit">отметить</button>
            </form>`}
        <p class="muted">Однократность: ${item.once}. Одно действие обычно даёт одно условие —${" "}
          <a href=${sectionHref(m.doc, m.package)}>правило причинного пакета</a>.</p>
        <${Subtree} canon=${canon} doc=${doc} keyOf=${item.key} level=${3} />
      </div>
    </details>
  `;
}

function Catalog({ canon, onError }) {
  const m = canon.milestones;
  const { marked } = useStore(milestonesState);
  const [query, setQuery] = useState("");
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = useMemo(() => new Map(m.items.map((i) => [i.id, fold(`${i.name} ${i.goal} ${i.category} ${i.scale}`)])), [m]);
  const shown = m.items.filter((i) => words.every((w) => hay.get(i.id).includes(w)));
  return html`
    <h2><a href=${sectionHref(m.doc, m.catalog)}>Каталог условий</a></h2>
    <div class="row">
      <input type="search" value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder="Поиск по вехам" />
      <span class="muted">получено ${marked.length} из ${m.items.length}</span>
    </div>
    ${m.categories.map((c) => {
      const items = shown.filter((i) => i.category === c.name);
      return items.length > 0 && html`
        <section key=${c.name} class="milestone-category">
          <h3>${c.name}${c.name === m.knowledge && html` <span class="muted">— только знание</span>`}</h3>
          <p class="muted">${c.measures}</p>
          ${items.map((i) => html`
            <${Milestone} key=${i.id} canon=${canon} item=${i} mark=${marked.find((x) => x.id === i.id)} onError=${onError} />
          `)}
        </section>`;
    })}
    ${shown.length === 0 && html`<p class="muted">Ничего не нашлось.</p>`}
  `;
}

function Milestones({ canon }) {
  const [error, setError] = useState(null);
  useEffect(() => { setTitle("Вехи"); }, []);
  const m = canon.milestones;
  return html`
    <section class="page milestones-page">
      <h1>Вехи</h1>
      <p class="muted">
        Развитие по <a href=${sectionHref(m.doc, m.scheme)}>П14</a>: одно повышение, ${m.levels.from} → ${m.levels.to}.
        Веха — объективно новое состояние мира или возможностей партии, а не комната, бой или добыча
        (<a href=${sectionHref(m.doc, m.procedure)}>процедура Мастера</a>).
      </p>
      ${error && html`<p class="bad">${error}</p>`}
      <${Level} canon=${canon} onError=${setError} />
      <${Paths} canon=${canon} onError=${setError} />
      <${Register} canon=${canon} onError=${setError} />
      <${Readiness} canon=${canon} onError=${setError} />
      <${Catalog} canon=${canon} onError=${setError} />
    </section>
  `;
}

export function MilestonesPage() {
  const { canon, error } = useCanon();
  if (error || !canon) return html`<${CanonState} title="Вехи" error=${error} />`;
  if (!canon.milestones || !canon.encounters) {
    return html`<${CanonState} title="Вехи" error="Сборщик не нашёл вехи П14 или таблицу встреч П10." />`;
  }
  return html`<${Milestones} canon=${canon} />`;
}
