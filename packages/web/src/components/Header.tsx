import { Show } from 'solid-js';
import { A } from '@solidjs/router';
import { tunnel, type ConnectionState } from '~/lib/tunnel';

export function Header() {
  return (
    <header class="sticky top-0 z-10 bg-slate-800 border-b border-slate-700">
      <div class="flex items-center justify-between px-4 py-3">
        <A href="/" class="text-lg font-semibold text-white">
          Optagon
        </A>

        <div class="flex items-center gap-3">
          <ConnectionStatus />
          <A
            href="/settings"
            class="p-2 text-slate-400 hover:text-white transition-colors"
            aria-label="Settings"
          >
            <SettingsIcon />
          </A>
        </div>
      </div>
    </header>
  );
}

function ConnectionStatus() {
  const state = tunnel.state;
  const serverConnected = tunnel.serverConnected;

  const statusText = (): string => {
    const s = state();
    if (s === 'connected') {
      return serverConnected() ? 'Online' : 'Server offline';
    }
    if (s === 'connecting' || s === 'authenticating') {
      return 'Connecting...';
    }
    if (s === 'error') {
      return 'Error';
    }
    return 'Offline';
  };

  const statusColor = (): string => {
    const s = state();
    if (s === 'connected' && serverConnected()) {
      return 'bg-green-500';
    }
    if (s === 'connected' && !serverConnected()) {
      return 'bg-yellow-500';
    }
    if (s === 'connecting' || s === 'authenticating') {
      return 'bg-blue-500 status-pulse';
    }
    if (s === 'error') {
      return 'bg-red-500';
    }
    return 'bg-slate-500';
  };

  return (
    <div class="flex items-center gap-2 text-sm text-slate-400">
      <span class={`w-2 h-2 rounded-full ${statusColor()}`} />
      <span class="hidden sm:inline">{statusText()}</span>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
