import { describe, test, expect, beforeEach } from 'bun:test';
import { createMockStateStore, createTestFrame, createTestConfig } from '../helpers.js';
import type { MockStateStore } from '../helpers.js';

describe('StateStore', () => {
  let store: MockStateStore;

  beforeEach(() => {
    store = createMockStateStore();
  });

  describe('createFrame', () => {
    test('creates a frame with all required fields', async () => {
      const frame = createTestFrame({ name: 'my-frame' });
      const result = await store.createFrame(frame);

      expect(result.id).toBe(frame.id);
      expect(result.name).toBe('my-frame');
      expect(result.status).toBe('created');
      expect(result.workspacePath).toBe(frame.workspacePath);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    test('stores frame in internal map', async () => {
      const frame = createTestFrame({ name: 'stored-frame' });
      await store.createFrame(frame);

      expect(store.frames.has(frame.id)).toBe(true);
    });

    test('creates frame with config', async () => {
      const frame = createTestFrame({ name: 'configured-frame' });
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3' },
      });
      await store.createFrame(frame, config);

      const savedConfig = await store.getFrameConfig(frame.id);
      expect(savedConfig).not.toBeNull();
      expect(savedConfig!.manager?.provider).toBe('anthropic');
    });

    test('tracks used ports', async () => {
      const frame = createTestFrame({ name: 'port-frame', hostPort: 33001 });
      await store.createFrame(frame);

      expect(store.usedPorts.has(33001)).toBe(true);
    });
  });

  describe('getFrame', () => {
    test('retrieves a frame by ID', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result = await store.getFrame(frame.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(frame.id);
    });

    test('returns null for non-existent ID', async () => {
      const result = await store.getFrame('non-existent-id');
      expect(result).toBeNull();
    });

    test('returns a copy, not the original reference', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result1 = await store.getFrame(frame.id);
      const result2 = await store.getFrame(frame.id);

      expect(result1).not.toBe(result2);
      expect(result1).toEqual(result2);
    });
  });

  describe('getFrameByName', () => {
    test('retrieves a frame by name', async () => {
      const frame = createTestFrame({ name: 'named-frame' });
      await store.createFrame(frame);

      const result = await store.getFrameByName('named-frame');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('named-frame');
    });

    test('returns null for non-existent name', async () => {
      const result = await store.getFrameByName('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('listFrames', () => {
    test('lists all frames', async () => {
      await store.createFrame(createTestFrame({ name: 'frame-1' }));
      await store.createFrame(createTestFrame({ name: 'frame-2' }));
      await store.createFrame(createTestFrame({ name: 'frame-3' }));

      const result = await store.listFrames();
      expect(result.length).toBe(3);
    });

    test('filters by status', async () => {
      await store.createFrame(createTestFrame({ name: 'frame-1', status: 'running' }));
      await store.createFrame(createTestFrame({ name: 'frame-2', status: 'stopped' }));
      await store.createFrame(createTestFrame({ name: 'frame-3', status: 'running' }));

      const running = await store.listFrames('running');
      expect(running.length).toBe(2);

      const stopped = await store.listFrames('stopped');
      expect(stopped.length).toBe(1);
    });

    test('returns empty array when no frames', async () => {
      const result = await store.listFrames();
      expect(result).toEqual([]);
    });

    test('returns frames sorted by creation time (newest first)', async () => {
      const frame1 = createTestFrame({ name: 'frame-1', createdAt: new Date('2024-01-01') });
      const frame2 = createTestFrame({ name: 'frame-2', createdAt: new Date('2024-01-03') });
      const frame3 = createTestFrame({ name: 'frame-3', createdAt: new Date('2024-01-02') });

      await store.createFrame(frame1);
      await store.createFrame(frame2);
      await store.createFrame(frame3);

      const result = await store.listFrames();
      expect(result[0].name).toBe('frame-2');
      expect(result[1].name).toBe('frame-3');
      expect(result[2].name).toBe('frame-1');
    });
  });

  describe('updateFrame', () => {
    test('updates frame status', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result = await store.updateFrame(frame.id, { status: 'running' });
      expect(result!.status).toBe('running');
    });

    test('updates container ID', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result = await store.updateFrame(frame.id, { containerId: 'abc123' });
      expect(result!.containerId).toBe('abc123');
    });

    test('updates multiple fields at once', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result = await store.updateFrame(frame.id, {
        status: 'running',
        containerId: 'container-123',
        hostPort: 33005,
      });

      expect(result!.status).toBe('running');
      expect(result!.containerId).toBe('container-123');
      expect(result!.hostPort).toBe(33005);
    });

    test('updates updatedAt timestamp', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const before = frame.updatedAt;
      await new Promise(r => setTimeout(r, 10)); // Small delay
      const result = await store.updateFrame(frame.id, { status: 'running' });

      expect(result!.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });

    test('returns null for non-existent frame', async () => {
      const result = await store.updateFrame('non-existent', { status: 'running' });
      expect(result).toBeNull();
    });
  });

  describe('deleteFrame', () => {
    test('deletes an existing frame', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      const result = await store.deleteFrame(frame.id);
      expect(result).toBe(true);

      const deleted = await store.getFrame(frame.id);
      expect(deleted).toBeNull();
    });

    test('returns false for non-existent frame', async () => {
      const result = await store.deleteFrame('non-existent');
      expect(result).toBe(false);
    });

    test('removes from used ports', async () => {
      const frame = createTestFrame({ hostPort: 33010 });
      await store.createFrame(frame);
      expect(store.usedPorts.has(33010)).toBe(true);

      await store.deleteFrame(frame.id);
      expect(store.usedPorts.has(33010)).toBe(false);
    });

    test('also deletes associated config', async () => {
      const frame = createTestFrame();
      const config = createTestConfig({ manager: { provider: 'openai', model: 'gpt-4' } });
      await store.createFrame(frame, config);

      await store.deleteFrame(frame.id);

      const savedConfig = await store.getFrameConfig(frame.id);
      expect(savedConfig).toBeNull();
    });
  });

  describe('getUsedPorts', () => {
    test('returns list of used ports', async () => {
      await store.createFrame(createTestFrame({ name: 'frame-1', hostPort: 33000 }));
      await store.createFrame(createTestFrame({ name: 'frame-2', hostPort: 33001 }));
      await store.createFrame(createTestFrame({ name: 'frame-3', hostPort: 33002 }));

      const ports = await store.getUsedPorts();
      expect(ports).toContain(33000);
      expect(ports).toContain(33001);
      expect(ports).toContain(33002);
      expect(ports.length).toBe(3);
    });

    test('returns empty array when no frames', async () => {
      const ports = await store.getUsedPorts();
      expect(ports).toEqual([]);
    });
  });

  describe('frame events', () => {
    test('adds and retrieves frame events', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      await store.addFrameEvent(frame.id, 'started', { port: 33000 });
      await store.addFrameEvent(frame.id, 'stopped');

      const events = await store.getFrameEvents(frame.id);
      expect(events.length).toBe(2);
      expect(events[0].eventType).toBe('stopped'); // Most recent first
      expect(events[1].eventType).toBe('started');
    });

    test('event includes details when provided', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      await store.addFrameEvent(frame.id, 'error', { message: 'Container crashed' });

      const events = await store.getFrameEvents(frame.id);
      expect(events[0].details).toEqual({ message: 'Container crashed' });
    });

    test('respects limit parameter', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame);

      for (let i = 0; i < 10; i++) {
        await store.addFrameEvent(frame.id, 'started');
      }

      const events = await store.getFrameEvents(frame.id, 5);
      expect(events.length).toBe(5);
    });
  });

  describe('frame config', () => {
    test('getFrameConfig returns null for non-existent frame', async () => {
      const config = await store.getFrameConfig('non-existent');
      expect(config).toBeNull();
    });

    test('updateFrameConfig updates existing config', async () => {
      const frame = createTestFrame();
      await store.createFrame(frame, { manager: { provider: 'anthropic', model: 'claude-2' } });

      await store.updateFrameConfig(frame.id, {
        manager: { provider: 'openai', model: 'gpt-4' },
      });

      const config = await store.getFrameConfig(frame.id);
      expect(config!.manager?.provider).toBe('openai');
      expect(config!.manager?.model).toBe('gpt-4');
    });
  });

  describe('reset', () => {
    test('clears all data', async () => {
      await store.createFrame(createTestFrame({ name: 'frame-1', hostPort: 33000 }));
      await store.createFrame(createTestFrame({ name: 'frame-2', hostPort: 33001 }));

      store.reset();

      expect(store.frames.size).toBe(0);
      expect(store.configs.size).toBe(0);
      expect(store.events.length).toBe(0);
      expect(store.usedPorts.size).toBe(0);
    });
  });
});
