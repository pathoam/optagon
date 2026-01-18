/**
 * CLI Logger
 *
 * Provides consistent logging with prefixes and colors.
 * Centralizes exit handling to ensure proper cleanup.
 */

import chalk from 'chalk';
import { closeStateStore } from '../services/state-store.js';

// Log levels
export const log = {
  /** Info message (default) */
  info: (msg: string) => console.log(msg),

  /** Success message (green) */
  success: (msg: string) => console.log(chalk.green(msg)),

  /** Warning message (yellow) */
  warn: (msg: string) => console.log(chalk.yellow(msg)),

  /** Error message (red) */
  error: (msg: string) => console.error(chalk.red(msg)),

  /** Dimmed/muted text */
  dim: (msg: string) => console.log(chalk.dim(msg)),

  /** Highlighted text (cyan) */
  highlight: (msg: string) => console.log(chalk.cyan(msg)),

  /** Bold text */
  bold: (msg: string) => console.log(chalk.bold(msg)),

  /** Blank line */
  blank: () => console.log(),
};

/**
 * Exit the process with proper cleanup.
 * Always use this instead of process.exit() to ensure DB pool is closed.
 */
export async function exit(code: number): Promise<never> {
  try {
    await closeStateStore();
  } catch {
    // Ignore cleanup errors on exit
  }
  process.exit(code);
}

/**
 * Exit with error message.
 */
export async function exitWithError(message: string, details?: string): Promise<never> {
  log.error(message);
  if (details) {
    // Use stderr for error details so tests can find them
    console.error(chalk.dim(`  ${details}`));
  }
  return exit(1);
}

/**
 * Command wrapper that handles errors and cleanup.
 * Use this for all command actions.
 */
export function withCleanup(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
      await exit(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await exitWithError('Error:', message);
    }
  };
}
