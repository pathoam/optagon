import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type { ContainerInfo, Frame } from '../types/index.js';

const OPTAGON_DIR = join(homedir(), '.optagon');
const FRAMES_DIR = join(OPTAGON_DIR, 'frames');
const FRAME_IMAGE = 'optagon/frame:latest';

// Get the podman socket path for rootless podman
function getPodmanSocketPath(): string | null {
  const uid = process.getuid?.() || 1000;
  const socketPath = `/run/user/${uid}/podman/podman.sock`;
  if (existsSync(socketPath)) {
    return socketPath;
  }
  // Fallback for system podman
  if (existsSync('/var/run/podman/podman.sock')) {
    return '/var/run/podman/podman.sock';
  }
  return null;
}

export interface ContainerCreateOptions {
  name: string;
  workspacePath: string;
  hostPort: number;
  containerPort?: number;
  frameId: string;
  env?: Record<string, string>;
}

export class ContainerRuntime {
  private runtime: 'podman' | 'docker';

  constructor() {
    // Check for podman first, fall back to docker
    const podmanCheck = spawnSync('podman', ['--version'], { encoding: 'utf-8' });
    if (podmanCheck.status === 0) {
      this.runtime = 'podman';
    } else {
      const dockerCheck = spawnSync('docker', ['--version'], { encoding: 'utf-8' });
      if (dockerCheck.status === 0) {
        this.runtime = 'docker';
      } else {
        throw new Error('Neither podman nor docker found. Please install podman.');
      }
    }
  }

  /**
   * Get the runtime being used
   */
  getRuntime(): string {
    return this.runtime;
  }

  /**
   * Create and start a container for a frame
   */
  async createContainer(options: ContainerCreateOptions): Promise<string> {
    const { name, workspacePath, hostPort, containerPort = 3000, frameId, env = {} } = options;
    const containerName = `optagon-frame-${name}`;
    const tmuxSocketDir = join(FRAMES_DIR, frameId);

    // Ensure tmux socket directory exists
    const mkdirResult = spawnSync('mkdir', ['-p', tmuxSocketDir]);
    if (mkdirResult.status !== 0) {
      throw new Error(`Failed to create tmux socket directory: ${tmuxSocketDir}`);
    }

    // Tilt UI port = hostPort + 1000 (e.g., 33001 -> 34001)
    const tiltPort = hostPort + 1000;

    const args = [
      'run',
      '-d',
      '--name', containerName,
      // Port mapping: dev server
      '-p', `127.0.0.1:${hostPort}:${containerPort}`,
      // Port mapping: Tilt UI (10350)
      '-p', `127.0.0.1:${tiltPort}:10350`,
      // Mount workspace
      '-v', `${workspacePath}:/workspace:Z`,
      // Mount tmux socket directory
      '-v', `${tmuxSocketDir}:/run/optagon:Z`,
      // Environment variables
      '-e', `OPTAGON_FRAME_ID=${frameId}`,
      '-e', `OPTAGON_FRAME_NAME=${name}`,
      '-e', `OPTAGON_TILT_PORT=${tiltPort}`,
    ];

    // Mount host's Claude Code credentials (read-only) for OAuth auth sharing
    const hostClaudeCredentials = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(hostClaudeCredentials)) {
      // Ensure target directory exists in container, mount credentials read-only
      args.push('-v', `${hostClaudeCredentials}:/root/.claude/.credentials.json:ro,Z`);
    }

    // Mount podman/docker socket for container-in-container support
    const podmanSocket = getPodmanSocketPath();
    if (podmanSocket) {
      // Mount as /var/run/docker.sock for docker-compose compatibility
      args.push('-v', `${podmanSocket}:/var/run/docker.sock:Z`);
      args.push('-e', 'DOCKER_HOST=unix:///var/run/docker.sock');
    }

    // Add custom environment variables (API keys, etc.)
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    args.push(
      // Working directory
      '-w', '/workspace',
      // Image
      FRAME_IMAGE,
    );

