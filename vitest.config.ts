import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "app/printq/__tests__/server-only-stub.ts"),
    },
  },
  test: {
    include: ["app/**/__tests__/**/*.test.ts"],
    environment: "node",
    // DB tests share one database; run files one at a time.
    fileParallelism: false,
  },
});
