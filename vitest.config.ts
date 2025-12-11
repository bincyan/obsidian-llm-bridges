import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/mcp-server.ts'], // Exclude Obsidian-dependent entry points
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      // Mock Obsidian module for testing - enables Level 2 testing
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
  },
});
