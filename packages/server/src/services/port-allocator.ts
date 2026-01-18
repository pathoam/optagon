/**
 * Port Allocator
 *
 * Manages port allocation for frame containers to avoid collisions.
 *
 * PORT ALLOCATION SCHEME:
 * =======================
 *
 * Each frame gets a "host port" from range 33000-34000. This base port
 * determines all other port mappings for that frame:
 *
 * | Port Type        | Calculation      | Example (hostPort=33001) |
 * |------------------|------------------|--------------------------|
 * | Dev server       | hostPort         | 33001 → container:3000   |
 * | Tilt UI          | hostPort + 2000  | 35001 → container:10350  |
 * | Additional ports | hostPort + 100+  | 33101, 33102, ...        |
 *
 * WHY +2000 FOR TILT:
 * - Original scheme used +1000 (e.g., 34001)
 * - This collided with hostPort range (33000-34000)
 * - Changed to +2000 to place Tilt ports at 35000-36000
 *
 * ADDITIONAL PORTS:
 * - For frames that expose multiple services (e.g., API + frontend)
 * - Allocated sequentially from hostPort + 100
 * - Configured via FrameConfig.ports.additional
 *
 * COLLISION PREVENTION:
 * - Ports are tracked in database (frames.host_port column)
 * - allocate() scans for first unused port in range
 * - Tilt ports never overlap because they're in 35000+ range
 */

import { getStateStore } from './state-store.js';
import { PORT_RANGE_START, PORT_RANGE_END } from '../types/index.js';

export class PortAllocator {
  /**
   * Allocate the next available port in the range 33000-34000.
   * The returned port becomes the frame's "base" port for all mappings.
   */
  async allocate(): Promise<number> {
    const store = getStateStore();
    const usedPorts = new Set(await store.getUsedPorts());

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }

    throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
  }

  /**
   * Check if a specific port is available
   */
  async isAvailable(port: number): Promise<boolean> {
    if (port < PORT_RANGE_START || port > PORT_RANGE_END) {
      return false;
    }

    const store = getStateStore();
    const usedPorts = new Set(await store.getUsedPorts());
    return !usedPorts.has(port);
  }

  /**
   * Get all used ports
   */
  async getUsedPorts(): Promise<number[]> {
    const store = getStateStore();
    return store.getUsedPorts();
  }

  /**
   * Get count of available ports
   */
  async getAvailableCount(): Promise<number> {
    const usedCount = (await this.getUsedPorts()).length;
    return PORT_RANGE_END - PORT_RANGE_START + 1 - usedCount;
  }
}

// Singleton instance
let portAllocator: PortAllocator | null = null;

export function getPortAllocator(): PortAllocator {
  if (!portAllocator) {
    portAllocator = new PortAllocator();
  }
  return portAllocator;
}

/**
 * Set the port allocator instance (for testing only)
 * @internal
 */
export function _setPortAllocator(allocator: PortAllocator | null): void {
  portAllocator = allocator;
}
