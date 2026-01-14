# Optagon Tunnel - Architecture Specification

> Draft v1 - January 2026

> **Note**: This spec focused on frame dev server tunneling. For the complete remote access system (PWA, auth, terminal access), see [remote-access-spec.md](./remote-access-spec.md). Infrastructure has been updated from Cloudflare Workers to VPS + Cloudflare proxy for simplicity.

## Overview

Optagon Tunnel allows developers to expose their local development frames to the internet via `optagon.ai`. This enables:

- Viewing dev progress on mobile devices
- Sharing demos with clients/stakeholders
- Testing from anywhere without deploying

**Key principle**: One frame = one tunnel. Each frame is a complete dev environment (frontend, backend, database), exposed through a single URL.

---

## Business Model Context

```
FREE (Open Source)
├── optagon-server - Self-hosted, full functionality
├── Local frame management, tmux, containers
└── No registration required

PAID SERVICES (optagon.ai)
├── Tunnels - Expose frames to internet
│   ├── Free tier: Random slugs, rate limited
│   └── Paid tier: Custom slugs, higher limits
├── Cloud Frames - Hosted dev environments (future)
└── Managed Optagon - Full cloud solution (future)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
│   Visitor browses: https://optagon.ai/t/abc123                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│              OPTAGON.AI RELAY (Cloudflare Workers)                   │
│                                                                      │
│   1. Receives HTTP request                                          │
│   2. Looks up tunnel by slug                                        │
│   3. Validates access code (if required)                            │
│   4. Forwards request through WebSocket tunnel                      │
│   5. Streams response back to visitor                               │
│                                                                      │
│   Infrastructure: Cloudflare Workers + Durable Objects              │
│   - Serverless, scales automatically                                │
│   - Built-in DDoS protection                                        │
│   - WebSocket support via Durable Objects                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket (outbound from user's network)
                             │
┌────────────────────────────┴────────────────────────────────────────┐
│                    USER'S OPTAGON SERVER                             │
│                                                                      │
│   Tunnel Client:                                                    │
│   1. Opens WebSocket to wss://relay.optagon.ai/tunnel               │
│   2. Registers frame with signed token                              │
│   3. Receives proxied requests                                      │
│   4. Forwards to localhost:{frame_port}                             │
│   5. Streams response back through tunnel                           │
│                                                                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP (localhost)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FRAME CONTAINER                              │
│                                                                      │
│   Dev server running on container:3000                              │
│   (mapped to host:33000-34000)                                      │
│                                                                      │
│   Contains: frontend, backend, database - complete environment      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Flow

### 1. Enable Tunnel

```bash
$ optagon tunnel enable my-frame

Tunnel active: https://optagon.ai/t/a1b2c3d4
```

### 2. Behind the Scenes

```
1. Optagon server generates tunnel token (signed JWT)
2. Opens WebSocket: wss://relay.optagon.ai/tunnel
3. Sends: { type: "register", token: "...", frameId: "abc123" }
4. Relay validates signature, assigns slug
5. Responds: { type: "registered", url: "https://optagon.ai/t/a1b2c3d4" }
6. WebSocket held open for request proxying
```

### 3. Visitor Accesses URL

```
1. GET https://optagon.ai/t/a1b2c3d4/dashboard

2. Relay looks up tunnel by slug "a1b2c3d4"

3. Relay sends through WebSocket:
   { type: "request", id: "req1", method: "GET", path: "/dashboard", headers: {...} }

4. Optagon server forwards to localhost:33000/dashboard

5. Optagon server streams back:
   { type: "response", id: "req1", status: 200, headers: {...}, body: "..." }

6. Relay sends HTTP response to visitor
```

---

## URL Scheme

### Path-Based (Default)

```
https://optagon.ai/t/{slug}
https://optagon.ai/t/{slug}/any/path/here
```

- Simple, no wildcard certificate needed
- Works immediately

### Subdomain (Future, Paid)

```
https://{slug}.optagon.ai
https://{custom-slug}.optagon.ai
```

- Cleaner URLs
- Requires wildcard cert and account

### Slug Rules

- **Random**: 8 alphanumeric characters (e.g., `a1b2c3d4`)
- **Custom** (future): 3-32 chars, alphanumeric + hyphens, requires account
- **Reserved**: `www`, `api`, `app`, `relay`, `tunnel`, `admin`

---

## Tunnel Protocol

WebSocket connection between Optagon server and relay.

### Client → Relay Messages

```typescript
// Register a tunnel
{
  type: "register",
  token: string,      // Signed JWT
  slug?: string       // Optional custom slug (requires account)
}

