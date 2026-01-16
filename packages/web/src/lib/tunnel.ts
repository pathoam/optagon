import { createSignal, createRoot } from 'solid-js';
import type {
  RelayToPwaMessage,
  PwaToRelayMessage,
  FrameSummary,
} from './protocol';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'error';

function createTunnel() {
  const [state, setState] = createSignal<ConnectionState>('disconnected');
  const [frames, setFrames] = createSignal<FrameSummary[]>([]);
  const [serverConnected, setServerConnected] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let ws: WebSocket | null = null;
  let getToken: () => Promise<string | null> = async () => null;
  let reconnectAttempt = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  const maxReconnectDelay = 30000;

  const terminalHandlers = new Map<
    string,
    {
      onData: (data: string) => void;
      onOpened: (cols: number, rows: number) => void;
      onClose: () => void;
      onError: (message: string) => void;
    }
  >();

  function connect() {
    if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Clear any pending reconnect
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    setState('connecting');
    setError(null);

    // Derive WebSocket URL from current origin (PWA is served from tunnel server)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log('[tunnel] Connecting to', wsUrl);
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
      console.log('[tunnel] WebSocket opened, authenticating...');
      setState('authenticating');

      const token = await getToken();
      if (!token) {
        console.error('[tunnel] No auth token available');
        setState('error');
        setError('Not signed in');
        ws?.close();
        return;
      }

      send({ type: 'pwa_auth', token });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as RelayToPwaMessage;
        handleMessage(msg);
      } catch (e) {
        console.error('[tunnel] Failed to parse message:', e);
      }
    };

    ws.onclose = (event) => {
      console.log('[tunnel] WebSocket closed:', event.code, event.reason);
      ws = null;

      if (state() !== 'error') {
        setState('disconnected');
      }

      scheduleReconnect();
    };

    ws.onerror = (event) => {
      console.error('[tunnel] WebSocket error:', event);
      setState('error');
      setError('Connection failed');
    };
  }

  function handleMessage(msg: RelayToPwaMessage) {
    switch (msg.type) {
      case 'pwa_auth_success':
        console.log('[tunnel] Authenticated as', msg.userId);
        setState('connected');
        reconnectAttempt = 0;
        break;

      case 'pwa_auth_error':
        console.error('[tunnel] Auth error:', msg.message);
        setState('error');
        setError(msg.message);
        break;

      case 'server_status':
        console.log('[tunnel] Server status:', msg.connected ? 'online' : 'offline');
        setServerConnected(msg.connected);
        break;

      case 'frames_sync':
        console.log('[tunnel] Frames sync:', msg.frames.length, 'frames');
        setFrames(msg.frames);
        break;

      case 'terminal_opened': {
        const handler = terminalHandlers.get(msg.channelId);
        if (handler) {
          handler.onOpened(msg.cols, msg.rows);
        }
        break;
      }

      case 'terminal_data': {
        const handler = terminalHandlers.get(msg.channelId);
        if (handler) {
          // Decode base64 data
          handler.onData(atob(msg.data));
        }
        break;
      }

      case 'terminal_close': {
        const handler = terminalHandlers.get(msg.channelId);
        if (handler) {
          handler.onClose();
          terminalHandlers.delete(msg.channelId);
        }
        break;
      }

      case 'terminal_error': {
        const handler = terminalHandlers.get(msg.channelId);
        if (handler) {
          handler.onError(msg.message);
          terminalHandlers.delete(msg.channelId);
        }
        break;
      }

      default:
        console.log('[tunnel] Unknown message type:', (msg as any).type);
    }
  }

  function send(msg: PwaToRelayMessage) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[tunnel] Cannot send, WebSocket not open');
    }
  }

  function scheduleReconnect() {
    // Don't reconnect if we had an auth error
    if (state() === 'error' && error()?.includes('sign')) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), maxReconnectDelay);
    reconnectAttempt++;

    console.log(`[tunnel] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
    reconnectTimeout = setTimeout(connect, delay);
  }

  function openTerminal(
    frameId: string,
    callbacks: {
      onData: (data: string) => void;
      onOpened?: (cols: number, rows: number) => void;
      onClose?: () => void;
      onError?: (message: string) => void;
    }
  ) {
    const channelId = crypto.randomUUID();

    terminalHandlers.set(channelId, {
      onData: callbacks.onData,
      onOpened: callbacks.onOpened || (() => {}),
      onClose: callbacks.onClose || (() => {}),
      onError: callbacks.onError || (() => {}),
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
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    ws?.close();
    ws = null;
    setState('disconnected');
  }

  // Handle visibility changes (reconnect when app becomes visible)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state() === 'disconnected') {
        console.log('[tunnel] App became visible, reconnecting...');
        connect();
      }
    });

    // Handle online/offline events
    window.addEventListener('online', () => {
      if (state() === 'disconnected' || state() === 'error') {
        console.log('[tunnel] Network online, reconnecting...');
        reconnectAttempt = 0;
        connect();
      }
    });

    window.addEventListener('offline', () => {
      console.log('[tunnel] Network offline');
      setState('disconnected');
    });
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

// Singleton tunnel instance
export const tunnel = createRoot(() => createTunnel());
