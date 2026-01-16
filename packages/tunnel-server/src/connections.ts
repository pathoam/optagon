/**
 * Connection Manager
 *
 * Tracks connected optagon servers and PWA clients.
 * Routes messages between them.
 */

import type { ServerWebSocket } from 'bun';
import type {
  FrameSummary,
  DevServerSummary,
  RelayToClientMessage,
  RelayToPwaMessage,
} from './protocol';

export interface ServerConnection {
  ws: ServerWebSocket<WebSocketData>;
  serverId: string;
  serverName: string;
  sessionId: string;
  userId?: string;         // Owner's Clerk user ID (when authenticated)
  connectedAt: Date;
  lastPing: Date;
  frames: FrameSummary[];
}

export interface PwaConnection {
  ws: ServerWebSocket<WebSocketData>;
  userId: string;
  sessionId: string;
  connectedAt: Date;
  // Which server this PWA is connected to (for routing)
  targetServerId?: string;
}

export interface WebSocketData {
  type: 'server' | 'pwa';
  sessionId: string;
}

class ConnectionManager {
  // Map serverId -> ServerConnection
  private servers = new Map<string, ServerConnection>();

  // Map sessionId -> PwaConnection
  private pwaClients = new Map<string, PwaConnection>();

  // Map sessionId -> serverId (for server connections)
  private sessionToServer = new Map<string, string>();

  // ============ Server Connections ============

  addServer(
    ws: ServerWebSocket<WebSocketData>,
    serverId: string,
    serverName: string,
    userId?: string
  ): string {
    const sessionId = crypto.randomUUID();

    // Remove existing connection for this server if any
    const existing = this.servers.get(serverId);
    if (existing) {
      console.log(`[connections] Replacing existing connection for server ${serverId}`);
      this.sessionToServer.delete(existing.sessionId);
      try {
        existing.ws.close(1000, 'Replaced by new connection');
      } catch {
        // Ignore close errors
      }
    }

    const connection: ServerConnection = {
      ws,
      serverId,
      serverName,
      sessionId,
      userId,
      connectedAt: new Date(),
      lastPing: new Date(),
      frames: [],
    };

    this.servers.set(serverId, connection);
    this.sessionToServer.set(sessionId, serverId);

    console.log(`[connections] Server connected: ${serverName} (${serverId})${userId ? ` for user ${userId}` : ''}`);

    // Notify connected PWA clients about server status
    this.notifyPwaClientsServerStatus(serverId, true);

    // Auto-assign this server to PWA clients that don't have a target yet
    this.autoAssignServerToPwaClients(serverId, userId);

    return sessionId;
  }

  /**
   * Auto-assign a newly connected server to PWA clients without a target
   */
  private autoAssignServerToPwaClients(serverId: string, serverUserId?: string): void {
    for (const [sessionId, pwa] of this.pwaClients) {
      // Skip if already has a target
      if (pwa.targetServerId) continue;

      // In production, only assign to matching user's PWA
      // If server has no userId (legacy), assign to anyone
      if (!serverUserId || pwa.userId === serverUserId) {
        console.log(`[connections] Auto-assigning server ${serverId} to PWA client ${pwa.userId}`);
        this.setPwaTargetServer(sessionId, serverId);
      }
    }
  }

  /**
   * Get all servers for a specific user
   * Also includes servers without userId (legacy/dev servers)
   */
  getServersByUser(userId: string): ServerConnection[] {
    return Array.from(this.servers.values()).filter(s => !s.userId || s.userId === userId);
  }

  removeServer(sessionId: string): void {
    const serverId = this.sessionToServer.get(sessionId);
    if (!serverId) return;

    const connection = this.servers.get(serverId);
    if (connection && connection.sessionId === sessionId) {
      this.servers.delete(serverId);
      console.log(`[connections] Server disconnected: ${connection.serverName} (${serverId})`);

      // Notify PWA clients
      this.notifyPwaClientsServerStatus(serverId, false);
    }

    this.sessionToServer.delete(sessionId);
  }

  getServer(serverId: string): ServerConnection | undefined {
    return this.servers.get(serverId);
  }

  getServerBySession(sessionId: string): ServerConnection | undefined {
    const serverId = this.sessionToServer.get(sessionId);
    if (!serverId) return undefined;
    return this.servers.get(serverId);
  }

  updateServerFrames(serverId: string, frames: FrameSummary[]): void {
    const connection = this.servers.get(serverId);
    if (connection) {
      connection.frames = frames;

      // Forward to PWA clients targeting this server
      this.forwardToPwaClients(serverId, {
        type: 'frames_sync',
        frames,
      });
    }
  }

