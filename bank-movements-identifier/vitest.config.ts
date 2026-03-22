import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/app/services/**/*.spec.ts',
      'src/app/models/**/*.spec.ts',
      'src/app/utils/**/*.spec.ts',
    ],
  },
});