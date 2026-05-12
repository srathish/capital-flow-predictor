import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig "@/*" -> ./*
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    include: ["lib/**/*.test.ts", "__tests__/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
