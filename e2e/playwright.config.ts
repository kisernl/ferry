import { defineConfig } from "@playwright/test";

/** E2E runs against a Ferry dev server with NODE_ENV=test (dev auth bypass)
 *  and LocalStack for real SSM. Start both before running:
 *    docker run -p 4566:4566 localstack/localstack
 *    NODE_ENV=test pnpm --filter @ferry/server dev   (with .env.dev)
 *    pnpm --filter @ferry/web exec playwright test -c e2e/playwright.config.ts */
export default defineConfig({
  testDir: ".",
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
  },
  webServer: [
    {
      command: "pnpm --filter @ferry/web dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      cwd: "..",
    },
  ],
});
