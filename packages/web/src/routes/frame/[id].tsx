import { Show, createMemo } from 'solid-js';
import { useParams, A } from '@solidjs/router';
import { tunnel } from '~/lib/tunnel';
import { Terminal } from '~/components/Terminal';
import { Header } from '~/components/Header';

export function FrameTerminal() {
  const params = useParams<{ id: string }>();

  const frame = createMemo(() => {
    return tunnel.frames().find((f) => f.id === params.id);
  });

  return (
    <div class="flex flex-col h-screen">
      {/* Custom header for terminal view */}
      <header class="flex-none bg-slate-800 border-b border-slate-700">
        <div class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-3">
            <A
              href="/"
              class="p-1 text-slate-400 hover:text-white transition-colors"
              aria-label="Back to frame list"
            >
              <BackIcon />
            </A>
            <div>
              <h1 class="font-medium text-white">
                {frame()?.name || 'Terminal'}
              </h1>
              <Show when={frame()}>
                <p class="text-xs text-slate-500 truncate max-w-[200px]">
                  {frame()!.workspace}
                </p>
              </Show>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <Show when={frame()}>
              <FrameStatus status={frame()!.status} />
            </Show>
          </div>
        </div>
      </header>

      {/* Terminal content */}
      <div class="flex-1 min-h-0">
        <Show
          when={frame()}
          fallback={
            <div class="flex items-center justify-center h-full">
              <div class="text-center">
                <p class="text-slate-400">Frame not found</p>
                <A href="/" class="mt-4 inline-block text-blue-400 hover:underline">
                  Back to frames
                </A>
              </div>
            </div>
          }
        >
          <Show
            when={frame()!.status === 'running'}
            fallback={
              <div class="flex items-center justify-center h-full">
                <div class="text-center">
                  <p class="text-slate-400">Frame is not running</p>
                  <p class="mt-2 text-sm text-slate-500">
                    Start the frame from your server to access the terminal
                  </p>
                  <code class="mt-4 inline-block px-3 py-2 bg-slate-800 rounded text-sm text-slate-400">
                    optagon frame start {frame()!.name}
                  </code>
                </div>
              </div>
            }
          >
            <Terminal frameId={params.id} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

function FrameStatus(props: { status: 'running' | 'stopped' | 'error' }) {
  const color = () => {
    switch (props.status) {
      case 'running':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-slate-500';
      case 'error':
        return 'bg-red-500';
    }
  };

  const text = () => {
    switch (props.status) {
      case 'running':
        return 'Running';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return 'Error';
    }
  };

  return (
    <div class="flex items-center gap-2 text-xs text-slate-400">
      <span class={`w-2 h-2 rounded-full ${color()}`} />
      <span>{text()}</span>
    </div>
  );
}

function BackIcon() {
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
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
