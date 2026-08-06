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
  return {
    ...actual,
    getNote,
    updateNote,
  };
});

const { insertContent } = await import('./notes.js');

const NOTE = {
  id: 'note-1',
  title: 'Test note',
  filename: 'Test note.md',
  content: '# Test note\n\n## Section\n',
  source: 'local' as const,
  type: 'note' as const,
};

/** The content handed to store.updateNote by the last insert. */
function writtenContent(): string {
  return updateNote.mock.calls.at(-1)![1] as string;
}

describe('insertContent — block structure', () => {
  beforeEach(() => {
    updateNote.mockClear();
    getNote.mockReset();
    getNote.mockResolvedValue(NOTE);
  });

  it('keeps indented "- " children as bullets under a "* " parent', async () => {
    const result = await insertContent({
      id: NOTE.id,
      content: '* Parent task\n\t- child detail\n\t- another detail',
      position: 'end',
      indentationStyle: 'preserve',
    } as Parameters<typeof insertContent>[0]);

    expect(result.success).toBe(true);
    const written = writtenContent();
    expect(written).toContain('\t- child detail');
    expect(written).toContain('\t- another detail');
    expect(written).not.toContain('* [ ] child detail');
  });

  it('reports the type-formatting pass in the response', async () => {
    const result = await insertContent({
      id: NOTE.id,
      content: '* Parent task\n\t- child detail',
      position: 'end',
      indentationStyle: 'preserve',
    } as Parameters<typeof insertContent>[0]);

    // indentationStyle/linesRetabbed describe only the indentation pass, so a
    // caller reading linesRetabbed: 0 used to have no way to learn that the
    // markers had been rewritten by the earlier one.
    expect(result).toMatchObject({
      indentationStyle: 'preserve',
      linesRetabbed: 0,
      contentFormatting: {
        appliedType: 'task',
        linesPreserved: 2,
      },
    });
  });

  it('still formats a plain multi-line block to the requested type', async () => {
    await insertContent({
      id: NOTE.id,
      content: 'First\nSecond',
      position: 'end',
      type: 'task',
    } as Parameters<typeof insertContent>[0]);

    expect(writtenContent()).toContain('* [ ] First\n* [ ] Second');
  });
});
