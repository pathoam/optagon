/**
 * Frame Initializer Service
 *
 * Applies templates to frames after they start:
 * - Creates tmux windows
 * - Runs commands in each window
 * - Waits for readiness and injects startup text
 *
 * Uses the mounted tmux socket to run commands from the host.
 */

import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exists } from 'fs/promises';
import type { Frame } from '../types';
import type { ResolvedTemplate, WindowConfig, FrameInitStatus, WindowState } from '../types/template';
import { getTemplateLoader } from './template-loader';

const FRAMES_DIR = join(homedir(), '.optagon', 'frames');

// Default readiness detection settings
const DEFAULT_READY_TIMEOUT = 30000; // 30 seconds
const READINESS_CHECK_INTERVAL = 500; // Check every 500ms
const IDLE_THRESHOLD = 2000; // Consider ready after 2s of no output

class FrameInitializer {
  /**
   * Initialize a frame with a template
   */
  async initializeFrame(frame: Frame, templateName: string): Promise<FrameInitStatus> {
    const status: FrameInitStatus = {
      frameId: frame.id,
      templateName,
      windows: [],
      initialized: false,
      errors: [],
    };

    // Load and resolve template
    const loader = getTemplateLoader();
    const template = await loader.getResolvedTemplate(templateName);

    if (!template) {
      status.errors.push(`Template "${templateName}" not found`);
      return status;
    }

    // Check tmux socket exists
    const tmuxSocket = this.getTmuxSocket(frame.id);
    if (!(await exists(tmuxSocket))) {
      status.errors.push(`Tmux socket not found: ${tmuxSocket}`);
      return status;
    }

    // Wait for tmux to be ready (session created)
    const tmuxReady = await this.waitForTmux(tmuxSocket, 10000);
    if (!tmuxReady) {
      status.errors.push('Tmux session not ready after 10s');
      return status;
    }

    console.log(`[frame-init] Initializing frame ${frame.name} with template ${templateName}`);

    // Apply template windows
    for (let i = 0; i < template.windows.length; i++) {
      const windowConfig = template.windows[i];
      const windowState: WindowState = {
        name: windowConfig.name,
        index: i,
        ready: false,
      };

      try {
        if (i === 0) {
          // Rename window 0 (already exists from start-frame.sh)
          await this.tmux(tmuxSocket, ['rename-window', '-t', '0', windowConfig.name]);
        } else {
          // Create new window
          await this.tmux(tmuxSocket, [
            'new-window',
            '-t', `main:${i}`,
            '-n', windowConfig.name,
          ]);
        }

        // Set working directory if specified
        if (windowConfig.cwd) {
          const fullPath = windowConfig.cwd.startsWith('/')
            ? windowConfig.cwd
            : `/workspace/${windowConfig.cwd}`;
          await this.sendKeys(tmuxSocket, windowConfig.name, `cd ${fullPath}`);
          await this.sendKeys(tmuxSocket, windowConfig.name, '', true); // Press Enter
        }

        // Set environment variables
        if (windowConfig.env) {
          for (const [key, value] of Object.entries(windowConfig.env)) {
            await this.sendKeys(tmuxSocket, windowConfig.name, `export ${key}="${value}"`);
            await this.sendKeys(tmuxSocket, windowConfig.name, '', true);
          }
        }

        // Run the command
        if (windowConfig.command && windowConfig.command !== 'zsh') {
          await this.sendKeys(tmuxSocket, windowConfig.name, windowConfig.command);
          await this.sendKeys(tmuxSocket, windowConfig.name, '', true);
        }

        // Wait for readiness if we need to inject
        if (windowConfig.inject && windowConfig.inject.length > 0) {
          const waitForReady = windowConfig.waitForReady !== false;
          const timeout = windowConfig.readyTimeout ?? DEFAULT_READY_TIMEOUT;

          if (waitForReady) {
            const ready = await this.waitForWindowReady(
              tmuxSocket,
              windowConfig.name,
              timeout
            );
            if (!ready) {
              status.errors.push(`Window "${windowConfig.name}" not ready after ${timeout}ms`);
            }
          } else {
            // Just wait a short fixed delay
            await this.delay(1000);
          }

          // Inject startup text
          for (const line of windowConfig.inject) {
            await this.sendKeys(tmuxSocket, windowConfig.name, line);
            await this.sendKeys(tmuxSocket, windowConfig.name, '', true);
            await this.delay(100); // Small delay between injections
          }
        }

        windowState.ready = true;
        console.log(`[frame-init] Window "${windowConfig.name}" initialized`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        status.errors.push(`Failed to initialize window "${windowConfig.name}": ${msg}`);
        console.error(`[frame-init] Error initializing window "${windowConfig.name}":`, error);
      }

      status.windows.push(windowState);
    }

    // Select first window
    await this.tmux(tmuxSocket, ['select-window', '-t', 'main:0']);

    status.initialized = status.errors.length === 0;
    console.log(`[frame-init] Frame ${frame.name} initialization ${status.initialized ? 'complete' : 'completed with errors'}`);

    return status;
  }

  /**
   * Get tmux socket path for a frame
   */
  getTmuxSocket(frameId: string): string {
    return join(FRAMES_DIR, frameId, 'tmux.sock');
  }

  /**
   * Run a tmux command
   */
  private async tmux(socket: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', ['-S', socket, ...args]);
      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`tmux exited with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Send keys to a tmux window
   */
  private async sendKeys(socket: string, windowName: string, text: string, enter = false): Promise<void> {
    const args = ['send-keys', '-t', `main:${windowName}`];

    if (text) {
      args.push(text);
    }

    if (enter) {
      args.push('Enter');
    }

    await this.tmux(socket, args);
  }

  /**
   * Wait for tmux session to be ready
   */
  private async waitForTmux(socket: string, timeout: number): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const result = spawnSync('tmux', ['-S', socket, 'has-session', '-t', 'main'], {
          timeout: 1000,
        });
        if (result.status === 0) {
          return true;
        }
      } catch {
        // Ignore errors, keep trying
      }
      await this.delay(200);
    }

    return false;
  }

  /**
   * Wait for a window to be ready (idle/waiting for input)
   *
   * Current implementation: wait for window output to stabilize.
   * Future: parse prompt patterns, detect TUI ready states.
   */
  private async waitForWindowReady(
    socket: string,
    windowName: string,
    timeout: number
  ): Promise<boolean> {
    const start = Date.now();
    let lastContent = '';
    let lastChangeTime = Date.now();

    while (Date.now() - start < timeout) {
      try {
        // Capture pane content
        const content = await this.tmux(socket, [
          'capture-pane',
          '-t', `main:${windowName}`,
          '-p', // Print to stdout
        ]);

        if (content !== lastContent) {
          lastContent = content;
          lastChangeTime = Date.now();
        } else if (Date.now() - lastChangeTime >= IDLE_THRESHOLD) {
          // Content has been stable for IDLE_THRESHOLD ms
          return true;
        }
      } catch {
        // Ignore errors during readiness check
      }

      await this.delay(READINESS_CHECK_INTERVAL);
    }

    // Timeout reached - consider ready anyway (best effort)
    return true;
  }

  /**
   * Get current window list for a frame
   */
  async getWindowList(frameId: string): Promise<WindowState[]> {
    const socket = this.getTmuxSocket(frameId);

    try {
      const output = await this.tmux(socket, [
        'list-windows',
        '-t', 'main',
        '-F', '#{window_index}:#{window_name}:#{window_active}',
      ]);

      return output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [index, name, active] = line.split(':');
          return {
            name,
            index: parseInt(index, 10),
            ready: true, // Assume ready if listed
            // active: active === '1' would be useful but not in WindowState
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Send text to a specific window (for external use)
   */
  async sendToWindow(frameId: string, windowName: string, text: string, pressEnter = false): Promise<boolean> {
    const socket = this.getTmuxSocket(frameId);

    try {
      await this.sendKeys(socket, windowName, text, pressEnter);
      return true;
    } catch (error) {
      console.error(`[frame-init] Failed to send to window "${windowName}":`, error);
      return false;
    }
  }

  /**
   * Select a window (make it active)
   */
  async selectWindow(frameId: string, windowName: string): Promise<boolean> {
    const socket = this.getTmuxSocket(frameId);

    try {
      await this.tmux(socket, ['select-window', '-t', `main:${windowName}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Capture content from a window
   */
  async captureWindow(frameId: string, windowName: string, lines = 100): Promise<string | null> {
    const socket = this.getTmuxSocket(frameId);

    try {
      const content = await this.tmux(socket, [
        'capture-pane',
        '-t', `main:${windowName}`,
        '-p',
        '-S', `-${lines}`, // Start from N lines back
      ]);
      return content;
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton
let instance: FrameInitializer | null = null;

export function getFrameInitializer(): FrameInitializer {
  if (!instance) {
    instance = new FrameInitializer();
  }
  return instance;
}

export { FrameInitializer };
