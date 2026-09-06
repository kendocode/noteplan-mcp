// Tests for the AppleScript-detection cost fix (P2 2026-09-05: under launchd,
// version detection spent 1-4 minutes because every osascript call could only
// block to its own timeout, and getDetectedAppName() then repeated the whole
// pass). Covers both halves of the fix:
//   1. NOTEPLAN_MCP_SKIP_APPLESCRIPT=1 skips AppleScript probing entirely.
//   2. getDetectedAppName() does not retry AppleScript once plist detection
//      has already produced a version — but still retries when detection
//      hasn't resolved a version at all (the first-run permission case the
//      retry exists for).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.fn();
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const existsSyncMock = vi.fn();
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => existsSyncMock(...args),
  readFileSync: vi.fn(() => '{}'),
}));

function osascriptCallCount(): number {
  return execFileSyncMock.mock.calls.filter(([cmd]) => cmd === 'osascript').length;
}

/** All four "is running" probes report false, and mdfind/plist paths are
 *  never found — detectViaAppleScript AND detectViaPlist both fail. */
function mockAllDetectionFails() {
  existsSyncMock.mockReturnValue(false);
  execFileSyncMock.mockImplementation((cmd: string, args: string[] = []) => {
    if (cmd === 'osascript' && args[1]?.includes('is running')) return 'false\n';
    if (cmd === 'mdfind') return '';
    throw new Error(`unexpected execFileSync call in this test: ${cmd} ${args.join(' ')}`);
  });
}

/** All four "is running" probes report false (no AppleScript app name ever
 *  gets cached), but the first known plist path resolves a real version. */
function mockPlistSucceedsAppleScriptDoesNot() {
  existsSyncMock.mockReturnValue(true);
  execFileSyncMock.mockImplementation((cmd: string, args: string[] = []) => {
    if (cmd === 'osascript' && args[1]?.includes('is running')) return 'false\n';
    if (cmd === 'defaults' && args.includes('CFBundleShortVersionString')) return '3.15.0\n';
    if (cmd === 'defaults' && args.includes('CFBundleVersion')) return '1500\n';
    throw new Error(`unexpected execFileSync call in this test: ${cmd} ${args.join(' ')}`);
  });
}

describe('AppleScript detection cost fix', () => {
  const ORIGINAL_SKIP_ENV = process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT;

  beforeEach(() => {
    vi.resetModules();
    execFileSyncMock.mockReset();
    existsSyncMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_SKIP_ENV === undefined) delete process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT;
    else process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT = ORIGINAL_SKIP_ENV;
  });

  describe('NOTEPLAN_MCP_SKIP_APPLESCRIPT', () => {
    it('spawns zero osascript calls and still resolves a version via plist', async () => {
      process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT = '1';
      mockPlistSucceedsAppleScriptDoesNot();

      const { getNotePlanVersion } = await import('./version.js');
      const version = getNotePlanVersion(true);

      expect(version).toEqual({ version: '3.15.0', build: 1500, source: 'plist' });
      expect(osascriptCallCount()).toBe(0);
    });

    it('without the flag, the same scenario does spawn osascript probes (baseline)', async () => {
      delete process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT;
      mockPlistSucceedsAppleScriptDoesNot();

      const { getNotePlanVersion } = await import('./version.js');
      getNotePlanVersion(true);

      expect(osascriptCallCount()).toBeGreaterThan(0);
    });

    it('getDetectedAppName() also skips AppleScript when the flag is set', async () => {
      process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT = '1';
      mockAllDetectionFails();

      const { getDetectedAppName } = await import('./version.js');
      const name = getDetectedAppName();

      expect(name).toBe('NotePlan');
      expect(osascriptCallCount()).toBe(0);
    });
  });

  describe('getDetectedAppName retry suppression', () => {
    it('does not retry AppleScript once plist detection already produced a version', async () => {
      delete process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT;
      mockPlistSucceedsAppleScriptDoesNot();

      const { getNotePlanVersion, getDetectedAppName } = await import('./version.js');
      getNotePlanVersion(true); // AppleScript fails for all 4 names, plist succeeds
      const callsAfterFirstPass = osascriptCallCount();
      expect(callsAfterFirstPass).toBeGreaterThan(0); // sanity: AppleScript really was probed once

      const name = getDetectedAppName();

      expect(name).toBe('NotePlan'); // no app name was ever cached
      expect(osascriptCallCount()).toBe(callsAfterFirstPass); // no second pass
    });

    it('still retries AppleScript when detection never resolved a version at all', async () => {
      delete process.env.NOTEPLAN_MCP_SKIP_APPLESCRIPT;
      mockAllDetectionFails();

      const { getNotePlanVersion, getDetectedAppName } = await import('./version.js');
      const version = getNotePlanVersion(true); // both AppleScript and plist fail
      expect(version.source).toBe('unknown');
      const callsAfterFirstPass = osascriptCallCount();
      expect(callsAfterFirstPass).toBeGreaterThan(0);

      getDetectedAppName();

      expect(osascriptCallCount()).toBeGreaterThan(callsAfterFirstPass); // retry did fire
    });
  });
});
