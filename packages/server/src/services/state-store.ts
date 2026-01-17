import postgres from 'postgres';
import { getConfigManager } from './config-manager.js';
import type { Frame, FrameStatus, FrameConfig, FrameEvent, FrameEventType } from '../types/index.js';

// Valid frame status values
const VALID_STATUSES = ['created', 'starting', 'running', 'stopping', 'stopped', 'error'] as const;

// SQL Schema for PostgreSQL
const SCHEMA = `
-- Core frame metadata
CREATE TABLE IF NOT EXISTS frames (
    id UUID PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    workspace_path TEXT NOT NULL,
    container_id TEXT,
    tmux_socket TEXT,
    graphiti_group_id TEXT NOT NULL,
    host_port INTEGER,
    template_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ
);

-- Frame configuration (JSONB for queryable JSON)
CREATE TABLE IF NOT EXISTS frame_configs (
    frame_id UUID PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
    config JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Frame lifecycle events (audit log)
CREATE TABLE IF NOT EXISTS frame_events (
    id SERIAL PRIMARY KEY,
    frame_id UUID REFERENCES frames(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Access tokens for remote/API access
CREATE TABLE IF NOT EXISTS access_tokens (
    id UUID PRIMARY KEY,
    name TEXT,
    token_hash TEXT NOT NULL,
    permissions JSONB,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    token_id UUID REFERENCES access_tokens(id) ON DELETE CASCADE,
    frame_id UUID REFERENCES frames(id) ON DELETE SET NULL,
    client_info JSONB,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ
);

-- System configuration (key-value)
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_frames_status ON frames(status);
CREATE INDEX IF NOT EXISTS idx_frames_name ON frames(name);
CREATE INDEX IF NOT EXISTS idx_frame_events_frame_id ON frame_events(frame_id);
CREATE INDEX IF NOT EXISTS idx_frame_events_created_at ON frame_events(created_at);
`;

// Additional constraints added after table creation (for migration compatibility)
const CONSTRAINTS = `
-- Unique constraint on host_port (partial index for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_frames_host_port_unique
ON frames(host_port) WHERE host_port IS NOT NULL;

-- Unique constraint on graphiti_group_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_frames_graphiti_group_id_unique
ON frames(graphiti_group_id);

-- Check constraint on status (valid values only)
DO $$ BEGIN
    ALTER TABLE frames ADD CONSTRAINT chk_frames_status
    CHECK (status IN ('created', 'starting', 'running', 'stopping', 'stopped', 'error'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
`;

