import { Show, For, createSignal } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { clerk, signOut } from '~/lib/clerk';
import { tunnel } from '~/lib/tunnel';
import { Header } from '~/components/Header';
import { connectionConfig, CONNECTION_PRESETS, type ConnectionMode } from '~/lib/connection-config';

export function Settings() {
  const navigate = useNavigate();
  const clerkInstance = clerk();

  const handleSignOut = async () => {
    tunnel.disconnect();
    await signOut();
    navigate('/sign-in', { replace: true });
  };

  const user = () => clerkInstance?.user;

  return (
    <>
      <Header />
      <main class="p-4 max-w-lg mx-auto">
        <h1 class="text-xl font-semibold text-white mb-6">Settings</h1>

        {/* Account section */}
        <section class="mb-8">
          <h2 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Account
          </h2>
          <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <Show when={user()}>
              <div class="flex items-center gap-4">
                <Show when={user()?.imageUrl}>
                  <img
                    src={user()!.imageUrl}
                    alt=""
                    class="w-12 h-12 rounded-full"
                  />
                </Show>
                <div>
                  <p class="font-medium text-white">
                    {user()?.fullName || user()?.username || 'User'}
                  </p>
                  <p class="text-sm text-slate-400">
                    {user()?.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
              </div>
            </Show>

            <button
              onClick={handleSignOut}
              class="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
            >
              Sign Out
            </button>
          </div>
        </section>

        {/* Tunnel Settings section */}
        <section class="mb-8">
          <h2 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Tunnel Settings
          </h2>
          <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <p class="text-xs text-slate-500 mb-3">
              Connection to the relay server that routes traffic to your dev servers.
            </p>

            {/* Status row */}
            <div class="flex items-center justify-between mb-4">
              <span class="text-slate-300">Status</span>
              <ConnectionStatusBadge />
            </div>

            <Show when={tunnel.state() === 'disconnected' || tunnel.state() === 'error'}>
              <button
                onClick={() => tunnel.connect()}
                class="mb-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                Reconnect
              </button>
            </Show>

            {/* Server mode selector */}
            <TunnelModeSelector />
          </div>
        </section>

        {/* Dev Servers section */}
        <section class="mb-8">
          <h2 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Dev Servers
          </h2>
          <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <p class="text-xs text-slate-500 mb-3">
              Optagon instances running on your machines, providing access to frames.
            </p>

            <Show when={tunnel.state() !== 'connected'}>
              <p class="text-slate-500 text-sm">Connect to tunnel to see dev servers</p>
            </Show>

            <Show when={tunnel.state() === 'connected' && tunnel.servers().length === 0}>
              <div class="text-center py-4">
                <p class="text-slate-400 text-sm">No dev servers connected</p>
                <p class="text-slate-500 text-xs mt-1">
                  Run <code class="bg-slate-900 px-1 rounded">optagon tunnel connect</code> on your machine
                </p>
              </div>
            </Show>

            <Show when={tunnel.state() === 'connected' && tunnel.servers().length > 0}>
              <div class="space-y-2">
                <For each={tunnel.servers()}>
                  {(server) => (
                    <div class="flex items-center justify-between p-2 bg-slate-900 rounded">
                      <div class="flex items-center gap-2">
                        <span class={`w-2 h-2 rounded-full ${server.connected ? 'bg-green-500' : 'bg-slate-500'}`} />
                        <span class="text-white font-medium">{server.serverName}</span>
                      </div>
                      <div class="text-right">
                        <span class="text-slate-400 text-sm">{server.frameCount} frames</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              <div class="mt-3 pt-3 border-t border-slate-700">
                <div class="flex items-center justify-between">
                  <span class="text-slate-400 text-sm">Total Frames</span>
                  <span class="text-white">{tunnel.frames().length}</span>
                </div>
              </div>
            </Show>
          </div>
        </section>

        {/* About section */}
        <section>
          <h2 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            About
          </h2>
          <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div class="flex items-center justify-between">
              <span class="text-slate-300">Version</span>
              <span class="text-slate-400 text-sm">0.1.0</span>
            </div>

            <div class="mt-3">
              <a
                href="https://github.com/pathoam/optagon"
                target="_blank"
                rel="noopener noreferrer"
                class="text-blue-400 hover:underline text-sm"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function ConnectionStatusBadge() {
  const state = tunnel.state;

  const color = () => {
    switch (state()) {
      case 'connected':
        return 'bg-green-500/20 text-green-400';
      case 'connecting':
      case 'authenticating':
        return 'bg-blue-500/20 text-blue-400';
      case 'error':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-slate-500/20 text-slate-400';
    }
  };

  const text = () => {
    switch (state()) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting';
      case 'authenticating':
        return 'Authenticating';
      case 'error':
        return 'Error';
      default:
        return 'Disconnected';
    }
  };

  return (
    <span class={`px-2 py-1 rounded text-xs font-medium ${color()}`}>
      {text()}
    </span>
  );
}

function TunnelModeSelector() {
  const [customUrl, setCustomUrl] = createSignal(connectionConfig.config().customUrl);

  const handleModeChange = (mode: ConnectionMode) => {
    connectionConfig.setConfig({ mode });
    // Reconnect with new settings
    tunnel.disconnect();
    setTimeout(() => tunnel.connect(), 100);
  };

  const handleCustomUrlSave = () => {
    connectionConfig.setConfig({ customUrl: customUrl(), mode: 'custom' });
    tunnel.disconnect();
    setTimeout(() => tunnel.connect(), 100);
  };

  const currentMode = () => connectionConfig.config().mode;
  const currentUrl = () => connectionConfig.getWebSocketUrl();

  return (
    <div class="space-y-3 pt-3 border-t border-slate-700">
      <label class="block text-sm text-slate-300">Tunnel Server</label>

      {/* Radio options */}
      <div class="space-y-2">
        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="tunnel-mode"
            checked={currentMode() === 'auto'}
            onChange={() => handleModeChange('auto')}
            class="w-4 h-4 text-blue-500 bg-slate-700 border-slate-600"
          />
          <div>
            <span class="text-white">Auto</span>
            <p class="text-xs text-slate-500">Use current origin (where PWA is hosted)</p>
          </div>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="tunnel-mode"
            checked={currentMode() === 'production'}
            onChange={() => handleModeChange('production')}
            class="w-4 h-4 text-blue-500 bg-slate-700 border-slate-600"
          />
          <div>
            <span class="text-white">Production</span>
            <p class="text-xs text-slate-500">{CONNECTION_PRESETS.production}</p>
          </div>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="tunnel-mode"
            checked={currentMode() === 'localhost'}
            onChange={() => handleModeChange('localhost')}
            class="w-4 h-4 text-blue-500 bg-slate-700 border-slate-600"
          />
          <div>
            <span class="text-white">Localhost</span>
            <p class="text-xs text-slate-500">{CONNECTION_PRESETS.localhost}</p>
          </div>
        </label>

        <label class="flex items-center gap-3 cursor-pointer">
          <input
            type="radio"
            name="tunnel-mode"
            checked={currentMode() === 'custom'}
            onChange={() => handleModeChange('custom')}
            class="w-4 h-4 text-blue-500 bg-slate-700 border-slate-600"
          />
          <div>
            <span class="text-white">Custom URL</span>
          </div>
        </label>
      </div>

      {/* Custom URL input */}
      <Show when={currentMode() === 'custom'}>
        <div class="flex gap-2">
          <input
            type="text"
            value={customUrl()}
            onInput={(e) => setCustomUrl(e.currentTarget.value)}
            placeholder="ws://your-server:3001/ws"
            class="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleCustomUrlSave}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
          >
            Save
          </button>
        </div>
      </Show>

      {/* Current URL display */}
      <div class="pt-3 border-t border-slate-700">
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-400">Current URL</span>
          <code class="text-xs text-slate-500 bg-slate-900 px-2 py-1 rounded max-w-[200px] truncate">
            {currentUrl()}
          </code>
        </div>
      </div>
    </div>
  );
}
