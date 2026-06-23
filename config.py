import os

APP_VERSION = '0.9.0'
APP_DATE = '2026-06-24'

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
DB_PATH = os.path.join(DATA_DIR, 'aurus.db')

SECRET_KEY = os.environ.get('AURUS_SECRET_KEY', 'aurus-dev-key-change-in-production')

ACCESS_LEVELS = {
    1: {'name': 'Игрок', 'description': 'Своя анкета + общие правила'},
    2: {'name': 'Проверенный игрок', 'description': 'Ограниченные данные по направлению'},
    3: {'name': 'Куратор направления', 'description': 'Данные своего направления'},
    4: {'name': 'Админ направления', 'description': 'Расширенные права блока'},
    5: {'name': 'Совет', 'description': 'Большая часть базы'},
    6: {'name': 'Заместитель', 'description': 'Почти полный доступ'},
    7: {'name': 'Глава', 'description': 'Полный доступ'},
}
