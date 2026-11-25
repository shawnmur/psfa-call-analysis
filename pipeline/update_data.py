#!/usr/bin/env python3
"""Download the NERIS Public incident export, extract PSFA, merge into the CSV.

Usage:
    python3 pipeline/update_data.py              # download if changed, merge, rebuild dashboard data
    python3 pipeline/update_data.py --no-download  # reuse cache/incidents.parquet

Needs the `duckdb` package (run.sh installs it into .venv). Python 3.9+.
"""
import argparse
import csv
import os
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from email.utils import formatdate
from typing import Dict, List

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import derive  # noqa: E402
import build_dashboard_data  # noqa: E402

PARQUET_URL = "https://public.neris.fsri.org/ago/incident_basics/incidents.parquet"
CACHE_DIR = os.path.join(ROOT, "cache")
PARQUET_PATH = os.path.join(CACHE_DIR, "incidents.parquet")
ETAG_PATH = PARQUET_PATH + ".etag"
CSV_PATH = os.path.join(ROOT, "data", "psfa_incidents.csv")
USER_AGENT = "psfa-call-analysis/1.0 (personal research dashboard)"

csv.field_size_limit(10 ** 9)


def log(msg: str) -> None:
    print("[update] " + msg, flush=True)


# --------------------------------------------------------------------------- download
def download(force: bool = False) -> bool:
    """Conditional download. Returns True if a new file was fetched."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    req = urllib.request.Request(PARQUET_URL, headers={"User-Agent": USER_AGENT})
    if not force and os.path.exists(PARQUET_PATH):
        if os.path.exists(ETAG_PATH):
            with open(ETAG_PATH) as f:
                etag = f.read().strip()
            if etag:
                req.add_header("If-None-Match", etag)
        req.add_header("If-Modified-Since", formatdate(os.path.getmtime(PARQUET_PATH), usegmt=True))
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as err:
        if err.code == 304:
            log("NERIS file unchanged since last download - using cache.")
            return False
        raise
    total = int(resp.headers.get("Content-Length") or 0)
    log("Downloading NERIS export (%.0f MB)..." % (total / 1e6))
    fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, suffix=".part")
    done = 0
    last_pct = -10
    with os.fdopen(fd, "wb") as out:
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total:
                pct = int(done * 100 / total)
                if pct >= last_pct + 10:
                    log("  %d%%" % pct)
                    last_pct = pct
    if total and done != total:
        os.remove(tmp)
        raise RuntimeError("Download incomplete (%d of %d bytes)" % (done, total))
    os.replace(tmp, PARQUET_PATH)
    with open(ETAG_PATH, "w") as f:
        f.write(resp.headers.get("ETag", ""))
    return True


# --------------------------------------------------------------------------- extract
def extract_psfa(parquet_path: str) -> List[Dict[str, str]]:
    try:
        import duckdb  # type: ignore
    except ImportError:
        sys.exit("duckdb is not installed. Run:  bash run.sh --update   (it sets up .venv for you)")
    fd, tmp_csv = tempfile.mkstemp(dir=CACHE_DIR, suffix=".csv")
    os.close(fd)
    try:
        con = duckdb.connect()
        p = parquet_path.replace("'", "''")
        con.execute(
            "COPY (SELECT * FROM read_parquet('%s') WHERE neris_id_dept = '%s') "
            "TO '%s' (HEADER, DELIMITER ',')" % (p, derive.PSFA_DEPT_ID, tmp_csv.replace("'", "''"))
        )
        with open(tmp_csv, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))
    finally:
        os.remove(tmp_csv)


# --------------------------------------------------------------------------- csv io
def read_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv_atomic(path: str, rows: List[Dict[str, str]], columns: List[str]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in columns})
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def ordered_columns(new_raw_cols: List[str], existing_cols: List[str]) -> List[str]:
    derived = set(derive.DERIVED_COLUMNS) | set(derive.MERGE_COLUMNS)
    raw = list(new_raw_cols)
    for c in existing_cols:  # union: keep columns that disappeared upstream
        if c not in raw and c not in derived:
            raw.append(c)
    return derive.MERGE_COLUMNS + derive.DERIVED_COLUMNS + [c for c in raw if c not in derived]


# --------------------------------------------------------------------------- main
def clean(raw_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    before = len(raw_rows)
    raw_rows = [r for r in raw_rows if not derive.is_test_record(r.get("neris_id_incident", ""))]
    log("Removed %d test records." % (before - len(raw_rows)))
    valid_l1 = derive.valid_action_level1s(raw_rows)
    rows = []
    bad_time = 0
    for r in raw_rows:
        d = derive.derive_row(r, valid_l1)
        if d is None:
            bad_time += 1
            continue
        rows.append(d)
    if bad_time:
        log("Skipped %d rows with unparseable call_create." % bad_time)

    # Timezone sanity: the ID's epoch must equal call_create read as Pacific time.
    checked = mismatched = 0
    for r in rows:
        ok = derive.timezone_matches(derive.parse_local(r["call_create"]), derive.to_int(r["id_epoch"]))
        if ok is None:
            continue
        checked += 1
        mismatched += 0 if ok else 1
    if checked:
        pct = 100.0 * mismatched / checked
        log("Timezone check: %d/%d rows match Pacific local time (%.1f%% mismatch)." % (checked - mismatched, checked, pct))
        if pct > 2.0:
            sys.exit("call_create no longer looks like Pacific local time - stopping so charts aren't shifted.")

    deduped = derive.dedupe_latest(rows)
    log("Removed %d duplicate submissions." % (len(rows) - len(deduped)))
    return deduped


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-download", action="store_true", help="reuse cache/incidents.parquet")
    ap.add_argument("--force-download", action="store_true", help="download even if unchanged")
    args = ap.parse_args()

    if not args.no_download:
        download(force=args.force_download)
    if not os.path.exists(PARQUET_PATH):
        sys.exit("No cached NERIS file at %s - run without --no-download." % PARQUET_PATH)

    log("Extracting PSFA (%s) from %s ..." % (derive.PSFA_DEPT_ID, PARQUET_PATH))
    raw = extract_psfa(PARQUET_PATH)
    if not raw:
        sys.exit("The NERIS export contains no PSFA rows - not touching the existing CSV.")
    required = {"neris_id_incident", "call_create", "type_1", "unit_response_count", "aid_direction", "x", "y"}
    missing = required - set(raw[0].keys())
    if missing:
        sys.exit("NERIS schema changed - missing columns: %s" % ", ".join(sorted(missing)))
    log("PSFA rows in export: %d" % len(raw))
    export_date = max((r.get("export_date") or "")[:10] for r in raw) or datetime.now().strftime("%Y-%m-%d")

    new_rows = clean(raw)
    existing = read_csv(CSV_PATH)
    existing_cols = list(existing[0].keys()) if existing else []
    merged, stats = derive.merge(existing, new_rows, export_date)
    log("Merge: %(added)d added, %(updated)d updated, %(history)d kept as history, "
        "%(removed_upstream)d removed upstream (kept, hidden)." % stats)

    cols = ordered_columns(list(raw[0].keys()), existing_cols)
    write_csv_atomic(CSV_PATH, merged, cols)
    log("Wrote %s (%d rows)." % (os.path.relpath(CSV_PATH, ROOT), len(merged)))
    build_dashboard_data.main()


if __name__ == "__main__":
    main()
