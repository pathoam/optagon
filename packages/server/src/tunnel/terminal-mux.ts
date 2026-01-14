/**
 * Terminal Multiplexer
 *
 * Handles creating PTY sessions for remote terminal access.
 * Each terminal channel is a separate PTY connected to a frame's tmux.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventEmitter } from 'node:events';

const FRAMES_DIR = join(homedir(), '.optagon', 'frames');

export interface TerminalSession {
  channelId: string;
  frameId: string;
  cols: number;
  rows: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
}

export interface TerminalMuxEvents {
  data: (channelId: string, data: Buffer) => void;
  exit: (channelId: string, code: number | null) => void;
  error: (channelId: string, error: Error) => void;
}

export class TerminalMux extends EventEmitter {
  private sessions = new Map<string, {
    process: ReturnType<typeof spawn>;
    frameId: string;
    cols: number;
    rows: number;
  }>();

  /**
   * Open a terminal session for a frame
   */
  async openTerminal(
    channelId: string,
    frameId: string,
    cols = 80,
    rows = 24
  ): Promise<TerminalSession> {
    // Build tmux socket path
    const tmuxSocket = join(FRAMES_DIR, frameId, 'tmux.sock');

    // Spawn tmux attach with PTY
    // Using script command to force PTY allocation
    const proc = spawn('script', [
      '-q', // Quiet
      '-c', `tmux -S ${tmuxSocket} attach-session -t main`,
      '/dev/null', // Typescript file (not needed, sent to /dev/null)
    ], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: String(cols),
        LINES: String(rows),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Store session
    this.sessions.set(channelId, {
      process: proc,
      frameId,
      cols,
      rows,
    });

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      this.emit('data', channelId, data);
    });

    // Handle stderr (tmux might output here too)
    proc.stderr?.on('data', (data: Buffer) => {
      this.emit('data', channelId, data);
    });

    // Handle exit
    proc.on('exit', (code) => {
      this.sessions.delete(channelId);
      this.emit('exit', channelId, code);
    });

    // Handle errors
    proc.on('error', (error) => {
      this.sessions.delete(channelId);
      this.emit('error', channelId, error);
    });

    // Return session interface
    return {
      channelId,
      frameId,
      cols,
      rows,
      write: (data: string) => this.writeToTerminal(channelId, data),
      resize: (cols: number, rows: number) => this.resizeTerminal(channelId, cols, rows),
      close: () => this.closeTerminal(channelId),
    };
  }

  /**
   * Write data to a terminal
   */
  writeToTerminal(channelId: string, data: string): boolean {
    const session = this.sessions.get(channelId);
    if (!session) return false;

    try {
      session.process.stdin?.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resize a terminal
   */
  resizeTerminal(channelId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(channelId);
    if (!session) return false;

    session.cols = cols;
    session.rows = rows;

    // Send SIGWINCH to the process group to trigger resize
    // For tmux, we also need to send the resize command
    try {
      // Use tmux resize-window command
      const tmuxSocket = join(FRAMES_DIR, session.frameId, 'tmux.sock');
      spawn('tmux', [
        '-S', tmuxSocket,
        'resize-window',
        '-x', String(cols),
        '-y', String(rows),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close a terminal session
   */
  closeTerminal(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (!session) return;

    try {
      // Send detach command to tmux
      session.process.stdin?.write('\x02d'); // Ctrl+b, d (tmux detach)

      // Give it a moment then kill if still running
      setTimeout(() => {
        if (this.sessions.has(channelId)) {
          session.process.kill('SIGTERM');
        }
      }, 500);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Close all terminal sessions
   */
  closeAll(): void {
    for (const channelId of this.sessions.keys()) {
      this.closeTerminal(channelId);
    }
  }

  /**
   * Get active session count
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Check if a session exists
   */
  hasSession(channelId: string): boolean {
    return this.sessions.has(channelId);
  }
}

// Singleton instance
let terminalMux: TerminalMux | null = null;

export function getTerminalMux(): TerminalMux {
  if (!terminalMux) {
    terminalMux = new TerminalMux();
  }
  return terminalMux;
}
