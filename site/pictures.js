import { html, useEffect, useState } from "./vendor/htm-preact.js";
import { sectionHref } from "./canon.js";

// The GM's pictures in site/img, named by the id of the card they belong to.
// The files are book illustrations cut to different sizes, so the picture
// takes its place by its own proportions: a tall strip goes to a narrow
// column on the right, a wide one becomes a banner above the text, others sit
// on the right. None is stretched beyond its size on the card; a click opens
// it over the whole window to look at the details.

const TALL = 1.8; // height / width at which a picture is a strip
const WIDE = 1.8; // width / height at which it is a banner

// { id: "img/<file>" } from the server, asked anew by every caller, so a new
// picture shows up without a restart.
export function useImages() {
  const [images, setImages] = useState(null);
  useEffect(() => {
    fetch("api/images").then((r) => (r.ok ? r.json() : {})).then(setImages, () => setImages({}));
  }, []);
  return images;
}

export function shapeOf(width, height) {
  if (!width || !height) return "normal";
  if (height / width >= TALL) return "tall";
  if (width / height >= WIDE) return "wide";
  return "normal";
}

// A scheme in the text of the canon: "![alt](site/img/<file>)".
const RE_FIGURE = /!\[[^\]]*\]\(site\/img\/([^)\s]+)\)/g;

// Every card that may have a picture: { id, title, kind, href, alt, file }.
// Each card page adds its kind here as it appears. An NPC with a
// stat block shows its creature's picture (`alt`) when it has none of its
// own; an NPC or an item whose id is a creature's shares the creature's entry.
// A scheme of the canon belongs to its section and names its file itself.
export function pictureOwners(canon) {
  const figures = canon.docs.flatMap((d) => d.sections.flatMap((s) =>
    [...s.text.matchAll(RE_FIGURE)].map(([, file]) => ({
      id: decodeURIComponent(file).replace(/\.[^.]*$/, ""), file: decodeURIComponent(file),
      title: `${d.short.split(".")[0]}, ${s.title}`, kind: "схема", href: sectionHref(d.id, s.key),
    }))));
  return [
    ...figures,
    ...canon.creatures.map((c) => ({
      id: c.id, title: c.name, kind: "существо", href: `#/canon/creatures/${encodeURIComponent(c.id)}`,
    })),
    ...canon.hazards.map((h) => ({
      id: h.id, title: h.name, kind: "опасность", href: `#/canon/hazards/${encodeURIComponent(h.id)}`,
    })),
    ...canon.npcs.filter((n) => n.id !== n.creature).map((n) => ({
      id: n.id, title: n.name, kind: "НПС", href: `#/canon/npcs/${encodeURIComponent(n.id)}`, alt: n.creature,
    })),
    ...canon.items.filter((i) => !canon.creatures.some((c) => c.id === i.id)).map((i) => ({
      id: i.id, title: i.name, kind: "предмет", href: `#/canon/items/${encodeURIComponent(i.id)}`,
    })),
    ...canon.rooms.map((r) => ({
      id: r.id, title: `${r.number}. ${r.title}`, kind: "комната", href: `#/game/rooms/${r.number}`,
    })),
  ];
}

export function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return html`
    <div class="lightbox" onClick=${onClose} title="Закрыть (Esc)">
      <img src=${src} alt=${alt} />
    </div>
  `;
}

export function Picture({ src, alt }) {
  const [shape, setShape] = useState(null);
  const [open, setOpen] = useState(false);
  const onLoad = (e) => setShape(shapeOf(e.target.naturalWidth, e.target.naturalHeight));
  return html`
    <img class=${`portrait ${shape ?? "loading"}`} src=${src} alt=${alt} title="Открыть в полном размере"
         onLoad=${onLoad} onClick=${() => setOpen(true)} />
    ${open && html`<${Lightbox} src=${src} alt=${alt} onClose=${() => setOpen(false)} />`}
  `;
}
