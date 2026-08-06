import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; filename: string; parent: string | null; is_dir: number; title?: string };

/**
 * Minimal stand-in for SqliteDatabase. `rows` is swapped by the test to model
 * NotePlan creating a note after this process took its in-memory snapshot;
 * `reload()` is what makes the new rows visible.
 */
class FakeDatabase {
  rows: Row[] = [];
  pendingRows: Row[] | null = null;
  reloadCount = 0;
  updates: Array<{ sql: string; params: unknown[] }> = [];

  reload(): void {
    this.reloadCount += 1;
    if (this.pendingRows) {
      this.rows = this.pendingRows;
      this.pendingRows = null;
    }
  }

  prepare(sql: string) {
    const self = this;
    return {
      get(...params: unknown[]) {
        if (/FROM\s+notes/i.test(sql)) {
          const identifier = params[0];
          return self.rows.find((r) => r.id === identifier || r.filename === identifier);
        }
        return undefined;
      },
      all() {
        return [];
      },
      run(...params: unknown[]) {
        self.updates.push({ sql, params });
        return { changes: 1, lastInsertRowid: 1 };
      },
    };
  }
}

const fakeDb = new FakeDatabase();

vi.mock('./sqlite-reader.js', () => ({
  getDatabase: vi.fn(() => fakeDb),
  reloadDatabase: vi.fn(() => {
    fakeDb.reload();
    return fakeDb;
  }),
  listSpaces: vi.fn(async () => []),
  getDatabasePath: vi.fn(() => '/tmp/teamspace.db'),
}));

const { updateSpaceNote, updateSpaceNoteTitle } = await import('./sqlite-writer.js');

const NOTE: Row = { id: 'note-created-after-startup', filename: '20260806.md', parent: 'folder-1', is_dir: 0 };

describe('space writer node resolution', () => {
  beforeEach(() => {
    fakeDb.rows = [];
    fakeDb.pendingRows = null;
    fakeDb.reloadCount = 0;
    fakeDb.updates = [];
  });

  it('writes to a note that already exists in the snapshot without reloading', () => {
    fakeDb.rows = [NOTE];

    updateSpaceNote(NOTE.id, 'hello');

    expect(fakeDb.reloadCount).toBe(0);
    expect(fakeDb.updates.some((u) => /UPDATE\s+notes/i.test(u.sql))).toBe(true);
  });

  it('reloads and retries when the note is missing from the stale snapshot', () => {
    // Snapshot predates the note; a reload makes it visible.
    fakeDb.rows = [];
    fakeDb.pendingRows = [NOTE];

    expect(() => updateSpaceNote(NOTE.id, 'hello')).not.toThrow();

    expect(fakeDb.reloadCount).toBe(1);
    expect(fakeDb.updates.some((u) => /UPDATE\s+notes/i.test(u.sql))).toBe(true);
  });

  it('applies the same retry to title updates', () => {
    fakeDb.rows = [];
    fakeDb.pendingRows = [NOTE];

    expect(() => updateSpaceNoteTitle(NOTE.id, 'New title')).not.toThrow();

    expect(fakeDb.reloadCount).toBe(1);
  });

  it('still reports a genuinely missing note, and reloads only once', () => {
    fakeDb.rows = [];
    fakeDb.pendingRows = null;

    expect(() => updateSpaceNote('no-such-note', 'hello')).toThrow(/no-such-note/);
    expect(fakeDb.reloadCount).toBe(1);
  });
});
