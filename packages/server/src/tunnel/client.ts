/**
 * Tunnel Client
 *
 * Maintains persistent WebSocket connection to optagon.ai tunnel server.
 * Handles authentication, frame sync, terminal multiplexing, and API proxying.
 */

import { EventEmitter } from 'node:events';
import { v4 as uuidv4 } from 'uuid';
import { getFrameManager } from '../services/frame-manager.js';
import { getTerminalMux } from './terminal-mux.js';
import type {
  ClientToRelayMessage,
  RelayToClientMessage,
  FrameSummary,
  TerminalOpenMessage,
  TerminalDataMessage,
  TerminalResizeMessage,
  TerminalCloseMessage,
  ApiRequestMessage,
} from './protocol.js';
import { encodeTerminalData, decodeTerminalData } from './protocol.js';

export interface TunnelClientConfig {
  relayUrl: string;       // e.g., wss://optagon.ai/tunnel
  serverId?: string;      // Existing server ID (from previous registration)
  serverName: string;     // Human-readable name for this server
  onStatusChange?: (status: TunnelStatus) => void;
}

export type TunnelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface TunnelClientEvents {
  status: (status: TunnelStatus) => void;
  error: (error: Error) => void;
  connected: (sessionId: string) => void;
  disconnected: () => void;
}

