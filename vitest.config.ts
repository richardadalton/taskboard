import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/http/**/*.test.ts'],
    setupFiles: ['tests/http/setup.ts'],
    // Each file runs in its own process — guarantees a fresh in-memory DB per file
    pool: 'forks',
    testTimeout: 10_000,
  },
})
