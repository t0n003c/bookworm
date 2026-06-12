import sqlite3
conn = sqlite3.connect('bookworm.db')
conn.row_factory = sqlite3.Row
row = conn.execute('SELECT title, content FROM notes WHERE id=265').fetchone()
if row:
    print('TITLE:', row['title'])
    print('---')
    print(row['content'])
else:
    print('Not found')
conn.close()
