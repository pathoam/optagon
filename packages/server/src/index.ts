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
import { getTemplateLoader } from './services/template-loader.js';
import { getFrameInitializer } from './services/frame-initializer.js';
import { initializeStateStore, isDatabaseReady, closeStateStore } from './services/state-store.js';
import { createTunnelClient, getTunnelClient, destroyTunnelClient, type TunnelStatus } from './tunnel/index.js';
import type { FrameStatus } from './types/index.js';

const program = new Command();

program
  .name('optagon')
  .description('Personal software development server with isolated frames')
  .version('0.1.0');

// Helper: Find frame by current directory
async function findFrameByWorkspace(): Promise<string | null> {
  const cwd = resolve(process.cwd());
  const manager = getFrameManager();
  const frames = await manager.listFrames();

  for (const frame of frames) {
    if (resolve(frame.workspacePath) === cwd) {
      return frame.name;
    }
  }
  return null;
}

// Helper: Resolve frame name (from arg or current directory)
async function resolveFrameName(name?: string): Promise<string> {
  if (name) return name;

  const found = await findFrameByWorkspace();
  if (found) return found;

  console.error(chalk.red('No frame specified and current directory is not a frame workspace.'));
  console.error(chalk.yellow('Either specify a frame name or run from a workspace directory.'));
  process.exit(1);
}

// Helper: Ensure database is connected (auto-starts if needed)
async function ensureDatabase(): Promise<void> {
  // First, try to connect
  const connected = await isDatabaseReady();
  if (connected) {
    await initializeStateStore();
    return;
  }

  // Database not running - try to start it
  console.log(chalk.dim('Starting database...'));

  try {
    // Check if container exists
    const containerExists = await checkPostgresContainer();

    if (containerExists) {
      // Start existing container
      execSync('podman start optagon-postgres 2>/dev/null', { stdio: 'pipe' });
    } else {
      // Create and start container using compose
      const composeFile = findComposeFile();
      if (composeFile) {
        execSync(`podman compose -f "${composeFile}" up -d 2>/dev/null`, { stdio: 'pipe' });
      } else {
        // Fallback: create container directly
        execSync(`podman run -d --name optagon-postgres \
          -e POSTGRES_DB=optagon \
          -e POSTGRES_USER=optagon \
          -e POSTGRES_PASSWORD=optagon_dev \
          -p 127.0.0.1:5434:5432 \
          -v optagon-postgres-data:/var/lib/postgresql/data \
          postgres:16-alpine 2>/dev/null`, { stdio: 'pipe' });
      }
    }

    // Wait for PostgreSQL to be ready (up to 30 seconds)
    const maxWait = 30;
    for (let i = 0; i < maxWait; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isDatabaseReady()) {
        await initializeStateStore();
        return;
      }
    }

    throw new Error('Database failed to start within 30 seconds');
  } catch (error) {
    console.error(chalk.red('Failed to start database automatically.'));
    console.error(chalk.dim(error instanceof Error ? error.message : String(error)));
    console.error(chalk.yellow('Try manually: podman compose up -d'));
    process.exit(1);
  }
}

