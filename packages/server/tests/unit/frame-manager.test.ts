import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import {
  createMockStateStore,
  createMockContainerRuntime,
  createMockPortAllocator,
  createMockConfigManager,
  createTestFrame,
  createTestConfig,
} from '../helpers.js';
import type { MockStateStore, MockContainerRuntime, MockPortAllocator, MockConfigManager } from '../helpers.js';
import { _setStateStore } from '../../src/services/state-store.js';
import { _setContainerRuntime } from '../../src/services/container-runtime.js';
import { _setPortAllocator } from '../../src/services/port-allocator.js';
import { _setConfigManager } from '../../src/services/config-manager.js';
import { FrameManager } from '../../src/services/frame-manager.js';

describe('FrameManager', () => {
  let frameManager: FrameManager;
  let mockStore: MockStateStore;
  let mockRuntime: MockContainerRuntime;
  let mockPortAllocator: MockPortAllocator;
  let mockConfigManager: MockConfigManager;

  // Spies for fs functions
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let mkdirSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Create fresh mocks
    mockStore = createMockStateStore();
    mockRuntime = createMockContainerRuntime();
    mockPortAllocator = createMockPortAllocator();
    mockConfigManager = createMockConfigManager();

    // Inject mocks
    _setStateStore(mockStore as any);
    _setContainerRuntime(mockRuntime as any);
    _setPortAllocator(mockPortAllocator as any);
    _setConfigManager(mockConfigManager as any);

    // Mock filesystem
    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    mkdirSyncSpy = spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    // Create fresh frame manager
    frameManager = new FrameManager();
  });

  afterEach(() => {
    // Clean up mocks
    _setStateStore(null);
    _setContainerRuntime(null);
    _setPortAllocator(null);
    _setConfigManager(null);

    // Restore spies
    existsSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
  });

  describe('createFrame', () => {
    test('creates frame with valid input', async () => {
      const frame = await frameManager.createFrame({
        name: 'test-frame',
        workspacePath: '/home/user/project',
      });

      expect(frame.name).toBe('test-frame');
      expect(frame.workspacePath).toBe('/home/user/project');
      expect(frame.status).toBe('created');
      expect(frame.hostPort).toBeDefined();
    });

    test('throws when workspace path does not exist', async () => {
      existsSyncSpy.mockReturnValue(false);

      await expect(
        frameManager.createFrame({
          name: 'test-frame',
          workspacePath: '/non/existent/path',
        })
      ).rejects.toThrow('Workspace path does not exist');
    });

    test('throws when frame name already exists', async () => {
      // Pre-create a frame with same name
      const existingFrame = createTestFrame({ name: 'duplicate-name' });
      await mockStore.createFrame(existingFrame);

      await expect(
        frameManager.createFrame({
          name: 'duplicate-name',
          workspacePath: '/home/user/project',
        })
      ).rejects.toThrow("Frame with name 'duplicate-name' already exists");
    });

    test('allocates port from port allocator', async () => {
      const frame = await frameManager.createFrame({
        name: 'test-frame',
        workspacePath: '/home/user/project',
      });

      expect(frame.hostPort).toBe(33000); // First port from mock allocator
    });

    test('creates frame directory', async () => {
      await frameManager.createFrame({
        name: 'test-frame',
        workspacePath: '/home/user/project',
      });

      expect(mkdirSyncSpy).toHaveBeenCalled();
    });

    test('saves frame to store', async () => {
      await frameManager.createFrame({
        name: 'stored-frame',
        workspacePath: '/home/user/project',
      });

      expect(mockStore.frames.size).toBe(1);
      const savedFrame = Array.from(mockStore.frames.values())[0];
      expect(savedFrame.name).toBe('stored-frame');
    });

    test('logs created event', async () => {
      await frameManager.createFrame({
        name: 'event-frame',
        workspacePath: '/home/user/project',
      });

      expect(mockStore.events.length).toBe(1);
      expect(mockStore.events[0].eventType).toBe('created');
    });

    test('stores template name when provided', async () => {
      const frame = await frameManager.createFrame({
        name: 'template-frame',
        workspacePath: '/home/user/project',
      }, 'claude-code');

      expect(frame.templateName).toBe('claude-code');
    });

    test('stores frame config when provided', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3' },
      });

      const frame = await frameManager.createFrame({
        name: 'config-frame',
        workspacePath: '/home/user/project',
        config,
      });

      const savedConfig = await mockStore.getFrameConfig(frame.id);
      expect(savedConfig!.manager?.provider).toBe('anthropic');
    });
  });

  describe('startFrame', () => {
    test('starts a created frame', async () => {
      const frame = await frameManager.createFrame({
        name: 'start-test',
        workspacePath: '/home/user/project',
      });

      const started = await frameManager.startFrame(frame.name);

      expect(started.status).toBe('running');
      expect(started.containerId).toBeDefined();
    });

    test('throws when frame not found', async () => {
      await expect(frameManager.startFrame('non-existent')).rejects.toThrow('Frame not found');
    });

    test('throws when frame already running', async () => {
      const frame = await frameManager.createFrame({
        name: 'running-frame',
        workspacePath: '/home/user/project',
      });

      await frameManager.startFrame(frame.name);

      await expect(frameManager.startFrame(frame.name)).rejects.toThrow('already running');
    });

    test('creates container via container runtime', async () => {
      const frame = await frameManager.createFrame({
        name: 'container-test',
        workspacePath: '/home/user/project',
      });

      await frameManager.startFrame(frame.name);

      expect(mockRuntime.containers.size).toBe(1);
    });

    test('updates frame with container ID', async () => {
      const frame = await frameManager.createFrame({
        name: 'container-id-test',
        workspacePath: '/home/user/project',
      });

      const started = await frameManager.startFrame(frame.name);

      expect(started.containerId).toMatch(/^mock-container-/);
    });

    test('logs started event', async () => {
      const frame = await frameManager.createFrame({
        name: 'event-test',
        workspacePath: '/home/user/project',
      });

      await frameManager.startFrame(frame.name);

      const events = await mockStore.getFrameEvents(frame.id);
      expect(events.some(e => e.eventType === 'started')).toBe(true);
    });

    test('sets lastActiveAt timestamp', async () => {
      const frame = await frameManager.createFrame({
        name: 'active-test',
        workspacePath: '/home/user/project',
      });

      const started = await frameManager.startFrame(frame.name);

      expect(started.lastActiveAt).toBeInstanceOf(Date);
    });

    test('adopts existing container with same name', async () => {
      // Pre-create an orphaned container
      const orphanedContainerId = await mockRuntime.createContainer({
        name: 'orphan-frame',
        workspacePath: '/workspace',
        hostPort: 33100,
        frameId: 'old-frame-id',
      });

      // Create a new frame with same name
      const frame = await frameManager.createFrame({
        name: 'orphan-frame',
        workspacePath: '/home/user/project',
      });

      // Start should adopt the existing container
      const started = await frameManager.startFrame(frame.name);

      expect(started.containerId).toBe(orphanedContainerId);
    });
  });

  describe('stopFrame', () => {
    test('stops a running frame', async () => {
      const frame = await frameManager.createFrame({
        name: 'stop-test',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);

      const stopped = await frameManager.stopFrame(frame.name);

      expect(stopped.status).toBe('stopped');
    });

    test('throws when frame not found', async () => {
      await expect(frameManager.stopFrame('non-existent')).rejects.toThrow('Frame not found');
    });

    test('throws when frame not running', async () => {
      const frame = await frameManager.createFrame({
        name: 'not-running',
        workspacePath: '/home/user/project',
      });

      await expect(frameManager.stopFrame(frame.name)).rejects.toThrow('not running');
    });

    test('stops container via container runtime', async () => {
      const frame = await frameManager.createFrame({
        name: 'runtime-stop',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);

      await frameManager.stopFrame(frame.name);

      const container = Array.from(mockRuntime.containers.values())[0];
      expect(container.status).toBe('stopped');
    });

    test('logs stopped event', async () => {
      const frame = await frameManager.createFrame({
        name: 'stop-event',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);

      await frameManager.stopFrame(frame.name);

      const events = await mockStore.getFrameEvents(frame.id);
      expect(events.some(e => e.eventType === 'stopped')).toBe(true);
    });
  });

  describe('destroyFrame', () => {
    test('destroys a stopped frame', async () => {
      const frame = await frameManager.createFrame({
        name: 'destroy-test',
        workspacePath: '/home/user/project',
      });

      await frameManager.destroyFrame(frame.name);

      const found = await mockStore.getFrame(frame.id);
      expect(found).toBeNull();
    });

    test('throws when frame not found', async () => {
      await expect(frameManager.destroyFrame('non-existent')).rejects.toThrow('Frame not found');
    });

    test('throws when frame running without force', async () => {
      const frame = await frameManager.createFrame({
        name: 'running-destroy',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);

      await expect(frameManager.destroyFrame(frame.name)).rejects.toThrow('running');
    });

    test('force destroys a running frame', async () => {
      const frame = await frameManager.createFrame({
        name: 'force-destroy',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);

      await frameManager.destroyFrame(frame.name, true);

      const found = await mockStore.getFrame(frame.id);
      expect(found).toBeNull();
    });

    test('removes container from runtime', async () => {
      const frame = await frameManager.createFrame({
        name: 'container-destroy',
        workspacePath: '/home/user/project',
      });
      await frameManager.startFrame(frame.name);
      await frameManager.stopFrame(frame.name);

      await frameManager.destroyFrame(frame.name);

      expect(mockRuntime.containers.size).toBe(0);
    });

    test('logs destroyed event before deletion', async () => {
      const frame = await frameManager.createFrame({
        name: 'destroy-event',
        workspacePath: '/home/user/project',
      });

      await frameManager.destroyFrame(frame.name);

      // Events should still exist since we log before delete
      expect(mockStore.events.some(e => e.eventType === 'destroyed')).toBe(true);
    });
  });

  describe('getFrame', () => {
    test('returns frame by name', async () => {
      const created = await frameManager.createFrame({
        name: 'get-by-name',
        workspacePath: '/home/user/project',
      });

      const frame = await frameManager.getFrame('get-by-name');

      expect(frame).not.toBeNull();
      expect(frame!.name).toBe('get-by-name');
    });

    test('returns frame by ID', async () => {
      const created = await frameManager.createFrame({
        name: 'get-by-id',
        workspacePath: '/home/user/project',
      });

      const frame = await frameManager.getFrame(created.id);

      expect(frame).not.toBeNull();
      expect(frame!.id).toBe(created.id);
    });

    test('returns null for non-existent frame', async () => {
      const frame = await frameManager.getFrame('non-existent');
      expect(frame).toBeNull();
    });
  });

  describe('listFrames', () => {
    test('returns all frames', async () => {
      await frameManager.createFrame({ name: 'frame-1', workspacePath: '/path1' });
      await frameManager.createFrame({ name: 'frame-2', workspacePath: '/path2' });
      await frameManager.createFrame({ name: 'frame-3', workspacePath: '/path3' });

      const frames = await frameManager.listFrames();

      expect(frames.length).toBe(3);
    });

    test('filters by status', async () => {
      await frameManager.createFrame({ name: 'created-frame', workspacePath: '/path1' });
      const runningFrame = await frameManager.createFrame({ name: 'running-frame', workspacePath: '/path2' });
      await frameManager.startFrame(runningFrame.name);

      const runningFrames = await frameManager.listFrames('running');

      expect(runningFrames.length).toBe(1);
      expect(runningFrames[0].name).toBe('running-frame');
    });
  });

  describe('getFrameConfig', () => {
    test('returns config for frame', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3' },
      });
      const frame = await frameManager.createFrame({
        name: 'config-frame',
        workspacePath: '/path',
        config,
      });

      const retrievedConfig = await frameManager.getFrameConfig(frame.name);

      expect(retrievedConfig).not.toBeNull();
      expect(retrievedConfig!.manager?.provider).toBe('anthropic');
    });

    test('returns null for non-existent frame', async () => {
      const config = await frameManager.getFrameConfig('non-existent');
      expect(config).toBeNull();
    });
  });

  describe('updateFrameConfig', () => {
    test('updates frame config', async () => {
      const frame = await frameManager.createFrame({
        name: 'update-config',
        workspacePath: '/path',
      });

      await frameManager.updateFrameConfig(frame.name, {
        manager: { provider: 'openai', model: 'gpt-4' },
      });

      const config = await frameManager.getFrameConfig(frame.name);
      expect(config!.manager?.provider).toBe('openai');
    });

    test('throws for non-existent frame', async () => {
      await expect(
        frameManager.updateFrameConfig('non-existent', { manager: { provider: 'anthropic', model: 'claude' } })
      ).rejects.toThrow('Frame not found');
    });

    test('logs config_changed event', async () => {
      const frame = await frameManager.createFrame({
        name: 'config-event',
        workspacePath: '/path',
      });

      await frameManager.updateFrameConfig(frame.name, {
        behavior: { autoSpawnAgents: false },
      });

      const events = await mockStore.getFrameEvents(frame.id);
      expect(events.some(e => e.eventType === 'config_changed')).toBe(true);
    });
  });

  describe('getFrameEvents', () => {
    test('returns events for frame', async () => {
      const frame = await frameManager.createFrame({
        name: 'events-frame',
        workspacePath: '/path',
      });
      await frameManager.startFrame(frame.name);
      await frameManager.stopFrame(frame.name);

      const events = await frameManager.getFrameEvents(frame.name);

      expect(events.length).toBeGreaterThan(0);
      expect(events.some(e => e.eventType === 'created')).toBe(true);
      expect(events.some(e => e.eventType === 'started')).toBe(true);
      expect(events.some(e => e.eventType === 'stopped')).toBe(true);
    });

    test('throws for non-existent frame', async () => {
      await expect(frameManager.getFrameEvents('non-existent')).rejects.toThrow('Frame not found');
    });
  });
});