export class TunnelClient extends EventEmitter {
  private config: TunnelClientConfig;
  private ws: WebSocket | null = null;
  private status: TunnelStatus = 'disconnected';
  private sessionId: string | null = null;
  private serverId: string;

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private frameSyncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: TunnelClientConfig) {
    super();
    this.config = config;
    this.serverId = config.serverId || `srv_${uuidv4().slice(0, 8)}`;

    // Set up terminal mux event handlers
    const terminalMux = getTerminalMux();
    terminalMux.on('data', this.handleTerminalData.bind(this));
    terminalMux.on('exit', this.handleTerminalExit.bind(this));
    terminalMux.on('error', this.handleTerminalError.bind(this));
  }

  /**
   * Connect to the tunnel server
   */
  async connect(): Promise<void> {
    if (this.status === 'connecting' || this.status === 'connected') {
      return;
    }

    this.setStatus('connecting');
    console.log(`[tunnel] Connecting to ${this.config.relayUrl}...`);

    try {
      this.ws = new WebSocket(this.config.relayUrl);

      this.ws.onopen = () => {
        console.log('[tunnel] WebSocket connected, authenticating...');
        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as RelayToClientMessage;
          this.handleMessage(msg);
        } catch (error) {
          console.error('[tunnel] Error parsing message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[tunnel] WebSocket closed: ${event.code} ${event.reason}`);
        this.handleDisconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[tunnel] WebSocket error:', error);
        this.setStatus('error');
        this.emit('error', new Error('WebSocket connection error'));
      };
    } catch (error) {
      console.error('[tunnel] Failed to connect:', error);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the tunnel server
   */
  disconnect(): void {
    console.log('[tunnel] Disconnecting...');

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.frameSyncInterval) {
      clearInterval(this.frameSyncInterval);
      this.frameSyncInterval = null;
    }

    // Close terminal sessions
    getTerminalMux().closeAll();

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setStatus('disconnected');
    this.sessionId = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Get current status
   */
  getStatus(): TunnelStatus {
    return this.status;
  }

  /**
   * Get server ID
   */
  getServerId(): string {
    return this.serverId;
  }

  /**
   * Get session ID (only valid when connected)
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  // ============ Private Methods ============

  private setStatus(status: TunnelStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.emit('status', status);
      this.config.onStatusChange?.(status);
    }
  }

  private authenticate(): void {
    this.send({
      type: 'simple_auth',
      serverId: this.serverId,
      serverName: this.config.serverName,
    });
  }

  private send(message: ClientToRelayMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[tunnel] Error sending message:', error);
      return false;
    }
  }

  private handleMessage(msg: RelayToClientMessage): void {
    switch (msg.type) {
      case 'simple_auth_success':
        this.handleAuthSuccess(msg.sessionId);
        break;

      case 'auth_error':
        console.error(`[tunnel] Auth error: ${msg.code} - ${msg.message}`);
        this.setStatus('error');
        this.disconnect();
        break;

      case 'ping':
        this.send({ type: 'pong', ts: msg.ts });
        break;

      case 'terminal_open':
        this.handleTerminalOpen(msg);
        break;

      case 'terminal_data':
        this.handleTerminalInput(msg);
        break;

      case 'terminal_resize':
        this.handleTerminalResize(msg);
        break;

      case 'terminal_close':
        this.handleTerminalClose(msg);
        break;

      case 'api_request':
        this.handleApiRequest(msg);
        break;

      default:
        console.log(`[tunnel] Unknown message type:`, (msg as any).type);
    }
  }

  private handleAuthSuccess(sessionId: string): void {
    console.log(`[tunnel] Authenticated! Session: ${sessionId}`);
    this.sessionId = sessionId;
    this.reconnectAttempts = 0;
    this.setStatus('connected');
    this.emit('connected', sessionId);

    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.send({ type: 'pong', ts: Date.now() });
    }, 30000);

    // Start frame sync
    this.syncFrames();
    this.frameSyncInterval = setInterval(() => {
      this.syncFrames();
    }, 5000);
  }

  private handleDisconnect(): void {
    const wasConnected = this.status === 'connected';
    this.setStatus('disconnected');
    this.sessionId = null;

    // Clear intervals
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.frameSyncInterval) {
      clearInterval(this.frameSyncInterval);
      this.frameSyncInterval = null;
    }

    // Close terminal sessions
    getTerminalMux().closeAll();

    if (wasConnected) {
      this.emit('disconnected');
    }

    // Schedule reconnect
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[tunnel] Max reconnect attempts reached. Giving up.');
      this.setStatus('error');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[tunnel] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  // ============ Frame Sync ============

  private async syncFrames(): Promise<void> {
    const frameManager = getFrameManager();
    const frames = await frameManager.listFrames();

    const summaries: FrameSummary[] = frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      status: frame.status === 'running' ? 'running' :
              frame.status === 'error' ? 'error' : 'stopped',
      workspace: frame.workspacePath,
      ports: frame.hostPort ? [frame.hostPort] : [],
      createdAt: frame.createdAt.toISOString(),
      lastActivity: frame.lastActiveAt?.toISOString(),
    }));

    this.send({
      type: 'frames_sync',
      frames: summaries,
    });
  }

  // ============ Terminal Handling ============

  private async handleTerminalOpen(msg: TerminalOpenMessage): Promise<void> {
    const frameManager = getFrameManager();
    const terminalMux = getTerminalMux();

    const frame = await frameManager.getFrame(msg.frameId);

    if (!frame) {
      this.send({
        type: 'terminal_error',
        channelId: msg.channelId,
        code: 'frame_not_found',
        message: `Frame not found: ${msg.frameId}`,
      });
      return;
    }

    if (frame.status !== 'running') {
      this.send({
        type: 'terminal_error',
        channelId: msg.channelId,
        code: 'frame_not_running',
        message: `Frame '${frame.name}' is not running`,
      });
      return;
    }

    try {
      const session = await terminalMux.openTerminal(
        msg.channelId,
        frame.id,
        80,
        24
      );

      this.send({
        type: 'terminal_opened',
        channelId: msg.channelId,
        cols: session.cols,
        rows: session.rows,
      });

      console.log(`[tunnel] Terminal opened for frame '${frame.name}' (channel: ${msg.channelId})`);
    } catch (error) {
      console.error(`[tunnel] Failed to open terminal:`, error);
      this.send({
        type: 'terminal_error',
        channelId: msg.channelId,
        code: 'attach_failed',
        message: error instanceof Error ? error.message : 'Failed to attach to terminal',
      });
    }
  }

  private handleTerminalInput(msg: TerminalDataMessage): void {
    const terminalMux = getTerminalMux();
    const data = decodeTerminalData(msg.data);
    terminalMux.writeToTerminal(msg.channelId, data);
  }

  private handleTerminalResize(msg: TerminalResizeMessage): void {
    const terminalMux = getTerminalMux();
    terminalMux.resizeTerminal(msg.channelId, msg.cols, msg.rows);
  }

  private handleTerminalClose(msg: TerminalCloseMessage): void {
    const terminalMux = getTerminalMux();
    terminalMux.closeTerminal(msg.channelId);
    console.log(`[tunnel] Terminal closed (channel: ${msg.channelId})`);
  }

  // Terminal mux event handlers
  private handleTerminalData(channelId: string, data: Buffer): void {
    this.send({
      type: 'terminal_data',
      channelId,
      data: encodeTerminalData(data),
    });
  }

  private handleTerminalExit(channelId: string, code: number | null): void {
    console.log(`[tunnel] Terminal exited (channel: ${channelId}, code: ${code})`);
    this.send({
      type: 'terminal_close',
      channelId,
    });
  }

  private handleTerminalError(channelId: string, error: Error): void {
    console.error(`[tunnel] Terminal error (channel: ${channelId}):`, error);
    this.send({
      type: 'terminal_error',
      channelId,
      code: 'attach_failed',
      message: error.message,
    });
  }

  // ============ API Handling ============

  private async handleApiRequest(msg: ApiRequestMessage): Promise<void> {
    // TODO: Implement API routing
    // For now, return a simple response
    const frameManager = getFrameManager();

    try {
      let response: any;

      if (msg.path === '/frames' && msg.method === 'GET') {
        response = await frameManager.listFrames();
      } else if (msg.path.startsWith('/frames/') && msg.method === 'GET') {
        const frameId = msg.path.split('/')[2];
        response = await frameManager.getFrame(frameId);
        if (!response) {
          this.send({
            type: 'api_response',
            reqId: msg.reqId,
            status: 404,
            body: JSON.stringify({ error: 'Frame not found' }),
          });
          return;
        }
      } else {
        this.send({
          type: 'api_response',
          reqId: msg.reqId,
          status: 404,
          body: JSON.stringify({ error: 'Not found' }),
        });
        return;
      }

      this.send({
        type: 'api_response',
        reqId: msg.reqId,
        status: 200,
        body: JSON.stringify(response),
      });
    } catch (error) {
      this.send({
        type: 'api_response',
        reqId: msg.reqId,
        status: 500,
        body: JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal error',
        }),
      });
    }
  }
}

// ============ Singleton & Factory ============

let tunnelClient: TunnelClient | null = null;

export function getTunnelClient(): TunnelClient | null {
  return tunnelClient;
}

export function createTunnelClient(config: TunnelClientConfig): TunnelClient {
  if (tunnelClient) {
    tunnelClient.disconnect();
  }
  tunnelClient = new TunnelClient(config);
  return tunnelClient;
}

export function destroyTunnelClient(): void {
  if (tunnelClient) {
    tunnelClient.disconnect();
    tunnelClient = null;
  }
}
