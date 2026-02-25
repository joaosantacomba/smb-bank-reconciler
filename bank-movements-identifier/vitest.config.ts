import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Only run pure unit tests (no Angular TestBed) under vitest
    include: ['src/app/services/**/*.spec.ts', 'src/app/models/**/*.spec.ts'],
  },
});