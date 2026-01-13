#!/usr/bin/env bun
/**
 * browser-tool CLI - Universal browser automation for Optagon agents
 *
 * Usage:
 *   browser-tool navigate <url>
 *   browser-tool screenshot [--selector <sel>] [--full-page] [--output <path>]
 *   browser-tool click <selector>
 *   browser-tool type <selector> <text>
 *   browser-tool evaluate <javascript>
 *   browser-tool content [selector]
 *   browser-tool console
 *   browser-tool errors
 *   browser-tool close
 */

import { chromium, Browser, Page } from 'playwright';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const STATE_DIR = '/tmp/browser-tool';
const STATE_FILE = join(STATE_DIR, 'state.json');
const SCREENSHOT_DIR = '/workspace/.browser-screenshots';

interface BrowserState {
  wsEndpoint?: string;
  currentUrl?: string;
  consoleLogs: Array<{ type: string; text: string; timestamp: number }>;
  jsErrors: Array<{ message: string; stack?: string; timestamp: number }>;
}

// Ensure directories exist
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

function loadState(): BrowserState {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  }
  return { consoleLogs: [], jsErrors: [] };
}

function saveState(state: BrowserState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

let browser: Browser | null = null;
let page: Page | null = null;

async function getBrowser(): Promise<{ browser: Browser; page: Page }> {
  const state = loadState();

  // Try to connect to existing browser
  if (state.wsEndpoint) {
    try {
      browser = await chromium.connectOverCDP(state.wsEndpoint);
      const contexts = browser.contexts();
      if (contexts.length > 0) {
        const pages = contexts[0].pages();
        if (pages.length > 0) {
          page = pages[0];
          return { browser, page };
        }
      }
    } catch {
      // Browser closed, start new one
    }
  }

  // Launch new browser
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });

  page = await context.newPage();

  // Capture console logs
  page.on('console', msg => {
    const state = loadState();
    state.consoleLogs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now()
    });
    // Keep last 100 logs
    if (state.consoleLogs.length > 100) {
      state.consoleLogs = state.consoleLogs.slice(-100);
    }
    saveState(state);
  });

  // Capture JS errors
  page.on('pageerror', error => {
    const state = loadState();
    state.jsErrors.push({
      message: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
    if (state.jsErrors.length > 50) {
      state.jsErrors = state.jsErrors.slice(-50);
    }
    saveState(state);
  });

  // Save endpoint for reconnection
  // Note: CDP endpoint not easily available in Playwright, we'll restart browser each session
  saveState({ ...loadState(), wsEndpoint: undefined });

  return { browser, page };
}

async function navigate(url: string) {
  const { page } = await getBrowser();

  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const state = loadState();
  state.currentUrl = url;
  saveState(state);

  console.log(JSON.stringify({
    success: true,
    url: page.url(),
    title: await page.title(),
    status: response?.status(),
  }, null, 2));
}

async function screenshot(options: { selector?: string; fullPage?: boolean; output?: string }) {
  const { page } = await getBrowser();

  const timestamp = Date.now();
  const filename = options.output || join(SCREENSHOT_DIR, `screenshot-${timestamp}.png`);

  if (options.selector) {
    const element = await page.$(options.selector);
    if (!element) {
      console.log(JSON.stringify({ success: false, error: `Element not found: ${options.selector}` }));
      return;
    }
    await element.screenshot({ path: filename });
  } else {
    await page.screenshot({ path: filename, fullPage: options.fullPage });
  }

  console.log(JSON.stringify({
    success: true,
    path: filename,
    url: page.url(),
    message: `Screenshot saved. View with: cat ${filename} | base64 (or open in viewer)`
  }, null, 2));
}

async function click(selector: string) {
  const { page } = await getBrowser();

  try {
    await page.click(selector, { timeout: 5000 });
    console.log(JSON.stringify({
      success: true,
      selector,
      url: page.url()
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      selector,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
  }
}

async function type(selector: string, text: string) {
  const { page } = await getBrowser();

  try {
    await page.fill(selector, text);
    console.log(JSON.stringify({
      success: true,
      selector,
      text: text.length > 50 ? text.slice(0, 50) + '...' : text
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      selector,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
  }
}

async function evaluate(script: string) {
  const { page } = await getBrowser();

  try {
    const result = await page.evaluate(script);
    console.log(JSON.stringify({
      success: true,
      result
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
  }
}

async function getContent(selector?: string) {
  const { page } = await getBrowser();

  try {
    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        console.log(JSON.stringify({ success: false, error: `Element not found: ${selector}` }));
        return;
      }
      const text = await element.textContent();
      const html = await element.innerHTML();
      console.log(JSON.stringify({
        success: true,
        selector,
        text,
        html: html.length > 1000 ? html.slice(0, 1000) + '...' : html
      }, null, 2));
    } else {
      const title = await page.title();
      const url = page.url();
      const text = await page.textContent('body');
      console.log(JSON.stringify({
        success: true,
        title,
        url,
        bodyText: text?.slice(0, 2000) + (text && text.length > 2000 ? '...' : '')
      }, null, 2));
    }
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
  }
}

function getConsoleLogs() {
  const state = loadState();
  console.log(JSON.stringify({
    success: true,
    count: state.consoleLogs.length,
    logs: state.consoleLogs.slice(-20) // Last 20
  }, null, 2));
}

function getErrors() {
  const state = loadState();
  console.log(JSON.stringify({
    success: true,
    count: state.jsErrors.length,
    errors: state.jsErrors.slice(-10) // Last 10
  }, null, 2));
}

async function closeBrowser() {
  const state = loadState();

  if (browser) {
    await browser.close();
  }

  saveState({ consoleLogs: [], jsErrors: [] });
  console.log(JSON.stringify({ success: true, message: 'Browser closed' }, null, 2));
}

// Parse arguments and run
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    switch (command) {
      case 'navigate':
        if (!args[1]) {
          console.log(JSON.stringify({ success: false, error: 'Usage: browser-tool navigate <url>' }));
          process.exit(1);
        }
        await navigate(args[1]);
        break;

      case 'screenshot': {
        const options: { selector?: string; fullPage?: boolean; output?: string } = {};
        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--selector' && args[i + 1]) {
            options.selector = args[++i];
          } else if (args[i] === '--full-page') {
            options.fullPage = true;
          } else if (args[i] === '--output' && args[i + 1]) {
            options.output = args[++i];
          }
        }
        await screenshot(options);
        break;
      }

      case 'click':
        if (!args[1]) {
          console.log(JSON.stringify({ success: false, error: 'Usage: browser-tool click <selector>' }));
          process.exit(1);
        }
        await click(args[1]);
        break;

      case 'type':
        if (!args[1] || !args[2]) {
          console.log(JSON.stringify({ success: false, error: 'Usage: browser-tool type <selector> <text>' }));
          process.exit(1);
        }
        await type(args[1], args.slice(2).join(' '));
        break;

      case 'evaluate':
        if (!args[1]) {
          console.log(JSON.stringify({ success: false, error: 'Usage: browser-tool evaluate <javascript>' }));
          process.exit(1);
        }
        await evaluate(args.slice(1).join(' '));
        break;

      case 'content':
        await getContent(args[1]);
        break;

      case 'console':
        getConsoleLogs();
        break;

      case 'errors':
        getErrors();
        break;

      case 'close':
        await closeBrowser();
        break;

      default:
        console.log(`browser-tool - Browser automation for Optagon agents

Commands:
  navigate <url>              Open URL, return title and status
  screenshot [options]        Take screenshot
    --selector <sel>          Screenshot specific element
    --full-page               Capture full scrollable page
    --output <path>           Save to specific path
  click <selector>            Click element
  type <selector> <text>      Type into input field
  evaluate <javascript>       Run JS and return result
  content [selector]          Get text/HTML content
  console                     Get recent console logs
  errors                      Get recent JS errors
  close                       Close browser

Examples:
  browser-tool navigate http://localhost:3000
  browser-tool screenshot --full-page
  browser-tool click "#submit-btn"
  browser-tool type "#email" "test@example.com"
  browser-tool evaluate "document.title"
  browser-tool console
`);
        break;
    }
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exit(1);
  }

  // Don't close browser after command - keep it alive for subsequent commands
  // Browser will be closed explicitly with 'close' command or on container restart
  process.exit(0);
}

main();
