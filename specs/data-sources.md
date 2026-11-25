# PSFA Call Analysis: Data Sources

_Last updated: 2026-11-25. Companion to [goals.md](goals.md)._

This file covers what we've learned about where PSFA (Puget Sound Regional Fire Authority) response
data can come from, what each source has, and what it can't do.

## Summary

| Source | Status | History | Unit IDs / stations | Exact times | Recommended role |
|---|---|---|---|---|---|
| **NERIS Public** | Public download, no key | Current year, published about 60 days late (to be confirmed) | Unit *count* only | Call created + duration | **Primary source** for agency-wide trends |
| **Public records request** (PSFA / Valley Com) | Request needed (about 42 days average at Valley Com, per MuckRock) | Months to years | Yes | Full CAD timestamps | **Needed for station and unit trends** |
| **NFIRS public release files** | Public download (OpenFEMA) | 1980–2025 (ended Jan 2026) | No | Alarm time | Optional: year-over-year context |
| **PulsePoint** | **Blocked** by AWS WAF since 2026-09-20 | Live snapshot only | Yes | Received / closed | Not used for now |

## 1. NERIS Public (primary)

NERIS (National Emergency Response Information System) is the U.S. Fire Administration's
replacement for NFIRS. It became the only national system when NFIRS was retired in January 2026.
FSRI (Fire Safety Research Institute) runs a public open-data release called NERIS Public.

- **PSFA is listed:** `Puget Sound Regional Fire Authority`, NERIS department ID **`FD53033674`**
  (state: Washington), from `https://public.neris.fsri.org/data/departments.json`.
- **Incident file:** `https://public.neris.fsri.org/ago/incident_basics/incidents.parquet`.
  It's a single national Parquet file, about 705 MB, refreshed several times a week (this one was
  exported 2026-11-24). Filter on `neris_id_dept = 'FD53033674'`.
- **Metadata / data dictionary:** `https://public.neris.fsri.org/ago/incident_basics/neris-incident-basics-metadata.txt`.
- **Web UI:** `https://public.neris.fsri.org/` lets you filter by state, department, and date
  range, and download a CSV with no code.
- **Access:** no API key, no bot protection, plain HTTPS. DuckDB can query the Parquet file in
  place over HTTP.

### Fields that matter for us

| Field | Use |
|---|---|
| `neris_id_incident` | Unique ID (for de-duplication) |
| `type_1` / `type_2` / `type_3`, `type_1_primary` | Final incident type as found on scene (medical types are generalized) |
| `special_modifiers` | Incident modifiers (scale or category) |
| `call_create` | Timestamp the call was created at dispatch. Drives all time-of-day, day-of-week, and season trends. |
| `duration` | Seconds from call creation until dispatch closed the incident |
| `unit_response_count` | Number of units dispatched |
| `aid_direction`, `nonfd_aid` | Mutual/auto aid given or received; non-fire-department support |
| `civic_location`, `incident_county`, `x`, `y`, `point_origin` | Address and coordinates (for a map) |
| `type_location_use` (+ `in_use`, `intended`, `type_vacancy`) | What kind of place it was (residential, commercial, and so on) |
| `action_and_tactics` | What the crew did on scene (medical actions are generalized) |
| Fire detail fields | `acres_burned`, `room_of_origin`, `building_damage`, smoke alarm / sprinkler presence and operation, hazard flags (CSST, electric, power generation, medical oxygen), `exposure_count`, `displacement_*` |

### Verified against the real data (export of 2026-11-24)
- **32,119 PSFA incidents**, from **2025-12-04** (when PSFA started reporting to NERIS) to
  **2026-09-25**. That's about 3,200–4,000 a month, roughly 120 a day. The latest data is about
  60 days old, so "60-day delay" is correct. There is **no** 60-day cap on history.
- **`call_create` is local Pacific time.** Calls peak 14:00–18:00 and bottom out around 03:00.
- **`type_1`** is a hierarchy separated by `||`, such as `FIRE||OUTSIDE_FIRE||TRASH_RUBBISH_FIRE`.
  Top-level counts: MEDICAL 21,634 (67%), PUBSERV 4,374, NOEMERG 3,056 (cancelled or false alarm),
  FIRE 1,426, HAZSIT 1,277, RESCUE 260, LAWENFORCE 92.
