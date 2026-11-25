"""Pure, stdlib-only transforms for PSFA NERIS incident rows.

Everything here works on plain dicts of strings (as read from / written to CSV)
so it is easy to unit-test and has no third-party dependencies.
Python 3.9 compatible.
"""
import re
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from zoneinfo import ZoneInfo  # Python 3.9+
    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # pragma: no cover - zoneinfo data missing
    PACIFIC = None

PSFA_DEPT_ID = "FD53033674"
SHIFT_START_HOUR = 7      # ASSUMPTION: 24-hour shifts start at 07:00 (configurable)
DAY_START_HOUR = 7        # "Day" = 07:00-18:59
DAY_END_HOUR = 19

# Bounding box comfortably around PSFA's footprint (Kent, SeaTac, Covington,
# Maple Valley) plus neighbouring agencies it gives aid to.
GEO_BOX = {"lat_min": 46.9, "lat_max": 47.8, "lon_min": -122.6, "lon_max": -121.6}

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Fixed category order: index = palette slot. Never reorder casually - colors
# follow these entities.
CATEGORIES = [
    "Medical",
    "Fire",
    "Alarms",
    "Vehicle collision",
    "Hazardous situation",
    "Public service",
    "Cancelled / no emergency",
    "Rescue & other",
]

NOT_SPECIFIED = "(not specified)"

LABEL_OVERRIDES = {
    "MEDICAL": "Medical",
    "FIRE": "Fire",
    "PUBSERV": "Public service",
    "NOEMERG": "No emergency",
    "HAZSIT": "Hazardous situation",
    "RESCUE": "Rescue",
    "LAWENFORCE": "Law enforcement",
    "ALARMS_NONMED": "Alarms (non-medical)",
    "HAZARD_NONCHEM": "Non-chemical hazard",
    "MOTOR_VEHICLE_COLLISION": "Motor vehicle collision",
    "TRASH_RUBBISH_FIRE": "Trash / rubbish fire",
    "VEGETATION_GRASS_FIRE": "Vegetation / grass fire",
    "CITIZEN_ASSIST_SERVICE_CALL": "Citizen assist / service call",
    "EMS": "EMS",
    "ROADWAY_ACCESS": "Roadway",
    "HEALTH_CARE": "Health care",
    "UTILITY_MISC": "Utility / misc.",
    "AGRICULTURE_STRUCT": "Agricultural structure",
    "OUTDOOR_INDUSTRIAL": "Outdoor industrial",
}


# --------------------------------------------------------------------------- labels
def humanize(code: str) -> str:
    """SOME_CODE -> 'Some code' (with a few hand-written overrides)."""
    if not code:
        return NOT_SPECIFIED
    if code in LABEL_OVERRIDES:
        return LABEL_OVERRIDES[code]
    words = code.replace("_", " ").strip().lower()
    return words[:1].upper() + words[1:]


def type_levels(type_1: str) -> Tuple[str, str, str]:
    """Split 'FIRE||OUTSIDE_FIRE||TRASH_RUBBISH_FIRE' into 3 levels (codes)."""
    parts = [p.strip() for p in (type_1 or "").split("||") if p.strip()]
    parts = (parts + ["", "", ""])[:3]
    return parts[0], parts[1], parts[2]


def type_label(type_1: str) -> str:
    l1, l2, l3 = type_levels(type_1)
    names = [humanize(p) for p in (l1, l2, l3) if p]
    return " › ".join(names) if names else NOT_SPECIFIED


def category_for(type_1: str) -> str:
    l1, l2, l3 = type_levels(type_1)
    levels = (l1, l2, l3)
    if "MOTOR_VEHICLE_COLLISION" in levels:
        return "Vehicle collision"
    if l1 == "MEDICAL":
        return "Medical"
    if l1 == "FIRE":
        return "Fire"
    if (l1 == "PUBSERV" and l2 == "ALARMS_NONMED") or (l1 == "NOEMERG" and l2 == "FALSE_ALARM"):
        return "Alarms"
    if l1 == "HAZSIT":
        return "Hazardous situation"
    if l1 == "PUBSERV":
        return "Public service"
    if l1 == "NOEMERG":
        return "Cancelled / no emergency"
    return "Rescue & other"


