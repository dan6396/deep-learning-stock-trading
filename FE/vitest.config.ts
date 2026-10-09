import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Kept separate from vite.config.ts so unit tests don't load the KIS dev-server plugin.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx,js}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