  updateServerPing(serverId: string): void {
    const connection = this.servers.get(serverId);
    if (connection) {
      connection.lastPing = new Date();
    }
  }

  sendToServer(serverId: string, message: RelayToClientMessage): boolean {
    const connection = this.servers.get(serverId);
    if (!connection) {
      console.log(`[connections] Cannot send to server ${serverId}: not connected`);
      return false;
    }

    try {
      connection.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[connections] Error sending to server ${serverId}:`, error);
      return false;
    }
  }

  // ============ PWA Connections ============

  addPwaClient(
    ws: ServerWebSocket<WebSocketData>,
    userId: string
  ): string {
    const sessionId = crypto.randomUUID();

    const connection: PwaConnection = {
      ws,
      userId,
      sessionId,
      connectedAt: new Date(),
    };

    this.pwaClients.set(sessionId, connection);

    console.log(`[connections] PWA client connected: ${userId}`);

    return sessionId;
  }

  removePwaClient(sessionId: string): void {
    const connection = this.pwaClients.get(sessionId);
    if (connection) {
      console.log(`[connections] PWA client disconnected: ${connection.userId}`);
      this.pwaClients.delete(sessionId);
    }
  }

  getPwaClient(sessionId: string): PwaConnection | undefined {
    return this.pwaClients.get(sessionId);
  }

  setPwaTargetServer(sessionId: string, serverId: string): void {
    const connection = this.pwaClients.get(sessionId);
    if (connection) {
      connection.targetServerId = serverId;

      // Send current server status and frames
      const server = this.servers.get(serverId);
      this.sendToPwa(sessionId, {
        type: 'server_status',
        connected: !!server,
        serverId,
      });

      if (server) {
        this.sendToPwa(sessionId, {
          type: 'frames_sync',
          frames: server.frames,
        });
      }
    }
  }

  sendToPwa(sessionId: string, message: RelayToPwaMessage): boolean {
    const connection = this.pwaClients.get(sessionId);
    if (!connection) {
      return false;
    }

    try {
      connection.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[connections] Error sending to PWA client:`, error);
      return false;
    }
  }

  forwardToPwaClients(serverId: string, message: RelayToPwaMessage): void {
    for (const [, connection] of this.pwaClients) {
      if (connection.targetServerId === serverId) {
        try {
          connection.ws.send(JSON.stringify(message));
        } catch {
          // Ignore send errors
        }
      }
    }
  }

  private notifyPwaClientsServerStatus(serverId: string, connected: boolean): void {
    this.forwardToPwaClients(serverId, {
      type: 'server_status',
      connected,
      serverId,
    });

    // Also broadcast servers_sync to all PWA clients to update their server lists
    this.broadcastServersSync();
  }

  /**
   * Get servers list for a specific user as DevServerSummary[]
   * Also includes servers without userId (legacy/dev servers visible to all)
   */
  getServersForUser(userId: string): DevServerSummary[] {
    const allServers = Array.from(this.servers.values());

    // Include servers that:
    // 1. Belong to this user (s.userId === userId)
    // 2. Have no userId set (legacy/dev servers - visible to everyone)
    const filtered = allServers.filter(s => !s.userId || s.userId === userId);

    return filtered.map(s => ({
      serverId: s.serverId,
      serverName: s.serverName,
      connected: true,
      frameCount: s.frames.length,
      connectedAt: s.connectedAt.toISOString(),
    }));
  }

  /**
   * Send servers_sync to a specific PWA client
   */
  sendServersSync(sessionId: string): void {
    const pwa = this.pwaClients.get(sessionId);
    if (!pwa) {
      console.log('[connections] sendServersSync: no PWA client for session', sessionId);
      return;
    }

    const servers = this.getServersForUser(pwa.userId);
    console.log(`[connections] sendServersSync to ${pwa.userId}: ${servers.length} servers`, servers.map(s => s.serverName));
    this.sendToPwa(sessionId, {
      type: 'servers_sync',
      servers,
    });
  }

  /**
   * Broadcast servers_sync to all PWA clients
   */
  broadcastServersSync(): void {
    for (const [sessionId, pwa] of this.pwaClients) {
      const servers = this.getServersForUser(pwa.userId);
      this.sendToPwa(sessionId, {
        type: 'servers_sync',
        servers,
      });
    }
  }

  // ============ Stats ============

  getStats() {
    return {
      servers: this.servers.size,
      pwaClients: this.pwaClients.size,
      serverList: Array.from(this.servers.values()).map((s) => ({
        serverId: s.serverId,
        serverName: s.serverName,
        connectedAt: s.connectedAt,
        frameCount: s.frames.length,
      })),
    };
  }
}

// Singleton instance
export const connections = new ConnectionManager();
