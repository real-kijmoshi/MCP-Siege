import { defineConfig } from 'vitest/config';

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
    // This is a manual balance recorder with no assertions and duplicates the
    // scenario decision tests. Keeping it out of the default worker pool avoids
    // Vitest RPC timeouts during several minutes of CPU-bound probe battles.
    exclude: ['tests/tmpprobe.test.ts', 'tests/_crowdprobe.test.ts'],
    // Leave a CPU core for Vitest's coordinator. The long synchronous battle
    // simulations can otherwise starve its worker RPC for 60 seconds even
    // though every assertion passes, producing spurious onTaskUpdate errors.
    maxWorkers: 2,
    /*
     * Several tests march a full seven-thousand-man operation for minutes of
     * game time, which is tens of seconds of wall clock — and several of them
     * run at once, on shared cores. The 5s default is not a meaningful budget
     * for those, and neither was 60s once whole battles were being fought to a
     * decision in the suite. The performance test asserts the real budget, per
     * tick; this only has to be longer than the slowest honest run.
     */
    testTimeout: 150_000,
  },
});

