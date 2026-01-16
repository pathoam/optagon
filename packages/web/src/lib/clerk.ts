import { Clerk } from '@clerk/clerk-js';
import { createSignal } from 'solid-js';

const [clerkInstance, setClerkInstance] = createSignal<Clerk | null>(null);
const [signedIn, setSignedIn] = createSignal(false);

// Fetch public config from server (runtime, not build-time)
async function fetchConfig(): Promise<{ clerkPublishableKey: string | null }> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error('Failed to fetch config');
  }
  return response.json();
}

export async function initClerk(): Promise<Clerk> {
  // Fetch config from server at runtime
  const config = await fetchConfig();
  const publishableKey = config.clerkPublishableKey;

  if (!publishableKey) {
    throw new Error('Clerk publishable key not configured on server');
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
