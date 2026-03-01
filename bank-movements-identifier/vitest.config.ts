import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/app/services/**/*.spec.ts', 'src/app/models/**/*.spec.ts'],
  },
});