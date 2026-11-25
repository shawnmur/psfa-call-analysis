# PSFA incident data: data dictionary

`psfa_incidents.csv` is the **system of record**. It holds every Puget Sound Regional Fire Authority
incident we've downloaded from **NERIS Public** (U.S. Fire Administration / FSRI), one row per
incident. It opens directly in Excel, Numbers, or Google Sheets.

- **Source:** https://public.neris.fsri.org/, department `FD53033674`.
- **Refresh:** `bash run.sh --update`. Updates *merge*, so rows are never deleted.
- **Times:** local Pacific time, with daylight saving time applied.
- **Removed:** test records (IDs containing `TEST`) and duplicate submissions of the same incident
  (the same CAD number and call time; the latest submission is kept).

## Columns added by this project

| Column | Meaning |
|---|---|
| `status` | `current` = in the latest NERIS export. `history` = older than the latest export's date range, kept from an earlier download. `removed_upstream` = missing from the latest export even though its date is in range (probably deleted or replaced by PSFA). The dashboard hides these rows. |
| `first_seen_export`, `last_seen_export` | The NERIS export dates when we first and last saw this incident. |
| `cad_number` | The dispatch (CAD) incident number, taken from `neris_id_incident`, for example `KF26000029925`. |
| `id_epoch` | The Unix timestamp embedded in the NERIS ID. It equals the call time in UTC and is used to check the time zone. |
| `call_local` | The call-created time (local), `YYYY-MM-DD HH:MM:SS`. |
| `date`, `month`, `week_start`, `weekday`, `hour` | Calendar fields from `call_local`. Weeks start on Monday. |
| `minute_of_day`, `tod_bin10` | Minutes after midnight (0–1439), and the 10-minute time-of-day bin (0–143). |
| `day_night` | `Day` = 07:00–18:59, `Night` = 19:00–06:59. |
| `shift_date`, `shift_hour` | The 24-hour shift the call falls in, **assuming shifts start at 07:00**. A call at 03:00 on the 10th belongs to the 9th's shift, at shift hour 20. |
| `type_level1/2/3`, `type_label` | Human-readable levels of `type_1`, the incident type **as found on scene**, not as dispatched. A missing level reads `(not specified)`. About 63% of incidents are coded only as `Medical`. |
| `category` | The dashboard's 8 groups: Medical, Fire, Alarms (fire alarms plus false alarms), Vehicle collision (from any branch), Hazardous situation, Public service, Cancelled / no emergency, and Rescue & other. |
| `units`, `units_bucket` | Number of **PSFA units** dispatched (`unit_response_count`), and its bucket: 0 / 1 / 2 / 3-4 / 5+. A 0 usually means another agency handled it (aid received). |
| `aid` | Mutual or auto aid: Given (PSFA helped a neighbor, so the call is often outside PSFA's area), Received, Both, or None. |
| `nonfd_aid_normalized` | Non-fire-department help (law enforcement, EMS, and so on), sorted. |
| `zip` | ZIP code from `civic_location`. NERIS doesn't publish street addresses. |
| `lat`, `lon`, `geo_quality` | Coordinates if valid (`ok`). They're blank if `invalid` (outside the region, or 0,0) or `coarse` (fewer than 3 decimal places). |
| `actions` | Actions and tactics, normalized to `LEVEL1\|\|LEVEL2` paths and separated by `; `. Values NERIS truncated are dropped. |
| `location_use_group` | Top level of `type_location_use` (Residential, Roadway, Health care, …) or `Not recorded`. |

## Original NERIS columns (unchanged)

Every column from the NERIS Incident Basics layer is kept as published: `neris_id_incident`, `type_1`, `type_2`,
`type_3`, `aid_direction`, `unit_response_count`, `call_create`, `civic_location`, `x`/`y`,
`action_and_tactics`, fire-specific fields, and so on. NERIS's own field definitions are at
https://public.neris.fsri.org/ago/incident_basics/neris-incident-basics-metadata.txt.

## Known limitations
- NERIS publishes about **60 days late**, and records can be edited after they're submitted.
- **No unit IDs or stations.** Station-level questions need a public-records request.
- `duration` is **always 0** for PSFA, so we can't measure how long calls last.
- Coverage starts 2025-12-29, when PSFA began reporting to NERIS. Early January and the last few days
  before the export are incomplete. The dashboard defaults to an "analysis window" of complete days.
