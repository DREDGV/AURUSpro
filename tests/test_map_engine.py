import unittest

from utils.map_engine import (
    alstation_radius,
    build_greedy_alstation_network,
    build_alstation_suggestions,
    compare_alstation_levels,
    evaluate_alstation_at,
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

    def test_compare_levels_returns_each_requested_level(self):
        players = [
            {"x": 2500, "y": 2500, "map_ready": True},
            {"x": 2510, "y": 2510, "map_ready": True},
        ]
        result = compare_alstation_levels(players, [], levels=[6, 10], limit=3)

        self.assertEqual([item["level"] for item in result], [6, 10])
        self.assertTrue(all(item["radius"] == alstation_radius(item["level"]) for item in result))

    def test_greedy_network_respects_requested_levels(self):
        players = [
            {"x": 2500, "y": 2500, "map_ready": True},
            {"x": 2520, "y": 2520, "map_ready": True},
            {"x": 2550, "y": 2550, "map_ready": True},
        ]
        network = build_greedy_alstation_network(players, [], levels=[6, 10], count=2)

        self.assertTrue(network)
        self.assertTrue(all(item["level"] in [6, 10] for item in network))
        self.assertTrue(all(2000 <= item["x"] <= 3000 for item in network))

    def test_evaluate_alstation_at_uses_weighted_targets(self):
        targets = [
            {"x": 2500, "y": 2500, "map_ready": True, "weight": 6, "name": "OPS"},
            {"x": 2510, "y": 2500, "map_ready": True, "weight": 1, "name": "Moon"},
        ]
        point = {"x": 2500, "y": 2500}

        result = evaluate_alstation_at(point, targets, [], levels=[1, 12])

        self.assertEqual(result[0]["level"], 12)
        self.assertGreaterEqual(result[0]["covered_weight"], 7)
        self.assertTrue(all("score" in item for item in result))


if __name__ == "__main__":
    unittest.main()
