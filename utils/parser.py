import re


def parse_player_text(text):
    result = {}

    patterns = {
        'nick': r'(?:ник|nick|никал|название)[:\s]*(.+)',
        'name': r'(?:имя|обращение|зовут)[:\s]*(.+)',
        'country': r'(?:страна|country)[:\s]*(.+)',
        'city': r'(?:город|city)[:\s]*(.+)',
        'timezone': r'(?:часовой\s*пояс|timezone|utc)[:\s]*(.+)',
        'race': r'(?:раса|race)[:\s]*(.+)',
        'rank_in_game': r'(?:звание|ранг|rank)[:\s]*(.+)',
        'activity': r'(?:активность|activity)[:\s]*(.+)',
        'coordinates': r'(?:координаты|coords|положение)[:\s]*(.+)',
        'planets': r'(?:планеты|луны|спутники|планет)[:\s]*(.+)',
        'registration_date': r'(?:дата\s*вступления|регистрация|зашёл)[:\s]*(.+)',
        'willing_to_help': r'(?:готов\s*помогать|помощь)[:\s]*(.+)',
        'needs_help': r'(?:нужна\s*помощь|нужна помощь)[:\s]*(.+)',
        'comment': r'(?:комментарий|заметка|примечание)[:\s]*(.+)',
    }

    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            result[key] = match.group(1).strip()

    accounts = []
    acc_pattern = r'(?:аккаунт|твинк|акк)[:\s]*(.+)'
    acc_matches = re.findall(acc_pattern, text, re.IGNORECASE)
    for acc_text in acc_matches:
        parts = [p.strip() for p in acc_text.split(',')]
        acc = {'nick': parts[0] if parts else ''}
        for part in parts[1:]:
            if 'терран' in part.lower():
                acc['race'] = 'Терран'
            elif 'жук' in part.lower() or 'зерг' in part.lower():
                acc['race'] = 'Жук'
            elif 'тосс' in part.lower() or 'протосс' in part.lower():
                acc['race'] = 'Тосс'
            elif 'твинк' in part.lower():
                acc['account_type'] = 'Твинк'
            elif 'сервис' in part.lower():
                acc['account_type'] = 'Сервисный'
        if acc['nick']:
            accounts.append(acc)

    result['accounts'] = accounts
    return result
