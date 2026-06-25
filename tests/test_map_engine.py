import unittest

from utils.map_engine import (
    alstation_radius,
    build_alstation_suggestions,
    is_map_ready,
    normalize_map_object,
    parse_coordinates,
)


class MapEngineTest(unittest.TestCase):
    def test_parse_new_coordinates(self):
        coords = parse_coordinates("[2500:2504:9]")
        self.assertEqual(coords["x"], 2500)
        self.assertEqual(coords["y"], 2504)
        self.assertEqual(coords["z"], 9)
        self.assertTrue(is_map_ready(coords))

        item = normalize_map_object({}, coords)
        self.assertEqual(item["wx"], 4000)
        self.assertEqual(item["wy"], 0)

    def test_parse_legacy_coordinates_but_do_not_mark_map_ready(self):
        coords = parse_coordinates("109/22/78")
        self.assertEqual(coords["x"], 109)
        self.assertEqual(coords["y"], 22)
        self.assertEqual(coords["z"], 78)
        self.assertFalse(is_map_ready(coords))

    def test_new_coordinates_outside_alliance_area_are_not_map_ready(self):
        coords = parse_coordinates("[12001:12001:3]")
        self.assertFalse(is_map_ready(coords))

    def test_alstation_radius_uses_single_formula(self):
        self.assertEqual(alstation_radius(1), 900)
        self.assertEqual(alstation_radius(8), 7200)
        self.assertEqual(alstation_radius(10), 9000)
        self.assertEqual(alstation_radius(None), 900)

    def test_suggestions_use_only_map_ready_points(self):
        players = [
            {"x": 2500, "y": 2500, "map_ready": True},
            {"x": 2530, "y": 2500, "map_ready": True},
            {"x": 109, "y": 22, "map_ready": False},
        ]
        stations = [{"x": 2500, "y": 2500, "radius": 900, "map_ready": True}]

        suggestions = build_alstation_suggestions(players, stations, level=1, limit=5)

        self.assertTrue(suggestions)
        self.assertTrue(all(item["radius"] == 900 for item in suggestions))
        self.assertTrue(all(2000 <= item["x"] <= 3000 for item in suggestions))
        self.assertTrue(all("wx" in item and "wy" in item for item in suggestions))


if __name__ == "__main__":
    unittest.main()
