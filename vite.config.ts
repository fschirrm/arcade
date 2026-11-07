import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig({
  base: '/arcade/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Tile Surge',
        short_name: 'Tile Surge',
        description: 'A neon arcade brick-breaker game.',
        theme_color: '#050714',
        background_color: '#050714',
        display: 'standalone',
        start_url: '/arcade/',
        scope: '/arcade/',
        icons: [
          {src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png'},
          {src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png'},
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,png,mp3,webmanifest}'],
      },
    }),
  ],
});
