import { A } from '@solidjs/router';
import type { FrameSummary } from '@optagon/protocol';

interface FrameCardProps {
  frame: FrameSummary;
}

export function FrameCard(props: FrameCardProps) {
  const frame = () => props.frame;

  const statusColor = () => {
    switch (frame().status) {
      case 'running':
        return 'bg-green-500';
      case 'stopped':
        return 'bg-slate-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-slate-500';
    }
  };

  const statusText = () => {
    switch (frame().status) {
      case 'running':
        return 'Running';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <A
      href={`/frame/${frame().id}`}
      class="block p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
    >
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-2">
          <span class={`w-2 h-2 rounded-full ${statusColor()}`} />
          <h3 class="font-medium text-white">{frame().name}</h3>
        </div>
      </div>

      <p class="mt-1 text-sm text-slate-400 truncate">{frame().workspace}</p>

      <div class="mt-3 flex items-center gap-3 text-xs text-slate-500">
        <span>{statusText()}</span>
        {frame().ports.length > 0 && (
          <span>
            {frame().ports.length} port{frame().ports.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </A>
  );
}
