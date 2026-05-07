import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['electron/services/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});
