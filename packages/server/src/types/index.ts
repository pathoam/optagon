// Frame status types
export type FrameStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

// Core Frame interface
export interface Frame {
  id: string;
  name: string;
  description?: string;
  status: FrameStatus;
  workspacePath: string;
  containerId?: string;
  tmuxSocket?: string;
  graphitiGroupId: string;
  hostPort?: number;
  templateName?: string; // Template used to create this frame
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt?: Date;
}

// Frame configuration stored as JSON
export interface FrameConfig {
  manager?: {
    provider: 'anthropic' | 'openai' | 'ollama' | 'vllm';
    model: string;
    temperature?: number;
    apiKey?: string;
    baseUrl?: string;
  };
  behavior?: {
    autoSpawnAgents?: boolean;
    maxConcurrentAgents?: number;
    qualityGateEnabled?: boolean;
  };
  ports?: {
    dev?: number;      // Development server port inside container
    additional?: number[];
  };
}

// Frame creation input
export interface CreateFrameInput {
  name: string;
  description?: string;
  workspacePath: string;
  config?: FrameConfig;
}

// Frame event types for audit log
export type FrameEventType =
  | 'created'
  | 'started'
  | 'stopped'
  | 'paused'
  | 'resumed'
  | 'error'
  | 'config_changed'
  | 'destroyed';

export interface FrameEvent {
  id: number;
  frameId: string;
  eventType: FrameEventType;
  details?: Record<string, unknown>;
  createdAt: Date;
}

// Container runtime types
export interface ContainerInfo {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'paused' | 'exited';
  ports: { host: number; container: number }[];
}

// Port allocation
export const PORT_RANGE_START = 33000;
export const PORT_RANGE_END = 34000;

// Template types
export * from './template';
