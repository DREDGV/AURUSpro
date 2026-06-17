import sqlite3
conn = sqlite3.connect('data/aurus.db')
c = conn.cursor()

print("=== Players with coordinates ===")
c.execute("SELECT nick, coordinates FROM players WHERE coordinates IS NOT NULL AND coordinates != ''")
for r in c.fetchall():
    print(f"  {r[0]:25s} | {r[1]}")

print("\n=== Accounts with coordinates ===")
c.execute("SELECT nick, race, coordinates FROM accounts WHERE coordinates IS NOT NULL AND coordinates != ''")
for r in c.fetchall():
    print(f"  {r[0]:20s} | {r[1]:6s} | {r[2]}")

print("\n=== Objects with coordinates ===")
c.execute("SELECT name, object_type, coordinates FROM game_objects WHERE coordinates IS NOT NULL AND coordinates != ''")
for r in c.fetchall():
    print(f"  {r[0]:25s} | {r[1]:12s} | {r[2]}")

conn.close()
