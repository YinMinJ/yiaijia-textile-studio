import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  base: command === 'build' ? '/workbench/' : '/',
  publicDir: '../public',
  plugins: [vue({template:{transformAssetUrls:{includeAbsolute:false}}})],
  // Shared public files are served by Next at the origin root.
  experimental: { renderBuiltUrl: (filename, { type }) => type === 'public' ? `/${filename}` : undefined },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  build: { outDir: '../public/workbench', emptyOutDir: true, copyPublicDir: false, sourcemap: false },
  server: {
    host: '127.0.0.1', port: 3000, strictPort: true,
    proxy: Object.fromEntries(['/api','/login','/samples','/fonts','/favicon.svg'].map(prefix => [prefix,{target:'http://127.0.0.1:3002',changeOrigin:false}]))
  }
}));
