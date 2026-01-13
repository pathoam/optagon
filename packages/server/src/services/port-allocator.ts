import { getStateStore } from './state-store.js';
import { PORT_RANGE_START, PORT_RANGE_END } from '../types/index.js';

export class PortAllocator {
  /**
   * Allocate the next available port in the range 33000-34000
   */
  allocate(): number {
    const store = getStateStore();
    const usedPorts = new Set(store.getUsedPorts());

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
  isAvailable(port: number): boolean {
    if (port < PORT_RANGE_START || port > PORT_RANGE_END) {
      return false;
    }

    const store = getStateStore();
    const usedPorts = new Set(store.getUsedPorts());
    return !usedPorts.has(port);
  }

  /**
   * Get all used ports
   */
  getUsedPorts(): number[] {
    const store = getStateStore();
    return store.getUsedPorts();
  }

  /**
   * Get count of available ports
   */
  getAvailableCount(): number {
    const usedCount = this.getUsedPorts().length;
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
