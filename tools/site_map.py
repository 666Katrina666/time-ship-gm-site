"""Ship map graph for the Game Master site.

Part of site_build.py: reads karta_graf.json (the graph traced over the paper
map with tools/karta_trace.html) and returns it as the map of canon.json. The
page draws the graph as it is: the builder only checks it and makes it
cheaper to draw.

- nodes: the rooms (points with "room"); the other points are corridor
  bends and stay only as ends of the edges;
- edges: every edge with its ends (point ids and coordinates) and its type;
  the edge id is kept, the live map addresses the flicker walls by it.
  Every point is an end of some edge, so the live map finds the points to
  snap a new passage to among the ends;
- the tracer's notes on points and edges are left out: they were written
  for whoever checks the tracing, not for the table;
- types: the edge types in the file's order with their titles and counts;
- box: the drawing area, the frame of all points with a margin;
- doc, key: the section of the site that links to karta_graf.json (the map
  file describes the graph there), found by the link, not by its title.

- start: the room where the party begins (the room of P13 with "start");
- photo: the photo of the paper map the graph was traced over (PHOTO, the
  one tools/karta_analyze.py draws the graph over), placed under the graph:
  src (its copy in site/data, written by site_build.run through
  photo_copy), width and height of the file and transform, the SVG matrix
  that turns it by the graph's image rotation and scales it to the graph's
  frame. None without the photo.

The matrix works on the stored pixels, as karta_analyze.py does. A browser
would first turn the photo by its EXIF orientation (the photo has one), so
the copy goes without the EXIF block.

A missing or unreadable file, an unknown format, a repeated id, an edge to a
point that does not exist, an edge type the file does not list, a room
number that P13 lacks and a start room (of the party or of an NPC of P8)
without a point are builder errors; a room of P13 without a point, no
section linking to the graph, a missing or unreadable photo and a photo
whose shape does not fit the graph's image are warnings.
"""

import json
import os
import re
import struct

from karta_analyze import PHOTO

GRAPH = "karta_graf.json"
PHOTO_COPY = "karta_foto.jpg"  # the photo's name in site/data
FORMAT = "karta-trace/1"
MARGIN = 60
RE_GRAPH_LINK = re.compile(r"\]\(" + re.escape(GRAPH) + r"\)")


def find_map(root, docs, rooms, npcs, problem):
    """The map graph, or None; problems go through `problem`.

    Returns doc, key (the section linking to the graph, or None), box
    ([x, y, width, height]), types ([{id, title, count}]), nodes ([{id, x, y,
    room}], rooms only) and edges ([{id, type, a, b, x1, y1, x2, y2}]) and
    start (a room number or None).
    """
    try:
        with open(os.path.join(root, GRAPH), encoding="utf-8") as f:
            data = json.load(f)
    except OSError:
        problem("error", GRAPH, 1, "файла графа карты нет", "")
        return None
    except ValueError as e:
        problem("error", GRAPH, 1, f"граф карты не читается как JSON: {e}", "")
        return None
    if data.get("format") != FORMAT:
        problem("error", GRAPH, 1, f"формат графа не {FORMAT}", str(data.get("format")))
        return None

    doc, key = graph_section(docs)
    if doc is None:
        problem("warning", GRAPH, 1, "ни один раздел сайта не ссылается на граф карты", "")

    numbers = {r["number"] for r in rooms}
    points, nodes = {}, []
    for node in data.get("nodes", []):
        if node["id"] in points:
            problem("error", GRAPH, 1, f"точка {node['id']} повторяется", str(node["id"]))
            continue
        points[node["id"]] = node
        if "room" in node and node["room"] not in numbers:
            problem("error", GRAPH, 1, f"у точки {node['id']} комната {node['room']}, которой нет в П13", str(node["id"]))
        if "room" in node:
            nodes.append({k: node[k] for k in ("id", "x", "y", "room")})
    on_map = {n["room"] for n in nodes if "room" in n}
    for number in sorted(numbers - on_map):
        problem("warning", GRAPH, 1, f"у комнаты {number} нет точки на карте", str(number))
    start = next((r["number"] for r in rooms if r.get("start")), None)
    if start is not None and start not in on_map:
        problem("error", GRAPH, 1, f"у стартовой комнаты группы {start} нет точки на карте", str(start))
    for npc in npcs:
        if npc.get("start") is not None and npc["start"] not in on_map:
            problem("error", GRAPH, 1, f"у стартовой комнаты {npc['start']} НПС «{npc['name']}» нет точки на карте",
                    npc["name"])

    titles = data.get("edgeTypes", {})
    seen, edges = set(), []
    for edge in data.get("edges", []):
        if edge["id"] in seen:
            problem("error", GRAPH, 1, f"переход {edge['id']} повторяется", str(edge["id"]))
            continue
        seen.add(edge["id"])
        a, b = points.get(edge["a"]), points.get(edge["b"])
        if a is None or b is None:
            missing = edge["a"] if a is None else edge["b"]
            problem("error", GRAPH, 1, f"переход {edge['id']} ведёт в точку {missing}, которой нет", str(edge["id"]))
            continue
        if edge["type"] not in titles:
            problem("error", GRAPH, 1, f"у перехода {edge['id']} неизвестный тип «{edge['type']}»", str(edge["id"]))
            continue
        item = {"id": edge["id"], "type": edge["type"], "a": edge["a"], "b": edge["b"],
                "x1": a["x"], "y1": a["y"], "x2": b["x"], "y2": b["y"]}
        edges.append(item)

    types = [{"id": t, "title": title, "count": sum(1 for e in edges if e["type"] == t)}
             for t, title in titles.items()]
    xs = [n["x"] for n in points.values()]
    ys = [n["y"] for n in points.values()]
    box = [min(xs) - MARGIN, min(ys) - MARGIN, max(xs) - min(xs) + 2 * MARGIN,
           max(ys) - min(ys) + 2 * MARGIN] if points else [0, 0, 1, 1]
    return {"doc": doc, "key": key, "box": box, "types": types, "nodes": nodes, "edges": edges,
            "points": len(points), "start": start, "photo": photo_of(data.get("image"), problem)}


