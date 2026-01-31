import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const readEnv = (key: string, fallback: string) =>
    env[key] && env[key].trim().length > 0 ? env[key] : fallback;

  const basePath = readEnv('VITE_BASE_PATH', './');

  return {
    base: basePath,
    plugins: [vue()]
  };
});
