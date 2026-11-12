import { test, expect, type Page } from "@playwright/test";

/** Dev auth bypass: POST /api/auth/test returns a session id; we plant the
 *  cookies the OAuth flow would set. Only works with NODE_ENV=test. */
async function signIn(page: Page, login: string, role?: string) {
  const res = await page.request.post("http://localhost:3000/api/auth/test", {
    data: { login, role },
  });
  const { sessionId } = await res.json();
  await page.context().addCookies([
    {
      name: "__Host-ferry-session",
      value: sessionId,
      domain: "localhost",
      path: "/",
      secure: true,
      httpOnly: true,
    },
    {
      name: "ferry-csrf",
      value: "e2e-csrf",
      domain: "localhost",
      path: "/",
    },
  ]);
}

test.describe("ferry e2e", () => {
  test("admin sees projects and can create one", async ({ page }) => {
    await signIn(page, "e2e-admin");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await page.getByRole("button", { name: /New project/ }).click();
    await page.getByLabel("Name").fill("e2eproj");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("e2eproj")).toBeVisible();
  });

  test("viewer cannot add keys", async ({ page }) => {
    await signIn(page, "e2e-viewer", "viewer");
    await page.goto("/");
    await expect(page.getByRole("button", { name: /New project/ })).toHaveCount(0);
  });
});
