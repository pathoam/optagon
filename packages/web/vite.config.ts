import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Optagon',
        short_name: 'Optagon',
        description: 'Remote access to your development frames',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/optagon\.app\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 300,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '~': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,        // PWA dev server port
    host: true,        // Bind to 0.0.0.0 for container access
    /**
     * Dev proxy configuration - forwards requests to tunnel-server
     *
     * DEV SETUP:
     * 1. Start tunnel-server: cd packages/tunnel-server && bun run dev
     *    - Listens on port 3001
     *    - Serves /api/*, /ws, /tunnel, /health, /stats
     *
     * 2. Start PWA: cd packages/web && bun run dev
     *    - Listens on port 3000
     *    - Proxies backend routes to tunnel-server
     *
     * KEEP IN SYNC:
     * - Proxy targets must match tunnel-server port (3001)
     * - /api/config route is served by tunnel-server for runtime config
     * - See connection-config.ts for WebSocket URL presets
     */
    proxy: {
      // Proxy API requests to local tunnel-server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy WebSocket connections to local tunnel-server
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/tunnel': {
        target: 'ws://localhost:3001',
        ws: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/stats': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'clerk': ['@clerk/clerk-js'],
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-webgl'],
        },
      },
    },
  },
});
