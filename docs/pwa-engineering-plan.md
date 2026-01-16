# Optagon PWA - Engineering Plan

> Based on Phase 3 of `remote-access-spec.md`

## Current State

**Already Built:**
- `packages/tunnel-server/` - Running at optagon.app
  - `/ws` endpoint for PWA WebSocket connections
  - Clerk JWT verification via `@clerk/backend`
  - Protocol types in `src/protocol.ts`
  - Handles `pwa_auth`, `terminal_*`, and `frames_sync` messages
- Clerk application configured with auth methods

**To Build:**
- `packages/web/` - PWA with Solid.js + xterm.js

---

## Architecture Decisions

### Framework: Solid.js
**Why not React?**
- Smaller bundle (~7KB vs ~40KB)
- Better performance (no virtual DOM)
- Signals match our reactive state needs
- Clerk has official Solid support via `@clerk/clerk-js`

### Terminal: xterm.js
**Compatibility considerations:**
- Use `xterm` v5.x (latest stable)
- WebGL addon for mobile performance
- FitAddon for responsive sizing
- Canvas fallback for older devices

### Build: Vite
**PWA Plugin:**
- `vite-plugin-pwa` for service worker
- Workbox for caching strategies
- Auto-generates manifest

### Styling: Tailwind CSS
- Mobile-first responsive design
- Dark mode by default (matches terminal aesthetic)
- JetBrains Mono for terminal font

---

## Package Structure

```
packages/web/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── public/
│   ├── manifest.webmanifest
│   ├── icon-192.png
│   ├── icon-512.png
│   └── apple-touch-icon.png
└── src/
    ├── index.tsx              # Entry point
    ├── App.tsx                # Root component with router
    ├── env.d.ts               # Vite env types
    │
    ├── routes/
    │   ├── index.tsx          # Frame list (home)
    │   ├── frame/[id].tsx     # Terminal view
    │   ├── settings.tsx       # User settings
    │   ├── sign-in.tsx        # Clerk sign-in
    │   └── sign-up.tsx        # Clerk sign-up
    │
    ├── components/
    │   ├── FrameList.tsx
    │   ├── FrameCard.tsx
    │   ├── Terminal.tsx       # xterm.js wrapper
    │   ├── Header.tsx
    │   ├── MobileNav.tsx
    │   ├── ConnectionStatus.tsx
    │   └── OfflineOverlay.tsx
    │
    ├── lib/
    │   ├── tunnel.ts          # WebSocket connection
    │   ├── api.ts             # REST API client
    │   └── protocol.ts        # Re-export from shared
    │
    └── stores/
        ├── auth.ts            # Clerk auth state
        ├── connection.ts      # Tunnel connection state
        └── frames.ts          # Frame list state
```

---

## Shared Protocol Types

**Problem:** Protocol types are duplicated between tunnel-server and PWA.

**Solution:** Create a shared types package or use direct import.

### Option A: Shared Package (Recommended)
```
packages/
├── shared/
│   └── src/
│       └── protocol.ts      # Canonical protocol types
├── tunnel-server/
│   └── src/
│       └── protocol.ts      # import from @optagon/shared
└── web/
    └── src/lib/
        └── protocol.ts      # import from @optagon/shared
```

### Option B: Direct Import (Simpler)
```typescript
// packages/web/src/lib/protocol.ts
// Copy paste or use path alias to tunnel-server/src/protocol.ts
// This works since both are in same monorepo
```

**Decision:** Start with Option B for speed, refactor to Option A if types drift.

---

## Clerk Integration

### Install
```bash
cd packages/web
bun add @clerk/clerk-js
```

### Configuration
```typescript
// packages/web/src/lib/clerk.ts
import Clerk from '@clerk/clerk-js';

const clerk = new Clerk(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export async function initClerk() {
  await clerk.load();
  return clerk;
}

export function getToken(): Promise<string | null> {
  return clerk.session?.getToken() ?? null;
}
```

### Environment Variables
```bash
# packages/web/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx
VITE_TUNNEL_URL=wss://optagon.app
```

### Auth Flow
1. User visits PWA
2. Check `clerk.session` - if null, redirect to sign-in
3. On sign-in success, get JWT: `clerk.session.getToken()`
4. Connect WebSocket with token: `wss://optagon.app/ws`
5. Send `pwa_auth` message with JWT
6. Server validates, returns `pwa_auth_success`

---

## WebSocket Connection

### Connection State Machine
```
disconnected → connecting → authenticating → connected
                    ↓              ↓             ↓
                  error         error     → disconnected
```

