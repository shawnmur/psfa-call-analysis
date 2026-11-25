# PSFA Deployment Dashboard: Implementation Spec (v2)

_Status: approved for implementation · 2026-11-25 · see [goals.md](goals.md), [data-sources.md](data-sources.md).
v2 adds the findings from an independent critical review (§10)._

## 1. Goal

Build a dashboard anyone can run on their own computer. It should show how Puget Sound Fire deploys:
**when** calls happen (month, week, day, down to 10-minute time-of-day bins), **what** they are,
**how much** gets sent (units, mutual aid), and **where** (map). It should be impressive to explore.
Every chart responds to one shared set of filters, and clicking a chart mark narrows the view.

**Data source:** NERIS Public, filtered to PSFA (`FD53033674`). That's 32,119 rows in the
2026-11-24 export. Real coverage runs **2025-12-29 → 2026-09-25**, after removing test records.

**Framing shown in the UI:** these are agency-wide numbers. NERIS has no unit IDs or stations, so
"what is a shift at *my* station like" still needs the records request.

## 2. Constraints

- **Runs on a stock Mac.**
  - **Viewing needs only `python3`** (Apple Command Line Tools, 3.9+), using the standard library's
    HTTP server. No packages are needed to view.
  - **Refreshing data** (`--update`) also needs DuckDB. It's installed into a project-local
    `.venv`, after `pip install -U pip`, pinned to a version with Python 3.9 macOS wheels. A failed
    install must never block viewing.
- **All code is Python 3.9-compatible.** No Node, Homebrew, or Docker.
- **The CSV is the system of record.** All PSFA data we download is stored in
  `data/psfa_incidents.csv` (committed). The raw national Parquet file (705 MB) is cached in
  `cache/` (git-ignored); we don't convert it to CSV, because that would be about 3 GB of mostly
  other agencies.
- **Works offline** after cloning, except for map tiles. Libraries are vendored.
- **History is never lost.** Updates merge into the CSV (§4.3). The CSV is written atomically: a
  temp file, then a rename.

## 3. Repository layout

```
README.md                    For users: how to open, refresh, caveats, Gatekeeper help
PSFA Dashboard.command       Double-click launcher → exec bash run.sh
run.sh                       check python3 → (update if asked) → serve on free port → open browser
pipeline/
  update_data.py             download → extract → clean → merge → write CSV + dashboard data (needs duckdb)
  derive.py                  pure stdlib functions: labels, categories, bins, ZIP, coords, merge (unit-tested)
  build_dashboard_data.py    CSV → dashboard/data/incidents.js (stdlib only)
tests/test_derive.py         unittest
data/psfa_incidents.csv      system of record
data/README.md               data dictionary
dashboard/index.html app.js styles.css  data/incidents.js  vendor/…
cache/                       (git-ignored) parquet + ETag
```

`build_dashboard_data.py` only needs the standard library, so the dashboard data can always be
rebuilt from the CSV.

## 4. Data pipeline

### 4.1 Download and extract
- Conditional GET (`If-None-Match` / `If-Modified-Since`) into `cache/incidents.parquet`, written
  to a temp file and then renamed.
- DuckDB: `SELECT * WHERE neris_id_dept='FD53033674'`. Values are cast to strings and written
  through the stdlib csv module, using the union of columns so a schema change can't break it.

### 4.2 Clean
- **Drop test records:** any ID containing `TEST` (for example `2500TEST04`).
- **Parse the ID** as `dept|<CAD number>_<ticks>|<epoch>` into `cad_number` and `id_epoch`.
- **Timezone check:** `id_epoch − call_create` must be UTC−8 or UTC−7, matching Pacific DST.
  Fail loudly if more than 2% of rows don't match. `call_create` is naive local Pacific time.
- **De-duplicate within an export:** rows with the same (`cad_number`, `call_create`) are one
  incident. Keep the row with the largest `id_epoch` (the latest submission).

### 4.3 Merge into the existing CSV
- **Key:** `cad_number + call_create`. `neris_id_incident` is kept as a column.
- If a key exists in the new export, the new row replaces the old one, and `first_seen_export` is
  kept.
- **Existing rows missing from the new export:**
  - If the row's date is **inside** the new export's date span, it's treated as deleted upstream:
    `status = "removed_upstream"` and it's hidden in the dashboard.
  - If it's **older** than the span, it's history: `status = "history"`. It's kept and shown.
