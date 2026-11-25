# PSFA Deployment Dashboard

An interactive look at how **Puget Sound Regional Fire Authority** deploys: when calls come in, what
they are, how many units go, and where. It's for firefighters and anyone
else curious about the agency's workload.

The data is public, from **NERIS**, the U.S. Fire Administration's national incident reporting
system. It covers about 32,000 incidents from late December 2025 onward.

## Open the dashboard

1. Get the project folder onto your Mac (`git clone …`, or download the ZIP and unzip it).
2. Double-click **`PSFA Dashboard.command`**.
   - A Terminal window opens and your browser shows the dashboard.
   - **Leave the Terminal window open** while you use it. Closing it stops the dashboard.

**If macOS says it "cannot be opened"** (this happens with downloaded ZIPs), do one of these:
- Right-click the file → **Open** → **Open**, or
- Open Terminal, type `bash ` (with a space), drag the project's `run.sh` onto the window, and press Return, or
- Run `xattr -dr com.apple.quarantine /path/to/psfa-call-analysis` once.

**If it asks you to install "command line developer tools,"** say yes, or run
`xcode-select --install`. That installs Python 3, which is the only thing needed.

## How to use it

- **The filter bar** (it stays at the top) controls *every* chart: dates, call category, units sent,
  mutual aid, day/night, and weekdays/weekends.
- **Click to filter:** anything marked ⊕ can be clicked. Click a cell in the weekday × hour grid, a
  call type, a ZIP, an action, or a location type. It appears as a chip in the filter bar; click ×
  to remove it.
- **Bookmark a view:** the address bar holds your filters, so you can bookmark or share a view.
- **Table:** every chart has a **Table** button that shows the exact numbers behind it.
- **Theme:** switches between light and dark.

### Things to try
- Click **Fire** in the categories chart, then look at *Volume over time → By category*. Fire calls
  climb sharply in summer.
- Pick **Vehicle collision** and switch the map to **Heat**. The freeway corridors light up. Then
  look at *When each type happens* for the commute peaks.
- In *A typical 24-hour shift*: a median shift is about 119 calls agency-wide, and on half of shifts
  at least 26 calls come after 22:00.
- *Which calls get the biggest response* shows what turns into a multi-unit call.

## The data

- **`data/psfa_incidents.csv`** has **every incident we've downloaded**, one row per incident, with
  all of NERIS's original columns plus easy-to-use ones (local date/time, weekday, shift, category,
  ZIP, and so on). Open it in Excel, Numbers, or Google Sheets.
- **`data/README.md`** is the data dictionary: what every column means.
- The dashboard also has **Download filtered CSV** in the *Explore the data* section.

### Refreshing to get newer incidents

```bash
bash run.sh --update
```

This downloads the latest national NERIS file (about 700 MB, skipped if it hasn't changed), extracts
PSFA's incidents, and **merges** them into `data/psfa_incidents.csv`. Nothing already saved is ever
deleted. The first time, it sets up a private Python environment (`.venv`) with DuckDB.

### Know the limits
- NERIS publishes about **60 days late**, and records can still be edited for a while.
- **No unit IDs or station numbers**, so this is an agency-wide view. "Busiest station" questions
  need a public-records request to PSFA or Valley Com (see `specs/data-sources.md`).
- Incident type is the type **as found on scene**. Medical types are generalized for privacy, and
  about 63% of calls are simply "Medical".
- `duration` is always 0, so call length isn't available. Addresses are reduced to ZIP code.
- Shift views **assume 24-hour shifts start at 07:00**.

## For maintainers

| Path | What it is |
|---|---|
| `run.sh` | Launcher: finds Python, optional `--update`, serves on `127.0.0.1:8765` (or the next free port), opens the browser |
| `pipeline/update_data.py` | Download → extract PSFA with DuckDB → clean (test rows, duplicates, timezone check) → merge → write CSV |
| `pipeline/derive.py` | Pure-stdlib transforms (categories, time bins, shifts, ZIP, coordinates, merge, analysis window) |
| `pipeline/build_dashboard_data.py` | CSV → `dashboard/data/incidents.js` (stdlib only) |
| `dashboard/` | Static page: `app.js` (state/filters), `charts.js` (ECharts), `map.js` (Leaflet), `main.js` (wiring). Libraries are vendored in `dashboard/vendor/` |
| `tests/` | `python3 -m unittest discover -s tests` |
| `specs/` | Goals, data-source research, and the dashboard spec |

The basemap is from OpenStreetMap (internet needed for map tiles only). Everything else works
offline. Not affiliated with PSFA, NERIS, or USFA. Not for operational use.
