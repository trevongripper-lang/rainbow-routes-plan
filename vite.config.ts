// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function buildVersionPlugin(): Plugin {
  const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    name: "tribetrips-build-version",
    apply: "build",
    generateBundle() {
      // Only emit into the client bundle (skip SSR/server environments)
      // @ts-expect-error - environment is available on Rollup plugin ctx in Vite 6+
      const envName: string | undefined = this.environment?.name;
      if (envName && envName !== "client") return;
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  vite: {
    // Publishing can run a development-mode build for diagnostics; keep JSX output
    // production-compatible for SSR so the server bundle never imports jsxDEV.
    esbuild: { jsxDev: false },
    plugins: [buildVersionPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
