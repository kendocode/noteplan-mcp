// Tests for the payload-trim flags added 2026-08-29 (context-economy plan,
// Phase 3 row: getNote `brief`, getParagraphs `content`/`lines`, edit_content
// `echo`). `brief`/`content`/`lines` still default to the pre-existing
// behavior. `echo` was flipped to default `false` on 2026-09-06 (P3 row
// 2026-08-18): the echo fields are a courtesy nobody parsed, so trimming them
// by default is safe — unlike `content`/`lines`, where a caller could be
// relying on either shape.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../noteplan/preferences.js', () => ({
  getTaskMarkerConfigCached: vi.fn(() => ({
    isAsteriskTodo: true,
    isDashTodo: false,
    defaultTodoCharacter: '*',
    todoCharacter: '*',
    useCheckbox: true,
    taskPrefix: '* [ ] ',
  })),
  getTaskPrefix: vi.fn(() => '* [ ] '),
}));

vi.mock('../transport/bridge-availability.js', () => ({
  getBridgeClient: vi.fn(async () => null),
}));

const updateNote = vi.fn(async (_identifier: unknown, _content: unknown, _options?: unknown) => ({
  success: true,
}));
const getNoteStore = vi.fn(async (_ref: unknown): Promise<unknown> => null);

vi.mock('../noteplan/unified-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../noteplan/unified-store.js')>();
  return { ...actual, getNote: getNoteStore, updateNote };
});

const { getNote, getParagraphs, editLine, replaceLines, deleteLines } = await import('./notes.js');

type AnyParams = Record<string, unknown>;

const NOTE = {
  id: 'note-1',
  title: 'Test note',
  filename: 'Test note.md',
  content: ['---', 'category: work', 'status: active', '---', '# Test note', '', '## Section one', 'alpha', 'beta', 'gamma'].join('\n'),
  source: 'local' as const,
  type: 'note' as const,
  modifiedAt: new Date(),
  createdAt: new Date(),
};

describe('getNote brief:true', () => {
  beforeEach(() => {
    getNoteStore.mockReset();
    getNoteStore.mockResolvedValue(NOTE);
  });

  it('returns frontmatter + heading map, no body/preview', async () => {
    const result = (await getNote({ id: NOTE.id, brief: true } as AnyParams as Parameters<typeof getNote>[0])) as AnyParams;

    expect(result.success).toBe(true);
    expect(result.brief).toBe(true);
    expect(result.frontmatter).toEqual({ category: 'work', status: 'active' });
    expect(result.headings).toEqual([
      { level: 1, text: 'Test note', line: 5 },
      { level: 2, text: 'Section one', line: 7 },
    ]);
    expect(result.content).toBeUndefined();
    expect(result.preview).toBeUndefined();
  });

  it('default (no brief) is unchanged: preview-only, no frontmatter/headings fields', async () => {
    const result = (await getNote({ id: NOTE.id } as AnyParams as Parameters<typeof getNote>[0])) as AnyParams;

    expect(result.success).toBe(true);
    expect(result.brief).toBeUndefined();
    expect(result.frontmatter).toBeUndefined();
    expect(result.headings).toBeUndefined();
    expect(typeof result.preview).toBe('string');
  });
});

describe('getParagraphs content:false / lines:false', () => {
  beforeEach(() => {
    getNoteStore.mockReset();
    getNoteStore.mockResolvedValue(NOTE);
  });

  it('default returns both content and lines (unchanged)', async () => {
    const result = (await getParagraphs({ id: NOTE.id } as AnyParams as Parameters<typeof getParagraphs>[0])) as AnyParams;
    expect(typeof result.content).toBe('string');
    expect(Array.isArray(result.lines)).toBe(true);
  });

  it('lines:false omits the per-line array, keeps content', async () => {
    const result = (await getParagraphs({ id: NOTE.id, lines: false } as AnyParams as Parameters<typeof getParagraphs>[0])) as AnyParams;
    expect(typeof result.content).toBe('string');
    expect(result.lines).toBeUndefined();
  });

  it('content:false omits the joined string, keeps lines', async () => {
    const result = (await getParagraphs({ id: NOTE.id, content: false } as AnyParams as Parameters<typeof getParagraphs>[0])) as AnyParams;
    expect(result.content).toBeUndefined();
    expect(Array.isArray(result.lines)).toBe(true);
  });
});

describe('edit_content echo default (false)', () => {
  beforeEach(() => {
    updateNote.mockClear();
    getNoteStore.mockReset();
    getNoteStore.mockResolvedValue(NOTE);
  });

  it('editLine default (no echo param) drops originalLine/newLine, keeps outcome fields', async () => {
    const result = (await editLine({ id: NOTE.id, line: 8, content: 'ALPHA' } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.originalLine).toBeUndefined();
    expect(result.newLine).toBeUndefined();
    expect(result.lineDelta).toBe(0);
  });

  it('editLine echo:true opts back in to originalLine/newLine', async () => {
    const result = (await editLine({ id: NOTE.id, line: 8, content: 'ALPHA', echo: true } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.originalLine).toBe('alpha');
    expect(result.newLine).toBe('ALPHA');
  });

  it('replaceLines default (no echo param) drops the attachment-reference array, keeps its count', async () => {
    const result = (await replaceLines({
      id: NOTE.id, startLine: 8, endLine: 8, content: 'ALPHA',
    } as AnyParams as Parameters<typeof replaceLines>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.removedAttachmentReferences).toBeUndefined();
    expect(result.removedAttachmentReferenceCount).toBe(0);
  });

  it('replaceLines echo:true opts back in to the attachment-reference array', async () => {
    const result = (await replaceLines({
      id: NOTE.id, startLine: 8, endLine: 8, content: 'ALPHA', echo: true,
    } as AnyParams as Parameters<typeof replaceLines>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.removedAttachmentReferences).toEqual([]);
    expect(result.removedAttachmentReferenceCount).toBe(0);
  });

  it('deleteLines default (no echo param) drops the attachment-reference array, keeps its count', async () => {
    const preview = (await deleteLines({
      id: NOTE.id, startLine: 8, endLine: 8, dryRun: true,
    } as AnyParams as Parameters<typeof deleteLines>[0])) as AnyParams;
    const result = (await deleteLines({
      id: NOTE.id, startLine: 8, endLine: 8, confirmationToken: preview.confirmationToken,
    } as AnyParams as Parameters<typeof deleteLines>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.removedAttachmentReferences).toBeUndefined();
    expect(result.removedAttachmentReferenceCount).toBe(0);
  });

  it('deleteLines echo:true opts back in to the attachment-reference array', async () => {
    const preview = (await deleteLines({
      id: NOTE.id, startLine: 8, endLine: 8, dryRun: true,
    } as AnyParams as Parameters<typeof deleteLines>[0])) as AnyParams;
    const result = (await deleteLines({
      id: NOTE.id, startLine: 8, endLine: 8, echo: true, confirmationToken: preview.confirmationToken,
    } as AnyParams as Parameters<typeof deleteLines>[0])) as AnyParams;
    expect(result.success).toBe(true);
    expect(result.removedAttachmentReferences).toEqual([]);
    expect(result.removedAttachmentReferenceCount).toBe(0);
  });
});
