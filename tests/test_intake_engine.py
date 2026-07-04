import unittest

from utils.intake_engine import analyze_intake


PLAYERS = [
    {"id": 1, "nick": "DarkDev"},
    {"id": 2, "nick": "ScoutOne"},
]


class IntakeEngineTest(unittest.TestCase):
    def test_attack_routes_to_defense_task(self):
        result = analyze_intake("DarkDev срочно атакуют, нужен деф на 2500:2500:0", PLAYERS)

        self.assertEqual(result["category"], "attack")
        self.assertEqual(result["priority"], "Критический")
        self.assertEqual(result["routing"]["direction"], "Атака")
        self.assertEqual(result["routing"]["task_type"], "defense_response")
        self.assertEqual(result["players"][0]["nick"], "DarkDev")
        self.assertEqual(result["coordinates"][0]["text"], "[2500:2500:0]")
        self.assertEqual(result["proposals"][0]["kind"], "task")

    def test_alstation_routes_to_network_task(self):
        result = analyze_intake("Нужно построить алстан на границе сигнала 2510:2500:0", PLAYERS)

        self.assertEqual(result["category"], "alstation")
        self.assertEqual(result["routing"]["direction"], "Алстанции")
        self.assertEqual(result["routing"]["task_type"], "check_network")
        self.assertEqual(result["proposals"][0]["coordinates"], "[2510:2500:0]")

    def test_coordinates_without_strong_keyword_become_scout_task(self):
        result = analyze_intake("ScoutOne нашел цель 2490:2510:0", PLAYERS)

        self.assertEqual(result["category"], "scout")
        self.assertEqual(result["routing"]["direction"], "Разведка")
        self.assertEqual(result["proposals"][0]["task_type"], "scout_point")

    def test_support_message_creates_player_request(self):
        result = analyze_intake("DarkDev нужны ресурсы и помощь с развитием", PLAYERS)

        kinds = [proposal["kind"] for proposal in result["proposals"]]
        self.assertIn("request", kinds)
        self.assertIn("note", kinds)
        self.assertEqual(result["players"][0]["id"], 1)

    def test_diplomacy_routes_to_diplomacy(self):
        result = analyze_intake("Есть конфликт с другим альянсом, нужны переговоры", PLAYERS)

        self.assertEqual(result["category"], "diplomacy")
        self.assertEqual(result["routing"]["direction"], "Дипломатия")
        self.assertEqual(result["proposals"][0]["task_type"], "diplomacy")


if __name__ == "__main__":
    unittest.main()