- Every row gets `first_seen_export` and `last_seen_export`.

### 4.4 Derived columns (in the CSV too)
- **Time:** `date`, `month` (`YYYY-MM`), `week_start` (Monday), `weekday`, `hour`, `minute`,
  `tod_bin10` (0–143), `day_night` (Day 07:00–18:59), `shift_date` (the 24-hour shift starting at
  07:00, which is an **assumption** and configurable), `shift_hour` (0–23 from the shift start).
  All computed in Python. The browser never bins times in its own timezone.
- **Type:** `type_level1/2/3` from `type_1`. A missing level becomes `"(not specified)"`. 63% of
  rows are just `MEDICAL`. `type_label` is the human path, for example
  `Fire › Outside fire › Trash/rubbish fire`.
- **Dashboard category** (8, in a fixed order, one color each):
  1. Medical: `MEDICAL`
  2. Fire: `FIRE`
  3. Alarms: `PUBSERV||ALARMS_NONMED`, `NOEMERG||FALSE_ALARM`
  4. Vehicle collision: any type whose leaf is `MOTOR_VEHICLE_COLLISION`
  5. Hazardous situation: other `HAZSIT`
  6. Public service: other `PUBSERV`
  7. Cancelled / no emergency: other `NOEMERG`
  8. Rescue & other: `RESCUE`, `LAWENFORCE`, unknown

  Traffic collisions are split out on purpose: they're split across MEDICAL and HAZSIT in NERIS,
  and they matter a lot to a firefighter.
- **Units:** `units` (= `unit_response_count`; these are **PSFA's own units**). `units_bucket` is
  0 / 1 / 2 / 3–4 / 5+.
- **Aid:** Given / Received / Both / None. `nonfd_aid` gets a sorted, normalized multi-value.
- **Location:**
  - `zip`: the first 5-digit token of `civic_location`, else `Unknown`.
  - `lat` / `lon`: valid only if inside the bounding box lat 46.9–47.8, lon −122.6 to −121.6, and
    given to at least 3 decimals. Otherwise they're blanked, with `geo_quality` set to
    `invalid` / `coarse` / `ok`.
- **Actions:** `actions`, the normalized multi-value list (comma-separated hierarchies), and
  `action_groups`, the distinct first levels. `location_use_group` is the first level of
  `type_location_use`, or `Not recorded`.
- `incident_county` is not used.

### 4.5 Dashboard data (`dashboard/data/incidents.js`)
- Columnar form with dictionary-encoded strings: `day` (index from the window start),
  `tod_bin10`, `weekday`, `shift_hour`, category, type levels, units, aid, `zip`, location-use
  group, an action-group bitmask, `lat` / `lon` (5 decimals), and the CAD number.
- **Metadata:** export date; generated-at time; row count; the **complete-day window** (§4.6); the
  first and last data day; and the shift-start assumption.

### 4.6 Analysis window
Coverage starts with a ramp-up (Jan 1–5 at 55–87/day) and ends with a ragged tail (Sep 23: 95,
Sep 24: 76, Sep 25: 7). The pipeline computes the window automatically:
- **Trailing:** drop days from the end while the count is below 0.8 × the median of the
  previous 28 days.
- **Leading:** drop days from the start while the count is below 0.8 × the median of the
  next 28 days.

The dashboard **defaults to this window**. The date presets offer "All data (includes partial
days)". Partial months or weeks at either edge are drawn faded and labeled "partial".

## 5. Dashboard

### 5.1 Global rules
- **Filters scope everything.** A sticky filter bar, one row (wrapping on narrow screens):
  - **Dates:** Analysis window (default) / All data / each month / custom From–To.
  - **Category:** chips for the 8 categories, colored like the series.
  - **Units:** All / 0 / 1 / 2 / 3–4 / 5+.
  - **Aid:** All / Given / Received / None.
  - **Day/Night** and **Weekday/Weekend.**
  - **Drill-down chips** from chart clicks (type, hour×weekday, ZIP, action, location use), plus
    **Reset**.

  The state is stored in the URL hash. "Showing N of M incidents."
- **Averages per day** divide by the number of calendar days in the filtered range, including
  days with zero calls. With a weekday or weekend filter, the denominator counts only the matching
  days. Per weekday×hour cells divide by the number of times that weekday occurs in the range.