def jpeg_size(path):
    """(width, height) of a JPEG file from its frame header, or None."""
    with open(path, "rb") as f:
        data = f.read()
    at = 2
    while at + 9 < len(data) and data[at] == 0xFF:
        marker = data[at + 1]
        length = struct.unpack(">H", data[at + 2:at + 4])[0]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height, width = struct.unpack(">HH", data[at + 5:at + 9])
            return width, height
        at += 2 + length
    return None


def photo_copy(path):
    """The JPEG bytes of `path` without its EXIF blocks (APP1 "Exif").

    Without them a browser draws the stored pixels, not turned by the EXIF
    orientation, and the matrix of photo_of places them right.
    """
    with open(path, "rb") as f:
        data = f.read()
    out, at = [data[:2]], 2
    while at + 4 <= len(data) and data[at] == 0xFF and data[at + 1] != 0xDA:
        length = struct.unpack(">H", data[at + 2:at + 4])[0]
        segment = data[at:at + 2 + length]
        if not (data[at + 1] == 0xE1 and segment[4:10] == b"Exif\0\0"):
            out.append(segment)
        at += 2 + length
    out.append(data[at:])
    return b"".join(out)


def photo_of(image, problem):
    """The photo under the graph: {src, width, height, transform}, or None.

    The tracer keeps the graph in the frame of the photo turned by `rotation`
    degrees clockwise, `width` x `height` pixels (karta_analyze.py draws its
    overlay the same way); the matrix takes a pixel of the file into it.
    """
    name = os.path.relpath(PHOTO, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    size = jpeg_size(PHOTO) if os.path.exists(PHOTO) else None
    if not size or not image:
        problem("warning", name, 1, "фото карты под графом нет или оно не читается как JPEG", "")
        return None
    w, h = size
    turn = image.get("rotation", 0) % 360
    turned = (h, w) if turn in (90, 270) else (w, h)
    scale = image["width"] / turned[0]
    if abs(turned[1] * scale - image["height"]) > image["height"] / 100:
        problem("warning", name, 1, f"пропорции фото {w}×{h} не сходятся с кадром графа "
                                    f"{image['width']}×{image['height']} при повороте {turn}°", "")
    a, b, c, d, e, f = {0: (1, 0, 0, 1, 0, 0), 90: (0, 1, -1, 0, h, 0),
                        180: (-1, 0, 0, -1, w, h), 270: (0, -1, 1, 0, 0, w)}[turn]
    return {"src": f"data/{PHOTO_COPY}", "file": name.replace(os.sep, "/"), "width": w, "height": h,
            "transform": [round(v * scale, 6) for v in (a, b, c, d, e, f)]}


def graph_section(docs):
    """(doc id, section key) of the first section linking to the graph file."""
    for doc in docs:
        for section in doc["sections"]:
            if RE_GRAPH_LINK.search(section["text"]):
                return doc["id"], section["key"]
    return None, None
