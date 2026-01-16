/**
 * Tunnel Server
 *
 * HTTP + WebSocket server for the optagon.ai relay.
 * Uses Bun's native server for simplicity and performance.
 */

import { join } from 'path';
import { connections, type WebSocketData } from './connections';
import {
  verifyClerkToken,
  registerServer,
  getUserServers,
  isClerkConfigured,
  type AuthenticatedUser,
} from './auth';
import type {
  ClientToRelayMessage,
  PwaToRelayMessage,
  TerminalDataMessage,
  TerminalResizeMessage,
  TerminalCloseMessage,
  TerminalOpenMessage,
  ApiRequestMessage,
} from './protocol';

const PORT = parseInt(process.env.PORT || '3000');

// Static file serving for PWA
const STATIC_DIR = join(import.meta.dir, '../../web/dist');

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function serveStatic(pathname: string): Promise<Response | null> {
  try {
    // Default to index.html for root or SPA routes
    let filePath = pathname === '/' ? '/index.html' : pathname;

    // Try to serve the file
    let file = Bun.file(join(STATIC_DIR, filePath));

    if (await file.exists()) {
      return new Response(file, {
        headers: {
          'Content-Type': getMimeType(filePath),
          'Cache-Control': filePath.includes('.') && !filePath.endsWith('.html')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        },
      });
    }

    // For SPA routing: if file doesn't exist and doesn't have extension, serve index.html
    if (!filePath.includes('.') || filePath.endsWith('/')) {
      file = Bun.file(join(STATIC_DIR, 'index.html'));
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-cache',
          },
        });
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Track pending terminal channels: channelId -> { pwaSessionId, serverId }
const terminalChannels = new Map<string, { pwaSessionId: string; serverId: string }>();

// Track pending API requests: reqId -> pwaSessionId
const pendingApiRequests = new Map<string, string>();

// Track pending server registrations: publicKey -> { resolve, reject, timeout }
const pendingRegistrations = new Map<string, {
  resolve: (serverId: string) => void;
  reject: (error: Error) => void;
  userId: string;
  serverName: string;
  timeout: ReturnType<typeof setTimeout>;
}>();

