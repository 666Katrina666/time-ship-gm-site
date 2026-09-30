"""Milestones of the campaign for the Game Master site.

Part of site_build.py: reads the level-up rules of P14 and returns them as the
milestones of canon.json. Everything the milestones page checks is written in
the canon and found by section title, not numbered in the code:

- the categories: the table of section 3.2 ("Категории"), the category and
  what it measures;
- the scales: the bold labels of the list in section 3.3 ("Масштаб условия");
- the level-up: the heading "N → M" under section 3.4 ("Пороговая схема"),
  and the category that is only knowledge, from the decided rule there
  ("Только знание — условия категории «…»", register topic 1.16);
- the catalog: the sections "Название: условие" of section 4 ("Каталог
  условий вех"), each with its lines "**Категория:**", "**Масштаб:**" and
  "**Однократность:**";
- the paths: the table of section 5.2 ("Порог через заявленный путь"), the
  path, its claim and when its first irreversible step counts, and the
  milestone the primary threshold needs ("засчитана веха «…»" there);
- the fallback threshold: the bold rule of section 5.3 ("Запасной счётный
  порог"), "N условия, минимум M категории, хотя бы одно … или …";
- the readiness for the finale: the numbered conditions of section 3.5.

The catalog is checked against the summary table of section 15 ("Итоговая
таблица условий вех": the same names, categories and scales) and against the
names of the table of section 3.8. A missing section, a card without its
category or scale, a category or scale not defined above, a mismatch with a
table and a rule that does not read are builder errors.
"""

import re

from site_creatures import slug
from site_encounters import plain, table_rows

MILESTONES_DOC = "p14"
CATEGORIES_TITLE = "Категории"
SCALES_TITLE = "Масштаб условия"
SCHEME_TITLE = "Пороговая схема"
READINESS_TITLE = "Зачем нужен флаг «готовность к развязке»"
PACKAGE_TITLE = "Одно действие, несколько последствий"
SUPPORT_TITLE = "Карта опорных правил проекта"
CATALOG_TITLE = "Каталог условий вех"
PATHS_TITLE = "Порог через заявленный путь"
FALLBACK_TITLE = "Запасной счётный порог"
PROCEDURE_TITLE = "Краткая Мастер-процедура повышения уровня"
SUMMARY_TITLE = "Итоговая таблица условий вех"
TITLES = (CATEGORIES_TITLE, SCALES_TITLE, SCHEME_TITLE, READINESS_TITLE, PACKAGE_TITLE, SUPPORT_TITLE,
          CATALOG_TITLE, PATHS_TITLE, FALLBACK_TITLE, PROCEDURE_TITLE, SUMMARY_TITLE)
FIELDS = {"category": "**Категория:**", "scale": "**Масштаб:**", "once": "**Однократность:**"}
RE_SCALE = re.compile(r"^[-*]\s+\*\*([^*]+)\*\*\s+—")
RE_LEVELS = re.compile(r"^(\d+)\s*→\s*(\d+)$")
RE_KNOWLEDGE = re.compile(r"Только знание — условия категории «([^»]+)»")
RE_FALLBACK = re.compile(r"\*\*(\d+) услови\w*, минимум (\d+) категори\w*, хотя бы одно ([^*]+)\*\*")
RE_NUMBERED = re.compile(r"^(\d+)\.\s+(.+)$")
RE_CRASH = re.compile(r"засчитана веха «([^»]+)»")
RE_BOLD = re.compile(r"^\*\*(.+)\*\*$")


def unbold(cell):
    m = RE_BOLD.match(cell.strip())
    return m.group(1) if m else cell.strip()


def field(text, label):
    """The value of a "**Метка:** значение." line, without the closing dot."""
    for line in text.splitlines():
        if line.startswith(label):
            return line[len(label):].strip().rstrip(".").strip()
    return None


