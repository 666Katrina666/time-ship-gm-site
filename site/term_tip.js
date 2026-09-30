import { html, useEffect, useLayoutEffect, useRef, useState } from "./vendor/htm-preact.js";
import { canonLinks, loadCanon, sectionHref } from "./canon.js";
import { renderInline } from "./markdown.js";
import { termOf } from "./terms.js";

// Tooltip of a PF2 term marked by terms.js, one for the whole site. It opens
// on hover and stays while the pointer is on the term or the tooltip, so the
// links inside can be clicked. A click on the term pins it (the way on a
// touch screen); a click elsewhere, Escape or leaving the page closes it.

const OPEN_DELAY = 150;
const CLOSE_DELAY = 250;
const GAP = 6;

const KIND = { condition: "состояние", trait: "признак" };

function Content({ canon, kind, term }) {
  const glossary = canon.byId.get(canon.terms.doc);
  const text = renderInline(term.text, canonLinks(canon, glossary));
  const key = canon.terms[kind === "condition" ? "conditions" : "traits"].key;
  return html`
    <div class="tip-head">
      <strong>${term.name}</strong>
      ${term.en && html`<span class="muted">${term.en}</span>`}
      <span class="tip-kind">${KIND[kind]}</span>
    </div>
    <div class="tip-text" dangerouslySetInnerHTML=${{ __html: text }} />
    <div class="tip-links">
      ${term.href && html`<a href=${term.href} target="_blank" rel="noopener">Archives of Nethys</a>`}
      <a href=${sectionHref(canon.terms.doc, key)}>словарь</a>
    </div>
  `;
}

export function TermTip() {
  const [tip, setTip] = useState(null); // { canon, kind, term, rect }
  const box = useRef(null);
  const timer = useRef(0);
  const current = useRef(null); // the marked element the tooltip belongs to
  const pinned = useRef(false);

  useEffect(() => {
    const later = (fn, delay) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(fn, delay);
    };
    const open = (el, pin) => loadCanon().then((canon) => {
      const found = termOf(canon, el.dataset.term);
      if (!found || !el.isConnected) return;
      current.current = el;
      pinned.current = pin;
      setTip({ canon, ...found, rect: el.getBoundingClientRect() });
    });
    const close = () => {
      clearTimeout(timer.current);
      current.current = null;
      pinned.current = false;
      setTip(null);
    };
    const onOver = (e) => {
      const el = e.target.closest?.(".term");
      if (el) {
        if (el !== current.current) later(() => open(el, false), OPEN_DELAY);
        else clearTimeout(timer.current);
      } else if (e.target.closest?.(".tip")) {
        clearTimeout(timer.current);
      }
    };
    const onOut = (e) => {
      const from = e.target.closest?.(".term, .tip");
      const to = e.relatedTarget?.closest?.(".term, .tip");
      if (!from || from === to || pinned.current) return;
      // Leaving a term before its tooltip opened cancels the opening.
      if (current.current) later(close, CLOSE_DELAY);
      else clearTimeout(timer.current);
    };
    const onClick = (e) => {
      const el = e.target.closest?.(".term");
      if (el) {
        clearTimeout(timer.current);
        open(el, true);
      } else if (!e.target.closest?.(".tip")) {
        close();
      }
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    addEventListener("hashchange", close);
    // The term moves away under a fixed tooltip: close it instead of chasing.
    addEventListener("scroll", close, true);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      removeEventListener("hashchange", close);
      removeEventListener("scroll", close, true);
    };
  }, []);

  // Below the term, or above it if there is no room; always inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const { rect } = tip;
    const width = el.offsetWidth, height = el.offsetHeight;
    const below = rect.bottom + GAP + height <= innerHeight || rect.top - GAP - height < 0;
    el.style.top = `${below ? rect.bottom + GAP : rect.top - GAP - height}px`;
    el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    el.style.visibility = "visible";
  }, [tip]);

  if (!tip) return null;
  return html`
    <div class="tip" ref=${box} role="tooltip" style="visibility: hidden">
      <${Content} canon=${tip.canon} kind=${tip.kind} term=${tip.term} />
    </div>
  `;
}
