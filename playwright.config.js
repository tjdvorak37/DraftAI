import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'API_PORT=3002 DATABASE_PATH=:memory: npx concurrently -k "node server/index.js" "vite --host 127.0.0.1 --port 5174 --strictPort"',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
  },
});