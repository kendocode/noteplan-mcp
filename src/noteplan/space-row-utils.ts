// Pure helpers that operate on `BridgeSpaceRow[]` (the row shape the
// `/spaces/notes` bridge endpoint returns). Extracted so they can be
// unit-tested without spinning up a database or a bridge connection.

import { Note } from './types.js';
import { extractTitle } from './markdown-parser.js';
import { SQLITE_NOTE_TYPES } from './types.js';
import type { BridgeSpaceRow } from '../transport/bridge-client.js';

const SPACE_TRASH_FOLDER_TITLE_LOWER = '@trash';

export function isTrashFolderRow(row: { is_dir: number; title?: string | null }): boolean {
  return row.is_dir === 1 && (row.title ?? '').toLowerCase() === SPACE_TRASH_FOLDER_TITLE_LOWER;
}

/**
 * Trash filtering over bridge rows (notes + folders, no SQL). Returns
 * the input unchanged when `includeTrash` is true. Otherwise BFSes from
 * every `@Trash` folder ID and excludes their descendants.
 */
export function filterBridgeRowsByTrash(
  rows: BridgeSpaceRow[],
  includeTrash = false,
): BridgeSpaceRow[] {
  if (includeTrash) return rows;
  const trashFolderIds = rows.filter(isTrashFolderRow).map((r) => r.id);
  if (trashFolderIds.length === 0) return rows;

  const childrenByParent = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parent) {
      const arr = childrenByParent.get(r.parent) ?? [];
      arr.push(r.id);
      childrenByParent.set(r.parent, arr);
    }
  }
  const trashed = new Set<string>();
  const queue = [...trashFolderIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (trashed.has(id)) continue;
    trashed.add(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return rows.filter((r) => !trashed.has(r.id));
}

export function bridgeRowToNote(row: BridgeSpaceRow, allRows?: BridgeSpaceRow[]): Note {
  const isCalendar = row.note_type === SQLITE_NOTE_TYPES.TEAMSPACE_CALENDAR;
  const spaceId = allRows ? findRootSpaceIdFromRows(row.id, allRows) : undefined;
  return {
    id: row.id,
    title: row.content ? extractTitle(row.content) : row.title || 'Untitled',
    filename: row.filename,
    content: row.content || '',
    type: isCalendar ? 'calendar' : 'note',
    source: 'space',
    spaceId,
    folder: row.parent || undefined,
    modifiedAt: parseSqliteTimestamp(row.modified_at),
    createdAt: parseSqliteTimestamp(row.created_at),
  };
}

const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * teamspace.db's created_at/modified_at are UTC with no zone suffix
 * (sqlite-writer's currentSqliteTimestamp: `toISOString().replace('Z', '')`).
 * `new Date()` reads a zone-less date-time as LOCAL time, which put every
 * space note's timestamps off by the Mac's UTC offset (5 h ahead in CDT), so
 * a zone-less value is read as UTC here; an explicit zone is kept.
 */
export function parseSqliteTimestamp(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s)) {
    s = s.replace(' ', 'T');
    if (!ZONED.test(s)) s += 'Z';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Walk the parent chain to find a row's root teamspace ID. Defensive
 * against parent cycles (corrupt or hand-edited DB rows): a `seen` set
 * breaks any loop and returns undefined.
 */
export function findRootSpaceIdFromRows(noteId: string, rows: BridgeSpaceRow[]): string | undefined {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  let current = byId.get(noteId);
  while (current && current.parent) {
    if (seen.has(current.id)) return undefined;
    seen.add(current.id);
    const parent = byId.get(current.parent);
    if (!parent) break;
    if (parent.note_type === SQLITE_NOTE_TYPES.TEAMSPACE) return parent.id;
    current = parent;
  }
  return undefined;
}
