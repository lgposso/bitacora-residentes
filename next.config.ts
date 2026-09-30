import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite (Postgres embebido, solo local) carga archivos WebAssembly: no se empaqueta.
  serverExternalPackages: ['@electric-sql/pglite']
};

export default nextConfig;
