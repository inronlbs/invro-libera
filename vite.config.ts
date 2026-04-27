import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor';
          }

          if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run/router')) {
            return 'router-vendor';
          }

          if (id.includes('node_modules/react-pdf') || id.includes('node_modules/pdfjs-dist')) {
            return 'pdf-reader-vendor';
          }

          if (id.includes('node_modules/react-reader') || id.includes('node_modules/epubjs')) {
            return 'epub-reader-vendor';
          }

          if (id.includes('node_modules/dexie') || id.includes('node_modules/uuid')) {
            return 'storage-vendor';
          }

          if (id.includes('node_modules/onnxruntime-web')) {
            return 'piper-onnx-vendor';
          }

          if (id.includes('node_modules/phonemizer')) {
            return 'piper-phonemizer-vendor';
          }

          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.ico', 'robots.txt', 'assets/**/*'],
      manifest: {
        name: 'Invro Libera',
        short_name: 'Invro Libera',
        description: 'Offline-first E-Library for Schools',
        theme_color: '#1a56db',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        categories: ['education', 'books']
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // Books are served from the encrypted Axum backend — no need to SW-cache them
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
        // Only precache app shell resources — NOT book assets
        globPatterns: [
          '**/*.{js,mjs,css,html,ico,png,svg,webp}'
        ],
        globIgnores: ['**/*.wasm', 'assets/books/**'],
        // Runtime caching strategies
        runtimeCaching: [
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
})
