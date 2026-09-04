import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * `robots.txt`, emitted at build rather than committed to `public/`.
 *
 * The `Sitemap:` line has to be an absolute URL — a crawler cannot resolve a
 * relative one — and that URL differs per environment. A committed file would
 * either hardcode production into every dev build or ship without the line.
 */
function robotsTxt(site: string): Plugin {
  return {
    name: "stridex-robots-txt",
    apply: "build",
    generateBundle() {
      const lines = [
        "User-agent: *",
        // Nothing below these is indexable: they need a session, redirect, or
        // are personal to one customer. Keeping crawl budget on the catalogue.
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /account",
        "Disallow: /login",
        "Disallow: /register",
        "Disallow: /forgot-password",
        "Disallow: /reset-password",
        "Disallow: /verify-email",
        // Every `?q=` is a distinct URL with duplicate content behind it.
        "Disallow: /search",
        "Allow: /",
        ...(site ? ["", `Sitemap: ${site}/sitemap.xml`] : []),
      ];
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `${lines.join("\n")}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  /**
   * `loadEnv`, not `process.env`: a Vite config runs before the `.env` files
   * are read into `import.meta.env`, so `process.env.VITE_SITE_URL` is empty
   * here even when it is set for the app — which is how robots.txt first
   * shipped without its Sitemap line.
   */
  const env = loadEnv(mode, import.meta.dirname, "");
  const site = (env.VITE_SITE_URL ?? "").replace(/\/$/, "");

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
  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

  return {
    plugins: [react(), tailwindcss(), robotsTxt(site)],
    resolve: {
      // `@` resolves inside this app only. There is deliberately no alias that
      // can reach `apps/admin`: the no-sharing rule is enforced by there being no
      // path to break, not by remembering not to.
      alias: { "@": path.resolve(import.meta.dirname, "./src") },
    },
    server: { port: 5174, strictPort: true, allowedHosts },
    preview: { port: 5174, strictPort: true, allowedHosts },
    build: {
      rollupOptions: {
        output: {
          /**
           * A stable vendor chunk, separate from application code.
           *
           * Without it React, the router and the query client sit in the same
           * file as every component — so changing one line of copy invalidates
           * the whole download for every returning visitor. These three change on
           * an upgrade and never on a deploy, which is exactly what a
           * long-cached chunk should contain.
           *
           * Radix and the rest are deliberately *not* pinned here: they are
           * imported unevenly across routes, and forcing them into one chunk
           * would undo the route splitting by pulling the dialog code into the
           * first page that only needed a label.
           */
          manualChunks(id: string) {
            // Vite 8 is Rolldown-based: `manualChunks` is a function here, not
            // the object map the older Rollup docs describe.
            if (!id.includes("node_modules")) return;
            if (/node_modules\/(react|react-dom|react-router)(\/|$)/.test(id))
              return "react-vendor";
            if (id.includes("node_modules/@tanstack/react-query"))
              return "query-vendor";
            return;
          },
        },
      },
    },
  };
});
