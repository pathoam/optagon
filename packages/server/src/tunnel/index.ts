/**
 * Tunnel Module
 *
 * Provides remote access to optagon server via optagon.ai tunnel.
 */

export {
  TunnelClient,
  getTunnelClient,
  createTunnelClient,
  destroyTunnelClient,
  type TunnelClientConfig,
  type TunnelStatus,
} from './client.js';

export {
  TerminalMux,
  getTerminalMux,
  type TerminalSession,
} from './terminal-mux.js';

export * from '@optagon/protocol';
