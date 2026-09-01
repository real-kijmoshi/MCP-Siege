import { defineConfig } from 'vitest/config';

/** Isolates the deliberately long, output-only balance recorder from CI. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/tmpprobe.test.ts'],
    testTimeout: 60_000,
  },
});
