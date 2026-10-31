import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run from the repository root so shared/ tests are collected with the server's.
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['server/src/**/*.test.ts', 'server/test/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    pool: 'forks',
  },
});
