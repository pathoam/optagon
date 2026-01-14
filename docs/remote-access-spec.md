# Optagon Remote Access - Architecture Specification

> Draft v1 - January 2026

## Overview

Remote access enables using Optagon from anywhere - phone, laptop, any device with a browser. This spec covers the complete system:

1. **Tunnel** - Persistent connection from home server to optagon.ai
2. **Auth** - User accounts and device management via Clerk
3. **PWA** - Installable web app for frame management and terminal access

**Goal**: Use Optagon on vacation from your phone, with the same experience as sitting at your home server.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              optagon.ai                                      │
│                                                                              │
│  ┌──────────────┐  ┌──────────────────────┐  ┌─────────────────────────┐   │
│  │  Cloudflare  │  │     VPS Server       │  │        Clerk            │   │
│  │  (CDN/DDoS)  │──│  (tunnel-server)     │  │    (Auth Service)       │   │
│  └──────────────┘  │                      │  └─────────────────────────┘   │
│                    │  - WebSocket relay   │                                 │
│                    │  - User sessions     │                                 │
│                    │  - PWA static files  │                                 │
│                    └──────────┬───────────┘                                 │
└───────────────────────────────┼─────────────────────────────────────────────┘
                                │
              Multiplexed WebSocket (outbound from home)
                                │
┌───────────────────────────────┼─────────────────────────────────────────────┐
│                               ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    User's Optagon Server                             │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐                │   │
│  │  │Tunnel Client │  │ Frame Mgr   │  │Terminal Mux │                │   │
│  │  │(in @optagon/ │  │             │  │             │                │   │
│  │  │   server)    │  │             │  │             │                │   │
│  │  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘                │   │
│  │         │                 │                │                        │   │
│  │         └─────────────────┼────────────────┘                        │   │
│  │                           ▼                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │   │
│  │  │ Frame A  │  │ Frame B  │  │ Frame C  │  │ Frame D  │            │   │
│  │  │  (tmux)  │  │  (tmux)  │  │  (tmux)  │  │  (tmux)  │            │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                         User's Home Server                                   │
└─────────────────────────────────────────────────────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                            User's Devices                                    │
│                                                                              │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│   │   Phone     │    │   Laptop    │    │   Tablet    │                    │
│   │   (PWA)     │    │  (Browser)  │    │   (PWA)     │                    │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                    │
│          │                  │                  │                            │
│          └──────────────────┼──────────────────┘                            │
│                             │                                                │
│                    Standard HTTPS/WSS                                        │
│                    to optagon.ai                                             │
└─────────────────────────────┼───────────────────────────────────────────────┘
                              │
                              ▼
                        optagon.ai
```

---

## Phase 1: Tunnel Foundation

### Goal

Establish persistent connection from home server to optagon.ai. Test with curl/scripts before building PWA.

### Infrastructure

```
┌─────────────────────────────────────────────────────────────────┐
│  optagon.ai DNS (Cloudflare)                                    │
│  ├── A record → VPS IP                                          │
│  └── Proxy enabled (orange cloud) for DDoS protection          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  VPS (Hetzner/DigitalOcean ~$5/mo)                             │
│  ├── OS: Ubuntu 24.04                                           │
│  ├── Runtime: Bun                                               │
│  ├── Process: tunnel-server                                     │
│  ├── Ports: 443 (HTTPS/WSS via Cloudflare)                     │
│  └── TLS: Cloudflare origin certificate                        │
└─────────────────────────────────────────────────────────────────┘
```

### Package Structure

```
packages/
├── server/              # Existing + tunnel client addition
│   └── src/
│       └── tunnel/
│           ├── client.ts       # WebSocket connection to optagon.ai
│           ├── protocol.ts     # Message types
│           └── terminal-mux.ts # Terminal stream multiplexing
│
└── tunnel-server/       # NEW - runs on optagon.ai VPS
    ├── package.json
    ├── src/
    │   ├── index.ts          # Entry point
    │   ├── server.ts         # HTTP/WebSocket server
    │   ├── connections.ts    # Manage user connections
    │   ├── protocol.ts       # Shared with client
    │   └── relay.ts          # Request/response relay logic
    └── Dockerfile
