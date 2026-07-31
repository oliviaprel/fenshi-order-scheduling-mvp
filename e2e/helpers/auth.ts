import { expect, type Page } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for E2E tests`);
  }
  return value;
}

async function loginThroughUi(page: Page, phone: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await loginThroughUi(
    page,
    requiredEnvironment("E2E_ADMIN_PHONE"),
    requiredEnvironment("E2E_ADMIN_PASSWORD"),
  );
  await expect(page).toHaveURL(/\/home$/);
}

export async function loginAsUser(page: Page): Promise<void> {
  await loginThroughUi(
    page,
    requiredEnvironment("E2E_USER_PHONE"),
    requiredEnvironment("E2E_USER_PASSWORD"),
  );
  await expect(page).toHaveURL(/\/change-password$/);
}