- **Colors:**
  - Each category has one fixed color (reference palette slots 1–8). It never changes when filters
    change.
  - Single-series charts use slot 1.
  - Heatmaps use the sequential blue ramp, with a scale legend.
  - There's a light and a dark palette, each validated.
  - There's never a dual axis.
- **Interaction:**
  - Every mark has a tooltip with the value first.
  - Line charts use an axis crosshair.
  - Click-to-filter where marked ⊕.
  - Every chart card has a small **Table** toggle that shows the same numbers. It's generic,
    driven by the data each chart already has.
- **Small samples:** time-of-day charts show `n`, and say "small sample, patterns may be noise"
  when n < 500.

### 5.2 Sections
**Header:** "PSFA Deployment Dashboard". It reads "Data through 2026-09-25 · NERIS publishes
about 60 days late · incident type as found on scene", with a light/dark toggle and **About the
data**.

**A. At a glance** (stat tiles):
- Incidents.
- Average per day, with the 10th–90th percentile day range.
- Unit responses (the sum of units) and average units per call.
- Medical share.
- Busiest weekday-hour.
- Aid given and aid received.

**B. Volume over time:**
- **Day / Week / Month** toggle × **Incidents / Unit responses**.
- **View:** Total, or Category share (100% stacked bars). There's also a **Category small
  multiples** view: 8 mini line charts, each with its own y-scale.
- **Day view:** a 7-day rolling average, and the 3 busiest days labeled automatically (for
  example Mar 13: 239). Partial periods are faded.
- A dataZoom slider for local zoom only.

**C. When calls happen:**
- **Time of day in 10-minute bins**, shown as average calls per bin per day. There's an optional
  30-minute smoothing line, a Day/Night background band, and n displayed.
  **Compare:** None / Weekday vs weekend / By category (Medical, Fire, Vehicle collision, plus
  "All other", using the 3-series cap).
- **Weekday × hour heatmap**, showing average calls ⊕.
- **Day of week**, showing average calls per day.
- **Typical 24-hour shift** (07:00 → 07:00, labeled as an assumption):
  - Calls by shift hour, with the median and 90th percentile across shifts.
  - A distribution of calls per shift.
  - A stat: "on half of shifts, ≥ N calls come after 22:00".

**D. What the calls are:**
- **Category bars** ⊕.
- **Drill-down type explorer:** click a category, then its group bars, then detail bars, with a
  breadcrumb. `(not specified)` is shown explicitly, and there's a note that 63% of incidents are
  only coded "Medical".
- **Top call types excluding plain Medical:** a ranked bar ⊕, with a note showing the Medical
  total.
- **When each type happens:** the top 12 non-plain-medical types × 24 hours, with each row
  normalized to its peak. Row labels include n.

**E. How the agency deploys:**
- **Units per call:** a 0…10+ histogram ⊕. The note says these are PSFA units, and that 0 usually
  means aid was received.
- **Average units by type:** the top 15 types with n ≥ 30, showing which calls get a big
  response.
- **Unit responses by hour of day:** the load on the system.
- **Mutual aid:** Given and Received by month (grouped bars), plus the top types for each.
- **What crews did:** actions exploded per incident, ranked ⊕. The denominator is "incidents with
  any action recorded (N%)".
- **Location use:** ranked, with "Not recorded" shown ⊕.
- **Largest responses:** a table of the top 25 incidents by units.

**F. Map:**
- Leaflet with OpenStreetMap standard tiles, muted to grayscale (inverted in dark mode) with CSS. CARTO was dropped during implementation because its tiles now return an "API key required" watermark.
- The initial view fits bounds to the 1st–99th percentile of the points.
- **Mode:**
  - **Heat** (default): the intensity is capped, so a single repeat address (one point has 158
    calls) doesn't dominate.
  - **Points:** canvas markers, colored by up to 3 highlighted categories, with the rest in gray.
    Popups show type, time, units, aid, location use, and ZIP.
- **Top repeat locations** list (coordinates rounded to 4 decimals), with a note that these are
  often care facilities.
- **ZIP ranking** ⊕.
- Rows with invalid or coarse coordinates are excluded, with a count shown.

**G. Explore the data:**
- A paged, sortable table of the filtered incidents.
- **Download filtered CSV.**
- A pointer to `data/psfa_incidents.csv`.

