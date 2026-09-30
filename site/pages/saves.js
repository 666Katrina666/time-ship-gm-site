import { html, useState } from "../vendor/htm-preact.js";
import { getStatus, importSave, newGame, useStore } from "../store.js";
import { journalHref } from "./journal.js";

// "Инструменты → Сохранения": the save in use, export, import and a new game.
// The events themselves are on the journal page.

function time(ts) {
  return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// Runs an action and shows its error instead of losing it in the console.
function useAction() {
  const [error, setError] = useState(null);
  const run = async (action) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e.message);
    }
  };
  return [error, run];
}

function Status() {
  const status = useStore(getStatus);
  const { save } = status;
  return html`
    <div class="card">
      <p>
        ${status.connected ? "Связь с сервером есть." : html`<b class="bad">Нет связи с сервером.</b> Действия не запишутся, пока сайт не запущен.`}
      </p>
      ${save && html`
        <p>
          Сохранение <code>${save.save}</code>, начато ${time(save.created)}.
          Записей: ${status.count}.
        </p>
        ${save.warning && html`<p class="bad">Внимание: ${save.warning}.</p>`}
      `}
    </div>
  `;
}

function Files({ run }) {
  const onImport = (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!confirm(`Загрузить «${file.name}»? Текущее сохранение уйдёт в архив saves/archive/.`)) return;
    run(async () => importSave(await file.text()));
  };
  const onNew = () => {
    if (!confirm("Начать новую игру? Текущее сохранение уйдёт в архив saves/archive/.")) return;
    run(newGame);
  };
  return html`
    <h2>Файлы</h2>
    <div class="row">
      <a class="button" href="/api/save/export" download>Экспорт</a>
      <label class="button">Импорт…<input type="file" accept=".jsonl" hidden onChange=${onImport} /></label>
      <button onClick=${onNew}>Новая игра</button>
    </div>
    <p class="muted">
      Каждое действие сразу пишется на диск в <code>saves/current.jsonl</code>.
      Импорт и новая игра ничего не стирают: прежнее сохранение переносится в архив.
    </p>
  `;
}

export function SavesPage() {
  const [error, run] = useAction();
  return html`
    <section class="page">
      <h1>Сохранения</h1>
      <${Status} />
      ${error && html`<p class="bad">${error}</p>`}
      <p>Записи, заметки, комментарии и отмена с экрана — в <a href=${journalHref()}>журнале</a>.</p>
      <${Files} run=${run} />
    </section>
  `;
}
