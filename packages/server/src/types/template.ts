/**
 * Frame Template Types
 *
 * Templates define the initial configuration of a frame:
 * - What tmux windows to create
 * - What commands to run in each
 * - Startup injection sequences
 */

/**
 * A window configuration within a template
 */
export interface WindowConfig {
  /** Window name (used as tmux window name) */
  name: string;

  /** Command to run in this window */
  command: string;

  /** Working directory relative to /workspace (optional) */
  cwd?: string;

  /** Lines to inject after command starts (waits for readiness) */
  inject?: string[];

  /** Role identifier for future coordination (e.g., "developer", "reviewer") */
  role?: string;

  /** Briefing text for agent context (injected as initial prompt) */
  briefing?: string;

  /** Environment variables specific to this window */
  env?: Record<string, string>;

  /** Whether to wait for command readiness before injecting (default: true) */
  waitForReady?: boolean;

  /** Timeout in ms to wait for readiness (default: 30000) */
  readyTimeout?: number;
}

/**
 * A frame template definition
 */
export interface FrameTemplate {
  /** Template identifier (filename without .yaml) */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Optional parent template to extend */
  extends?: string;

  /** Windows to create in the tmux session */
  windows: WindowConfig[];

  /** Default environment variables for all windows */
  env?: Record<string, string>;

  /** Services to start (future: docker-compose style sidecars) */
  services?: ServiceConfig[];
}

/**
 * Sidecar service configuration (future use)
 */
export interface ServiceConfig {
  /** Service name */
  name: string;

  /** Command to run */
  command: string;

  /** Restart policy */
  restart?: 'always' | 'on-failure' | 'never';

  /** Health check command */
  healthCheck?: string;
}

/**
 * Validated and resolved template (after inheritance)
 */
export interface ResolvedTemplate extends Omit<FrameTemplate, 'extends'> {
  /** Original template name */
  sourceName: string;

  /** Chain of templates that were merged (if extends was used) */
  inheritanceChain?: string[];
}

/**
 * Template validation result
 */
export interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Window state during frame initialization
 */
export interface WindowState {
  /** Window name */
  name: string;

  /** Tmux window index */
  index: number;

  /** Whether the window is ready for input */
  ready: boolean;

  /** Last activity timestamp */
  lastActivity?: Date;

  /** Current idle duration in ms */
  idleDuration?: number;
}

/**
 * Frame initialization status
 */
export interface FrameInitStatus {
  /** Frame ID */
  frameId: string;

  /** Template used */
  templateName: string;

  /** Window states */
  windows: WindowState[];

  /** Overall initialization complete */
  initialized: boolean;

  /** Errors during initialization */
  errors: string[];
}
