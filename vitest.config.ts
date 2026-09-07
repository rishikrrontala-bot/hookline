import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is framework-free and has no DOM dependency; keeping the tests
    // in a node environment is what proves that stays true.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
