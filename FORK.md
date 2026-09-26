# Kendoclaw fork of `NotePlan/noteplan-mcp`

This fork exists so Kendoclaw runs a NotePlan MCP server with fixes that have
not landed upstream. It is a true GitHub fork of `NotePlan/noteplan-mcp` (MIT),
so attribution is automatic and every fix is one click from becoming a PR.

**We run the `kendoclaw` branch.** Everything else is upstream-facing.

## Branches

| Branch | What it is | Upstream target |
|---|---|---|
| `main` | tracks `NotePlan/noteplan-mcp` `main`; never committed to | — |
| `fix/space-writer-stale-snapshot` | space writer reloads the SQLite snapshot before reporting a note missing (+ the `closeDatabase` reopen bug it depends on) | PR onto issue #9 |
| `fix/insert-preserves-block-structure` | `insert` stops flattening multi-line blocks into one paragraph type; then a second commit stopping `insertContent` mutating the caller's `params` | new issue, then PR |
| `fix/reject-inapplicable-params` | run the per-action zod schemas: a parameter the action does not implement is refused, not silently dropped | PR onto issue #8 |
| `feat/dryrun-for-line-edits` | `dryRun` implemented for `insert`/`append`/`edit_line`/`replace_lines`; branches from `fix/reject-inapplicable-params`. **Upstream 1.1.30 (`857b0b3`) fixed issue #8 differently**: `edit_line` previews without a token, `replace_lines` REQUIRES a token, `insert`/`append` ignore `dryRun`. The fork keeps its own contract (one-call writes, token optional, `dryRun` honoured everywhere); `src/tools/edit-dryrun.test.ts` marks the three upstream assertions rewritten to it with `fork:` | PR onto issue #8 — now a behaviour proposal against 1.1.30, not a bug fix |
| `payload-trims` | opt-in payload-shrink flags (`brief` on `get_notes`, `includeContent`/`includeLines` on `paragraphs get` — named `content`/`lines` until 316800d, `echo` on `edit_line`/`replace_lines`/`delete_lines`); every default unchanged except `echo`, `false` since 697b6c9. The hand-maintained tool inputSchemas in `src/server.ts` must declare every flag or a schema-honouring client cannot send it: `brief` and `format` on `get_notes` were undeclared until 2026-09-26, and `src/tools/advertised-schema.test.ts` now fails on the next zod key a tool forgets to advertise | never — Kendoclaw-only, not an upstream bug fix |
| `kendoclaw` | integration branch: all of the above merged. **This is what we run.** | never |

Every topic branch starts from base commit `306f57d` (upstream 1.1.29) and holds one
cherry-pickable, upstream-PR-ready commit per fix. They were NOT rebased onto 1.1.30 at
the 2026-09-26 sync (only `kendoclaw` is pushed from a sync lane); rebase one when it is
actually turned into a PR. They are merged **into**
`kendoclaw`; `kendoclaw` is never rebased onto them. That keeps each PR's
commits stable while upstream moves, which is the whole reason for the split.

## Building

Do **not** run `npm run build`. It also compiles and codesigns two Swift helper
binaries, which needs the Swift toolchain, a Developer ID certificate, and the
notarization chain.

```bash
npm ci
npm run build:ts     # tsc only → dist/
```

The two helpers are copied from the published npm tarball instead, where they
arrive **Apple-notarized** rather than the ad-hoc signing a local build would
produce:

```bash
NPX_CACHE=~/.npm/_npx/227f510d64397af0/node_modules/@noteplanco/noteplan-mcp
cp "$NPX_CACHE/scripts/calendar-helper"  scripts/
cp "$NPX_CACHE/scripts/reminders-helper" scripts/
```

`scripts/calendar-helper`, `scripts/reminders-helper` and `dist/` are all
gitignored. They stay untracked — that is correct, not an oversight. Rebuild
`dist/` after every pull.

`npm test` runs vitest. Note that `tsc` compiles the test files into `dist/`
too, so after a build `npm test` counts every test twice. Measure with
`npx vitest run src`.

**LuLu:** the helpers at this path are new binaries to LuLu, whose rules are
path-keyed. Their first network call hangs silently until Ken clicks Allow.
Bless them while interactive, never during an unattended run.

## Upstream tracking

```bash
git remote add upstream https://github.com/NotePlan/noteplan-mcp.git
```

Upstream cuts **no GitHub releases or tags**. The only version signals are the
npm `latest` dist-tag for `@noteplanco/noteplan-mcp` and `main`'s HEAD sha.

**Cadence: check npm `latest` on the weekly rhythm.** Upstream shipped 1.1.23 →
1.1.29 over roughly three months, so weekly is generous and monthly would do.

**Sync log** (newest first):

- 2026-09-26 — 1.1.29 → **1.1.30** (`857b0b3`, issue #8 dryRun). Merged into
  `kendoclaw`; conflicts in `src/server.ts`/`src/tools/notes.ts` resolved to the fork's
  dryRun contract, upstream's `replacedLinesPreview` adopted. vitest 1001/1001.
- 2026-09-13 — last sync on 1.1.29 (`f2f3b08`).

On a new upstream version:

1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main`
2. Rebase a topic branch onto the new `main` only when it is about to become a PR.
3. **Merge** the new upstream into `kendoclaw` (`git merge --no-ff upstream/main`) on a
   lane branch, resolve, and fast-forward `kendoclaw` to it. Do NOT rebuild `kendoclaw`
   from `main` + topic branches: the payload-trims commits and every later fix
   (`8bb7d4a` … `a43b41f`) live directly on `kendoclaw` and on no topic branch, so a
   rebuild silently drops them — and it needs a force-push under any sibling lane that
   branched from `kendoclaw`. (The pre-2026-09-26 recipe said "rebuild"; it was wrong.)
4. `npx vitest run src` — green. Upstream tests that encode a contract the fork
   deliberately changed are rewritten to the fork's contract and prefixed `fork:`.
5. `npm run build:ts`; re-copy the two helpers from the new tarball only if the upstream
   diff touches them (`git diff <old>..upstream/main --stat -- swift scripts`).
6. Deploy: fast-forward the main checkout (`kendoclaw`, which the MCP config runs as
   `dist/index.js`) and `npm run build:ts` there; the server picks it up on its next start.
7. **Drop a topic branch from the merge when its fix lands upstream.** Check the
   diff rather than the issue status; a maintainer may fix it differently.

## How this file stays true

**Repair-on-touch.** Whoever performs an upstream sync updates this file in the
same commit — branch table, base commit, cadence, whatever the sync proved
wrong. The same applies to anyone who adds, drops or renames a topic branch.

A doc with no update mechanism gets believed after it stops being correct, and
this one is read exactly when someone is about to change the branch structure it
describes. If you found something here wrong while using it, fix it now rather
than working around it.
