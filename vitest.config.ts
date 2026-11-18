import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Tests never touch the network: they read the snapshot in fixtures/cache.
    env: {
      GRAVEYARD_OFFLINE: '1',
      GRAVEYARD_CACHE: path.join(tmpdir(), 'graveyard-shift-test-cache'),
    },
  },
});