// HTTP response (can be chunked for large responses)
{
  type: "response",
  id: string,         // Matches request id
  status: number,
  headers: Record<string, string>,
  body: string | null,
  done: boolean       // false if more chunks coming
}

// Response chunk (for streaming)
{
  type: "response_chunk",
  id: string,
  chunk: string       // Base64 encoded for binary safety
}

// Response complete
{
  type: "response_end",
  id: string
}

// Keepalive
{ type: "ping" }

// WebSocket passthrough (for hot reload, etc.)
{
  type: "ws_message",
  id: string,         // WebSocket connection id
  data: string
}

{
  type: "ws_close",
  id: string
}
```

### Relay → Client Messages

```typescript
// Registration successful
{
  type: "registered",
  url: string,        // Full public URL
  slug: string
}

// Registration failed
{
  type: "error",
  code: string,       // "invalid_token", "slug_taken", etc.
  message: string
}

// Incoming HTTP request to proxy
{
  type: "request",
  id: string,         // Unique request ID
  method: string,
  path: string,       // Path after slug, e.g., "/dashboard"
  headers: Record<string, string>,
  body: string | null // Base64 encoded if present
}

// WebSocket upgrade request
{
  type: "ws_open",
  id: string,
  path: string,
  headers: Record<string, string>
}

// WebSocket message from visitor
{
  type: "ws_message",
  id: string,
  data: string
}

// WebSocket closed by visitor
{
  type: "ws_close",
  id: string
}

// Keepalive response
{ type: "pong" }
```

---

## Authentication

### Tunnel Token (JWT)

```typescript
{
  iss: "optagon-server",
  sub: string,          // Server installation ID
  frame: string,        // Frame ID
  port: number,         // Local port to forward to
  iat: number,          // Issued at (Unix timestamp)
  exp: number           // Expires (iat + 24 hours)
}
```

Signed with server's private key (Ed25519).

### First-Time Setup

```bash
$ optagon tunnel setup

Generating keypair...
Registering with optagon.ai...
Enter the code shown at https://optagon.ai/setup: XXXX-XXXX

✓ Tunnel configured
  Server ID: srv_a1b2c3d4
  Credentials saved to ~/.optagon/tunnel.json
```

Registration associates the public key with a server ID. This enables:
- Token signature verification
- Usage tracking (for rate limits)
- Future: account linking for custom slugs

### Credential Storage

```
~/.optagon/
├── tunnel.json           # Tunnel credentials
│   {
│     "serverId": "srv_a1b2c3d4",
│     "privateKey": "...",
│     "publicKey": "...",
│     "registeredAt": "2026-01-12T..."
│   }
```

---

## Access Control

### Configuration

```yaml
# In frame config or via CLI
tunnel:
  enabled: true
  access:
    public: false         # Require access code
    code: "secret123"     # The code visitors must provide
```

### Visitor Flow (Protected Tunnel)

```
1. Visitor goes to https://optagon.ai/t/abc123

2. No valid code cookie → show access code form
   "Enter access code to view this site"
   [________] [Submit]

3. Visitor enters code → relay validates

4. Valid → set cookie, redirect to content
   Invalid → show error, retry

5. Subsequent requests include cookie, bypass prompt
```

### URL-Based Code (Alternative)

```
https://optagon.ai/t/abc123?code=secret123
```

Useful for sharing direct links with the code embedded.

---

## WebSocket Passthrough

Development servers often use WebSocket for hot reload (Vite, Next.js, etc.). The tunnel supports this:

```
1. Visitor's browser opens: wss://optagon.ai/t/abc123/_hmr

2. Relay sends to tunnel:
   { type: "ws_open", id: "ws1", path: "/_hmr", headers: {...} }

3. Optagon server opens WebSocket to localhost:33000/_hmr

4. Bidirectional relay:
   Visitor ←→ Relay ←→ Tunnel ←→ Local WebSocket

5. Hot reload works through the tunnel
```

---

## Rate Limiting

### Free Tier Limits

| Limit | Value |
|-------|-------|
| Requests per minute | 100 |
| Concurrent connections | 10 |
| Max request body | 10 MB |
| Max response body | 50 MB |
| WebSocket messages/sec | 50 |
| Tunnels per server | 5 |

### Enforcement

- Relay tracks per-tunnel usage
- Returns `429 Too Many Requests` when exceeded
- Headers indicate limit status:
  ```
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 42
  X-RateLimit-Reset: 1704067200
  ```

### Paid Tier (Future)

Higher limits, custom slugs, analytics, priority support.

---

## Tunnel Lifecycle

### Enable

```bash
$ optagon tunnel enable my-frame

# With access code
$ optagon tunnel enable my-frame --code secret123

