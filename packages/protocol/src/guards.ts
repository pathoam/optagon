import type {
  ClientToRelayMessage,
  RelayToClientMessage,
  PwaToRelayMessage,
  RelayToPwaMessage,
} from './types.js';

function hasType(v: any): v is { type: string } {
  return v && typeof v === 'object' && typeof v.type === 'string';
}

const CLIENT_TO_RELAY_TYPES = new Set([
  'auth', 'simple_auth', 'pong', 'frames_sync',
  'terminal_opened', 'terminal_data', 'terminal_close', 'terminal_error',
  'api_response',
]);

const RELAY_TO_CLIENT_TYPES = new Set([
  'auth_success', 'auth_error', 'simple_auth_success', 'ping',
  'terminal_open', 'terminal_data', 'terminal_resize', 'terminal_close',
  'api_request',
]);

const PWA_TO_RELAY_TYPES = new Set([
  'pwa_auth', 'terminal_open', 'terminal_data', 'terminal_resize', 'terminal_close', 'api_request',
]);

const RELAY_TO_PWA_TYPES = new Set([
  'pwa_auth_success', 'pwa_auth_error', 'server_status', 'servers_sync', 'frames_sync',
  'terminal_opened', 'terminal_data', 'terminal_close', 'terminal_error', 'api_response',
]);

export function isClientToRelayMessage(v: unknown): v is ClientToRelayMessage {
  return hasType(v) && CLIENT_TO_RELAY_TYPES.has(v.type);
}

export function isRelayToClientMessage(v: unknown): v is RelayToClientMessage {
  return hasType(v) && RELAY_TO_CLIENT_TYPES.has(v.type);
}

export function isPwaToRelayMessage(v: unknown): v is PwaToRelayMessage {
  return hasType(v) && PWA_TO_RELAY_TYPES.has(v.type);
}

export function isRelayToPwaMessage(v: unknown): v is RelayToPwaMessage {
  return hasType(v) && RELAY_TO_PWA_TYPES.has(v.type);
}