def find_milestones(docs, encounters, problem):
    """The milestones of P14, or None; problems go through `problem`.

    Returns doc; the keys of the sections the page links to: catalog,
    scheme (3.4), readiness (3.5), package (3.7), paths (5.2), fallback (5.3),
    procedure (14); categories ([{name, measures}]), scales (labels, weakest
    first), knowledge (the category that is only knowledge), levels ({from,
    to}), fallback_rule ({conditions, categories, strong: scale labels}),
    crash (the id of the milestone the primary threshold needs),
    readiness_items (markdown of the three conditions), paths_items ([{id,
    name, claim, step}]) and items, each: id, name, goal, key, category,
    scale, once.
    """
    doc = next((d for d in docs if d["id"] == MILESTONES_DOC), None)
    if doc is None:
        problem("error", MILESTONES_DOC, 1, "нет пункта о повышении уровней", "")
        return None
    sections = {}
    for title in TITLES:
        sections[title] = next((s for s in doc["sections"] if plain(s["title"]) == title), None)
        if sections[title] is None:
            problem("error", doc["file"], 1, f"нет раздела «{title}»", "")
    if None in sections.values():
        return None

    def where(title):
        return doc["file"], sections[title]["line"]

    categories = []
    for row in table_rows(sections[CATEGORIES_TITLE]["text"]):
        if len(row) != 2:
            problem("error", *where(CATEGORIES_TITLE), "строка таблицы категорий не из двух столбцов",
                    " | ".join(row))
            continue
        categories.append({"name": row[0], "measures": row[1]})
    names = [c["name"] for c in categories]

    scales = [m.group(1) for line in sections[SCALES_TITLE]["text"].splitlines() if (m := RE_SCALE.match(line))]
    if not scales:
        problem("error", *where(SCALES_TITLE), "нет списка масштабов «- **масштаб** — …»", "")

    scheme = sections[SCHEME_TITLE]
    children = [s for s in doc["sections"] if s["parent"] == scheme["key"]]
    step = [m for s in children if (m := RE_LEVELS.match(s["title"]))]
    levels = None
    if len(step) != 1:
        problem("error", *where(SCHEME_TITLE), f"под пороговой схемой должен быть один заголовок «N → M», "
                f"найдено {len(step)}", scheme["title"])
    else:
        levels = {"from": int(step[0].group(1)), "to": int(step[0].group(2))}
        known = [x["level"] for x in (encounters or {}).get("levels", [])]
        for level in levels.values():
            if known and level not in known:
                problem("error", *where(SCHEME_TITLE), f"уровня {level} нет в таблице уровней случайных встреч",
                        step[0].group(0))
    knowledge = RE_KNOWLEDGE.search("\n".join(s["text"] for s in [scheme] + children))
    if not knowledge:
        problem("error", *where(SCHEME_TITLE), "нет правила «Только знание — условия категории «…»»", "")
    elif knowledge.group(1) not in names:
        problem("error", *where(SCHEME_TITLE), f"категории «{knowledge.group(1)}» нет в таблице категорий",
                knowledge.group(0))

    readiness = [RE_NUMBERED.match(line) for line in sections[READINESS_TITLE]["text"].splitlines()]
    readiness = [m for m in readiness if m]
    if not readiness or [int(m.group(1)) for m in readiness] != list(range(1, len(readiness) + 1)):
        problem("error", *where(READINESS_TITLE), "условия готовности к развязке — не нумерованный список 1…N", "")

    fallback = RE_FALLBACK.search(sections[FALLBACK_TITLE]["text"])
    fallback_rule = None
    if not fallback:
        problem("error", *where(FALLBACK_TITLE),
                "нет правила «**N условия, минимум M категории, хотя бы одно …**»", "")
    else:
        # "стратегическое или крупное" names scales by their stems.
        strong = [s for s in scales if s[:-2] in fallback.group(3)]
        if not strong:
            problem("error", *where(FALLBACK_TITLE), "запасной порог не называет ни одного масштаба",
                    fallback.group(0))
        fallback_rule = {"conditions": int(fallback.group(1)), "categories": int(fallback.group(2)),
                         "strong": strong}

    paths = []
    for row in table_rows(sections[PATHS_TITLE]["text"]):
        if len(row) != 3:
            problem("error", *where(PATHS_TITLE), "строка таблицы путей не из трёх столбцов", " | ".join(row))
            continue
        name = unbold(row[0])
        paths.append({"id": slug(name), "name": name, "claim": row[1], "step": row[2]})
    if not paths:
        problem("error", *where(PATHS_TITLE), "в таблице путей нет строк", "")
    crash = RE_CRASH.search(sections[PATHS_TITLE]["text"])
    if not crash:
        problem("error", *where(PATHS_TITLE), "основной порог не называет веху: «засчитана веха «…»»", "")

    items = []
    for s in doc["sections"]:
        if s["parent"] != sections[CATALOG_TITLE]["key"]:
            continue
        name, _, goal = s["title"].partition(":")
        item = {"id": slug(name), "name": name.strip(), "goal": goal.strip(), "key": s["key"]}
        item.update({k: field(s["text"], label) for k, label in FIELDS.items()})
        items.append(item)
        if not goal.strip():
            problem("error", doc["file"], s["line"], "заголовок вехи не по образцу «Название: условие»", s["title"])
        if item["category"] not in names:
            problem("error", doc["file"], s["line"], f"у вехи «{item['name']}» категория «{item['category']}» "
                    "не из таблицы категорий", s["title"])
        if item["scale"] not in scales:
            problem("error", doc["file"], s["line"], f"у вехи «{item['name']}» масштаб «{item['scale']}» "
                    "не из списка масштабов", s["title"])
    by_name = {x["name"]: x for x in items}
    if len(by_name) != len(items) or len({x["id"] for x in items}) != len(items):
        problem("error", *where(CATALOG_TITLE), "в каталоге повторяется название вехи", "")

    summary = {}
    for row in table_rows(sections[SUMMARY_TITLE]["text"]):
        if len(row) != 6:
            problem("error", *where(SUMMARY_TITLE), "строка итоговой таблицы не из шести столбцов", " | ".join(row))
            continue
        summary[unbold(row[0])] = row
    for name, row in summary.items():
        item = by_name.get(name)
        if item is None:
            problem("error", *where(SUMMARY_TITLE), f"веха «{name}» итоговой таблицы не найдена в каталоге", name)
        elif (row[3], row[4]) != (item["category"], item["scale"]):
            problem("error", *where(SUMMARY_TITLE), f"у вехи «{name}» в итоговой таблице «{row[3]}, {row[4]}», "
                    f"а в каталоге «{item['category']}, {item['scale']}»", name)
    if crash and crash.group(1) not in by_name:
        problem("error", *where(PATHS_TITLE), f"вехи «{crash.group(1)}» основного порога нет в каталоге",
                crash.group(0))
    for name in by_name.keys() - summary.keys():
        problem("error", *where(SUMMARY_TITLE), f"веха «{name}» каталога не попала в итоговую таблицу", name)
    support = {unbold(row[0]) for row in table_rows(sections[SUPPORT_TITLE]["text"]) if row}
    if support != by_name.keys():
        problem("error", *where(SUPPORT_TITLE), "названия карты опорных правил не совпадают с каталогом: "
                f"{', '.join(sorted(support ^ by_name.keys()))}", "")

    return {"doc": doc["id"], "catalog": sections[CATALOG_TITLE]["key"], "scheme": scheme["key"],
            "readiness": sections[READINESS_TITLE]["key"], "package": sections[PACKAGE_TITLE]["key"],
            "paths": sections[PATHS_TITLE]["key"], "fallback": sections[FALLBACK_TITLE]["key"],
            "procedure": sections[PROCEDURE_TITLE]["key"], "categories": categories, "scales": scales,
            "knowledge": knowledge.group(1) if knowledge else None, "levels": levels,
            "fallback_rule": fallback_rule,
            "crash": by_name[crash.group(1)]["id"] if crash and crash.group(1) in by_name else None,
            "readiness_items": [m.group(2) for m in readiness],
            "paths_items": paths, "items": items}