# Request specific slug (requires account, future)
$ optagon tunnel enable my-frame --slug my-demo
```

Tunnel opens and stays open while frame is running.

### Disable

```bash
$ optagon tunnel disable my-frame
```

Closes WebSocket, URL becomes inactive.

### Auto-Reconnect

If WebSocket drops (network issues), client automatically reconnects with same slug (if still available).

### Frame Stop

When frame stops, tunnel automatically closes. When frame restarts, tunnel can be re-enabled.

---

## CLI Commands

```bash
# Initial setup (one-time)
optagon tunnel setup

# Enable tunnel for a frame
optagon tunnel enable <frame-name> [--code <access-code>]

# Disable tunnel
optagon tunnel disable <frame-name>

# List active tunnels
optagon tunnel list

# Show tunnel status
optagon tunnel status <frame-name>

# Update access code
optagon tunnel set-code <frame-name> <new-code>

# Remove access code (make public)
optagon tunnel set-code <frame-name> --public
```

### Example Output

```bash
$ optagon tunnel list

FRAME         URL                              ACCESS
my-app        https://optagon.ai/t/a1b2c3d4    public
client-demo   https://optagon.ai/t/x9y8z7w6    protected

$ optagon tunnel status my-app

Frame:    my-app
URL:      https://optagon.ai/t/a1b2c3d4
Status:   connected
Access:   public
Uptime:   2h 34m
Requests: 847 (last hour)
```

---

## Relay Infrastructure

### Cloudflare Workers Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                           │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Worker: optagon-relay                                       │   │
│   │  - Handles HTTP requests to optagon.ai/t/*                  │   │
│   │  - Routes to appropriate Durable Object                      │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────┐   │
│   │  Durable Objects: TunnelConnection                           │   │
│   │  - One per active tunnel                                     │   │
│   │  - Holds WebSocket to Optagon server                         │   │
│   │  - Proxies requests/responses                                │   │
│   │  - Tracks rate limits                                        │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────┐   │
│   │  KV Store: optagon-tunnels                                   │   │
│   │  - slug → Durable Object ID mapping                          │   │
│   │  - Server public keys                                        │   │
│   │  - Access codes (hashed)                                     │   │
│   └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Why Cloudflare Workers

- **Serverless**: No infrastructure to manage
- **Global**: Low latency from anywhere
- **WebSocket support**: Via Durable Objects
- **DDoS protection**: Built-in
- **Cost**: Generous free tier, pay-per-use after

### Estimated Costs

| Usage | Monthly Cost |
|-------|--------------|
| < 100K requests | Free |
| 1M requests | ~$5 |
| 10M requests | ~$50 |

Durable Objects add ~$0.15/million requests.

---

## Security Considerations

### Threat Model

1. **Malicious visitors**: Rate limiting, optional access codes
2. **Tunnel hijacking**: Signed tokens, server ID verification
3. **Data interception**: TLS everywhere (visitor ↔ relay ↔ tunnel)
4. **DDoS on relay**: Cloudflare protection
5. **DDoS on user's server**: Rate limiting at relay

### Token Security

- Ed25519 signatures (fast, secure)
- 24-hour expiry, auto-refresh
- Server ID bound to public key
- Private key never leaves user's machine

### Access Code Security

- Codes hashed before storage (bcrypt)
- Cookie-based session after validation
- Codes can be rotated anytime

---

## Future Enhancements

### Phase 2: Accounts & Custom Slugs

- User accounts on optagon.ai
- Reserve custom slugs
- Manage multiple servers
- Usage dashboard

### Phase 3: Paid Tiers

- Higher rate limits
- Priority routing
- Custom domains (bring your own)
- Analytics & logging

### Phase 4: Cloud Frames

- Host frames on optagon.ai infrastructure
- No local server needed
- Deploy to Cloudflare Workers / Fly.io

---

## Implementation Checklist

### Relay Server (Cloudflare Workers)

- [ ] Worker entry point (HTTP routing)
- [ ] Durable Object for tunnel connections
- [ ] WebSocket handling
- [ ] Request proxying
- [ ] KV store for slug mapping
- [ ] Access code validation
- [ ] Rate limiting

### Optagon Server (Tunnel Client)

- [ ] Keypair generation
- [ ] Server registration flow
- [ ] WebSocket connection to relay
- [ ] Token generation & refresh
- [ ] Request forwarding to local ports
- [ ] WebSocket passthrough
- [ ] Auto-reconnect logic

### CLI

- [ ] `optagon tunnel setup`
- [ ] `optagon tunnel enable/disable`
- [ ] `optagon tunnel list/status`
- [ ] `optagon tunnel set-code`

---

## References

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/workers/learning/using-durable-objects/)
- [ngrok architecture](https://ngrok.com/docs) (similar concept)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-tunnel/) (similar, but heavier)
