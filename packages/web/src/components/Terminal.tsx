import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { tunnel } from '~/lib/tunnel';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  frameId: string;
}

export function Terminal(props: TerminalProps) {
  let containerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let term: XTerm | undefined;
  let fitAddon: FitAddon | undefined;
  let session: ReturnType<typeof tunnel.openTerminal> | undefined;

  const [status, setStatus] = createSignal<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  onMount(() => {
    if (!containerRef) return;

    // Create terminal
    term = new XTerm({
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
        selectionBackground: 'rgba(255, 255, 255, 0.3)',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#ffffff',
      },
    });

    // Add fit addon
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Try WebGL addon for better performance
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch (e) {
      console.warn('[terminal] WebGL addon not available, using canvas');
    }

    // Open terminal in container
    term.open(containerRef);

    // Initial fit
    setTimeout(() => {
      fitAddon?.fit();
    }, 0);

    // Connect to frame terminal
    session = tunnel.openTerminal(props.frameId, {
      onData: (data) => {
        term?.write(data);
      },
      onOpened: (cols, rows) => {
        setStatus('connected');
        // Send initial size
        if (term) {
          session?.resize(term.cols, term.rows);
        }
      },
      onClose: () => {
        term?.write('\r\n\x1b[31m[Terminal closed]\x1b[0m\r\n');
      },
      onError: (message) => {
        setStatus('error');
        setErrorMessage(message);
        term?.write(`\r\n\x1b[31m[Error: ${message}]\x1b[0m\r\n`);
      },
    });

    // Send keyboard input to server
    term.onData((data) => {
      session?.write(data);
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && term) {
        fitAddon.fit();
        session?.resize(term.cols, term.rows);
      }
    });
    resizeObserver.observe(containerRef);

    // Focus terminal on click
    containerRef.addEventListener('click', () => {
      term?.focus();
    });

    onCleanup(() => {
      session?.close();
      resizeObserver.disconnect();
      term?.dispose();
    });
  });

  // Handle mobile input
  const handleMobileInput = (e: InputEvent) => {
    const input = e.currentTarget as HTMLInputElement;
    const data = input.value;
    if (data) {
      session?.write(data);
      input.value = '';
    }
  };

  const handleMobileKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      session?.write('\r');
      e.preventDefault();
    } else if (e.key === 'Backspace') {
      session?.write('\x7f');
      e.preventDefault();
    }
  };

  return (
    <div class="flex flex-col h-full">
      {/* Terminal status bar */}
      <Show when={status() === 'connecting'}>
        <div class="px-4 py-2 bg-slate-800 text-slate-400 text-sm">
          Connecting to terminal...
        </div>
      </Show>

      <Show when={status() === 'error'}>
        <div class="px-4 py-2 bg-red-900/50 text-red-300 text-sm">
          {errorMessage() || 'Terminal error'}
        </div>
      </Show>

      {/* Terminal container */}
      <div
        ref={containerRef}
        class="flex-1 min-h-0 bg-terminal-bg"
        style={{ padding: '8px' }}
      />

      {/* Mobile keyboard input */}
      <div class="md:hidden p-2 bg-slate-800 border-t border-slate-700">
        <input
          ref={inputRef}
          type="text"
          class="w-full bg-slate-900 text-white px-3 py-2 rounded border border-slate-700 focus:border-blue-500 focus:outline-none"
          placeholder="Type here for mobile input..."
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          onInput={handleMobileInput}
          onKeyDown={handleMobileKeyDown}
        />
      </div>
    </div>
  );
}