```

### Tunnel Protocol (Unified)

Single WebSocket, multiple logical channels:

```typescript
// packages/tunnel-server/src/protocol.ts
// (shared with packages/server/src/tunnel/protocol.ts)

// ============ Connection Lifecycle ============

interface AuthMessage {
  type: 'auth';
  token: string;        // JWT from Clerk
  serverKey: string;    // Server's public key (Ed25519)
  serverId?: string;    // If previously registered
}

interface AuthSuccessMessage {
  type: 'auth_success';
  serverId: string;
  sessionId: string;
}

interface AuthErrorMessage {
  type: 'auth_error';
  code: 'invalid_token' | 'expired' | 'server_mismatch';
  message: string;
}

// ============ Heartbeat ============

interface PingMessage {
  type: 'ping';
  ts: number;
}

interface PongMessage {
  type: 'pong';
  ts: number;
}

// ============ Frames Sync ============

interface FramesSyncMessage {
  type: 'frames_sync';
  frames: FrameSummary[];
}

interface FrameSummary {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  workspace: string;
  ports: number[];
  createdAt: string;
  lastActivity?: string;
}

// ============ Terminal Streams ============

interface TerminalOpenMessage {
  type: 'terminal_open';
  channelId: string;    // Unique ID for this terminal session
  frameId: string;      // Which frame to attach to
}

interface TerminalOpenedMessage {
  type: 'terminal_opened';
  channelId: string;
  cols: number;
  rows: number;
}

interface TerminalDataMessage {
  type: 'terminal_data';
  channelId: string;
  data: string;         // Base64 encoded
}

interface TerminalResizeMessage {
  type: 'terminal_resize';
  channelId: string;
  cols: number;
  rows: number;
}

interface TerminalCloseMessage {
  type: 'terminal_close';
  channelId: string;
}

interface TerminalErrorMessage {
  type: 'terminal_error';
  channelId: string;
  code: 'frame_not_found' | 'frame_not_running' | 'attach_failed';
  message: string;
}

// ============ API Proxy ============

interface ApiRequestMessage {
  type: 'api_request';
  reqId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers?: Record<string, string>;
  body?: string;        // JSON string
}

interface ApiResponseMessage {
  type: 'api_response';
  reqId: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;        // JSON string
}

// ============ Frame Dev Server (Future) ============

interface HttpRequestMessage {
  type: 'http_request';
  channelId: string;
  frameId: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponseMessage {
  type: 'http_response';
  channelId: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  done: boolean;
}

// ============ Union Type ============

type ClientToServerMessage =
  | AuthMessage
  | PongMessage
  | FramesSyncMessage
  | TerminalOpenedMessage
  | TerminalDataMessage
  | TerminalCloseMessage
  | TerminalErrorMessage
  | ApiResponseMessage
  | HttpResponseMessage;

type ServerToClientMessage =
  | AuthSuccessMessage
  | AuthErrorMessage
  | PingMessage
  | TerminalOpenMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | ApiRequestMessage
  | HttpRequestMessage;
```

### Tunnel Client (in @optagon/server)

```typescript
// packages/server/src/tunnel/client.ts

import { EventEmitter } from 'events';

interface TunnelClientConfig {
  relayUrl: string;           // wss://optagon.ai/tunnel
  authToken: string;          // JWT from Clerk (obtained during setup)
  serverKeyPath: string;      // Path to Ed25519 private key
  onTerminalOpen: (channelId: string, frameId: string) => Promise<TerminalSession>;
  onApiRequest: (req: ApiRequest) => Promise<ApiResponse>;
}

class TunnelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  async connect(): Promise<void>;
  async disconnect(): Promise<void>;

