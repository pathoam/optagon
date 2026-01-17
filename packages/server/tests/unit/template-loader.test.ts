import { describe, test, expect, beforeEach } from 'bun:test';
import { TemplateLoader, getTemplateLoader } from '../../src/services/template-loader.js';
import type { FrameTemplate } from '../../src/types/template.js';

describe('TemplateLoader', () => {
  let loader: TemplateLoader;

  beforeEach(() => {
    // Create fresh instance for each test
    loader = new TemplateLoader();
  });

  describe('validateTemplate', () => {
    test('valid template with required fields', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { name: 'shell', command: 'zsh' },
          { name: 'agent', command: 'claude' },
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('invalid template missing windows array', () => {
      const template: Partial<FrameTemplate> = {};

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Template must have a "windows" array');
    });

    test('invalid template with non-array windows', () => {
      const template = { windows: 'not-an-array' } as any;

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Template must have a "windows" array');
    });

    test('window missing name', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { command: 'zsh' } as any,
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing or invalid "name"'))).toBe(true);
    });

    test('window missing command', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { name: 'shell' } as any,
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing or invalid "command"'))).toBe(true);
    });

    test('duplicate window names', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { name: 'shell', command: 'zsh' },
          { name: 'shell', command: 'bash' }, // Duplicate
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('duplicate name "shell"'))).toBe(true);
    });

    test('inject must be array', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { name: 'shell', command: 'zsh', inject: 'not-an-array' } as any,
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('"inject" must be an array'))).toBe(true);
    });

    test('env must be object', () => {
      const template: Partial<FrameTemplate> = {
        windows: [
          { name: 'shell', command: 'zsh', env: 'not-an-object' } as any,
        ],
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('"env" must be an object'))).toBe(true);
    });

    test('extends must be string', () => {
      const template: Partial<FrameTemplate> = {
        windows: [{ name: 'shell', command: 'zsh' }],
        extends: 123 as any,
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('"extends" must be a string'))).toBe(true);
    });

    test('warns on empty windows array', () => {
      const template: Partial<FrameTemplate> = {
        windows: [],
      };

      const result = loader.validateTemplate(template, 'test');

      // Valid but with warning
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Template has no windows defined');
    });

    test('valid template with all optional fields', () => {
      const template: Partial<FrameTemplate> = {
        description: 'Test template',
        windows: [
          {
            name: 'shell',
            command: 'zsh',
            cwd: '/workspace',
            inject: ['echo hello', 'ls -la'],
            env: { FOO: 'bar' },
            role: 'developer',
            briefing: 'You are a developer',
          },
        ],
        env: { GLOBAL: 'value' },
        extends: 'basic',
      };

      const result = loader.validateTemplate(template, 'test');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('loadTemplates (with real templates)', () => {
    test('loads built-in templates', async () => {
      await loader.loadTemplates();
      const templates = await loader.listTemplates();

      expect(templates.length).toBeGreaterThan(0);
    });

    test('basic template exists', async () => {
      const hasBasic = await loader.hasTemplate('basic');
      expect(hasBasic).toBe(true);
    });

    test('claude-code template exists', async () => {
      const has = await loader.hasTemplate('claude-code');
      expect(has).toBe(true);
    });

    test('full-stack template exists', async () => {
      const has = await loader.hasTemplate('full-stack');
      expect(has).toBe(true);
    });

    test('non-existent template returns false', async () => {
      const has = await loader.hasTemplate('non-existent-template');
      expect(has).toBe(false);
    });
  });

  describe('getTemplate', () => {
    test('returns template by name', async () => {
      const template = await loader.getTemplate('basic');

      expect(template).not.toBeUndefined();
      expect(template!.name).toBe('basic');
      expect(template!.windows).toBeInstanceOf(Array);
    });

    test('returns undefined for non-existent template', async () => {
      const template = await loader.getTemplate('does-not-exist');
      expect(template).toBeUndefined();
    });

    test('auto-loads templates on first access', async () => {
      // Fresh loader, templates not loaded
      const newLoader = new TemplateLoader();
      const template = await newLoader.getTemplate('basic');

      expect(template).not.toBeUndefined();
    });
  });

  describe('getResolvedTemplate', () => {
    test('returns resolved template without inheritance', async () => {
      const resolved = await loader.getResolvedTemplate('basic');

      expect(resolved).not.toBeUndefined();
      expect(resolved!.sourceName).toBe('basic');
      expect(resolved!.inheritanceChain).toBeUndefined(); // No inheritance
    });

    test('returns undefined for non-existent template', async () => {
      const resolved = await loader.getResolvedTemplate('does-not-exist');
      expect(resolved).toBeUndefined();
    });
  });

  describe('listTemplates', () => {
    test('returns all available templates', async () => {
      const templates = await loader.listTemplates();

      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);

      // Each template should have required fields
      for (const template of templates) {
        expect(template.name).toBeDefined();
        expect(template.windows).toBeInstanceOf(Array);
      }
    });
  });

  describe('getTemplateDirectories', () => {
    test('returns builtin and user directories', () => {
      const dirs = loader.getTemplateDirectories();

      expect(dirs.builtin).toBeDefined();
      expect(dirs.user).toBeDefined();
      expect(dirs.builtin).toContain('templates');
      expect(dirs.user).toContain('.optagon');
    });
  });

  describe('reload', () => {
    test('clears and reloads cache', async () => {
      // Initial load
      await loader.loadTemplates();
      const countBefore = (await loader.listTemplates()).length;

      // Reload
      await loader.reload();
      const countAfter = (await loader.listTemplates()).length;

      expect(countAfter).toBe(countBefore);
    });
  });

  describe('singleton', () => {
    test('getTemplateLoader returns same instance', () => {
      const instance1 = getTemplateLoader();
      const instance2 = getTemplateLoader();

      expect(instance1).toBe(instance2);
    });
  });
});