# --------------------------------------------------------------------------- ids
def parse_incident_id(neris_id: str) -> Tuple[str, Optional[int]]:
    """'FD53033674|KF26000029925_6392585...|1790211399' -> ('KF26000029925', 1790211399)."""
    parts = (neris_id or "").split("|")
    cad = parts[1].split("_")[0] if len(parts) > 1 else ""
    epoch = None
    if len(parts) > 2:
        try:
            epoch = int(parts[2])
        except ValueError:
            epoch = None
    return cad, epoch


def is_test_record(neris_id: str) -> bool:
    return "TEST" in (neris_id or "").upper()


# --------------------------------------------------------------------------- time
def parse_local(ts: str) -> Optional[datetime]:
    """Parse NERIS call_create ('2026-09-23 17:56:39[.ffffff]') as naive local time."""
    if not ts:
        return None
    ts = ts.strip().replace("T", " ")[:19]
    try:
        return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def expected_utc_offset_hours(local: datetime) -> Optional[int]:
    """UTC offset of America/Los_Angeles at this local time (-8 or -7)."""
    if PACIFIC is None:
        return None
    off = local.replace(tzinfo=PACIFIC).utcoffset()
    return int(off.total_seconds() // 3600) if off is not None else None


def timezone_matches(local: datetime, id_epoch: Optional[int], tolerance_s: int = 300) -> Optional[bool]:
    """True if the ID's epoch equals call_create interpreted as Pacific local time.

    Returns None when it can't be checked (no epoch / no tz data).
    """
    if id_epoch is None or PACIFIC is None:
        return None
    as_utc = local.replace(tzinfo=PACIFIC).astimezone(timezone.utc)
    return abs(as_utc.timestamp() - id_epoch) <= tolerance_s


def time_fields(local: datetime) -> Dict[str, str]:
    d = local.date()
    week_start = d - timedelta(days=d.weekday())
    minute_of_day = local.hour * 60 + local.minute
    shift_date = d if local.hour >= SHIFT_START_HOUR else d - timedelta(days=1)
    return {
        "call_local": local.strftime("%Y-%m-%d %H:%M:%S"),
        "date": d.isoformat(),
        "month": d.strftime("%Y-%m"),
        "week_start": week_start.isoformat(),
        "weekday": WEEKDAYS[d.weekday()],
        "hour": str(local.hour),
        "minute_of_day": str(minute_of_day),
        "tod_bin10": str(minute_of_day // 10),
        "day_night": "Day" if DAY_START_HOUR <= local.hour < DAY_END_HOUR else "Night",
        "shift_date": shift_date.isoformat(),
        "shift_hour": str((local.hour - SHIFT_START_HOUR) % 24),
    }


# --------------------------------------------------------------------------- location
_ZIP_RE = re.compile(r"\b(\d{5})\b")


def parse_zip(civic_location: str) -> str:
    m = _ZIP_RE.search(civic_location or "")
    return m.group(1) if m else "Unknown"


def _decimals(s: str) -> int:
    s = (s or "").strip()
    return len(s.split(".", 1)[1]) if "." in s else 0


def validate_coords(x: str, y: str) -> Tuple[str, str, str]:
    """Return (lat, lon, geo_quality) where quality is ok / coarse / invalid."""
    try:
        lon = float(x)
        lat = float(y)
    except (TypeError, ValueError):
        return "", "", "invalid"
    box = GEO_BOX
    if not (box["lat_min"] <= lat <= box["lat_max"] and box["lon_min"] <= lon <= box["lon_max"]):
        return "", "", "invalid"
    if min(_decimals(x), _decimals(y)) < 3:
        return "", "", "coarse"
    return "%.5f" % lat, "%.5f" % lon, "ok"


# --------------------------------------------------------------------------- multi-values
def normalize_multi(value: str, sep: str = ",") -> List[str]:
    """Split a comma-joined multi-value field, strip, de-dupe, sort."""
    items = {v.strip() for v in (value or "").split(sep) if v.strip()}
    return sorted(items)


def action_paths(value: str, valid_level1: Optional[Iterable[str]] = None) -> List[str]:
    """Normalize action_and_tactics to sorted unique 'LEVEL1||LEVEL2' paths.

    NERIS truncates some values mid-word (e.g. 'VENTI'); when valid_level1 is
    given, paths whose first level isn't in it are dropped.
    """
    valid = set(valid_level1) if valid_level1 is not None else None
    out = set()
    for item in normalize_multi(value):
        parts = [p for p in item.split("||") if p]
        if not parts:
            continue
        if valid is not None and parts[0] not in valid:
            continue
        out.add("||".join(parts[:2]))
    return sorted(out)


def action_label(path: str) -> str:
    return " › ".join(humanize(p) for p in path.split("||"))


def location_use_group(value: str) -> str:
    first = (value or "").split("||")[0].strip()
    return humanize(first) if first else "Not recorded"


def aid_label(value: str) -> str:
    return {"GIVEN": "Given", "RECEIVED": "Received", "BOTH": "Both", "NEITHER": "None"}.get(
        (value or "").strip().upper(), "None"
    )


def units_bucket(units: Optional[int]) -> str:
    if units is None:
        return "Unknown"
    if units <= 0:
        return "0"
    if units == 1:
        return "1"
    if units == 2:
        return "2"
    if units <= 4:
        return "3-4"
    return "5+"


def to_int(value: str) -> Optional[int]:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- per-row derive
DERIVED_COLUMNS = [
    "cad_number", "id_epoch", "call_local", "date", "month", "week_start", "weekday", "hour",
    "minute_of_day", "tod_bin10", "day_night", "shift_date", "shift_hour",
    "type_level1", "type_level2", "type_level3", "type_label", "category",
    "units", "units_bucket", "aid", "nonfd_aid_normalized", "zip", "lat", "lon", "geo_quality",
    "actions", "location_use_group",
]
MERGE_COLUMNS = ["status", "first_seen_export", "last_seen_export"]


def derive_row(raw: Dict[str, str], valid_action_level1: Optional[Iterable[str]] = None) -> Optional[Dict[str, str]]:
    """Add derived columns to a raw NERIS row. Returns None if unusable."""
    local = parse_local(raw.get("call_create", ""))
    if local is None:
        return None
    row = dict(raw)
    cad, epoch = parse_incident_id(raw.get("neris_id_incident", ""))
    row["cad_number"] = cad
    row["id_epoch"] = "" if epoch is None else str(epoch)
    row.update(time_fields(local))
    l1, l2, l3 = type_levels(raw.get("type_1", ""))
    row["type_level1"] = humanize(l1)
    row["type_level2"] = humanize(l2)
    row["type_level3"] = humanize(l3)
    row["type_label"] = type_label(raw.get("type_1", ""))
    row["category"] = category_for(raw.get("type_1", ""))
    units = to_int(raw.get("unit_response_count", ""))
    row["units"] = "" if units is None else str(units)
    row["units_bucket"] = units_bucket(units)
    row["aid"] = aid_label(raw.get("aid_direction", ""))
    row["nonfd_aid_normalized"] = ", ".join(normalize_multi(raw.get("nonfd_aid", "")))
    row["zip"] = parse_zip(raw.get("civic_location", ""))
    row["lat"], row["lon"], row["geo_quality"] = validate_coords(raw.get("x", ""), raw.get("y", ""))
    row["actions"] = "; ".join(action_paths(raw.get("action_and_tactics", ""), valid_action_level1))
    row["location_use_group"] = location_use_group(raw.get("type_location_use", ""))
    return row


def valid_action_level1s(raw_rows: Iterable[Dict[str, str]], min_count: int = 5) -> List[str]:
    """Level-1 action codes seen at least min_count times (filters truncated junk)."""
    counts = {}  # type: Dict[str, int]
    for r in raw_rows:
        for item in normalize_multi(r.get("action_and_tactics", "")):
            first = item.split("||")[0]
            if first:
                counts[first] = counts.get(first, 0) + 1
    return sorted(k for k, v in counts.items() if v >= min_count)


# --------------------------------------------------------------------------- cleaning
def incident_key(row: Dict[str, str]) -> str:
    """Stable reconciliation key: CAD number + local call time."""
    cad = row.get("cad_number") or parse_incident_id(row.get("neris_id_incident", ""))[0]
    when = row.get("call_local") or (parse_local(row.get("call_create", "")) or datetime.min).strftime("%Y-%m-%d %H:%M:%S")
    return "%s@%s" % (cad, when)


def dedupe_latest(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Collapse rows sharing an incident_key, keeping the latest submission (max id_epoch)."""
    best = {}  # type: Dict[str, Dict[str, str]]
    for r in rows:
        k = incident_key(r)
        cur = best.get(k)
        if cur is None or (to_int(r.get("id_epoch", "")) or 0) > (to_int(cur.get("id_epoch", "")) or 0):
            best[k] = r
    return list(best.values())


# --------------------------------------------------------------------------- merge
def merge(existing: Sequence[Dict[str, str]], new: Sequence[Dict[str, str]], export_date: str) -> Tuple[List[Dict[str, str]], Dict[str, int]]:
    """Merge a freshly-derived export into the existing system-of-record rows.

    * key present in new  -> new row wins; first_seen_export preserved; status=current
    * key only in existing, date inside new export's span -> status=removed_upstream
    * key only in existing, date before the span          -> status=history
    Nothing is ever deleted.
    """
    old_by_key = {incident_key(r): r for r in existing}
    new_by_key = {incident_key(r): r for r in new}
    dates = sorted(r["date"] for r in new if r.get("date"))
    span_start = dates[0] if dates else ""
    stats = {"added": 0, "updated": 0, "history": 0, "removed_upstream": 0}
    out = []
    for k, r in new_by_key.items():
        row = dict(r)
        old = old_by_key.get(k)
        row["first_seen_export"] = (old or {}).get("first_seen_export") or export_date
        row["last_seen_export"] = export_date
        row["status"] = "current"
        stats["updated" if old else "added"] += 1
        out.append(row)
    for k, r in old_by_key.items():
        if k in new_by_key:
            continue
        row = dict(r)
        if span_start and row.get("date", "") >= span_start:
            row["status"] = "removed_upstream"
            stats["removed_upstream"] += 1
        else:
            row["status"] = "history"
            stats["history"] += 1
        out.append(row)
    out.sort(key=lambda r: (r.get("call_local", ""), r.get("cad_number", "")))
    return out, stats


# --------------------------------------------------------------------------- analysis window
def daily_counts(dates: Iterable[str]) -> List[Tuple[date, int]]:
    """Calendar-complete list of (day, count), zero-filled."""
    counts = {}  # type: Dict[date, int]
    for s in dates:
        d = date.fromisoformat(s)
        counts[d] = counts.get(d, 0) + 1
    if not counts:
        return []
    first, last = min(counts), max(counts)
    out = []
    d = first
    while d <= last:
        out.append((d, counts.get(d, 0)))
        d += timedelta(days=1)
    return out


def analysis_window(dates: Iterable[str], ratio: float = 0.8, lookaround: int = 28) -> Tuple[str, str]:
    """Trim ramp-up / ragged-tail days. Returns (start, end) ISO dates, inclusive."""
    days = daily_counts(dates)
    if not days:
        return "", ""
    counts = [c for _, c in days]
    lo, hi = 0, len(days) - 1
    while lo < hi:
        ahead = counts[lo + 1: lo + 1 + lookaround]
        if not ahead or counts[lo] >= ratio * statistics.median(ahead):
            break
        lo += 1
    while hi > lo:
        behind = counts[max(lo, hi - lookaround): hi]
        if not behind or counts[hi] >= ratio * statistics.median(behind):
            break
        hi -= 1
    return days[lo][0].isoformat(), days[hi][0].isoformat()
