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
| `feat/dryrun-for-line-edits` | `dryRun` implemented for `insert`/`append`/`edit_line`/`replace_lines`; branches from `fix/reject-inapplicable-params` | PR onto issue #8 |
| `payload-trims` | opt-in payload-shrink flags (`brief` on `get_notes`, `content`/`lines` on `paragraphs get`, `echo` on `edit_line`/`replace_lines`/`delete_lines`); every default unchanged | never — Kendoclaw-only, not an upstream bug fix |
| `kendoclaw` | integration branch: all of the above merged. **This is what we run.** | never |

Every topic branch starts from base commit `306f57d` and holds one
cherry-pickable, upstream-PR-ready commit per fix. They are merged **into**
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

On a new upstream version:

1. `git fetch upstream && git checkout main && git merge --ff-only upstream/main`
2. Rebase each topic branch onto the new `main`.
3. Rebuild `kendoclaw`: branch from the new `main`, merge each topic branch in.
4. `npx vitest run src` — green on every branch.
5. `npm run build:ts`, re-copy the two helpers from the new tarball.
6. **Drop a topic branch from the merge when its fix lands upstream.** Check the
   diff rather than the issue status; a maintainer may fix it differently.

## How this file stays true

**Repair-on-touch.** Whoever performs an upstream sync updates this file in the
same commit — branch table, base commit, cadence, whatever the sync proved
wrong. The same applies to anyone who adds, drops or renames a topic branch.

A doc with no update mechanism gets believed after it stops being correct, and
this one is read exactly when someone is about to change the branch structure it
describes. If you found something here wrong while using it, fix it now rather
than working around it.
