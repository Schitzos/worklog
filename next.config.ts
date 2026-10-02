import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 / node-cron / node-notifier are native (or native-dependent)
  // Node modules — keep them external to the server bundle so Next does not try
  // to bundle their .node binaries / `fs` requires.
  serverExternalPackages: ["better-sqlite3", "node-cron", "node-notifier"],

  // `serverExternalPackages` covers the App-Router server bundle, but the
  // instrumentation hook's module graph (and any dynamic import reached from it)
  // is compiled by webpack separately and does NOT honor it in dev. Mark the
  // native deps as commonjs externals for every SERVER-side webpack build so
  // they are `require()`d from node_modules at runtime instead of bundled —
  // which is what lets instrumentation.ts lazily boot the scheduler without
  // webpack trying (and failing) to resolve better-sqlite3 → bindings → 'fs'.
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = ["better-sqlite3", "node-cron", "node-notifier"];
      const existing = config.externals;
      config.externals = [
        ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
        ({ request }: { request?: string }, cb: (err?: null, result?: string) => void) => {
          if (request && externals.includes(request)) {
            return cb(null, `commonjs ${request}`);
          }
          // `node:`-scheme builtins (node:crypto, node:path, …) are reached from
          // the scheduler's module graph when webpack compiles the Next 15
          // instrumentation hook for the edge context. The hook returns early on
          // non-node runtimes at runtime, but webpack still parses the chain —
          // so require these at runtime instead of trying to bundle the scheme.
          if (request && request.startsWith("node:")) {
            return cb(null, `commonjs ${request}`);
          }
          return cb();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
