import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/mcp-server.ts'], // Exclude Obsidian-dependent files
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      // Mock Obsidian module for testing
      obsidian: './tests/mocks/obsidian.ts',
    },
  },
});
