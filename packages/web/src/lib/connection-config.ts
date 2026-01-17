import { createSignal, createRoot } from 'solid-js';

export type ConnectionMode = 'auto' | 'production' | 'localhost' | 'custom';

export interface ConnectionConfig {
  mode: ConnectionMode;
  customUrl: string;
}

const STORAGE_KEY = 'optagon:connection';

/**
 * Connection presets for different environments
 *
 * DEV SETUP PAIRING:
 * - tunnel-server: runs on port 3001 (bun run dev in packages/tunnel-server)
 * - PWA dev server: runs on port 3000 (bun run dev in packages/web)
 * - PWA proxies /ws and /api to tunnel-server via vite.config.ts
 *
 * When developing locally:
 * 1. Start tunnel-server: cd packages/tunnel-server && bun run dev (port 3001)
 * 2. Start PWA: cd packages/web && bun run dev (port 3000)
 * 3. PWA "auto" mode uses current origin, proxy forwards to tunnel-server
 * 4. Use "localhost" mode to bypass proxy and connect directly to tunnel-server
 *
 * Frame port mappings (33000-34000) are separate from tunnel-server port.
 */
export const CONNECTION_PRESETS = {
  production: 'wss://optagon.app/ws',
  localhost: 'ws://localhost:3001/ws',  // Direct connection to tunnel-server dev port
} as const;

function createConnectionConfig() {
  // Load from localStorage or use defaults
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEY)
    : null;

  const initial: ConnectionConfig = stored
    ? JSON.parse(stored)
    : { mode: 'auto', customUrl: '' };

  const [config, setConfigInternal] = createSignal<ConnectionConfig>(initial);

  function setConfig(newConfig: Partial<ConnectionConfig>) {
    setConfigInternal(prev => {
      const updated = { ...prev, ...newConfig };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
      return updated;
    });
  }

  function getWebSocketUrl(): string {
    const current = config();

    switch (current.mode) {
      case 'production':
        return CONNECTION_PRESETS.production;

      case 'localhost':
        return CONNECTION_PRESETS.localhost;

      case 'custom':
        return current.customUrl || CONNECTION_PRESETS.production;

      case 'auto':
      default:
        // Derive from current origin
        if (typeof window !== 'undefined') {
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          return `${protocol}//${window.location.host}/ws`;
        }
        return CONNECTION_PRESETS.production;
    }
  }

  function getModeLabel(mode: ConnectionMode): string {
    switch (mode) {
      case 'auto':
        return 'Auto (current origin)';
      case 'production':
        return 'Production (optagon.app)';
      case 'localhost':
        return 'Localhost (dev)';
      case 'custom':
        return 'Custom URL';
    }
  }

  return {
    config,
    setConfig,
    getWebSocketUrl,
    getModeLabel,
  };
}

// Singleton instance
export const connectionConfig = createRoot(() => createConnectionConfig());
