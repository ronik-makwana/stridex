import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entrypoints: the API and the worker deploy as separate processes.
  entry: ['src/server.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundled so the generated Prisma client resolves from the workspace package.
  noExternal: ['@shoe/db'],
})
