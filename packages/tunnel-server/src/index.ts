/**
 * Optagon Tunnel Server
 *
 * Entry point for the tunnel relay service running on optagon.ai.
 */

import { startServer } from './server';

console.log('Starting Optagon Tunnel Server...');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

const server = startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});
