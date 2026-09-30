import { html, render, useEffect, useState } from "./vendor/htm-preact.js";
import { getStatus, redoLast, undoLast, useStore } from "./store.js";
import { SavesPage } from "./pages/saves.js";
import { BuildReportPage } from "./pages/build_report.js";
import { ReaderPage } from "./pages/reader.js";
import { SearchPage } from "./pages/search.js";
import { CreaturesPage } from "./pages/creatures.js";
import { HazardsPage } from "./pages/hazards.js";
import { NpcsPage } from "./pages/npcs.js";
import { ItemsPage } from "./pages/items.js";
import { WorldPage } from "./pages/world.js";
import { RoomsPage } from "./pages/rooms.js";
import { EncountersPage } from "./pages/encounters.js";
import { ScenePage } from "./pages/scene.js";
import { MapPage, mapHref } from "./pages/map.js";
import { MilestonesPage } from "./pages/milestones.js";
import { ImagesPage } from "./pages/images.js";
import { PathbuilderPage } from "./pages/pathbuilder.js";
import { YourselvesPage } from "./pages/yourselves.js";
import { DoublesPage } from "./pages/doubles.js";
import { JournalPage } from "./pages/journal.js";
import { decode, searchHref } from "./canon.js";
import { TermTip } from "./term_tip.js";
import { Tracker } from "./turns.js";

// Site sections and their pages.
const SECTIONS = [
  {
    id: "canon",
    title: "Канон",
    pages: [
      { id: "read", title: "Пункты", component: ReaderPage, ownTitle: true },
      { id: "search", title: "Поиск", component: SearchPage, ownTitle: true },
      { id: "creatures", title: "Существа", component: CreaturesPage, ownTitle: true },
      { id: "hazards", title: "Опасности", component: HazardsPage, ownTitle: true },
      { id: "npcs", title: "НПС", component: NpcsPage, ownTitle: true },
      { id: "items", title: "Предметы", component: ItemsPage, ownTitle: true },
    ],
  },
  {
    id: "game",
    title: "Игра",
    pages: [
      { id: "world", title: "Состояние мира", component: WorldPage, ownTitle: true },
      { id: "rooms", title: "Комнаты", component: RoomsPage, ownTitle: true },
      { id: "encounters", title: "Случайные встречи", component: EncountersPage, ownTitle: true },
      { id: "scene", title: "Сцена", component: ScenePage, ownTitle: true },
      { id: "map", title: "Карта", component: MapPage, ownTitle: true },
      { id: "milestones", title: "Вехи", component: MilestonesPage, ownTitle: true },
      { id: "yourselves", title: "«Вы сами»", component: YourselvesPage, ownTitle: true },
      { id: "doubles", title: "Временные дубли", component: DoublesPage, ownTitle: true },
      { id: "journal", title: "Журнал", component: JournalPage },
    ],
  },
  {
    id: "tools",
    title: "Инструменты",
    pages: [
      { id: "saves", title: "Сохранения", component: SavesPage },
      { id: "pathbuilder", title: "Импорт из Pathbuilder", component: PathbuilderPage },
      { id: "images", title: "Картинки", component: ImagesPage },
      { id: "build-report", title: "Отчёт сборщика", component: BuildReportPage },
    ],
  },
];

// Route is "#/section/page/rest"; missing parts fall back to the first
// entry, and the rest goes to the page (the reader keeps "doc/section" there).
function parseRoute(hash) {
  const [sectionId, pageId, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const section = SECTIONS.find((s) => s.id === sectionId) || SECTIONS[0];
  const page = section.pages.find((p) => p.id === pageId) || section.pages[0];
  return { section, page, rest: rest.join("/") };
}

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return parseRoute(hash);
}

function Connection() {
  const status = useStore(getStatus);
  return html`
    <a href="#/tools/saves" class=${`connection ${status.connected ? "" : "bad"}`}>
      ${status.connected ? `записей: ${status.count}` : "нет связи"}
    </a>
  `;
}

// Search box of the top bar: typing opens the results page, and further
// typing replaces its address, so Back leaves the search in one step. On the
// results page the box follows the address (Back and Forward included).
function SearchBox({ page, rest }) {
  const onResults = page.id === "search";
  const [text, setText] = useState("");
  useEffect(() => { if (onResults) setText(decode(rest)); }, [onResults, rest]);
  const onInput = (e) => {
    setText(e.target.value);
    const href = searchHref(e.target.value.trim());
    if (onResults) location.replace(href);
    else location.hash = href;
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") e.target.blur();
    if (e.key === "Enter" && !onResults) location.hash = searchHref(text.trim());
  };
  return html`
    <input id="search" class="search-box" type="search" placeholder="Поиск по канону (Ctrl+K)"
           value=${text} onInput=${onInput} onKeyDown=${onKeyDown} />
  `;
}

function TopBar({ section, page, rest }) {
  return html`
    <header class="topbar">
      <span class="brand">Корабль Времени</span>
      <nav>
        ${SECTIONS.map((s) => html`
          <a href="#/${s.id}" class=${s === section ? "active" : ""}>${s.title}</a>
        `)}
      </nav>
      <${SearchBox} page=${page} rest=${rest} />
      <${Connection} />
    </header>
  `;
}

function PageNav({ section, page }) {
  return html`
    <nav class="pagenav">
      ${section.pages.map((p) => html`
        <a href="#/${section.id}/${p.id}" class=${p === page ? "active" : ""}>${p.title}</a>
      `)}
    </nav>
  `;
}

function Sidebar() {
  return html`
    <aside class="sidebar">
      <${Tracker} />
      <a class="sidebar-map" href=${mapHref()}>Карта Корабля</a>
    </aside>
  `;
}

// Ctrl+K puts the cursor in the search box. Ctrl+Z / Ctrl+Shift+Z (and
// Ctrl+Y) undo and redo site actions, but not while typing: there the
// browser's own text undo is expected. Physical key codes, so the shortcuts
// work in the Russian layout too.
function onKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  if (e.code === "KeyK" && !e.shiftKey) {
    e.preventDefault();
    document.getElementById("search")?.select();
    return;
  }
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  const redo = e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey);
  const action = redo ? redoLast : e.code === "KeyZ" ? undoLast : null;
  if (!action) return;
  e.preventDefault();
  action()?.catch((error) => alert(error.message));
}

function App() {
  const { section, page, rest } = useRoute();
  useEffect(() => {
    if (!page.ownTitle) document.title = `${page.title} — Корабль Времени`;
  }, [page]);
  useEffect(() => {
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const Page = page.component;
  return html`
    <${TopBar} section=${section} page=${page} rest=${rest} />
    <div class="layout">
      <${PageNav} section=${section} page=${page} />
      <main><${Page} page=${page} rest=${rest} /></main>
      <${Sidebar} />
    </div>
    <${TermTip} />
  `;
}

render(html`<${App} />`, document.getElementById("app"));
