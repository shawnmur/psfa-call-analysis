import os
import sys
import unittest
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline"))

import derive as d  # noqa: E402


def raw(**kw):
    base = {
        "neris_id_incident": "FD53033674|KF26000029925_639258557723329621|1790211399",
        "call_create": "2026-09-23 17:56:39",
        "type_1": "FIRE||OUTSIDE_FIRE||TRASH_RUBBISH_FIRE",
        "unit_response_count": "2",
        "aid_direction": "NEITHER",
        "nonfd_aid": "",
        "civic_location": "WA 98032 US",
        "x": "-122.24099",
        "y": "47.37807",
        "action_and_tactics": "SUPPRESSION||OUTSIDE_FIRE_SUPPRESSION||FIRE_CONTROL_EXTINGUISHMENT",
        "type_location_use": "OUTDOOR||GROUND_VACANT_LAND",
    }
    base.update(kw)
    return base


class TestIds(unittest.TestCase):
    def test_parse_id(self):
        cad, epoch = d.parse_incident_id("FD53033674|KF26000029925_639258557723329621|1790211399")
        self.assertEqual(cad, "KF26000029925")
        self.assertEqual(epoch, 1790211399)

    def test_parse_bad_id(self):
        self.assertEqual(d.parse_incident_id(""), ("", None))
        self.assertEqual(d.parse_incident_id("FD1|X_1|notanumber"), ("X", None))

    def test_test_record(self):
        self.assertTrue(d.is_test_record("FD53033674|2500TEST04_1|1"))
        self.assertFalse(d.is_test_record("FD53033674|KF26000029925_1|1"))