// Check if postgres container exists (running or stopped)
async function checkPostgresContainer(): Promise<boolean> {
  try {
    execSync('podman container exists optagon-postgres 2>/dev/null', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Find compose.yaml file
function findComposeFile(): string | null {
  // Try current directory first
  const localCompose = join(process.cwd(), 'compose.yaml');
  if (existsSync(localCompose)) return localCompose;

  // Try the package directory
  const pkgCompose = resolve(import.meta.dir, '../compose.yaml');
  if (existsSync(pkgCompose)) return pkgCompose;

  // Try standard install location
  const homeCompose = join(homedir(), 'optagon', 'packages', 'server', 'compose.yaml');
  if (existsSync(homeCompose)) return homeCompose;

  return null;
}

// Command wrapper that handles cleanup and exit
function runCommand(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
      await closeStateStore();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      await closeStateStore();
      process.exit(1);
    }
  };
}

// ===================
// SIMPLIFIED COMMANDS
// ===================

// optagon init [name] - Create frame for current directory
program
  .command('init [name]')
  .description('Initialize a frame for the current directory')
  .option('-d, --description <text>', 'Frame description')
  .option('-t, --template <name>', 'Template to use (run "optagon template list" to see options)')
  .action(runCommand(async (name: string | undefined, options: { description?: string; template?: string }) => {
    await ensureDatabase();
    const cwd = resolve(process.cwd());
    const frameName = name || basename(cwd);

    // Check if frame already exists for this directory
    const existing = await findFrameByWorkspace();
    if (existing) {
      console.log(chalk.yellow(`Frame '${existing}' already exists for this directory.`));
      console.log(chalk.cyan(`Use 'optagon start' to start it.`));
      return;
    }

    // Validate template if specified
    if (options.template) {
      const loader = getTemplateLoader();
      const hasTemplate = await loader.hasTemplate(options.template);
      if (!hasTemplate) {
        throw new Error(`Template not found: ${options.template}. Run "optagon template list" to see available templates.`);
      }
    }

    const manager = getFrameManager();
    const frame = await manager.createFrame({
      name: frameName,
      workspacePath: cwd,
      description: options.description,
    }, options.template);

    console.log(chalk.green(`Frame '${frame.name}' initialized!`));
    console.log();
    console.log(`  Workspace: ${frame.workspacePath}`);
    console.log(`  Port: ${frame.hostPort}`);
    if (frame.templateName) {
      console.log(`  Template: ${frame.templateName}`);
    }
    console.log();
    console.log(chalk.cyan('Start with: optagon start'));
  }));

// optagon start [name] - Start frame and attach
program
  .command('start [name]')
  .description('Start a frame (auto-detects from current directory)')
  .option('--no-attach', 'Start without attaching to tmux')
  .option('--fresh', 'Destroy and recreate container (loses container state)')
  .action(async (name: string | undefined, options: { attach: boolean; fresh?: boolean }) => {
    try {
      await ensureDatabase();
      const frameName = await resolveFrameName(name);
      const manager = getFrameManager();
      const runtime = getContainerRuntime();

      // Check current status
      const frame = await manager.getFrame(frameName);
      if (!frame) {
        console.error(chalk.red(`Frame not found: ${frameName}`));
        process.exit(1);
      }

      // Handle --fresh flag: destroy existing container first
      if (options.fresh) {
        const existingContainer = await runtime.getContainerByName(frame.name);
        if (existingContainer) {
          console.log(chalk.yellow(`Removing existing container for fresh start...`));
          await runtime.removeContainer(existingContainer.id, true);
        }
        // Also clear the containerId from the frame record
        const store = await import('./services/state-store.js').then(m => m.getStateStore());
        await store.updateFrame(frame.id, { containerId: undefined });
      }

      if (frame.status === 'running' && !options.fresh) {
        console.log(chalk.yellow(`Frame '${frameName}' is already running.`));
        if (options.attach) {
          console.log(chalk.blue('Attaching...'));
          const cmd = await manager.getTmuxAttachCommand(frameName);
          execSync(cmd, { stdio: 'inherit' });
        }
        await closeStateStore();
        process.exit(0);
      }

      // Check if image exists
      const imageExists = await runtime.imageExists();
      if (!imageExists) {
        console.log(chalk.yellow('Frame image not found. Building...'));
        console.log(chalk.dim('This may take a few minutes on first run.'));
        console.log(chalk.cyan('Run: cd ~/optagon/optagon-server && podman build -t optagon/frame:latest -f Dockerfile.frame .'));
        await closeStateStore();
        process.exit(1);
      }

      console.log(chalk.blue(`Starting frame '${frameName}'...`));
      const startedFrame = await manager.startFrame(frameName);
      console.log(chalk.green('Frame started!'));

      // Apply template if configured
      if (startedFrame.templateName) {
        console.log(chalk.blue(`Applying template '${startedFrame.templateName}'...`));
        const initializer = getFrameInitializer();
        const initStatus = await initializer.initializeFrame(startedFrame, startedFrame.templateName);

        if (initStatus.errors.length > 0) {
          console.log(chalk.yellow('Template applied with warnings:'));
          for (const error of initStatus.errors) {
            console.log(chalk.yellow(`  - ${error}`));
          }
        } else {
          console.log(chalk.green(`Template applied! Created ${initStatus.windows.length} windows.`));
        }
      }

      if (options.attach) {
        console.log(chalk.blue('Attaching to tmux session...'));
        console.log(chalk.dim('(Detach with Ctrl+b, then d)'));
        console.log();

        // Small delay to let tmux start
        await new Promise(r => setTimeout(r, 500));

        await closeStateStore();
        const cmd = await manager.getTmuxAttachCommand(frameName);
        execSync(cmd, { stdio: 'inherit' });
      } else {
        console.log();
        console.log(chalk.cyan('Attach with: optagon attach'));
      }

      await closeStateStore();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      await closeStateStore();
      process.exit(1);
    }
  });

// optagon attach [name] - Attach to running frame
program
  .command('attach [name]')
  .description('Attach to a running frame')
  .action(async (name: string | undefined) => {
    try {
      await ensureDatabase();
      const frameName = await resolveFrameName(name);
      const manager = getFrameManager();

      const frame = await manager.getFrame(frameName);
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
      const cmd = await manager.getTmuxAttachCommand(frameName);
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
  .action(runCommand(async (name: string | undefined) => {
    await ensureDatabase();
    const frameName = await resolveFrameName(name);
    const manager = getFrameManager();

    console.log(chalk.blue(`Stopping frame '${frameName}'...`));
    await manager.stopFrame(frameName);
    console.log(chalk.green('Frame stopped.'));
  }));

// optagon restart [name] - Restart a frame
program
  .command('restart [name]')
  .description('Restart a frame (use --purge to recreate container with new image)')
  .option('--purge', 'Destroy and recreate container (use after image rebuild)')
  .option('--no-attach', 'Restart without attaching to tmux')
  .action(async (name: string | undefined, options: { purge?: boolean; attach: boolean }) => {
    try {
      await ensureDatabase();
      const frameName = await resolveFrameName(name);
      const manager = getFrameManager();

      const frame = await manager.getFrame(frameName);
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
        const cmd = await manager.getTmuxAttachCommand(frameName);
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
  .option('-a, --all', 'Also show orphaned containers (not in database)')
  .action(runCommand(async (options: { all?: boolean }) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const runtime = getContainerRuntime();
    const frames = await manager.listFrames();

    // Get all containers
    const containers = await runtime.listContainers();
    const frameNames = new Set(frames.map(f => f.name));

    // Find orphaned containers (in podman but not in database)
    const orphanedContainers = containers.filter(c => {
      const frameName = c.name.replace('optagon-frame-', '');
      return !frameNames.has(frameName);
    });

    if (frames.length === 0 && orphanedContainers.length === 0) {
      console.log(chalk.yellow('No frames found.'));
      console.log(chalk.cyan('Create one with: optagon init'));
      return;
    }

    if (frames.length > 0) {
      console.log(chalk.bold('Frames:'));
      console.log();

      for (const frame of frames) {
        const statusColor = getStatusColor(frame.status);
        const indicator = frame.status === 'running' ? chalk.green('●') : chalk.dim('○');
        const tiltPort = frame.hostPort ? frame.hostPort + 2000 : null;

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
    }

    // Show orphaned containers
    if (orphanedContainers.length > 0) {
      if (options.all) {
        console.log();
        console.log(chalk.bold('Orphaned Containers:'));
        console.log(chalk.dim('(containers without database entries - run "optagon cleanup" to remove)'));
        console.log();
        for (const container of orphanedContainers) {
          const frameName = container.name.replace('optagon-frame-', '');
          const statusColor = container.status === 'running' ? chalk.yellow : chalk.dim;
          console.log(`  ${chalk.dim('○')} ${chalk.bold(frameName)} ${statusColor(`[${container.status}]`)} ${chalk.dim('(orphaned)')}`);
        }
      } else if (frames.length === 0) {
        console.log(chalk.yellow(`Found ${orphanedContainers.length} orphaned container(s).`));
        console.log(chalk.cyan('Run "optagon ls -a" to see them, or "optagon cleanup" to remove them.'));
      } else {
        console.log();
        console.log(chalk.dim(`+ ${orphanedContainers.length} orphaned container(s). Run "optagon ls -a" to see all.`));
      }
    }
  }));

// optagon cleanup - Remove orphaned containers
program
  .command('cleanup')
  .description('Remove orphaned containers (containers without database entries)')
  .option('-f, --force', 'Remove without confirmation')
  .action(runCommand(async (options: { force?: boolean }) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const runtime = getContainerRuntime();

    const frames = await manager.listFrames();
    const containers = await runtime.listContainers();
    const frameNames = new Set(frames.map(f => f.name));

    const orphanedContainers = containers.filter(c => {
      const frameName = c.name.replace('optagon-frame-', '');
      return !frameNames.has(frameName);
    });

    if (orphanedContainers.length === 0) {
      console.log(chalk.green('No orphaned containers found.'));
      return;
    }

    console.log(chalk.bold('Orphaned containers to remove:'));
    for (const container of orphanedContainers) {
      const frameName = container.name.replace('optagon-frame-', '');
      console.log(`  - ${frameName} (${container.status})`);
    }
    console.log();

    if (!options.force) {
      console.log(chalk.yellow('Run with --force to remove these containers.'));
      return;
    }

    console.log(chalk.blue('Removing orphaned containers...'));
    for (const container of orphanedContainers) {
      try {
        await runtime.removeContainer(container.id, true);
        const frameName = container.name.replace('optagon-frame-', '');
        console.log(chalk.green(`  ✓ Removed ${frameName}`));
      } catch (error) {
        console.log(chalk.red(`  ✗ Failed to remove ${container.name}: ${error instanceof Error ? error.message : error}`));
      }
    }

    console.log(chalk.green('Cleanup complete.'));
  }));

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

// Database commands
const db = program.command('db').description('Manage PostgreSQL database');

db
  .command('start')
  .description('Start PostgreSQL container')
  .action(async () => {
    try {
      console.log(chalk.cyan('Starting PostgreSQL...'));
      const composeFile = findComposeFile();

      if (!composeFile) {
        console.error(chalk.red('compose.yaml not found.'));
        console.error(chalk.yellow('Run this command from packages/server or install optagon globally.'));
        process.exit(1);
      }

      execSync(`podman compose -f "${composeFile}" up -d`, { stdio: 'inherit' });

      console.log(chalk.green('PostgreSQL started.'));
      console.log(chalk.dim('Connection: postgresql://optagon:optagon_dev@localhost:5434/optagon'));
    } catch (error) {
      console.error(chalk.red('Failed to start PostgreSQL:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

db
  .command('stop')
  .description('Stop PostgreSQL container')
  .action(async () => {
    try {
      console.log(chalk.cyan('Stopping PostgreSQL...'));
      execSync('podman stop optagon-postgres 2>/dev/null || true', { stdio: 'inherit' });
      console.log(chalk.green('PostgreSQL stopped.'));
    } catch (error) {
      console.error(chalk.red('Failed to stop PostgreSQL:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

db
  .command('status')
  .description('Check PostgreSQL connection status')
  .action(runCommand(async () => {
    const ready = await isDatabaseReady();
    if (ready) {
      console.log(chalk.green('✓ PostgreSQL is connected and ready.'));
      const configManager = getConfigManager();
      console.log(chalk.dim(`  URL: ${configManager.getDatabaseUrl()}`));
    } else {
      console.log(chalk.red('✗ PostgreSQL is not connected.'));
      console.log(chalk.yellow('  Run: optagon db start'));
    }
  }));

db
  .command('logs')
  .description('Show PostgreSQL container logs')
  .option('-f, --follow', 'Follow log output')
  .action(async (options: { follow?: boolean }) => {
    try {
      const followFlag = options.follow ? '-f' : '';
      execSync(`podman logs ${followFlag} optagon-postgres`, { stdio: 'inherit' });
    } catch (error) {
      console.error(chalk.red('Failed to get logs:'), error instanceof Error ? error.message : error);
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
  .option('-t, --template <name>', 'Template to use (run "optagon template list" to see options)')
  .option('-c, --config <json>', 'Frame config as JSON (manager, ports, behavior settings)')
  .action(runCommand(async (name: string, options: { workspace: string; description?: string; template?: string; config?: string }) => {
    await ensureDatabase();

    // Validate template if specified
    if (options.template) {
      const loader = getTemplateLoader();
      const hasTemplate = await loader.hasTemplate(options.template);
      if (!hasTemplate) {
        throw new Error(`Template not found: ${options.template}. Run "optagon template list" to see available templates.`);
      }
    }

    // Parse config if provided
    let config;
    if (options.config) {
      try {
        config = JSON.parse(options.config);
      } catch {
        throw new Error('Invalid config JSON. Example: --config \'{"manager":{"provider":"anthropic","model":"claude-3"}}\'');
      }
    }

    const manager = getFrameManager();
    const frame = await manager.createFrame({
      name,
      workspacePath: options.workspace,
      description: options.description,
      config,
    }, options.template);

    console.log(chalk.green('Frame created successfully!'));
    console.log();
    printFrame(frame);
  }));

// Start frame
frame
  .command('start <name>')
  .description('Start a frame')
  .action(runCommand(async (name: string) => {
    await ensureDatabase();
    const manager = getFrameManager();

    // Check if image exists
    const runtime = getContainerRuntime();
    const imageExists = await runtime.imageExists();
    if (!imageExists) {
      throw new Error('Frame image not found. Build it with: cd optagon-server && podman build -t optagon/frame:latest -f Dockerfile.frame .');
    }

    console.log(chalk.blue('Starting frame...'));
    const frame = await manager.startFrame(name);
    console.log(chalk.green('Frame started!'));

    // Apply template if configured
    if (frame.templateName) {
      console.log(chalk.blue(`Applying template '${frame.templateName}'...`));
      const initializer = getFrameInitializer();
      const initStatus = await initializer.initializeFrame(frame, frame.templateName);

      if (initStatus.errors.length > 0) {
        console.log(chalk.yellow('Template applied with warnings:'));
        for (const error of initStatus.errors) {
          console.log(chalk.yellow(`  - ${error}`));
        }
      } else {
        console.log(chalk.green(`Template applied! Created ${initStatus.windows.length} windows.`));
      }
    }

    console.log();
    printFrame(frame);
    console.log();
    console.log(chalk.cyan('To attach to this frame:'));
    console.log(`  ${await manager.getTmuxAttachCommand(name)}`);
  }));

// Stop frame
frame
  .command('stop <name>')
  .description('Stop a running frame')
  .action(runCommand(async (name: string) => {
    await ensureDatabase();
    const manager = getFrameManager();
    console.log(chalk.blue('Stopping frame...'));
    const frame = await manager.stopFrame(name);

    console.log(chalk.green('Frame stopped!'));
    console.log();
    printFrame(frame);
  }));

// List frames
frame
  .command('list')
  .alias('ls')
  .description('List all frames')
  .option('-s, --status <status>', 'Filter by status')
  .action(runCommand(async (options: { status?: FrameStatus }) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const frames = await manager.listFrames(options.status);

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
  }));

// Show frame details
frame
  .command('show <name>')
  .description('Show frame details')
  .action(runCommand(async (name: string) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const frame = await manager.getFrame(name);

    if (!frame) {
      throw new Error(`Frame not found: ${name}`);
    }

    printFrame(frame);

    console.log();
    console.log(chalk.bold('Attach command:'));
    console.log(`  ${await manager.getTmuxAttachCommand(name)}`);

    if (frame.hostPort) {
      console.log();
      console.log(chalk.bold('Dev server URL:'));
      console.log(`  http://localhost:${frame.hostPort}`);
    }
  }));

// Attach to frame
frame
  .command('attach <name>')
  .description('Print command to attach to frame tmux session')
  .action(runCommand(async (name: string) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const frame = await manager.getFrame(name);

    if (!frame) {
      throw new Error(`Frame not found: ${name}`);
    }

    if (frame.status !== 'running') {
      throw new Error(`Frame '${name}' is not running. Start it first.`);
    }

    console.log(await manager.getTmuxAttachCommand(name));
  }));

// Destroy frame
frame
  .command('destroy <name>')
  .description('Destroy a frame (removes container and data)')
  .option('-f, --force', 'Force destroy even if running')
  .action(runCommand(async (name: string, options: { force?: boolean }) => {
    await ensureDatabase();
    const manager = getFrameManager();

    console.log(chalk.blue('Destroying frame...'));
    await manager.destroyFrame(name, options.force);

    console.log(chalk.green(`Frame '${name}' destroyed.`));
  }));

// Events
frame
  .command('events <name>')
  .description('Show frame events')
  .option('-n, --limit <count>', 'Number of events to show', '20')
  .action(runCommand(async (name: string, options: { limit: string }) => {
    await ensureDatabase();
    const manager = getFrameManager();
    const events = await manager.getFrameEvents(name, parseInt(options.limit, 10));

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
  }));

// ===================
// TEMPLATE COMMANDS
// ===================

const template = program.command('template').description('Manage frame templates');

// List templates
template
  .command('list')
  .alias('ls')
  .description('List available templates')
  .action(runCommand(async () => {
    const loader = getTemplateLoader();
    const templates = await loader.listTemplates();
    const dirs = loader.getTemplateDirectories();

    if (templates.length === 0) {
      console.log(chalk.yellow('No templates found.'));
      console.log();
      console.log('Template directories:');
      console.log(`  Built-in: ${chalk.dim(dirs.builtin)}`);
      console.log(`  User: ${chalk.dim(dirs.user)}`);
      return;
    }

    console.log(chalk.bold('Available Templates:'));
    console.log();

    for (const tmpl of templates) {
      console.log(`  ${chalk.cyan(tmpl.name)}`);
      if (tmpl.description) {
        console.log(`    ${chalk.dim(tmpl.description)}`);
      }
      console.log(`    ${chalk.dim(`${tmpl.windows.length} window(s): ${tmpl.windows.map(w => w.name).join(', ')}`)}`);
      console.log();
    }

    console.log(chalk.dim('Use with: optagon init --template <name>'));
  }));

// Show template details
template
  .command('show <name>')
  .description('Show template details')
  .action(runCommand(async (name: string) => {
    const loader = getTemplateLoader();
    const tmpl = await loader.getResolvedTemplate(name);

    if (!tmpl) {
      throw new Error(`Template not found: ${name}. Run "optagon template list" to see available templates.`);
    }

    console.log(chalk.bold('Template:'), chalk.cyan(tmpl.name));
    if (tmpl.description) {
      console.log(chalk.dim(tmpl.description));
    }
    console.log();

    if (tmpl.inheritanceChain && tmpl.inheritanceChain.length > 1) {
      console.log(chalk.bold('Extends:'), tmpl.inheritanceChain.slice(1).join(' → '));
      console.log();
    }

    console.log(chalk.bold('Windows:'));
    for (const window of tmpl.windows) {
      console.log();
      console.log(`  ${chalk.cyan(window.name)}`);
      console.log(`    Command: ${chalk.dim(window.command)}`);
      if (window.cwd) {
        console.log(`    Working Dir: ${chalk.dim(window.cwd)}`);
      }
      if (window.role) {
        console.log(`    Role: ${chalk.dim(window.role)}`);
      }
      if (window.inject && window.inject.length > 0) {
        console.log(`    Inject: ${chalk.dim(window.inject.length + ' line(s)')}`);
      }
      if (window.briefing) {
        console.log(`    Briefing: ${chalk.dim('configured')}`);
      }
    }

    if (tmpl.env && Object.keys(tmpl.env).length > 0) {
      console.log();
      console.log(chalk.bold('Environment:'));
      for (const [key, value] of Object.entries(tmpl.env)) {
        console.log(`  ${key}=${chalk.dim(value)}`);
      }
    }
  }));

// Status command
program
  .command('status')
  .description('Show overall status')
  .action(runCommand(async () => {
    await ensureDatabase();
    const manager = getFrameManager();
    const portAllocator = getPortAllocator();
    const runtime = getContainerRuntime();

    const frames = await manager.listFrames();
    const runningCount = frames.filter(f => f.status === 'running').length;
    const availablePorts = await portAllocator.getAvailableCount();

    console.log(chalk.bold('Optagon Status'));
    console.log();
    console.log(`  Container runtime: ${chalk.cyan(runtime.getRuntime())}`);
    console.log(`  Total frames: ${chalk.cyan(frames.length.toString())}`);
    console.log(`  Running: ${chalk.green(runningCount.toString())}`);
    console.log(`  Available ports: ${chalk.cyan(availablePorts.toString())}`);
  }));

// Helper functions
function printFrame(frame: any) {
  const statusColor = getStatusColor(frame.status);
  const tiltPort = frame.hostPort ? frame.hostPort + 2000 : null;

  console.log(chalk.bold('Frame Details:'));
  console.log(`  Name: ${chalk.cyan(frame.name)}`);
  console.log(`  ID: ${chalk.dim(frame.id)}`);
  console.log(`  Status: ${statusColor(frame.status)}`);
  console.log(`  Workspace: ${frame.workspacePath}`);
  if (frame.description) {
    console.log(`  Description: ${frame.description}`);
  }
  if (frame.templateName) {
    console.log(`  Template: ${chalk.cyan(frame.templateName)}`);
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
      console.log(chalk.cyan('Next step: Register your server with: optagon tunnel register'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

// optagon tunnel register - Register server with Clerk account
tunnel
  .command('register')
  .description('Register this server with your optagon.ai account')
  .option('-t, --token <token>', 'Clerk session token (for non-interactive use)')
  .action(async (options: { token?: string }) => {
    try {
      const config = loadTunnelConfig();

      if (!config) {
        console.error(chalk.red('Tunnel not configured.'));
        console.log(chalk.cyan('Run: optagon tunnel setup'));
        process.exit(1);
      }

      if (!config.publicKey) {
        console.error(chalk.red('No public key found in tunnel configuration.'));
        console.log(chalk.cyan('Run: optagon tunnel reset && optagon tunnel setup'));
        process.exit(1);
      }

      if (config.serverId) {
        console.log(chalk.yellow('Server already registered.'));
        console.log(`  Server ID: ${chalk.cyan(config.serverId)}`);
        console.log();
        console.log(chalk.dim('To re-register, run: optagon tunnel reset && optagon tunnel setup && optagon tunnel register'));
        return;
      }

      // Get the relay URL base (strip /tunnel path and ws/wss protocol)
      const relayUrl = config.relayUrl;
      const httpUrl = relayUrl
        .replace('wss://', 'https://')
        .replace('ws://', 'http://')
        .replace('/tunnel', '');

      if (options.token) {
        // Non-interactive mode with provided token
        console.log(chalk.blue('Registering with provided token...'));
        await registerWithToken(httpUrl, config, options.token);
      } else {
        // Interactive mode - display URL for user to get token
        console.log(chalk.bold('Server Registration'));
        console.log();
        console.log('To register this server, you need to authenticate with optagon.ai.');
        console.log();
        console.log('1. Sign in at: ' + chalk.cyan(`${httpUrl}/register`));
        console.log('2. Copy the session token shown after sign-in');
        console.log('3. Run: ' + chalk.cyan(`optagon tunnel register --token <your-token>`));
        console.log();
        console.log(chalk.dim('Or use the PWA at ' + httpUrl + ' to manage your servers.'));
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

async function registerWithToken(httpUrl: string, config: TunnelConfig, token: string): Promise<void> {
  try {
    const response = await fetch(`${httpUrl}/api/servers/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        serverName: config.serverName,
        publicKey: config.publicKey,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (response.status === 401) {
        throw new Error('Invalid or expired token. Please sign in again at optagon.ai');
      } else if (response.status === 503) {
        throw new Error('Authentication not configured on server. Contact admin.');
      }
      throw new Error(error.error || `Registration failed: ${response.status}`);
    }

    const data = await response.json() as { serverId: string; serverName: string };

    // Save the server ID to config
    config.serverId = data.serverId;
    config.enabled = true;
    saveTunnelConfig(config);

    console.log(chalk.green('Server registered successfully!'));
    console.log(`  Server ID: ${chalk.cyan(data.serverId)}`);
    console.log(`  Server Name: ${chalk.cyan(data.serverName)}`);
    console.log();
    console.log(chalk.cyan('Connect with: optagon tunnel connect'));
  } catch (error) {
    throw error;
  }
}

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
