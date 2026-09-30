"""NPC and faction cards of the canon for the Game Master site.

Part of site_build.py: reads the short cards of P8, section 20 ("Карточки
НПС / фракций") and returns them as npcs of canon.json. A card is one
subsection, "20.2. Сарежейн", made of bullets "- **Поле:** текст". Cards of
different kinds keep different fields (the dead operators have fewer, the
family joins some), so the fields are kept as written, in order.

The last bullet, "**Подробно:**", links the card to the full sections: the
NPC in P8 and its block in P11 or P9. A linked section that holds a creature
block (as its block or its home section) makes that creature the NPC's
stat block.
"""

import re
from urllib.parse import unquote

from site_creatures import RE_TITLE_NUMBER, slug

CARDS = ("p8", "20")  # doc and section number of the cards
MORE = "Подробно"
START = "Старт"

RE_FIELD = re.compile(r"^-\s+\*\*([^*]+?):\*\*\s*(.*)$")
RE_LINK = re.compile(r"\[[^\]]*\]\(([^)#]*)#([^)]+)\)")
# A start that is just a room number, "19.": the NPC stands in that room.
RE_START_ROOM = re.compile(r"^(\d+)\.?$")


def more_links(text, doc, docs):
    """(sections, missing) of the links in a "Подробно" line of `doc`.

    sections are [{doc, key}] in order; missing are the keys the links name
    that no file of the site holds. The hazard blocks of P7 use it too.
    """
    by_file = {d["file"]: d for d in docs}
    sections, missing = [], []
    for file, anchor in RE_LINK.findall(text):
        target = by_file.get(file) if file else doc
        key = unquote(anchor)
        if not target or all(s["key"] != key for s in target["sections"]):
            missing.append(key)
        else:
            sections.append({"doc": target["id"], "key": key})
    return sections, missing


def find_npcs(docs, creatures, problem, taken):
    """NPC cards of P8 in canon order; problems go through `problem`.

    `taken` maps the ids of the other cards (creatures, hazards) to their
    names: pictures lie in one folder. An NPC may share its id only with its
    own creature, whose picture then serves both cards.

    Each NPC: id (slug of the name, the image file name), doc, key (the card
    section), name, fields ([{label, text}] in order, text is markdown), more
    ([{doc, key}] from "Подробно"), creature (the id of the NPC's stat
    block or null) and start (the room number when the field START is just a
    number, "19."; otherwise null: the whole ship, not made yet, dead, a group
    without a place; the GM puts such an NPC on the map by hand).
    """
    doc = next((d for d in docs if d["id"] == CARDS[0]), None)
    top = doc and next((s for s in doc["sections"] if s["number"] == CARDS[1]), None)
    if not top:
        problem("error", doc["file"] if doc else CARDS[0], 1, f"нет раздела {CARDS[1]} с карточками НПС", "")
        return []
    blocks = {}
    for c in creatures:
        blocks[(c["doc"], c["key"])] = c["id"]
        blocks.setdefault((c["doc"], c["home"]), c["id"])

    npcs, ids = [], dict(taken)
    for section in (s for s in doc["sections"] if s["parent"] == top["key"]):
        name = RE_TITLE_NUMBER.sub("", section["title"]).strip()
        where = (doc["file"], section["line"])
        fields, more = [], []
        for line in section["text"].splitlines():
            m = RE_FIELD.match(line.strip())
            if not m:
                continue
            label, text = m.group(1).strip(), m.group(2).strip()
            if label != MORE:
                fields.append({"label": label, "text": text})
                continue
            found, missing = more_links(text, doc, docs)
            more += found
            for key in missing:
                problem("error", *where, f"в карточке «{name}» ссылка «Подробно» не нашла раздел «{key}»",
                        section["title"])
        if not fields:
            problem("warning", *where, f"в карточке «{name}» нет полей", section["title"])
        if not more:
            problem("warning", *where, f"в карточке «{name}» нет строки «{MORE}» со ссылками", section["title"])
        creature = next((blocks[(m["doc"], m["key"])] for m in more if (m["doc"], m["key"]) in blocks), None)

        npc_id = slug(name)
        if npc_id in ids and npc_id != creature:
            problem("error", *where, f"id НПС «{npc_id}» уже занят: «{ids[npc_id]}»", section["title"])
        ids[npc_id] = name
        start = next((RE_START_ROOM.match(f["text"]) for f in fields if f["label"] == START), None)
        npcs.append({"id": npc_id, "doc": doc["id"], "key": section["key"], "name": name,
                     "fields": fields, "more": more, "creature": creature,
                     "start": int(start.group(1)) if start else None})
    return npcs
