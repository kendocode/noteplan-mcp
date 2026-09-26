import { describe, it, expect, vi, beforeEach } from 'vitest';

// Upstream 1.1.30 (857b0b3). KENDOCLAW FORK DIVERGENCES, kept deliberately (FORK.md,
// feat/dryrun-for-line-edits): replace_lines writes in ONE call when dryRun is not set
// (a token is optional, validated when supplied), and insert/append HONOUR dryRun rather
// than ignoring it. The three upstream assertions that encode the opposite contract are
// rewritten below to the fork's, each marked "fork:"; every other upstream test is as shipped.

// Mock preferences before importing notes.ts (markdown-parser reads UserDefaults at runtime)
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

vi.mock('../noteplan/unified-store.js', () => ({
  getNote: vi.fn(),
  updateNote: vi.fn(),
  ensureCalendarNote: vi.fn(),
}));

vi.mock('../transport/bridge-availability.js', () => ({
  getBridgeClient: vi.fn(() => null),
}));

import * as store from '../noteplan/unified-store.js';
import { editLine, replaceLines, insertContent, appendContent } from './notes.js';

const NOTE_CONTENT = 'line A\nline B\nline C';

function makeNote(content: string = NOTE_CONTENT) {
  return {
    id: 'Notes/scratch.md',
    title: 'scratch',
    filename: 'Notes/scratch.md',
    type: 'note' as const,
    source: 'local' as const,
    folder: 'Notes',
    content,
    modifiedAt: new Date(),
    createdAt: new Date(),
    spaceId: undefined,
    date: undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.getNote).mockResolvedValue(makeNote() as any);
  vi.mocked(store.updateNote).mockResolvedValue(undefined as any);
});

describe('editLine dryRun (issue #8)', () => {
  it('does not write when dryRun=true and marks the response', async () => {
    const result: any = await editLine({
      filename: 'Notes/scratch.md',
      line: 2,
      content: 'line B EDITED',
      dryRun: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.originalLine).toBe('line B');
    expect(result.newLine).toBe('line B EDITED');
    expect(store.updateNote).not.toHaveBeenCalled();
  });

  it('still writes directly without dryRun (single-call default)', async () => {
    const result: any = await editLine({
      filename: 'Notes/scratch.md',
      line: 2,
      content: 'line B EDITED',
    } as any);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBeUndefined();
    expect(store.updateNote).toHaveBeenCalledWith(
      'Notes/scratch.md',
      'line A\nline B EDITED\nline C',
      { source: 'local' }
    );
  });

  it('coerces string "true" for dryRun (MCP param coercion)', async () => {
    const result: any = await editLine({
      filename: 'Notes/scratch.md',
      line: 2,
      content: 'line B EDITED',
      dryRun: 'true',
    } as any);

    expect(result.dryRun).toBe(true);
    expect(store.updateNote).not.toHaveBeenCalled();
  });
});

describe('replaceLines dryRun + confirmationToken', () => {
  it('dryRun=true previews without writing and issues a confirmationToken', async () => {
    const result: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 2,
      endLine: 3,
      content: 'replaced',
      dryRun: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.confirmationToken).toEqual(expect.any(String));
    expect(result.replacedLinesPreview).toEqual([
      { line: 2, content: 'line B' },
      { line: 3, content: 'line C' },
    ]);
    expect(store.updateNote).not.toHaveBeenCalled();
  });

  it('fork: executes in one call without a confirmationToken (upstream requires one)', async () => {
    const result: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 2,
      endLine: 3,
      content: 'replaced',
    } as any);

    expect(result.success).toBe(true);
    expect(store.updateNote).toHaveBeenCalledWith('Notes/scratch.md', 'line A\nreplaced', { source: 'local' });
  });

  it('executes with the token from dryRun', async () => {
    const preview: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 2,
      endLine: 3,
      content: 'replaced',
      dryRun: true,
    } as any);

    const result: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 2,
      endLine: 3,
      content: 'replaced',
      confirmationToken: preview.confirmationToken,
    } as any);

    expect(result.success).toBe(true);
    expect(store.updateNote).toHaveBeenCalledWith(
      'Notes/scratch.md',
      'line A\nreplaced',
      { source: 'local' }
    );
  });

  it('rejects a token issued for a different line range', async () => {
    const preview: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 2,
      endLine: 2,
      content: 'replaced',
      dryRun: true,
    } as any);

    const result: any = await replaceLines({
      filename: 'Notes/scratch.md',
      startLine: 1,
      endLine: 3,
      content: 'replaced',
      confirmationToken: preview.confirmationToken,
    } as any);

    expect(result.success).toBe(false);
    expect(store.updateNote).not.toHaveBeenCalled();
  });

  it('auto-approves without token when NOTEPLAN_SKIP_DRY_RUN=true', async () => {
    process.env.NOTEPLAN_SKIP_DRY_RUN = 'true';
    try {
      const result: any = await replaceLines({
        filename: 'Notes/scratch.md',
        startLine: 2,
        endLine: 3,
        content: 'replaced',
      } as any);

      expect(result.success).toBe(true);
      expect(store.updateNote).toHaveBeenCalled();
    } finally {
      delete process.env.NOTEPLAN_SKIP_DRY_RUN;
    }
  });
});

describe('fork: insert/append honour dryRun (upstream ignores it and writes)', () => {
  it('fork: insert does NOT write when dryRun=true is passed', async () => {
    const result: any = await insertContent({
      filename: 'Notes/scratch.md',
      position: 'end',
      content: 'inserted',
      dryRun: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(store.updateNote).not.toHaveBeenCalled();
  });

  it('fork: append does NOT write when dryRun=true is passed', async () => {
    const result: any = await appendContent({
      filename: 'Notes/scratch.md',
      content: 'appended',
      dryRun: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(store.updateNote).not.toHaveBeenCalled();
  });
});
