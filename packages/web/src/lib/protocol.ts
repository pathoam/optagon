/**
 * Protocol types for PWA ↔ Tunnel Server communication
 *
 * These match the types in packages/tunnel-server/src/protocol.ts
 */

// ============ Frames ============

export interface FrameSummary {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  workspace: string;
  ports: number[];
  createdAt: string;
  lastActivity?: string;
}

// ============ Terminal ============

export interface TerminalOpenMessage {
  type: 'terminal_open';
  channelId: string;
  frameId: string;
}

export interface TerminalOpenedMessage {
  type: 'terminal_opened';
  channelId: string;
  cols: number;
  rows: number;
}

export interface TerminalDataMessage {
  type: 'terminal_data';
  channelId: string;
  data: string; // Base64 encoded
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  channelId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseMessage {
  type: 'terminal_close';
  channelId: string;
}

export interface TerminalErrorMessage {
  type: 'terminal_error';
  channelId: string;
  code: 'frame_not_found' | 'frame_not_running' | 'attach_failed';
  message: string;
}

// ============ API Proxy ============

export interface ApiRequestMessage {
  type: 'api_request';
  reqId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ApiResponseMessage {
  type: 'api_response';
  reqId: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

// ============ PWA Messages ============

export type PwaToRelayMessage =
  | { type: 'pwa_auth'; token: string }
  | TerminalOpenMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | ApiRequestMessage;

export type RelayToPwaMessage =
  | { type: 'pwa_auth_success'; userId: string }
  | { type: 'pwa_auth_error'; message: string }
  | { type: 'server_status'; connected: boolean; serverId?: string }
  | { type: 'frames_sync'; frames: FrameSummary[] }
  | TerminalOpenedMessage
  | TerminalDataMessage
  | TerminalCloseMessage
  | TerminalErrorMessage
  | ApiResponseMessage;

// ============ Helpers ============

export function encodeData(data: string): string {
  return btoa(data);
}

export function decodeData(data: string): string {
  return atob(data);
}
