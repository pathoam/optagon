import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { getStateStore } from './state-store.js';
import { getPortAllocator } from './port-allocator.js';
import { getContainerRuntime } from './container-runtime.js';
import { getConfigManager } from './config-manager.js';
import type { Frame, CreateFrameInput, FrameConfig, FrameStatus } from '../types/index.js';

const OPTAGON_DIR = join(homedir(), '.optagon');
const FRAMES_DIR = join(OPTAGON_DIR, 'frames');

export class FrameManager {
  /**
   * Create a new frame
   * @param input - Frame creation input
   * @param templateName - Optional template name to apply on start
   */
  async createFrame(input: CreateFrameInput, templateName?: string): Promise<Frame> {
    const store = getStateStore();
    const portAllocator = getPortAllocator();

    // Validate workspace path exists
    if (!existsSync(input.workspacePath)) {
      throw new Error(`Workspace path does not exist: ${input.workspacePath}`);
    }

    // Check if frame name is unique
    const existing = await store.getFrameByName(input.name);
    if (existing) {
      throw new Error(`Frame with name '${input.name}' already exists`);
    }

    // Generate IDs
    const id = uuidv4();
    const graphitiGroupId = `frame:${id}`;

    // Allocate port
    const hostPort = await portAllocator.allocate();

    // Create frame directory
    const frameDir = join(FRAMES_DIR, id);
    mkdirSync(frameDir, { recursive: true });

    // Create frame object
    const frame: Frame = {
      id,
      name: input.name,
      description: input.description,
      status: 'created',
      workspacePath: input.workspacePath,
      graphitiGroupId,
      hostPort,
      templateName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    const savedFrame = await store.createFrame(frame, input.config);

    // Log event
    await store.addFrameEvent(id, 'created', {
      workspacePath: input.workspacePath,
      hostPort,
      templateName,
    });

    return savedFrame;
  }

  /**
   * Start a frame (create and run container)
   */
  async startFrame(nameOrId: string): Promise<Frame> {
    const store = getStateStore();
    const containerRuntime = getContainerRuntime();

    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    if (frame.status === 'running') {
      throw new Error(`Frame '${frame.name}' is already running`);
    }

    // Update status to starting
    await store.updateFrame(frame.id, { status: 'starting' });

    try {
      // Check if container already exists
      if (frame.containerId) {
        const exists = await containerRuntime.containerExists(frame.containerId);
        if (exists) {
          // Just start existing container
          await containerRuntime.startContainer(frame.containerId);
        } else {
          // Container was removed, create new one (or adopt existing)
          const { containerId, hostPort } = await this.createFrameContainer(frame);
          await store.updateFrame(frame.id, { containerId, hostPort });
        }
      } else {
        // Create new container (or adopt existing orphan)
        const { containerId, hostPort } = await this.createFrameContainer(frame);
        await store.updateFrame(frame.id, { containerId, hostPort });
      }

      // Update status to running
      const updatedFrame = await store.updateFrame(frame.id, {
        status: 'running',
        lastActiveAt: new Date(),
      });

      // Log event
      await store.addFrameEvent(frame.id, 'started');

      return updatedFrame!;
    } catch (error) {
      // Update status to error
      await store.updateFrame(frame.id, { status: 'error' });
      await store.addFrameEvent(frame.id, 'error', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Stop a running frame
   */
  async stopFrame(nameOrId: string): Promise<Frame> {
    const store = getStateStore();
    const containerRuntime = getContainerRuntime();

    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    if (frame.status !== 'running') {
      throw new Error(`Frame '${frame.name}' is not running`);
    }

    // Update status to stopping
    await store.updateFrame(frame.id, { status: 'stopping' });

    try {
      if (frame.containerId) {
        await containerRuntime.stopContainer(frame.containerId);
      }

      // Update status to stopped
      const updatedFrame = await store.updateFrame(frame.id, { status: 'stopped' });

      // Log event
      await store.addFrameEvent(frame.id, 'stopped');

      return updatedFrame!;
    } catch (error) {
      // Update status to error
      await store.updateFrame(frame.id, { status: 'error' });
      await store.addFrameEvent(frame.id, 'error', {
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Destroy a frame (remove container and database entry)
   */
  async destroyFrame(nameOrId: string, force = false): Promise<void> {
    const store = getStateStore();
    const containerRuntime = getContainerRuntime();

    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    // Check if running
    if (frame.status === 'running' && !force) {
      throw new Error(`Frame '${frame.name}' is running. Stop it first or use --force`);
    }

    // Remove container if it exists
    if (frame.containerId) {
      try {
        await containerRuntime.removeContainer(frame.containerId, force);
      } catch {
        // Container might not exist, continue anyway
      }
    }

    // Log event before deletion
    await store.addFrameEvent(frame.id, 'destroyed');

    // Delete from database
    await store.deleteFrame(frame.id);
  }

  /**
   * Get frame by name or ID
   */
  async getFrame(nameOrId: string): Promise<Frame | null> {
    return this.resolveFrame(nameOrId);
  }

  /**
   * List all frames
   */
  async listFrames(status?: FrameStatus): Promise<Frame[]> {
    const store = getStateStore();
    return store.listFrames(status);
  }

  /**
   * Get frame config
   */
  async getFrameConfig(nameOrId: string): Promise<FrameConfig | null> {
    const frame = await this.resolveFrame(nameOrId);
    if (!frame) return null;

    const store = getStateStore();
    return store.getFrameConfig(frame.id);
  }

  /**
   * Update frame config
   */
  async updateFrameConfig(nameOrId: string, config: FrameConfig): Promise<void> {
    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const store = getStateStore();
    await store.updateFrameConfig(frame.id, config);
    await store.addFrameEvent(frame.id, 'config_changed', { config });
  }

  /**
   * Get tmux attach command for a frame
   */
  async getTmuxAttachCommand(nameOrId: string): Promise<string> {
    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const tmuxSocket = join(FRAMES_DIR, frame.id, 'tmux.sock');
    return `tmux -S ${tmuxSocket} attach-session -t main`;
  }

  /**
   * Get frame events
   */
  async getFrameEvents(nameOrId: string, limit = 50) {
    const frame = await this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const store = getStateStore();
    return store.getFrameEvents(frame.id, limit);
  }

  /**
   * Resolve frame by name or ID
   */
  private async resolveFrame(nameOrId: string): Promise<Frame | null> {
    const store = getStateStore();

    // Only try by ID if it looks like a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(nameOrId)) {
      const frame = await store.getFrame(nameOrId);
      if (frame) return frame;
    }

    // Try by name
    return store.getFrameByName(nameOrId);
  }

  /**
   * Create container for a frame, or adopt existing one with same name
   * Returns { containerId, hostPort } - hostPort may differ from frame.hostPort if adopting
   */
  private async createFrameContainer(frame: Frame): Promise<{ containerId: string; hostPort: number }> {
    const containerRuntime = getContainerRuntime();
    const configManager = getConfigManager();
    const store = getStateStore();

    // Check if a container with this name already exists (orphaned from DB reset, etc.)
    const existingContainer = await containerRuntime.getContainerByName(frame.name);
    if (existingContainer) {
      console.log(`Adopting existing container for '${frame.name}'`);

      // Start it if it's not running
      if (existingContainer.status !== 'running') {
        await containerRuntime.startContainer(existingContainer.id);
      }

      // Extract the actual host port from the container (port mapped to 3000)
      const devPort = existingContainer.ports.find(p => p.container === 3000);
      const actualHostPort = devPort?.host || frame.hostPort!;

      return { containerId: existingContainer.id, hostPort: actualHostPort };
    }

    // Get frame-specific config
    const frameConfig = await store.getFrameConfig(frame.id);

    // Start with global env from config manager
    const env = configManager.getContainerEnv();

    // Apply manager config to environment variables
    if (frameConfig?.manager) {
      const { provider, model, temperature, apiKey, baseUrl } = frameConfig.manager;

      // Set manager identification
      env.OPTAGON_MANAGER_PROVIDER = provider;
      env.OPTAGON_MANAGER_MODEL = model;

      // Set temperature if provided
      if (temperature !== undefined) {
        env.OPTAGON_MANAGER_TEMPERATURE = String(temperature);
      }

      // Set provider-specific API key (frame config overrides global)
      if (apiKey) {
        switch (provider) {
          case 'anthropic':
            env.ANTHROPIC_API_KEY = apiKey;
            break;
          case 'openai':
            env.OPENAI_API_KEY = apiKey;
            break;
          // ollama and vllm don't use API keys
        }
      }

      // Set base URL for custom endpoints
      if (baseUrl) {
        env.OPTAGON_MANAGER_BASE_URL = baseUrl;
      }
    }

    // Determine container port from config or use default
    const containerPort = frameConfig?.ports?.dev;
    const additionalPorts = frameConfig?.ports?.additional;

    // Create the container with all config applied
    const containerId = await containerRuntime.createContainer({
      name: frame.name,
      workspacePath: frame.workspacePath,
      hostPort: frame.hostPort!,
      containerPort,
      frameId: frame.id,
      env,
      additionalPorts,
    });

    return { containerId, hostPort: frame.hostPort! };
  }
}

// Singleton instance
let frameManager: FrameManager | null = null;

export function getFrameManager(): FrameManager {
  if (!frameManager) {
    frameManager = new FrameManager();
  }
  return frameManager;
}

/**
 * Set the frame manager instance (for testing only)
 * @internal
 */
export function _setFrameManager(manager: FrameManager | null): void {
  frameManager = manager;
}
