import type { Frame, FrameStatus, FrameConfig, FrameEvent, FrameEventType, ContainerInfo } from '../src/types/index.js';
import type { ContainerCreateOptions } from '../src/services/container-runtime.js';

// ============================================
// Test Frame Factory
// ============================================

/**
 * Generate a test frame object with all required fields
 */
export function createTestFrame(overrides: Partial<Frame> = {}): Frame {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    name: overrides.name ?? `test-frame-${Date.now()}`,
    description: overrides.description,
    status: overrides.status ?? 'created',
    workspacePath: overrides.workspacePath ?? '/tmp/test-workspace',
    containerId: overrides.containerId,
    tmuxSocket: overrides.tmuxSocket,
    graphitiGroupId: overrides.graphitiGroupId ?? `frame:${id}`,
    hostPort: overrides.hostPort ?? 33000,
    templateName: overrides.templateName,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    lastActiveAt: overrides.lastActiveAt,
  };
}

/**
 * Generate test frame config
 */
export function createTestConfig(overrides: Partial<FrameConfig> = {}): FrameConfig {
  return {
    manager: overrides.manager,
    behavior: overrides.behavior,
    ports: overrides.ports,
  };
}

// ============================================
// Mock State Store
// ============================================

export interface MockStateStore {
  // Frame storage
  frames: Map<string, Frame>;
  configs: Map<string, FrameConfig>;
  events: FrameEvent[];
  usedPorts: Set<number>;

  // Methods (match StateStore interface)
  initialize: () => Promise<void>;
  isReady: () => Promise<boolean>;
  createFrame: (frame: Frame, config?: FrameConfig) => Promise<Frame>;
  getFrame: (id: string) => Promise<Frame | null>;
  getFrameByName: (name: string) => Promise<Frame | null>;
  listFrames: (status?: FrameStatus) => Promise<Frame[]>;
  updateFrame: (id: string, updates: Partial<Frame>) => Promise<Frame | null>;
  deleteFrame: (id: string) => Promise<boolean>;
  getFrameConfig: (frameId: string) => Promise<FrameConfig | null>;
  updateFrameConfig: (frameId: string, config: FrameConfig) => Promise<void>;
  addFrameEvent: (frameId: string, eventType: FrameEventType, details?: Record<string, unknown>) => Promise<void>;
  getFrameEvents: (frameId: string, limit?: number) => Promise<FrameEvent[]>;
  getUsedPorts: () => Promise<number[]>;
  close: () => Promise<void>;

  // Test utilities
  reset: () => void;
}

/**
 * Create a mock StateStore for unit testing
 */