    return new Promise((resolve, reject) => {
      const proc = spawn(this.runtime, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Return container ID (first 12 chars)
          resolve(stdout.trim().substring(0, 12));
        } else {
          reject(new Error(`Failed to create container: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Start a stopped container
   */
  async startContainer(containerId: string): Promise<void> {
    return this.runCommand(['start', containerId]);
  }

  /**
   * Stop a running container
   */
  async stopContainer(containerId: string): Promise<void> {
    return this.runCommand(['stop', containerId]);
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string, force = false): Promise<void> {
    const args = force ? ['rm', '-f', containerId] : ['rm', containerId];
    return this.runCommand(args);
  }

  /**
   * Get container info
   */
  async getContainerInfo(containerId: string): Promise<ContainerInfo | null> {
    return new Promise((resolve) => {
      const proc = spawn(this.runtime, [
        'inspect',
        '--format', '{{json .}}',
        containerId,
      ]);

      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        try {
          const info = JSON.parse(stdout);
          const state = info.State?.Status || info.State?.Running ? 'running' : 'stopped';

          // Parse port mappings
          const ports: { host: number; container: number }[] = [];
          const portBindings = info.HostConfig?.PortBindings || {};
          for (const [containerPort, bindings] of Object.entries(portBindings)) {
            if (Array.isArray(bindings)) {
              for (const binding of bindings as any[]) {
                ports.push({
                  host: parseInt(binding.HostPort, 10),
                  container: parseInt(containerPort.split('/')[0], 10),
                });
              }
            }
          }

          resolve({
            id: containerId,
            name: info.Name?.replace(/^\//, '') || containerId,
            status: state as ContainerInfo['status'],
            ports,
          });
        } catch {
          resolve(null);
        }
      });

      proc.on('error', () => resolve(null));
    });
  }

  /**
   * Check if container exists
   */
  async containerExists(containerId: string): Promise<boolean> {
    const info = await this.getContainerInfo(containerId);
    return info !== null;
  }

  /**
   * Execute a command in a running container
   */
  async exec(containerId: string, command: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.runtime, ['exec', containerId, ...command]);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Get container by name (with port information)
   */
  async getContainerByName(name: string): Promise<ContainerInfo | null> {
    const containerName = name.startsWith('optagon-frame-') ? name : `optagon-frame-${name}`;
    return new Promise((resolve) => {
      const proc = spawn(this.runtime, [
        'ps',
        '-a',
        '--filter', `name=^${containerName}$`,
        '--format', '{{.ID}}|{{.Names}}|{{.Status}}|{{.Ports}}',
      ]);

      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0 || !stdout.trim()) {
          resolve(null);
          return;
        }

        const line = stdout.trim().split('\n')[0];
        const [id, containerFullName, statusStr, portsStr] = line.split('|');
        let status: ContainerInfo['status'] = 'stopped';
        if (statusStr.toLowerCase().includes('up')) {
          status = 'running';
        } else if (statusStr.toLowerCase().includes('exited')) {
          status = 'exited';
        }

        // Parse ports like "127.0.0.1:33001->3000/tcp, 127.0.0.1:34001->10350/tcp"
        const ports: { host: number; container: number }[] = [];
        if (portsStr) {
          const portMatches = portsStr.matchAll(/(\d+)->(\d+)/g);
          for (const match of portMatches) {
            ports.push({
              host: parseInt(match[1], 10),
              container: parseInt(match[2], 10),
            });
          }
        }

        resolve({
          id,
          name: containerFullName,
          status,
          ports,
        });
      });

      proc.on('error', () => resolve(null));
    });
  }

  /**
   * List all optagon frame containers
   */
  async listContainers(): Promise<ContainerInfo[]> {
    return new Promise((resolve) => {
      const proc = spawn(this.runtime, [
        'ps',
        '-a',
        '--filter', 'name=optagon-frame-',
        '--format', '{{.ID}}|{{.Names}}|{{.Status}}',
      ]);

      let stdout = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve([]);
          return;
        }

        const containers: ContainerInfo[] = [];
        const lines = stdout.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          const [id, name, statusStr] = line.split('|');
          let status: ContainerInfo['status'] = 'stopped';
          if (statusStr.toLowerCase().includes('up')) {
            status = 'running';
          } else if (statusStr.toLowerCase().includes('paused')) {
            status = 'paused';
          } else if (statusStr.toLowerCase().includes('exited')) {
            status = 'exited';
          }

          containers.push({
            id,
            name,
            status,
            ports: [], // Would need inspect to get ports
          });
        }

        resolve(containers);
      });

      proc.on('error', () => resolve([]));
    });
  }

  /**
   * Build the frame image
   */
  async buildImage(dockerfilePath: string): Promise<void> {
    return this.runCommand(['build', '-t', FRAME_IMAGE, '-f', dockerfilePath, '.']);
  }

  /**
   * Check if frame image exists
   */
  async imageExists(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn(this.runtime, ['image', 'inspect', FRAME_IMAGE]);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  private runCommand(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.runtime, args);
      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed: ${this.runtime} ${args.join(' ')}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }
}

// Singleton instance
let containerRuntime: ContainerRuntime | null = null;

export function getContainerRuntime(): ContainerRuntime {
  if (!containerRuntime) {
    containerRuntime = new ContainerRuntime();
  }
  return containerRuntime;
}

/**
 * Set the container runtime instance (for testing only)
 * @internal
 */
export function _setContainerRuntime(runtime: ContainerRuntime | null): void {
  containerRuntime = runtime;
}
