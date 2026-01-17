import { getStateStore } from './state-store.js';
import { PORT_RANGE_START, PORT_RANGE_END } from '../types/index.js';

export class PortAllocator {
  /**
   * Allocate the next available port in the range 33000-34000
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
