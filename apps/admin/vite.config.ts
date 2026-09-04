import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  /**
   * Hosts the dev and preview servers will answer to, beyond localhost.
   *
   * Vite refuses requests carrying a Host header it does not recognise, which is
   * a DNS-rebinding defence and the right default. It also means a tunnel —
   * `*.trycloudflare.com` in front of this port — gets a 403 and no explanation.
   * Comma-separated; a leading dot matches subdomains.
   *
   *   VITE_ALLOWED_HOSTS=.trycloudflare.com
   */
  const env = loadEnv(mode, import.meta.dirname, '')
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean)

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: { port: 5175, strictPort: true, allowedHosts },
    preview: { port: 5175, strictPort: true, allowedHosts },
  }
})
