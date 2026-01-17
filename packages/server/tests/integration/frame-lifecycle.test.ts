/**
 * Frame Lifecycle Integration Tests
 *
 * Tests the complete frame lifecycle:
 * - Create → Start → Stop → Destroy
 * - Config application to containers
 * - Template application
 *
 * NOTE: These tests require a container runtime (podman or docker) to be available.
 * Tests are skipped if no runtime is detected.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const CLI_PATH = join(import.meta.dir, '../../src/index.ts');
const TEST_WORKSPACE = join(tmpdir(), 'optagon-lifecycle-test');

let containerRuntime: 'podman' | 'docker' | null = null;

/**
 * Detect available container runtime
 */
function detectContainerRuntime(): 'podman' | 'docker' | null {
  try {
    execSync('podman --version', { stdio: 'ignore' });
    return 'podman';
  } catch {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      return 'docker';
    } catch {
      return null;
    }
  }
}

/**
 * Run the CLI with given arguments
 */
async function runCli(args: string[], timeout = 30000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr, exitCode: -1 });
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

/**
 * Check if optagon image exists
 */
async function imageExists(): Promise<boolean> {
  if (!containerRuntime) return false;
  try {
    execSync(`${containerRuntime} image inspect optagon-frame:latest`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get container environment variables
 */
async function getContainerEnv(containerName: string): Promise<Record<string, string>> {
  if (!containerRuntime) return {};
  try {
    const output = execSync(`${containerRuntime} exec ${containerName} env`, { encoding: 'utf-8' });
    const env: Record<string, string> = {};
    for (const line of output.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.substring(0, idx)] = line.substring(idx + 1);
      }
    }
    return env;
  } catch {
    return {};
  }
}

/**
 * Clean up any test frames
 */
async function cleanupTestFrames() {
  const { stdout } = await runCli(['frame', 'list']);
  const lines = stdout.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*(lifecycle-test-\S+)/);
    if (match) {
      await runCli(['frame', 'destroy', match[1], '--force']);
    }
  }
}

/**
 * Wait for frame to reach a status
 */