  // Called by local code to push updates
  syncFrames(frames: FrameSummary[]): void;

  // Internal handlers
  private handleMessage(msg: ServerToClientMessage): void;
  private handleTerminalOpen(msg: TerminalOpenMessage): void;
  private handleApiRequest(msg: ApiRequestMessage): void;
  private reconnect(): void;
}
```

### Tunnel Server (on VPS)

```typescript
// packages/tunnel-server/src/server.ts

import { Hono } from 'hono';

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// WebSocket endpoint for optagon servers
app.get('/tunnel', upgradeWebSocket((c) => ({
  onOpen(ws) { /* auth handshake */ },
  onMessage(ws, msg) { /* route messages */ },
  onClose(ws) { /* cleanup */ },
})));

// PWA routes
app.get('/*', serveStatic({ root: './public' }));

export default app;
```

### Testing Phase 1

Before building PWA, test with scripts:

```bash
# 1. Start tunnel-server on VPS
ssh vps "cd /opt/optagon && bun run packages/tunnel-server/src/index.ts"

# 2. Start optagon server with tunnel client
optagon config set tunnel.enabled true
optagon config set tunnel.relay wss://optagon.ai/tunnel

# 3. Test connection
curl https://optagon.ai/health
# → { "status": "ok" }

# 4. Test API proxy (once connected)
# The PWA would do this, but we can test with curl + auth header
curl -H "Authorization: Bearer <token>" https://optagon.ai/api/frames
# → [{ "id": "...", "name": "my-frame", "status": "running" }]

# 5. Test terminal (wscat or similar)
wscat -c "wss://optagon.ai/terminal?frame=my-frame&token=<token>"
# → Should receive terminal output
```

### Deliverables

- [ ] `packages/tunnel-server/` - New package
  - [ ] HTTP server with health endpoint
  - [ ] WebSocket handler for tunnel connections
  - [ ] Connection management (map serverId → WebSocket)
  - [ ] Message routing
  - [ ] Dockerfile for deployment
- [ ] `packages/server/src/tunnel/` - Tunnel client
  - [ ] WebSocket connection with auto-reconnect
  - [ ] Auth handshake
  - [ ] Terminal multiplexing
  - [ ] API request handling
  - [ ] Frame sync
- [ ] CLI commands
  - [ ] `optagon tunnel setup` - Initial registration
  - [ ] `optagon tunnel status` - Show connection status
  - [ ] `optagon tunnel enable/disable` - Toggle tunnel
- [ ] VPS setup
  - [ ] Provision server (Hetzner/DO)
  - [ ] Install Bun
  - [ ] Cloudflare DNS + proxy
  - [ ] Origin certificate
  - [ ] Deploy tunnel-server

---

## Phase 2: Authentication

### Goal

Secure the tunnel with user accounts. Use Clerk for authentication, WebAuthn for passwordless login.

### Clerk Setup

```
Clerk Application: "Optagon"
├── Sign-in methods
│   ├── Email + password
│   ├── Google OAuth
│   ├── GitHub OAuth
│   └── Passkeys (WebAuthn)
│
├── JWT Templates
│   └── "optagon-tunnel"
│       {
│         "userId": "{{user.id}}",
│         "email": "{{user.email_addresses[0].email_address}}",
│         "servers": "{{user.public_metadata.servers}}"
│       }
│
└── Webhooks
    └── user.created → optagon.ai/webhooks/clerk
```

### Auth Flow: Server Registration

```
┌─────────────────────────────────────────────────────────────────┐
│  First-time setup: optagon tunnel setup                         │
└─────────────────────────────────────────────────────────────────┘

1. User runs: optagon tunnel setup

2. CLI generates Ed25519 keypair, saves to ~/.optagon/tunnel.json:
   {
     "privateKey": "...",
     "publicKey": "..."
   }

3. CLI opens browser: https://optagon.ai/setup?pubkey=<base64>

4. User logs in (Clerk) or creates account

