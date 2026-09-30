"""Canon builder of the Game Master site.

Parses the canon markdown into site/data/canon.json: every file as a tree of
sections keyed by their Obsidian anchors, and every link between the files
resolved to its target section. The site reads the canon only through this
file, so it cannot drift from the markdown. Whatever the builder could not
resolve goes to site/data/build_report.json.

The PF2 conditions and traits of the glossary (section 8, subsections
"Состояния" and "Признаки") go to canon.json as terms: the site shows them in
a tooltip wherever the canon uses them.

The creature stat blocks of P9 and P11 go to canon.json as creatures
(site_creatures.py): the name, level, traits and the numbers of the combat
scene parsed, the rest kept as markdown. The hazard blocks of P7 go there as
hazards (site_hazards.py) the same way, the NPC cards of P8 as npcs
(site_npcs.py) and the P12 items with knowledge layers as items (site_items.py).
The GM's state sheet of P2 goes there as state (site_state.py), the schema of
the world state page, the rooms of P13 as rooms (site_rooms.py), each with its
description from the source (site_room_source.py), and the random encounter
table of P10 as encounters (site_encounters.py) and the milestone catalog and
level-up thresholds of P14 as milestones (site_milestones.py). The ship map
graph of karta_graf.json goes there as map (site_map.py).

Section keys follow Obsidian: the heading text with colons dropped (the rule
of refs_check.py). With repeated headings a link reaches only the first one;
later ones get the key "heading (2)", "heading (3)" and can be reached only
from the tree.

The build is deterministic: the same canon gives byte-identical canon.json.
The build time goes to the report only.

Usage: python tools/site_build.py [--check]
    --check   build twice, compare the results and write nothing;
              exit code 1 on errors in the report or a mismatch
"""

import datetime
import json
import os
import re
import sys
from urllib.parse import unquote

from refs_check import NUM, RE_HEADING_TEXT, RISKY_HEADING_CHARS, obsidian_heading
from site_creatures import find_creatures
from site_hazards import find_hazards
from site_npcs import find_npcs
from site_items import find_items
from site_state import find_state
from site_coverage import find_hidden
from site_rooms import find_rooms
from site_room_source import add_sources
from site_encounters import find_encounters
from site_milestones import find_milestones
from site_map import PHOTO, PHOTO_COPY, find_map, photo_copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
FORMAT = "korabl-canon/1"

# The canon: points 1–14 and the glossary. Point 1 is the constitution.
CANON = ["konstitutsiya_konversii.md"] + [f"korabl_vremeni_punkt_{n}_*" for n in range(2, 15)] + ["slovar_terminov.md"]
# Companion files the canon links to: the site shows them next to it.
COMPANIONS = ["lestnitsa_ugroz.md", "karta_korablya.md", "otkrytye_voprosy.md", "rashozhdeniya.md"]
# Source texts and work plans the canon may cite; the site does not show them.
OUTSIDE = ["korabl_vremeni_ocr.md", "mantiya_ur_ara_istochnik.md", "plan_dovedeniya_kanona.md",
           "time_ship_pf2_master_conversion_plan.md"]

RE_LINK = re.compile(r"(?<!!)\[([^\]]*)\]\(([^)\s]*)\)")
RE_NUMBER = re.compile(rf"^({NUM})\.\s")
RE_POINT_TITLE = re.compile(r"пункт (\d+)\.\s*(.*)$")
# The section of P1 that lists what the canon deliberately leaves open. Found
# by title, so renumbering P1 does not break it.
BOUNDARIES_TITLE = "Границы канона"
RE_BOUNDARY = re.compile(r"^[-*]\s+(.+?)\s+—\s+.*?" + RE_LINK.pattern)
# Glossary tables of PF2 terms for the tooltips: kind -> subsection title.
GLOSSARY = "slovar_terminov"
TERM_TABLES = {"conditions": "Состояния", "traits": "Признаки"}
RE_WEB_LINK = re.compile(r"^\[[^\]]*\]\((https?://[^)\s]+)\)$")


