import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createTestDatabase, createTestFrame } from '../helpers';
import { PORT_RANGE_START, PORT_RANGE_END } from '../../src/types/index';

// Minimal PortAllocator for testing
class TestPortAllocator {
  constructor(private db: Database) {}

  allocate(): number {
    const usedPorts = new Set(this.getUsedPorts());

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
  }

  isAvailable(port: number): boolean {
    if (port < PORT_RANGE_START || port > PORT_RANGE_END) {
      return false;
    }
    const usedPorts = new Set(this.getUsedPorts());
    return !usedPorts.has(port);
  }

  getUsedPorts(): number[] {
    const rows = this.db.prepare('SELECT host_port FROM frames WHERE host_port IS NOT NULL').all() as any[];
    return rows.map(row => row.host_port);
  }

  getAvailableCount(): number {
    const usedCount = this.getUsedPorts().length;
    return PORT_RANGE_END - PORT_RANGE_START + 1 - usedCount;
  }

  // Helper to add a frame with a port
  addFrameWithPort(name: string, port: number) {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO frames (id, name, status, workspace_path, graphiti_group_id, host_port, created_at, updated_at)
      VALUES (?, ?, 'created', '/tmp', 'frame:test', ?, ?, ?)
    `).run(crypto.randomUUID(), name, port, now, now);
  }
}

describe('PortAllocator', () => {
  let db: Database;
  let allocator: TestPortAllocator;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    allocator = new TestPortAllocator(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('allocate', () => {
    test('allocates first port when none are used', () => {
      const port = allocator.allocate();
      expect(port).toBe(PORT_RANGE_START);
    });

    test('allocates next available port', () => {
      allocator.addFrameWithPort('frame-1', PORT_RANGE_START);
      allocator.addFrameWithPort('frame-2', PORT_RANGE_START + 1);

      const port = allocator.allocate();
      expect(port).toBe(PORT_RANGE_START + 2);
    });

    test('fills gaps in port allocation', () => {
      allocator.addFrameWithPort('frame-1', PORT_RANGE_START);
      allocator.addFrameWithPort('frame-3', PORT_RANGE_START + 2);

      const port = allocator.allocate();
      expect(port).toBe(PORT_RANGE_START + 1);
    });
  });

  describe('isAvailable', () => {
    test('returns true for unused port in range', () => {
      expect(allocator.isAvailable(PORT_RANGE_START)).toBe(true);
      expect(allocator.isAvailable(PORT_RANGE_START + 100)).toBe(true);
    });

    test('returns false for used port', () => {
      allocator.addFrameWithPort('frame-1', PORT_RANGE_START);
      expect(allocator.isAvailable(PORT_RANGE_START)).toBe(false);
    });

    test('returns false for port outside range', () => {
      expect(allocator.isAvailable(PORT_RANGE_START - 1)).toBe(false);
      expect(allocator.isAvailable(PORT_RANGE_END + 1)).toBe(false);
      expect(allocator.isAvailable(80)).toBe(false);
    });
  });

  describe('getUsedPorts', () => {
    test('returns empty array when no ports used', () => {
      const ports = allocator.getUsedPorts();
      expect(ports).toEqual([]);
    });

    test('returns all used ports', () => {
      allocator.addFrameWithPort('frame-1', 33000);
      allocator.addFrameWithPort('frame-2', 33005);
      allocator.addFrameWithPort('frame-3', 33010);

      const ports = allocator.getUsedPorts();
      expect(ports.sort()).toEqual([33000, 33005, 33010]);
    });
  });

  describe('getAvailableCount', () => {
    test('returns full range when no ports used', () => {
      const count = allocator.getAvailableCount();
      expect(count).toBe(PORT_RANGE_END - PORT_RANGE_START + 1);
    });

    test('decreases as ports are used', () => {
      const initialCount = allocator.getAvailableCount();

      allocator.addFrameWithPort('frame-1', 33000);
      expect(allocator.getAvailableCount()).toBe(initialCount - 1);

      allocator.addFrameWithPort('frame-2', 33001);
      expect(allocator.getAvailableCount()).toBe(initialCount - 2);
    });
  });

  describe('port range constants', () => {
    test('PORT_RANGE_START is 33000', () => {
      expect(PORT_RANGE_START).toBe(33000);
    });

    test('PORT_RANGE_END is 34000', () => {
      expect(PORT_RANGE_END).toBe(34000);
    });

    test('range has 1001 ports', () => {
      expect(PORT_RANGE_END - PORT_RANGE_START + 1).toBe(1001);
    });
  });
});