class TestTime(unittest.TestCase):
    def test_timezone_matches_pdt_and_pst(self):
        # 2026-09-23 17:56:39 PDT == 2026-09-24 00:56:39 UTC == 1790211399
        self.assertTrue(d.timezone_matches(datetime(2026, 9, 23, 17, 56, 39), 1790211399))
        # Same epoch but treating the time as UTC would be 7h off
        self.assertFalse(d.timezone_matches(datetime(2026, 9, 24, 0, 56, 39), 1790211399))
        # Winter (PST, UTC-8): 2026-01-15 12:00 -> 20:00 UTC
        epoch = int(datetime(2026, 1, 15, 20, 0).replace(tzinfo=__import__("datetime").timezone.utc).timestamp())
        self.assertTrue(d.timezone_matches(datetime(2026, 1, 15, 12, 0), epoch))
        self.assertIsNone(d.timezone_matches(datetime(2026, 1, 15, 12, 0), None))

    def test_parse_local_fractional(self):
        self.assertEqual(d.parse_local("2026-03-01 01:02:03.456"), datetime(2026, 3, 1, 1, 2, 3))
        self.assertIsNone(d.parse_local("garbage"))

    def test_shift_edges(self):
        before = d.time_fields(datetime(2026, 3, 10, 6, 59, 59))
        at = d.time_fields(datetime(2026, 3, 10, 7, 0, 0))
        midnight = d.time_fields(datetime(2026, 3, 10, 0, 0, 0))
        self.assertEqual(before["shift_date"], "2026-03-09")
        self.assertEqual(before["shift_hour"], "23")
        self.assertEqual(at["shift_date"], "2026-03-10")
        self.assertEqual(at["shift_hour"], "0")
        self.assertEqual(midnight["shift_date"], "2026-03-09")
        self.assertEqual(midnight["shift_hour"], "17")

    def test_bins_and_day_night(self):
        f = d.time_fields(datetime(2026, 3, 10, 18, 59, 0))
        self.assertEqual(f["tod_bin10"], str((18 * 60 + 59) // 10))
        self.assertEqual(f["day_night"], "Day")
        self.assertEqual(d.time_fields(datetime(2026, 3, 10, 19, 0))["day_night"], "Night")
        self.assertEqual(d.time_fields(datetime(2026, 3, 10, 23, 59))["tod_bin10"], "143")
        self.assertEqual(f["weekday"], "Tue")
        self.assertEqual(f["week_start"], "2026-03-09")


class TestTypes(unittest.TestCase):
    def test_levels_missing(self):
        self.assertEqual(d.type_levels("MEDICAL"), ("MEDICAL", "", ""))
        row = d.derive_row(raw(type_1="MEDICAL"))
        self.assertEqual(row["type_level2"], d.NOT_SPECIFIED)
        self.assertEqual(row["type_label"], "Medical")

    def test_categories(self):
        c = d.category_for
        self.assertEqual(c("MEDICAL"), "Medical")
        self.assertEqual(c("MEDICAL||INJURY||MOTOR_VEHICLE_COLLISION"), "Vehicle collision")
        self.assertEqual(c("HAZSIT||HAZARD_NONCHEM||MOTOR_VEHICLE_COLLISION"), "Vehicle collision")
        self.assertEqual(c("PUBSERV||ALARMS_NONMED||FIRE_ALARM"), "Alarms")
        self.assertEqual(c("NOEMERG||FALSE_ALARM||MALFUNCTIONING_ALARM"), "Alarms")
        self.assertEqual(c("NOEMERG||CANCELLED"), "Cancelled / no emergency")
        self.assertEqual(c("PUBSERV||CITIZEN_ASSIST||LIFT_ASSIST"), "Public service")
        self.assertEqual(c("HAZSIT||INVESTIGATION||SMOKE_INVESTIGATION"), "Hazardous situation")
        self.assertEqual(c("FIRE||OUTSIDE_FIRE||TRASH_RUBBISH_FIRE"), "Fire")
        self.assertEqual(c("LAWENFORCE||X"), "Rescue & other")
        self.assertEqual(c(""), "Rescue & other")
        for cat in [c("MEDICAL"), c("FIRE")]:
            self.assertIn(cat, d.CATEGORIES)

    def test_label(self):
        self.assertEqual(d.type_label("FIRE||OUTSIDE_FIRE||TRASH_RUBBISH_FIRE"),
                         "Fire › Outside fire › Trash / rubbish fire")


class TestLocation(unittest.TestCase):
    def test_zip(self):
        self.assertEqual(d.parse_zip("WA 98032 US"), "98032")
        self.assertEqual(d.parse_zip("WA 98032 2337 US"), "98032")
        self.assertEqual(d.parse_zip("WA US"), "Unknown")
        self.assertEqual(d.parse_zip(""), "Unknown")

    def test_coords(self):
        self.assertEqual(d.validate_coords("-122.24099", "47.37807"), ("47.37807", "-122.24099", "ok"))
        self.assertEqual(d.validate_coords("0", "0")[2], "invalid")
        self.assertEqual(d.validate_coords("-122.2", "48.99")[2], "invalid")
        self.assertEqual(d.validate_coords("-122.2", "47.4")[2], "coarse")
        self.assertEqual(d.validate_coords("", "")[2], "invalid")


class TestMultiValues(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(d.normalize_multi("LAW_ENFORCEMENT, EMS"), ["EMS", "LAW_ENFORCEMENT"])
        self.assertEqual(d.normalize_multi("EMS, LAW_ENFORCEMENT"), ["EMS", "LAW_ENFORCEMENT"])
        self.assertEqual(d.normalize_multi(""), [])

    def test_actions(self):
        v = "SUPPRESSION||OUTSIDE_FIRE_SUPPRESSION||X, EMERGENCY_MEDICAL_CARE, VENTI"
        self.assertEqual(d.action_paths(v, ["SUPPRESSION", "EMERGENCY_MEDICAL_CARE"]),
                         ["EMERGENCY_MEDICAL_CARE", "SUPPRESSION||OUTSIDE_FIRE_SUPPRESSION"])
        rows = [{"action_and_tactics": "A||B"}] * 5 + [{"action_and_tactics": "TRUNC"}]
        self.assertEqual(d.valid_action_level1s(rows), ["A"])

    def test_location_use(self):
        self.assertEqual(d.location_use_group(""), "Not recorded")
        self.assertEqual(d.location_use_group("ROADWAY_ACCESS||STREET"), "Roadway")

    def test_units(self):
        self.assertEqual([d.units_bucket(u) for u in (0, 1, 2, 3, 4, 5, 12, None)],
                         ["0", "1", "2", "3-4", "3-4", "5+", "5+", "Unknown"])


class TestCleanMerge(unittest.TestCase):
    def test_dedupe_latest(self):
        a = d.derive_row(raw(neris_id_incident="FD|KF1_1|100", aid_direction="NEITHER"))
        b = d.derive_row(raw(neris_id_incident="FD|KF1_2|200", aid_direction="GIVEN"))
        c = d.derive_row(raw(neris_id_incident="FD|KF2_1|100"))
        out = d.dedupe_latest([a, b, c])
        self.assertEqual(len(out), 2)
        kf1 = [r for r in out if r["cad_number"] == "KF1"][0]
        self.assertEqual(kf1["aid"], "Given")

    def test_merge(self):
        def mk(cad, when):
            return d.derive_row(raw(neris_id_incident="FD|%s_1|1" % cad, call_create=when))
        old = [mk("OLD", "2026-01-01 10:00:00"), mk("GONE", "2026-05-01 10:00:00"), mk("KEEP", "2026-05-02 10:00:00")]
        old, _ = d.merge([], old, "2026-06-01")
        updated = mk("KEEP", "2026-05-02 10:00:00")
        updated["units"] = "9"
        new = [updated, mk("NEW", "2026-05-03 10:00:00"), mk("SPAN", "2026-04-01 00:00:00")]
        merged, stats = d.merge(old, new, "2026-07-01")
        by = {r["cad_number"]: r for r in merged}
        self.assertEqual(by["OLD"]["status"], "history")
        self.assertEqual(by["GONE"]["status"], "removed_upstream")
        self.assertEqual(by["KEEP"]["status"], "current")
        self.assertEqual(by["KEEP"]["units"], "9")
        self.assertEqual(by["KEEP"]["first_seen_export"], "2026-06-01")
        self.assertEqual(by["KEEP"]["last_seen_export"], "2026-07-01")
        self.assertEqual(by["NEW"]["first_seen_export"], "2026-07-01")
        self.assertEqual(stats, {"added": 2, "updated": 1, "history": 1, "removed_upstream": 1})
        self.assertEqual(len(merged), 5)


class TestWindow(unittest.TestCase):
    def test_trim(self):
        start = date(2026, 1, 1)
        counts = [10, 50, 60] + [120] * 60 + [95, 76, 7]
        dates = []
        for i, n in enumerate(counts):
            dates += [(start + timedelta(days=i)).isoformat()] * n
        ws, we = d.analysis_window(dates)
        self.assertEqual(ws, (start + timedelta(days=3)).isoformat())
        self.assertEqual(we, (start + timedelta(days=62)).isoformat())

    def test_zero_days_counted(self):
        days = d.daily_counts(["2026-01-01", "2026-01-03"])
        self.assertEqual([c for _, c in days], [1, 0, 1])


if __name__ == "__main__":
    unittest.main()
