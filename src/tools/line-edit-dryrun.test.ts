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
const getNote = vi.fn(async (_ref: unknown): Promise<unknown> => null);

vi.mock('../noteplan/unified-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../noteplan/unified-store.js')>();
  return { ...actual, getNote, updateNote };
});

const { insertContent, appendContent, editLine, replaceLines, summarizeLineChanges } =
  await import('./notes.js');

const NOTE = {
  id: 'note-1',
  title: 'Test note',
  filename: 'Test note.md',
  content: ['# Test note', '', 'alpha', 'beta', 'gamma'].join('\n'),
  source: 'local' as const,
  type: 'note' as const,
};

type AnyParams = Record<string, unknown>;

describe('summarizeLineChanges', () => {
  it('reports nothing changed for identical content', () => {
    const summary = summarizeLineChanges('a\nb', 'a\nb');
    expect(summary.firstChangedLine).toBeNull();
    expect(summary.removedLineCount).toBe(0);
    expect(summary.addedLineCount).toBe(0);
  });

  it('trims the identical head and tail down to the affected region', () => {
    const summary = summarizeLineChanges('a\nb\nc', 'a\nB\nc');

    expect(summary.firstChangedLine).toBe(2);
    expect(summary.removedLines).toEqual([{ line: 2, content: 'b' }]);
    expect(summary.addedLines).toEqual([{ line: 2, content: 'B' }]);
  });

  it('describes a pure insertion as added lines only', () => {
    const summary = summarizeLineChanges('a\nc', 'a\nb\nc');

    expect(summary.removedLineCount).toBe(0);
    expect(summary.addedLines).toEqual([{ line: 2, content: 'b' }]);
  });

  it('flags truncation past the preview limit', () => {
    const before = 'head\ntail';
    const after = ['head', ...Array.from({ length: 30 }, (_, i) => `new ${i}`), 'tail'].join('\n');
    const summary = summarizeLineChanges(before, after, 20);

    expect(summary.addedLineCount).toBe(30);
    expect(summary.addedLines).toHaveLength(20);
    expect(summary.previewTruncated).toBe(true);
  });
});

describe('dryRun on the line-editing actions', () => {
  beforeEach(() => {
    updateNote.mockClear();
    getNote.mockReset();
    getNote.mockResolvedValue(NOTE);
  });

  it('edit_line previews instead of writing', async () => {
    const result = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      dryRun: true,
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    expect(updateNote).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.confirmationToken).toEqual(expect.any(String));
    expect(result.removedLines).toEqual([{ line: 4, content: 'beta' }]);
    expect(result.addedLines).toEqual([{ line: 4, content: 'BETA' }]);
  });

  it('insert previews instead of writing', async () => {
    const result = (await insertContent({
      id: NOTE.id,
      content: 'inserted',
      position: 'end',
      dryRun: true,
    } as AnyParams as Parameters<typeof insertContent>[0])) as AnyParams;

    expect(updateNote).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.addedLineCount).toBe(1);
    expect(result.confirmationToken).toEqual(expect.any(String));
  });

  it('append previews instead of writing', async () => {
    const result = (await appendContent({
      id: NOTE.id,
      content: 'appended',
      dryRun: true,
    } as AnyParams as Parameters<typeof appendContent>[0])) as AnyParams;

    expect(updateNote).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.confirmationToken).toEqual(expect.any(String));
  });

  it('replace_lines previews instead of writing', async () => {
    const result = (await replaceLines({
      id: NOTE.id,
      startLine: 3,
      endLine: 4,
      content: 'one\ntwo\nthree',
      dryRun: true,
    } as AnyParams as Parameters<typeof replaceLines>[0])) as AnyParams;

    expect(updateNote).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.removedLineCount).toBe(2);
    expect(result.addedLineCount).toBe(3);
  });

  it('honours the string "true" that MCP clients send for booleans', async () => {
    await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      dryRun: 'true',
    } as AnyParams as Parameters<typeof editLine>[0]);

    expect(updateNote).not.toHaveBeenCalled();
  });
});

describe('line edits without dryRun still write in one call', () => {
  beforeEach(() => {
    updateNote.mockClear();
    getNote.mockReset();
    getNote.mockResolvedValue(NOTE);
  });

  it('edit_line writes with no token required', async () => {
    const result = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    expect(result.success).toBe(true);
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('insert writes with no token required', async () => {
    await insertContent({
      id: NOTE.id,
      content: 'inserted',
      position: 'end',
    } as AnyParams as Parameters<typeof insertContent>[0]);

    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('a dryRun token can be spent on the matching edit', async () => {
    const preview = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      dryRun: true,
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    const result = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      confirmationToken: preview.confirmationToken,
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    expect(result.success).toBe(true);
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it('refuses a token that was issued for a different line', async () => {
    const preview = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      dryRun: true,
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    const result = (await editLine({
      id: NOTE.id,
      line: 3,
      content: 'ALPHA',
      confirmationToken: preview.confirmationToken,
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    expect(result.success).toBe(false);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it('refuses a token that was never issued', async () => {
    const result = (await editLine({
      id: NOTE.id,
      line: 4,
      content: 'BETA',
      confirmationToken: 'not-a-real-token',
    } as AnyParams as Parameters<typeof editLine>[0])) as AnyParams;

    expect(result.success).toBe(false);
    expect(updateNote).not.toHaveBeenCalled();
  });
});
