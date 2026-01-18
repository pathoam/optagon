export const PROTOCOL_VERSION = '1';

// Terminal error codes used in terminal error messages
export const TERMINAL_ERROR_CODES = {
  FRAME_NOT_FOUND: 'frame_not_found',
  FRAME_NOT_RUNNING: 'frame_not_running',
  ATTACH_FAILED: 'attach_failed',
} as const;

// Default intervals (in ms)
export const DEFAULT_PING_INTERVAL_MS = 30_000;

