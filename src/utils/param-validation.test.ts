import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

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

import { checkApplicableParams, schemaKeys, ERR_UNSUPPORTED_PARAM } from './param-validation.js';
import {
  insertContentSchema,
  appendContentSchema,
  deleteLinesSchema,
  editLineSchema,
  replaceLinesSchema,
} from '../tools/notes.js';

// The real edit_content action set, so these tests fail if a schema changes
// under them rather than passing against a private copy.
const EDIT_CONTENT = {
  insert: insertContentSchema,
  append: appendContentSchema,
  delete_lines: deleteLinesSchema,
  edit_line: editLineSchema,
  replace_lines: replaceLinesSchema,
} as Record<string, z.ZodTypeAny>;

const ENVELOPE = ['action', 'scheduleDate'];

function check(action: string, args: Record<string, unknown>) {
  return checkApplicableParams({
    tool: 'noteplan_edit_content',
    action,
    args: { action, ...args },
    schemas: EDIT_CONTENT,
    envelopeKeys: ENVELOPE,
  });
}

describe('schemaKeys', () => {
  it('reads the shape of a plain object schema', () => {
    expect(schemaKeys(z.object({ a: z.string(), b: z.number() })).sort()).toEqual(['a', 'b']);
  });

  it('unwraps superRefine (ZodEffects), as the real note schemas use', () => {
    const schema = z.object({ a: z.string() }).superRefine(() => {});
    expect(schemaKeys(schema)).toEqual(['a']);
  });

  it('returns nothing for a non-object schema', () => {
    expect(schemaKeys(z.string())).toEqual([]);
  });

  it('finds dryRun on the actions that implement it, and not on the others', () => {
    expect(schemaKeys(deleteLinesSchema)).toContain('dryRun');
    // delete_lines is the ONLY edit_content action with a dryRun implementation.
    // The tool's JSON schema used to advertise replace_lines as well; it has
    // neither the schema field nor any read of it. If one is added, this test
    // fails and the tool description needs updating with it.
    expect(schemaKeys(replaceLinesSchema)).not.toContain('dryRun');
    expect(schemaKeys(editLineSchema)).not.toContain('dryRun');
    expect(schemaKeys(insertContentSchema)).not.toContain('dryRun');
    expect(schemaKeys(appendContentSchema)).not.toContain('dryRun');
  });
});

describe('checkApplicableParams — dryRun safety', () => {
  it('refuses dryRun on edit_line instead of writing anyway', () => {
    const result = check('edit_line', { id: 'n1', line: 4, content: 'x', dryRun: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERR_UNSUPPORTED_PARAM);
    expect(result.unsupported).toEqual(['dryRun']);
    // The message has to point at the action that does honour it.
    expect(result.error).toContain('delete_lines');
  });

  it('refuses dryRun on insert, append and replace_lines too', () => {
    expect(check('insert', { id: 'n1', content: 'x', position: 'end', dryRun: true }).ok).toBe(false);
    expect(check('append', { id: 'n1', content: 'x', dryRun: true }).ok).toBe(false);
    expect(check('replace_lines', {
      id: 'n1',
      startLine: 1,
      endLine: 2,
      content: 'x',
      dryRun: true,
    }).ok).toBe(false);
  });

  it('accepts dryRun on delete_lines, which implements it', () => {
    expect(check('delete_lines', { id: 'n1', startLine: 1, endLine: 2, dryRun: true }).ok).toBe(true);
    expect(check('delete_lines', {
      id: 'n1',
      startLine: 1,
      endLine: 2,
      confirmationToken: 'tok',
    }).ok).toBe(true);
  });
});

describe('checkApplicableParams — silently-dropped formatting params', () => {
  it('refuses type/indentLevel on edit_line, which never read them', () => {
    const result = check('edit_line', {
      id: 'n1',
      line: 4,
      content: 'x',
      type: 'bullet',
      indentLevel: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported.sort()).toEqual(['indentLevel', 'type']);
    expect(result.error).toContain('insert');
  });

  it('names a key that belongs to no action of the tool', () => {
    const result = check('append', { id: 'n1', content: 'x', notAThing: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('not a parameter of noteplan_edit_content');
  });
});

describe('checkApplicableParams — calls that must keep working', () => {
  it('accepts an ordinary insert', () => {
    expect(check('insert', {
      id: 'n1',
      content: '* a task',
      position: 'end',
      type: 'task',
      indentLevel: 1,
      indentationStyle: 'preserve',
    }).ok).toBe(true);
  });

  it('accepts an ordinary edit_line', () => {
    expect(check('edit_line', {
      filename: 'Notes/x.md',
      line: 4,
      content: 'x',
      indentationStyle: 'preserve',
      allowEmptyContent: true,
    }).ok).toBe(true);
  });

  it('accepts the dispatcher-consumed envelope keys', () => {
    expect(check('append', { id: 'n1', content: 'x', scheduleDate: 'tomorrow' }).ok).toBe(true);
  });

  it('ignores keys explicitly set to undefined or null', () => {
    expect(check('edit_line', { id: 'n1', line: 1, content: 'x', dryRun: undefined }).ok).toBe(true);
    expect(check('edit_line', { id: 'n1', line: 1, content: 'x', dryRun: null }).ok).toBe(true);
  });

  it('leaves an unknown action to the dispatcher to report', () => {
    expect(check('not_an_action', { anything: true }).ok).toBe(true);
  });
});
