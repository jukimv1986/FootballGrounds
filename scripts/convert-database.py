"""Converts the original SQLite database (public/data/databases/default/database.sqlite)
into public/data/databases/default/database.json so the browser build needs no SQLite engine.
Text columns in the original file are a mix of UTF-8 and Latin-1, so both are accepted."""
import json
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'public' / 'data' / 'databases' / 'default'
con = sqlite3.connect(root / 'database.sqlite')


def decode(b):
    if isinstance(b, bytes):
        try:
            return b.decode('utf-8')
        except UnicodeDecodeError:
            return b.decode('latin-1')
    return b


con.text_factory = bytes
out = {}
for (table,) in con.execute("select name from sqlite_master where type='table' and name != 'sqlite_sequence'"):
    table = decode(table)
    cur = con.execute(f'select * from {table}')
    cols = [d[0] for d in cur.description]
    out[table] = [{c: decode(v) for c, v in zip(cols, row)} for row in cur.fetchall()]

(root / 'database.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print('database.json:', {k: len(v) for k, v in out.items()})
