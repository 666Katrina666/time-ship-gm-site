"""Start, restart and stop the Game Master site.

The server runs in the background without a window, so closing this menu
leaves the site running; its output goes to saves/server.log.

Usage: python tools/site_control.py [open|restart|stop|status] [--port N] [--no-browser]
Without a command it shows a menu.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "tools", "site_server.py")
LOG = os.path.join(ROOT, "saves", "server.log")
DEFAULT_PORT = 8741
APP = "korabl-site"
WAIT_SECONDS = 10
BROWSER = True  # --no-browser turns it off for checks


def request(port, path, method="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=3) as response:
        return json.loads(response.read())


class StraySite(RuntimeError):
    """The port is held by a site server that does not answer /api/ping."""


def port_free(port):
    """True if nothing listens on the port.

    Binding it is instant; connecting to a closed port on Windows retries
    for about two seconds before it is refused.
    """
    probe = socket.socket()
    try:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def ping(port):
    """The running site's {"pid", "save"}; None if nothing listens on the port.

    Raises StraySite if an old or hung copy of the site holds the port, and
    RuntimeError if another program does.
    """
    if port_free(port):
        return None
    try:
        answer = request(port, "/api/ping")
        if answer.get("app") == APP:
            return answer
    except (OSError, ValueError):
        pass  # no answer in time, or an answer that is not the site's
    # Something holds the port but is not a working site. Processes are
    # looked up only here: it is slow, and a free port never gets here.
    pid = stray_server(port)
    if pid:
        raise StraySite(f"порт {port} занят старой или зависшей копией сайта (PID {pid}); "
                        "пункт «Остановить» её закроет")
    raise RuntimeError(f"порт {port} занят другой программой, не сайтом Мастера; выберите --port N")


def stray_server(port):
    """PID of a site_server.py process listening on the port, else None.

    Catches a copy that cannot answer ping: an older version of the site or
    a hung one. Windows only; elsewhere it finds nothing.
    """
    if os.name != "nt":
        return None
    script = (
        f"$c = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
        "Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "
        "\"ProcessId=$($c.OwningProcess)\"; \"$($p.ProcessId)`t$($p.CommandLine)\" }"
    )
    result = subprocess.run(["powershell", "-NoProfile", "-Command", script],
                            capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
    pid, _, command = result.stdout.strip().partition("\t")
    return int(pid) if pid.isdigit() and "site_server.py" in command else None


def kill(pid):
    # Every event is already on disk, so ending the process loses nothing.
    subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)


def wait_free(port):
    """Wait until the port is released. Only the port is watched: a stopping
    server holds it for a moment after it has stopped answering."""
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        if port_free(port):
            return True
        time.sleep(0.2)
    return False


def log_tail(lines=5):
    try:
        with open(LOG, encoding="utf-8", errors="replace") as file:
            return "".join(file.readlines()[-lines:]).rstrip()
    except OSError:
        return ""


def start(port):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    log = open(LOG, "a", encoding="utf-8")
    log.write(f"\n--- запуск {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    log.flush()
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    # No window, and a process group of its own: closing the menu window
    # must not take the server with it.
    flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    process = subprocess.Popen(
        [sys.executable, SERVER, "--no-browser", "--port", str(port)],
        cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env,
        creationflags=flags, start_new_session=os.name != "nt",
    )
    log.close()
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("сервер не запустился:\n" + log_tail())
        # HTTP only: probing by binding could take the port from under the
        # server that is binding it right now.
        try:
            if request(port, "/api/ping").get("app") == APP:
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise RuntimeError("сервер не ответил за 10 секунд:\n" + log_tail())


def stop(port):
    try:
        status = ping(port)
    except StraySite:
        pid = stray_server(port)
        kill(pid)
        if not wait_free(port):
            raise RuntimeError(f"не удалось остановить копию сайта (PID {pid})")
        return True
    if status is None:
        return False
    try:
        request(port, "/api/shutdown", "POST")
    except (urllib.error.URLError, OSError):
        pass
    if not wait_free(port):
        kill(status["pid"])
        if not wait_free(port):
            raise RuntimeError(f"не удалось остановить сервер (PID {status['pid']})")
    return True


def browse(port):
    if BROWSER:
        webbrowser.open(f"http://127.0.0.1:{port}/")


def open_site(port):
    if ping(port) is None:
        start(port)
        print("Сервер запущен.")
    browse(port)


def restart(port):
    stop(port)
    start(port)
    print("Сервер перезапущен.")
    browse(port)


def describe(port):
    status = ping(port)
    if status is None:
        return "не запущен"
    return f"запущен на http://127.0.0.1:{port}/ (PID {status['pid']})"


def run(command, port):
    if command == "open":
        open_site(port)
    elif command == "restart":
        restart(port)
    elif command == "stop":
        print("Сервер остановлен." if stop(port) else "Сервер и так не запущен.")
    elif command == "status":
        print("Сайт " + describe(port) + ".")


MENU = {"1": "open", "2": "restart", "3": "stop"}


def menu(port):
    while True:
        try:
            state = f"Сервер {describe(port)}."
        except RuntimeError as error:
            state = f"Внимание: {error}."
        print()
        print("Корабль Времени — сайт Мастера")
        print(state)
        print("  1  Открыть сайт (запустить, если не запущен)")
        print("  2  Перезапустить")
        print("  3  Остановить")
        print("  0  Выйти (сервер продолжит работать)")
        try:
            choice = input("> ").strip()
        except EOFError:
            return
        if choice in ("0", ""):
            return
        if choice not in MENU:
            print("Нет такого пункта.")
            continue
        try:
            run(MENU[choice], port)
        except RuntimeError as error:
            print(f"Ошибка: {error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", nargs="?", choices=["open", "restart", "stop", "status"])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    global BROWSER
    BROWSER = not args.no_browser
    if args.command is None:
        menu(args.port)
        return
    try:
        run(args.command, args.port)
    except RuntimeError as error:
        sys.exit(f"Ошибка: {error}")


if __name__ == "__main__":
    main()
