# PSFA Deployment Dashboard: Implementation Spec (v1)

_Status: draft for review · 2026-11-25 · see [goals.md](goals.md), [data-sources.md](data-sources.md)_

## 1. Goal

Build a dashboard anyone can run on their own computer. It should show how Puget Sound Fire deploys:
**when** calls happen (month, week, day, down to 10-minute time-of-day bins), **what** they are
(call types), **how much** gets sent (units, mutual aid), and **where** (map). It should be
impressive to explore. Every chart responds to one shared set of filters, and clicking a chart
mark narrows the view.

**Data source:** NERIS Public, filtered to PSFA (`FD53033674`). That's about 32k incidents from
2025-12-04 to 2026-09-25 as of the 2026-11-24 export.

## 2. Constraints

- **Runs on a stock Mac.** The only prerequisite is `python3` (Apple Command Line Tools,
  Python 3.9+). No Node, Homebrew, or Docker.
- **Python 3.9-compatible code.** That's what Command Line Tools ships. One third-party package:
  `duckdb`, installed in a project-local `.venv`.
- **All downloaded PSFA data is stored as CSV** (`data/psfa_incidents.csv`), which is the system
  of record. The raw national Parquet file (705 MB) is kept in `cache/` (git-ignored) so it can be
  queried again. It is **not** converted to CSV; that would be about 3 GB of mostly other agencies.
- **Works offline** after the first run, except map tiles. Chart and map libraries are vendored
  into the repo.
- **Never overwrite history.** NERIS covers a rolling window, so older incidents may drop out of
  future exports. The update step *merges* new data into the CSV (upserting by incident ID) and
  never deletes rows.

## 3. Repository layout

```
README.md                    How to run (for users), what the data is, caveats
PSFA Dashboard.command       Double-click launcher (Finder) → runs ./run.sh
run.sh                       setup venv → (update data if missing / --update) → serve → open browser
pipeline/
  update_data.py             download → extract PSFA → merge → derive → write CSV + dashboard data
  derive.py                  pure functions: type parsing, labels, time bins (unit-tested)
tests/
  test_derive.py             unittest: parsing, labels, bins, merge/upsert semantics
data/
  psfa_incidents.csv         system of record (committed)
  README.md                  data dictionary
dashboard/
  index.html  app.js  charts.js  map.js  filters.js  styles.css
  data/incidents.js          generated compact columnar data (committed, ~1.5 MB)
  vendor/echarts.min.js  vendor/leaflet/…  (vendored, pinned versions)
cache/                       (git-ignored) NERIS parquet + ETag
```

### Why this shape
- **Static dashboard plus a generated data file.** The browser does all aggregation in JS. For
  32k rows that takes milliseconds, so every filter change can recompute every chart. There's no
  backend to break.
- **Data is a `.js` file (`window.PSFA_DATA = …`), not fetched JSON,** so the dashboard also
  opens by double-clicking `index.html` (`file://`). `run.sh` still serves it on
  `http://127.0.0.1:8765`, because map tile servers expect a normal `http` page.
