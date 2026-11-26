#!/usr/bin/env python3
"""PSFA Deployment Dashboard launcher (macOS, Windows, Linux).

    python3 run.py               open the dashboard (no installs needed)
    python3 run.py --update      download the latest NERIS data first (~700 MB), then open
    python3 run.py --update --no-open   refresh data only
    python3 run.py --no-browser  serve without opening a browser window
    python3 run.py --port 9000   preferred port (falls back to the next free one)

On Windows use `py run.py` (or `python run.py`). Viewing needs only Python 3.9+;
--update also installs DuckDB into a private .venv folder.
"""
import argparse
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
VENV = os.path.join(ROOT, ".venv")
DUCKDB = "duckdb==1.4.5"


def venv_python() -> str:
    sub = ("Scripts", "python.exe") if os.name == "nt" else ("bin", "python")
    return os.path.join(VENV, *sub)


def update() -> None:
    py = venv_python()
    if not os.path.exists(py):
        print("Setting up a private Python environment in .venv (one time)...")
        subprocess.check_call([sys.executable, "-m", "venv", VENV])
    if subprocess.call([py, "-c", "import duckdb"], stderr=subprocess.DEVNULL) != 0:
        print("Installing DuckDB (one time)...")
        subprocess.check_call([py, "-m", "pip", "install", "--quiet", "--upgrade", "pip"])
        subprocess.check_call([py, "-m", "pip", "install", "--quiet", DUCKDB])
    subprocess.check_call([py, os.path.join(ROOT, "pipeline", "update_data.py")])


def free_port(start: int) -> int:
    for port in range(start, start + 50):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("No free port found near %d." % start)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # keep the console readable
        pass


def main() -> None:
    ap = argparse.ArgumentParser(description="PSFA Deployment Dashboard launcher")
    ap.add_argument("--update", action="store_true", help="download and merge the latest NERIS data first")
    ap.add_argument("--no-open", action="store_true", help="don't start the dashboard (use with --update)")
    ap.add_argument("--no-browser", action="store_true", help="serve without opening a browser window")
    ap.add_argument("--port", type=int, default=8765, help="preferred port (default 8765)")
    args = ap.parse_args()

    if sys.version_info < (3, 9):
        raise SystemExit("Python 3.9 or newer is needed (this is %s)." % sys.version.split()[0])
    if args.update:
        update()

    if not os.path.exists(os.path.join(ROOT, "dashboard", "data", "incidents.js")):
        if os.path.exists(os.path.join(ROOT, "data", "psfa_incidents.csv")):
            subprocess.check_call([sys.executable, os.path.join(ROOT, "pipeline", "build_dashboard_data.py")])
        else:
            raise SystemExit("No data yet - run:  python3 run.py --update")
    if args.no_open:
        return

    port = free_port(args.port)
    url = "http://127.0.0.1:%d/dashboard/" % port
    handler = functools.partial(QuietHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("\n  PSFA Deployment Dashboard is running at:  %s" % url, flush=True)
    print("  Leave this window open while you use it. Press Ctrl-C (or close the window) to stop.\n", flush=True)
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
