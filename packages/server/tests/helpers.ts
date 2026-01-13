import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Create a temporary test database
 */
export function createTestDatabase(): { db: Database; cleanup: () => void } {
  const testDir = join(tmpdir(), `optagon-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });

  const dbPath = join(testDir, 'test.db');
  const db = new Database(dbPath);

  // Initialize schema
  db.exec(`
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS frame_configs (
      frame_id TEXT PRIMARY KEY REFERENCES frames(id) ON DELETE CASCADE,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS frame_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      frame_id TEXT REFERENCES frames(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_frames_status ON frames(status);
    CREATE INDEX IF NOT EXISTS idx_frames_name ON frames(name);
  `);

  const cleanup = () => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  };

  return { db, cleanup };
}

/**
 * Generate a test frame object
 */
export function createTestFrame(overrides: Partial<{
  id: string;
  name: string;
  workspacePath: string;
  status: string;
  hostPort: number;
}> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? `test-frame-${Date.now()}`,
    workspacePath: overrides.workspacePath ?? '/tmp/test-workspace',
    status: overrides.status ?? 'created',
    graphitiGroupId: `frame:${overrides.id ?? crypto.randomUUID()}`,
    hostPort: overrides.hostPort ?? 33000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}
