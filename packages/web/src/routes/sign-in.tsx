import { onMount, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { clerk, isSignedIn } from '~/lib/clerk';
import { tunnel } from '~/lib/tunnel';

export function SignIn() {
  const navigate = useNavigate();
  let containerRef: HTMLDivElement | undefined;
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    // If already signed in, redirect to home
    if (isSignedIn()) {
      tunnel.connect();
      navigate('/', { replace: true });
      return;
    }

    // Mount Clerk sign-in UI
    const clerkInstance = clerk();
    if (clerkInstance && containerRef) {
      clerkInstance.mountSignIn(containerRef, {
        afterSignInUrl: '/',
        signUpUrl: '/sign-up',
        appearance: {
          baseTheme: undefined,
          variables: {
            colorPrimary: '#3b82f6',
            colorBackground: '#1e293b',
            colorText: '#e2e8f0',
            colorInputBackground: '#0f172a',
            colorInputText: '#e2e8f0',
            borderRadius: '0.5rem',
          },
          elements: {
            rootBox: 'w-full',
            card: 'bg-slate-800 shadow-xl',
            headerTitle: 'text-white',
            headerSubtitle: 'text-slate-400',
            socialButtonsBlockButton: 'bg-slate-700 hover:bg-slate-600 text-white border-slate-600',
            formFieldLabel: 'text-slate-300',
            formFieldInput: 'bg-slate-900 border-slate-700 text-white',
            footerActionLink: 'text-blue-400 hover:text-blue-300',
            identityPreviewText: 'text-slate-300',
            identityPreviewEditButton: 'text-blue-400',
          },
        },
      });
    }

    // Listen for sign-in success
    const unsubscribe = clerkInstance?.addListener((resources) => {
      if (resources.session) {
        tunnel.connect();
        navigate('/', { replace: true });
      }
    });

    return () => {
      clerkInstance?.unmountSignIn(containerRef!);
      // Note: Clerk doesn't return an unsubscribe function in all versions
    };
  });

  return (
    <div class="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-900">
      <div class="w-full max-w-md">
        {/* Logo/header */}
        <div class="text-center mb-8">
          <h1 class="text-3xl font-bold text-white">Optagon</h1>
          <p class="mt-2 text-slate-400">
            Sign in to access your development frames
          </p>
        </div>

        {/* Error message */}
        <Show when={error()}>
          <div class="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-lg">
            <p class="text-sm text-red-300">{error()}</p>
          </div>
        </Show>

        {/* Clerk sign-in container */}
        <div ref={containerRef} class="clerk-container" />
      </div>
    </div>
  );
}
