import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    open: false,
    // allowlisted hosts for tunnelling (ngrok / external dev hosts)
    allowedHosts: ['inviolate-subgranular-arie.ngrok-free.dev'],
  },
  publicDir: 'public',
  build: {
    rollupOptions: {
      // include the remote entry so Vite outputs /remote/index.html in production
      input: {
        main: path.resolve(__dirname, 'index.html'),
        remote: path.resolve(__dirname, 'remote', 'index.html'),
      },
    },
  },
});
