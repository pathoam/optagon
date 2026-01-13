import { describe, test, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import { join } from 'path';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { homedir, tmpdir } from 'os';

const CLI_PATH = join(import.meta.dir, '../../src/index.ts');
const TEST_WORKSPACE = join(tmpdir(), 'optagon-test-workspace');

/**
 * Run the CLI with given arguments
 */
async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

/**
 * Clean up any test frames
 */
async function cleanupTestFrames() {
  const { stdout } = await runCli(['frame', 'list']);
  const lines = stdout.split('\n');

  for (const line of lines) {
    // Match frame names that start with "cli-test-"
    const match = line.match(/^\s*(cli-test-\S+)/);
    if (match) {
      await runCli(['frame', 'destroy', match[1], '--force']);
    }
  }
}

describe('CLI Integration Tests', () => {
  beforeEach(async () => {
    // Create test workspace directory
    if (!existsSync(TEST_WORKSPACE)) {
      mkdirSync(TEST_WORKSPACE, { recursive: true });
    }
  });

  afterEach(async () => {
    // Clean up test frames
    await cleanupTestFrames();
  });

  afterAll(() => {
    // Clean up test workspace
    if (existsSync(TEST_WORKSPACE)) {
      rmSync(TEST_WORKSPACE, { recursive: true, force: true });
    }
  });

  describe('optagon --help', () => {
    test('shows help message', async () => {
      const { stdout, exitCode } = await runCli(['--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Personal software development server');
      expect(stdout).toContain('frame');
      expect(stdout).toContain('status');
    });
  });

  describe('optagon --version', () => {
    test('shows version', async () => {
      const { stdout, exitCode } = await runCli(['--version']);

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('optagon status', () => {
    test('shows system status', async () => {
      const { stdout, exitCode } = await runCli(['status']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Optagon Status');
      expect(stdout).toContain('Container runtime');
      expect(stdout).toContain('Total frames');
      expect(stdout).toContain('Available ports');
    });
  });

  describe('optagon frame create', () => {
    test('creates a frame with required arguments', async () => {
      const frameName = `cli-test-${Date.now()}`;
      const { stdout, exitCode } = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Frame created successfully');
      expect(stdout).toContain(frameName);
      expect(stdout).toContain('Status: created');
    });

    test('creates a frame with description', async () => {
      const frameName = `cli-test-${Date.now()}`;
      const { stdout, exitCode } = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
        '-d', 'Test description',
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Test description');
    });

    test('fails without workspace argument', async () => {
      const { stderr, exitCode } = await runCli([
        'frame', 'create', 'test-frame',
      ]);

      expect(exitCode).toBe(1);
      expect(stderr).toContain("required option '-w, --workspace <path>'");
    });

    test('fails with non-existent workspace', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'frame', 'create', 'test-frame',
        '-w', '/non/existent/path',
      ]);

      expect(exitCode).toBe(1);
      expect(stdout + stderr).toContain('does not exist');
    });

    test('fails on duplicate frame name', async () => {
      const frameName = `cli-test-${Date.now()}`;

      // Create first frame
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      // Try to create duplicate
      const { stdout, stderr, exitCode } = await runCli([
        'frame', 'create', frameName,
        '-w', TEST_WORKSPACE,
      ]);

      expect(exitCode).toBe(1);
      expect(stdout + stderr).toContain('already exists');
    });
  });

  describe('optagon frame list', () => {
    test('shows empty list when no frames', async () => {
      // Clean up first
      await cleanupTestFrames();

      const { stdout, exitCode } = await runCli(['frame', 'list']);

      // May or may not have frames, just check it runs
      expect(exitCode).toBe(0);
    });

    test('shows created frames', async () => {
      const frameName = `cli-test-${Date.now()}`;
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const { stdout, exitCode } = await runCli(['frame', 'list']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain(frameName);
    });

    test('list alias works', async () => {
      const { stdout, exitCode } = await runCli(['frame', 'ls']);

      expect(exitCode).toBe(0);
    });
  });

  describe('optagon frame show', () => {
    test('shows frame details', async () => {
      const frameName = `cli-test-${Date.now()}`;
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const { stdout, exitCode } = await runCli(['frame', 'show', frameName]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Frame Details');
      expect(stdout).toContain(frameName);
      expect(stdout).toContain('Attach command');
    });

    test('fails for non-existent frame', async () => {
      const { stderr, exitCode } = await runCli(['frame', 'show', 'non-existent-frame']);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('optagon frame destroy', () => {
    test('destroys a frame', async () => {
      const frameName = `cli-test-${Date.now()}`;
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const { stdout, exitCode } = await runCli(['frame', 'destroy', frameName]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('destroyed');

      // Verify it's gone
      const { stdout: listOut } = await runCli(['frame', 'list']);
      expect(listOut).not.toContain(frameName);
    });

    test('fails for non-existent frame', async () => {
      const { stderr, exitCode } = await runCli(['frame', 'destroy', 'non-existent']);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('optagon frame events', () => {
    test('shows frame events', async () => {
      const frameName = `cli-test-${Date.now()}`;
      await runCli(['frame', 'create', frameName, '-w', TEST_WORKSPACE]);

      const { stdout, exitCode } = await runCli(['frame', 'events', frameName]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('created');
    });
  });
});
