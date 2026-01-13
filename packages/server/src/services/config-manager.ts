/**
 * Configuration Manager
 *
 * Manages global optagon configuration including API keys.
 * Stores config in ~/.optagon/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface OptagonConfig {
  openrouter_api_key?: string;
  anthropic_api_key?: string;
  openai_api_key?: string;
  default_model?: string;
  [key: string]: string | undefined;
}

const CONFIG_DIR = join(homedir(), '.optagon');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

class ConfigManager {
  private config: OptagonConfig;

  constructor() {
    this.ensureConfigDir();
    this.config = this.load();
  }

  private ensureConfigDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
  }

  private load(): OptagonConfig {
    if (!existsSync(CONFIG_FILE)) {
      return {};
    }

    try {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private save(): void {
    writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  get(key: string): string | undefined {
    return this.config[key];
  }

  set(key: string, value: string): void {
    this.config[key] = value;
    this.save();
  }

  delete(key: string): void {
    delete this.config[key];
    this.save();
  }

  getAll(): OptagonConfig {
    return { ...this.config };
  }

  /**
   * Get environment variables to pass to containers
   * Returns object with API keys for container env
   */
  getContainerEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    if (this.config.openrouter_api_key) {
      env.OPENROUTER_API_KEY = this.config.openrouter_api_key;
    }
    if (this.config.anthropic_api_key) {
      env.ANTHROPIC_API_KEY = this.config.anthropic_api_key;
    }
    if (this.config.openai_api_key) {
      env.OPENAI_API_KEY = this.config.openai_api_key;
    }

    return env;
  }
}

// Singleton instance
let instance: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!instance) {
    instance = new ConfigManager();
  }
  return instance;
}
