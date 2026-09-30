"""Items of the canon with their knowledge layers, for the Game Master site.

Part of site_build.py: finds the "**Слои знаний.**" blocks of P12 and returns
the items they belong to as items of canon.json. The block has one shape
(P12, 24.4 "Блок слоёв у предмета"): a line naming the action, skill and DC,
then a table of degrees and what the character learns at each.

A block stands at the end of the item's section, or in its last subsection
(the Rod's layers are in "Магия и копирование"). The item is the nearest
section, the block's own or above, whose first line is the item header:
"**Категории:** …", "**Категория: …**" or "**Предмет 8-го уровня, …**". A
section without such a header is an item itself (the Jaw in 19.6).
Section 24.4 holds the pattern of the block, not an item, and is skipped.

The block's section may hold a paragraph "**Подробно** …" with links to the
sections elsewhere in the canon about the item (P5 for the Crystal and the
Bracelet, section 25 for the replicator); the card folds them, and the
"Общие правила" subsection of the item's top section (18, 20) comes first.

The Dog and the Posthuman of section 18 are not items: their blocks are for
parts taken from a creature's body, which the canon calls built-in systems and
body parts. Their layers go to the creature of the same name as its parts.
"""

import re

from site_creatures import RE_TITLE_NUMBER, SHARED_RULES, plain_title, slug
from site_npcs import more_links

ITEMS_DOC = "p12"
PATTERN = "24.4"  # the rules section that shows the block as a pattern
BODY_PARTS = {"Механический Пёс", "Постчеловек"}  # sections on a creature's parts, not items
BLOCK = "**Слои знаний.**"
MORE = "**Подробно**"
RE_HEADER = re.compile(r"^\*\*(Категори|Предмет\s)")
# Longest first: "Критический успех" before "Успех".
DEGREES = ["Критический успех", "Критический провал", "Без проверки", "Не узнаётся", "Успех"]


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def split_block(text):
    """(check, rows, rest, more) of a section holding a block, or None.

    check is the markdown after "**Слои знаний.**"; rows are the table rows
    as (label, text); rest is the section text without the block and without
    the "**Подробно**" paragraph, whose markdown is more (or None).
    """
    lines = text.split("\n")
    start = next((i for i, line in enumerate(lines) if line.startswith(BLOCK)), None)
    if start is None:
        return None
    end = start + 1
    while end < len(lines) and lines[end].strip() and not lines[end].startswith("|"):
        end += 1
    check = " ".join(line.strip() for line in lines[start:end])[len(BLOCK):].strip()
    while end < len(lines) and not lines[end].strip():
        end += 1
    rows = []
    table = end
    while end < len(lines) and lines[end].startswith("|"):
        end += 1
    for line in lines[table + 2:end]:  # the header and the |---| line are skipped
        row = cells(line)
        if len(row) >= 2:
            rows.append((row[0], " | ".join(row[1:])))
    rest = [line for line in lines[:start] + lines[end:] if line.strip() != "---"]
    more = next((line.strip()[len(MORE):].strip() for line in rest if line.strip().startswith(MORE)), None)
    rest = "\n".join(line for line in rest if not line.strip().startswith(MORE)).strip()
    return check, rows, rest, more


def first_line(section):
    return next((line.strip() for line in section["text"].splitlines() if line.strip()), "")


def find_items(docs, creatures, problem, taken):
    """(items, parts) of P12 with knowledge layers, in canon order; problems go through `problem`.

    `taken` maps the ids of the other cards (creatures, hazards, NPCs) to
    their names: pictures lie in one folder. An item may share its id only
    with a creature of the same name (the Jaw), and then one picture serves
    both cards.

    Each item: id (slug of the name, the image file name), doc, key (the item
    section), group (its top section, "18. Трофейная технология …"), name,
    check (markdown: action, skill, DC and remarks), layers ([{label, degree,
    text}] in table order; label keeps the row as written, "Успех, Ремесло
    КС 15", and is the key of the players' mark), block (the section of the
    block), rest (that section's text without the block, markdown) and more
    ([{doc, key}]: the "Общие правила" of the top section, then the links of
    "**Подробно**"; may be empty).

    parts maps the id of a creature of BODY_PARTS to the layers of its body
    parts: doc, key (the section), check and layers as above. A name of
    BODY_PARTS missing from P12 is a warning, one without a creature an error.
    """
    doc = next((d for d in docs if d["id"] == ITEMS_DOC), None)
    if not doc:
        return [], {}
    by_key = {s["key"]: s for s in doc["sections"]}
    creature_ids = {c["id"] for c in creatures}

    def ancestors(section):
        while section:
            yield section
            section = by_key.get(section["parent"])

    items, parts, owners, ids, skipped = [], {}, {}, dict(taken), set()
    for section in doc["sections"]:
        if BLOCK not in section["text"] or any(a["number"] == PATTERN for a in ancestors(section)):
            continue
        where = (doc["file"], section["line"])
        found = split_block(section["text"])
        if not found:  # the words stand inside a line: a mention, not a block
            continue
        owner = next((a for a in ancestors(section) if RE_HEADER.match(first_line(a))), section)
        name = RE_TITLE_NUMBER.sub("", owner["title"]).strip()
        if section["text"].count(BLOCK) > 1 or owner["key"] in owners:
            problem("error", *where, f"у предмета «{name}» больше одного блока слоёв знаний", section["title"])
            continue
        check, rows, rest, more_text = found
        more, missing = more_links(more_text or "", doc, docs)
        for key in missing:
            problem("error", *where, f"у предмета «{name}» ссылка «Подробно» не нашла раздел «{key}»",
                    section["title"])
        if not rows:
            problem("warning", *where, f"у предмета «{name}» в блоке слоёв нет таблицы", section["title"])
        layers, labels = [], set()
        for label, text in rows:
            degree = next((d for d in DEGREES if label.startswith(d)), None)
            if degree is None:
                problem("warning", *where, f"у предмета «{name}» непонятная степень «{label}»", section["title"])
            if label in labels:
                problem("error", *where, f"у предмета «{name}» строка «{label}» повторяется", section["title"])
            labels.add(label)
            layers.append({"label": label, "degree": degree, "text": text})

        if name in BODY_PARTS:
            skipped.add(name)
            if slug(name) not in creature_ids:
                problem("error", *where, f"у частей тела «{name}» нет существа с таким именем", section["title"])
            else:
                parts[slug(name)] = {"doc": doc["id"], "key": owner["key"], "check": check, "layers": layers}
            continue
        item_id = slug(name)
        if item_id in ids and item_id not in creature_ids:
            problem("error", *where, f"id предмета «{item_id}» уже занят: «{ids[item_id]}»", section["title"])
        ids[item_id] = name
        owners[owner["key"]] = item_id
        group = next(a for a in ancestors(owner) if a["level"] <= 2)
        rules = next((x for x in doc["sections"] if x["parent"] == group["key"]
                      and plain_title(x["title"]) == SHARED_RULES), None)
        if rules:
            more.insert(0, {"doc": doc["id"], "key": rules["key"]})
        items.append({
            "id": item_id, "doc": doc["id"], "key": owner["key"], "group": group["key"], "name": name,
            "check": check, "layers": layers, "block": section["key"], "rest": rest, "more": more,
        })
    for name in sorted(BODY_PARTS - skipped):
        problem("warning", doc["file"], 1, f"раздела «{name}» со слоями знаний частей тела нет", name)
    return items, parts