export function startServer() {
  const authEnabled = isClerkConfigured();
  console.log(`[server] Clerk auth: ${authEnabled ? 'enabled' : 'disabled (set CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY)'}`);

  const server = Bun.serve<WebSocketData>({
    port: PORT,

    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS headers for API requests
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      // Handle preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Health check
      if (url.pathname === '/health') {
        return Response.json(
          { status: 'ok', timestamp: new Date().toISOString(), auth: authEnabled },
          { headers: corsHeaders }
        );
      }

      // Public config endpoint - returns publishable keys for client-side use
      if (url.pathname === '/api/config') {
        return Response.json(
          {
            clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || null,
            // Add other public config here as needed
          },
          { headers: corsHeaders }
        );
      }

      // Stats (for debugging)
      if (url.pathname === '/stats') {
        return Response.json(connections.getStats(), { headers: corsHeaders });
      }

      // ============ Auth-Required API Routes ============

      // Server registration - Step 1: Initiate registration
      if (url.pathname === '/api/servers/register' && req.method === 'POST') {
        if (!authEnabled) {
          return Response.json(
            { error: 'Auth not configured' },
            { status: 503, headers: corsHeaders }
          );
        }

        // Verify JWT
        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return Response.json(
            { error: 'Missing authorization' },
            { status: 401, headers: corsHeaders }
          );
        }

        const user = await verifyClerkToken(authHeader.slice(7));
        if (!user) {
          return Response.json(
            { error: 'Invalid token' },
            { status: 401, headers: corsHeaders }
          );
        }

        try {
          const body = await req.json() as { serverName: string; publicKey: string };
          const { serverName, publicKey } = body;

          if (!serverName || !publicKey) {
            return Response.json(
              { error: 'Missing serverName or publicKey' },
              { status: 400, headers: corsHeaders }
            );
          }

          // Register the server
          const server = await registerServer(user.userId, serverName, publicKey);

          return Response.json(
            { serverId: server.id, serverName: server.name },
            { headers: corsHeaders }
          );
        } catch (error) {
          console.error('[api] Registration error:', error);
          return Response.json(
            { error: 'Registration failed' },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // Get user's servers
      if (url.pathname === '/api/servers' && req.method === 'GET') {
        if (!authEnabled) {
          return Response.json(
            { error: 'Auth not configured' },
            { status: 503, headers: corsHeaders }
          );
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return Response.json(
            { error: 'Missing authorization' },
            { status: 401, headers: corsHeaders }
          );
        }

        const user = await verifyClerkToken(authHeader.slice(7));
        if (!user) {
          return Response.json(
            { error: 'Invalid token' },
            { status: 401, headers: corsHeaders }
          );
        }

        // Get registered servers with online status
        const registeredServers = await getUserServers(user.userId);
        const connectedServers = connections.getServersByUser(user.userId);
        const connectedIds = new Set(connectedServers.map(s => s.serverId));

        const servers = registeredServers.map(s => ({
          ...s,
          online: connectedIds.has(s.id),
          frames: connectedServers.find(cs => cs.serverId === s.id)?.frames || [],
        }));

        return Response.json({ servers }, { headers: corsHeaders });
      }

      // Check registration status (for CLI polling)
      if (url.pathname === '/api/setup/status' && req.method === 'GET') {
        const publicKey = url.searchParams.get('pubkey');
        if (!publicKey) {
          return Response.json(
            { error: 'Missing pubkey parameter' },
            { status: 400, headers: corsHeaders }
          );
        }

        const pending = pendingRegistrations.get(publicKey);
        if (pending) {
          return Response.json(
            { status: 'pending' },
            { headers: corsHeaders }
          );
        }

        // Check if already registered (would need to search - not efficient)
        return Response.json(
          { status: 'not_found' },
          { headers: corsHeaders }
        );
      }

      // ============ WebSocket Upgrades ============

      // WebSocket upgrade for optagon servers (tunnel clients)
      if (url.pathname === '/tunnel') {
        const upgraded = server.upgrade(req, {
          data: { type: 'server' as const, sessionId: '' },
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      // WebSocket upgrade for PWA clients
      if (url.pathname === '/ws') {
        const upgraded = server.upgrade(req, {
          data: { type: 'pwa' as const, sessionId: '' },
        });
        if (!upgraded) {
          return new Response('WebSocket upgrade failed', { status: 400 });
        }
        return undefined;
      }

      // Serve PWA static files
      const staticResponse = await serveStatic(url.pathname);
      if (staticResponse) {
        return staticResponse;
      }

      return new Response('Not found', { status: 404 });
    },

    websocket: {
      open(ws) {
        console.log(`[ws] Connection opened: ${ws.data.type}`);
      },

      message(ws, message) {
        try {
          const msg = JSON.parse(message.toString());

          if (ws.data.type === 'server') {
            handleServerMessage(ws, msg);
          } else if (ws.data.type === 'pwa') {
            handlePwaMessage(ws, msg);
          }
        } catch (error) {
          console.error('[ws] Error handling message:', error);
        }
      },

      close(ws) {
        console.log(`[ws] Connection closed: ${ws.data.type}`);

        if (ws.data.type === 'server' && ws.data.sessionId) {
          connections.removeServer(ws.data.sessionId);
        } else if (ws.data.type === 'pwa' && ws.data.sessionId) {
          connections.removePwaClient(ws.data.sessionId);
        }
      },

      error(ws, error) {
        console.error(`[ws] WebSocket error:`, error);
      },
    },
  });

  console.log(`[server] Tunnel server listening on port ${PORT}`);
  console.log(`[server] Health check: http://localhost:${PORT}/health`);
  console.log(`[server] Server tunnel: ws://localhost:${PORT}/tunnel`);
  console.log(`[server] PWA WebSocket: ws://localhost:${PORT}/ws`);

  return server;
}

// ============ Server (Tunnel Client) Message Handling ============

function handleServerMessage(
  ws: import('bun').ServerWebSocket<WebSocketData>,
  msg: ClientToRelayMessage
) {
  switch (msg.type) {
    case 'simple_auth': {
      // Simple auth without Clerk - for development/testing
      // In production, servers should use 'auth' message with signature
      const sessionId = connections.addServer(ws, msg.serverId, msg.serverName);
      ws.data.sessionId = sessionId;

      ws.send(JSON.stringify({
        type: 'simple_auth_success',
        serverId: msg.serverId,
        sessionId,
      }));
      break;
    }

    case 'auth': {
      // Full auth with user association
      // For now, allow connection but mark as belonging to no user
      // In Phase 2b, we'll verify the server's signature against registered public key
      const sessionId = connections.addServer(
        ws,
        msg.serverId,
        msg.serverId, // Use serverId as name for now
        undefined // No user association yet
      );
      ws.data.sessionId = sessionId;

      ws.send(JSON.stringify({
        type: 'auth_success',
        serverId: msg.serverId,
        sessionId,
      }));
      break;
    }

    case 'pong': {
      const server = connections.getServerBySession(ws.data.sessionId);
      if (server) {
        connections.updateServerPing(server.serverId);
      }
      break;
    }

    case 'frames_sync': {
      const server = connections.getServerBySession(ws.data.sessionId);
      if (server) {
        connections.updateServerFrames(server.serverId, msg.frames);
      }
      break;
    }

    case 'terminal_opened': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToPwa(channel.pwaSessionId, msg);
      }
      break;
    }

    case 'terminal_data': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToPwa(channel.pwaSessionId, msg);
      }
      break;
    }

    case 'terminal_close': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToPwa(channel.pwaSessionId, msg);
        terminalChannels.delete(msg.channelId);
      }
      break;
    }

    case 'terminal_error': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToPwa(channel.pwaSessionId, msg);
        terminalChannels.delete(msg.channelId);
      }
      break;
    }

    case 'api_response': {
      const pwaSessionId = pendingApiRequests.get(msg.reqId);
      if (pwaSessionId) {
        connections.sendToPwa(pwaSessionId, msg);
        pendingApiRequests.delete(msg.reqId);
      }
      break;
    }

    default:
      console.log(`[ws] Unknown message type from server:`, (msg as any).type);
  }
}