**About the data** dialog:
- The source and its delay.
- `type_1` is the final type as found on scene, and medical types are generalized.
- No unit IDs or stations.
- `duration` is always 0.
- Addresses are ZIP-only.
- Test and duplicate records are removed.
- The analysis window.
- Aid-given incidents occur outside PSFA's area.
- Mar 8 DST hour.
- How to refresh.

## 6. Running it

- **Double-click `PSFA Dashboard.command`**, or run `bash run.sh` in Terminal.
- The script picks port 8765, or the next free port; prints the URL; opens the browser; and keeps
  serving until the window is closed (it says so).
- **Gatekeeper:** a ZIP download quarantines the `.command`. The README explains right-click →
  Open, `bash run.sh`, and `xattr -dr com.apple.quarantine .`.
- **python3 check:** `run.sh` checks `xcode-select -p` before calling `python3`, so the stub
  doesn't pop a dialog mid-script, and it tells the user to run `xcode-select --install`.
- `bash run.sh --update` refreshes the data.

## 7. Testing and verification
- **unittest** covers:
  - ID parsing and test-row removal;
  - the timezone check;
  - de-duplication;
  - merge (replace, history, removed upstream);
  - categories (alarms, vehicle collisions);
  - type levels with missing levels;
  - bins, shift date and shift hour at the 06:59/07:00 and midnight edges;
  - ZIP and ZIP+4 parsing;
  - coordinate validation;
  - action explode and normalize;
  - the analysis-window trim.
- **The real pipeline** runs on the cached Parquet file, with counts reconciled against a direct
  DuckDB query.
- **Headless Chrome** (developer check only): console errors, plus screenshots in light and dark
  mode, which I'll actually look at.

## 8. Commit plan
1. Pipeline and tests.
2. Data.
3. Dashboard shell, filters, and sections A–B.
4. Sections C–E.
5. Map.
6. Explore table.
7. Launcher and README.
8. Fixes from visual verification.

## 9. Out of scope (v1)
- Station or unit analysis (needs the records request).
- Response times.
- Concurrency (`duration` is 0).
- PulsePoint.
- An "apply zoom as filter" option.
- An update log.

## 10. Review changes (v1 → v2)
1. Remove test rows. Add a computed complete-day window as the default. Partial periods are
   flagged, and averages use calendar-day denominators.
2. The merge key is the CAD number plus `call_create`. Duplicates are resolved by the latest
   submission. Upstream deletions are flagged, the CSV is written atomically, and columns are
   unioned.
3. The sunburst is replaced with drill-down bars, and plain "Medical" is handled explicitly.
4. The type is labeled "as found on scene". Alarms and vehicle collisions become their own
   categories.
5. Added a 0-units bucket, with "PSFA units" wording and aid caveats.
6. The timezone is verified from the ID epoch, and all binning happens in Python. Corrected the
   claimed peak: it's a plateau from 10:00 to 19:00 with a maximum around 11:00.
7. Busiest days are labeled from the data, not hardcoded.
8. Added n, smoothing, and a small-sample note.
9. Map: coordinate validation, percentile bounds, capped heat, and a repeat-locations list. ZIP+4
   parsing is fixed, and `Unknown` covers missing ZIPs.
10. Actions are exploded, with "Not recorded" shown explicitly. `nonfd_aid` is normalized, and
    county is dropped.
11. DuckDB is needed only for updates. Upgrade pip and pin the version.
12. Launcher: Gatekeeper notes, port fallback, the python3 stub check, and a note that closing
    the window stops the server.
13. A single CSV name: `data/psfa_incidents.csv`.
14. Added a "Typical shift" view, labeled as an assumption.
15. Stacked area replaced with share bars or small multiples.
16. The heatmap shows averages per weekday-hour.
17. Trimmed: the zoom-to-filter option and the update log. The per-card Table toggle is kept, but
    made generic and cheap, because the accessibility guidance requires it.

## 11. Implementation notes (post-build)
- **Downloader prefers IPv4.** Python's `urllib` tries addresses one at a time. On networks that
  advertise IPv6 but don't route it, the download appeared to hang. `update_data.py` now tries IPv4
  addresses first.
- **Developer-only URL parameters for screenshots:** `?only=secF` hides other sections,
  `?ui=volView:share` presses segmented buttons, and `?theme=dark` forces a theme.
- **Verified:** the dashboard's totals (31,384 incidents in the window, category counts, 48,525 unit
  responses, 1,917 aid given / 1,648 received) match a direct count from the CSV.
