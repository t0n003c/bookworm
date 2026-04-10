import sqlite3, json
con = sqlite3.connect('bookworm.db')
print("=== home_pages ===")
for r in con.execute('SELECT id,user_id,name FROM home_pages').fetchall():
    print(r)
print("\n=== event widgets ===")
for r in con.execute("SELECT id,page_id,widget_type,config_json FROM home_widgets WHERE widget_type='event'").fetchall():
    print(r)
print("\n=== ALL widget_types ===")
for r in con.execute("SELECT DISTINCT widget_type FROM home_widgets").fetchall():
    print(r)
