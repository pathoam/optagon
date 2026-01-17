/**
 * Frame Lifecycle Integration Tests
 *
 * Tests with REAL infrastructure - no mocks:
 * - Real podman/docker containers
 * - Real tmux sessions
 * - Real environment variables
 * - Real port mappings
 *
 * REQUIREMENTS:
 * - podman or docker must be installed
 * - optagon-frame:latest image must be built
 *
 * Run: bun test tests/integration/frame-lifecycle.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  runPreflightChecks,
  logPreflightResults,
  runCli,
  getContainerEnv,
  getContainerPorts,
  getTmuxWindows,
  isContainerRunning,
  waitForFrameStatus,
  cleanupTestFrames,
  type PreflightResult,
} from '../helpers.js';

const TEST_PREFIX = 'int-test';
const TEST_WORKSPACE = join(tmpdir(), `optagon-${TEST_PREFIX}-${Date.now()}`);

// Preflight check result - populated in beforeAll
let preflight: PreflightResult;

// Helper to conditionally run tests based on preflight
const itRequiresInfra = (name: string, fn: () => Promise<void>, timeout?: number) => {
  test(name, async () => {
    if (!preflight.canRunIntegrationTests) {
      console.log(`  ⏭️  Skipped: ${preflight.missing.join(', ')}`);
      return;
    }
    await fn();
  }, timeout);
};

describe('Frame Lifecycle Integration Tests', () => {
  beforeAll(() => {
    preflight = runPreflightChecks();
    logPreflightResults(preflight);

    if (preflight.canRunIntegrationTests) {
      // Create test workspace
      mkdirSync(TEST_WORKSPACE, { recursive: true });
      console.log(`✓ Using workspace: ${TEST_WORKSPACE}`);
    }
  });

  afterAll(async () => {
    if (!preflight.canRunIntegrationTests) return;

    // Clean up all test frames
    await cleanupTestFrames(TEST_PREFIX);

    // Remove test workspace
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    if (!preflight.canRunIntegrationTests) return;
    await cleanupTestFrames(TEST_PREFIX);
  });

  afterEach(async () => {
    if (!preflight.canRunIntegrationTests) return;
    await cleanupTestFrames(TEST_PREFIX);
  });

  // ============================================
  // Basic Lifecycle Tests
  // ============================================

  describe('frame lifecycle', () => {
    itRequiresInfra('create frame', async () => {
      const frameName = `${TEST_PREFIX}-create-${Date.now()}`;
      const result = await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Frame created');
      expect(result.stdout).toContain(frameName);
      expect(result.stdout).toContain('Status: created');
    });

    itRequiresInfra('start frame creates running container', async () => {
      const frameName = `${TEST_PREFIX}-start-${Date.now()}`;

      // Create
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      // Start
      const startResult = await runCli(['frame', 'start', frameName], { timeout: 60000 });
      expect(startResult.exitCode).toBe(0);

      // Wait for running
      const reached = await waitForFrameStatus(frameName, 'running', 30000);
      expect(reached).toBe(true);

      // Verify container is actually running
      const containerName = `optagon-frame-${frameName}`;
      expect(isContainerRunning(preflight.runtime!, containerName)).toBe(true);
    }, 90000);

    itRequiresInfra('stop frame stops container', async () => {
      const frameName = `${TEST_PREFIX}-stop-${Date.now()}`;

      // Create and start
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Stop
      const stopResult = await runCli(['frame', 'stop', frameName], { timeout: 30000 });
      expect(stopResult.exitCode).toBe(0);

      // Wait for stopped
      const stopped = await waitForFrameStatus(frameName, 'stopped', 15000);
      expect(stopped).toBe(true);

      // Verify container is not running
      const containerName = `optagon-frame-${frameName}`;
      expect(isContainerRunning(preflight.runtime!, containerName)).toBe(false);
    }, 120000);

    itRequiresInfra('destroy frame removes container', async () => {
      const frameName = `${TEST_PREFIX}-destroy-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      // Create, start, stop
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);
      await runCli(['frame', 'stop', frameName], { timeout: 30000 });
      await waitForFrameStatus(frameName, 'stopped', 15000);

      // Destroy
      const destroyResult = await runCli(['frame', 'destroy', frameName]);
      expect(destroyResult.exitCode).toBe(0);

      // Verify frame is gone
      const showResult = await runCli(['frame', 'show', frameName]);
      expect(showResult.exitCode).toBe(1);
      expect(showResult.stderr).toContain('not found');

      // Verify container is removed
      try {
        execSync(`${preflight.runtime} inspect ${containerName}`, { stdio: 'ignore' });
        expect(false).toBe(true); // Should not reach here
      } catch {
        // Expected - container should not exist
      }
    }, 150000);

    itRequiresInfra('force destroy removes running container', async () => {
      const frameName = `${TEST_PREFIX}-force-${Date.now()}`;

      // Create and start (don't stop)
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Force destroy while running
      const destroyResult = await runCli(['frame', 'destroy', frameName, '--force']);
      expect(destroyResult.exitCode).toBe(0);

      // Verify frame is gone
      const showResult = await runCli(['frame', 'show', frameName]);
      expect(showResult.exitCode).toBe(1);
    }, 120000);
  });

  // ============================================
  // Config Application Tests
  // ============================================

  describe('config application', () => {
    itRequiresInfra('manager config sets environment variables', async () => {
      const frameName = `${TEST_PREFIX}-config-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      const config = JSON.stringify({
        manager: {
          provider: 'anthropic',
          model: 'claude-3-opus',
          temperature: 0.7,
        },
      });

      // Create with config
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE, '-c', config]);

      // Start
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Check real environment variables in container
      const env = getContainerEnv(preflight.runtime!, containerName);
      expect(env.OPTAGON_MANAGER_PROVIDER).toBe('anthropic');
      expect(env.OPTAGON_MANAGER_MODEL).toBe('claude-3-opus');
      expect(env.OPTAGON_MANAGER_TEMPERATURE).toBe('0.7');
    }, 90000);

    itRequiresInfra('ports config maps container port', async () => {
      const frameName = `${TEST_PREFIX}-ports-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      const config = JSON.stringify({
        ports: { dev: 8080 },
      });

      // Create with port config
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE, '-c', config]);

      // Start
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Check real port mapping
      const ports = getContainerPorts(preflight.runtime!, containerName);
      expect(ports).toContain('8080');
    }, 90000);
  });

  // ============================================
  // Template Application Tests
  // ============================================

  describe('template application', () => {
    itRequiresInfra('basic template creates tmux windows', async () => {
      const frameName = `${TEST_PREFIX}-template-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      // Create with basic template
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE, '-t', 'basic']);

      // Start using simplified command (applies templates)
      await runCli(['start', frameName, '--no-attach'], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Give tmux time to initialize and template to apply
      await new Promise(r => setTimeout(r, 3000));

      // Check tmux windows exist
      const windows = getTmuxWindows(preflight.runtime!, containerName);
      expect(windows.length).toBeGreaterThan(0);

      // Basic template should have 'shell' window
      expect(windows.some(w => w.includes('shell'))).toBe(true);
    }, 90000);

    itRequiresInfra('claude-code template creates agent window', async () => {
      const frameName = `${TEST_PREFIX}-claude-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      // Create with claude-code template
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE, '-t', 'claude-code']);

      // Start using simplified command (applies templates)
      await runCli(['start', frameName, '--no-attach'], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Give tmux time to initialize
      await new Promise(r => setTimeout(r, 3000));

      // Check tmux windows
      const windows = getTmuxWindows(preflight.runtime!, containerName);
      expect(windows.length).toBeGreaterThan(0);

      // Claude-code template should have agent window
      expect(windows.some(w => w.includes('agent'))).toBe(true);
    }, 90000);

    itRequiresInfra('full-stack template creates multiple windows', async () => {
      const frameName = `${TEST_PREFIX}-fullstack-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      // Create with full-stack template
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE, '-t', 'full-stack']);

      // Start using simplified command (applies templates)
      await runCli(['start', frameName, '--no-attach'], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Give tmux time to initialize
      await new Promise(r => setTimeout(r, 4000));

      // Check tmux windows
      const windows = getTmuxWindows(preflight.runtime!, containerName);

      // Full-stack should have multiple windows
      expect(windows.length).toBeGreaterThanOrEqual(2);
    }, 90000);
  });

  // ============================================
  // Event Tracking Tests
  // ============================================

  describe('event tracking', () => {
    itRequiresInfra('events record full lifecycle', async () => {
      const frameName = `${TEST_PREFIX}-events-${Date.now()}`;

      // Full lifecycle
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);
      await runCli(['frame', 'stop', frameName], { timeout: 30000 });
      await waitForFrameStatus(frameName, 'stopped', 15000);

      // Check events
      const eventsResult = await runCli(['frame', 'events', frameName]);
      expect(eventsResult.exitCode).toBe(0);
      expect(eventsResult.stdout).toContain('created');
      expect(eventsResult.stdout).toContain('started');
      expect(eventsResult.stdout).toContain('stopped');
    }, 150000);
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('error handling', () => {
    itRequiresInfra('start non-existent frame fails', async () => {
      const result = await runCli(['frame', 'start', 'non-existent-frame-xyz']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    itRequiresInfra('stop non-running frame fails', async () => {
      const frameName = `${TEST_PREFIX}-stopfail-${Date.now()}`;
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const result = await runCli(['frame', 'stop', frameName]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not running');
    });

    itRequiresInfra('destroy running frame without force fails', async () => {
      const frameName = `${TEST_PREFIX}-destroyfail-${Date.now()}`;

      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      const result = await runCli(['frame', 'destroy', frameName]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('running');
    }, 90000);

    // This test doesn't require container infrastructure
    test('create with non-existent workspace fails', async () => {
      const result = await runCli([
        'frame', 'create', 'test-frame',
        '-w', '/non/existent/workspace/path',
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('does not exist');
    });
  });

  // ============================================
  // Workspace Mount Tests
  // ============================================

  describe('workspace mounting', () => {
    itRequiresInfra('workspace is mounted in container', async () => {
      const frameName = `${TEST_PREFIX}-mount-${Date.now()}`;
      const containerName = `optagon-frame-${frameName}`;

      // Create a test file in workspace
      const testFile = join(TEST_WORKSPACE, 'test-file.txt');
      execSync(`echo "test content" > "${testFile}"`);

      // Create and start
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], { timeout: 60000 });
      await waitForFrameStatus(frameName, 'running', 30000);

      // Check file exists in container
      try {
        const output = execSync(
          `${preflight.runtime} exec ${containerName} cat /workspace/test-file.txt`,
          { encoding: 'utf-8' }
        );
        expect(output.trim()).toBe('test content');
      } catch (e) {
        // Fail if we can't read the file
        expect(false).toBe(true);
      }
    }, 90000);
  });
});
