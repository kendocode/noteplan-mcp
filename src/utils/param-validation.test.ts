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
  getParagraphsSchema,
  searchParagraphsSchema,
  searchParagraphsGlobalSchema,
} from '../tools/notes.js';
import {
  addTaskSchema,
  completeTaskSchema,
  updateTaskSchema,
  deleteRecurringTaskSchema,
} from '../tools/tasks.js';

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

// The real noteplan_paragraphs action set (server.ts's TOOL_ACTION_SCHEMAS),
// so these tests fail if that map drifts from what's actually registered.
const PARAGRAPHS = {
  get: getParagraphsSchema,
  search: searchParagraphsSchema,
  search_global: searchParagraphsGlobalSchema,
  add: addTaskSchema,
  complete: completeTaskSchema,
  update: updateTaskSchema,
  delete_recurring: deleteRecurringTaskSchema,
} as Record<string, z.ZodTypeAny>;

const PARAGRAPHS_ENVELOPE = ['action', 'scheduleDate', 'date', 'filename', 'target'];

function checkParagraphs(action: string, args: Record<string, unknown>) {
  return checkApplicableParams({
    tool: 'noteplan_paragraphs',
    action,
    args: { action, ...args },
    schemas: PARAGRAPHS,
    envelopeKeys: PARAGRAPHS_ENVELOPE,
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

  it('finds dryRun on every action that implements it', () => {
    // All five edit_content actions implement dryRun. The guard reads that from
    // the schemas, so an action losing its implementation would start refusing
    // the parameter rather than silently ignoring it again.
    for (const schema of [
      deleteLinesSchema,
      replaceLinesSchema,
      editLineSchema,
      insertContentSchema,
      appendContentSchema,
    ]) {
      expect(schemaKeys(schema)).toContain('dryRun');
      expect(schemaKeys(schema)).toContain('confirmationToken');
    }
  });
});

describe('checkApplicableParams — dryRun safety', () => {
  it('accepts dryRun on every action that implements it', () => {
    expect(check('delete_lines', { id: 'n1', startLine: 1, endLine: 2, dryRun: true }).ok).toBe(true);
    expect(check('edit_line', { id: 'n1', line: 4, content: 'x', dryRun: true }).ok).toBe(true);
    expect(check('insert', { id: 'n1', content: 'x', position: 'end', dryRun: true }).ok).toBe(true);
    expect(check('append', { id: 'n1', content: 'x', dryRun: true }).ok).toBe(true);
    expect(check('replace_lines', {
      id: 'n1',
      startLine: 1,
      endLine: 2,
      content: 'x',
      dryRun: true,
    }).ok).toBe(true);
  });

  it('accepts confirmationToken wherever dryRun is accepted', () => {
    expect(check('edit_line', { id: 'n1', line: 4, content: 'x', confirmationToken: 'tok' }).ok).toBe(true);
    expect(check('delete_lines', {
      id: 'n1',
      startLine: 1,
      endLine: 2,
      confirmationToken: 'tok',
    }).ok).toBe(true);
  });

  it('still refuses a safety flag on an action that never implemented one', () => {
    // startLine belongs to the range actions only; passing it to edit_line was
    // accepted and dropped before the check existed.
    const result = check('edit_line', { id: 'n1', line: 4, content: 'x', startLine: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERR_UNSUPPORTED_PARAM);
    expect(result.unsupported).toEqual(['startLine']);
    expect(result.error).toContain('delete_lines');
    expect(result.error).toContain('replace_lines');
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

// Covers deficiency 2026-09-13-noteplan-mcp-paragraphs-get-content-lines-flags-
// unreachable-via-mcp-schema: `get`/`search`/`search_global` were absent from
// the guard's schema map entirely, so nothing on those actions was ever
// checked — `paragraphMaxChars` (a `search`-only param) was silently accepted
// and ignored by `get`.
describe('checkApplicableParams — noteplan_paragraphs read actions', () => {
  it('accepts the get payload-trim flags and the types filter', () => {
    expect(checkParagraphs('get', { id: 'n1', includeContent: false }).ok).toBe(true);
    expect(checkParagraphs('get', { id: 'n1', includeLines: false }).ok).toBe(true);
    expect(checkParagraphs('get', { id: 'n1', types: ['open-task'] }).ok).toBe(true);
  });

  it('refuses paragraphMaxChars on get, naming search as where it belongs', () => {
    const result = checkParagraphs('get', { id: 'n1', paragraphMaxChars: 200 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ERR_UNSUPPORTED_PARAM);
    expect(result.unsupported).toEqual(['paragraphMaxChars']);
    expect(result.error).toContain('search');
  });

  it('refuses the string task-content field on get, naming add/update as where it belongs', () => {
    const result = checkParagraphs('get', { id: 'n1', content: 'not a boolean flag' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unsupported).toEqual(['content']);
    expect(result.error).toContain('add');
    expect(result.error).toContain('update');
  });

  it('refuses includeContent/includeLines on search and search_global, which never implemented them', () => {
    const searchResult = checkParagraphs('search', { id: 'n1', query: 'x', includeContent: false });
    expect(searchResult.ok).toBe(false);

    const globalResult = checkParagraphs('search_global', { query: 'x', includeLines: false });
    expect(globalResult.ok).toBe(false);
  });

  it('accepts an ordinary search and search_global call', () => {
    expect(checkParagraphs('search', { id: 'n1', query: 'x', paragraphMaxChars: 200 }).ok).toBe(true);
    expect(checkParagraphs('search_global', { query: 'x', paragraphMaxChars: 200, folder: 'Notes' }).ok).toBe(true);
  });

  it('still accepts an ordinary add/complete/update call (mutating actions unaffected)', () => {
    expect(checkParagraphs('add', { target: 'today', content: 'a task' }).ok).toBe(true);
    expect(checkParagraphs('complete', { id: 'n1', lineIndex: 2 }).ok).toBe(true);
    expect(checkParagraphs('update', { id: 'n1', lineIndex: 2, content: 'x' }).ok).toBe(true);
  });
});
