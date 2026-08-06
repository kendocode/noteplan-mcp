import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the sql.js-backed database. Counting constructions lets the
// tests tell a fresh open from a cached handle.
const constructed: FakeDatabase[] = [];

class FakeDatabase {
  closed = false;
  reloadCount = 0;

  constructor(
    public readonly filePath: string,
    public readonly options?: { readonly?: boolean },
  ) {
    constructed.push(this);
  }

  reload(): void {
    this.reloadCount += 1;
  }

  close(): void {
    this.closed = true;
  }
}

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: actual,
    existsSync: vi.fn(() => true),
  };
});

vi.mock('./sqlite-loader.js', () => ({
  isSqliteAvailable: vi.fn(() => true),
  SqliteDatabase: FakeDatabase,
  initSqlite: vi.fn(async () => {}),
}));

const { closeDatabase, getDatabase, reloadDatabase } = await import('./sqlite-reader.js');

describe('getDatabase / closeDatabase lifecycle', () => {
  beforeEach(() => {
    constructed.length = 0;
    closeDatabase();
    constructed.length = 0;
  });

  it('caches the open handle across calls', () => {
    const first = getDatabase();
    const second = getDatabase();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(constructed).toHaveLength(1);
  });

  it('can reopen after closeDatabase()', () => {
    const first = getDatabase();
    expect(first).not.toBeNull();

    closeDatabase();
    expect((first as unknown as FakeDatabase).closed).toBe(true);

    // Regression: closeDatabase() used to leave the "already checked" latch set,
    // so getDatabase() returned null forever afterwards.
    const second = getDatabase();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(constructed).toHaveLength(2);
  });
});

describe('reloadDatabase', () => {
  beforeEach(() => {
    constructed.length = 0;
    closeDatabase();
    constructed.length = 0;
  });

  it('refreshes the in-memory image in place, keeping the handle identity', () => {
    const database = getDatabase();
    expect(database).not.toBeNull();

    const reloaded = reloadDatabase();

    expect(reloaded).toBe(database);
    expect((database as unknown as FakeDatabase).reloadCount).toBe(1);
    // No second construction: existing references stay valid.
    expect(constructed).toHaveLength(1);
  });

  it('opens the database if it was not open yet', () => {
    const reloaded = reloadDatabase();

    expect(reloaded).not.toBeNull();
    expect(constructed).toHaveLength(1);
  });
});
