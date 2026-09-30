"""Local Game Master site server.

Rebuilds the canon data (site_build.py), serves site/ on 127.0.0.1 and opens
it in the browser. Standard library only, so the site runs anywhere Python 3
is installed.

API (the event log is described in site_events.py):
  GET  /api/stream                  SSE: hello, missed events, then live ones
  POST /api/events                  {"type", "data"} -> the numbered event
  GET  /api/save/export             the current save as a file
  POST /api/save/import             a save file body; the current one is archived
  POST /api/save/new                archive the current save, start an empty one
  GET  /api/ping                    {"app", "pid", "save"}: is the site running
  GET  /api/images                  {"<id>": "img/<file>"}: pictures the GM put in site/img
  POST /api/shutdown                stop the server (used by site_control.py)

POST requests from other sites are refused: any page in the browser could
otherwise send them to 127.0.0.1.

Usage: python tools/site_server.py [--port N] [--no-browser] [--saves DIR]
"""

import argparse
import datetime
import http.server
import json
import os
import queue
import socket
import sys
import threading
import urllib.parse
import webbrowser

import site_build
from site_events import EventLog, SaveError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
DEFAULT_PORT = 8741
PING_SECONDS = 15
APP = "korabl-site"


IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")


def images():
    """Pictures in site/img by file name without extension; read on every
    request, so a picture the GM adds shows up without a restart."""
    folder = os.path.join(SITE, "img")
    if not os.path.isdir(folder):
        return {}
    found = {}
    for name in sorted(os.listdir(folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() in IMAGE_TYPES:
            found.setdefault(stem, f"img/{urllib.parse.quote(name)}")
    return found


class Handler(http.server.SimpleHTTPRequestHandler):
    log = None  # EventLog, set in main()

    # Windows may map .js to text/plain in the registry; ES modules then fail
    # to load, so the types the site uses are fixed here.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".html": "text/html",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE, **kwargs)

    def end_headers(self):
        # The site is edited while it runs; the browser must never show a
        # stale copy of it.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        pass

    # --- API ---

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/api/stream":
            self._stream()
        elif url.path == "/api/save/export":
            self._export()
        elif url.path == "/api/ping":
            self._json(200, {"app": APP, "pid": os.getpid(), "save": self.log.header["save"]})
        elif url.path == "/api/images":
            self._json(200, images())
        elif url.path.startswith("/api/"):
            self._json(404, {"error": "нет такого адреса"})
        else:
            super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            self._json(403, {"error": "запрос с чужого сайта"})
            return
        try:
            if path == "/api/shutdown":
                self._json(200, {"stopping": True})
                # shutdown() blocks until the serve loop stops; the reply is
                # already sent, and the stop runs on its own thread.
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            elif path == "/api/events":
                request = json.loads(body or b"{}")
                self._json(200, self.log.append(request.get("type"), request.get("data")))
            elif path == "/api/save/import":
                self.log.import_save(body.decode("utf-8-sig"))
                self._json(200, self.log.info())
            elif path == "/api/save/new":
                self.log.new_game()
                self._json(200, self.log.info())
            else:
                self._json(404, {"error": "нет такого адреса"})
        except (SaveError, ValueError, AttributeError) as error:
            self._json(400, {"error": str(error)})

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _export(self):
        body = self.log.export_text().encode("utf-8")
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="korabl-{stamp}.jsonl"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self):
        # Event ids are "save:seq"; a reconnecting EventSource sends the last
        # one it got. A new window sends nothing and gets the whole log.
        save, _, seq = (self.headers.get("Last-Event-ID") or "").partition(":")
        client, hello, backlog = self.log.subscribe(save, int(seq) if seq.isdigit() else 0)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.end_headers()
            self._send("hello", hello)
            for event in backlog:
                self._send("append", event, hello["save"])
            while True:
                try:
                    kind, payload, save = client.get(timeout=PING_SECONDS)
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    continue
                self._send(kind, payload, save)
        except OSError:
            pass  # the window was closed
        finally:
            self.log.unsubscribe(client)

    def _send(self, kind, payload, save=None):
        lines = [f"event: {kind}"]
        if kind == "append":
            lines.append(f"id: {save}:{payload['seq']}")
        lines.append("data: " + json.dumps(payload, ensure_ascii=False))
        self.wfile.write(("\n".join(lines) + "\n\n").encode("utf-8"))
        self.wfile.flush()


class Server(http.server.ThreadingHTTPServer):
    # The default SO_REUSEADDR lets a second server bind the same port on
    # Windows, and two servers would later write to one save. The port is
    # taken exclusively, so a second start fails instead.
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--saves", default=os.path.join(ROOT, "saves"),
                        help="папка сохранений (для проверок — временная)")
    args = parser.parse_args()

    # The port first: a second copy of the site must stop before it touches
    # the save the first one is writing.
    try:
        server = Server(("127.0.0.1", args.port), Handler)
    except OSError as error:
        sys.exit(f"Порт {args.port} занят: {error}. Сайт уже запущен? Или: --port N")

    try:
        Handler.log = EventLog(args.saves)
    except SaveError as error:
        server.server_close()
        sys.exit(f"Сохранение {args.saves} повреждено: {error}. Уберите current.jsonl "
                 "или замените его экспортом.")
    if Handler.log.warning:
        print(f"Внимание: {Handler.log.warning}", flush=True)

    # The canon is rebuilt on every start, so the site always shows the
    # markdown as it is now. A failed build still lets the site start: the
    # build report page tells what went wrong.
    print(site_build.summary(site_build.run()), flush=True)

    url = f"http://127.0.0.1:{args.port}/"
    print(f"Сайт Мастера: {url}", flush=True)
    print("Остановить: Ctrl+C", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
