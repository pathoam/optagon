import { createSignal, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { clerk, isSignedIn } from '~/lib/clerk';
import { tunnel } from '~/lib/tunnel';
import type { SignUpResource } from '@clerk/types';

export function Auth() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [code, setCode] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [mode, setMode] = createSignal<'initial' | 'signing-in' | 'signing-up' | 'verifying'>('initial');
  const [pendingSignUp, setPendingSignUp] = createSignal<SignUpResource | null>(null);

  onMount(() => {
    // If already signed in, redirect to home
    if (isSignedIn()) {
      tunnel.connect();
      navigate('/', { replace: true });
    }
  });

  // Handle GitHub OAuth
  async function handleGitHub() {
    setLoading(true);
    setError(null);
    try {
      const clerkInstance = clerk();
      if (!clerkInstance?.client) throw new Error('Auth not initialized');

      // Start OAuth flow
      const signIn = await clerkInstance.client.signIn.create({
        strategy: 'oauth_github',
        redirectUrl: window.location.origin + '/auth/callback',
        actionCompleteRedirectUrl: window.location.origin + '/',
      });

      // Redirect to GitHub
      const { externalVerificationRedirectURL } = signIn.firstFactorVerification;
      if (externalVerificationRedirectURL) {
        window.location.href = externalVerificationRedirectURL.toString();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'GitHub login failed');
      setLoading(false);
    }
  }

  // Handle email/password submit
  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!email() || !password()) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError(null);
    setMode('signing-in');

    const clerkInstance = clerk();
    if (!clerkInstance?.client) {
      setError('Auth not initialized');
      setLoading(false);
      return;
    }

    try {
      // Try to sign in first
      console.log('[auth] Attempting sign in for:', email());
      const signInAttempt = await clerkInstance.client!.signIn.create({
        identifier: email(),
        password: password(),
      });

      console.log('[auth] Sign in status:', signInAttempt.status);

      if (signInAttempt.status === 'complete') {
        // Sign in successful
        await clerkInstance.setActive({ session: signInAttempt.createdSessionId });
        tunnel.connect();
        navigate('/', { replace: true });
        return;
      }

      // Handle other statuses (like needs_second_factor)
      if (signInAttempt.status === 'needs_second_factor') {
        setError('2FA required - not yet supported');
        setLoading(false);
        return;
      }

      setError('Sign in incomplete');
      setLoading(false);
    } catch (signInError: any) {
      // Check if it's a "user not found" error - then try sign up
      const errorCode = signInError?.errors?.[0]?.code;
      const errorMessage = signInError?.errors?.[0]?.message || signInError?.message;

      if (errorCode === 'form_identifier_not_found' ||
          errorMessage?.toLowerCase().includes('not found') ||
          errorMessage?.toLowerCase().includes("couldn't find")) {
        // User doesn't exist - try to sign up
        await handleSignUp();
      } else if (errorCode === 'form_password_incorrect') {
        setError('Incorrect password');
        setLoading(false);
      } else {
        setError(errorMessage || 'Sign in failed');
        setLoading(false);
      }
    }
  }

  // Auto sign-up for new users
  async function handleSignUp() {
    setMode('signing-up');
    const clerkInstance = clerk();
    if (!clerkInstance?.client) {
      setError('Auth not initialized');
      setLoading(false);
      return;
    }

    try {
      const signUpAttempt = await clerkInstance.client!.signUp.create({
        emailAddress: email(),
        password: password(),
      });

      console.log('[auth] Sign up status:', signUpAttempt.status);

      if (signUpAttempt.status === 'complete') {
        // Sign up complete, set session
        await clerkInstance.setActive({ session: signUpAttempt.createdSessionId });
        tunnel.connect();
        navigate('/', { replace: true });
        return;
      }

      // Handle email verification required
      if (signUpAttempt.status === 'missing_requirements') {
        try {
          // Need to verify email - prepare verification
          await signUpAttempt.prepareEmailAddressVerification({ strategy: 'email_code' });
          setPendingSignUp(signUpAttempt);
          setMode('verifying');
          setLoading(false);
        } catch (prepareError: any) {
          console.error('[auth] Prepare verification error:', prepareError);
          setError(prepareError?.errors?.[0]?.message || 'Failed to send verification email');
          setLoading(false);
        }
        return;
      }

      setError(`Sign up status: ${signUpAttempt.status}`);
      setLoading(false);
    } catch (signUpError: any) {
      console.error('[auth] Sign up error:', signUpError);
      const errorMessage = signUpError?.errors?.[0]?.message || signUpError?.message;
      setError(errorMessage || 'Sign up failed');
      setLoading(false);
    }
  }

  // Handle verification code submission
  async function handleVerify(e: Event) {
    e.preventDefault();
    if (!code()) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    setError(null);

    const signUp = pendingSignUp();
    const clerkInstance = clerk();
    if (!signUp || !clerkInstance) {
      setError('Session expired, please try again');
      setMode('initial');
      setLoading(false);
      return;
    }

    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code() });

      if (result.status === 'complete') {
        await clerkInstance.setActive({ session: result.createdSessionId });
        tunnel.connect();
        navigate('/', { replace: true });
      } else {
        setError('Verification incomplete');
        setLoading(false);
      }
    } catch (verifyError: any) {
      const errorMessage = verifyError?.errors?.[0]?.message || verifyError?.message;
      setError(errorMessage || 'Verification failed');
      setLoading(false);
    }
  }

  // Resend verification code
  async function handleResend() {
    const signUp = pendingSignUp();
    if (!signUp) return;

    setLoading(true);
    setError(null);

    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setError(null);
      setLoading(false);
    } catch (e) {
      setError('Failed to resend code');
      setLoading(false);
    }
  }

  return (
    <div class="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-900">
      <div class="w-full max-w-sm">
        {/* Verification UI */}
        <Show when={mode() === 'verifying'}>
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold text-white">Verify your email</h1>
            <p class="mt-2 text-slate-400">
              We sent a code to <span class="text-white">{email()}</span>
            </p>
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg">
              <p class="text-sm text-red-300">{error()}</p>
            </div>
          </Show>

          <form onSubmit={handleVerify} class="space-y-4">
            <div>
              <label for="code" class="block text-sm font-medium text-slate-300 mb-1">
                Verification code
              </label>
              <input
                id="code"
                type="text"
                inputmode="numeric"
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
                disabled={loading()}
                class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 text-center text-2xl tracking-widest"
                placeholder="000000"
                autocomplete="one-time-code"
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading()}
              class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
            >
              {loading() ? 'Verifying...' : 'Verify'}
            </button>
          </form>

          <div class="mt-4 text-center">
            <button
              type="button"
              onClick={handleResend}
              disabled={loading()}
              class="text-sm text-slate-400 hover:text-white disabled:opacity-50"
            >
              Didn't get the code? Resend
            </button>
          </div>

          <div class="mt-4 text-center">
            <button
              type="button"
              onClick={() => { setMode('initial'); setError(null); }}
              class="text-sm text-slate-500 hover:text-slate-300"
            >
              ← Back
            </button>
          </div>
        </Show>

        {/* Main auth UI */}
        <Show when={mode() !== 'verifying'}>
          <div class="text-center mb-8">
            <h1 class="text-3xl font-bold text-white">Optagon</h1>
            <p class="mt-2 text-slate-400">
              Access your development frames
            </p>
          </div>

          <Show when={error()}>
            <div class="mb-4 p-3 bg-red-900/30 border border-red-800 rounded-lg">
              <p class="text-sm text-red-300">{error()}</p>
            </div>
          </Show>

          <button
            type="button"
            onClick={handleGitHub}
            disabled={loading()}
            class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded-lg text-white font-medium transition-colors"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            Continue with GitHub
          </button>

          <div class="relative my-6">
            <div class="absolute inset-0 flex items-center">
              <div class="w-full border-t border-slate-700"></div>
            </div>
            <div class="relative flex justify-center text-sm">
              <span class="px-2 bg-slate-900 text-slate-500">or</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} class="space-y-4">
            <div>
              <label for="email" class="block text-sm font-medium text-slate-300 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                disabled={loading()}
                class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="you@example.com"
                autocomplete="email"
              />
            </div>

            <div>
              <label for="password" class="block text-sm font-medium text-slate-300 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                disabled={loading()}
                class="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading()}
              class="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
            >
              <Show when={loading()} fallback="Continue">
                <Show when={mode() === 'signing-up'} fallback="Signing in...">
                  Creating account...
                </Show>
              </Show>
            </button>
          </form>

          <p class="mt-6 text-center text-sm text-slate-500">
            New here? Just enter your email and password to create an account.
          </p>
        </Show>
      </div>
    </div>
  );
}
