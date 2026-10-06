import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { appBasePath } from './lib/app-path.ts';
export default defineConfig(({ command, mode }) => {
  const root = fileURLToPath(new URL('./', import.meta.url));
  const environment = loadEnv(mode, root, ['NEXT_PUBLIC_APP_BASE_PATH', 'NEXT_PUBLIC_APP_LOCAL_MODE', 'APP_LOCAL_MODE']);
  if (process.env.NEXT_PUBLIC_APP_BASE_PATH === undefined && environment.NEXT_PUBLIC_APP_BASE_PATH !== undefined) {
    process.env.NEXT_PUBLIC_APP_BASE_PATH = environment.NEXT_PUBLIC_APP_BASE_PATH;
  }
  const basePath = appBasePath();
  const localMode = environment.NEXT_PUBLIC_APP_LOCAL_MODE ?? environment.APP_LOCAL_MODE ?? '1';
  if (localMode !== '0' && localMode !== '1') throw new Error('APP_LOCAL_MODE / NEXT_PUBLIC_APP_LOCAL_MODE 必须是 0 或 1。');
  return {
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  base: command === 'build' ? `${basePath}/workbench/` : `${basePath}/`,
  define: {
    'process.env.NEXT_PUBLIC_APP_BASE_PATH': JSON.stringify(basePath),
    'process.env.NEXT_PUBLIC_APP_LOCAL_MODE': JSON.stringify(localMode),
  },
  publicDir: '../public',
  plugins: [vue({template:{transformAssetUrls:{includeAbsolute:false}}})],
  // Shared public files are served by Next beneath the deployment prefix.
  experimental: { renderBuiltUrl: (filename, { type }) => type === 'public' ? `${basePath}/${filename}` : undefined },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  build: { outDir: '../public/workbench', emptyOutDir: true, copyPublicDir: false, sourcemap: false },
  server: {
    host: '127.0.0.1', port: 3000, strictPort: true,
    proxy: Object.fromEntries(['/api','/login','/samples','/fonts','/favicon.svg'].map(prefix => [basePath + prefix,{target:'http://127.0.0.1:3002',changeOrigin:false}]))
  }
  };
});
