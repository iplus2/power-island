import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "browser.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:5173", headless: true },
  reporter: "list",
  outputDir: "work/browser-results",
});
