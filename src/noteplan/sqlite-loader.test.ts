import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import initSqlJs from 'sql.js';
import { initSqlite, SqliteDatabase } from './sqlite-loader.js';

/**
 * Build a standalone .db file on disk containing `notes(id, title)` seeded with
 * the supplied rows. Written with sql.js directly so the fixture never depends
 * on the sqlite3 CLI.
 */
async function writeDbFile(filePath: string, rows: Array<{ id: string; title: string }>): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT)');
  for (const row of rows) {
    db.run('INSERT INTO notes (id, title) VALUES (?, ?)', [row.id, row.title]);
  }
  fs.writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
}

describe('SqliteDatabase.reload', () => {
  const tmpFiles: string[] = [];

  beforeAll(async () => {
    await initSqlite();
  });

  afterEach(() => {
    while (tmpFiles.length > 0) {
      const p = tmpFiles.pop()!;
      try {
        fs.unlinkSync(p);
      } catch {
        // best-effort
      }
    }
  });

  function tmpPath(): string {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'np-mcp-loader-')), 'teamspace.db');
    tmpFiles.push(p);
    return p;
  }

  it('picks up rows another process wrote after the snapshot was taken', async () => {
    const dbPath = tmpPath();
    await writeDbFile(dbPath, [{ id: 'note-1', title: 'First' }]);

    const database = new SqliteDatabase(dbPath, { readonly: true });
    expect(database.prepare('SELECT id FROM notes WHERE id = ?').get('note-2')).toBeUndefined();

    // The host app creates a note after our in-memory image was loaded.
    await writeDbFile(dbPath, [
      { id: 'note-1', title: 'First' },
      { id: 'note-2', title: 'Created after startup' },
    ]);

    // Still invisible — sql.js reads the file exactly once, at construction.
    expect(database.prepare('SELECT id FROM notes WHERE id = ?').get('note-2')).toBeUndefined();

    database.reload();

    expect(database.prepare('SELECT id FROM notes WHERE id = ?').get('note-2')).toEqual({ id: 'note-2' });
    // Existing rows survive the swap.
    expect(database.prepare('SELECT id FROM notes WHERE id = ?').get('note-1')).toEqual({ id: 'note-1' });

    database.close();
  });

  it('keeps the same object usable, so existing handles do not go stale', async () => {
    const dbPath = tmpPath();
    await writeDbFile(dbPath, [{ id: 'note-1', title: 'First' }]);

    const database = new SqliteDatabase(dbPath, { readonly: true });
    const before = database.getFilePath();

    await writeDbFile(dbPath, [{ id: 'note-1', title: 'Renamed' }]);
    database.reload();

    expect(database.getFilePath()).toBe(before);
    expect(database.prepare('SELECT title FROM notes WHERE id = ?').get('note-1')).toEqual({ title: 'Renamed' });

    database.close();
  });

  it('is a no-op when the file has gone away', async () => {
    const dbPath = tmpPath();
    await writeDbFile(dbPath, [{ id: 'note-1', title: 'First' }]);

    const database = new SqliteDatabase(dbPath, { readonly: true });
    fs.unlinkSync(dbPath);

    expect(() => database.reload()).not.toThrow();
    expect(database.prepare('SELECT id FROM notes WHERE id = ?').get('note-1')).toEqual({ id: 'note-1' });

    database.close();
  });
});
