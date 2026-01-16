import { Clerk } from '@clerk/clerk-js';
import { createSignal } from 'solid-js';

const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);
const [signedIn, setSignedIn] = createSignal(false);

export async function initClerk(): Promise<Clerk> {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not set');
  }

  const clerk = new Clerk(publishableKey);
  await clerk.load();

  setClerkInstance(clerk);
  setSignedIn(!!clerk.session);

  // Listen for auth changes
  clerk.addListener((resources) => {
    setSignedIn(!!resources.session);
  });

  return clerk;
}

export function clerk() {
  return clerkInstance();
}

export function isSignedIn() {
  return signedIn();
}

export async function signOut() {
  const instance = clerkInstance();
  if (instance) {
    await instance.signOut();
  }
}

export async function getToken(): Promise<string | null> {
  const instance = clerkInstance();
  if (!instance?.session) return null;
  return instance.session.getToken();
}