5. optagon.ai validates pubkey, generates server ID, stores:
   User.publicMetadata.servers.push({
     id: "srv_abc123",
     name: "home-server",
     publicKey: "<base64>",
     registeredAt: "2026-01-13T..."
   })

6. Browser shows: "Server registered! You can close this window."

7. CLI polls optagon.ai/api/setup/status?pubkey=<base64>
   Returns: { serverId: "srv_abc123" }

8. CLI saves to ~/.optagon/tunnel.json:
   {
     "privateKey": "...",
     "publicKey": "...",
     "serverId": "srv_abc123"
   }

9. Done! Tunnel can now connect.
```

### Auth Flow: Tunnel Connection

```
┌─────────────────────────────────────────────────────────────────┐
│  Tunnel connection handshake                                     │
└─────────────────────────────────────────────────────────────────┘

1. Optagon server connects: wss://optagon.ai/tunnel

2. Server sends auth message:
   {
     type: "auth",
     serverId: "srv_abc123",
     timestamp: 1704067200,
     signature: sign(privateKey, "srv_abc123:1704067200")
   }

3. Tunnel-server validates:
   - Look up server by ID
   - Verify signature with stored public key
   - Check timestamp freshness (< 5 min)

4. Success → auth_success message, connection established
   Failure → auth_error message, connection closed
```

### Auth Flow: PWA Login

```
┌─────────────────────────────────────────────────────────────────┐
│  PWA authentication                                              │
└─────────────────────────────────────────────────────────────────┘

1. User visits optagon.ai

2. Clerk <SignIn /> component handles login
   - Email/password, OAuth, or Passkey

3. On success, Clerk provides session + JWT

4. PWA stores JWT, includes in API/WebSocket requests

5. Tunnel-server validates JWT with Clerk's public key

6. JWT contains userId, used to route to correct server
```

### Device Management

```typescript
// Stored in Clerk user metadata
interface UserMetadata {
  servers: {
    id: string;
    name: string;
    publicKey: string;
    registeredAt: string;
    lastSeen?: string;
  }[];

