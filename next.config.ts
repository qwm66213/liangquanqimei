import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/",
        destination: "/dashboard.html",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
