import { vitePlugin as remix } from "@remix-run/dev";
import { installGlobals } from "@remix-run/node";
import { vercelPreset } from "@vercel/remix/vite";
import { defineConfig, type UserConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals({ nativeFetch: true });

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the HOST env var with SHOPIFY_APP_URL so that it doesn't break the remix server. The CLI will eventually
// stop passing in HOST, so we can remove this workaround after the next major release.
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost")
  .hostname;

let hmrConfig;
if (host === "localhost") {
  hmrConfig = {
    protocol: "ws",
    host: "localhost",
    port: 64999,
    clientPort: 64999,
  };
} else {
  hmrConfig = {
    protocol: "wss",
    host: host,
    port: parseInt(process.env.FRONTEND_PORT!) || 8002,
    clientPort: 443,
  };
}

export default defineConfig({
  server: {
    // Bind IPv4 explicitly — on Windows, Vite's "localhost" often listens on
    // ::1 only, while `shopify app dev` proxies to 127.0.0.1 (blank Admin iframe).
    host: "127.0.0.1",
    allowedHosts: [host],
    cors: {
      preflightContinue: true,
    },
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      // See https://vitejs.dev/config/server-options.html#server-fs-allow for more information
      allow: ["app", "node_modules", "../src/lib"],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      presets: [vercelPreset()],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: false,
        v3_routeConfig: true,
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  // Bundle PolarViz + d3 on the server so Vercel does not CJS-require ESM d3-scale.
  ssr: {
    noExternal: ["@shopify/polaris-viz", "@shopify/polaris-viz-core", /^d3-/],
  },
  optimizeDeps: {
    // Pre-bundle client deps so Vite does not full-reload the iframe mid-session.
    // A document reload strips shop/host tokens and Shopify redirects to /auth/login.
    entries: ["./app/**/*.{js,jsx,ts,tsx}"],
    include: [
      "@shopify/app-bridge-react",
      "@shopify/polaris",
      "@shopify/polaris-icons",
      "@shopify/polaris-viz",
      "@remix-run/react",
      "react",
      "react-dom",
      "react/jsx-runtime",
    ],
  },
}) satisfies UserConfig;