export function createMockStateStore(): MockStateStore {
  const frames = new Map<string, Frame>();
  const configs = new Map<string, FrameConfig>();
  const events: FrameEvent[] = [];
  const usedPorts = new Set<number>();
  let eventIdCounter = 1;

  const store: MockStateStore = {
    frames,
    configs,
    events,
    usedPorts,

    initialize: async () => {},

    isReady: async () => true,

    createFrame: async (frame: Frame, config?: FrameConfig) => {
      frames.set(frame.id, { ...frame });
      configs.set(frame.id, config ?? {});
      if (frame.hostPort) usedPorts.add(frame.hostPort);
      return frame;
    },

    getFrame: async (id: string) => {
      const frame = frames.get(id);
      return frame ? { ...frame } : null;
    },

    getFrameByName: async (name: string) => {
      for (const frame of frames.values()) {
        if (frame.name === name) return { ...frame };
      }
      return null;
    },

    listFrames: async (status?: FrameStatus) => {
      const result: Frame[] = [];
      for (const frame of frames.values()) {
        if (!status || frame.status === status) {
          result.push({ ...frame });
        }
      }
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },

    updateFrame: async (id: string, updates: Partial<Frame>) => {
      const frame = frames.get(id);
      if (!frame) return null;
      const updated = { ...frame, ...updates, updatedAt: new Date() };
      frames.set(id, updated);
      return { ...updated };
    },

    deleteFrame: async (id: string) => {
      const frame = frames.get(id);
      if (!frame) return false;
      if (frame.hostPort) usedPorts.delete(frame.hostPort);
      frames.delete(id);
      configs.delete(id);
      return true;
    },

    getFrameConfig: async (frameId: string) => {
      const config = configs.get(frameId);
      return config ? { ...config } : null;
    },

    updateFrameConfig: async (frameId: string, config: FrameConfig) => {
      configs.set(frameId, { ...config });
    },

    addFrameEvent: async (frameId: string, eventType: FrameEventType, details?: Record<string, unknown>) => {
      events.push({
        id: eventIdCounter++,
        frameId,
        eventType,
        details,
        createdAt: new Date(),
      });
    },

    getFrameEvents: async (frameId: string, limit = 50) => {
      return events
        .filter(e => e.frameId === frameId)
        .sort((a, b) => {
          // Sort by createdAt descending, then by id descending (newest first)
          const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
          return timeDiff !== 0 ? timeDiff : b.id - a.id;
        })
        .slice(0, limit);
    },

    getUsedPorts: async () => {
      return Array.from(usedPorts);
    },

    close: async () => {},

    reset: () => {
      frames.clear();
      configs.clear();
      events.length = 0;
      usedPorts.clear();
      eventIdCounter = 1;
    },
  };

  return store;
}

// ============================================
// Mock Container Runtime
// ============================================

export interface MockContainerRuntime {
  containers: Map<string, { id: string; name: string; status: ContainerInfo['status']; ports: ContainerInfo['ports']; env: Record<string, string> }>;
  runtime: 'podman' | 'docker';

  // Methods (match ContainerRuntime interface)
  getRuntime: () => string;
  createContainer: (options: ContainerCreateOptions) => Promise<string>;
  startContainer: (containerId: string) => Promise<void>;
  stopContainer: (containerId: string) => Promise<void>;
  removeContainer: (containerId: string, force?: boolean) => Promise<void>;
  getContainerInfo: (containerId: string) => Promise<ContainerInfo | null>;
  containerExists: (containerId: string) => Promise<boolean>;
  exec: (containerId: string, command: string[]) => Promise<string>;
  getContainerByName: (name: string) => Promise<ContainerInfo | null>;
  listContainers: () => Promise<ContainerInfo[]>;
  buildImage: (dockerfilePath: string) => Promise<void>;
  imageExists: () => Promise<boolean>;

  // Test utilities
  reset: () => void;
  getLastCreateOptions: () => ContainerCreateOptions | null;
}

/**
 * Create a mock ContainerRuntime for unit testing
 */
