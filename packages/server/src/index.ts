#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import { execSync, spawn } from 'child_process';
import { basename, resolve, join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { getFrameManager } from './services/frame-manager.js';
import { getContainerRuntime } from './services/container-runtime.js';
import { getPortAllocator } from './services/port-allocator.js';
import { getConfigManager } from './services/config-manager.js';
import { createTunnelClient, getTunnelClient, destroyTunnelClient, type TunnelStatus } from './tunnel/index.js';
import type { FrameStatus } from './types/index.js';

const program = new Command();

program
  .name('optagon')
  .description('Personal software development server with isolated frames')
  .version('0.1.0');

// Helper: Find frame by current directory
function findFrameByWorkspace(): string | null {
  const cwd = resolve(process.cwd());
  const manager = getFrameManager();
  const frames = manager.listFrames();

  for (const frame of frames) {
    if (resolve(frame.workspacePath) === cwd) {
      return frame.name;
    }
  }
  return null;
}

// Helper: Resolve frame name (from arg or current directory)
function resolveFrameName(name?: string): string {
  if (name) return name;

  const found = findFrameByWorkspace();
  if (found) return found;

  console.error(chalk.red('No frame specified and current directory is not a frame workspace.'));
  console.error(chalk.yellow('Either specify a frame name or run from a workspace directory.'));
  process.exit(1);
}

// ===================
// SIMPLIFIED COMMANDS
// ===================

// optagon init [name] - Create frame for current directory
program
  .command('init [name]')
  .description('Initialize a frame for the current directory')
  .option('-d, --description <text>', 'Frame description')
  .action(async (name: string | undefined, options: { description?: string }) => {
    try {
      const cwd = resolve(process.cwd());
      const frameName = name || basename(cwd);

      // Check if frame already exists for this directory
      const existing = findFrameByWorkspace();
      if (existing) {
        console.log(chalk.yellow(`Frame '${existing}' already exists for this directory.`));
        console.log(chalk.cyan(`Use 'optagon start' to start it.`));
        return;
      }

      const manager = getFrameManager();
      const frame = await manager.createFrame({
        name: frameName,
        workspacePath: cwd,
        description: options.description,
      });

      console.log(chalk.green(`Frame '${frame.name}' initialized!`));
      console.log();
      console.log(`  Workspace: ${frame.workspacePath}`);
      console.log(`  Port: ${frame.hostPort}`);
      console.log();
      console.log(chalk.cyan('Start with: optagon start'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon start [name] - Start frame and attach
program
  .command('start [name]')
  .description('Start a frame (auto-detects from current directory)')
  .option('--no-attach', 'Start without attaching to tmux')
  .action(async (name: string | undefined, options: { attach: boolean }) => {
    try {
      const frameName = resolveFrameName(name);
      const manager = getFrameManager();

      // Check current status
      const frame = manager.getFrame(frameName);
      if (!frame) {
        console.error(chalk.red(`Frame not found: ${frameName}`));
        process.exit(1);
      }

      if (frame.status === 'running') {
        console.log(chalk.yellow(`Frame '${frameName}' is already running.`));
        if (options.attach) {
          console.log(chalk.blue('Attaching...'));
          const cmd = manager.getTmuxAttachCommand(frameName);
          execSync(cmd, { stdio: 'inherit' });
        }
        return;
      }

      // Check if image exists
      const runtime = getContainerRuntime();
      const imageExists = await runtime.imageExists();
      if (!imageExists) {
        console.log(chalk.yellow('Frame image not found. Building...'));
        console.log(chalk.dim('This may take a few minutes on first run.'));
        // Could auto-build here, but for now just error
        console.log(chalk.cyan('Run: cd ~/optagon/optagon-server && podman build -t optagon/frame:latest -f Dockerfile.frame .'));
        process.exit(1);
      }

      console.log(chalk.blue(`Starting frame '${frameName}'...`));
      await manager.startFrame(frameName);
      console.log(chalk.green('Frame started!'));

      if (options.attach) {
        console.log(chalk.blue('Attaching to tmux session...'));
        console.log(chalk.dim('(Detach with Ctrl+b, then d)'));
        console.log();

        // Small delay to let tmux start
        await new Promise(r => setTimeout(r, 500));

        const cmd = manager.getTmuxAttachCommand(frameName);
        execSync(cmd, { stdio: 'inherit' });
      } else {
        console.log();
        console.log(chalk.cyan('Attach with: optagon attach'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon attach [name] - Attach to running frame
program
  .command('attach [name]')
  .description('Attach to a running frame')
  .action((name: string | undefined) => {
    try {
      const frameName = resolveFrameName(name);
      const manager = getFrameManager();

      const frame = manager.getFrame(frameName);
      if (!frame) {
        console.error(chalk.red(`Frame not found: ${frameName}`));
        process.exit(1);
      }

      if (frame.status !== 'running') {
        console.error(chalk.red(`Frame '${frameName}' is not running.`));
        console.log(chalk.cyan('Start it with: optagon start'));
        process.exit(1);
      }

      console.log(chalk.dim('(Detach with Ctrl+b, then d)'));
      const cmd = manager.getTmuxAttachCommand(frameName);
      execSync(cmd, { stdio: 'inherit' });
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon stop [name] - Stop a frame
program
  .command('stop [name]')
  .description('Stop a running frame')
  .action(async (name: string | undefined) => {
    try {
      const frameName = resolveFrameName(name);
      const manager = getFrameManager();

      console.log(chalk.blue(`Stopping frame '${frameName}'...`));
      await manager.stopFrame(frameName);
      console.log(chalk.green('Frame stopped.'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon restart [name] - Restart a frame
program
  .command('restart [name]')
  .description('Restart a frame (use --purge to recreate container with new image)')
  .option('--purge', 'Destroy and recreate container (use after image rebuild)')
  .option('--no-attach', 'Restart without attaching to tmux')
  .action(async (name: string | undefined, options: { purge?: boolean; attach: boolean }) => {
    try {
      const frameName = resolveFrameName(name);
      const manager = getFrameManager();

      const frame = manager.getFrame(frameName);
      if (!frame) {
        console.error(chalk.red(`Frame not found: ${frameName}`));
        process.exit(1);
      }

      if (options.purge) {
        // Purge: destroy container and recreate
        console.log(chalk.blue(`Purging frame '${frameName}'...`));

        // Stop if running
        if (frame.status === 'running') {
          console.log(chalk.dim('Stopping...'));
          await manager.stopFrame(frameName);
        }

        // Destroy (force since we just stopped it)
        console.log(chalk.dim('Removing container...'));
        await manager.destroyFrame(frameName, true);

        // Recreate with same settings
        console.log(chalk.dim('Recreating frame...'));
        await manager.createFrame({
          name: frame.name,
          workspacePath: frame.workspacePath,
          description: frame.description,
        });

        // Start
        console.log(chalk.dim('Starting...'));
        await manager.startFrame(frameName);
        console.log(chalk.green('Frame purged and restarted!'));
      } else {
        // Simple restart: stop + start
        if (frame.status === 'running') {
          console.log(chalk.blue(`Restarting frame '${frameName}'...`));
          await manager.stopFrame(frameName);
        } else {
          console.log(chalk.blue(`Starting frame '${frameName}'...`));
        }
        await manager.startFrame(frameName);
        console.log(chalk.green('Frame restarted!'));
      }

      if (options.attach) {
        console.log(chalk.blue('Attaching to tmux session...'));
        console.log(chalk.dim('(Detach with Ctrl+b, then d)'));
        console.log();

        await new Promise(r => setTimeout(r, 500));
        const cmd = manager.getTmuxAttachCommand(frameName);
        execSync(cmd, { stdio: 'inherit' });
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon list - List all frames (shortcut)
program
  .command('list')
  .alias('ls')
  .description('List all frames')
  .action(() => {
    try {
      const manager = getFrameManager();
      const frames = manager.listFrames();

      if (frames.length === 0) {
        console.log(chalk.yellow('No frames found.'));
        console.log(chalk.cyan('Create one with: optagon init'));
        return;
      }

      console.log(chalk.bold('Frames:'));
      console.log();

      for (const frame of frames) {
        const statusColor = getStatusColor(frame.status);
        const indicator = frame.status === 'running' ? chalk.green('●') : chalk.dim('○');
        const tiltPort = frame.hostPort ? frame.hostPort + 1000 : null;

        console.log(
          `  ${indicator} ${chalk.bold(frame.name)} ` +
          `${statusColor(`[${frame.status}]`)}`
        );
        console.log(`    ${chalk.dim(frame.workspacePath)}`);

        if (frame.hostPort && frame.status === 'running') {
          console.log(`    ${chalk.cyan(`http://localhost:${frame.hostPort}`)} ${chalk.dim('(dev)')}`);
          console.log(`    ${chalk.cyan(`http://localhost:${tiltPort}`)} ${chalk.dim('(tilt)')}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon config - Manage configuration
const config = program.command('config').description('Manage optagon configuration');

config
  .command('set <key> <value>')
  .description('Set a config value (e.g., openrouter_api_key)')
  .action((key: string, value: string) => {
    try {
      const configManager = getConfigManager();
      configManager.set(key, value);
      console.log(chalk.green(`Config '${key}' updated.`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

config
  .command('get <key>')
  .description('Get a config value')
  .action((key: string) => {
    try {
      const configManager = getConfigManager();
      const value = configManager.get(key);
      if (value !== undefined) {
        // Mask sensitive values
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
          console.log(`${key}: ${value.slice(0, 8)}...${value.slice(-4)}`);
        } else {
          console.log(`${key}: ${value}`);
        }
      } else {
        console.log(chalk.yellow(`Config '${key}' not set.`));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

config
  .command('list')
  .description('List all config values')
  .action(() => {
    try {
      const configManager = getConfigManager();
      const all = configManager.getAll();

      if (Object.keys(all).length === 0) {
        console.log(chalk.yellow('No configuration set.'));
        console.log(chalk.cyan('Set OpenRouter key: optagon config set openrouter_api_key sk-or-...'));
        return;
      }

      console.log(chalk.bold('Configuration:'));
      for (const [key, value] of Object.entries(all)) {
        // Mask sensitive values
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('secret')) {
          console.log(`  ${key}: ${String(value).slice(0, 8)}...${String(value).slice(-4)}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon build - Build the frame container image
program
  .command('build')
  .description('Build the frame container image')
  .option('--no-cache', 'Build without using cache')
  .action(async (options: { cache: boolean }) => {
    try {
      const runtime = getContainerRuntime();
      const runtimeName = runtime.getRuntime();

      // Find the Dockerfile
      const dockerfilePath = resolve(import.meta.dir, '../Dockerfile.frame');
      const contextPath = resolve(import.meta.dir, '..');

      if (!existsSync(dockerfilePath)) {
        console.error(chalk.red('Dockerfile.frame not found at:'), dockerfilePath);
        process.exit(1);
      }

      console.log(chalk.blue('Building frame image...'));
      console.log(chalk.dim(`Using ${runtimeName}, this may take a few minutes.`));
      console.log();

      const args = ['build', '-t', 'optagon/frame:latest', '-f', dockerfilePath];
      if (!options.cache) {
        args.push('--no-cache');
      }
      args.push(contextPath);

      execSync(`${runtimeName} ${args.join(' ')}`, {
        stdio: 'inherit',
        cwd: contextPath,
      });

      console.log();
      console.log(chalk.green('Frame image built successfully!'));
    } catch (error) {
      console.error(chalk.red('Build failed:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Frame commands
const frame = program.command('frame').description('Manage development frames');

// Create frame
frame
  .command('create <name>')
  .description('Create a new frame')
  .requiredOption('-w, --workspace <path>', 'Path to workspace directory')
  .option('-d, --description <text>', 'Frame description')
  .action(async (name: string, options: { workspace: string; description?: string }) => {
    try {
      const manager = getFrameManager();
      const frame = await manager.createFrame({
        name,
        workspacePath: options.workspace,
        description: options.description,
      });

      console.log(chalk.green('Frame created successfully!'));
      console.log();
      printFrame(frame);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Start frame
frame
  .command('start <name>')
  .description('Start a frame')
  .action(async (name: string) => {
    try {
      const manager = getFrameManager();

      // Check if image exists
      const runtime = getContainerRuntime();
      const imageExists = await runtime.imageExists();
      if (!imageExists) {
        console.log(chalk.yellow('Frame image not found. Please build it first:'));
        console.log(chalk.cyan('  cd optagon-server && podman build -t optagon/frame:latest -f Dockerfile.frame .'));
        process.exit(1);
      }

      console.log(chalk.blue('Starting frame...'));
      const frame = await manager.startFrame(name);

      console.log(chalk.green('Frame started!'));
      console.log();
      printFrame(frame);
      console.log();
      console.log(chalk.cyan('To attach to this frame:'));
      console.log(`  ${manager.getTmuxAttachCommand(name)}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Stop frame
frame
  .command('stop <name>')
  .description('Stop a running frame')
  .action(async (name: string) => {
    try {
      const manager = getFrameManager();
      console.log(chalk.blue('Stopping frame...'));
      const frame = await manager.stopFrame(name);

      console.log(chalk.green('Frame stopped!'));
      console.log();
      printFrame(frame);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// List frames
frame
  .command('list')
  .alias('ls')
  .description('List all frames')
  .option('-s, --status <status>', 'Filter by status')
  .action((options: { status?: FrameStatus }) => {
    try {
      const manager = getFrameManager();
      const frames = manager.listFrames(options.status);

      if (frames.length === 0) {
        console.log(chalk.yellow('No frames found.'));
        console.log(chalk.cyan('Create one with: optagon frame create <name> -w /path/to/workspace'));
        return;
      }

      console.log(chalk.bold('Frames:'));
      console.log();

      for (const frame of frames) {
        const statusColor = getStatusColor(frame.status);
        console.log(
          `  ${chalk.bold(frame.name)} ` +
          `${statusColor(`[${frame.status}]`)} ` +
          `${chalk.dim(`port:${frame.hostPort || 'none'}`)}`
        );
        console.log(`    ${chalk.dim(frame.workspacePath)}`);
        if (frame.description) {
          console.log(`    ${chalk.italic(frame.description)}`);
        }
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Show frame details
frame
  .command('show <name>')
  .description('Show frame details')
  .action((name: string) => {
    try {
      const manager = getFrameManager();
      const frame = manager.getFrame(name);

      if (!frame) {
        console.error(chalk.red(`Frame not found: ${name}`));
        process.exit(1);
      }

      printFrame(frame);

      console.log();
      console.log(chalk.bold('Attach command:'));
      console.log(`  ${manager.getTmuxAttachCommand(name)}`);

      if (frame.hostPort) {
        console.log();
        console.log(chalk.bold('Dev server URL:'));
        console.log(`  http://localhost:${frame.hostPort}`);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Attach to frame
frame
  .command('attach <name>')
  .description('Print command to attach to frame tmux session')
  .action((name: string) => {
    try {
      const manager = getFrameManager();
      const frame = manager.getFrame(name);

      if (!frame) {
        console.error(chalk.red(`Frame not found: ${name}`));
        process.exit(1);
      }

      if (frame.status !== 'running') {
        console.error(chalk.red(`Frame '${name}' is not running. Start it first.`));
        process.exit(1);
      }

      console.log(manager.getTmuxAttachCommand(name));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Destroy frame
frame
  .command('destroy <name>')
  .description('Destroy a frame (removes container and data)')
  .option('-f, --force', 'Force destroy even if running')
  .action(async (name: string, options: { force?: boolean }) => {
    try {
      const manager = getFrameManager();

      console.log(chalk.blue('Destroying frame...'));
      await manager.destroyFrame(name, options.force);

      console.log(chalk.green(`Frame '${name}' destroyed.`));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Events
frame
  .command('events <name>')
  .description('Show frame events')
  .option('-n, --limit <count>', 'Number of events to show', '20')
  .action((name: string, options: { limit: string }) => {
    try {
      const manager = getFrameManager();
      const events = manager.getFrameEvents(name, parseInt(options.limit, 10));

      if (events.length === 0) {
        console.log(chalk.yellow('No events found.'));
        return;
      }

      console.log(chalk.bold('Recent events:'));
      console.log();

      for (const event of events) {
        const date = event.createdAt.toLocaleString();
        console.log(`  ${chalk.dim(date)} ${chalk.bold(event.eventType)}`);
        if (event.details) {
          console.log(`    ${chalk.dim(JSON.stringify(event.details))}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show overall status')
  .action(() => {
    try {
      const manager = getFrameManager();
      const portAllocator = getPortAllocator();
      const runtime = getContainerRuntime();

      const frames = manager.listFrames();
      const runningCount = frames.filter(f => f.status === 'running').length;
      const availablePorts = portAllocator.getAvailableCount();

      console.log(chalk.bold('Optagon Status'));
      console.log();
      console.log(`  Container runtime: ${chalk.cyan(runtime.getRuntime())}`);
      console.log(`  Total frames: ${chalk.cyan(frames.length.toString())}`);
      console.log(`  Running: ${chalk.green(runningCount.toString())}`);
      console.log(`  Available ports: ${chalk.cyan(availablePorts.toString())}`);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// Helper functions
function printFrame(frame: any) {
  const statusColor = getStatusColor(frame.status);
  const tiltPort = frame.hostPort ? frame.hostPort + 1000 : null;

  console.log(chalk.bold('Frame Details:'));
  console.log(`  Name: ${chalk.cyan(frame.name)}`);
  console.log(`  ID: ${chalk.dim(frame.id)}`);
  console.log(`  Status: ${statusColor(frame.status)}`);
  console.log(`  Workspace: ${frame.workspacePath}`);
  if (frame.description) {
    console.log(`  Description: ${frame.description}`);
  }
  console.log(`  Dev Server: ${frame.hostPort ? `http://localhost:${frame.hostPort}` : 'none'}`);
  if (tiltPort) {
    console.log(`  Tilt UI: http://localhost:${tiltPort}`);
  }
  console.log(`  Graphiti Group: ${chalk.dim(frame.graphitiGroupId)}`);
  if (frame.containerId) {
    console.log(`  Container ID: ${chalk.dim(frame.containerId)}`);
  }
  console.log(`  Created: ${frame.createdAt.toLocaleString()}`);
}

function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'running':
      return chalk.green;
    case 'stopped':
      return chalk.gray;
    case 'starting':
    case 'stopping':
      return chalk.yellow;
    case 'error':
      return chalk.red;
    case 'created':
      return chalk.blue;
    default:
      return chalk.white;
  }
}

// ===================
// TUNNEL COMMANDS
// ===================

const TUNNEL_CONFIG_PATH = join(homedir(), '.optagon', 'tunnel.json');

interface TunnelConfig {
  serverId?: string;
  serverName: string;
  relayUrl: string;
  enabled: boolean;
  publicKey?: string;   // Base64 encoded Ed25519 public key
  privateKey?: string;  // Base64 encoded Ed25519 private key
}

function loadTunnelConfig(): TunnelConfig | null {
  try {
    if (existsSync(TUNNEL_CONFIG_PATH)) {
      return JSON.parse(readFileSync(TUNNEL_CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function saveTunnelConfig(config: TunnelConfig): void {
  const dir = join(homedir(), '.optagon');
  mkdirSync(dir, { recursive: true });
  writeFileSync(TUNNEL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

const tunnel = program.command('tunnel').description('Manage remote access tunnel to optagon.ai');

// optagon tunnel setup - Initial tunnel configuration
tunnel
  .command('setup')
  .description('Configure tunnel connection to optagon.ai')
  .option('-n, --name <name>', 'Server name', 'home-server')
  .option('-u, --url <url>', 'Relay URL', 'wss://optagon.ai/tunnel')
  .action(async (options: { name: string; url: string }) => {
    try {
      let config = loadTunnelConfig();

      if (config) {
        console.log(chalk.yellow('Tunnel already configured.'));
        console.log(`  Server ID: ${chalk.cyan(config.serverId || 'not registered')}`);
        console.log(`  Server Name: ${chalk.cyan(config.serverName)}`);
        console.log(`  Relay URL: ${chalk.cyan(config.relayUrl)}`);
        if (config.publicKey) {
          console.log(`  Public Key: ${chalk.dim(config.publicKey.slice(0, 20) + '...')}`);
        }
        console.log();
        console.log(chalk.dim('To reconfigure, run: optagon tunnel reset'));
        return;
      }

      console.log(chalk.blue('Generating keypair...'));

      // Generate Ed25519 keypair
      const keyPair = await crypto.subtle.generateKey(
        { name: 'Ed25519' },
        true, // extractable
        ['sign', 'verify']
      );

      // Export keys to raw format
      const publicKeyBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

      const publicKey = Buffer.from(publicKeyBuffer).toString('base64');
      const privateKey = Buffer.from(privateKeyBuffer).toString('base64');

      config = {
        serverName: options.name,
        relayUrl: options.url,
        enabled: false,
        publicKey,
        privateKey,
      };

      saveTunnelConfig(config);

      console.log(chalk.green('Tunnel configured!'));
      console.log(`  Server Name: ${chalk.cyan(config.serverName)}`);
      console.log(`  Relay URL: ${chalk.cyan(config.relayUrl)}`);
      console.log(`  Public Key: ${chalk.dim(publicKey.slice(0, 20) + '...')}`);
      console.log();
      console.log(chalk.cyan('Connect with: optagon tunnel connect'));
      console.log();
      console.log(chalk.dim('Note: In production, you\'ll need to register this server at optagon.ai'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon tunnel connect - Connect to tunnel server
tunnel
  .command('connect')
  .description('Connect to optagon.ai tunnel server')
  .action(async () => {
    try {
      const config = loadTunnelConfig();

      if (!config) {
        console.error(chalk.red('Tunnel not configured.'));
        console.log(chalk.cyan('Run: optagon tunnel setup'));
        process.exit(1);
      }

      console.log(chalk.blue('Connecting to tunnel...'));

      const client = createTunnelClient({
        relayUrl: config.relayUrl,
        serverId: config.serverId,
        serverName: config.serverName,
        onStatusChange: (status: TunnelStatus) => {
          if (status === 'connected') {
            console.log(chalk.green('Connected to tunnel!'));
            console.log(`  Session: ${chalk.dim(client.getSessionId())}`);
            console.log();
            console.log(chalk.dim('Press Ctrl+C to disconnect.'));
          } else if (status === 'disconnected') {
            console.log(chalk.yellow('Disconnected from tunnel.'));
          } else if (status === 'error') {
            console.log(chalk.red('Tunnel error.'));
          }
        },
      });

      // Save server ID once connected
      client.on('connected', (sessionId: string) => {
        if (!config.serverId) {
          config.serverId = client.getServerId();
          config.enabled = true;
          saveTunnelConfig(config);
          console.log(chalk.dim(`Server ID saved: ${config.serverId}`));
        }
      });

      await client.connect();

      // Keep process alive
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nDisconnecting...'));
        destroyTunnelClient();
        process.exit(0);
      });

      // Prevent process from exiting
      await new Promise(() => {});
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon tunnel status - Show tunnel status
tunnel
  .command('status')
  .description('Show tunnel configuration and status')
  .action(() => {
    try {
      const config = loadTunnelConfig();

      if (!config) {
        console.log(chalk.yellow('Tunnel not configured.'));
        console.log(chalk.cyan('Run: optagon tunnel setup'));
        return;
      }

      console.log(chalk.bold('Tunnel Configuration'));
      console.log(`  Server ID: ${chalk.cyan(config.serverId || 'not registered')}`);
      console.log(`  Server Name: ${chalk.cyan(config.serverName)}`);
      console.log(`  Relay URL: ${chalk.cyan(config.relayUrl)}`);
      console.log(`  Enabled: ${config.enabled ? chalk.green('yes') : chalk.gray('no')}`);

      const client = getTunnelClient();
      if (client) {
        console.log();
        console.log(chalk.bold('Connection Status'));
        const status = client.getStatus();
        const statusColor = status === 'connected' ? chalk.green :
                           status === 'connecting' ? chalk.yellow :
                           status === 'error' ? chalk.red : chalk.gray;
        console.log(`  Status: ${statusColor(status)}`);
        if (client.getSessionId()) {
          console.log(`  Session: ${chalk.dim(client.getSessionId())}`);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon tunnel disconnect - Disconnect from tunnel
tunnel
  .command('disconnect')
  .description('Disconnect from tunnel server')
  .action(() => {
    try {
      const client = getTunnelClient();
      if (client) {
        client.disconnect();
        console.log(chalk.green('Disconnected from tunnel.'));
      } else {
        console.log(chalk.yellow('Not connected to tunnel.'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon tunnel reset - Reset tunnel configuration
tunnel
  .command('reset')
  .description('Reset tunnel configuration')
  .action(() => {
    try {
      if (existsSync(TUNNEL_CONFIG_PATH)) {
        const { unlinkSync } = require('fs');
        unlinkSync(TUNNEL_CONFIG_PATH);
        console.log(chalk.green('Tunnel configuration reset.'));
      } else {
        console.log(chalk.yellow('No tunnel configuration found.'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();
