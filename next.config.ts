import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents는 페이지의 DB 조회마다 Suspense/캐시 지정이 필요해 사내 도구 규모에 맞지 않아 끈다.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
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
