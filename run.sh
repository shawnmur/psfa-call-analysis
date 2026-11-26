#!/bin/bash
# PSFA Deployment Dashboard launcher for macOS / Linux shells.
# Finds a working python3 (without triggering macOS's "install developer tools" popup)
# and hands off to run.py, which works the same on every platform.
#
#   bash run.sh                      open the dashboard
#   bash run.sh --update             download the latest NERIS data first (~700 MB), then open
#   bash run.sh --update --no-open   refresh data only
#   bash run.sh --no-browser         serve without opening a browser window
set -euo pipefail
cd "$(dirname "$0")"

# A candidate only counts if it actually runs on this CPU and is Python 3.9+.
# (On Apple Silicon, an Intel-only python3 left over in /usr/local from an old
# Mac fails with "Bad CPU type in executable" unless Rosetta is installed.)
works() { "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; }

BROKEN=""
find_python() {
  local cands=(/opt/homebrew/bin/python3 /usr/local/bin/python3
               /Library/Frameworks/Python.framework/Versions/Current/bin/python3)
  local onpath; onpath="$(command -v python3 2>/dev/null || true)"
  [ -n "$onpath" ] && [ "$onpath" != /usr/bin/python3 ] && cands+=("$onpath")
  # /usr/bin/python3 on macOS is a stub that pops an installer unless the
  # Command Line Tools are present, so only try it when they are.
  if [ "$(uname)" != "Darwin" ] || xcode-select -p >/dev/null 2>&1; then cands+=(/usr/bin/python3); fi
  for p in "${cands[@]}"; do
    [ -x "$p" ] || continue
    if works "$p"; then echo "$p"; return 0; fi
    BROKEN="$BROKEN $p"
  done
  return 1
}

if ! PY="$(find_python)"; then
  # find_python ran in a subshell; recompute which candidates exist but don't work
  for p in /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
    [ -x "$p" ] && ! works "$p" && BROKEN="$BROKEN $p"
  done
  echo ""
  echo "Couldn't find a working Python 3.9 or newer."
  if [ -n "$BROKEN" ]; then
    echo "Found Python here, but it won't run on this computer (often an Intel-only copy on an Apple Silicon Mac, or too old):"
    for p in $BROKEN; do echo "    $p"; done
  fi
  if [ "$(uname)" = "Darwin" ]; then
    echo "Fix it with any one of these:"
    echo "  - Install Apple's Command Line Tools:   xcode-select --install"
    echo "  - Install Python for Apple Silicon/Intel from https://www.python.org/downloads/"
    echo "  - Or, if you want to keep the Intel copy:   softwareupdate --install-rosetta"
  else
    echo "Install it with your package manager (for example: sudo apt install python3)."
  fi
  echo "Then run this again."
  exit 1
fi
exec "$PY" run.py "$@"
