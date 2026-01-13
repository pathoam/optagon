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
   */
  async createFrame(input: CreateFrameInput): Promise<Frame> {
    const store = getStateStore();
    const portAllocator = getPortAllocator();

    // Validate workspace path exists
    if (!existsSync(input.workspacePath)) {
      throw new Error(`Workspace path does not exist: ${input.workspacePath}`);
    }

    // Check if frame name is unique
    const existing = store.getFrameByName(input.name);
    if (existing) {
      throw new Error(`Frame with name '${input.name}' already exists`);
    }

    // Generate IDs
    const id = uuidv4();
    const graphitiGroupId = `frame:${id}`;

    // Allocate port
    const hostPort = portAllocator.allocate();

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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    const savedFrame = store.createFrame(frame, input.config);

    // Log event
    store.addFrameEvent(id, 'created', {
      workspacePath: input.workspacePath,
      hostPort,
    });

    return savedFrame;
  }

  /**
   * Start a frame (create and run container)
   */
  async startFrame(nameOrId: string): Promise<Frame> {
    const store = getStateStore();
    const containerRuntime = getContainerRuntime();

    const frame = this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    if (frame.status === 'running') {
      throw new Error(`Frame '${frame.name}' is already running`);
    }

    // Update status to starting
    store.updateFrame(frame.id, { status: 'starting' });

    try {
      // Check if container already exists
      if (frame.containerId) {
        const exists = await containerRuntime.containerExists(frame.containerId);
        if (exists) {
          // Just start existing container
          await containerRuntime.startContainer(frame.containerId);
        } else {
          // Container was removed, create new one
          const containerId = await this.createFrameContainer(frame);
          store.updateFrame(frame.id, { containerId });
        }
      } else {
        // Create new container
        const containerId = await this.createFrameContainer(frame);
        store.updateFrame(frame.id, { containerId });
      }

      // Update status to running
      const updatedFrame = store.updateFrame(frame.id, {
        status: 'running',
        lastActiveAt: new Date(),
      });

      // Log event
      store.addFrameEvent(frame.id, 'started');

      return updatedFrame!;
    } catch (error) {
      // Update status to error
      store.updateFrame(frame.id, { status: 'error' });
      store.addFrameEvent(frame.id, 'error', {
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

    const frame = this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    if (frame.status !== 'running') {
      throw new Error(`Frame '${frame.name}' is not running`);
    }

    // Update status to stopping
    store.updateFrame(frame.id, { status: 'stopping' });

    try {
      if (frame.containerId) {
        await containerRuntime.stopContainer(frame.containerId);
      }

      // Update status to stopped
      const updatedFrame = store.updateFrame(frame.id, { status: 'stopped' });

      // Log event
      store.addFrameEvent(frame.id, 'stopped');

      return updatedFrame!;
    } catch (error) {
      // Update status to error
      store.updateFrame(frame.id, { status: 'error' });
      store.addFrameEvent(frame.id, 'error', {
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

    const frame = this.resolveFrame(nameOrId);
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
    store.addFrameEvent(frame.id, 'destroyed');

    // Delete from database
    store.deleteFrame(frame.id);
  }

  /**
   * Get frame by name or ID
   */
  getFrame(nameOrId: string): Frame | null {
    return this.resolveFrame(nameOrId);
  }

  /**
   * List all frames
   */
  listFrames(status?: FrameStatus): Frame[] {
    const store = getStateStore();
    return store.listFrames(status);
  }

  /**
   * Get frame config
   */
  getFrameConfig(nameOrId: string): FrameConfig | null {
    const frame = this.resolveFrame(nameOrId);
    if (!frame) return null;

    const store = getStateStore();
    return store.getFrameConfig(frame.id);
  }

  /**
   * Update frame config
   */
  updateFrameConfig(nameOrId: string, config: FrameConfig): void {
    const frame = this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const store = getStateStore();
    store.updateFrameConfig(frame.id, config);
    store.addFrameEvent(frame.id, 'config_changed', { config });
  }

  /**
   * Get tmux attach command for a frame
   */
  getTmuxAttachCommand(nameOrId: string): string {
    const frame = this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const tmuxSocket = join(FRAMES_DIR, frame.id, 'tmux.sock');
    return `tmux -S ${tmuxSocket} attach-session -t main`;
  }

  /**
   * Get frame events
   */
  getFrameEvents(nameOrId: string, limit = 50) {
    const frame = this.resolveFrame(nameOrId);
    if (!frame) {
      throw new Error(`Frame not found: ${nameOrId}`);
    }

    const store = getStateStore();
    return store.getFrameEvents(frame.id, limit);
  }

  /**
   * Resolve frame by name or ID
   */
  private resolveFrame(nameOrId: string): Frame | null {
    const store = getStateStore();

    // Try by ID first
    let frame = store.getFrame(nameOrId);
    if (frame) return frame;

    // Try by name
    frame = store.getFrameByName(nameOrId);
    return frame;
  }

  /**
   * Create container for a frame
   */
  private async createFrameContainer(frame: Frame): Promise<string> {
    const containerRuntime = getContainerRuntime();
    const configManager = getConfigManager();

    // Get API keys from config
    const env = configManager.getContainerEnv();

    return containerRuntime.createContainer({
      name: frame.name,
      workspacePath: frame.workspacePath,
      hostPort: frame.hostPort!,
      frameId: frame.id,
      env,
    });
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
