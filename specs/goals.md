# PSFA Call Analysis: Project Goals

_Last updated: 2026-11-25_

## 1. Purpose

Build a simple app with a UI that collects call (incident) data for **Puget Sound Fire Authority (PSFA)**
from PulsePoint and visualizes it, so that firefighters and other interested people can get a feel for
how the agency works:

- Which stations are busiest, overall and split by daytime and nighttime.
- What kinds of calls the agency gets, and when they happen (hour of day, day of week, season).
- Which units get sent, how often, and on which kinds of calls.
- How call volume and call mix change across the whole agency over time.

The app should cover **at least a few months of data**. It is a learning and orientation tool, not an
operational one. It must never be relied on for live emergency response.

## 2. Users

| User | Needs |
|---|---|
| **Primary user** | Clear, plain charts that answer "what is a shift at station X like?" Not assumed to be a data analyst. |
| **Explorer** | The raw data as CSV that opens in Excel, Google Sheets, or pandas, to ask their own questions. |
| **Maintainer** (Shawn) | Simple to run and keep running; easy to add charts later. |

## 3. Hard requirements

1. **Everything downloaded is stored in CSV.** Every incident and every unit assignment the app
   collects goes into CSV files on disk, which are the system of record. They must:
   - be readable without the app (plain UTF-8 CSV, header row, one record per row);
   - keep the original PulsePoint field values (raw codes, UTC timestamps) **alongside** derived,
     human-friendly columns (type name, local time, station, day/night);
   - be append-safe and de-duplicated by incident ID, so repeated polling doesn't create duplicates,
     and an incident's row is updated when it later clears;
   - be documented with a short data dictionary so users know what each column means.
2. **At least a few months of history** can be shown and filtered by date range.
3. **Trend visualizations** for stations, call types, timing, units, and agency-wide trends. The full
   list of trends is to be agreed separately.

## 4. What we learned from the reference project (`petergCA/PulsePoint`)

The repo is a Home Assistant integration (Python, v0.2.4). It is the most up-to-date public reference for
the PulsePoint web API. Relevant findings:

### 4.1 API mechanics
- **Single endpoint:** `GET https://api.pulsepoint.org/v1/webapp?resource=incidents&agencyid=<ID>`.
  The legacy `web.pulsepoint.org/DB/giba.php` host was decommissioned on 2026-07-31.
- **No API key.** It does need browser-like `User-Agent`, `Accept`, and `Referer` headers. Without
  them it returns an empty body.
- **Encrypted response:** a `{ct, iv, s}` envelope, AES-256-CBC, with the key derived by OpenSSL
  `EVP_BytesToKey` (MD5) from a password that is hardcoded in the web client. `api.py` has working
  decryption code we can adapt.
- **Payload shape:** `incidents.active[]` and `incidents.recent[]`. Per incident we can rely on:
  `ID`, `PulsePointIncidentCallType` (type code), `FullDisplayAddress`, `Latitude`, `Longitude`,
  `CallReceivedDateTime`, `ClosedDateTime` (UTC ISO-8601), and `Unit[]` (each with at least `UnitID`).
  Other community sources say unit entries also carry a dispatch status
  (`PulsePointDispatchStatus`) and `UnitClearedDateTime`. **We still need to confirm this against
  real PSFA data.**
- **Incident type codes:** `const.py` maps about 110 codes to names (ME = Medical Emergency,
  TC = Traffic Collision, FA = Fire Alarm, and so on) in groups such as Medical, Fire, Alarm, and
  Rescue. We'll reuse this mapping and its grouping for the "call type" charts.
- **Agency ID:** PulsePoint doesn't show agency IDs in its UI. You get one by subscribing to the agency
  at web.pulsepoint.org and reading `localStorage.RespondSavedFeeds` or the `agencyid` request
  parameter. **We don't have PSFA's ID yet.**

### 4.2 Constraints that shape the design
1. **The feed is a live snapshot, not a history API.** It returns only currently active incidents and a
   short rolling list of recently closed ones. There's no date-range query. **To get "a few months
   of data" we have to poll continuously, for a few months, and accumulate.** Nothing we can download
   today goes back months. (The exact size of the "recent" window is to be measured.)
2. **PulsePoint put the API behind AWS WAF bot protection on 2026-09-20.** Non-browser clients now
   get `HTTP 202`, an empty body, and `x-amzn-waf-action: challenge`. **We confirmed this today
   (2026-11-25):** a request from this machine received exactly that response. The reference project
   deliberately does *not* try to get past the challenge. We won't either. Defeating a bot-protection
   control isn't appropriate, and it would be fragile.