export class StateStore {
  private sql: postgres.Sql;
  private initialized: boolean = false;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress IF NOT EXISTS notices
    });
  }

  /**
   * Initialize database schema
   * Must be called before using the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create tables
    await this.sql.unsafe(SCHEMA);

    // Apply constraints (idempotent - safe to run multiple times)
    await this.sql.unsafe(CONSTRAINTS);

    this.initialized = true;
  }

  /**
   * Check if database is connected and ready
   */
  async isReady(): Promise<boolean> {
    try {
      await this.sql`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // Frame CRUD operations
  async createFrame(frame: Frame, config?: FrameConfig): Promise<Frame> {
    const now = new Date();

    const [insertedFrame] = await this.sql`
      INSERT INTO frames (
        id, name, description, status, workspace_path, container_id,
        tmux_socket, graphiti_group_id, host_port, template_name,
        created_at, updated_at, last_active_at
      )
      VALUES (
        ${frame.id}, ${frame.name}, ${frame.description ?? null}, ${frame.status},
        ${frame.workspacePath}, ${frame.containerId ?? null}, ${frame.tmuxSocket ?? null},
        ${frame.graphitiGroupId}, ${frame.hostPort ?? null}, ${frame.templateName ?? null},
        ${now}, ${now}, ${frame.lastActiveAt ?? null}
      )
      RETURNING *
    `;

    await this.sql`
      INSERT INTO frame_configs (frame_id, config, updated_at)
      VALUES (${frame.id}, ${this.sql.json(config ?? {})}, ${now})
    `;

    return this.rowToFrame(insertedFrame);
  }

  async getFrame(id: string): Promise<Frame | null> {
    const [row] = await this.sql`
      SELECT * FROM frames WHERE id = ${id}
    `;

    return row ? this.rowToFrame(row) : null;
  }

  async getFrameByName(name: string): Promise<Frame | null> {
    const [row] = await this.sql`
      SELECT * FROM frames WHERE name = ${name}
    `;

    return row ? this.rowToFrame(row) : null;
  }

  async listFrames(status?: FrameStatus): Promise<Frame[]> {
    const rows = status
      ? await this.sql`SELECT * FROM frames WHERE status = ${status} ORDER BY created_at DESC`
      : await this.sql`SELECT * FROM frames ORDER BY created_at DESC`;

    return rows.map(row => this.rowToFrame(row));
  }

  async updateFrame(id: string, updates: Partial<Frame>): Promise<Frame | null> {
    const frame = await this.getFrame(id);
    if (!frame) return null;

    const now = new Date();
    const setClauses: string[] = [];
    const values: Record<string, any> = { id, updated_at: now };

    if (updates.status !== undefined) values.status = updates.status;
    if (updates.containerId !== undefined) values.container_id = updates.containerId;
    if (updates.tmuxSocket !== undefined) values.tmux_socket = updates.tmuxSocket;
    if (updates.hostPort !== undefined) values.host_port = updates.hostPort;
    if (updates.lastActiveAt !== undefined) values.last_active_at = updates.lastActiveAt;
    if (updates.description !== undefined) values.description = updates.description;
    if (updates.templateName !== undefined) values.template_name = updates.templateName;

    // Build dynamic update query
    const [updatedRow] = await this.sql`
      UPDATE frames SET
        updated_at = ${now},
        status = COALESCE(${updates.status ?? null}, status),
        container_id = COALESCE(${updates.containerId ?? null}, container_id),
        tmux_socket = COALESCE(${updates.tmuxSocket ?? null}, tmux_socket),
        host_port = COALESCE(${updates.hostPort ?? null}, host_port),
        last_active_at = COALESCE(${updates.lastActiveAt ?? null}, last_active_at),
        description = COALESCE(${updates.description ?? null}, description),
        template_name = COALESCE(${updates.templateName ?? null}, template_name)
      WHERE id = ${id}
      RETURNING *
    `;

    return updatedRow ? this.rowToFrame(updatedRow) : null;
  }

  async deleteFrame(id: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM frames WHERE id = ${id}
    `;
    return result.count > 0;
  }

  // Frame config operations
  async getFrameConfig(frameId: string): Promise<FrameConfig | null> {
    const [row] = await this.sql`
      SELECT config FROM frame_configs WHERE frame_id = ${frameId}
    `;

    return row ? (row.config as FrameConfig) : null;
  }

  async updateFrameConfig(frameId: string, config: FrameConfig): Promise<void> {
    const now = new Date();
    await this.sql`
      INSERT INTO frame_configs (frame_id, config, updated_at)
      VALUES (${frameId}, ${this.sql.json(config)}, ${now})
      ON CONFLICT (frame_id) DO UPDATE SET
        config = ${this.sql.json(config)},
        updated_at = ${now}
    `;
  }

  // Frame events
  async addFrameEvent(frameId: string, eventType: FrameEventType, details?: Record<string, unknown>): Promise<void> {
    await this.sql`
      INSERT INTO frame_events (frame_id, event_type, details)
      VALUES (${frameId}, ${eventType}, ${details ? this.sql.json(details) : null})
    `;
  }

  async getFrameEvents(frameId: string, limit = 50): Promise<FrameEvent[]> {
    const rows = await this.sql`
      SELECT * FROM frame_events
      WHERE frame_id = ${frameId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map(row => ({
      id: row.id,
      frameId: row.frame_id,
      eventType: row.event_type as FrameEventType,
      details: row.details ?? undefined,
      createdAt: row.created_at,
    }));
  }

  // Port allocation
  async getUsedPorts(): Promise<number[]> {
    const rows = await this.sql`
      SELECT host_port FROM frames WHERE host_port IS NOT NULL
    `;

    return rows.map(row => row.host_port as number);
  }

  // System config
  async getSystemConfig<T>(key: string): Promise<T | null> {
    const [row] = await this.sql`
      SELECT value FROM system_config WHERE key = ${key}
    `;

    return row ? (row.value as T) : null;
  }

  async setSystemConfig<T>(key: string, value: T): Promise<void> {
    const now = new Date();
    await this.sql`
      INSERT INTO system_config (key, value, updated_at)
      VALUES (${key}, ${this.sql.json(value)}, ${now})
      ON CONFLICT (key) DO UPDATE SET
        value = ${this.sql.json(value)},
        updated_at = ${now}
    `;
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
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActiveAt: row.last_active_at ?? undefined,
    };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

// Singleton instance
let stateStore: StateStore | null = null;
let initPromise: Promise<void> | null = null;

export function getStateStore(): StateStore {
  if (!stateStore) {
    const configManager = getConfigManager();
    const dbUrl = configManager.getDatabaseUrl();
    stateStore = new StateStore(dbUrl);
  }
  return stateStore;
}

/**
 * Initialize the state store (must be called at startup)
 */
export async function initializeStateStore(): Promise<void> {
  if (!initPromise) {
    const store = getStateStore();
    initPromise = store.initialize();
  }
  return initPromise;
}

/**
 * Check if database is ready
 */
export async function isDatabaseReady(): Promise<boolean> {
  try {
    const store = getStateStore();
    return await store.isReady();
  } catch {
    return false;
  }
}

/**
 * Close the state store connection pool
 * Call this before process exit to allow clean shutdown
 */
export async function closeStateStore(): Promise<void> {
  if (stateStore) {
    await stateStore.close();
    stateStore = null;
    initPromise = null;
  }
}

/**
 * Set the state store instance (for testing only)
 * @internal
 */
export function _setStateStore(store: StateStore | null): void {
  stateStore = store;
  initPromise = store ? Promise.resolve() : null;
}
