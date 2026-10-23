import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '주간보고 도우미',
        short_name: '주간보고',
        description: '메모만 쓰면 OneFinger 주간보고 양식에 맞춰 AI가 정리해 줍니다',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f3f5f7',
        theme_color: '#1d2433',
        categories: ['productivity', 'business'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: '이번 주 작성', url: '/', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }],
      },
      workbox: {
        // 새 버전을 기다리지 않고 바로 적용하고, 지난 버전 캐시는 지운다 (예전 화면이 사라진 파일을 찾다 멈추지 않게)
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /^\/download\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // API 는 절대 캐시하지 않는다 (회사 데이터)
        runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
