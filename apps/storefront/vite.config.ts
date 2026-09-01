import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@` resolves inside this app only. There is deliberately no alias that
    // can reach `apps/admin`: the no-sharing rule is enforced by there being no
    // path to break, not by remembering not to.
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { port: 5174, strictPort: true },
})
