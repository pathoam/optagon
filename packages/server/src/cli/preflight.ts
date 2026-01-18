/**
 * Preflight Checks
 *
 * Validates that all prerequisites are available before running commands.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { isDatabaseReady } from '../services/state-store.js';

export interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

export interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  hint?: string;
}

/**
 * Run all preflight checks.
 */
export async function runPreflightChecks(): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  // 1. Container runtime (podman/docker)
  checks.push(checkContainerRuntime());

  // 2. Frame image
  const runtime = getContainerRuntime();
  if (runtime) {
    checks.push(checkFrameImage(runtime));
  }

  // 3. tmux on host
  checks.push(checkHostCommand('tmux', 'Required for terminal multiplexing'));

  // 4. script command on host
  checks.push(checkHostCommand('script', 'Required for terminal capture'));

  // 5. Database connectivity
  checks.push(await checkDatabase());

  const passed = checks.every(c => c.status !== 'fail');
  return { passed, checks };
}

function getContainerRuntime(): 'podman' | 'docker' | null {
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

function checkContainerRuntime(): PreflightCheck {
  const runtime = getContainerRuntime();
  if (runtime) {
    return {
      name: 'Container Runtime',
      status: 'pass',
      message: `${runtime} available`,
    };
  }
  return {
    name: 'Container Runtime',
    status: 'fail',
    message: 'Neither podman nor docker found',
    hint: 'Install podman: https://podman.io/getting-started/installation',
  };
}

function checkFrameImage(runtime: 'podman' | 'docker'): PreflightCheck {
  try {
    execSync(`${runtime} image inspect optagon/frame:latest`, { stdio: 'ignore' });
    return {
      name: 'Frame Image',
      status: 'pass',
      message: 'optagon/frame:latest exists',
    };
  } catch {
    return {
      name: 'Frame Image',
      status: 'fail',
      message: 'optagon/frame:latest not found',
      hint: 'Build with: optagon image build',
    };
  }
}

function checkHostCommand(cmd: string, description: string): PreflightCheck {
  const result = spawnSync('which', [cmd], { encoding: 'utf-8' });
  if (result.status === 0) {
    return {
      name: cmd,
      status: 'pass',
      message: `${cmd} available at ${result.stdout.trim()}`,
    };
  }
  return {
    name: cmd,
    status: 'fail',
    message: `${cmd} not found`,
    hint: `${description}. Install via your package manager.`,
  };
}

async function checkDatabase(): Promise<PreflightCheck> {
  try {
    const ready = await isDatabaseReady();
    if (ready) {
      return {
        name: 'Database',
        status: 'pass',
        message: 'PostgreSQL connected',
      };
    }
    return {
      name: 'Database',
      status: 'fail',
      message: 'PostgreSQL not responding',
      hint: 'Start with: optagon db start',
    };
  } catch (error) {
    return {
      name: 'Database',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Connection failed',
      hint: 'Start with: optagon db start',
    };
  }
}

/**
 * Print preflight results to console.
 */
export function printPreflightResults(result: PreflightResult): void {
  console.log(chalk.bold('Preflight Checks'));
  console.log();

  for (const check of result.checks) {
    const icon = check.status === 'pass' ? chalk.green('✓') :
                 check.status === 'warn' ? chalk.yellow('⚠') :
                 chalk.red('✗');
    const name = chalk.bold(check.name.padEnd(20));
    console.log(`  ${icon} ${name} ${check.message}`);
    if (check.hint && check.status !== 'pass') {
      console.log(`     ${chalk.dim(check.hint)}`);
    }
  }

  console.log();
  if (result.passed) {
    console.log(chalk.green('All checks passed.'));
  } else {
    console.log(chalk.red('Some checks failed. Fix issues above before proceeding.'));
  }
}
