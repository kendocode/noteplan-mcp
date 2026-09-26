import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bridgeRowToNote,
  filterBridgeRowsByTrash,
  findRootSpaceIdFromRows,
  isTrashFolderRow,
  parseSqliteTimestamp,
} from './space-row-utils.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import type { BridgeSpaceRow } from '../transport/bridge-client.js';

function row(overrides: Partial<BridgeSpaceRow> & { id: string }): BridgeSpaceRow {
  return {
    content: '',
    note_type: SQLITE_NOTE_TYPES.TEAMSPACE_NOTE,
    title: '',
    filename: '',
    parent: null,
    is_dir: 0,
    ...overrides,
  };
}

describe('isTrashFolderRow', () => {
  it('matches @Trash folder regardless of casing', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: '@Trash' })).toBe(true);
    expect(isTrashFolderRow({ is_dir: 1, title: '@trash' })).toBe(true);
    expect(isTrashFolderRow({ is_dir: 1, title: '@TRASH' })).toBe(true);
  });

  it('rejects regular folders', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: 'Notes' })).toBe(false);
  });

  it('rejects notes named @Trash', () => {
    // is_dir = 0 — a note literally titled "@Trash" should not be treated as the system folder.
    expect(isTrashFolderRow({ is_dir: 0, title: '@Trash' })).toBe(false);
  });

  it('handles missing/null title', () => {
    expect(isTrashFolderRow({ is_dir: 1, title: undefined })).toBe(false);
    expect(isTrashFolderRow({ is_dir: 1, title: null })).toBe(false);
  });
});

describe('filterBridgeRowsByTrash', () => {
  it('returns input unchanged when includeTrash=true', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(filterBridgeRowsByTrash(rows, true)).toBe(rows);
  });

  it('returns input unchanged when no @Trash folder exists', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    expect(filterBridgeRowsByTrash(rows)).toEqual(rows);
  });

  it('removes the @Trash folder itself plus its descendants', () => {
    const rows = [
      row({ id: 'space', is_dir: 1, title: 'My Space' }),
      row({ id: 'trash', is_dir: 1, title: '@Trash', parent: 'space' }),
      row({ id: 'note-in-trash', parent: 'trash' }),
      row({ id: 'note-in-trash-subfolder', parent: 'sub-trash-folder' }),
      row({ id: 'sub-trash-folder', is_dir: 1, title: 'Inner', parent: 'trash' }),
      row({ id: 'kept-note', parent: 'space' }),
    ];
    const result = filterBridgeRowsByTrash(rows);
    const ids = result.map((r) => r.id).sort();
    expect(ids).toEqual(['kept-note', 'space']);
  });

  it('handles MULTIPLE @Trash folders (one per teamspace)', () => {
    // Real-world scenario: each teamspace has its own @Trash folder.
    // Both subtrees must be filtered out.
    const rows = [
      row({ id: 'space-a', is_dir: 1, title: 'A' }),
      row({ id: 'trash-a', is_dir: 1, title: '@Trash', parent: 'space-a' }),
      row({ id: 'note-a-trashed', parent: 'trash-a' }),
      row({ id: 'note-a-kept', parent: 'space-a' }),

      row({ id: 'space-b', is_dir: 1, title: 'B' }),
      row({ id: 'trash-b', is_dir: 1, title: '@Trash', parent: 'space-b' }),
      row({ id: 'note-b-trashed', parent: 'trash-b' }),
      row({ id: 'note-b-kept', parent: 'space-b' }),
    ];
    const visible = filterBridgeRowsByTrash(rows).map((r) => r.id).sort();
    expect(visible).toEqual(['note-a-kept', 'note-b-kept', 'space-a', 'space-b']);
  });

  it('does not infinite-loop on a parent-chain cycle inside @Trash', () => {
    // a -> b -> a (corrupt data); both reachable from @Trash root.
    const rows = [
      row({ id: 'trash', is_dir: 1, title: '@Trash' }),
      row({ id: 'a', is_dir: 1, title: 'A', parent: 'trash' }),
      // The bridge graph itself shouldn't have cycles, but be defensive.
      row({ id: 'b', is_dir: 1, title: 'B', parent: 'a' }),
      // Children-by-parent map is built by iterating once over rows, so
      // the dedupe `seen` set inside the BFS is what saves us.
      row({ id: 'note', parent: 'b' }),
    ];
    // Should complete in well under a second; vitest's default 5s timeout
    // catches a real infinite loop.
    const visible = filterBridgeRowsByTrash(rows).map((r) => r.id);
    expect(visible).toEqual([]);
  });
});

