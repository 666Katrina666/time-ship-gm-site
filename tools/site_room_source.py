"""Source descriptions of the rooms for the Game Master site.

Part of site_build.py (step 3.12h). P13 is only the PF2 overlay; what a room
holds, where its exits go and what is heard there is written in the source,
korabl_vremeni_ocr.md, which is not a site file. This module cuts the source
by its headings "## N. Название" from room 1 up to "# Вопросы к Рефери", glues
on the pieces "## N. Название — продолжение", drops the page marks
"# Страница N" and gives each room of P13 its source by number, not by name.

The text stays as the source writes it: its slips are settled in the
discrepancy log, and the overlay outranks it (P13, 0.4).

Blocks of creatures, NPCs and items pasted into a room are cut and replaced by
a link to their card. BLOCKS says which card each block heading stands for:
the source names them its own way ("Брошь" for "Брошь с самоедом", "Хрустальные
пауки" for "Хрустальный Паук"), so the card is written down, not guessed. A
creature block (plain heading) runs up to its stat line "**КБ …" and the list
under it; an item or lore block (heading in italics) runs over its italic
paragraphs and italic list lines. After a block the room text may go on
without a heading, as the Ultrasonic Spear in the Arsenal 25 after the Knife;
"X — продолжение" of a block heading carries the block on. The headings in
KEPT stay in the room as its own subheadings. Any other heading inside a room
is a builder error, so nothing is dropped silently.
"""

import os
import re

SOURCE = "korabl_vremeni_ocr.md"
END = "# Вопросы к Рефери"
CONTINUED = " — продолжение"
RE_PAGE = re.compile(r"^# Страница \d+$")
RE_ROOM = re.compile(r"^## (\d+)\.\s+(.+)$")
RE_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
RE_ITALIC_ITEM = re.compile(r"^(\d+\.|-)\s+\*")
STAT = "**КБ"

# Block heading as the source writes it -> (kind, card id).
BLOCKS = {
    "Птеродактиль": ("creatures", "pterodaktil"),
    "Хрустальные пауки": ("creatures", "khrustalnyy-pauk"),
    "*Хрустальный Браслет*": ("items", "khrustalnyy-braslet"),
    "*Темпоральный Жезл*": ("items", "temporalnyy-zhezl"),
    "*Сарежейн*": ("npcs", "sarezheyn"),
    "Сарежейн": ("creatures", "sarezheyn"),
    "Кузина": ("creatures", "kuzina"),
    "*Отслеживающий Нож*": ("items", "otslezhivayushchiy-nozh"),
    "*Шлем*": ("items", "shlem"),
    "*Флейта*": ("items", "fleyta"),
    "*Брошь*": ("items", "brosh-s-samoedom"),
    "*Сфера*": ("items", "zerkalnaya-sfera"),
    "*Диск*": ("items", "disk-soznaniya"),
    "*Челюсть*": ("items", "chelyust"),
    "Механический Пёс": ("creatures", "mekhanicheskiy-pes"),
    "Ракоскорпион": ("creatures", "rakoskorpion"),
}
# Subheadings of a room that are its own text, not a card's block.
KEPT = {
    "Нажатие на любую кнопку пульта тратит один заряд Силового Кристалла и вызывает (d20):",
}


def plain(title):
    return title.strip("*").strip()