  // Clerk handles device/session management automatically
  // We just need to track which servers belong to which user
}
```

### Deliverables

- [ ] Clerk setup
  - [ ] Create Clerk application
  - [ ] Configure sign-in methods (email, Google, GitHub, passkeys)
  - [ ] Create JWT template for tunnel auth
  - [ ] Configure webhook for user events (optional)
- [ ] Server registration flow
  - [ ] `optagon tunnel setup` opens browser
  - [ ] optagon.ai/setup page for server registration
  - [ ] API endpoint to store server in user metadata
  - [ ] CLI polling for registration completion
- [ ] Tunnel auth
  - [ ] Signature-based auth for server connections
  - [ ] JWT validation for PWA requests
  - [ ] Route requests to correct user's server
- [ ] PWA auth integration
  - [ ] Clerk React components
  - [ ] Protected routes
  - [ ] JWT in WebSocket handshake

---

## Phase 3: PWA

### Goal

Installable web app for frame management and terminal access from any device.

### Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | Solid.js | Small, fast, reactive signals |
| Terminal | xterm.js | Industry standard, WebGL renderer |
| Styling | Tailwind CSS | Rapid iteration, good mobile |
| Build | Vite | Fast, PWA plugin |
| Auth | Clerk | Already using for tunnel auth |

### Package Structure

```
packages/web/
├── package.json
├── vite.config.ts
├── index.html
├── public/
│   ├── manifest.json      # PWA manifest
│   ├── icon-192.png
│   ├── icon-512.png
│   └── sw.js              # Service worker
├── src/
│   ├── index.tsx          # Entry point
│   ├── App.tsx            # Root component
│   ├── routes/
│   │   ├── index.tsx      # Frame list (home)
│   │   ├── frame/[id].tsx # Terminal view
│   │   └── settings.tsx   # User settings
│   ├── components/
│   │   ├── FrameList.tsx
│   │   ├── FrameCard.tsx
│   │   ├── Terminal.tsx
│   │   ├── Header.tsx
│   │   └── MobileNav.tsx
│   ├── lib/
│   │   ├── api.ts         # API client
│   │   ├── tunnel.ts      # WebSocket connection
│   │   └── terminal.ts    # xterm.js wrapper
│   └── stores/
│       ├── auth.ts        # Clerk state
│       ├── frames.ts      # Frame list
│       └── connection.ts  # Tunnel status
└── tailwind.config.js
```

### UI Design

#### Mobile Layout (Primary)

```
┌─────────────────────────────────────┐
│  ≡  Optagon              ● Online   │  ← Header: menu, status
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ● my-app                    │   │  ← Frame cards
│  │   ~/projects/my-app         │   │
│  │   Running • 3 ports         │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ● client-demo               │   │
│  │   ~/work/client-demo        │   │
│  │   Running • 1 port          │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ○ old-project               │   │
│  │   ~/archive/old             │   │
│  │   Stopped                   │   │
│  └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│  [+ New Frame]                      │  ← Action button
└─────────────────────────────────────┘
```

#### Terminal View (Tap on frame)

```
┌─────────────────────────────────────┐
│  ←  my-app              ⚙ ■ □      │  ← Back, settings, stop/start
├─────────────────────────────────────┤
│                                     │
│  $ npm run dev                      │
│  > my-app@1.0.0 dev                 │
│  > vite                             │
│                                     │
│  VITE v5.0.0  ready in 234ms        │
│                                     │
│  ➜  Local:   http://localhost:3000  │
│  ➜  Network: http://192.168.1.5:... │
│                                     │
│  $                                  │
│                                     │
│                                     │
├─────────────────────────────────────┤
│  [────────────────────────] [Send]  │  ← Mobile keyboard input
└─────────────────────────────────────┘
```

#### Swipe Navigation

```
← Swipe left: Previous frame terminal
→ Swipe right: Next frame terminal
↓ Swipe down from top: Frame list overlay
```

### PWA Manifest

```json
{
  "name": "Optagon",
  "short_name": "Optagon",
  "description": "Remote access to your development frames",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### WebSocket Connection

```typescript
// packages/web/src/lib/tunnel.ts

import { createSignal, createEffect } from 'solid-js';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function createTunnelConnection(getToken: () => string) {
  const [status, setStatus] = createSignal<ConnectionStatus>('disconnected');
  const [frames, setFrames] = createSignal<FrameSummary[]>([]);

  let ws: WebSocket | null = null;
  const terminalHandlers = new Map<string, (data: string) => void>();

  function connect() {
    setStatus('connecting');
    ws = new WebSocket(`wss://optagon.ai/ws?token=${getToken()}`);

    ws.onopen = () => setStatus('connected');
    ws.onclose = () => {
      setStatus('disconnected');
      setTimeout(connect, 3000); // Auto-reconnect
    };
    ws.onerror = () => setStatus('error');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };
  }

  function handleMessage(msg: ServerToClientMessage) {
    switch (msg.type) {
      case 'frames_sync':
        setFrames(msg.frames);
        break;
      case 'terminal_data':
        terminalHandlers.get(msg.channelId)?.(atob(msg.data));
        break;
      // ... other handlers
    }
  }

  function openTerminal(frameId: string, onData: (data: string) => void) {
    const channelId = crypto.randomUUID();
    terminalHandlers.set(channelId, onData);

    ws?.send(JSON.stringify({
      type: 'terminal_open',
      channelId,
      frameId,
    }));

    return {
      write: (data: string) => {
        ws?.send(JSON.stringify({
          type: 'terminal_data',
          channelId,
          data: btoa(data),
        }));
      },
      resize: (cols: number, rows: number) => {
        ws?.send(JSON.stringify({
          type: 'terminal_resize',
          channelId,
          cols,
          rows,
        }));
      },
      close: () => {
        terminalHandlers.delete(channelId);
        ws?.send(JSON.stringify({
          type: 'terminal_close',
          channelId,
        }));
      },
    };
  }

  return {
    status,
    frames,
    connect,
    openTerminal,
  };
}
```

### Terminal Component

```typescript
// packages/web/src/components/Terminal.tsx