def canon_files():
    """(file name, kind) in site order; a missing canon file is an error."""
    names = sorted(os.listdir(ROOT))
    result = []
    for pattern in CANON:
        prefix = pattern.rstrip("*")
        match = [n for n in names if n.startswith(prefix) and n.endswith(".md")] if pattern.endswith("*") else \
            [pattern] if pattern in names else []
        if len(match) != 1:
            raise SystemExit(f"Канон: для {pattern} найдено файлов: {len(match)}, нужен один")
        result.append((match[0], "canon"))
    result += [(n, "companion") for n in COMPANIONS if n in names]
    return result


def doc_id(name):
    m = re.match(r"korabl_vremeni_punkt_(\d+)_", name)
    if m:
        return f"p{m.group(1)}"
    return "p1" if name == "konstitutsiya_konversii.md" else name[:-3]


def short_title(doc, title):
    """Title for navigation: "П10. Случайные встречи" instead of the full H1."""
    m = RE_POINT_TITLE.search(title)
    if m:
        return f"П{m.group(1)}. {m.group(2)}"
    short = title.removeprefix("«Корабль Времени» — ").split(" «Корабля Времени»")[0]
    short = short[:1].upper() + short[1:]
    return f"П1. {short}" if doc == "p1" else short


def parse_file(name, lines, problems):
    """Sections of a file in order, each owning the text up to the next heading."""
    sections, seen, stack = [], {}, []
    in_code, fence_line = False, 0
    for lineno, line in enumerate(lines, 1):
        if line.startswith("```"):
            in_code, fence_line = not in_code, lineno
        m = None if in_code else RE_HEADING_TEXT.match(line)
        if not m:
            if sections:
                sections[-1]["lines"].append(line)
            elif line.strip():
                problems.append(problem("warning", name, lineno, "текст до первого заголовка не попадёт на сайт", line))
            continue
        level = len(line) - len(line.lstrip("#"))
        title = m.group(1)
        anchor = obsidian_heading(title)
        count = seen[anchor] = seen.get(anchor, 0) + 1
        key = anchor if count == 1 else f"{anchor} ({count})"
        while stack and stack[-1]["level"] >= level:
            stack.pop()
        if stack and level > stack[-1]["level"] + 1:
            problems.append(problem("warning", name, lineno,
                                    f"заголовок уровня {level} сразу под уровнем {stack[-1]['level']}", line))
        number = RE_NUMBER.match(title)
        section = {
            "key": key,
            "title": title,
            "level": level,
            "number": number.group(1) if number else None,
            "parent": stack[-1]["key"] if stack else None,
            "line": lineno,
            "lines": [],
        }
        sections.append(section)
        stack.append(section)
    if in_code:
        problems.append(problem("error", name, fence_line, "блок кода не закрыт до конца файла", lines[fence_line - 1]))
    for section in sections:
        section["text"] = "\n".join(section.pop("lines")).strip("\n")
    return sections


def problem(level, name, lineno, message, snippet):
    return {"level": level, "file": name, "line": lineno, "message": message, "snippet": snippet.strip()[:160]}


