import { Show } from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import { clerk, signOut } from '~/lib/clerk';
import { tunnel } from '~/lib/tunnel';
import { Header } from '~/components/Header';

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

        {/* Connection section */}
        <section class="mb-8">
          <h2 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-3">
            Connection
          </h2>
          <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
            <div class="flex items-center justify-between">
              <span class="text-slate-300">Status</span>
              <ConnectionStatusBadge />
            </div>

            <div class="mt-3 flex items-center justify-between">
              <span class="text-slate-300">Server</span>
              <span class="text-slate-400 text-sm">
                {tunnel.serverConnected() ? 'Connected' : 'Offline'}
              </span>
            </div>

            <div class="mt-3 flex items-center justify-between">
              <span class="text-slate-300">Frames</span>
              <span class="text-slate-400 text-sm">
                {tunnel.frames().length} available
              </span>
            </div>

            <Show when={tunnel.state() === 'disconnected' || tunnel.state() === 'error'}>
              <button
                onClick={() => tunnel.connect()}
                class="mt-4 w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              >
                Reconnect
              </button>
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