import { Terminal as XTerm } from 'xterm';
import { WebglAddon } from 'xterm-addon-webgl';
import { FitAddon } from 'xterm-addon-fit';
import { createEffect, onCleanup } from 'solid-js';

interface TerminalProps {
  frameId: string;
  tunnel: ReturnType<typeof createTunnelConnection>;
}

export function Terminal(props: TerminalProps) {
  let containerRef: HTMLDivElement;
  let term: XTerm;
  let fitAddon: FitAddon;

  createEffect(() => {
    term = new XTerm({
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
      },
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebglAddon());

    term.open(containerRef);
    fitAddon.fit();

    // Connect to frame terminal
    const session = props.tunnel.openTerminal(
      props.frameId,
      (data) => term.write(data)
    );

    // Send input to server
    term.onData((data) => session.write(data));

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      session.resize(term.cols, term.rows);
    });
    resizeObserver.observe(containerRef);

    onCleanup(() => {
      session.close();
      resizeObserver.disconnect();
      term.dispose();
    });
  });

  return <div ref={containerRef!} class="w-full h-full" />;
}
```

### Deliverables

- [ ] Package setup
  - [ ] `packages/web/` with Vite + Solid
  - [ ] Tailwind CSS configuration
  - [ ] PWA manifest and service worker
- [ ] Auth integration
  - [ ] Clerk provider setup
  - [ ] Sign in/out pages
  - [ ] Protected routes
- [ ] Core features
  - [ ] Frame list view
  - [ ] Terminal component (xterm.js)
  - [ ] WebSocket connection to tunnel
  - [ ] Frame controls (start/stop)
- [ ] Mobile UX
  - [ ] Touch-friendly frame cards
  - [ ] Mobile keyboard input for terminal
  - [ ] Swipe between terminals
  - [ ] Pull-to-refresh
- [ ] Deployment
  - [ ] Build for production
  - [ ] Serve from tunnel-server or Cloudflare Pages

---

## Phase 4: Polish

### Goal

Production-ready experience with robust error handling, offline awareness, and smooth UX.

### Connection Resilience

```typescript
// Reconnection with exponential backoff
const reconnectDelays = [1000, 2000, 4000, 8000, 16000, 30000];

function reconnect(attempt: number) {
  const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)];
  setTimeout(() => {
    connect();
  }, delay);
}

// Offline detection
window.addEventListener('online', () => {
  if (status() === 'disconnected') connect();
});

window.addEventListener('offline', () => {
  setStatus('disconnected');
});
```

### Offline UI States

```
┌─────────────────────────────────────┐
│  ≡  Optagon              ○ Offline  │
├─────────────────────────────────────┤
│                                     │
│    ┌───────────────────────────┐   │
│    │       📡                   │   │
│    │                           │   │
│    │   You're offline          │   │
│    │                           │   │
│    │   Waiting for connection  │   │
│    │   to resume...            │   │
│    │                           │   │
│    │   [Retry Now]             │   │
│    └───────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Server Disconnected State

