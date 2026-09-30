import { html, useEffect, useLayoutEffect, useRef, useState } from "./vendor/htm-preact.js";

// Panels of different heights in balanced columns. As many columns of at
// least `min` px fit the box; each panel, in order, goes to the column that
// is shortest so far, so the columns end at about the same height and the
// order still reads left to right, top to bottom.
//
// Heights are measured after render: all columns have one width, so a panel
// is as tall in any of them. The layout is set before paint (layout effect),
// so the extra passes are invisible.
//
// - A new number of columns or a new set of panels (a resize, a filter) lays
//   everything out again.
// - A panel that grows or shrinks keeps its place, and so does every panel
//   before it; only the panels after it are laid out again. The panel being
//   worked on and everything above it never jump; panels below it may move to
//   keep the columns even.
//
// Before measuring, the layout sends MEASURE on document, so content that
// sizes itself (a note that grows with its text) can fit the current column
// width first: the panels are then measured as they will stay.
//
// items: [{ key, node }]; a panel without a place yet waits in the first
// column for one pass.

export const MEASURE = "masonry-measure";

const SLACK = 2;  // px of height change that is not worth a new layout

// Places items[from..] greedily after the fixed places of items[..from).
function arrange(items, n, gap, heightOf, fixed, from) {
  const heights = new Array(n).fill(0);
  const place = {};
  items.forEach(({ key }, i) => {
    const column = i < from ? fixed[key] : heights.indexOf(Math.min(...heights));
    place[key] = column;
    heights[column] += heightOf(key) + gap;
  });
  return place;
}

export function Masonry({ items, min = 420, gap = 16 }) {
  const box = useRef(null);
  const panels = useRef(new Map());    // key → element
  const measured = useRef(new Map());  // key → height the current layout was made with
  const done = useRef(null);           // columns and panels the current layout was measured for
  const refs = useRef(new Map());      // key → stable ref callback
  const [layout, setLayout] = useState({ n: 1, place: {} });
  const [, redraw] = useState(0);

  // One observer for the box (width) and the panels (height). It asks for a
  // new pass only when a panel is no longer as tall as it was laid out.
  const observer = useRef(null);
  if (!observer.current && typeof ResizeObserver !== "undefined") {
    observer.current = new ResizeObserver((entries) => {
      const changed = entries.some(({ target }) => target === box.current || [...panels.current]
        .some(([key, el]) => el === target && Math.abs(el.offsetHeight - (measured.current.get(key) ?? -1)) > SLACK));
      if (changed) redraw((t) => t + 1);
    });
  }
  useEffect(() => {
    observer.current?.observe(box.current);
    return () => observer.current?.disconnect();
  }, []);

  useLayoutEffect(() => {
    document.dispatchEvent(new Event(MEASURE));
    const keys = new Set(items.map((i) => i.key));
    for (const [key, el] of panels.current) {
      if (!keys.has(key)) { observer.current?.unobserve(el); panels.current.delete(key); }
    }
    const n = Math.max(1, Math.floor((box.current.clientWidth + gap) / (min + gap)));
    const heightOf = (key) => panels.current.get(key)?.offsetHeight ?? 0;
    const sign = `${n}|${items.map((i) => i.key).join("|")}`;
    let place;
    if (sign !== done.current) {
      place = arrange(items, n, gap, heightOf, {}, 0);
      // With a new number of columns the panels were measured at the old
      // width: lay them out anyway and measure again on the next pass.
      if (n === layout.n) done.current = sign;
    } else {
      const first = items.findIndex(({ key }) => Math.abs(heightOf(key) - (measured.current.get(key) ?? -1)) > SLACK);
      if (first < 0) return;
      place = arrange(items, n, gap, heightOf, layout.place, first + 1);
    }
    measured.current = new Map(items.map(({ key }) => [key, heightOf(key)]));
    if (n !== layout.n || items.some(({ key }) => place[key] !== layout.place[key])) setLayout({ n, place });
  });

  const keep = (key) => {
    if (!refs.current.has(key)) {
      // A panel moving to another column may get its new element before the
      // old one is let go, so null is ignored and gone panels are pruned below.
      refs.current.set(key, (el) => {
        const old = panels.current.get(key);
        if (!el || el === old) return;
        if (old) observer.current?.unobserve(old);
        panels.current.set(key, el);
        observer.current?.observe(el);
      });
    }
    return refs.current.get(key);
  };
  const columns = Array.from({ length: layout.n }, () => []);
  for (const item of items) columns[Math.min(layout.place[item.key] ?? 0, layout.n - 1)].push(item);
  return html`
    <div class="masonry" ref=${box} style=${{ gap: `${gap}px` }}>
      ${columns.map((column, c) => html`
        <div key=${c} class="masonry-column" style=${{ gap: `${gap}px` }}>
          ${column.map(({ key, node }) => html`<div key=${key} ref=${keep(key)}>${node}</div>`)}
        </div>
      `)}
    </div>
  `;
}
