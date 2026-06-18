import unittest

from rds_sync_service import _lot_no_matches_lot_code_suffix, _mfg_lot_no_to_lot_codes


class RdsSyncLotCodeTest(unittest.TestCase):
    def test_mfg_lot_no_to_lot_codes_keeps_same_last_two_digits(self):
        lot_codes = _mfg_lot_no_to_lot_codes("1-053054-26060201", line_numbers=["1", "2"])

        self.assertEqual(
            lot_codes,
            [
                "105326060201",
                "105426060201",
                "205326060201",
                "205426060201",
            ],
        )
        self.assertTrue(all(code[-2:] == "01" for code in lot_codes))

    def test_one_piece_box_keeps_same_last_two_digits(self):
        lot_codes = _mfg_lot_no_to_lot_codes("1-000053-26060249", line_numbers=["3"])

        self.assertEqual(lot_codes, ["305326060249"])
        self.assertTrue(_lot_no_matches_lot_code_suffix("1-000053-26060249", lot_codes[0]))

    def test_suffix_mismatch_is_rejected(self):
        self.assertFalse(_lot_no_matches_lot_code_suffix("1-053054-26060201", "105326060250"))

    def test_suffix_match_accepts_display_lot_code_format(self):
        self.assertTrue(_lot_no_matches_lot_code_suffix("1-053054-26060201", "1053_26060201"))


if __name__ == "__main__":
    unittest.main()
