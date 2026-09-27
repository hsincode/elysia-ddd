import { defineConfig } from "drizzle-kit";

// テーブル定義は各コンテキストの infrastructure/schema.ts に分散している。マイグレーションは 1 本にまとめる
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/shared/infrastructure/*/schema.ts", "./src/modules/*/infrastructure/schema.ts"],
  out: "./drizzle",
  casing: "snake_case",
});
