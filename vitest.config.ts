import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    // Engine/lib tests run on node; component tests opt into a DOM with a
    // `// @vitest-environment happy-dom` docblock.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // next/font is a Next compiler transform; outside Next it's an empty module.
      "next/font/google": fileURLToPath(new URL("./tests/stubs/next-font-google.ts", import.meta.url))
    }
  }
});
