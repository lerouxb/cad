import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // Four warm pages saturate a typical dev machine without starving the WASM
  // builds; CI keeps one worker because its runners have fewer cores. The suite
  // is CPU-bound, so more workers past this point only add WASM instances.
  workers: process.env.CI ? 1 : 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // The app fixture creates its own worker-scoped context to keep the solver
    // and OCCT WASM warm, so Playwright's per-test trace option does not apply
    // to it. Add tracing in that fixture when debugging a failure.
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 4173 --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