### Implementation
```typescript
// packages/web/src/lib/tunnel.ts
import { createSignal, createRoot } from 'solid-js';
import type { RelayToPwaMessage, PwaToRelayMessage, FrameSummary } from './protocol';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

export function createTunnel() {
  const [state, setState] = createSignal<ConnectionState>('disconnected');
  const [frames, setFrames] = createSignal<FrameSummary[]>([]);
  const [serverConnected, setServerConnected] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let ws: WebSocket | null = null;
  let getToken: () => Promise<string | null> = async () => null;
  let reconnectAttempt = 0;
  const maxReconnectDelay = 30000;

  const terminalHandlers = new Map<string, {
    onData: (data: string) => void;
    onClose: () => void;
  }>();

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;

    setState('connecting');
    setError(null);

    const url = import.meta.env.VITE_TUNNEL_URL || 'wss://optagon.app';
    ws = new WebSocket(`${url}/ws`);

    ws.onopen = async () => {
      setState('authenticating');
      const token = await getToken();
      if (!token) {
        setState('error');
        setError('No auth token');
        ws?.close();
        return;
      }
      send({ type: 'pwa_auth', token });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as RelayToPwaMessage;
      handleMessage(msg);
    };

    ws.onclose = () => {
      setState('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      setState('error');
      setError('Connection failed');
    };
  }

  function handleMessage(msg: RelayToPwaMessage) {
    switch (msg.type) {
      case 'pwa_auth_success':
        setState('connected');
        reconnectAttempt = 0;
        break;

      case 'pwa_auth_error':
        setState('error');
        setError(msg.message);
        break;

      case 'server_status':
        setServerConnected(msg.connected);
        break;

      case 'frames_sync':
        setFrames(msg.frames);
        break;

      case 'terminal_opened':
      case 'terminal_data':
      case 'terminal_close':
      case 'terminal_error': {
        const handler = terminalHandlers.get(msg.channelId);
        if (handler) {
          if (msg.type === 'terminal_data') {
            handler.onData(atob(msg.data));
          } else if (msg.type === 'terminal_close' || msg.type === 'terminal_error') {
            handler.onClose();
            terminalHandlers.delete(msg.channelId);
          }
        }
        break;
      }
    }
  }

  function send(msg: PwaToRelayMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxReconnectDelay);
    reconnectAttempt++;
    setTimeout(connect, delay);
  }

  function openTerminal(frameId: string, onData: (data: string) => void) {
    const channelId = crypto.randomUUID();

    terminalHandlers.set(channelId, {
      onData,
      onClose: () => {},
    });

    send({ type: 'terminal_open', channelId, frameId });

    return {
      write: (data: string) => {
        send({ type: 'terminal_data', channelId, data: btoa(data) });
      },
      resize: (cols: number, rows: number) => {
        send({ type: 'terminal_resize', channelId, cols, rows });
      },
      close: () => {
        send({ type: 'terminal_close', channelId });
        terminalHandlers.delete(channelId);
      },
    };
  }

  function setTokenGetter(fn: () => Promise<string | null>) {
    getToken = fn;
  }

  function disconnect() {
    ws?.close();
    ws = null;
  }

  return {
    state,
    frames,
    serverConnected,
    error,
    connect,
    disconnect,
    openTerminal,
    setTokenGetter,
  };
}

// Singleton
export const tunnel = createRoot(() => createTunnel());
```

---

## Terminal Component

### Dependencies
```bash
bun add xterm @xterm/addon-fit @xterm/addon-webgl
```

### Implementation
```typescript
// packages/web/src/components/Terminal.tsx
import { onMount, onCleanup, createEffect } from 'solid-js';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { tunnel } from '../lib/tunnel';
import 'xterm/css/xterm.css';

interface TerminalProps {
  frameId: string;
}

export function Terminal(props: TerminalProps) {
  let containerRef: HTMLDivElement | undefined;
  let term: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let session: ReturnType<typeof tunnel.openTerminal> | undefined;

  onMount(() => {
    if (!containerRef) return;

    // Create terminal
    term = new XTerm({
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selection: 'rgba(255, 255, 255, 0.3)',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
      },
    });

    // Add addons
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Try WebGL, fallback to canvas
    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn('WebGL addon failed, using canvas renderer');
    }

    // Open in container
    term.open(containerRef);
    fitAddon.fit();

    // Connect to server
    session = tunnel.openTerminal(props.frameId, (data) => {
      term?.write(data);
    });

    // Send input to server
    term.onData((data) => {
      session?.write(data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
      if (term) {
        session?.resize(term.cols, term.rows);
      }
    });
    resizeObserver.observe(containerRef);

    onCleanup(() => {
      session?.close();
      resizeObserver.disconnect();
      term?.dispose();
    });
  });

  // Reconnect on frame change
  createEffect(() => {
    const frameId = props.frameId;
    // If frameId changes and we have an existing session, reconnect
    // This will be handled by route change in practice
  });

  return (
    <div
      ref={containerRef}
      class="w-full h-full bg-slate-900"
      style={{ "min-height": "300px" }}
    />
  );
}
```

