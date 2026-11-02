import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7은 schema.prisma에 url/directUrl을 두지 않는다.
// CLI(migrate/db push)는 여기 datasource.url = DIRECT_URL(세션 풀러, 5432)을 쓰고,
// 앱 런타임은 lib/db.ts에서 DATABASE_URL(트랜잭션 풀러, 6543)을 쓴다.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