describe('findRootSpaceIdFromRows', () => {
  it('returns undefined for a top-level note with no parent', () => {
    const rows = [row({ id: 'orphan' })];
    expect(findRootSpaceIdFromRows('orphan', rows)).toBeUndefined();
  });

  it('walks the chain to the teamspace root', () => {
    const rows = [
      row({ id: 'space', is_dir: 1, note_type: SQLITE_NOTE_TYPES.TEAMSPACE, title: 'Engineering' }),
      row({ id: 'folder', is_dir: 1, parent: 'space', title: 'Subfolder' }),
      row({ id: 'note', parent: 'folder' }),
    ];
    expect(findRootSpaceIdFromRows('note', rows)).toBe('space');
  });

  it('returns undefined when the chain breaks before hitting a teamspace', () => {
    const rows = [
      row({ id: 'note', parent: 'missing-parent' }),
    ];
    expect(findRootSpaceIdFromRows('note', rows)).toBeUndefined();
  });

  it('does NOT infinite-loop on a self-referential parent', () => {
    // Self-loop: row's parent points at itself. Bug regression — the
    // previous implementation hung indefinitely.
    const rows = [row({ id: 'note', parent: 'note' })];
    expect(findRootSpaceIdFromRows('note', rows)).toBeUndefined();
  });

  it('does NOT infinite-loop on a longer parent cycle', () => {
    // a -> b -> a
    const rows = [
      row({ id: 'a', parent: 'b' }),
      row({ id: 'b', parent: 'a' }),
    ];
    expect(findRootSpaceIdFromRows('a', rows)).toBeUndefined();
    expect(findRootSpaceIdFromRows('b', rows)).toBeUndefined();
  });
});

// teamspace.db stores created_at/modified_at as UTC with no zone suffix —
// the writer's currentSqliteTimestamp() is `toISOString().replace('Z', '')`.
// `new Date()` reads a zone-less date-time as LOCAL time, so on a Mac in CDT a
// note written at 15:32:31Z came back as modifiedAt 20:32:31Z, five hours
// ahead (kendoclaw np-live lane, 2026-09-26). Pinned to a non-UTC zone so the
// test is red on any host, a UTC CI runner included.
describe('bridgeRowToNote timestamps', () => {
  const savedTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Chicago';
  });
  afterEach(() => {
    process.env.TZ = savedTZ;
  });

  it('reads a zone-less stored timestamp as UTC, the way the writer stored it', () => {
    const note = bridgeRowToNote(
      row({ id: 'n1', modified_at: '2026-09-26T15:32:31.123', created_at: '2026-09-26 15:30:00' }),
    );
    expect(note.modifiedAt?.toISOString()).toBe('2026-09-26T15:32:31.123Z');
    expect(note.createdAt?.toISOString()).toBe('2026-09-26T15:30:00.000Z');
  });

  it('keeps an explicit zone as written', () => {
    const note = bridgeRowToNote(
      row({ id: 'n2', modified_at: '2026-09-26T15:32:31Z', created_at: '2026-09-26T10:30:00-05:00' }),
    );
    expect(note.modifiedAt?.toISOString()).toBe('2026-09-26T15:32:31.000Z');
    expect(note.createdAt?.toISOString()).toBe('2026-09-26T15:30:00.000Z');
  });
});

describe('parseSqliteTimestamp', () => {
  const savedTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Chicago';
  });
  afterEach(() => {
    process.env.TZ = savedTZ;
  });

  it('returns undefined for missing or unparseable values', () => {
    expect(parseSqliteTimestamp(undefined)).toBeUndefined();
    expect(parseSqliteTimestamp(null)).toBeUndefined();
    expect(parseSqliteTimestamp('')).toBeUndefined();
    expect(parseSqliteTimestamp('not a date')).toBeUndefined();
  });

  it('reads the space-separated SQLite datetime form as UTC', () => {
    expect(parseSqliteTimestamp('2026-09-26 15:32:31')?.toISOString()).toBe('2026-09-26T15:32:31.000Z');
  });

  it('keeps an offset written with or without a colon', () => {
    expect(parseSqliteTimestamp('2026-09-26T10:32:31-05:00')?.toISOString()).toBe('2026-09-26T15:32:31.000Z');
    expect(parseSqliteTimestamp('2026-09-26T10:32:31-0500')?.toISOString()).toBe('2026-09-26T15:32:31.000Z');
  });
});
