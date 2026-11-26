#!/bin/bash
# PSFA Deployment Dashboard launcher for macOS / Linux shells.
# Finds a real python3 (without triggering macOS's "install developer tools" popup)
# and hands off to run.py, which works the same on every platform.
#
#   bash run.sh                      open the dashboard
#   bash run.sh --update             download the latest NERIS data first (~700 MB), then open
#   bash run.sh --update --no-open   refresh data only
#   bash run.sh --no-browser         serve without opening a browser window
set -euo pipefail
cd "$(dirname "$0")"

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
  echo "Python 3 isn't installed yet."
  if [ "$(uname)" = "Darwin" ]; then
    echo "Install Apple's free Command Line Tools:   xcode-select --install"
  else
    echo "Install it with your package manager (for example: sudo apt install python3)."
  fi
  echo "Then run this again."
  exit 1
fi
exec "$PY" run.py "$@"
