import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/reddit-guesser",
  images: { unoptimized: true },
};

export default nextConfig;