export function createMockContainerRuntime(): MockContainerRuntime {
  const containers = new Map<string, { id: string; name: string; status: ContainerInfo['status']; ports: ContainerInfo['ports']; env: Record<string, string> }>();
  let lastCreateOptions: ContainerCreateOptions | null = null;
  let containerIdCounter = 1;

  const runtime: MockContainerRuntime = {
    containers,
    runtime: 'podman',

    getRuntime: () => 'podman',

    createContainer: async (options: ContainerCreateOptions) => {
      lastCreateOptions = options;
      const id = `mock-container-${containerIdCounter++}`;
      const containerName = `optagon-frame-${options.name}`;
      containers.set(id, {
        id,
        name: containerName,
        status: 'running',
        ports: [
          { host: options.hostPort, container: options.containerPort ?? 3000 },
          { host: options.hostPort + 1000, container: 10350 },
        ],
        env: options.env ?? {},
      });
      return id;
    },

    startContainer: async (containerId: string) => {
      const container = containers.get(containerId);
      if (container) container.status = 'running';
    },

    stopContainer: async (containerId: string) => {
      const container = containers.get(containerId);
      if (container) container.status = 'stopped';
    },

    removeContainer: async (containerId: string, _force?: boolean) => {
      containers.delete(containerId);
    },

    getContainerInfo: async (containerId: string) => {
      const container = containers.get(containerId);
      if (!container) return null;
      return {
        id: container.id,
        name: container.name,
        status: container.status,
        ports: container.ports,
      };
    },

    containerExists: async (containerId: string) => {
      return containers.has(containerId);
    },

    exec: async (_containerId: string, _command: string[]) => {
      return '';
    },

    getContainerByName: async (name: string) => {
      const containerName = name.startsWith('optagon-frame-') ? name : `optagon-frame-${name}`;
      for (const container of containers.values()) {
        if (container.name === containerName) {
          return {
            id: container.id,
            name: container.name,
            status: container.status,
            ports: container.ports,
          };
        }
      }
      return null;
    },

    listContainers: async () => {
      const result: ContainerInfo[] = [];
      for (const container of containers.values()) {
        result.push({
          id: container.id,
          name: container.name,
          status: container.status,
          ports: container.ports,
        });
      }
      return result;
    },

    buildImage: async (_dockerfilePath: string) => {},

    imageExists: async () => true,

    reset: () => {
      containers.clear();
      lastCreateOptions = null;
      containerIdCounter = 1;
    },

    getLastCreateOptions: () => lastCreateOptions,
  };

  return runtime;
}

// ============================================
// Mock Port Allocator
// ============================================

export interface MockPortAllocator {
  usedPorts: Set<number>;
  nextPort: number;

  allocate: () => Promise<number>;
  isAvailable: (port: number) => Promise<boolean>;
  getUsedPorts: () => Promise<number[]>;
  getAvailableCount: () => Promise<number>;

  reset: () => void;
}

/**
 * Create a mock PortAllocator for unit testing
 */
export function createMockPortAllocator(): MockPortAllocator {
  const usedPorts = new Set<number>();
  let nextPort = 33000;

  return {
    usedPorts,
    nextPort,

    allocate: async () => {
      const port = nextPort++;
      usedPorts.add(port);
      return port;
    },

    isAvailable: async (port: number) => {
      return !usedPorts.has(port);
    },

    getUsedPorts: async () => {
      return Array.from(usedPorts);
    },

    getAvailableCount: async () => {
      return 34000 - 33000 + 1 - usedPorts.size;
    },

    reset: () => {
      usedPorts.clear();
      nextPort = 33000;
    },
  };
}

// ============================================
// Mock Config Manager
// ============================================

export interface MockConfigManager {
  config: Record<string, string>;

  getApiKey: (provider: string) => string | undefined;
  getContainerEnv: () => Record<string, string>;
  getDatabaseUrl: () => string;

  setConfig: (key: string, value: string) => void;
  reset: () => void;
}

/**
 * Create a mock ConfigManager for unit testing
 */
export function createMockConfigManager(): MockConfigManager {
  const config: Record<string, string> = {};

  return {
    config,

    getApiKey: (provider: string) => {
      return config[`${provider}_api_key`];
    },

    getContainerEnv: () => {
      const env: Record<string, string> = {};
      if (config.anthropic_api_key) env.ANTHROPIC_API_KEY = config.anthropic_api_key;
      if (config.openai_api_key) env.OPENAI_API_KEY = config.openai_api_key;
      if (config.openrouter_api_key) env.OPENROUTER_API_KEY = config.openrouter_api_key;
      return env;
    },

    getDatabaseUrl: () => {
      return config.database_url ?? 'postgresql://test:test@localhost:5432/test';
    },

    setConfig: (key: string, value: string) => {
      config[key] = value;
    },

    reset: () => {
      for (const key of Object.keys(config)) {
        delete config[key];
      }
    },
  };
}

// ============================================
// Async Utilities
// ============================================

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

/**
 * Create a deferred promise
 */
export function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}
