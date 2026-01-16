/**
 * Template Loader Service
 *
 * Loads and validates frame templates from:
 * 1. Built-in templates (packages/server/templates/)
 * 2. User templates (~/.optagon/templates/)
 *
 * User templates override built-in templates with the same name.
 */

import { readdir, readFile, exists } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import type {
  FrameTemplate,
  WindowConfig,
  ResolvedTemplate,
  TemplateValidationResult,
} from '../types/template';

// Directories
const BUILTIN_TEMPLATES_DIR = join(import.meta.dir, '../../templates');
const USER_TEMPLATES_DIR = join(homedir(), '.optagon', 'templates');

class TemplateLoader {
  private cache: Map<string, FrameTemplate> = new Map();
  private loaded = false;

  /**
   * Load all templates from both directories
   */
  async loadTemplates(): Promise<void> {
    this.cache.clear();

    // Load built-in templates first
    await this.loadFromDirectory(BUILTIN_TEMPLATES_DIR);

    // Load user templates (override built-ins)
    await this.loadFromDirectory(USER_TEMPLATES_DIR);

    this.loaded = true;
  }

  /**
   * Load templates from a directory
   */
  private async loadFromDirectory(dir: string): Promise<void> {
    if (!(await exists(dir))) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.yaml') && !entry.name.endsWith('.yml')) continue;

      const filePath = join(dir, entry.name);
      const templateName = basename(entry.name, entry.name.endsWith('.yaml') ? '.yaml' : '.yml');

      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = parseYaml(content) as Partial<FrameTemplate>;

        // Validate basic structure
        const validation = this.validateTemplate(parsed, templateName);
        if (!validation.valid) {
          console.warn(`[template-loader] Invalid template ${templateName}:`, validation.errors);
          continue;
        }

        // Store with name from filename (not from content)
        const template: FrameTemplate = {
          ...parsed as FrameTemplate,
          name: templateName,
        };

        this.cache.set(templateName, template);
      } catch (error) {
        console.warn(`[template-loader] Failed to load ${filePath}:`, error);
      }
    }
  }

  /**
   * Validate a template definition
   */
  validateTemplate(template: Partial<FrameTemplate>, name: string): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required: windows array
    if (!template.windows || !Array.isArray(template.windows)) {
      errors.push('Template must have a "windows" array');
    } else {
      // Validate each window
      const windowNames = new Set<string>();

      for (let i = 0; i < template.windows.length; i++) {
        const window = template.windows[i] as Partial<WindowConfig>;

        if (!window.name || typeof window.name !== 'string') {
          errors.push(`Window ${i}: missing or invalid "name"`);
        } else {
          if (windowNames.has(window.name)) {
            errors.push(`Window ${i}: duplicate name "${window.name}"`);
          }
          windowNames.add(window.name);
        }

        if (!window.command || typeof window.command !== 'string') {
          errors.push(`Window ${i} (${window.name || 'unnamed'}): missing or invalid "command"`);
        }

        if (window.inject && !Array.isArray(window.inject)) {
          errors.push(`Window ${i} (${window.name}): "inject" must be an array`);
        }

        if (window.env && typeof window.env !== 'object') {
          errors.push(`Window ${i} (${window.name}): "env" must be an object`);
        }
      }

      // Warn if no windows
      if (template.windows.length === 0) {
        warnings.push('Template has no windows defined');
      }
    }

    // Validate extends reference (can't resolve here, just check format)
    if (template.extends && typeof template.extends !== 'string') {
      errors.push('"extends" must be a string (template name)');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get a template by name
   */
  async getTemplate(name: string): Promise<FrameTemplate | undefined> {
    if (!this.loaded) {
      await this.loadTemplates();
    }
    return this.cache.get(name);
  }

  /**
   * Get a resolved template (with inheritance applied)
   */
  async getResolvedTemplate(name: string): Promise<ResolvedTemplate | undefined> {
    const template = await this.getTemplate(name);
    if (!template) return undefined;

    return this.resolveInheritance(template);
  }

  /**
   * Resolve template inheritance
   */
  private async resolveInheritance(template: FrameTemplate): Promise<ResolvedTemplate> {
    const inheritanceChain: string[] = [template.name];
    let current = template;
    let resolved: FrameTemplate = { ...template };

    // Follow extends chain
    while (current.extends) {
      const parentName = current.extends;

      // Prevent circular inheritance
      if (inheritanceChain.includes(parentName)) {
        console.warn(`[template-loader] Circular inheritance detected: ${inheritanceChain.join(' -> ')} -> ${parentName}`);
        break;
      }

      const parent = await this.getTemplate(parentName);
      if (!parent) {
        console.warn(`[template-loader] Parent template "${parentName}" not found for "${template.name}"`);
        break;
      }

      inheritanceChain.push(parentName);

      // Merge: child overrides parent
      resolved = this.mergeTemplates(parent, resolved);
      current = parent;
    }

    return {
      ...resolved,
      sourceName: template.name,
      inheritanceChain: inheritanceChain.length > 1 ? inheritanceChain : undefined,
    };
  }

  /**
   * Merge two templates (child overrides parent)
   */
  private mergeTemplates(parent: FrameTemplate, child: FrameTemplate): FrameTemplate {
    // Create a map of parent windows by name
    const parentWindows = new Map(parent.windows.map(w => [w.name, w]));

    // Child windows override parent windows with same name
    const mergedWindows: WindowConfig[] = [];
    const childWindowNames = new Set(child.windows.map(w => w.name));

    // Add parent windows that aren't overridden
    for (const [name, window] of parentWindows) {
      if (!childWindowNames.has(name)) {
        mergedWindows.push(window);
      }
    }

    // Add all child windows
    mergedWindows.push(...child.windows);

    return {
      name: child.name,
      description: child.description || parent.description,
      windows: mergedWindows,
      env: { ...parent.env, ...child.env },
      services: child.services || parent.services,
    };
  }

  /**
   * List all available templates
   */
  async listTemplates(): Promise<FrameTemplate[]> {
    if (!this.loaded) {
      await this.loadTemplates();
    }
    return Array.from(this.cache.values());
  }

  /**
   * Check if a template exists
   */
  async hasTemplate(name: string): Promise<boolean> {
    if (!this.loaded) {
      await this.loadTemplates();
    }
    return this.cache.has(name);
  }

  /**
   * Get template directories for CLI info
   */
  getTemplateDirectories(): { builtin: string; user: string } {
    return {
      builtin: BUILTIN_TEMPLATES_DIR,
      user: USER_TEMPLATES_DIR,
    };
  }

  /**
   * Reload templates (clear cache and reload)
   */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.loadTemplates();
  }
}

// Singleton
let instance: TemplateLoader | null = null;

export function getTemplateLoader(): TemplateLoader {
  if (!instance) {
    instance = new TemplateLoader();
  }
  return instance;
}

export { TemplateLoader };