- **ECharts** handles charts (one file; heatmap, sunburst, brush and dataZoom built in; canvas, so
  it's fast). **Leaflet** handles the map, with a canvas renderer and **leaflet.heat** for density.

## 4. Data pipeline (`pipeline/update_data.py`)

1. **Download:** conditional GET of the NERIS Parquet file into `cache/incidents.parquet`, using
   `If-None-Match` / `If-Modified-Since` (skip if unchanged). Write to a temp file and rename it
   into place when done.
2. **Extract:** DuckDB `SELECT * … WHERE neris_id_dept = 'FD53033674'`.
3. **Merge:** combine with the existing `data/psfa_incidents.csv`, keyed by `neris_id_incident`.
   Newer exports win (edits are allowed upstream). Rows missing from the new export are kept, with
   `in_latest_export = false`. Also track `first_seen_export` and `last_seen_export`.
4. **Derive** (also written to the CSV, so users get them in Excel):
   - `call_local`: `call_create` as written. We verified it's local Pacific time, with a peak
     around 14:00–18:00 and a low around 03:00.
   - `date`, `year`, `month` (`YYYY-MM`), `week_start` (Monday), `weekday` (Mon…Sun), `hour`,
     `tod_bin10` (0–143), `tod_label` (`HH:MM`).
   - `shift_date`: the 24-hour shift a call falls in, assuming shifts start at 07:00
     (configurable). `day_night` (Day 07:00–18:59 / Night).
   - `type_category`, `type_group`, `type_detail`: the three levels of `type_1`. `type_label` is a
     human label, for example `Fire › Outside fire › Trash/rubbish fire`.
   - `category_label`: a friendly top-level name, for example MEDICAL → "Medical (EMS)",
     PUBSERV → "Public service", NOEMERG → "No emergency (cancelled/false)",
     HAZSIT → "Hazardous situation", LAWENFORCE → "Law-enforcement support".
   - `zip` (parsed from `civic_location`), `lat` / `lon` (from `y` / `x`), `units`
     (`unit_response_count`), `aid` (Given / Received / Both / None).
   - `action_primary`: the first-level action, for example `SUPPRESSION`.
     `location_use_group`: the first level of `type_location_use`.
5. **Write:**
   - `data/psfa_incidents.csv` (all original columns + derived, UTF-8, header).
   - `dashboard/data/incidents.js`: a compact columnar form. Strings are dictionary-encoded.
     Time is minutes since the first day. Coordinates are rounded to 5 decimals. Metadata includes
     the export date, data-through date, row count, and the generator version.
   - `data/update_log.csv`: one row per run (timestamp, export date, rows added, updated,
     unchanged).
6. **Sanity checks** that fail loudly: zero PSFA rows; the schema is missing a required column;
   time-of-day looks like UTC (most calls between 00:00 and 06:00).

## 5. Dashboard

### 5.1 Layout (top to bottom, one scrolling page, sticky filter bar)

**Header:** title "PSFA Deployment Dashboard", then "Data through Sep 25, 2026 · NERIS publishes
about 60 days late · 32,119 incidents", a light/dark toggle, and an "About the data" link.

**Filter bar** (sticky, one row, wraps on narrow screens), from left to right:
1. **Date range:** presets (All, Last 30 days of data, Last 90 days of data, each calendar month)
   plus custom From/To dates.
2. **Call category:** multi-select chips for the seven categories.
3. **Units sent:** All / 1 / 2 / 3–4 / 5+.
4. **Aid:** All / Given / Received / None.
5. **Time:** All / Day / Night, and All / Weekdays / Weekends.
6. **Active drill-down chips** added by clicking charts (for example `Type: Vehicle collision ×`,
   `Hour: Tue 17:00 ×`, `ZIP 98032 ×`), plus **Reset**.

The filter state lives in the URL hash, so a view can be bookmarked. The live count reads
"Showing N of M incidents".

**Section A: At a glance** (stat tiles). Incidents; average per day; average per 24-hour shift
with the 90th-percentile day; unit responses (the sum of units); average units per call; share
of calls that are medical; busiest hour of the week; aid given / received.

**Section B: Volume over time.**
- One large chart with a **Day / Week / Month** toggle and a **Measure** toggle
  (Incidents / Unit responses). There's never a second y-axis.
- **Split** toggle: Total, or By category (stacked area, top 4 categories plus "Other").
- The daily view gets a 7-day rolling average line, and the 3 busiest days are labeled directly
  (for example the July 4 spike).
- An ECharts `dataZoom` slider gives local zoom, and an "Apply as date filter" button pushes the
  zoomed range into the global filter.

**Section C: When calls happen.**
- **Time of day, 10-minute bins** (144 points): the average number of calls per 10-minute bin per
  day, as a line with a crosshair. **Compare** toggle: None / Weekday vs weekend / Day of week
  (small multiples) / Category (top 3 plus Other). It has a light Day/Night background band.
- **Hour × weekday heatmap** (sequential blue, with a scale legend). Clicking a cell adds an
  hour+weekday drill-down filter.
- **Day of week** (bars) and **calls per day distribution** (histogram: "a typical day is 110–130
  calls").

**Section D: What the calls are.**
- **Call-type sunburst:** category → group → detail. Clicking a segment filters to that type, and
  clicking the center goes back up.
- **Top 20 call types** (ranked horizontal bars, single hue). Clicking a bar filters.
- **When each type happens:** a heatmap of the top 12 types × 24 hours, with each row normalized to
  its own peak. It shows, for example, vehicle-collision commute peaks against medical calls'
  daytime plateau.
- **Category mix by month:** 100% stacked bars.

**Section E: How the agency deploys.**
- **Units per call** (histogram 0…10+). Clicking filters.
- **Average units by call type** (ranked bars, top 15 types with n ≥ 30) shows which calls get a
  big response.
- **Unit responses by hour of day** (bars), the deployment load through the day.
- **Mutual aid:** aid given vs received by month (grouped bars, one axis), and the top call types
  for aid given and for aid received.
- **What crews did:** top actions and tactics (ranked bars).
- **Where the calls are:** location-use groups (residential, roadway, commercial, and so on) as
  ranked bars.
- **Largest responses:** a table of the incidents with the most units (type, time, units, ZIP).

**Section F: Map.**
- Leaflet with CARTO Positron / Dark Matter tiles (matching the theme), centered on the PSFA
  footprint.
- **Mode** toggle:
  - **Heat** (default): density of the filtered incidents.
  - **Points:** canvas circle markers. "Color by" can highlight up to three categories, with
    everything else in muted gray. Three is the most categorical colors the palette keeps distinct
    on a map. Clicking a point shows a popup with type, date/time, units, aid, location use, and
    ZIP.
- Respects every filter. Next to the map, a **ZIP code ranking** bar chart; clicking a ZIP filters.

**Section G: Explore the data.**
- A paged, sortable table of the filtered incidents (25 per page) with a text search over type.
- **Download filtered CSV** (generated client-side), and a link to the full `data/psfa_incidents.csv`.

**About the data** (dialog): source, the 60-day delay, no unit IDs or stations, `duration` always
0, ZIP-only addresses, generalized medical types, upstream edits, and how to refresh.

### 5.2 Interaction rules (from the dataviz guidance)
- Every chart has hover tooltips, with the value first and the label second. Line charts use an
  axis crosshair. Bars and cells have per-mark tooltips.
- Every chart card has a **"Table" toggle** that shows the same numbers as an HTML table, so
  nothing is reachable only through a tooltip.
- Labels are inserted with `textContent`. Only ECharts' own formatters are used, with HTML
  escaped.
- Changing a filter re-renders every chart from the same filtered slice in one pass.
- Charts keep their previous render while recomputing (they use `setOption` with
  `notMerge: false`), so the page never flashes.

### 5.3 Visual design
- System sans; recessive hairline grids; thin marks; 2px gaps between bars and segments.
- Categorical palette in fixed order (reference palette slots 1–8), assigned **per category
  entity**, never by rank. The seven categories plus "Other" use exactly eight slots, and their
  colors stay the same when filters change.
- Sequential blue ramp for heatmaps. Light and dark palettes both come from `palette.md`, and both
  are validated with `validate_palette.js` if Node is available. Otherwise I'll check the values
  the reference palette has already validated.
- Responsive: two-column cards on desktop, one column under 900px.

## 6. Running it (user's view)

1. Clone or download the repo. Double-click **`PSFA Dashboard.command`**, or run `./run.sh` in
   Terminal.
2. The first run creates `.venv`, installs DuckDB, and opens the browser at
   `http://127.0.0.1:8765`. The committed data shows up immediately.
3. To refresh the data, run `./run.sh --update`, which downloads about 705 MB and merges.
4. If `python3` is missing, the script says to run `xcode-select --install`.

## 7. Testing and verification

- `python3 -m unittest` covers type parsing, labels, time bins and shift dates (including the
  midnight and 07:00 edges), ZIP parsing, merge/upsert (an edited row updates; a missing row is
  kept and flagged), and the UTC-detection check.
- Pipeline run end to end on the real cache. Compare the CSV row count with a direct DuckDB count.
- Browser check with headless Chrome (if installed): load the page, capture console errors, and
  take screenshots of each section in light and dark mode. Then look at them for collisions or
  overflow.
- JS aggregation cross-check: total incidents per category in the dashboard should match the CSV.

## 8. Commit plan

1. Specs and gitignore. 2. Pipeline and tests. 3. Generated data. 4. Dashboard skeleton, filters
and sections A–B. 5. Sections C–E. 6. Map. 7. Table and export. 8. README and launcher. 9. Fixes
from visual verification.

## 9. Out of scope (v1)

Station or unit-level analysis (needs the records request), response times, concurrent-incident
load (duration is 0), and any PulsePoint integration.
