import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Minimal server bundle for the Docker image (dashboard/Dockerfile)
  output: "standalone",
};

export default nextConfig;
