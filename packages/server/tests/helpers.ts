/**
 * Test Helpers
 *
 * Utilities for integration testing with real infrastructure.
 * No mocks - tests use real podman, real database, real containers.
 */

import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import type { FrameConfig } from '../src/types/index.js';

const CLI_PATH = join(import.meta.dir, '../src/index.ts');

// ============================================
// Preflight Check
// ============================================

export interface PreflightResult {
  runtime: 'podman' | 'docker' | null;
  hasImage: boolean;
  missing: string[];
  canRunIntegrationTests: boolean;
}

/**
 * Run preflight checks for integration tests.
 * Reports what's missing and whether tests can run.
 * Call this once in beforeAll() to get diagnostic output.
 */
export function runPreflightChecks(): PreflightResult {
  const missing: string[] = [];

  // Check container runtime
  const runtime = detectContainerRuntime();
  if (!runtime) {
    missing.push('Container runtime (podman or docker)');
  }

  // Check frame image (only if runtime available)
  const hasImage = runtime ? imageExists(runtime) : false;
  if (runtime && !hasImage) {
    missing.push(`Frame image (build with: ${runtime} build -t optagon/frame:latest -f Dockerfile.frame .)`);
  }

  const canRunIntegrationTests = runtime !== null && hasImage;

  return { runtime, hasImage, missing, canRunIntegrationTests };
}

/**
 * Log preflight results to console.
 * Use in beforeAll() to show what's available/missing.
 */
export function logPreflightResults(result: PreflightResult): void {
  if (result.canRunIntegrationTests) {
    console.log(`✓ Preflight passed: ${result.runtime} runtime, image available`);
  } else {
    console.log('⚠️  Integration tests will be skipped due to missing prerequisites:');
    for (const item of result.missing) {
      console.log(`   - ${item}`);
    }
  }
}

/**
 * Get skip reason for tests that require container infrastructure.
 * Returns null if tests can run, or a reason string if they should skip.
 */
export function getSkipReason(result: PreflightResult): string | null {
  if (result.canRunIntegrationTests) {
    return null;
  }
  return `Missing: ${result.missing.join(', ')}`;
}

// ============================================
// Container Runtime Helpers
// ============================================

/**
 * Detect available container runtime
 */
export function detectContainerRuntime(): 'podman' | 'docker' | null {
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

// Image name must match CLI build and container-runtime.ts
const FRAME_IMAGE = 'optagon/frame:latest';

/**
 * Check if optagon/frame image exists
 */
export function imageExists(runtime: 'podman' | 'docker'): boolean {
  try {
    execSync(`${runtime} image inspect ${FRAME_IMAGE}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get environment variables from a running container
 */
export function getContainerEnv(
  runtime: 'podman' | 'docker',
  containerName: string
): Record<string, string> {
  try {
    const output = execSync(`${runtime} exec ${containerName} env`, {
      encoding: 'utf-8',
    });
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
 * Get container port mappings
 */
export function getContainerPorts(
  runtime: 'podman' | 'docker',
  containerName: string
): string {
  try {
    return execSync(`${runtime} port ${containerName}`, { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

/**
 * List tmux windows in a container
 * Uses the frame's tmux socket at /run/optagon/tmux.sock
 */
export function getTmuxWindows(
  runtime: 'podman' | 'docker',
  containerName: string
): string[] {
  try {
    const output = execSync(
      `${runtime} exec ${containerName} tmux -S /run/optagon/tmux.sock list-windows -F "#{window_name}"`,
      { encoding: 'utf-8' }
    );
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Check if container is running
 */
export function isContainerRunning(
  runtime: 'podman' | 'docker',
  containerName: string
): boolean {
  try {
    const output = execSync(
      `${runtime} inspect -f '{{.State.Running}}' ${containerName}`,
      { encoding: 'utf-8' }
    );
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

// ============================================
// CLI Helpers
// ============================================

/**
 * Run the CLI with given arguments
 */
export async function runCli(
  args: string[],
  options: { timeout?: number; cwd?: string } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { timeout = 30000, cwd } = options;

  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      env: { ...process.env },
      cwd,
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

// ============================================
// Wait Utilities
// ============================================

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<boolean> {
  const { timeout = 10000, interval = 500, message = 'condition' } = options;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, interval));
  }

  console.warn(`Timeout waiting for ${message}`);
  return false;
}

/**
 * Wait for frame to reach a specific status
 */
export async function waitForFrameStatus(
  frameName: string,
  status: string,
  maxWaitMs = 30000
): Promise<boolean> {
  return waitFor(
    async () => {
      const { stdout } = await runCli(['frame', 'show', frameName]);
      return stdout.includes(`Status: ${status}`);
    },
    { timeout: maxWaitMs, message: `frame '${frameName}' to reach status '${status}'` }
  );
}

// ============================================
// Cleanup Utilities
// ============================================

/**
 * Clean up test frames by prefix
 */
export async function cleanupTestFrames(prefix: string): Promise<void> {
  const { stdout } = await runCli(['frame', 'list']);
  const lines = stdout.split('\n');

  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*(${prefix}\\S+)`));
    if (match) {
      await runCli(['frame', 'destroy', match[1], '--force'], { timeout: 30000 });
    }
  }
}

// ============================================
// Workspace Utilities
// ============================================

/**
 * Create a temporary workspace directory
 */
export function createTestWorkspace(name: string): string {
  const dir = join(tmpdir(), `optagon-test-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Remove a test workspace directory
 */
export function removeTestWorkspace(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================
// Test Data Factories
// ============================================

/**
 * Generate a unique test frame name
 */
export function generateTestFrameName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Create test frame config
 */
export function createTestConfig(overrides: Partial<FrameConfig> = {}): FrameConfig {
  return {
    manager: overrides.manager,
    ports: overrides.ports,
    behavior: overrides.behavior,
  };
}
