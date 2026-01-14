/**
 * Authentication Module
 *
 * Handles Clerk JWT verification and user management.
 */

import { createClerkClient, verifyToken } from '@clerk/backend';

// Clerk client - initialized from environment variables
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  servers: RegisteredServer[];
}

export interface RegisteredServer {
  id: string;
  name: string;
  publicKey: string;
  registeredAt: string;
  lastSeen?: string;
}

/**
 * Verify a Clerk JWT token and return the user info
 */
export async function verifyClerkToken(token: string): Promise<AuthenticatedUser | null> {
  try {
    // Verify the JWT
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (!payload || !payload.sub) {
      return null;
    }

    // Get user details from Clerk
    const user = await clerkClient.users.getUser(payload.sub);

    // Extract registered servers from user metadata
    const servers: RegisteredServer[] =
      (user.publicMetadata?.servers as RegisteredServer[]) || [];

    return {
      userId: payload.sub,
      email: user.emailAddresses?.[0]?.emailAddress,
      servers,
    };
  } catch (error) {
    console.error('[auth] Token verification failed:', error);
    return null;
  }
}

/**
 * Register a new server for a user
 */
export async function registerServer(
  userId: string,
  serverName: string,
  publicKey: string
): Promise<RegisteredServer> {
  // Get current user
  const user = await clerkClient.users.getUser(userId);

  // Get existing servers
  const servers: RegisteredServer[] =
    (user.publicMetadata?.servers as RegisteredServer[]) || [];

  // Check if server with this public key already exists
  const existing = servers.find(s => s.publicKey === publicKey);
  if (existing) {
    return existing;
  }

  // Create new server entry
  const newServer: RegisteredServer = {
    id: `srv_${crypto.randomUUID().slice(0, 8)}`,
    name: serverName,
    publicKey,
    registeredAt: new Date().toISOString(),
  };

  // Update user metadata
  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      ...user.publicMetadata,
      servers: [...servers, newServer],
    },
  });

  console.log(`[auth] Registered server '${serverName}' for user ${userId}`);

  return newServer;
}

/**
 * Update server last seen time
 */
export async function updateServerLastSeen(
  userId: string,
  serverId: string
): Promise<void> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const servers: RegisteredServer[] =
      (user.publicMetadata?.servers as RegisteredServer[]) || [];

    const serverIndex = servers.findIndex(s => s.id === serverId);
    if (serverIndex === -1) return;

    servers[serverIndex].lastSeen = new Date().toISOString();

    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        servers,
      },
    });
  } catch (error) {
    console.error('[auth] Failed to update server last seen:', error);
  }
}

/**
 * Remove a server from user's registered servers
 */
export async function removeServer(
  userId: string,
  serverId: string
): Promise<boolean> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const servers: RegisteredServer[] =
      (user.publicMetadata?.servers as RegisteredServer[]) || [];

    const filtered = servers.filter(s => s.id !== serverId);

    if (filtered.length === servers.length) {
      return false; // Server not found
    }

    await clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: {
        ...user.publicMetadata,
        servers: filtered,
      },
    });

    console.log(`[auth] Removed server ${serverId} for user ${userId}`);
    return true;
  } catch (error) {
    console.error('[auth] Failed to remove server:', error);
    return false;
  }
}

/**
 * Get a user's registered servers
 */
export async function getUserServers(userId: string): Promise<RegisteredServer[]> {
  try {
    const user = await clerkClient.users.getUser(userId);
    return (user.publicMetadata?.servers as RegisteredServer[]) || [];
  } catch (error) {
    console.error('[auth] Failed to get user servers:', error);
    return [];
  }
}

/**
 * Verify a server connection using Ed25519 signature
 */
export async function verifyServerSignature(
  serverId: string,
  timestamp: number,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    // Check timestamp is recent (within 5 minutes)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      console.log('[auth] Signature timestamp too old');
      return false;
    }

    // Construct the message that was signed
    const message = `${serverId}:${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);

    // Decode the public key and signature from base64
    const publicKeyBytes = Buffer.from(publicKey, 'base64');
    const signatureBytes = Buffer.from(signature, 'base64');

    // Import the public key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    // Verify the signature
    const valid = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signatureBytes,
      messageBytes
    );

    return valid;
  } catch (error) {
    console.error('[auth] Signature verification failed:', error);
    return false;
  }
}

/**
 * Find which user owns a server by ID
 */
export async function findServerOwner(
  serverId: string
): Promise<{ userId: string; server: RegisteredServer } | null> {
  // Note: In production, you'd want to maintain an index for this
  // For now, we'd need to search through users, which isn't efficient
  // This is a limitation we'll address with a proper database later
  console.warn('[auth] findServerOwner: Not implemented efficiently yet');
  return null;
}

/**
 * Check if Clerk is configured
 */
export function isClerkConfigured(): boolean {
  return !!(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
}
