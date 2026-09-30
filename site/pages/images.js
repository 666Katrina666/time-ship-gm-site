import { html, useEffect, useState } from "../vendor/htm-preact.js";
import { useCanon } from "../canon.js";
import { pictureOwners, shapeOf, useImages } from "../pictures.js";

// Tools -> Pictures: every file in site/img with the card it belongs to (by
// file name = card id) or the canon section that shows it as a scheme, the
// files nobody uses, and the cards still without a picture with the file name
// they expect.

const SHAPES = { tall: "полоса справа", wide: "баннер сверху", normal: "справа" };

function Row({ id, src, owner }) {
  const [size, setSize] = useState(null);
  const onLoad = (e) => setSize([e.target.naturalWidth, e.target.naturalHeight]);
  return html`
    <tr>
      <td><a href=${src} target="_blank" rel="noopener"><img class="thumb" src=${src} alt=${id} onLoad=${onLoad} /></a></td>
      <td><code>${decodeURIComponent(src.slice(4))}</code></td>
      <td>${size ? `${size[0]} × ${size[1]}` : "…"}</td>
      <td class="muted">${owner?.file ? "в тексте раздела" : size ? SHAPES[shapeOf(...size)] : ""}</td>
      <td>${owner
        ? html`<a href=${owner.href}>${owner.title}</a> <span class="muted">${owner.kind}</span>`
        : html`<span class="bad">не подключена</span>`}</td>
    </tr>
  `;
}

export function ImagesPage() {
  const { canon, error } = useCanon();
  const images = useImages();
  if (error) return html`<section class="page"><h1>Картинки</h1><p class="bad">${error}</p></section>`;
  if (!canon || !images) return html`<section class="page"><p class="muted">Загрузка…</p></section>`;
  const owners = new Map(pictureOwners(canon).map((o) => [o.id, o]));
  const files = Object.entries(images);
  const unused = files.filter(([id]) => !owners.has(id)).length;
  const missing = [...owners.values()].filter((o) => !images[o.id] && !(o.alt && images[o.alt]));
  return html`
    <section class="page">
      <h1>Картинки</h1>
      <p class="muted">
        Файлы из <code>site/img/</code>. Картинка попадает в карточку, если имя файла совпадает с id карточки; схему показывает раздел канона, который на неё ссылается.
        Новые файлы видны без перезапуска: обновите страницу.
      </p>
      <p>Файлов: ${files.length}, подключено: ${files.length - unused}, не подключено: ${unused}.</p>
      <div class="scroll">
        <table class="grid images">
          <thead><tr><th></th><th>Файл</th><th>Размер</th><th>Раскладка</th><th>Где</th></tr></thead>
          <tbody>
            ${files.map(([id, src]) => html`<${Row} key=${id} id=${id} src=${src} owner=${owners.get(id)} />`)}
          </tbody>
        </table>
      </div>
      <h2>Карточки без картинки</h2>
      ${missing.length === 0
        ? html`<p class="muted">Нет.</p>`
        : html`
          <ul class="doclist">
            ${missing.map((o) => html`
              <li key=${o.id}>
                <a href=${o.href}>${o.title}</a>
                <span class="muted">${o.kind}</span>
                <code>${o.file ?? `${o.id}.png`}</code>
              </li>
            `)}
          </ul>
        `}
    </section>
  `;
}
