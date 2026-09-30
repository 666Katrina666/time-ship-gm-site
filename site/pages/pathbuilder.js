import { html, useState } from "../vendor/htm-preact.js";
import { useCanon } from "../canon.js";
import { dispatch, useStore } from "../store.js";
import { levelOf } from "../encounters.js";
import {
  NUMBERS, classLine, fromPathbuilder, importCharacter, looksConsumable, partyState,
} from "../party.js";

// "Инструменты → Импорт из Pathbuilder": a player's export becomes a
// character of the party (site/party.js). The GM picks the file, checks the
// numbers the site derived, marks which equipment the site counts, adds
// counters the export does not have and sends the import. A file of a
// character already in the party updates that character.

// The draft of one import: what the file gave and what the GM changed.
function draftOf(build, list) {
  const same = list.find((pc) => pc.build.name === build.name);
  const old = new Map((same?.counters ?? []).map((c) => [c.name, c]));
  const names = new Set(build.equipment.map((e) => e.name));
  return {
    build,
    target: same?.id ?? null,
    numbers: { ...build.derived },
    // A re-import keeps the GM's earlier choice; a new character gets the first guess.
    counted: Object.fromEntries(build.equipment.map((e) => [e.name, same ? old.has(e.name) : looksConsumable(e.name)])),
    own: (same?.counters ?? []).filter((c) => !names.has(c.name)),
  };
}

function Numbers({ draft, setDraft }) {
  const set = (key, value) => setDraft({ ...draft, numbers: { ...draft.numbers, [key]: value } });
  return html`
    <table class="grid pb-numbers">
      <thead><tr><th></th><th>по экспорту</th><th>на сайте</th></tr></thead>
      <tbody>
        ${NUMBERS.map(([key, label]) => {
          const changed = draft.numbers[key] !== draft.build.derived[key];
          return html`
            <tr key=${key} class=${changed ? "changed" : ""}>
              <td>${label}</td>
              <td>${draft.build.derived[key]}</td>
              <td><input type="number" value=${draft.numbers[key]}
                         onInput=${(e) => set(key, e.target.value === "" ? "" : Number(e.target.value))} /></td>
            </tr>`;
        })}
      </tbody>
    </table>
  `;
}

function Counters({ draft, setDraft }) {
  const [name, setName] = useState("");
  const [max, setMax] = useState(1);
  const toggle = (item) => setDraft({ ...draft, counted: { ...draft.counted, [item]: !draft.counted[item] } });
  const add = () => {
    const clean = name.trim();
    if (!clean || max < 1 || draft.own.some((c) => c.name === clean) || draft.counted[clean] !== undefined) return;
    setDraft({ ...draft, own: [...draft.own, { name: clean, max: Number(max) }] });
    setName("");
    setMax(1);
  };
  const drop = (c) => setDraft({ ...draft, own: draft.own.filter((x) => x !== c) });
  return html`
    <h3>Расходники</h3>
    <p class="muted">Pathbuilder не отмечает расходники. Отмеченная вещь станет счётчиком с числом из экспорта;
      первые отметки — догадка по названию.</p>
    <div class="scroll">
      <table class="grid pb-equipment">
        <thead><tr><th>Счётчик</th><th>Снаряжение</th><th>Сколько</th></tr></thead>
        <tbody>
          ${draft.build.equipment.map((e) => html`
            <tr key=${e.name} class=${draft.counted[e.name] ? "counted" : ""}>
              <td><input type="checkbox" checked=${draft.counted[e.name]} onChange=${() => toggle(e.name)}
                         aria-label=${`Считать «${e.name}»`} /></td>
              <td>${e.name}</td>
              <td>${e.qty}</td>
            </tr>`)}
        </tbody>
      </table>
    </div>
    <h3>Свои счётчики</h3>
    <p class="muted">То, чего нет в экспорте: например, временные талисманы, которые тавматург делает на каждой подготовке.</p>
    ${draft.own.length > 0 && html`
      <ul class="pb-own">
        ${draft.own.map((c) => html`
          <li key=${c.name}>${c.name} — ${c.max} <button class="small" onClick=${() => drop(c)}>убрать</button></li>`)}
      </ul>`}
    <div class="row">
      <input placeholder="Название" value=${name} onInput=${(e) => setName(e.target.value)}
             onKeyDown=${(e) => { if (e.key === "Enter") add(); }} />
      <input type="number" min="1" class="pb-count" value=${max} onInput=${(e) => setMax(Number(e.target.value))}
             aria-label="Сколько" />
      <button onClick=${add} disabled=${!name.trim() || max < 1}>добавить</button>
    </div>
  `;
}

