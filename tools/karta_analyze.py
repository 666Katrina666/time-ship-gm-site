"""Analyze the traced ship map graph (karta_graf.json).

Prints a Markdown report (room exits, reachability, flicker-wall pockets,
checks) and renders the graph over the map photo for visual verification.

Usage: python tools/karta_analyze.py [--overlay OUT.png]
"""
import argparse
import collections
import heapq
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / 'karta_graf.json'
PHOTO = ROOT / 'karta_foto' / '01_obshchiy_vid_povernut.jpg'
KNOWN_ROOMS = 41
START_ROOM = 1
# The past can be entered through either clock, but the two clocks are never
# open at the same time, so routes must not pass through it.
TERMINAL_ROOMS = {41}

TYPE_NAMES = {
    'corridor': 'проход',
    'door': 'дверь',
    'locked': 'запертая дверь',
    'flicker': 'мерцающая стена',
    'secret': 'потайная дверь',
    'special': 'особый переход',
}
COLORS = {
    'corridor': (40, 120, 255), 'door': (0, 170, 60), 'locked': (255, 140, 0),
    'flicker': (230, 0, 70), 'secret': (150, 60, 230), 'special': (0, 190, 190),
}
FREE = {'corridor', 'door'}


class Graph:
    def __init__(self, data):
        self.data = data
        self.nodes = {n['id']: n for n in data['nodes']}
        self.edges = data['edges']
        self.adj = collections.defaultdict(list)
        for e in self.edges:
            self.adj[e['a']].append((e['b'], e))
            self.adj[e['b']].append((e['a'], e))
        self.rooms = collections.defaultdict(list)
        for n in data['nodes']:
            if 'room' in n:
                self.rooms[n['room']].append(n['id'])

    def room(self, nid):
        return self.nodes[nid].get('room')

    def dist(self, a, b):
        na, nb = self.nodes[a], self.nodes[b]
        return math.hypot(na['x'] - nb['x'], na['y'] - nb['y'])

    def components(self, allowed):
        comp = {}
        groups = []
        for nid in self.nodes:
            if nid in comp:
                continue
            comp[nid] = len(groups)
            stack, members = [nid], [nid]
            while stack:
                x = stack.pop()
                for y, e in self.adj[x]:
                    if e['type'] in allowed and y not in comp:
                        comp[y] = len(groups)
                        stack.append(y)
                        members.append(y)
            groups.append(members)
        return comp, groups

    def cheapest_routes(self, start_room):
        """Dijkstra from a room; cost = (flicker walls, locked/secret doors, length)."""
        best = {}
        heap = []
        for s in self.rooms[start_room]:
            best[s] = (0, 0, 0.0)
            heap.append((0, 0, 0.0, s))
        heapq.heapify(heap)
        while heap:
            f, l, length, x = heapq.heappop(heap)
            if best.get(x) != (f, l, length):
                continue
            if self.room(x) in TERMINAL_ROOMS:
                continue
            for y, e in self.adj[x]:
                cost = (f + (e['type'] == 'flicker'),
                        l + (e['type'] in ('locked', 'secret')),
                        length + self.dist(x, y))
                if y not in best or cost < best[y]:
                    best[y] = cost
                    heapq.heappush(heap, (*cost, y))
        return best


def room_key(r):
    return (isinstance(r, str), r if isinstance(r, int) else str(r))


def room_exits(g, room):
    """Classify each exit by the first non-corridor edge on its unbranched stem.

    A room point usually connects to its door through a short corridor segment,
    so the exit type is found by walking outward until a junction, a room or a
    dead end.
    """
    ids = set(g.rooms[room])
    counts = collections.Counter()
    notes = []
    for nid in ids:
        for other, first in g.adj[nid]:
            if other in ids:
                continue
            kind = None
            prev, cur, e = nid, other, first
            seen = {nid}
            while True:
                if e.get('note'):
                    notes.append(e['note'])
                if e['type'] != 'corridor':
                    kind = e['type']
                    break
                if g.room(cur) is not None or len(g.adj[cur]) != 2 or cur in seen:
                    break
                seen.add(cur)
                nxt = [(y, ee) for y, ee in g.adj[cur] if y != prev]
                if not nxt:
                    break
                prev, (cur, e) = cur, nxt[0]
            counts[kind or 'corridor'] += 1
    return counts, notes


