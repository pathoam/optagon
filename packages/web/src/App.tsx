import { createSignal, onMount, Show, Suspense } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { initClerk, isSignedIn, clerk } from '~/lib/clerk';
import { tunnel } from '~/lib/tunnel';
import { Header } from '~/components/Header';
import { FrameList } from '~/routes/index';
import { FrameTerminal } from '~/routes/frame/[id]';
import { Auth } from '~/routes/auth';
import { Settings } from '~/routes/settings';

// Loading component
function Loading() {
  return (
    <div class="flex items-center justify-center min-h-screen">
      <div class="text-slate-400">Loading...</div>
    </div>
  );
}

// Error component
function ErrorDisplay(props: { message: string }) {
  return (
    <div class="flex items-center justify-center min-h-screen">
      <div class="text-red-400">Error: {props.message}</div>
    </div>
  );
}

// Protected wrapper that redirects to auth if not authenticated
function Protected(props: { children: any }) {
  return (
    <Show when={isSignedIn()} fallback={<Navigate href="/auth" />}>
      {props.children}
    </Show>
  );
}

// Frame list page with header
function FrameListPage() {
  return (
    <Protected>
      <Header />
      <main class="p-4">
        <FrameList />
      </main>
    </Protected>
  );
}

// Protected frame terminal
function ProtectedFrameTerminal() {
  return (
    <Protected>
      <FrameTerminal />
    </Protected>
  );
}

// Protected settings
function ProtectedSettings() {
  return (
    <Protected>
      <Header />
      <Settings />
    </Protected>
  );
}

// Root layout component that handles app initialization
export default function App(props: { children?: any }) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      await initClerk();

      // Set up token getter for tunnel
      tunnel.setTokenGetter(async () => {
        const session = clerk()?.session;
        if (!session) return null;
        return session.getToken();
      });

      // Connect to tunnel if signed in
      if (isSignedIn()) {
        tunnel.connect();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to initialize');
    } finally {
      setLoading(false);
    }
  });

  return (
    <div class="min-h-screen bg-slate-900 text-slate-100">
      <Show when={loading()}>
        <Loading />
      </Show>

      <Show when={!loading() && error()}>
        <ErrorDisplay message={error()!} />
      </Show>

      <Show when={!loading() && !error()}>
        <Suspense fallback={<Loading />}>
          {props.children}
        </Suspense>
      </Show>
    </div>
  );
}

// Route definitions - exported for use in index.tsx
export const routes = [
  {
    path: '/',
    component: FrameListPage,
  },
  {
    path: '/frame/:id',
    component: ProtectedFrameTerminal,
  },
  {
    path: '/settings',
    component: ProtectedSettings,
  },
  {
    path: '/auth',
    component: Auth,
  },
  {
    path: '/auth/callback',
    component: Auth, // OAuth callback returns here
  },
  // Redirects for old routes
  {
    path: '/sign-in',
    component: () => <Navigate href="/auth" />,
  },
  {
    path: '/sign-up',
    component: () => <Navigate href="/auth" />,
  },
];
