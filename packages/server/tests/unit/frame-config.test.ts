/**
 * FrameConfig Application Tests (TDD)
 *
 * These tests verify that FrameConfig is properly applied when frames start:
 * - manager config → container environment variables
 * - ports config → container port mapping
 * - behavior config → frame initialization options
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import {
  createMockStateStore,
  createMockContainerRuntime,
  createMockPortAllocator,
  createMockConfigManager,
  createTestConfig,
} from '../helpers.js';
import type { MockStateStore, MockContainerRuntime, MockPortAllocator, MockConfigManager } from '../helpers.js';
import { _setStateStore } from '../../src/services/state-store.js';
import { _setContainerRuntime } from '../../src/services/container-runtime.js';
import { _setPortAllocator } from '../../src/services/port-allocator.js';
import { _setConfigManager } from '../../src/services/config-manager.js';
import { FrameManager } from '../../src/services/frame-manager.js';

describe('FrameConfig Application', () => {
  let frameManager: FrameManager;
  let mockStore: MockStateStore;
  let mockRuntime: MockContainerRuntime;
  let mockPortAllocator: MockPortAllocator;
  let mockConfigManager: MockConfigManager;
  let existsSyncSpy: ReturnType<typeof spyOn>;
  let mkdirSyncSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockStore = createMockStateStore();
    mockRuntime = createMockContainerRuntime();
    mockPortAllocator = createMockPortAllocator();
    mockConfigManager = createMockConfigManager();

    _setStateStore(mockStore as any);
    _setContainerRuntime(mockRuntime as any);
    _setPortAllocator(mockPortAllocator as any);
    _setConfigManager(mockConfigManager as any);

    existsSyncSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    mkdirSyncSpy = spyOn(fs, 'mkdirSync').mockReturnValue(undefined);

    frameManager = new FrameManager();
  });

  afterEach(() => {
    _setStateStore(null);
    _setContainerRuntime(null);
    _setPortAllocator(null);
    _setConfigManager(null);
    existsSyncSpy.mockRestore();
    mkdirSyncSpy.mockRestore();
  });

  describe('manager config → environment variables', () => {
    test('sets OPTAGON_MANAGER_PROVIDER from config', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3-opus' },
      });

      const frame = await frameManager.createFrame({
        name: 'manager-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.OPTAGON_MANAGER_PROVIDER).toBe('anthropic');
    });

    test('sets OPTAGON_MANAGER_MODEL from config', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3-opus' },
      });

      const frame = await frameManager.createFrame({
        name: 'model-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.OPTAGON_MANAGER_MODEL).toBe('claude-3-opus');
    });

    test('sets ANTHROPIC_API_KEY when provider is anthropic', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3', apiKey: 'sk-ant-test-key' },
      });

      const frame = await frameManager.createFrame({
        name: 'anthropic-key-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.ANTHROPIC_API_KEY).toBe('sk-ant-test-key');
    });

    test('sets OPENAI_API_KEY when provider is openai', async () => {
      const config = createTestConfig({
        manager: { provider: 'openai', model: 'gpt-4', apiKey: 'sk-openai-test-key' },
      });

      const frame = await frameManager.createFrame({
        name: 'openai-key-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.OPENAI_API_KEY).toBe('sk-openai-test-key');
    });

    test('sets OPTAGON_MANAGER_BASE_URL when provided', async () => {
      const config = createTestConfig({
        manager: { provider: 'ollama', model: 'llama2', baseUrl: 'http://localhost:11434' },
      });

      const frame = await frameManager.createFrame({
        name: 'base-url-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.OPTAGON_MANAGER_BASE_URL).toBe('http://localhost:11434');
    });

    test('sets OPTAGON_MANAGER_TEMPERATURE when provided', async () => {
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3', temperature: 0.7 },
      });

      const frame = await frameManager.createFrame({
        name: 'temperature-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.OPTAGON_MANAGER_TEMPERATURE).toBe('0.7');
    });

    test('merges with global config (frame config takes precedence)', async () => {
      // Set global API key
      mockConfigManager.setConfig('anthropic_api_key', 'sk-global-key');

      // Frame config has a different key
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3', apiKey: 'sk-frame-key' },
      });

      const frame = await frameManager.createFrame({
        name: 'merge-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      // Frame config should override global
      expect(options?.env?.ANTHROPIC_API_KEY).toBe('sk-frame-key');
    });

    test('uses global config when frame config has no apiKey', async () => {
      // Set global API key
      mockConfigManager.setConfig('anthropic_api_key', 'sk-global-key');

      // Frame config without apiKey
      const config = createTestConfig({
        manager: { provider: 'anthropic', model: 'claude-3' },
      });

      const frame = await frameManager.createFrame({
        name: 'global-fallback-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.env?.ANTHROPIC_API_KEY).toBe('sk-global-key');
    });
  });

  describe('ports config → port mapping', () => {
    test('uses config.ports.dev as container port', async () => {
      const config = createTestConfig({
        ports: { dev: 8080 },
      });

      const frame = await frameManager.createFrame({
        name: 'dev-port-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.containerPort).toBe(8080);
    });

    test('uses default port 3000 when ports.dev not specified', async () => {
      const frame = await frameManager.createFrame({
        name: 'default-port-test',
        workspacePath: '/workspace',
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      // containerPort should be undefined (uses default 3000)
      expect(options?.containerPort).toBeUndefined();
    });

    test('passes additional ports to container runtime', async () => {
      const config = createTestConfig({
        ports: { dev: 3000, additional: [8080, 9000, 5000] },
      });

      const frame = await frameManager.createFrame({
        name: 'additional-ports-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();
      expect(options?.additionalPorts).toEqual([8080, 9000, 5000]);
    });
  });

  describe('behavior config → frame initialization', () => {
    test('passes autoSpawnAgents to initializer', async () => {
      const config = createTestConfig({
        behavior: { autoSpawnAgents: false },
      });

      const frame = await frameManager.createFrame({
        name: 'auto-spawn-test',
        workspacePath: '/workspace',
        config,
      });

      // Store the config so we can verify it's passed to initializer
      const storedConfig = await mockStore.getFrameConfig(frame.id);
      expect(storedConfig?.behavior?.autoSpawnAgents).toBe(false);
    });

    test('passes maxConcurrentAgents to initializer', async () => {
      const config = createTestConfig({
        behavior: { maxConcurrentAgents: 3 },
      });

      const frame = await frameManager.createFrame({
        name: 'max-agents-test',
        workspacePath: '/workspace',
        config,
      });

      const storedConfig = await mockStore.getFrameConfig(frame.id);
      expect(storedConfig?.behavior?.maxConcurrentAgents).toBe(3);
    });

    test('passes qualityGateEnabled to initializer', async () => {
      const config = createTestConfig({
        behavior: { qualityGateEnabled: true },
      });

      const frame = await frameManager.createFrame({
        name: 'quality-gate-test',
        workspacePath: '/workspace',
        config,
      });

      const storedConfig = await mockStore.getFrameConfig(frame.id);
      expect(storedConfig?.behavior?.qualityGateEnabled).toBe(true);
    });
  });

  describe('complete config application', () => {
    test('applies all config sections when starting frame', async () => {
      const config = createTestConfig({
        manager: {
          provider: 'anthropic',
          model: 'claude-3-opus',
          apiKey: 'sk-test-key',
          temperature: 0.5,
        },
        ports: {
          dev: 8080,
          additional: [9000],
        },
        behavior: {
          autoSpawnAgents: true,
          maxConcurrentAgents: 2,
          qualityGateEnabled: false,
        },
      });

      const frame = await frameManager.createFrame({
        name: 'full-config-test',
        workspacePath: '/workspace',
        config,
      });

      await frameManager.startFrame(frame.name);

      const options = mockRuntime.getLastCreateOptions();

      // Verify manager config
      expect(options?.env?.OPTAGON_MANAGER_PROVIDER).toBe('anthropic');
      expect(options?.env?.OPTAGON_MANAGER_MODEL).toBe('claude-3-opus');
      expect(options?.env?.ANTHROPIC_API_KEY).toBe('sk-test-key');
      expect(options?.env?.OPTAGON_MANAGER_TEMPERATURE).toBe('0.5');

      // Verify ports config
      expect(options?.containerPort).toBe(8080);
      expect(options?.additionalPorts).toEqual([9000]);

      // Verify behavior config is stored (applied during initialization)
      const storedConfig = await mockStore.getFrameConfig(frame.id);
      expect(storedConfig?.behavior?.autoSpawnAgents).toBe(true);
      expect(storedConfig?.behavior?.maxConcurrentAgents).toBe(2);
      expect(storedConfig?.behavior?.qualityGateEnabled).toBe(false);
    });
  });
});
