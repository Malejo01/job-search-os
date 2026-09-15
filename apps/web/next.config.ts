import { loadLocalEnv } from "@job-search-os/db";
import type { NextConfig } from "next";

// Variables del repo (.env.local en la raíz) también para next dev / next build local.
// En Vercel no existe el archivo y no hace nada.
loadLocalEnv();
// next dev apunta a Docker salvo que se pida la nube explícitamente (DB_TARGET=cloud).
if (process.env.NODE_ENV !== "production" && !process.env.DB_TARGET) {
  process.env.DB_TARGET = "local";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Los packages del monorepo se consumen como TypeScript fuente
  // Los prompts se leen del disco en runtime: sin esto no viajan en el bundle serverless de Vercel
  outputFileTracingIncludes: {
    "/**": ["../../packages/prompts/*.md"],
  },
  transpilePackages: [
    "@job-search-os/adapters",
    "@job-search-os/db",
    "@job-search-os/pipeline",
    "@job-search-os/prompts",
  ],
};

export default nextConfig;