def resolve_links(docs, lines_of, problems):
    """Every link of the site files: internal ones resolved to a section.

    Returns the internal links as [from doc, from section, to doc, to section]
    and link counts by kind.
    """
    by_file = {d["file"]: d for d in docs}
    keys = {d["file"]: {s["key"] for s in d["sections"]} for d in docs}
    repeated = {d["file"]: {s["key"].rsplit(" (", 1)[0] for s in d["sections"] if s["key"] != obsidian_heading(s["title"])}
                for d in docs}
    links, counts = [], {"canon": 0, "web": 0, "outside": 0, "repo": 0}
    for doc in docs:
        name = doc["file"]
        owner_of_line = {}
        for section in doc["sections"]:
            owner_of_line[section["line"]] = section["key"]
        owner, in_code = None, False
        for lineno, line in enumerate(lines_of[name], 1):
            owner = owner_of_line.get(lineno, owner)
            if line.startswith("```"):
                in_code = not in_code
            if in_code:
                continue
            for m in RE_LINK.finditer(line):
                href = m.group(2)
                if re.match(r"[a-z]+://", href):
                    counts["web"] += 1
                    continue
                if not re.search(r"[./#]", href):
                    continue  # notation sample such as "[Mirror Image](…)"
                path, _, anchor = href.partition("#")
                target = unquote(path) or name
                if target not in by_file:
                    if not os.path.exists(os.path.join(ROOT, target)):
                        problems.append(problem("error", name, lineno, f"файл {target} не найден", m.group(0)))
                    elif target.endswith(".md") and target not in OUTSIDE:
                        problems.append(problem("error", name, lineno,
                                                f"{target} не входит в сайт: добавьте его в COMPANIONS или OUTSIDE",
                                                m.group(0)))
                    else:
                        counts["outside" if target.endswith(".md") else "repo"] += 1
                    continue
                key = unquote(anchor) if anchor else by_file[target]["sections"][0]["key"]
                if key not in keys[target]:
                    problems.append(problem("error", name, lineno, f"в {target} нет раздела «{key}»", m.group(0)))
                    continue
                if RISKY_HEADING_CHARS & set(key):
                    problems.append(problem("warning", name, lineno,
                                            f"в заголовке «{key}» символ, с которым ссылки Obsidian не проверены",
                                            m.group(0)))
                if key in repeated[target]:
                    problems.append(problem("warning", name, lineno,
                                            f"заголовок «{key}» в {target} повторяется; ссылка ведёт на первый",
                                            m.group(0)))
                counts["canon"] += 1
                links.append([doc["id"], owner, by_file[target]["id"], key])
    return links, counts


def find_boundaries(docs, problems):
    """Canon boundaries from P1: {doc, key, items: [{doc, key, what}]}.

    doc and key point to the P1 section itself, items to every listed section.

    A list item reads "- what — [link](file.md#anchor)". Links without a
    target are already reported by resolve_links and are skipped here.
    """
    p1 = next(d for d in docs if d["id"] == "p1")
    section = next((s for s in p1["sections"] if RE_NUMBER.sub("", s["title"]) == BOUNDARIES_TITLE), None)
    if section is None:
        problems.append(problem("error", p1["file"], 1, f"в П1 нет раздела «{BOUNDARIES_TITLE}»: сайт не покажет границы канона", ""))
        return {"doc": p1["id"], "key": None, "items": []}
    by_file = {d["file"]: d for d in docs}
    result = []
    for offset, line in enumerate(section["text"].splitlines(), 1):
        m = RE_BOUNDARY.match(line)
        if not m:
            if re.match(r"[-*]\s", line):
                problems.append(problem("warning", p1["file"], section["line"] + offset,
                                        "строка границ канона не по образцу «- что — [ссылка](файл#раздел)»", line))
            continue
        path, _, anchor = m.group(3).partition("#")
        doc = by_file.get(unquote(path))
        key = unquote(anchor)
        if doc and any(s["key"] == key for s in doc["sections"]):
            result.append({"doc": doc["id"], "key": key, "what": m.group(1)})
    return {"doc": p1["id"], "key": section["key"], "items": result}


def table_rows(text):
    """Cells of the body rows of the markdown tables in a section text."""
    rows = []
    for line in text.splitlines():
        if line.startswith("|") and not re.match(r"^\|[\s:|-]+$", line):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return rows[1:] if rows else rows  # the first row is the header


def find_terms(docs, problems):
    """PF2 terms of the glossary: {doc, <kind>: {key, items}} for TERM_TABLES.

    A row reads "| name | English name or — | what it does | [ID](AoN link), свой or — |".
    "свой" marks a trait of the adventure itself; "—" means no page to link.
    """
    glossary = next((d for d in docs if d["id"] == GLOSSARY), None)
    result = {"doc": GLOSSARY}
    for kind, title in TERM_TABLES.items():
        section = glossary and next((s for s in glossary["sections"] if s["title"] == title), None)
        if section is None:
            problems.append(problem("warning", f"{GLOSSARY}.md", 1,
                                    f"в словаре нет раздела «{title}»: подсказок к этим терминам не будет", ""))
            result[kind] = {"key": None, "items": []}
            continue
        items, names = [], set()
        for offset, row in enumerate(table_rows(section["text"]), 1):
            where = section["line"] + offset
            if len(row) != 4:
                problems.append(problem("warning", glossary["file"], where,
                                        f"строка таблицы «{title}» не из четырёх столбцов", " | ".join(row)))
                continue
            name, en, text, ref = row
            web = RE_WEB_LINK.match(ref)
            if not (web or ref in ("свой", "—")):
                problems.append(problem("warning", glossary["file"], where,
                                        f"в таблице «{title}» ссылка не по образцу «[ID](адрес)», «свой» или «—»", ref))
            if name in names:
                problems.append(problem("warning", glossary["file"], where, f"термин «{name}» повторяется", name))
            names.add(name)
            items.append({"name": name, "en": None if en == "—" else en, "text": text,
                          "href": web.group(1) if web else None, "own": ref == "свой"})
        result[kind] = {"key": section["key"], "items": items}
    return result