```
┌─────────────────────────────────────┐
│  ≡  Optagon              ⚠ Server   │
├─────────────────────────────────────┤
│                                     │
│    ┌───────────────────────────┐   │
│    │       🖥️                   │   │
│    │                           │   │
│    │   Server not connected    │   │
│    │                           │   │
│    │   Your optagon server at  │   │
│    │   home isn't connected.   │   │
│    │                           │   │
│    │   Make sure it's running  │   │
│    │   and has internet.       │   │
│    │                           │   │
│    └───────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Device Management UI

```
┌─────────────────────────────────────┐
│  ←  Settings                        │
├─────────────────────────────────────┤
│                                     │
│  Account                            │
│  ┌─────────────────────────────┐   │
│  │ pta@example.com             │   │
│  │ [Manage Account]            │   │  ← Opens Clerk UI
│  └─────────────────────────────┘   │
│                                     │
│  Connected Servers                  │
│  ┌─────────────────────────────┐   │
│  │ 🟢 home-server              │   │
│  │    Last seen: just now      │   │
│  │    4 frames                 │   │
│  │                    [Remove] │   │
│  └─────────────────────────────┘   │
│                                     │
│  [+ Add Server]                     │
│                                     │
│  Theme                              │
│  ○ System  ● Dark  ○ Light         │
│                                     │
└─────────────────────────────────────┘
```

### Deliverables

- [ ] Connection resilience
  - [ ] Exponential backoff reconnection
  - [ ] Offline detection and UI
  - [ ] Server disconnected state
- [ ] Error handling
  - [ ] Graceful error messages
  - [ ] Retry mechanisms
  - [ ] Error reporting (optional)
- [ ] Settings UI
  - [ ] Clerk account management link
  - [ ] Server list with status
  - [ ] Theme toggle
- [ ] Performance
  - [ ] Service worker caching
  - [ ] Lazy load terminal addon
  - [ ] Optimize bundle size
- [ ] Testing
  - [ ] Test on iOS Safari
  - [ ] Test on Android Chrome
  - [ ] Test PWA installation

---

## Deployment

### VPS Setup (tunnel-server)

```bash
# 1. Provision VPS (Hetzner, ~$5/mo)
# - Ubuntu 24.04
# - 1 vCPU, 2GB RAM

# 2. Install Bun
curl -fsSL https://bun.sh/install | bash

# 3. Clone repo
git clone https://github.com/pathoam/optagon.git /opt/optagon

# 4. Install dependencies
cd /opt/optagon && bun install

# 5. Create systemd service
cat > /etc/systemd/system/optagon-tunnel.service << EOF
[Unit]
Description=Optagon Tunnel Server
After=network.target

[Service]
Type=simple
User=optagon
WorkingDirectory=/opt/optagon/packages/tunnel-server
ExecStart=/root/.bun/bin/bun run src/index.ts
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# 6. Start service
systemctl enable optagon-tunnel
systemctl start optagon-tunnel
```

### Cloudflare Setup

```
1. Add optagon.ai to Cloudflare
2. DNS Records:
   - A record: @ → VPS IP (proxied)
   - AAAA record if IPv6
3. SSL/TLS:
   - Mode: Full (strict)
   - Origin certificate: Generate and install on VPS
4. Firewall rules:
   - Allow only Cloudflare IPs to VPS
```

### PWA Deployment

Option A: Serve from tunnel-server
```typescript
// In tunnel-server
app.get('/*', serveStatic({ root: '../web/dist' }));
```

Option B: Cloudflare Pages (separate)
```bash
# In packages/web
bun run build
npx wrangler pages deploy dist --project-name=optagon
```

---

## Timeline Estimate

| Phase | Effort | Deliverable |
|-------|--------|-------------|
| Phase 1 | Core implementation | Tunnel working, tested with scripts |
| Phase 2 | Auth integration | Clerk setup, secure connections |
| Phase 3 | PWA development | Basic app working on phone |
| Phase 4 | Polish | Production-ready |

---

## Open Questions

1. **Domain**: Is optagon.ai already registered/available?
2. **Clerk pricing**: Free tier should be sufficient, but verify limits
3. **VPS provider**: Hetzner vs DigitalOcean vs Linode preference?
4. **PWA icon**: Need to design/create app icon

---

## References

- [Clerk Documentation](https://clerk.com/docs)
- [Solid.js](https://www.solidjs.com/)
- [xterm.js](https://xtermjs.org/)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)
- [Tailwind CSS](https://tailwindcss.com/)
