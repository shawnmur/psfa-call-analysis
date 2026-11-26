# PSFA Deployment Dashboard

An interactive look at how **Puget Sound Regional Fire Authority** deploys: when calls come in, what
they are, how many units go, where, and which station area (inferred) they're in. It's for
firefighters and anyone else curious about the agency's workload.

The data is public, from **NERIS**, the U.S. Fire Administration's national incident reporting
system. It covers about 32,000 incidents from late December 2025 onward.

## Requirements

- **Python 3.9 or newer.** Nothing else is needed to view the dashboard: no packages, Node, or
  database.
  - **Windows:** install it from [python.org](https://www.python.org/downloads/) or the Microsoft
    Store.
  - **macOS:** running `python3` in Terminal offers to install it (Apple's Command Line Tools), or
    use python.org or Homebrew.
  - **Linux:** usually already installed. If not, use your package manager (for example,
    `sudo apt install python3`).
- **A modern web browser** (Chrome, Edge, Firefox, Safari).
- **An internet connection for the map background only.** Everything else works offline.

## Open the dashboard

1. Get the project, with either:
   - `git clone https://github.com/shawnmur/psfa-call-analysis.git`, or
   - **Code → Download ZIP** on GitHub, then unzip it.
2. Open a terminal in the project folder and run:

   | System | Command |
   |---|---|
   | Windows (Command Prompt or PowerShell) | `py run.py` (or `python run.py`) |
   | macOS / Linux | `python3 run.py` |

3. Your browser opens the dashboard at `http://127.0.0.1:8765/dashboard/`. If that port is taken,
   the next free one is used and printed in the terminal.
4. **Leave the terminal open** while you use the dashboard. Press **Ctrl-C** or close it to stop.

**Shortcuts (optional):**
- **macOS:** double-click **`PSFA Dashboard.command`**. If macOS says it "cannot be opened" (common
  with downloaded ZIPs), right-click it → **Open**, or just use `python3 run.py`.
- **macOS / Linux:** `bash run.sh` does the same as `run.py`. It also finds Python for you and says
  how to install it if it's missing.

## How to use it

- **The filter bar** (it stays at the top) controls *every* chart, the map, and the table: dates,
  call category, units sent, likely station, mutual aid, day/night, and weekdays/weekends.
- **Click to filter:** anything marked ⊕ can be clicked. Click a cell in the weekday × hour grid, a
  call type, a station, a ZIP, an action, or a location type. It appears as a chip in the filter bar;
  click × to remove it.
- **Bookmark a view:** the address bar holds your filters, so you can bookmark or share a view.
- **Table:** every chart has a **Table** button that shows the exact numbers behind it.
- **Colors:** each call category always has the same color. Blue is reserved for totals.
- **Theme:** switches between light and dark.

### Things to try
- **Stations (inferred):** sort *Busiest stations* by **Night** to see which areas keep crews up.
  Station 71 (downtown Kent) is busiest at about 18 calls a day. Pick a station in the **Station**
  filter, and every chart becomes that station's area.
- On the map, switch to **Points by likely station** to see each station's area, and click a
  numbered pin to filter to it.
- Click **Fire** in the categories chart, then look at *Volume over time → By category*. Fire calls
  climb sharply in summer.
- Pick **Vehicle collision** and switch the map to **Heat**. The freeway corridors light up. Then
  look at *When each type happens* for the commute peaks.
- In *A typical 24-hour shift*: a median shift is about 119 calls agency-wide, and on half of shifts
  at least 26 calls come after 22:00.
- *Which calls get the biggest response* shows what turns into a multi-unit call.

## The data

- **`data/psfa_incidents.csv`** has **every incident downloaded so far**, one row per incident. It
  holds all of NERIS's original columns plus easy-to-use ones: local date/time, weekday, shift,
  category, ZIP, inferred station, and so on. It opens in Excel, Google Sheets, LibreOffice,
  Numbers, or pandas.
- **`data/README.md`** is the data dictionary: what every column means.
- **`data/stations.csv`** lists the 17 station locations used to infer the likely station.
- The dashboard also has **Download filtered CSV** in the *Explore the data* section.

### Refreshing to get newer incidents

| System | Command |
|---|---|
| Windows | `py run.py --update` |
| macOS / Linux | `python3 run.py --update` |

This downloads the latest national NERIS file (about 700 MB, skipped if it hasn't changed). It
extracts PSFA's incidents and **merges** them into `data/psfa_incidents.csv`. Nothing already saved
is ever deleted. The first time, it sets up a private Python environment (`.venv`) with DuckDB.
Add `--no-open` to refresh without starting the dashboard.

### Know the limits
- NERIS publishes about **60 days late**, and records can still be edited for a while.
- **Stations are inferred.** NERIS has no unit IDs or station numbers, so each incident is credited
  to the nearest station in a straight line. That's a good stand-in for "whose first-due area," but
  it isn't who actually responded (roads, busy units, and move-ups all matter). The real responding
  units would need a public-records request to PSFA or Valley Com (see `specs/data-sources.md`).
- Incident type is the type **as found on scene**. Medical types are generalized for privacy, and
  about 63% of calls are simply "Medical".
- `duration` is always 0, so call length isn't available. Addresses are reduced to ZIP code.
- Shift views **assume 24-hour shifts start at 07:00** (change `SHIFT_START_HOUR` in
  `pipeline/derive.py`).

## For maintainers

| Path | What it is |
|---|---|
| `run.py` | Cross-platform launcher: optional `--update`, serves the project on `127.0.0.1:8765` (or the next free port), opens the browser |
| `run.sh`, `PSFA Dashboard.command` | macOS/Linux conveniences that find Python and call `run.py` |
| `pipeline/update_data.py` | Download → extract PSFA with DuckDB → clean (test rows, duplicates, timezone check) → merge → infer station → write CSV |
| `pipeline/derive.py` | Pure-stdlib transforms (categories, time bins, shifts, ZIP, coordinates, nearest station, merge, analysis window) |
| `pipeline/build_dashboard_data.py` | CSV → `dashboard/data/incidents.js` (stdlib only) |
| `dashboard/` | Static page: `app.js` (state/filters), `charts.js` (ECharts), `map.js` (Leaflet), `main.js` (wiring). Libraries are vendored in `dashboard/vendor/` |
| `tests/` | `python3 -m unittest discover -s tests` |
| `specs/` | Goals, data-source research, and the dashboard spec |

The basemap is from OpenStreetMap. Not affiliated with PSFA, NERIS, or USFA. Not for operational
use.
