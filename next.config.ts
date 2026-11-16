import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page depends on the signed-in user, so pages render per request (no prerendering).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
