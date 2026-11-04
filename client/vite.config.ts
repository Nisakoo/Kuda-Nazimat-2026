import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/**/*.test.ts', 'src/**/*.generated.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: join(process.env.TEST_ARTIFACT_DIR ?? join(tmpdir(), 'competition-2026-artifacts'), 'coverage'),
    },
    clearMocks: true,
    restoreMocks: true,
  },
});