def read_rooms(lines, problem):
    """{number: (line, [(kind, value, line)])} of the source rooms.

    kind is "text" (a source line), "heading" (a KEPT subheading) or "cut"
    (a block heading of BLOCKS); page marks and continuation headings are gone.
    """
    rooms, number, parts, block = {}, None, None, None
    for lineno, line in enumerate(lines, 1):
        if line.strip() == END:
            break
        if RE_PAGE.match(line.strip()):
            continue
        heading = RE_HEADING.match(line)
        if heading:
            title = heading.group(2).strip()
            base = title[:-len(CONTINUED)] if title.endswith(CONTINUED) else None
            room = RE_ROOM.match(line)
            if base is not None:
                if block and plain(base) == plain(block["title"]):
                    continue  # the block goes on over the page
                block = None
                if number is not None and (base.startswith(f"{number}.") or f"{base}:" in KEPT or base in KEPT):
                    continue  # the room or its subheading goes on over the page
                if number is not None:
                    problem("error", SOURCE, lineno, f"в исходнике комнаты {number} продолжение не её заголовка", line)
                continue
            if room:
                number = int(room.group(1))
                if number in rooms:
                    problem("error", SOURCE, lineno, f"в исходнике комната {number} начинается дважды", line)
                parts = []
                rooms[number] = (lineno, parts)
                block = None
                continue
            if number is None:
                continue
            block = None
            if title in KEPT:
                parts.append(("heading", title, lineno))
            elif title in BLOCKS:
                block = {"title": title, "creature": not title.startswith("*"), "stat": False}
                parts.append(("cut", title, lineno))
            else:
                problem("error", SOURCE, lineno,
                        f"в исходнике комнаты {number} заголовок не комната, не подзаголовок комнаты и не блок карточки",
                        line)
            continue
        if number is None:
            continue
        if block:
            text = line.strip()
            if not text:
                continue
            if block["creature"]:
                if text.startswith(STAT):
                    block["stat"] = True
                    continue
                if not block["stat"] or text.startswith("- "):
                    continue
            elif text.startswith("*") or RE_ITALIC_ITEM.match(text):
                continue
            block = None
        parts.append(("text", line, lineno))
    return rooms


def source_parts(parts):
    """Parts of a room for canon.json: text lines joined into markdown."""
    result, lines = [], []

    def flush():
        text = "\n".join(lines).strip("\n")
        if text:
            result.append({"text": text})
        lines.clear()

    for kind, value, lineno in parts:
        if kind == "text":
            lines.append(value)
            continue
        flush()
        if kind == "heading":
            result.append({"heading": value})
        else:
            card_kind, card_id = BLOCKS[value]
            result.append({"cut": plain(value), "kind": card_kind, "id": card_id, "line": lineno})
    flush()
    return result


def add_sources(root, rooms, creatures, npcs, items, problem):
    """Give each room its "source" {line, parts}; returns the cut blocks for the report.

    A part is {"text": markdown}, {"heading": title} or {"cut": title, kind,
    id, line}: a pasted block replaced by its card. A block whose card is
    missing is an error; one whose card the room's related line does not name
    is a warning, as is a P13 room without a source or a source room without
    one in P13.
    """
    path = os.path.join(root, SOURCE)
    if not os.path.exists(path):
        problem("error", SOURCE, 1, "исходник не найден: у комнат не будет описания", "")
        for room in rooms:
            room["source"] = None
        return []
    with open(path, encoding="utf-8") as f:
        source = read_rooms(f.read().splitlines(), problem)

    cards = {"creatures": {c["id"] for c in creatures}, "npcs": {n["id"] for n in npcs},
             "items": {i["id"] for i in items}}
    cuts = []
    for room in rooms:
        found = source.pop(room["number"], None)
        if found is None:
            problem("warning", SOURCE, 1, f"в исходнике нет комнаты {room['number']}", room["title"])
            room["source"] = None
            continue
        line, parts = found
        room["source"] = {"line": line, "parts": source_parts(parts)}
        for part in room["source"]["parts"]:
            if "cut" not in part:
                continue
            if part["id"] not in cards[part["kind"]]:
                problem("error", SOURCE, part["line"], f"блок «{part['cut']}» ведёт на карточку {part['id']}, а её нет",
                        part["cut"])
            elif part["id"] not in room[part["kind"]]:
                problem("warning", SOURCE, part["line"],
                        f"блок «{part['cut']}» в комнате {room['number']}, а её строка связей не называет карточку",
                        part["cut"])
            cuts.append({"room": room["number"], "title": part["cut"], "kind": part["kind"], "id": part["id"],
                         "line": part["line"]})
    for number, (line, _) in sorted(source.items()):
        problem("warning", SOURCE, line, f"комнаты {number} исходника нет в П13", "")
    return cuts
