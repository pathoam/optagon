/**
 * Tunnel Protocol Types
 *
 * These types define the WebSocket message format between:
 * - Optagon servers (tunnel clients) running at user's home
 * - Tunnel relay server running at optagon.ai
 * - PWA clients connecting through the relay
 */

// ============ Connection Lifecycle ============

export interface AuthMessage {
  type: 'auth';
  serverId: string;
  timestamp: number;
  signature: string; // sign(privateKey, `${serverId}:${timestamp}`)
}

export interface AuthSuccessMessage {
  type: 'auth_success';
  serverId: string;
  sessionId: string;
}

export interface AuthErrorMessage {
  type: 'auth_error';
  code: 'invalid_token' | 'expired' | 'server_not_found' | 'invalid_signature';
  message: string;
}

// Simplified auth for Phase 1 (no Clerk yet)
export interface SimpleAuthMessage {
  type: 'simple_auth';
  serverId: string;
  serverName: string;
}

export interface SimpleAuthSuccessMessage {
  type: 'simple_auth_success';
  serverId: string;
  sessionId: string;
}

// ============ Heartbeat ============

export interface PingMessage {
  type: 'ping';
  ts: number;
}

export interface PongMessage {
  type: 'pong';
  ts: number;
}

// ============ Dev Servers ============

export interface DevServerSummary {
  serverId: string;
  serverName: string;
  connected: boolean;
  frameCount: number;
  connectedAt?: string;
}

export interface ServersSyncMessage {
  type: 'servers_sync';
  servers: DevServerSummary[];
}

// ============ Frames Sync ============

export interface FramesSyncMessage {
  type: 'frames_sync';
  frames: FrameSummary[];
}

export interface FrameSummary {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  workspace: string;
  ports: number[];
  createdAt: string;
  lastActivity?: string;
}

// ============ Terminal Streams ============

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

// ============ Union Types ============

// Messages from optagon-server (tunnel client) to tunnel-server
export type ClientToRelayMessage =
  | AuthMessage
  | SimpleAuthMessage
  | PongMessage
  | FramesSyncMessage
  | TerminalOpenedMessage
  | TerminalDataMessage
  | TerminalCloseMessage
  | TerminalErrorMessage
  | ApiResponseMessage;

// Messages from tunnel-server to optagon-server (tunnel client)
export type RelayToClientMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | SimpleAuthSuccessMessage
  | PingMessage
  | TerminalOpenMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | ApiRequestMessage;

// Messages from PWA to tunnel-server
export type PwaToRelayMessage =
  | { type: 'pwa_auth'; token: string }
  | TerminalOpenMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | ApiRequestMessage;

// Messages from tunnel-server to PWA
export type RelayToPwaMessage =
  | { type: 'pwa_auth_success'; userId: string }
  | { type: 'pwa_auth_error'; message: string }
  | { type: 'server_status'; connected: boolean; serverId?: string }
  | ServersSyncMessage
  | FramesSyncMessage
  | TerminalOpenedMessage
  | TerminalDataMessage
  | TerminalCloseMessage
  | TerminalErrorMessage
  | ApiResponseMessage;

// Generic message type for parsing
export type TunnelMessage =
  | ClientToRelayMessage
  | RelayToClientMessage
  | PwaToRelayMessage
  | RelayToPwaMessage;

// ============ Helpers ============

export function encodeTerminalData(data: string): string {
  return Buffer.from(data).toString('base64');
}

export function decodeTerminalData(data: string): string {
  return Buffer.from(data, 'base64').toString();
}
