import { describe, test, expect, beforeEach } from 'bun:test';
import { createMockContainerRuntime } from '../helpers.js';
import type { MockContainerRuntime } from '../helpers.js';

describe('MockContainerRuntime', () => {
  let runtime: MockContainerRuntime;

  beforeEach(() => {
    runtime = createMockContainerRuntime();
  });

  describe('getRuntime', () => {
    test('returns podman by default', () => {
      expect(runtime.getRuntime()).toBe('podman');
    });
  });

  describe('createContainer', () => {
    test('creates container and returns ID', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/home/user/project',
        hostPort: 33000,
        frameId: 'frame-123',
      });

      expect(containerId).toMatch(/^mock-container-\d+$/);
    });

    test('stores container with correct name', async () => {
      await runtime.createContainer({
        name: 'my-frame',
        workspacePath: '/workspace',
        hostPort: 33001,
        frameId: 'frame-456',
      });

      const container = await runtime.getContainerByName('my-frame');
      expect(container).not.toBeNull();
      expect(container!.name).toBe('optagon-frame-my-frame');
    });

    test('stores container with running status', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33002,
        frameId: 'frame-789',
      });

      const info = await runtime.getContainerInfo(containerId);
      expect(info).not.toBeNull();
      expect(info!.status).toBe('running');
    });

    test('stores port mappings', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33003,
        containerPort: 3000,
        frameId: 'frame-abc',
      });

      const info = await runtime.getContainerInfo(containerId);
      expect(info!.ports).toContainEqual({ host: 33003, container: 3000 });
      expect(info!.ports).toContainEqual({ host: 34003, container: 10350 }); // Tilt port
    });

    test('uses default container port 3000', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33004,
        frameId: 'frame-def',
      });

      const info = await runtime.getContainerInfo(containerId);
      expect(info!.ports).toContainEqual({ host: 33004, container: 3000 });
    });

    test('stores environment variables', async () => {
      await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33005,
        frameId: 'frame-ghi',
        env: { ANTHROPIC_API_KEY: 'sk-test', CUSTOM_VAR: 'value' },
      });

      // Can access stored env via containers map
      const container = Array.from(runtime.containers.values())[0];
      expect(container.env).toEqual({ ANTHROPIC_API_KEY: 'sk-test', CUSTOM_VAR: 'value' });
    });

    test('getLastCreateOptions returns last options', async () => {
      const options = {
        name: 'last-frame',
        workspacePath: '/workspace',
        hostPort: 33006,
        frameId: 'frame-jkl',
        env: { TEST: 'value' },
      };

      await runtime.createContainer(options);

      const last = runtime.getLastCreateOptions();
      expect(last).toEqual(options);
    });
  });

  describe('startContainer', () => {
    test('changes container status to running', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33007,
        frameId: 'frame-mno',
      });

      await runtime.stopContainer(containerId);
      let info = await runtime.getContainerInfo(containerId);
      expect(info!.status).toBe('stopped');

      await runtime.startContainer(containerId);
      info = await runtime.getContainerInfo(containerId);
      expect(info!.status).toBe('running');
    });
  });

  describe('stopContainer', () => {
    test('changes container status to stopped', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33008,
        frameId: 'frame-pqr',
      });

      await runtime.stopContainer(containerId);

      const info = await runtime.getContainerInfo(containerId);
      expect(info!.status).toBe('stopped');
    });
  });

  describe('removeContainer', () => {
    test('removes container from map', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33009,
        frameId: 'frame-stu',
      });

      await runtime.removeContainer(containerId);

      const exists = await runtime.containerExists(containerId);
      expect(exists).toBe(false);
    });
  });

  describe('getContainerInfo', () => {
    test('returns container info for existing container', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33010,
        frameId: 'frame-vwx',
      });

      const info = await runtime.getContainerInfo(containerId);

      expect(info).not.toBeNull();
      expect(info!.id).toBe(containerId);
      expect(info!.status).toBe('running');
    });

    test('returns null for non-existent container', async () => {
      const info = await runtime.getContainerInfo('non-existent');
      expect(info).toBeNull();
    });
  });

  describe('containerExists', () => {
    test('returns true for existing container', async () => {
      const containerId = await runtime.createContainer({
        name: 'test-frame',
        workspacePath: '/workspace',
        hostPort: 33011,
        frameId: 'frame-yza',
      });

      const exists = await runtime.containerExists(containerId);
      expect(exists).toBe(true);
    });

    test('returns false for non-existent container', async () => {
      const exists = await runtime.containerExists('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('getContainerByName', () => {
    test('finds container by frame name', async () => {
      await runtime.createContainer({
        name: 'named-frame',
        workspacePath: '/workspace',
        hostPort: 33012,
        frameId: 'frame-bcd',
      });

      const container = await runtime.getContainerByName('named-frame');

      expect(container).not.toBeNull();
      expect(container!.name).toBe('optagon-frame-named-frame');
    });

    test('finds container by full container name', async () => {
      await runtime.createContainer({
        name: 'my-frame',
        workspacePath: '/workspace',
        hostPort: 33013,
        frameId: 'frame-efg',
      });

      const container = await runtime.getContainerByName('optagon-frame-my-frame');

      expect(container).not.toBeNull();
      expect(container!.name).toBe('optagon-frame-my-frame');
    });

    test('returns null for non-existent name', async () => {
      const container = await runtime.getContainerByName('non-existent');
      expect(container).toBeNull();
    });
  });

  describe('listContainers', () => {
    test('returns empty array when no containers', async () => {
      const containers = await runtime.listContainers();
      expect(containers).toEqual([]);
    });

    test('returns all containers', async () => {
      await runtime.createContainer({
        name: 'frame-1',
        workspacePath: '/workspace',
        hostPort: 33014,
        frameId: 'frame-1',
      });
      await runtime.createContainer({
        name: 'frame-2',
        workspacePath: '/workspace',
        hostPort: 33015,
        frameId: 'frame-2',
      });

      const containers = await runtime.listContainers();

      expect(containers.length).toBe(2);
      expect(containers.map(c => c.name).sort()).toEqual([
        'optagon-frame-frame-1',
        'optagon-frame-frame-2',
      ]);
    });
  });

  describe('imageExists', () => {
    test('returns true by default', async () => {
      const exists = await runtime.imageExists();
      expect(exists).toBe(true);
    });
  });

  describe('reset', () => {
    test('clears all containers', async () => {
      await runtime.createContainer({
        name: 'frame-1',
        workspacePath: '/workspace',
        hostPort: 33016,
        frameId: 'frame-1',
      });
      await runtime.createContainer({
        name: 'frame-2',
        workspacePath: '/workspace',
        hostPort: 33017,
        frameId: 'frame-2',
      });

      runtime.reset();

      expect(runtime.containers.size).toBe(0);
      expect(runtime.getLastCreateOptions()).toBeNull();
    });
  });
});
