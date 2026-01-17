/**
 * Tunnel Protocol Types (Client Subset)
 *
 * DUPLICATED FROM: packages/tunnel-server/src/protocol.ts (canonical source)
 *
 * This contains the subset of protocol types needed by the optagon-server
 * tunnel client. Keep in sync with the canonical source.
 *
 * TODO: Replace with import from @optagon/protocol shared package when created.
 */

// ============ Connection Lifecycle ============

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

export interface AuthErrorMessage {
  type: 'auth_error';
  code: 'invalid_token' | 'expired' | 'server_not_found' | 'invalid_signature';
  message: string;
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

// Messages sent from this client to the relay
export type ClientToRelayMessage =
  | SimpleAuthMessage
  | PongMessage
  | FramesSyncMessage
  | TerminalOpenedMessage
  | TerminalDataMessage
  | TerminalCloseMessage
  | TerminalErrorMessage
  | ApiResponseMessage;

// Messages received by this client from the relay
export type RelayToClientMessage =
  | SimpleAuthSuccessMessage
  | AuthErrorMessage
  | PingMessage
  | TerminalOpenMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | ApiRequestMessage;

// ============ Helpers ============

export function encodeTerminalData(data: string | Buffer): string {
  if (Buffer.isBuffer(data)) {
    return data.toString('base64');
  }
  return Buffer.from(data).toString('base64');
}

export function decodeTerminalData(data: string): string {
  return Buffer.from(data, 'base64').toString();
}
