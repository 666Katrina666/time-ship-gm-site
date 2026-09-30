import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { sectionHref } from "../canon.js";
import { renderInline } from "../markdown.js";
import { creatureHref } from "./creatures.js";
import { itemHref } from "./items.js";
import { npcHref } from "./npcs.js";
import { roomHref } from "./rooms.js";

// What the canon builder (tools/site_build.py) made of the markdown on the
// last server start. The report is rebuilt only on start, so it is fetched
// once per visit to the page.

const KINDS = { canon: "канон", companion: "справочный" };
const LEVELS = { error: "ошибка", warning: "предупреждение" };

function time(ts) {
  return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function Summary({ report }) {
  const sections = report.files.reduce((sum, f) => sum + f.sections, 0);
  const links = report.links;
  return html`
    <div class="card">
      <p>
        Собран ${time(report.built)}. Файлов: ${report.files.length}, разделов: ${sections}.
      </p>
      <p>
        Ссылок внутри сайта: ${links.canon ?? 0}, в интернет: ${links.web ?? 0},
        на файлы вне сайта: ${(links.outside ?? 0) + (links.repo ?? 0)}.
        Границ канона: ${report.boundaries ?? 0}.
        Подсказок из словаря: состояний ${report.terms?.conditions ?? 0}, признаков ${report.terms?.traits ?? 0}.
        Из блоков характеристик: существ ${report.creatures ?? 0}, опасностей ${report.hazards ?? 0}. Карточек НПС: ${report.npcs ?? 0}. Предметов со слоями знаний: ${report.items ?? 0}. Полей состояния мира: ${report.state ?? 0}. Комнат: ${report.rooms ?? 0}, блоков карточек, вырезанных из их исходника: ${report.source_cuts?.length ?? 0}. Строк случайных встреч: ${report.encounters ?? 0}. Вех: ${report.milestones ?? 0}. Карта: точек ${report.map?.nodes ?? 0}, переходов ${report.map?.edges ?? 0}.
        Разделов, которых не показывает ни одна карточка: ${report.hidden?.length ?? 0}.
      </p>
      <p>
        ${report.errors || report.warnings
          ? html`<b class=${report.errors ? "bad" : ""}>Ошибок: ${report.errors}, предупреждений: ${report.warnings}.</b>`
          : "Находок нет: все ссылки канона нашли свою цель."}
      </p>
    </div>
  `;
}

function Problems({ problems }) {
  if (problems.length === 0) return null;
  return html`
    <h2>Находки</h2>
    <p class="muted">Правится канон, а не сайт; после правки перезапустите сайт из меню <code>start.bat</code>.</p>
    <ol class="log">
      ${problems.map((p) => html`
        <li>
          <span class=${p.level === "error" ? "bad" : "muted"}>${LEVELS[p.level]}</span>
          <span><code>${p.file}:${p.line}</code> ${p.message}</span>
          ${p.snippet && html`<span class="muted snippet">${p.snippet}</span>`}
        </li>
      `)}
    </ol>
  `;
}

const count = (n) => n.toLocaleString("ru-RU");

// Sections of the card files that no card shows (tools/site_coverage.py): a
// list for the check of step 3.10, not findings. One fold per file, rows
// grouped under their level-2 section.
function Hidden({ hidden, files }) {
  if (!hidden?.length) return null;
  const shortOf = new Map(files.map((f) => [f.id, f.short.split(".")[0]]));
  const docs = [...new Set(hidden.map((h) => h.doc))];
  const title = (text) => html`<span dangerouslySetInnerHTML=${{ __html: renderInline(text, () => null) }} />`;
  return html`
    <h2>Не показано на карточках</h2>
    <p class="muted">
      Разделы с текстом в файлах карточек, которых не показывает ни одна карточка. Это не ошибки:
      общие правила и таблицы читаются в читалке. Список нужен сверке шага 3.10 — найти среди них
      сведения, которых не хватает карточкам. «По ссылке» — раздел, на который карточка или страница
      ссылается, но не показывает.
    </p>
    ${docs.map((doc) => {
      const rows = hidden.filter((h) => h.doc === doc);
      const size = rows.reduce((sum, h) => sum + h.size, 0);
      const linked = rows.filter((h) => h.linked).length;
      return html`
        <details class="info" key=${doc}>
          <summary>
            ${shortOf.get(doc) ?? doc}: разделов ${rows.length}, знаков ${count(size)}${linked ? `, по ссылке ${linked}` : ""}
          </summary>
          <div class="scroll">
            <table class="grid hidden-sections">
              <thead><tr><th>Раздел</th><th>Строка</th><th>Знаков</th><th></th></tr></thead>
              <tbody>
                ${rows.map((h, i) => html`
                  ${h.top !== h.key && h.top !== rows[i - 1]?.top && html`
                    <tr class="group"><td colspan="4">${title(h.top_title)}</td></tr>`}
                  <tr key=${h.key}>
                    <td class=${h.top !== h.key ? "nested" : ""}>
                      <a href=${sectionHref(h.doc, h.key)}>${title(h.title)}</a>
                    </td>
                    <td>${h.line}</td>
                    <td>${count(h.size)}</td>
                    <td class="muted">${h.linked ? "по ссылке" : ""}</td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        </details>
      `;
    })}
  `;
}

const CUT_KINDS = { creatures: "существо", npcs: "НПС", items: "предмет" };
const CUT_HREFS = { creatures: creatureHref, npcs: npcHref, items: itemHref };

// Card blocks pasted into the source rooms, cut from the room description
// (tools/site_room_source.py) and shown there as links: a list to check that
// nothing but a card's block was dropped.
function SourceCuts({ cuts }) {
  if (!cuts?.length) return null;
  return html`
    <h2>Вырезано из исходника комнат</h2>
    <p class="muted">
      Блоки существ, НПС и предметов, вклеенные в описания комнат <code>korabl_vremeni_ocr.md</code>.
      На странице комнаты вместо блока стоит ссылка на карточку.
    </p>
    <details class="info">
      <summary>Блоков: ${cuts.length}</summary>
      <div class="scroll">
        <table class="grid">
          <thead><tr><th>Комната</th><th>Блок</th><th>Карточка</th><th>Строка</th></tr></thead>
          <tbody>
            ${cuts.map((c) => html`
              <tr key=${`${c.room}-${c.line}`}>
                <td><a href=${roomHref(c.room)}>${c.room}</a></td>
                <td>${c.title}</td>
                <td><a href=${CUT_HREFS[c.kind](c.id)}>${CUT_KINDS[c.kind]} ${c.id}</a></td>
                <td>${c.line}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </details>
  `;
}

function Files({ files }) {
  return html`
    <h2>Файлы</h2>
    <div class="scroll">
      <table class="grid">
        <thead>
          <tr>
            <th>Файл</th><th>Вид</th><th>Строк</th><th>Разделов</th>
            <th title="Повторяющиеся заголовки: ссылкой достижим только первый">Повторов</th>
            <th>Ссылок из</th><th>Ссылок в</th>
          </tr>
        </thead>
        <tbody>
          ${files.map((f) => html`
            <tr key=${f.id}>
              <td title=${f.file}>${f.short}</td>
              <td>${KINDS[f.kind]}</td>
              <td>${f.lines}</td><td>${f.sections}</td><td>${f.repeated}</td>
              <td>${f.links}</td><td>${f.links_in}</td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

export function BuildReportPage() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch("data/build_report.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("отчёта нет: сайт запущен без сборки"))))
      .then(setReport, (e) => setError(e.message));
  }, []);
  return html`
    <section class="page">
      <h1>Отчёт сборщика</h1>
      <p class="muted">
        При каждом запуске сайта <code>tools/site_build.py</code> разбирает канон в данные сайта
        и перечисляет здесь всё, что не смог разобрать.
      </p>
      ${error && html`<p class="bad">${error}</p>`}
      ${report && html`
        <${Summary} report=${report} />
        <${Problems} problems=${report.problems} />
        <${Hidden} hidden=${report.hidden} files=${report.files} />
        <${SourceCuts} cuts=${report.source_cuts} />
        <${Files} files=${report.files} />
      `}
    </section>
  `;
}
