import { describe, test, expect, beforeEach } from 'bun:test';
import { createMockPortAllocator, createMockStateStore } from '../helpers.js';
import type { MockPortAllocator, MockStateStore } from '../helpers.js';
import { PORT_RANGE_START, PORT_RANGE_END } from '../../src/types/index.js';

describe('PortAllocator', () => {
  let allocator: MockPortAllocator;
  let store: MockStateStore;

  beforeEach(() => {
    allocator = createMockPortAllocator();
    store = createMockStateStore();
  });

  describe('allocate', () => {
    test('allocates first port when none are used', async () => {
      const port = await allocator.allocate();
      expect(port).toBe(PORT_RANGE_START);
    });

    test('allocates sequential ports', async () => {
      const port1 = await allocator.allocate();
      const port2 = await allocator.allocate();
      const port3 = await allocator.allocate();

      expect(port1).toBe(PORT_RANGE_START);
      expect(port2).toBe(PORT_RANGE_START + 1);
      expect(port3).toBe(PORT_RANGE_START + 2);
    });

    test('tracks allocated ports', async () => {
      await allocator.allocate();
      await allocator.allocate();

      expect(allocator.usedPorts.has(PORT_RANGE_START)).toBe(true);
      expect(allocator.usedPorts.has(PORT_RANGE_START + 1)).toBe(true);
      expect(allocator.usedPorts.has(PORT_RANGE_START + 2)).toBe(false);
    });
  });

  describe('isAvailable', () => {
    test('returns true for unused port in range', async () => {
      expect(await allocator.isAvailable(PORT_RANGE_START)).toBe(true);
      expect(await allocator.isAvailable(PORT_RANGE_START + 100)).toBe(true);
    });

    test('returns false for used port', async () => {
      await allocator.allocate(); // Allocates PORT_RANGE_START
      expect(await allocator.isAvailable(PORT_RANGE_START)).toBe(false);
    });
  });

  describe('getUsedPorts', () => {
    test('returns empty array when no ports used', async () => {
      const ports = await allocator.getUsedPorts();
      expect(ports).toEqual([]);
    });

    test('returns all used ports', async () => {
      await allocator.allocate();
      await allocator.allocate();
      await allocator.allocate();

      const ports = await allocator.getUsedPorts();
      expect(ports.sort()).toEqual([33000, 33001, 33002]);
    });
  });

  describe('getAvailableCount', () => {
    test('returns full range when no ports used', async () => {
      const count = await allocator.getAvailableCount();
      expect(count).toBe(PORT_RANGE_END - PORT_RANGE_START + 1);
    });

    test('decreases as ports are used', async () => {
      const initialCount = await allocator.getAvailableCount();

      await allocator.allocate();
      expect(await allocator.getAvailableCount()).toBe(initialCount - 1);

      await allocator.allocate();
      expect(await allocator.getAvailableCount()).toBe(initialCount - 2);
    });
  });

  describe('reset', () => {
    test('clears all allocated ports', async () => {
      await allocator.allocate();
      await allocator.allocate();
      await allocator.allocate();

      allocator.reset();

      expect(allocator.usedPorts.size).toBe(0);
      expect(await allocator.allocate()).toBe(PORT_RANGE_START);
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
