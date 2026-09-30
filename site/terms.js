// PF2 conditions and traits of the glossary (section 8, "Состояния" and
// "Признаки"), marked in the rendered canon for the hover tooltip.
//
// A condition is marked anywhere in the text and in its declined forms: the
// canon declines them in prose ("существо оглушено", "получает тошноту 1").
// A trait is marked only in a stat block line "**Признаки:** …": as plain
// words traits are everywhere ("огонь", "средний", "животное").
//
// Marking works on the HTML of renderMarkdown, so a card of any page can use
// it: <span class="term" data-term="c:3">испуган 1</span>, where "c:3" is the
// third condition of canon.terms ("t:" for traits).

const ADJ = "(?:ый|ий|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ой|ей|ую|юю|ыми|ими|ом|ем)";
const HARD = "(?:ый|ая|ое|ые|ого|ому|ым|ых|ой|ую|ыми|ом)";
// Short and full participle and the noun in "-ность": "оглушён", "оглушена",
// "оглушённый", "обречённость".
const PARTICIPLE = `(?:[аоы]|н?${HARD}|н?ност(?:ь|и|ью))?`;
// The noun of a participle in "-ен": "истощение", "ослепления". The canon
// names conditions so in immunity lists and hazard effects.
const NOUN = "ени(?:е|я|ю|ем|и)";

// Conditions whose generic forms would catch plain words.
const FORMS = {
  "умирает N": "умира(?:ет|ющ\\p{L}*)",
  // "раненых" and "ранение" are plain words; only the short forms are the condition.
  "ранен N": "ранен[аоы]?",
};
// Other names of a condition that glossary section 2 allows.
const ALIASES = {
  "утомлён": ["усталость"],
  "продолжительный урон": ["продолжительное кровотечение"],
};
// Inside these tags nothing is marked: spell names are italic (*Замедление*
// is not "замедлен"), links and code keep their own meaning.
const SKIP = new Set(["a", "code", "em", "pre"]);
const TRAIT_LINE = "Признаки:";

const yo = (s) => s.replace(/[её]/g, "[её]");

// Declined forms of one word by its ending; short words stay as they are.
function wordPattern(word) {
  const w = word.toLowerCase();
  if (w.length <= 3 || /[яи]$/.test(w)) return yo(w); // "без", "ног", "сознания"
  if (/[её]н$/.test(w)) return `(?:${yo(w)}${PARTICIPLE}|${yo(w.slice(0, -2))}${NOUN})`; // "истощён"
  if (/[нт]$/.test(w)) return yo(w) + PARTICIPLE; // "сломан", "застигнут", "урон"
  if (/[нт]о$/.test(w)) return yo(w.slice(0, -1)) + PARTICIPLE; // "затуманено"
  if (/(?:ый|ий|ая|ое|ее)$/.test(w)) return yo(w.slice(0, -2)) + ADJ; // "продолжительный"
  if (/а$/.test(w)) return yo(w.slice(0, -1)) + "(?:а|ы|е|у|ой)"; // "тошнота"
  if (/ь$/.test(w)) return yo(w.slice(0, -1)) + "(?:ь|и|ью)"; // "неуклюжесть"
  if (/е$/.test(w)) return yo(w.slice(0, -1)) + "(?:е|я|ю|ем|и)"; // "зрение"
  if (/х$/.test(w)) return yo(w) + `(?:ла|ло|ли|ш${ADJ})?`; // "оглох", "оглохшим"
  return yo(w);
}

function phrasePattern(name) {
  return name.split(/\s+/).map(wordPattern).join("\\s+");
}

// "испуган N" -> forms of "испуган" with an optional value: "испуган 1".
function conditionPattern(name) {
  const valued = name.endsWith(" N");
  const base = valued ? name.slice(0, -2) : name;
  const forms = [FORMS[name] ?? phrasePattern(base), ...(ALIASES[base] ?? []).map(phrasePattern)];
  return `(?:${forms.join("|")})${valued ? "(?:\\s\\d+(?!\\d))?" : ""}`;
}

const cache = new WeakMap();

// Patterns of canon.terms, built once per loaded canon.
export function termIndex(canon) {
  if (cache.has(canon)) return cache.get(canon);
  const { conditions, traits } = canon.terms;
  const order = conditions.items.map((_, i) => i);
  // At one place the longer phrase wins: "без сознания" before a single word.
  order.sort((a, b) => conditions.items[b].name.length - conditions.items[a].name.length);
  const re = new RegExp(
    `(?<![\\p{L}\\d])(?:${order.map((i) => `(${conditionPattern(conditions.items[i].name)})`).join("|")})(?!\\p{L})`,
    "giu",
  );
  const traitIds = new Map(traits.items.map((t, i) => [t.name.toLowerCase(), i]));
  const index = { canon, re, order, traitIds };
  cache.set(canon, index);
  return index;
}

// { kind, term } of a marked element's data-term, or null.
export function termOf(canon, id) {
  const [kind, n] = (id || "").split(":");
  const list = kind === "c" ? canon.terms.conditions : kind === "t" ? canon.terms.traits : null;
  const term = list?.items[Number(n)];
  return term ? { kind: kind === "c" ? "condition" : "trait", term } : null;
}

const span = (id, text) => `<span class="term" data-term="${id}">${text}</span>`;

function markConditions(text, index) {
  return text.replace(index.re, (all, ...groups) => {
    const g = groups.findIndex((v, k) => k < index.order.length && v !== undefined);
    return span(`c:${index.order[g]}`, all);
  });
}

// " средний, гуманоид  " after "**Признаки:**"; a note after a dash
// ("— по заклинанию …") stays as it is.
function markTraits(text, index) {
  const cut = text.indexOf(" — ");
  const list = cut < 0 ? text : text.slice(0, cut);
  const marked = list.replace(/[^,]+/g, (piece) => {
    const name = piece.trim();
    const i = index.traitIds.get(name.toLowerCase());
    return i === undefined ? piece : piece.replace(name, span(`t:${i}`, name));
  });
  return marked + (cut < 0 ? "" : text.slice(cut));
}

// HTML of renderMarkdown with the terms marked.
export function markTermsHtml(html, canon) {
  if (!canon.terms) return html;
  const index = termIndex(canon);
  const parts = html.split(/(<[^>]*>)/);
  let skip = 0;
  for (let k = 0; k < parts.length; k += 2) {
    if (k > 0) {
      const tag = /^<(\/?)(\w+)/.exec(parts[k - 1]);
      if (tag && SKIP.has(tag[2])) skip = Math.max(0, skip + (tag[1] ? -1 : 1));
    }
    if (skip || !parts[k]) continue;
    const traitLine = parts[k - 1] === "</strong>" && parts[k - 2] === TRAIT_LINE && parts[k - 3] === "<strong>";
    parts[k] = traitLine ? markTraits(parts[k], index) : markConditions(parts[k], index);
  }
  return parts.join("");
}
