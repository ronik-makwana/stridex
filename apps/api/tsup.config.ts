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
  // ...but its CommonJS/native transitive deps stay in node_modules: bundling
  // them into ESM turns their require() calls into a shim that throws.
  external: ['pg', '@prisma/client', '@prisma/adapter-pg'],
  // Any CJS that still ends up inlined needs a real require() to call.
  banner: {
    js: "import { createRequire as __createRequire } from 'module';\nconst require = __createRequire(import.meta.url);",
  },
})