function Draft({ draft, setDraft, list, partyLevel, onDone }) {
  const [error, setError] = useState(null);
  const { build } = draft;
  const bad = NUMBERS.some(([key]) => !Number.isInteger(draft.numbers[key]));
  const send = async () => {
    setError(null);
    const counters = [
      ...build.equipment.filter((e) => draft.counted[e.name]).map((e) => ({ name: e.name, max: e.qty })),
      ...draft.own,
    ];
    try {
      await importCharacter(draft.target, { ...build, numbers: draft.numbers }, counters);
      onDone();
    } catch (e) {
      setError(e.message);
    }
  };
  return html`
    <section class="card pb-draft">
      <h2>${build.name}</h2>
      <p>${classLine(build)} · ${[build.ancestry, build.heritage].filter(Boolean).join(", ")}${
        build.background && ` · ${build.background}`}</p>
      ${build.level !== partyLevel && html`
        <p class="bad">Уровень персонажа ${build.level}, уровень партии ${partyLevel}.</p>`}
      <div class="row">
        <label for="pb-target">Куда:</label>
        <select id="pb-target" value=${draft.target ?? ""}
                onChange=${(e) => setDraft({ ...draft, target: e.target.value || null })}>
          <option value="">новый персонаж</option>
          ${list.map((pc) => html`<option value=${pc.id}>обновить ${pc.build.name}</option>`)}
        </select>
      </div>
      ${draft.target !== null && html`
        <p class="muted">Обновление меняет сборку и счётчики, а полученный урон и прочее состояние персонажа остаются.</p>`}
      <h3>Числа</h3>
      <p class="muted">Сайт считает по базовым правилам: бонусы предметов, руны и черты вроде Incredible Initiative
        в экспорте не читаются. Сверьте с листом персонажа и поправьте.</p>
      <${Numbers} draft=${draft} setDraft=${setDraft} />
      <${Counters} draft=${draft} setDraft=${setDraft} />
      <div class="row">
        <button onClick=${send} disabled=${bad}>${draft.target === null ? "импортировать" : "обновить персонажа"}</button>
        <button onClick=${onDone}>отмена</button>
      </div>
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

function Character({ pc }) {
  const [error, setError] = useState(null);
  const b = pc.build;
  const remove = () => {
    if (!confirm(`Удалить ${b.name} из партии? Это для ошибочного импорта; отменить можно через Ctrl+Z.`)) return;
    dispatch("pc-remove", { id: pc.id, name: b.name }).catch((e) => setError(e.message));
  };
  const money = Object.entries(b.money).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(" ");
  return html`
    <section class="card pb-character">
      <div class="row">
        <h2>${b.name}</h2>
        <span class="muted">${classLine(b)} · ${[b.ancestry, b.heritage].filter(Boolean).join(", ")}</span>
        <button class="small pb-remove" onClick=${remove}>удалить</button>
      </div>
      <p class="pb-stats">
        ${NUMBERS.map(([key, label]) => html`
          <span key=${key} title=${b.numbers[key] !== b.derived[key] ? `по экспорту ${b.derived[key]}` : ""}
                class=${b.numbers[key] !== b.derived[key] ? "changed" : ""}>${label} <strong>${b.numbers[key]}</strong></span>`)}
      </p>
      ${b.casters.map((c) => html`
        <p key=${c.name}>${c.name}${c.tradition && `, ${c.tradition}`}: ${c.slots.map((s) => `${s.rank}-й ранг ×${s.count}`).join(", ")}</p>`)}
      ${b.focus.max > 0 && html`<p>Фокус: ${b.focus.max}${b.focus.spells.length ? ` (${b.focus.spells.join(", ")})` : ""}</p>`}
      <p>Счётчики: ${pc.counters.length ? pc.counters.map((c) => `${c.name} ${c.max}`).join(", ") : html`<span class="muted">нет</span>`}</p>
      <p class="muted">
        ${[...b.weapons, ...b.armor.map((x) => x.name + (x.worn ? "" : " (не надет)"))].join(", ")}${money && ` · ${money}`}
      </p>
      ${error && html`<p class="bad">${error}</p>`}
    </section>
  `;
}

export function PathbuilderPage() {
  const { canon } = useCanon();
  const { list } = useStore(partyState);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const partyLevel = canon?.encounters ? levelOf(canon).level : null;
  const onFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setDraft(draftOf(fromPathbuilder(await file.text()), list));
    } catch (err) {
      setError(`${file.name}: ${err.message}`);
    }
  };
  return html`
    <section class="page">
      <h1>Импорт из Pathbuilder</h1>
      <p class="muted">Файл — экспорт Pathbuilder 2e (Export JSON). Персонаж попадает в журнал событий:
        его можно отменить, и он уходит вместе с сохранением. Экспорт после повышения до 4-го уровня
        обновляет того же персонажа.</p>
      <div class="row">
        <label class="button">
          выбрать файл экспорта
          <input type="file" accept=".json,application/json" hidden onChange=${onFile} />
        </label>
      </div>
      ${error && html`<p class="bad">${error}</p>`}
      ${draft && html`<${Draft} draft=${draft} setDraft=${setDraft} list=${list} partyLevel=${partyLevel}
                                 onDone=${() => setDraft(null)} />`}
      <h2>Партия</h2>
      ${list.length === 0
        ? html`<p class="muted">Персонажей ещё нет.</p>`
        : list.map((pc) => html`<${Character} key=${pc.id} pc=${pc} />`)}
    </section>
  `;
}
