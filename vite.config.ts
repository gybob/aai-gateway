import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rollupOptions: {
      external: [
        /^node:/,
        /^@modelcontextprotocol\/sdk(?:\/.*)?$/,
        /^ajv(?:\/.*)?$/,
        /^zod(?:\/.*)?$/,
        /^pino(?:\/.*)?$/,
        /^pino-pretty(?:\/.*)?$/,
        'path',
        'fs',
        'fs/promises',
        'os',
        'child_process',
        'util',
        'crypto',
        'http',
        'https',
        'events',
        'stream',
        'url',
      ],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
    target: 'node18',
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