def build():
    """(canon, report): the site data and what the builder could not resolve."""
    problems, docs, lines_of = [], [], {}
    for name, kind in canon_files():
        with open(os.path.join(ROOT, name), encoding="utf-8") as f:
            lines = f.read().splitlines()
        lines_of[name] = lines
        sections = parse_file(name, lines, problems)
        if not sections:
            problems.append(problem("error", name, 1, "в файле нет заголовков", ""))
            continue
        doc = doc_id(name)
        docs.append({"id": doc, "file": name, "kind": kind, "title": sections[0]["title"],
                     "short": short_title(doc, sections[0]["title"]), "sections": sections})
    links, counts = resolve_links(docs, lines_of, problems)
    boundaries = find_boundaries(docs, problems)
    terms = find_terms(docs, problems)
    creatures = find_creatures(docs, lambda *args: problems.append(problem(*args)))
    hazards = find_hazards(docs, lambda *args: problems.append(problem(*args)),
                           {c["id"]: c["name"] for c in creatures})
    npcs = find_npcs(docs, creatures, lambda *args: problems.append(problem(*args)),
                     {x["id"]: x["name"] for x in creatures + hazards})
    items, parts = find_items(docs, creatures, lambda *args: problems.append(problem(*args)),
                              {x["id"]: x["name"] for x in creatures + hazards + npcs})
    for creature in creatures:
        creature["parts"] = parts.get(creature["id"])
    state = find_state(docs, lambda *args: problems.append(problem(*args)))
    rooms = find_rooms(docs, creatures, hazards, npcs, items, state, lambda *args: problems.append(problem(*args)))
    cuts = add_sources(ROOT, rooms, creatures, npcs, items, lambda *args: problems.append(problem(*args)))
    encounters = find_encounters(docs, creatures, hazards, npcs, items, state, rooms,
                                 lambda *args: problems.append(problem(*args)))
    milestones = find_milestones(docs, encounters, lambda *args: problems.append(problem(*args)))
    map_ = find_map(ROOT, docs, rooms, npcs, lambda *args: problems.append(problem(*args)))
    hidden = find_hidden(docs, creatures, hazards, npcs, items, rooms, encounters, milestones)
    canon = {"format": FORMAT, "docs": docs, "links": links, "boundaries": boundaries, "terms": terms,
             "creatures": creatures, "hazards": hazards, "npcs": npcs, "items": items,
             "state": state, "rooms": rooms, "encounters": encounters, "milestones": milestones, "map": map_}

    files = []
    for doc in docs:
        own = [link for link in links if link[0] == doc["id"]]
        files.append({"id": doc["id"], "file": doc["file"], "kind": doc["kind"], "short": doc["short"],
                      "lines": len(lines_of[doc["file"]]), "sections": len(doc["sections"]),
                      "repeated": sum(1 for s in doc["sections"] if s["key"] != obsidian_heading(s["title"])),
                      "links": len(own), "links_in": sum(1 for link in links if link[2] == doc["id"])})
    problems.sort(key=lambda p: ({"error": 0, "warning": 1}[p["level"]], p["file"], p["line"]))
    report = {
        "built": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "files": files,
        "links": counts,
        "boundaries": len(boundaries["items"]),
        "terms": {kind: len(terms[kind]["items"]) for kind in TERM_TABLES},
        "creatures": len(creatures),
        "hazards": len(hazards),
        "npcs": len(npcs),
        "items": len(items),
        "rooms": len(rooms),
        "source_cuts": cuts,
        "encounters": len(encounters["rows"]) if encounters else 0,
        "milestones": len(milestones["items"]) if milestones else 0,
        "map": {"nodes": map_["points"], "edges": len(map_["edges"])} if map_ else None,
        "state": sum(len(g["fields"]) for g in state["groups"]) if state else 0,
        "hidden": hidden,
        "errors": sum(1 for p in problems if p["level"] == "error"),
        "warnings": sum(1 for p in problems if p["level"] == "warning"),
        "problems": problems,
    }
    return canon, report


