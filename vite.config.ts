import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const readEnv = (key: string, fallback: string) =>
    env[key] && env[key].trim().length > 0 ? env[key] : fallback;

  const basePath = readEnv('VITE_BASE_PATH', './');
  const appVersion = (() => {
    try {
      const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf-8');
      const parsed = JSON.parse(raw) as { version?: unknown };
      return typeof parsed.version === 'string' && parsed.version.trim().length > 0
        ? parsed.version.trim()
        : '0.0.0';
    } catch {
      return '0.0.0';
    }
  })();

  return {
    base: basePath,
    plugins: [vue()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion)
    }
  };
});
