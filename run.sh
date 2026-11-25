#!/bin/bash
# PSFA Deployment Dashboard launcher.
#
#   bash run.sh            open the dashboard (no installs needed)
#   bash run.sh --update   download the latest NERIS data first (~700 MB), then open
#   bash run.sh --update --no-open   refresh data only
#   bash run.sh --no-browser         serve without opening a browser window
#
# Viewing needs only python3. Updating also installs DuckDB into ./.venv.
set -euo pipefail
cd "$(dirname "$0")"

UPDATE=0
OPEN=1
BROWSER=1
PORT=8765
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    --no-open) OPEN=0 ;;
    --no-browser) BROWSER=0 ;;
    --port=*) PORT="${arg#--port=}" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

# --- find a real python3 without triggering macOS's "install developer tools" popup
find_python() {
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  if [ "$(uname)" = "Darwin" ]; then
    if xcode-select -p >/dev/null 2>&1 && [ -x /usr/bin/python3 ]; then echo /usr/bin/python3; return 0; fi
    return 1
  fi
  command -v python3 2>/dev/null || return 1
}
if ! PY="$(find_python)"; then
  echo ""
  echo "Python 3 isn't installed yet. Install Apple's free Command Line Tools:"
  echo ""
  echo "    xcode-select --install"
  echo ""
  echo "then run this again."
  exit 1
fi
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Python 3.9 or newer is needed (found $("$PY" --version 2>&1))."; exit 1
fi

# --- optional data refresh
if [ "$UPDATE" = 1 ]; then
  if [ ! -x .venv/bin/python ]; then
    echo "Setting up a private Python environment in .venv (one time)..."
    "$PY" -m venv .venv
  fi
  if ! .venv/bin/python -c 'import duckdb' 2>/dev/null; then
    echo "Installing DuckDB (one time)..."
    .venv/bin/python -m pip install --quiet --upgrade pip
    .venv/bin/python -m pip install --quiet "duckdb==1.4.5"
  fi
  .venv/bin/python pipeline/update_data.py
fi

if [ ! -f dashboard/data/incidents.js ]; then
  if [ -f data/psfa_incidents.csv ]; then
    "$PY" pipeline/build_dashboard_data.py
  else
    echo "No data yet - run:  bash run.sh --update"; exit 1
  fi
fi
[ "$OPEN" = 1 ] || exit 0

# --- pick a free port
PORT="$("$PY" - "$PORT" <<'EOF'
import socket, sys
start = int(sys.argv[1])
for port in range(start, start + 50):
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", port))
        print(port)
        break
    except OSError:
        continue
    finally:
        s.close()
EOF
)"
URL="http://127.0.0.1:${PORT}/dashboard/"
echo ""
echo "  PSFA Deployment Dashboard is running at:  $URL"
echo "  Leave this window open while you use it. Close it (or press Ctrl-C) to stop."
echo ""
[ "$BROWSER" = 1 ] && ( sleep 1; open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true ) &
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1 2>/dev/null
