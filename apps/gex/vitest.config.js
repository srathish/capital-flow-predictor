import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.js', 'src/**/*.test.js'],
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: [
        'src/index.js',
        'src/smoke.js',
        'src/**/*.test.js',
      ],
      reporter: ['text', 'json-summary', 'html'],
    },
  },
});
