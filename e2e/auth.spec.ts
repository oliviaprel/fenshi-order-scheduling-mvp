import { expect, test } from "@playwright/test";
import { disabledSessionStatePath } from "./global-setup";
import { loginAsAdmin, loginAsUser } from "./helpers/auth";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for E2E tests`);
  }
  return value;
}

test("temporary-password user must change password before home", async ({ page }) => {
  await loginAsUser(page);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel("当前密码").fill(requiredEnvironment("E2E_USER_PASSWORD"));
  await page.getByLabel("新密码").fill(requiredEnvironment("E2E_NEW_PASSWORD"));
  await page.getByRole("button", { name: "修改密码" }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "测试操作员" })).toBeVisible();
  await expect(page.getByText("订单功能将在下一阶段开放")).toBeVisible();
});

test("wrong password shows a focused Chinese error summary", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(requiredEnvironment("E2E_ADMIN_PHONE"));
  await page.getByLabel("密码").fill(requiredEnvironment("E2E_INVALID_PASSWORD"));
  await page.getByRole("button", { name: "登录" }).click();

  const summary = page.getByRole("alert").filter({ hasText: "手机号或密码错误" });
  await expect(summary).toHaveText("手机号或密码错误");
  await expect(summary).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
});

test("login submit stays disabled while the real request is in flight", async ({ page }) => {
  let releaseRequest: (() => void) | undefined;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route("**/api/auth/login", async (route) => {
    await requestGate;
    await route.continue();
  });

  await page.goto("/login");
  await page.getByLabel("手机号").fill(requiredEnvironment("E2E_ADMIN_PHONE"));
  await page.getByLabel("密码").fill(requiredEnvironment("E2E_ADMIN_PASSWORD"));
  const submit = page.getByRole("button", { name: "登录中…" });
  await page.getByRole("button", { name: "登录" }).click();
  await expect(submit).toBeDisabled();
  releaseRequest?.();
  await expect(page).toHaveURL(/\/home$/);
});

test("login form never puts credentials in the URL when JavaScript is unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("手机号").fill("13800138000");
    await page.getByLabel("密码").fill(requiredEnvironment("E2E_INVALID_PASSWORD"));
    await page.getByRole("button", { name: "登录" }).click();
    expect(new URL(page.url()).search.includes("password=")).toBe(false);
  } finally {
    await context.close();
  }
});

test("logout clears the session and returns to login", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
});

test("a disabled database-backed session is immediately returned to login", async ({ browser }) => {
  const context = await browser.newContext({ storageState: disabledSessionStatePath });
  const page = await context.newPage();
  try {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await context.close();
  }
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`auth experience has no horizontal overflow and visible keyboard focus at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("手机号")).toBeFocused();
    const focusIsVisible = await page.getByLabel("手机号").evaluate((element) => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });
    expect(focusIsVisible).toBe(true);

    await loginAsAdmin(page);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
}
