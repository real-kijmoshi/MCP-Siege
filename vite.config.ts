import { defineConfig } from 'vite';

const webMcpHeaders = {
  'Origin-Agent-Cluster': '?1',
  'Permissions-Policy': 'tools=(self)',
};

export default defineConfig({
  base: './',
  server: {
    headers: webMcpHeaders,
  },
  preview: {
    headers: webMcpHeaders,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