3. **Data is limited to what PulsePoint publishes.** There's no patient information, no explicit
   station field, no first-due assignment, and no official response-time fields. Some incident types
   that agencies choose not to publish may be missing entirely.

### 4.3 Consequences for the data source (decision needed)

> **Update (2026-11-25):** PSFA is in **NERIS Public**, a public national dataset (department ID
> `FD53033674`). That makes NERIS the recommended primary source, with a public records request for
> station and unit detail. See [data-sources.md](data-sources.md). The table below is kept for history.

Because of constraints 1 and 2, the direct-polling approach the reference project uses won't work
from a server or script right now. Candidate data sources, roughly in order of fit:

| Option | History | Effort | Notes |
|---|---|---|---|
| **A. Public records request** to PSFA and/or its dispatch center for a CAD incident export | Months to years, immediately | Low code, wait time for the request | Usually richer than PulsePoint: real station and first-due, response times. Washington's Public Records Act applies to public agencies. Probably the best way to get "a few months" right away. |
| **B. Browser-side capture** while a person has web.pulsepoint.org open in their own browser (for example, a small extension or userscript that saves the feed the page already received) | Only from start date forward | Medium | Doesn't defeat the WAF, but needs a browser left open for months to build history. We should check PulsePoint's terms of use first. |
| **C. Direct polling** (reference-project approach) | Only from start date forward | Low | Blocked while the WAF gate is up. Worth keeping as a pluggable source in case PulsePoint relaxes the rule. |
| **D. Official access** through PulsePoint or PSFA (data partnership, published reports) | Varies | Unknown | Worth an email to ask. |

**Design principle:** keep the *collector* (data source) separate from the *store* (CSV) and the
*UI* (charts). Every source writes the same CSV schema, so the charts work whichever source we use and
sources can be combined.

## 5. Key derived concepts

These need to be defined consistently, because the data doesn't provide them directly:

- **Local time:** convert all UTC timestamps to `America/Los_Angeles` and handle DST.
- **Day vs. night:** configurable, defaulting to day = 07:00–18:59 and night = 19:00–06:59. Keep
  shift-start time configurable too, so we can also report "per 24-hour shift" (for example
  07:00–07:00).
- **Station:** inferred from unit IDs through a configurable mapping table (for example, `E71` maps
  to Station 71). We'll build the table from the unit IDs seen in the data and confirm it with PSFA.
  - *Unit responses by station:* every unit on a call counts toward its home station.
  - *Incidents by station:* an approximation of first-due, using the first-listed or earliest-dispatched
    unit. We'll label it as an approximation in the UI.
- **Unit type:** inferred from the unit ID prefix (Engine, Ladder, Medic, Aid, Battalion Chief, and so
  on). The mapping is configurable.
- **Call category:** the type code grouped into the families from `const.py` (Medical, Fire, Alarm,
  Vehicle, Rescue, Hazard, Assist, and so on).
- **Duration:** `ClosedDateTime − CallReceivedDateTime` when both exist. If we poll often enough, we
  can also approximate per-unit time committed from status changes. That figure is approximate.

## 6. Proposed CSV layout (draft)

- `data/incidents.csv`, one row per incident: `incident_id, agency_id, type_code, type_name,
  category, address, latitude, longitude, received_utc, received_local, closed_utc, duration_min,
  day_or_night, hour, weekday, month, inferred_station, unit_count, units (semicolon-joined),
  source, first_seen_utc, last_seen_utc`.
- `data/incident_units.csv`, one row per unit per incident: `incident_id, unit_id, unit_type,
  home_station, dispatch_status, unit_cleared_utc, received_local, type_code, category`. Keeping units
  in their own file makes unit and station analysis easy in a spreadsheet.
- `data/README.md`: the data dictionary.

(If a single file is strictly required, `incidents.csv` alone holds all the data. The units file is a
convenience view of the same data.)

## 7. Non-goals (for now)

- Live alerting or dispatch-style monitoring. The reference project already does that.
- Patient or sensitive information. PulsePoint doesn't publish it, and we won't add it.
- Getting past PulsePoint's bot protection.
- Multi-agency comparison, beyond optionally tagging mutual and auto aid.

## 8. Open questions

1. Which data source (section 4.3)? Should we file a public records request in parallel with
   setting up a forward-looking collector?
2. What is PSFA's PulsePoint agency ID, and does PSFA publish all call types to PulsePoint?
3. What is the authoritative unit-to-station list for PSFA, and what is the shift start time?
4. What form should the app take: a local web app (for example, Python with a simple dashboard) or a
   static HTML dashboard that reads the CSVs? Where will it run, and where should the CSVs live so
   users can get to them?