def report(g):
    out = []
    w = out.append

    # --- checks
    missing = [i for i in range(1, KNOWN_ROOMS + 1) if i not in g.rooms]
    dead_ends = [n for n in g.data['nodes'] if 'room' not in n and len(g.adj[n['id']]) == 1]
    lonely = [n for n in g.data['nodes'] if not g.adj[n['id']]]
    comp, groups = g.components(set(TYPE_NAMES))
    w('### Проверка графа\n')
    w(f'- Точек: {len(g.nodes)}, переходов: {len(g.edges)}.')
    w(f'- Связных частей: {len(groups)}.')
    w(f'- Комнат нет на графе: {", ".join(map(str, missing)) if missing else "нет"}.')
    w(f'- Точек без связей: {len(lonely)}.')
    w(f'- Тупиков (точек коридора с одной связью): {len(dead_ends)}.')
    w('')

    # --- room exits
    w('### Выходы помещений\n')
    w('| № | Выходы | Заметки |')
    w('| --- | --- | --- |')
    for r in sorted(g.rooms, key=room_key):
        counts, notes = room_exits(g, r)
        exits = ', '.join(f'{TYPE_NAMES[t]} ×{c}' if c > 1 else TYPE_NAMES[t]
                          for t, c in sorted(counts.items(), key=lambda kv: list(TYPE_NAMES).index(kv[0])))
        w(f'| {r} | {exits or "—"} | {"; ".join(dict.fromkeys(notes))} |')
    w('')

    # --- pockets behind flicker / locked / secret / special
    zone, zones = g.components(FREE)

    def zone_rooms(z):
        return sorted({g.room(x) for x in zones[z] if g.room(x) is not None}, key=room_key)

    start_zone = zone[g.rooms[START_ROOM][0]]
    links = collections.Counter()
    for e in g.edges:
        if e['type'] in FREE:
            continue
        za, zb = zone[e['a']], zone[e['b']]
        if za != zb:
            links[(min(za, zb), max(za, zb), e['type'])] += 1
    involved = sorted({z for k in links for z in k[:2]} - {start_zone})
    labels = {start_zone: 'Основная сеть'}
    for i, z in enumerate(involved, 1):
        labels[z] = f'Карман {i}'

    def describe(z):
        rooms = zone_rooms(z)
        if z == start_zone:
            return labels[z]
        if rooms:
            what = ('комната ' if len(rooms) == 1 else 'комнаты ') + ', '.join(map(str, rooms))
        else:
            notes = [g.nodes[x]['note'] for x in zones[z] if g.nodes[x].get('note')]
            what = '; '.join(notes) if notes else 'только коридор'
        return f'{labels[z]} ({what})'

    w('### Карманы\n')
    w(f'Основная сеть — всё, что достижимо от комнаты {START_ROOM} через проходы и обычные двери. '
      'Карман — участок, отделённый от неё мерцающими стенами, запертыми или потайными дверями или особыми переходами.\n')
    w('| Откуда | Куда | Через что |')
    w('| --- | --- | --- |')
    for (a, b, t), c in sorted(links.items(), key=lambda kv: (kv[0][0] != start_zone, kv[0])):
        w(f'| {describe(a)} | {describe(b)} | {TYPE_NAMES[t]}{f" ×{c}" if c > 1 else ""} |')
    w('')

    # --- reachability
    best = g.cheapest_routes(START_ROOM)
    w(f'### Путь от комнаты {START_ROOM}\n')
    w('Наименьшее число препятствий на пути от Разрушенной фермы. '
      'Сначала минимизируются мерцающие стены, затем запертые и потайные двери.\n')
    rows, free = [], []
    for r in sorted(g.rooms, key=room_key):
        costs = [best[x] for x in g.rooms[r] if x in best]
        if not costs:
            rows.append(f'| {r} | недостижима | — |')
            continue
        f, l, _ = min(costs)
        if f or l:
            rows.append(f'| {r} | {f} | {l} |')
        else:
            free.append(r)
    w(f'Без препятствий достижимы: {", ".join(map(str, free))}.\n')
    if rows:
        w('| № | Мерцающих стен | Запертых и потайных дверей |')
        w('| --- | --- | --- |')
        out.extend(rows)
    w('')
    return '\n'.join(out)


def render_overlay(g, out_path):
    from PIL import Image, ImageDraw, ImageFont
    image_meta = g.data['image']
    im = Image.open(PHOTO)
    # The tracer stores coordinates in the rotated frame; rotation is clockwise degrees.
    im = im.rotate(-image_meta['rotation'], expand=True).convert('RGB')
    k = im.width / image_meta['width']
    im = im.point(lambda v: int(v * 0.55 + 110))
    draw = ImageDraw.Draw(im)
    for e in g.edges:
        a, b = g.nodes[e['a']], g.nodes[e['b']]
        draw.line([(a['x'] * k, a['y'] * k), (b['x'] * k, b['y'] * k)], fill=COLORS[e['type']], width=4)
    try:
        font = ImageFont.truetype('arialbd.ttf', 13)
    except OSError:
        font = None
    for n in g.data['nodes']:
        x, y = n['x'] * k, n['y'] * k
        if 'room' in n:
            draw.ellipse([x - 10, y - 10, x + 10, y + 10], fill=(255, 210, 60), outline=(0, 0, 0), width=2)
            draw.text((x, y), str(n['room']), fill=(0, 0, 0), font=font, anchor='mm')
        elif len(g.adj[n['id']]) == 1:
            draw.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 120, 0), width=3)
    im.save(out_path)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser()
    parser.add_argument('--overlay', type=Path, help='render the graph over the map photo')
    args = parser.parse_args()
    g = Graph(json.loads(GRAPH.read_text(encoding='utf-8')))
    print(report(g))
    if args.overlay:
        render_overlay(g, args.overlay)


if __name__ == '__main__':
    main()
