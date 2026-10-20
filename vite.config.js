import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const previewHost = process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ? `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
  : null;

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: previewHost ? [previewHost] : [],
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.API_PORT || 3001}`, changeOrigin: false } },
  },
});