- **`unit_response_count`:** one unit on 64% of calls, two on 23%, three or more on about 11%.
- **`aid_direction`:** aid GIVEN on 1,959 calls and RECEIVED on 1,686.
- **`x` / `y`** (longitude/latitude) are filled in on every row, with about 13k distinct points, so a
  call map works.
- **`duration` is 0 on every PSFA row.** It's unusable, so there's no call-length trend from NERIS.
- **`civic_location` is reduced to the ZIP code** (for example, `WA 98032 US`), so we can chart calls
  by ZIP. `incident_county` is mostly null or inconsistent.
- **`neris_id_incident` contains the dispatch-system (CAD) incident number** (for example,
  `FD53033674|KF26000029925_...|...`). That could let us join NERIS rows to a records-request export.
- The PSFA extract is saved as `data/neris_psfa_incidents.csv` (11.5 MB, all columns).

### Limitations
- **Delay:** the USFA page says Incident Basics is published after a **60-day delay**, while the
  public site says it covers a "60-day trailing window." **We need to check** which is true, and how
  far back PSFA's records go.
- **No unit IDs and no station.** That rules out "busiest station" and "which units" trends from
  this source alone.
- **No unit status timestamps,** so no turnout, travel, or response times.
- Medical incident types and medical actions are generalized for privacy.
- Coverage depends on PSFA reporting consistently. Records can be edited for a while after they're
  submitted, so re-download recent months rather than treating them as final.

## 2. Public records request (for station and unit data)

- PSFA doesn't run its own 911 dispatch. **Valley Communications Center (Valley Com)** in Kent
  dispatches for South King County.
- PSFA accepts requests through its online portal
  (https://pugetsoundfire.org/resources/public-records-request/) under the Washington Public Records
  Act (RCW 42.56). Valley Com can be asked directly too. MuckRock reports about a 42-day average
  response time.
- **What to ask for:** a CAD incident and unit export for a date range, with incident number, call
  type, received time, address or response zone, and per-unit dispatched / en route / on scene /
  cleared times, as CSV or Excel. No patient information.
- This is the only source we've found with unit IDs, stations, and real response times.

## 3. NFIRS public release files (optional context)

- The annual National Fire Incident Reporting System files (1980–2025) are on OpenFEMA / USFA
  (https://www.usfa.fema.gov/data-insights/nfirs/data/).
- They're incident-level and keyed by fire department ID, but there are no 2026 incidents (NFIRS
  stopped taking data in January 2026), they're released roughly a year late, and they have no unit
  IDs.
- Useful for long-term, year-over-year agency trends if we want that later.

## 4. PulsePoint (not used for now)

- The reference implementation is `petergCA/PulsePoint`; details are in [goals.md](goals.md) §4.
- `api.pulsepoint.org` has been behind AWS WAF since 2026-09-20. We confirmed on 2026-11-25 that
  it returns `HTTP 202` with `x-amzn-waf-action: challenge`. We won't bypass it.
- Even when it was open, it was a live snapshot with no history, so months of data meant months of
  continuous polling.
- The only compliant forward-looking collector would be a browser extension that records the feed
  from a page a person has open. We dropped it because NERIS and a records request cover our needs.

## 5. Sources checked and rejected

- **Seattle Real Time Fire 911 (data.seattle.gov):** Seattle Fire only.
- **WA State Fire Marshal "Fire in Washington" report:** a statewide PDF, not a dataset.
- **Kent Reporter weekly call reports (2017–2019):** old, aggregate, incomplete.
- **City-Data / Blazestack:** summaries built on NFIRS.

## 6. How this affects the trends

| Trend group (from the trends proposal) | NERIS alone | Needs a records request |
|---|---|---|
| 1. Station workload | No | Yes |
| 2. Call types | Yes | |
| 3. When calls happen | Yes | |
| 4. Units | Units-per-call only | Unit IDs and unit types |
| 5. Agency-wide trends, aid, duration, map | Yes | |
| 6. Response times | No | Yes |