// ============ PWA Message Handling ============

async function handlePwaMessage(
  ws: import('bun').ServerWebSocket<WebSocketData>,
  msg: PwaToRelayMessage
) {
  switch (msg.type) {
    case 'pwa_auth': {
      const authEnabled = isClerkConfigured();

      if (authEnabled) {
        // Verify JWT with Clerk
        const user = await verifyClerkToken(msg.token);

        if (!user) {
          ws.send(JSON.stringify({
            type: 'pwa_auth_error',
            message: 'Invalid or expired token',
          }));
          return;
        }

        const sessionId = connections.addPwaClient(ws, user.userId);
        ws.data.sessionId = sessionId;

        ws.send(JSON.stringify({
          type: 'pwa_auth_success',
          userId: user.userId,
        }));

        // Send servers list to PWA
        connections.sendServersSync(sessionId);

        // Connect to user's first online server
        const userServers = connections.getServersByUser(user.userId);
        if (userServers.length > 0) {
          connections.setPwaTargetServer(sessionId, userServers[0].serverId);
        } else {
          // No servers online - send status
          ws.send(JSON.stringify({
            type: 'server_status',
            connected: false,
          }));
        }
      } else {
        // Development mode - accept any token
        const sessionId = connections.addPwaClient(ws, msg.token);
        ws.data.sessionId = sessionId;

        ws.send(JSON.stringify({
          type: 'pwa_auth_success',
          userId: msg.token,
        }));

        // Send servers list to PWA
        connections.sendServersSync(sessionId);

        // Connect to first available server
        const stats = connections.getStats();
        if (stats.serverList.length > 0) {
          connections.setPwaTargetServer(sessionId, stats.serverList[0].serverId);
        }
      }
      break;
    }

    case 'terminal_open': {
      const pwa = connections.getPwaClient(ws.data.sessionId);
      if (!pwa || !pwa.targetServerId) {
        ws.send(JSON.stringify({
          type: 'terminal_error',
          channelId: msg.channelId,
          code: 'frame_not_found',
          message: 'No server connected',
        }));
        return;
      }

      terminalChannels.set(msg.channelId, {
        pwaSessionId: ws.data.sessionId,
        serverId: pwa.targetServerId,
      });

      connections.sendToServer(pwa.targetServerId, msg as TerminalOpenMessage);
      break;
    }

    case 'terminal_data': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToServer(channel.serverId, msg as TerminalDataMessage);
      }
      break;
    }

    case 'terminal_resize': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToServer(channel.serverId, msg as TerminalResizeMessage);
      }
      break;
    }

    case 'terminal_close': {
      const channel = terminalChannels.get(msg.channelId);
      if (channel) {
        connections.sendToServer(channel.serverId, msg as TerminalCloseMessage);
        terminalChannels.delete(msg.channelId);
      }
      break;
    }

    case 'api_request': {
      const pwa = connections.getPwaClient(ws.data.sessionId);
      if (!pwa || !pwa.targetServerId) {
        ws.send(JSON.stringify({
          type: 'api_response',
          reqId: msg.reqId,
          status: 503,
          body: JSON.stringify({ error: 'No server connected' }),
        }));
        return;
      }

      pendingApiRequests.set(msg.reqId, ws.data.sessionId);
      connections.sendToServer(pwa.targetServerId, msg as ApiRequestMessage);
      break;
    }

    default:
      console.log(`[ws] Unknown message type from PWA:`, (msg as any).type);
  }
}
