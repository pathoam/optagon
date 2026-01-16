import { Database } from 'bun:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Frame, FrameStatus, FrameConfig, FrameEvent, FrameEventType } from '../types/index.js';

const OPTAGON_DIR = join(homedir(), '.optagon');
const DATA_DIR = join(OPTAGON_DIR, 'data');
const DB_PATH = join(DATA_DIR, 'optagon.db');

// SQL Schema
const SCHEMA = `
-- Core frame metadata
CREATE TABLE IF NOT EXISTS frames (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    workspace_path TEXT NOT NULL,
    container_id TEXT,
    tmux_socket TEXT,
    graphiti_group_id TEXT NOT NULL,
    host_port INTEGER,
    template_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_active_at INTEGER
);

-- Frame configuration (JSON blob)
CREATE TABLE IF NOT EXISTS frame_configs (
    frame_id TEXT PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
);

-- Frame lifecycle events (audit log)
CREATE TABLE IF NOT EXISTS frame_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_id TEXT REFERENCES frames(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    details_json TEXT,
    created_at INTEGER NOT NULL
);

-- Access tokens for remote/API access
CREATE TABLE IF NOT EXISTS access_tokens (
    id TEXT PRIMARY KEY,
    name TEXT,
    token_hash TEXT NOT NULL,
    permissions_json TEXT,
    last_used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
);

-- Active sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_id TEXT REFERENCES access_tokens(id) ON DELETE CASCADE,
    frame_id TEXT REFERENCES frames(id) ON DELETE SET NULL,
    client_info_json TEXT,
    connected_at INTEGER NOT NULL,
    last_activity_at INTEGER
);

-- System configuration (key-value)
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_frames_status ON frames(status);
CREATE INDEX IF NOT EXISTS idx_frames_name ON frames(name);
CREATE INDEX IF NOT EXISTS idx_frame_events_frame_id ON frame_events(frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_events_created_at ON frame_events(created_at);
`;

export class StateStore {
  private db: Database;

  constructor() {
    // Ensure directories exist
    if (!existsSync(OPTAGON_DIR)) {
      mkdirSync(OPTAGON_DIR, { recursive: true });
    }
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Initialize database
    this.db = new Database(DB_PATH);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    // Run schema
    this.db.exec(SCHEMA);
  }

  // Frame CRUD operations
  createFrame(frame: Frame, config?: FrameConfig): Frame {
    const now = Date.now();

    const insertFrame = this.db.prepare(`
      INSERT INTO frames (id, name, description, status, workspace_path, container_id, tmux_socket, graphiti_group_id, host_port, template_name, created_at, updated_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertConfig = this.db.prepare(`
      INSERT INTO frame_configs (frame_id, config_json, updated_at)
      VALUES (?, ?, ?)
    `);

    // Use transaction
    this.db.exec('BEGIN');
    try {
      insertFrame.run(
        frame.id,
        frame.name,
        frame.description ?? null,
        frame.status,
        frame.workspacePath,
        frame.containerId ?? null,
        frame.tmuxSocket ?? null,
        frame.graphitiGroupId,
        frame.hostPort ?? null,
        frame.templateName ?? null,
        now,
        now,
        frame.lastActiveAt?.getTime() ?? null
      );

      insertConfig.run(
        frame.id,
        JSON.stringify(config ?? {}),
        now
      );
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    return {
      ...frame,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getFrame(id: string): Frame | null {
    const row = this.db.prepare(`
      SELECT * FROM frames WHERE id = ?
    `).get(id) as any;

    return row ? this.rowToFrame(row) : null;
  }

  getFrameByName(name: string): Frame | null {
    const row = this.db.prepare(`
      SELECT * FROM frames WHERE name = ?
    `).get(name) as any;

    return row ? this.rowToFrame(row) : null;
  }

  listFrames(status?: FrameStatus): Frame[] {
    const query = status
      ? this.db.prepare('SELECT * FROM frames WHERE status = ? ORDER BY created_at DESC')
      : this.db.prepare('SELECT * FROM frames ORDER BY created_at DESC');

    const rows = status ? query.all(status) : query.all();
    return (rows as any[]).map(row => this.rowToFrame(row));
  }

  updateFrame(id: string, updates: Partial<Frame>): Frame | null {
    const frame = this.getFrame(id);
    if (!frame) return null;

    const now = Date.now();
    const setClauses: string[] = ['updated_at = ?'];
    const values: any[] = [now];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.containerId !== undefined) {
      setClauses.push('container_id = ?');
      values.push(updates.containerId);
    }
    if (updates.tmuxSocket !== undefined) {
      setClauses.push('tmux_socket = ?');
      values.push(updates.tmuxSocket);
    }
    if (updates.hostPort !== undefined) {
      setClauses.push('host_port = ?');
      values.push(updates.hostPort);
    }
    if (updates.lastActiveAt !== undefined) {
      setClauses.push('last_active_at = ?');
      values.push(updates.lastActiveAt?.getTime() ?? null);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.templateName !== undefined) {
      setClauses.push('template_name = ?');
      values.push(updates.templateName);
    }

    values.push(id);

    this.db.prepare(`
      UPDATE frames SET ${setClauses.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getFrame(id);
  }

  deleteFrame(id: string): boolean {
    const result = this.db.prepare('DELETE FROM frames WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // Frame config operations
  getFrameConfig(frameId: string): FrameConfig | null {
    const row = this.db.prepare(`
      SELECT config_json FROM frame_configs WHERE frame_id = ?
    `).get(frameId) as any;

    return row ? JSON.parse(row.config_json) : null;
  }

  updateFrameConfig(frameId: string, config: FrameConfig): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO frame_configs (frame_id, config_json, updated_at)
      VALUES (?, ?, ?)
    `).run(frameId, JSON.stringify(config), now);
  }

  // Frame events
  addFrameEvent(frameId: string, eventType: FrameEventType, details?: Record<string, unknown>): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO frame_events (frame_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(frameId, eventType, details ? JSON.stringify(details) : null, now);
  }

  getFrameEvents(frameId: string, limit = 50): FrameEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM frame_events WHERE frame_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(frameId, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      frameId: row.frame_id,
      eventType: row.event_type as FrameEventType,
      details: row.details_json ? JSON.parse(row.details_json) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  // Port allocation
  getUsedPorts(): number[] {
    const rows = this.db.prepare(`
      SELECT host_port FROM frames WHERE host_port IS NOT NULL
    `).all() as any[];

    return rows.map(row => row.host_port);
  }

  // System config
  getSystemConfig<T>(key: string): T | null {
    const row = this.db.prepare(`
      SELECT value_json FROM system_config WHERE key = ?
    `).get(key) as any;

    return row ? JSON.parse(row.value_json) : null;
  }

  setSystemConfig<T>(key: string, value: T): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO system_config (key, value_json, updated_at)
      VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), now);
  }

  // Helper to convert DB row to Frame
  private rowToFrame(row: any): Frame {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status as FrameStatus,
      workspacePath: row.workspace_path,
      containerId: row.container_id ?? undefined,
      tmuxSocket: row.tmux_socket ?? undefined,
      graphitiGroupId: row.graphiti_group_id,
      hostPort: row.host_port ?? undefined,
      templateName: row.template_name ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let stateStore: StateStore | null = null;

export function getStateStore(): StateStore {
  if (!stateStore) {
    stateStore = new StateStore();
  }
  return stateStore;
}
