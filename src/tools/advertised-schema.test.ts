// The MCP tool inputSchemas in server.ts are HAND-MAINTAINED, separately from
// the zod schemas the handlers validate against. A flag implemented in zod but
// never declared on the tool is unreachable for any client that honors the
// advertised schema — it happened to paragraphs get's includeContent/
// includeLines (fixed 316800d) and, until 2026-09-26, to get_notes `brief`
// (klaw deficiency 2026-09-24-noteplan-mcp-opt-in-flag-usage-never-counted:
// 4 of 74 eligible calls in four weeks used a trim, two of them probes).
// This reads server.ts as text so it cannot drift from what is shipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getNoteSchema, getParagraphsSchema } from './notes.js';

const serverSrc = readFileSync(fileURLToPath(new URL('../server.ts', import.meta.url)), 'utf8');

// Property names declared directly under the named tool's inputSchema.properties.
function advertisedProperties(tool: string): Set<string> {
  const start = serverSrc.indexOf(`name: '${tool}'`);
  expect(start, `tool ${tool} not found in server.ts`).toBeGreaterThan(-1);
  const next = serverSrc.indexOf("name: 'noteplan_", start + 1);
  const block = serverSrc.slice(start, next === -1 ? undefined : next);
  const propsAt = block.indexOf('properties: {');
  expect(propsAt).toBeGreaterThan(-1);
  const body = block.slice(propsAt);
  const indent = /\n(\s+)\w+: \{/.exec(body)?.[1] ?? '';
  const keys = new Set<string>();
  for (const m of body.matchAll(new RegExp(`\\n${indent}(\\w+): \\{`, 'g'))) keys.add(m[1]);
  return keys;
}

// The zod object's keys, through any .refine()/.superRefine() wrapper.
function zodKeys(schema: unknown): string[] {
  let s = schema as { shape?: Record<string, unknown>; _def?: { schema?: unknown } };
  while (s && !s.shape && s._def?.schema) s = s._def.schema as typeof s;
  expect(s?.shape, 'not a zod object').toBeTruthy();
  return Object.keys(s.shape as Record<string, unknown>);
}

describe('advertised tool schemas reach the payload-trim flags', () => {
  it('noteplan_get_notes declares brief (and every other single-note getNoteSchema key)', () => {
    const adv = advertisedProperties('noteplan_get_notes');
    expect(adv.has('brief')).toBe(true);
    const missing = zodKeys(getNoteSchema).filter((k) => !adv.has(k));
    expect(missing).toEqual([]);
  });

  it('noteplan_paragraphs declares includeContent/includeLines/types', () => {
    const adv = advertisedProperties('noteplan_paragraphs');
    for (const k of ['includeContent', 'includeLines', 'types']) expect(adv.has(k), k).toBe(true);
    const missing = zodKeys(getParagraphsSchema).filter((k) => !adv.has(k));
    expect(missing).toEqual([]);
  });
});
