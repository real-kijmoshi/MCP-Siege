import { defineConfig } from 'vitest/config';

/** Isolates the deliberately long, output-only balance recorders from CI. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/tmpprobe.test.ts', 'tests/_crowdprobe.test.ts'],
    testTimeout: 120_000,
  },
});