async function waitForStatus(frameName: string, status: string, maxWaitMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { stdout } = await runCli(['frame', 'show', frameName]);
    if (stdout.includes(`Status: ${status}`)) {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

describe('Frame Lifecycle Integration Tests', () => {
  beforeAll(() => {
    containerRuntime = detectContainerRuntime();
    if (!containerRuntime) {
      console.log('⚠️  No container runtime detected, skipping lifecycle tests');
    }

    // Create test workspace
    if (!existsSync(TEST_WORKSPACE)) {
      mkdirSync(TEST_WORKSPACE, { recursive: true });
    }
  });

  afterAll(async () => {
    await cleanupTestFrames();
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clean up before each test
    await cleanupTestFrames();
  });

  afterEach(async () => {
    // Clean up after each test
    await cleanupTestFrames();
  });

  describe('frame start/stop lifecycle', () => {
    test.skipIf(!containerRuntime)('starts a created frame', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // Create
      const createResult = await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      expect(createResult.exitCode).toBe(0);

      // Start
      const startResult = await runCli(['frame', 'start', frameName], 60000);
      expect(startResult.exitCode).toBe(0);
      expect(startResult.stdout).toContain('started');

      // Verify running
      const reached = await waitForStatus(frameName, 'running');
      expect(reached).toBe(true);

      // Stop
      const stopResult = await runCli(['frame', 'stop', frameName], 30000);
      expect(stopResult.exitCode).toBe(0);

      // Verify stopped
      const stopped = await waitForStatus(frameName, 'stopped');
      expect(stopped).toBe(true);
    }, 120000);

    test.skipIf(!containerRuntime)('start fails for non-existent frame', async () => {
      const result = await runCli(['frame', 'start', 'non-existent-frame']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found');
    });

    test.skipIf(!containerRuntime)('stop fails for non-running frame', async () => {
      const frameName = `lifecycle-test-${Date.now()}`;

      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const result = await runCli(['frame', 'stop', frameName]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not running');
    });
  });

  describe('config application', () => {
    test.skipIf(!containerRuntime)('applies manager config as environment variables', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // Create with config
      const config = JSON.stringify({
        manager: {
          provider: 'anthropic',
          model: 'claude-3-opus',
        },
      });

      const createResult = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
        '--config', config,
      ]);
      expect(createResult.exitCode).toBe(0);

      // Start
      const startResult = await runCli(['frame', 'start', frameName], 60000);
      expect(startResult.exitCode).toBe(0);

      // Wait for running
      const reached = await waitForStatus(frameName, 'running');
      expect(reached).toBe(true);

      // Check environment variables in container
      const env = await getContainerEnv(`optagon-frame-${frameName}`);
      expect(env.OPTAGON_MANAGER_PROVIDER).toBe('anthropic');
      expect(env.OPTAGON_MANAGER_MODEL).toBe('claude-3-opus');
    }, 120000);

    test.skipIf(!containerRuntime)('applies ports config to container mapping', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // Create with custom port config
      const config = JSON.stringify({
        ports: { dev: 8080 },
      });

      const createResult = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
        '--config', config,
      ]);
      expect(createResult.exitCode).toBe(0);

      // Start
      const startResult = await runCli(['frame', 'start', frameName], 60000);
      expect(startResult.exitCode).toBe(0);

      // Verify port mapping by inspecting container
      if (containerRuntime) {
        const portOutput = execSync(
          `${containerRuntime} port optagon-frame-${frameName}`,
          { encoding: 'utf-8' }
        );
        // Should have port 8080 mapped (dev port)
        expect(portOutput).toContain('8080');
      }
    }, 120000);
  });

  describe('template application', () => {
    test.skipIf(!containerRuntime)('creates frame with template', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // Create with basic template
      const createResult = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
        '-t', 'basic',
      ]);
      expect(createResult.exitCode).toBe(0);

      // Show frame should indicate template
      const showResult = await runCli(['frame', 'show', frameName]);
      expect(showResult.stdout).toContain('basic');
    });
  });

  describe('full lifecycle', () => {
    test.skipIf(!containerRuntime)('create → start → stop → destroy', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // 1. Create
      const createResult = await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      expect(createResult.exitCode).toBe(0);
      expect(createResult.stdout).toContain('created');

      // Verify created status
      let showResult = await runCli(['frame', 'show', frameName]);
      expect(showResult.stdout).toContain('Status: created');

      // 2. Start
      const startResult = await runCli(['frame', 'start', frameName], 60000);
      expect(startResult.exitCode).toBe(0);

      // Verify running status
      const reachedRunning = await waitForStatus(frameName, 'running');
      expect(reachedRunning).toBe(true);

      // 3. Stop
      const stopResult = await runCli(['frame', 'stop', frameName], 30000);
      expect(stopResult.exitCode).toBe(0);

      // Verify stopped status
      const reachedStopped = await waitForStatus(frameName, 'stopped');
      expect(reachedStopped).toBe(true);

      // 4. Destroy
      const destroyResult = await runCli(['frame', 'destroy', frameName]);
      expect(destroyResult.exitCode).toBe(0);

      // Verify frame no longer exists
      const finalShow = await runCli(['frame', 'show', frameName]);
      expect(finalShow.exitCode).toBe(1);
      expect(finalShow.stderr).toContain('not found');
    }, 180000);

    test.skipIf(!containerRuntime)('events show full lifecycle history', async () => {
      const hasImage = await imageExists();
      if (!hasImage) {
        console.log('⚠️  optagon-frame:latest image not found, skipping test');
        return;
      }

      const frameName = `lifecycle-test-${Date.now()}`;

      // Create, start, stop
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);
      await runCli(['frame', 'start', frameName], 60000);
      await waitForStatus(frameName, 'running');
      await runCli(['frame', 'stop', frameName], 30000);
      await waitForStatus(frameName, 'stopped');

      // Check events
      const eventsResult = await runCli(['frame', 'events', frameName]);
      expect(eventsResult.exitCode).toBe(0);
      expect(eventsResult.stdout).toContain('created');
      expect(eventsResult.stdout).toContain('started');
      expect(eventsResult.stdout).toContain('stopped');
    }, 180000);
  });
});
