import unittest
from datetime import date

from all_batch_service import parse_production_date, should_include_lot


class AllBatchFilterTest(unittest.TestCase):
    def test_parse_production_date_from_mfg_lot_no(self):
        self.assertEqual(parse_production_date("1-057058-26061201"), date(2026, 6, 12))

    def test_cutoff_keeps_all_lots_through_june_10(self):
        self.assertTrue(should_include_lot("1-063064-26061099", date(2026, 6, 10)))

    def test_after_cutoff_only_keeps_suffix_below_50(self):
        self.assertTrue(should_include_lot("1-057058-26061201", date(2026, 6, 12)))
        self.assertTrue(should_include_lot("1-057058-26061249", date(2026, 6, 12)))
        self.assertFalse(should_include_lot("1-057058-26061250", date(2026, 6, 12)))


if __name__ == "__main__":
    unittest.main()