def dump(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def write(path, text):
    # Written aside and swapped in, so a window loading the data mid-build
    # gets the old file or the new one, never half of it.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(path + ".tmp", path)


def fatal_report(error):
    """Report of a build that crashed: the site shows it instead of the canon."""
    return {"built": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "files": [],
            "links": {}, "errors": 1, "warnings": 0,
            "problems": [{"level": "error", "file": "", "line": 0, "message": f"сборка упала: {error}", "snippet": ""}]}


def run():
    """Build and write the site data; returns the report. Used by the server."""
    try:
        canon, report = build()
    except (Exception, SystemExit) as error:
        # Without a build the site shows no canon rather than a stale one.
        if os.path.exists(os.path.join(DATA, "canon.json")):
            os.remove(os.path.join(DATA, "canon.json"))
        report = fatal_report(error)
        write(os.path.join(DATA, "build_report.json"), dump(report))
        return report
    write(os.path.join(DATA, "canon.json"), dump(canon))
    write(os.path.join(DATA, "build_report.json"), dump(report))
    if canon.get("map") and canon["map"].get("photo"):
        # The server serves only site/: the map photo goes there as a copy.
        target = os.path.join(DATA, PHOTO_COPY)
        with open(target + ".tmp", "wb") as f:
            f.write(photo_copy(PHOTO))
        os.replace(target + ".tmp", target)
    return report


def summary(report):
    counts, terms = report["links"], report.get("terms", {})
    sections = sum(f["sections"] for f in report["files"])
    return (f"Канон: файлов {len(report['files'])}, разделов {sections}, ссылок внутри сайта "
            f"{counts.get('canon', 0)}, в интернет {counts.get('web', 0)}, на файлы вне сайта "
            f"{counts.get('outside', 0) + counts.get('repo', 0)}; границ канона {report.get('boundaries', 0)}; "
            f"состояний {terms.get('conditions', 0)}, признаков {terms.get('traits', 0)}; "
            f"существ {report.get('creatures', 0)}, опасностей {report.get('hazards', 0)}, НПС {report.get('npcs', 0)}, предметов {report.get('items', 0)}, комнат {report.get('rooms', 0)}, вырезано блоков исходника {len(report.get('source_cuts', []))}, строк встреч {report.get('encounters', 0)}, вех {report.get('milestones', 0)}, "
            f"точек карты {(report.get('map') or {}).get('nodes', 0)}, переходов {(report.get('map') or {}).get('edges', 0)}, "
            f"полей состояния мира {report.get('state', 0)}; "
            f"не показаны на карточках {len(report.get('hidden', []))} разделов; "
            f"ошибок {report['errors']}, предупреждений {report['warnings']}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if "--check" in sys.argv:
        first, report = build()
        second, _ = build()
        same = dump(first) == dump(second)
    else:
        report, same = run(), True
    for p in report["problems"]:
        print(f"[{p['level']}] {p['file']}:{p['line']}  {p['message']}\n    {p['snippet']}")
    if "--hidden" in sys.argv:
        for h in report.get("hidden", []):
            mark = "ссылка" if h["linked"] else ""
            print(f"{h['doc']}:{h['line']:<5} {h['size']:>6} {mark:<6}  {h['title']}")
    print(summary(report))
    if not same:
        print("Две сборки подряд дали разный JSON")
    return 1 if report["errors"] or not same else 0


if __name__ == "__main__":
    sys.exit(main())
