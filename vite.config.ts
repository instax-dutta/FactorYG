import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    passWithNoTests: true,
    setupFiles: ["./tests/setup.ts"],
  },
});
