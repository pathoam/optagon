import { For, Show } from 'solid-js';
import { tunnel } from '~/lib/tunnel';
import { FrameCard } from '~/components/FrameCard';

export function FrameList() {
  const frames = tunnel.frames;
  const state = tunnel.state;
  const serverConnected = tunnel.serverConnected;
  const error = tunnel.error;

  return (
    <div class="space-y-4">
      {/* Connection error state */}
      <Show when={state() === 'error'}>
        <div class="p-4 bg-red-900/30 border border-red-800 rounded-lg">
          <h2 class="font-medium text-red-300">Connection Error</h2>
          <p class="mt-1 text-sm text-red-400">{error()}</p>
          <button
            onClick={() => tunnel.connect()}
            class="mt-3 px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </Show>

      {/* Connecting state */}
      <Show when={state() === 'connecting' || state() === 'authenticating'}>
        <div class="p-4 bg-slate-800 border border-slate-700 rounded-lg">
          <div class="flex items-center gap-3">
            <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span class="text-slate-300">Connecting to server...</span>
          </div>
        </div>
      </Show>

      {/* Server offline state */}
      <Show when={state() === 'connected' && !serverConnected()}>
        <div class="p-4 bg-yellow-900/30 border border-yellow-800 rounded-lg">
          <h2 class="font-medium text-yellow-300">Server Offline</h2>
          <p class="mt-1 text-sm text-yellow-400">
            Your Optagon server at home isn't connected. Make sure it's running
            and has internet access.
          </p>
        </div>
      </Show>

      {/* Frame list */}
      <Show when={state() === 'connected' && serverConnected()}>
        <Show when={frames().length > 0} fallback={<EmptyState />}>
          <div class="grid gap-3">
            <For each={frames()}>{(frame) => <FrameCard frame={frame} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

function EmptyState() {
  return (
    <div class="text-center py-12">
      <div class="text-4xl mb-4">📦</div>
      <h2 class="text-lg font-medium text-slate-300">No frames yet</h2>
      <p class="mt-1 text-sm text-slate-500">
        Create a frame on your server to get started
      </p>
      <code class="mt-4 inline-block px-3 py-2 bg-slate-800 rounded text-sm text-slate-400">
        optagon frame create my-project
      </code>
    </div>
  );
}
