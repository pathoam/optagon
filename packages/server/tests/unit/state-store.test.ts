import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createTestDatabase, createTestFrame } from '../helpers';

// We'll create a minimal StateStore for testing to avoid filesystem side effects
class TestStateStore {
  constructor(private db: Database) {}

  createFrame(frame: any, config?: any) {
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO frames (id, name, description, status, workspace_path, container_id, tmux_socket, graphiti_group_id, host_port, created_at, updated_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      frame.id,
      frame.name,
      frame.description ?? null,
      frame.status,
      frame.workspacePath,
      frame.containerId ?? null,
      frame.tmuxSocket ?? null,
      frame.graphitiGroupId,
      frame.hostPort ?? null,
      now,
      now,
      null
    );

    this.db.prepare(`
      INSERT INTO frame_configs (frame_id, config_json, updated_at)
      VALUES (?, ?, ?)
    `).run(frame.id, JSON.stringify(config ?? {}), now);

    return { ...frame, createdAt: new Date(now), updatedAt: new Date(now) };
  }

  getFrame(id: string) {
    const row = this.db.prepare('SELECT * FROM frames WHERE id = ?').get(id) as any;
    return row ? this.rowToFrame(row) : null;
  }

  getFrameByName(name: string) {
    const row = this.db.prepare('SELECT * FROM frames WHERE name = ?').get(name) as any;
    return row ? this.rowToFrame(row) : null;
  }

  listFrames(status?: string) {
    const query = status
      ? this.db.prepare('SELECT * FROM frames WHERE status = ? ORDER BY created_at DESC')
      : this.db.prepare('SELECT * FROM frames ORDER BY created_at DESC');
    const rows = status ? query.all(status) : query.all();
    return (rows as any[]).map(row => this.rowToFrame(row));
  }

  updateFrame(id: string, updates: any) {
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
    if (updates.hostPort !== undefined) {
      setClauses.push('host_port = ?');
      values.push(updates.hostPort);
    }

    values.push(id);
    this.db.prepare(`UPDATE frames SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getFrame(id);
  }

  deleteFrame(id: string) {
    const result = this.db.prepare('DELETE FROM frames WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getUsedPorts() {
    const rows = this.db.prepare('SELECT host_port FROM frames WHERE host_port IS NOT NULL').all() as any[];
    return rows.map(row => row.host_port);
  }

  addFrameEvent(frameId: string, eventType: string, details?: any) {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO frame_events (frame_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(frameId, eventType, details ? JSON.stringify(details) : null, now);
  }

  getFrameEvents(frameId: string, limit = 50) {
    return this.db.prepare(`
      SELECT * FROM frame_events WHERE frame_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(frameId, limit) as any[];
  }

  private rowToFrame(row: any) {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status,
      workspacePath: row.workspace_path,
      containerId: row.container_id ?? undefined,
      tmuxSocket: row.tmux_socket ?? undefined,
      graphitiGroupId: row.graphiti_group_id,
      hostPort: row.host_port ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : undefined,
    };
  }
}

describe('StateStore', () => {
  let db: Database;
  let store: TestStateStore;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    store = new TestStateStore(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('createFrame', () => {
    test('creates a frame with all required fields', () => {
      const frame = createTestFrame({ name: 'my-frame' });
      const result = store.createFrame(frame);

      expect(result.id).toBe(frame.id);
      expect(result.name).toBe('my-frame');
      expect(result.status).toBe('created');
      expect(result.workspacePath).toBe(frame.workspacePath);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test('throws on duplicate name', () => {
      const frame1 = createTestFrame({ name: 'duplicate-name' });
      const frame2 = createTestFrame({ name: 'duplicate-name' });

      store.createFrame(frame1);
      expect(() => store.createFrame(frame2)).toThrow();
    });
  });

  describe('getFrame', () => {
    test('retrieves a frame by ID', () => {
      const frame = createTestFrame();
      store.createFrame(frame);

      const result = store.getFrame(frame.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(frame.id);
    });

    test('returns null for non-existent ID', () => {
      const result = store.getFrame('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getFrameByName', () => {
    test('retrieves a frame by name', () => {
      const frame = createTestFrame({ name: 'named-frame' });
      store.createFrame(frame);

      const result = store.getFrameByName('named-frame');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('named-frame');
    });

    test('returns null for non-existent name', () => {
      const result = store.getFrameByName('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listFrames', () => {
    test('lists all frames', () => {
      store.createFrame(createTestFrame({ name: 'frame-1' }));
      store.createFrame(createTestFrame({ name: 'frame-2' }));
      store.createFrame(createTestFrame({ name: 'frame-3' }));

      const result = store.listFrames();
      expect(result.length).toBe(3);
    });

    test('filters by status', () => {
      store.createFrame(createTestFrame({ name: 'frame-1', status: 'running' }));
      store.createFrame(createTestFrame({ name: 'frame-2', status: 'stopped' }));
      store.createFrame(createTestFrame({ name: 'frame-3', status: 'running' }));

      const running = store.listFrames('running');
      expect(running.length).toBe(2);

      const stopped = store.listFrames('stopped');
      expect(stopped.length).toBe(1);
    });

    test('returns empty array when no frames', () => {
      const result = store.listFrames();
      expect(result).toEqual([]);
    });
  });

  describe('updateFrame', () => {
    test('updates frame status', () => {
      const frame = createTestFrame();
      store.createFrame(frame);

      const result = store.updateFrame(frame.id, { status: 'running' });
      expect(result!.status).toBe('running');
    });

    test('updates container ID', () => {
      const frame = createTestFrame();
      store.createFrame(frame);

      const result = store.updateFrame(frame.id, { containerId: 'abc123' });
      expect(result!.containerId).toBe('abc123');
    });

    test('returns null for non-existent frame', () => {
      const result = store.updateFrame('non-existent', { status: 'running' });
      expect(result).toBeNull();
    });
  });

  describe('deleteFrame', () => {
    test('deletes an existing frame', () => {
      const frame = createTestFrame();
      store.createFrame(frame);

      const result = store.deleteFrame(frame.id);
      expect(result).toBe(true);

      const deleted = store.getFrame(frame.id);
      expect(deleted).toBeNull();
    });

    test('returns false for non-existent frame', () => {
      const result = store.deleteFrame('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getUsedPorts', () => {
    test('returns list of used ports', () => {
      store.createFrame(createTestFrame({ name: 'frame-1', hostPort: 33000 }));
      store.createFrame(createTestFrame({ name: 'frame-2', hostPort: 33001 }));
      store.createFrame(createTestFrame({ name: 'frame-3', hostPort: 33002 }));

      const ports = store.getUsedPorts();
      expect(ports).toContain(33000);
      expect(ports).toContain(33001);
      expect(ports).toContain(33002);
      expect(ports.length).toBe(3);
    });
  });

  describe('frame events', () => {
    test('adds and retrieves frame events', () => {
      const frame = createTestFrame();
      store.createFrame(frame);

      store.addFrameEvent(frame.id, 'started', { port: 33000 });
      store.addFrameEvent(frame.id, 'stopped');

      const events = store.getFrameEvents(frame.id);
      expect(events.length).toBe(2);
      expect(events[0].event_type).toBe('stopped'); // Most recent first
      expect(events[1].event_type).toBe('started');
    });
  });
});
