"""Sections of the card files that no card of the Game Master site shows.

Part of site_build.py, for the check of step 3.10: a card shows only its own
sections, so what the canon writes elsewhere in the same file stays out of
sight unless someone opens the reader. The report lists, per file that a
card draws from (P7, P8, P9, P11, P12), the sections with text that no card
shows. It is a list to review, not findings: most of them are rules and
tables that belong to the reader.

What a card shows mirrors the pages of site/pages/:
- a creature: its block and its info sections with everything under them
  (in P11, where the block is one subsection of the NPC, the NPC's other
  subsections are its info; the shared "Общие правила" of the Warehouse
  too), and the NPC's own text when the block has no intro of its own;
- a hazard and an item: their section with everything under it, and the
  sections of its "**Подробно**" (for an item also the "Общие правила" of
  its top section) with everything under them;
- an NPC: its card in P8, section 20, and the sections of its "Подробно"
  with everything under them, folded on the card;
- a room: its section of P13 with everything under it;
- an encounter: the table of P10, 4.2, and each row's card with everything
  under it;
- a milestone: its card in the catalog of P14, section 4.
A section the pages only link to is marked as linked: the body parts of the
Dog and the Posthuman in P12, the laws of the world in P7, section 11.
"""

from site_creatures import split_block

LAWS = ("p7", "11")  # the hazards page lists these subsections as links


def text_size(text):
    return sum(len(line.strip()) for line in text.splitlines() if line.strip() != "---")


def find_hidden(docs, creatures, hazards, npcs, items, rooms=(), encounters=None, milestones=None):
    """Sections with text that no card shows, in canon order.

    Each: doc, key, title, line, top and top_title (its level-2 section, for
    grouping), size (characters of text) and linked (a page links to it).
    """
    by_id = {d["id"]: d for d in docs}
    children = {}
    for doc in docs:
        for s in doc["sections"]:
            children.setdefault((doc["id"], s["parent"]), []).append(s["key"])

    def subtree(doc, key):
        yield (doc, key)
        for child in children.get((doc, key), []):
            yield from subtree(doc, child)

    shown, linked = set(), set()
    for c in creatures:
        for key in [c["key"]] + [part["key"] for part in c["info"]]:
            shown.update(subtree(c["doc"], key))
        if c["home"] != c["key"]:
            block = next(s for s in by_id[c["doc"]]["sections"] if s["key"] == c["key"])
            if not split_block(block["text"])[1]:
                shown.add((c["doc"], c["home"]))
        if c.get("parts"):
            linked.update(subtree(c["parts"]["doc"], c["parts"]["key"]))
    for x in hazards + items:
        shown.update(subtree(x["doc"], x["key"]))
    for h in hazards + items:
        for m in h["more"]:
            shown.update(subtree(m["doc"], m["key"]))
    for n in npcs:
        shown.add((n["doc"], n["key"]))
        for m in n["more"]:
            shown.update(subtree(m["doc"], m["key"]))
    laws = next((s for s in by_id.get(LAWS[0], {"sections": []})["sections"] if s["number"] == LAWS[1]), None)
    if laws:
        linked.update(subtree(LAWS[0], laws["key"]))

    for r in rooms:
        shown.update(subtree(r["doc"], r["key"]))
    table_docs = []
    if encounters:
        table_docs.append(encounters["doc"])
        shown.add((encounters["doc"], encounters["key"]))
        for row in encounters["rows"]:
            if row["key"]:
                shown.update(subtree(encounters["doc"], row["key"]))
    if milestones:
        table_docs.append(milestones["doc"])
        for item in milestones["items"]:
            shown.update(subtree(milestones["doc"], item["key"]))

    # The files that hold the cards themselves: a file a card only folds a
    # section of (P5 for the Crystal) is not listed, most of it being rules.
    card_docs = {x["doc"] for x in list(creatures) + hazards + npcs + items + list(rooms)} | set(table_docs)
    hidden = []
    for doc in (d for d in docs if d["id"] in card_docs):
        top = None
        for s in doc["sections"]:
            if s["level"] <= 2:
                top = s
            size = text_size(s["text"])
            if size == 0 or (doc["id"], s["key"]) in shown:
                continue
            hidden.append({"doc": doc["id"], "key": s["key"], "title": s["title"], "line": s["line"],
                           "top": top["key"], "top_title": top["title"], "size": size,
                           "linked": (doc["id"], s["key"]) in linked})
    return hidden