---

## Mobile UX Considerations

### Touch Keyboard
- xterm.js doesn't handle mobile keyboards well by default
- Solution: Add a hidden input field that captures mobile keyboard
- Or: Use a floating action button to toggle on-screen keyboard

### Implementation
```typescript
// In Terminal.tsx
function MobileKeyboardInput(props: { onInput: (data: string) => void }) {
  let inputRef: HTMLInputElement | undefined;

  return (
    <div class="md:hidden fixed bottom-0 left-0 right-0 p-2 bg-slate-800 border-t border-slate-700">
      <input
        ref={inputRef}
        type="text"
        class="w-full bg-slate-900 text-white p-2 rounded"
        placeholder="Type here..."
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
          e.currentTarget.value = '';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            props.onInput('\r');
          }
        }}
      />
    </div>
  );
}
```

### Safe Area Insets (iOS)
```css
/* In global CSS */
body {
  padding-bottom: env(safe-area-inset-bottom);
}

.terminal-container {
  height: calc(100vh - env(safe-area-inset-bottom) - 60px);
}
```

### Gestures
- Swipe left/right: Switch between frames (use Hammer.js or native)
- Pull down: Refresh frame list
- Pinch: Font size adjustment (future)

---

## PWA Configuration

### manifest.webmanifest
```json
{
  "name": "Optagon",
  "short_name": "Optagon",
  "description": "Remote access to your development frames",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
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
    },
    {
      "src": "/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png",
      "purpose": "apple touch icon"
    }
  ]
}
```

### Vite Config
```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: false, // We use our own manifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/optagon\.app\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300, // 5 minutes
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
```

---

## Deployment Strategy

### Option A: Serve from tunnel-server
Add static file serving to existing tunnel-server:
```typescript
// In tunnel-server/src/server.ts
import { serveStatic } from 'hono/bun';

// After WebSocket routes
app.use('/*', serveStatic({ root: '../web/dist' }));
```

**Pros:** Single deployment, single domain
**Cons:** Need to rebuild and redeploy on PWA changes

### Option B: Separate (Cloudflare Pages)
Deploy PWA separately to Cloudflare Pages:
```bash
cd packages/web
bun run build
npx wrangler pages deploy dist --project-name=optagon-pwa
```

Configure CORS on tunnel-server for API calls.

**Pros:** Independent deploys, edge caching
**Cons:** CORS complexity, additional service

**Decision:** Start with Option A for simplicity.

---

## Testing Checklist

### Device Testing
- [ ] iOS Safari (iPhone)
- [ ] iOS Chrome (iPhone)
- [ ] Android Chrome
- [ ] Android Firefox
- [ ] Desktop Chrome
- [ ] Desktop Firefox
- [ ] Desktop Safari

### PWA Testing
- [ ] Install prompt appears
- [ ] Works offline (cached shell)
- [ ] App icon correct
- [ ] Splash screen correct
- [ ] Navigation works in standalone mode

### Terminal Testing
- [ ] Terminal renders correctly
- [ ] Input works (keyboard)
- [ ] Mobile keyboard input works
- [ ] Terminal resizes on orientation change
- [ ] WebGL rendering on capable devices
- [ ] Canvas fallback on older devices
- [ ] Copy/paste works

### Connection Testing
- [ ] Auth flow works
- [ ] Reconnection after network drop
- [ ] Server disconnect handling
- [ ] Multiple terminal sessions
- [ ] Frame switching

---

## Implementation Order

1. **Package setup** - Vite + Solid + Tailwind
2. **Clerk integration** - Sign in/out working
3. **WebSocket connection** - Auth and basic messaging
4. **Frame list view** - Display frames from server
5. **Terminal component** - xterm.js working
6. **Mobile keyboard** - Input on phones
7. **PWA config** - Manifest, icons, service worker
8. **Deployment** - Integrate with tunnel-server
9. **Testing** - All devices, connections
10. **Polish** - Offline states, error handling

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| xterm.js mobile performance | Use WebGL addon, test early on low-end devices |
| Clerk Solid SDK issues | Use vanilla @clerk/clerk-js instead of framework SDK |
| WebSocket reliability on mobile | Aggressive reconnection, visibility change handling |
| iOS standalone mode bugs | Test thoroughly, consider using `mobile-web-app-capable` |
| Large bundle size | Code splitting, lazy load xterm addons |

---

## Next Steps

Ready to start implementation:
1. Create `packages/web/` with dependencies
2. Set up basic Vite + Solid + Tailwind
3. Get Clerk sign-in working
4. Connect to tunnel-server WebSocket
