import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const readEnv = (key: string, fallback: string) =>
    env[key] && env[key].trim().length > 0 ? env[key] : fallback;

  const appName = readEnv('VITE_APP_NAME', 'Table Tennis Tracker');
  const appShortName = readEnv('VITE_APP_SHORT_NAME', 'TT Tracker');
  const appDescription =
    'A lightweight, mobile-first PWA for tracking office table tennis matches.';
  const themeColor = '#11324d';
  const backgroundColor = '#f5f0e6';
  const basePath = readEnv('VITE_BASE_PATH', './');
  const icon192 = 'icons/table-tennis-192.svg';
  const icon512 = 'icons/table-tennis-512.svg';

  return {
    base: basePath,
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [icon192, icon512],
        manifest: {
          name: appName,
          short_name: appShortName,
          description: appDescription,
          start_url: basePath,
          scope: basePath,
          display: 'standalone',
          theme_color: themeColor,
          background_color: backgroundColor,
          icons: [
            {
              src: icon192,
              sizes: '192x192',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            },
            {
              src: icon512,
              sizes: '512x512',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ]
  };
});
