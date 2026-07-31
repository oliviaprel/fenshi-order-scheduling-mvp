import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const APP_ORIGIN = "http://127.0.0.1:3000";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}

async function expectVisibleKeyboardFocus(page: Page, label: string): Promise<void> {
  const control = page.getByLabel(label);
  await control.focus();
  await expect(control).toBeFocused();
  const focus = await control.evaluate((element) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    const color = style.outlineColor.replaceAll(" ", "").toLowerCase();
    return {
      width,
      hasVisibleColor:
        color !== "transparent" &&
        color !== "rgba(0,0,0,0)" &&
        color !== "#00000000",
    };
  });
  expect(focus.width).toBeGreaterThan(0);
  expect(focus.hasVisibleColor).toBe(true);
}

async function expectSecretForgotten(page: Page, secret: string, consoleMessages: string[]) {
  const retention = await page.evaluate((temporaryPassword) => ({
    dom: document.body.textContent?.includes(temporaryPassword) ?? false,
    url: window.location.href.includes(temporaryPassword),
    localStorage: JSON.stringify(localStorage).includes(temporaryPassword),
    sessionStorage: JSON.stringify(sessionStorage).includes(temporaryPassword),
  }), secret);
  expect(retention).toEqual({
    dom: false,
    url: false,
    localStorage: false,
    sessionStorage: false,
  });
  expect(consoleMessages.some((message) => message.includes(secret))).toBe(false);
}

async function runCompleteManagementFlow(
  page: Page,
  viewport: { width: number; height: number },
  identity: { displayName: string; phone: string },
): Promise<void> {
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  await page.setViewportSize(viewport);
  await loginAsAdmin(page);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const createButton = page.getByRole("button", { name: "新增用户" });
  await createButton.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("账户名称").fill(identity.displayName);
  await page.getByLabel("手机号").fill(identity.phone);
  await page.getByRole("button", { name: "确认创建" }).click();
  await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
  await expect(page.getByRole("button", { name: "我已保存" })).toBeFocused();
  const createdPassword = (await page.getByLabel("临时密码", { exact: true }).textContent()) ?? "";
  expect(createdPassword.length).toBeGreaterThanOrEqual(16);
  await page.getByRole("button", { name: "我已保存" }).click();
  await expectSecretForgotten(page, createdPassword, consoleMessages);

  const searchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/admin/users?") &&
      response.url().includes("query="),
  );
  await page.getByLabel("搜索用户").fill(identity.displayName);
  await page.getByRole("button", { name: "搜索" }).click();
  expect((await searchResponse).status()).toBe(200);

  const recordRole = viewport.width <= 900 ? "article" : "row";
  await expect(page.getByRole(recordRole, { name: new RegExp(identity.displayName) })).toBeVisible();
  await page.getByRole("button", { name: `编辑${identity.displayName}` }).click();
  await page.getByLabel("状态").selectOption("PAUSED");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole(recordRole, { name: new RegExp(`${identity.displayName}.*已暂停`) })).toBeVisible();

  const resetButton = page.getByRole("button", { name: `重置${identity.displayName}密码` });
  await resetButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`确认重置${identity.displayName}的密码吗？`)).toBeVisible();
  const resetCancel = page.getByRole("button", { name: "取消" });
  await expect(resetCancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "确认重置" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByText(`确认重置${identity.displayName}的密码吗？`)).not.toBeVisible();
  await expect(resetButton).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(resetCancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "确认重置" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
  await expect(page.getByRole("button", { name: "我已保存" })).toBeFocused();
  const resetPassword = (await page.getByLabel("临时密码", { exact: true }).textContent()) ?? "";
  expect(resetPassword.length).toBeGreaterThanOrEqual(16);
  await page.getByRole("button", { name: "我已保存" }).click();
  await expectSecretForgotten(page, resetPassword, consoleMessages);

  const disableButton = page.getByRole("button", { name: `禁用${identity.displayName}` });
  await disableButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(`确认禁用${identity.displayName}吗？`)).toBeVisible();
  const disableCancel = page.getByRole("button", { name: "取消" });
  await expect(disableCancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "确认禁用" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole(recordRole, { name: new RegExp(`${identity.displayName}.*已禁用`) })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectVisibleKeyboardFocus(page, "搜索用户");
}

test.describe.serial("administrator user management", () => {
  for (const scenario of [
    { viewport: { width: 390, height: 844 }, displayName: "窄屏清和堂", phone: "13600136001" },
    { viewport: { width: 768, height: 1024 }, displayName: "平板清和堂", phone: "13600136002" },
    { viewport: { width: 1440, height: 900 }, displayName: "桌面清和堂", phone: "13600136003" },
  ]) {
    test(`real management flow is responsive and keyboard operable at ${scenario.viewport.width}x${scenario.viewport.height}`, async ({
      page,
    }) => {
      await runCompleteManagementFlow(page, scenario.viewport, scenario);
    });
  }

  test("pagination follows a real cursor API request", async ({ page }) => {
    await loginAsAdmin(page);
    const fixtures = Array.from({ length: 9 }, (_, index) => ({
      displayName: `分页用户${index + 1}`,
      phone: `13500135${String(index + 1).padStart(3, "0")}`,
    }));
    const createResponses = await Promise.all(
      fixtures.map((fixture) =>
        page.request.post("/api/admin/users", {
          data: fixture,
          headers: { origin: APP_ORIGIN },
        }),
      ),
    );
    expect(createResponses.every((response) => response.status() === 201)).toBe(true);
    await page.goto("/admin/users");
    const firstNames = await page.locator(".desktop-user-table tbody th").allTextContents();
    expect(firstNames).toHaveLength(10);
    const nextResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/admin/users?") &&
        response.url().includes("cursor="),
    );
    await page.getByRole("button", { name: "下一页" }).click();
    expect((await nextResponse).status()).toBe(200);
    const secondNames = await page.locator(".desktop-user-table tbody th").allTextContents();
    expect(secondNames).not.toEqual(firstNames);

    await page.getByRole("button", { name: "上一页" }).click();
    await expect(page.locator(".desktop-user-table tbody tr")).toHaveCount(10);
    await page.getByRole("button", { name: "新增用户" }).click();
    await page.getByLabel("账户名称").fill("满页新增用户");
    await page.getByLabel("手机号").fill("13500135999");
    await page.getByRole("button", { name: "确认创建" }).click();
    await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
    await page.getByRole("button", { name: "我已保存" }).click();
    await expect(page.getByLabel("搜索用户")).toHaveValue("满页新增用户");
    await expect(page.getByRole("rowheader", { name: "满页新增用户" })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
  });

  test("a stale edit shows the refresh message and never overwrites server data", async ({ page }) => {
    await loginAsAdmin(page);
    const createResponse = await page.request.post("/api/admin/users", {
      data: { displayName: "并发编辑用户", phone: "13600136009" },
      headers: { origin: APP_ORIGIN },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as {
      user: { id: string; version: number; phone: string };
    };

    await page.goto("/admin/users");
    await page.getByLabel("搜索用户").fill("并发编辑用户");
    await page.getByRole("button", { name: "搜索" }).click();
    await page.getByRole("button", { name: "编辑并发编辑用户" }).click();

    const concurrentResponse = await page.request.patch(`/api/admin/users/${created.user.id}`, {
      data: {
        displayName: "服务器已更新名称",
        phone: created.user.phone,
        status: "PAUSED",
        version: created.user.version,
      },
      headers: { origin: APP_ORIGIN },
    });
    expect(concurrentResponse.status()).toBe(200);

    await page.getByLabel("账户名称").fill("过期页面名称");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "该用户已被其他管理员修改" }).locator("span"),
    ).toHaveText("该用户已被其他管理员修改，请刷新后重试");

    const serverListResponse = await page.request.get(
      "/api/admin/users?query=%E6%9C%8D%E5%8A%A1%E5%99%A8%E5%B7%B2%E6%9B%B4%E6%96%B0%E5%90%8D%E7%A7%B0&limit=30",
    );
    const serverList = (await serverListResponse.json()) as {
      items: Array<{ displayName: string }>;
    };
    expect(serverList.items.map((user) => user.displayName)).toContain("服务器已更新名称");
    expect(serverList.items.map((user) => user.displayName)).not.toContain("过期页面名称");

    await page.getByRole("button", { name: "刷新列表" }).click();
    await page.getByLabel("搜索用户").fill("服务器已更新名称");
    await page.getByRole("button", { name: "搜索" }).click();
    await expect(page.getByRole("rowheader", { name: "服务器已更新名称" })).toBeVisible();
  });

  test("a regular user receives the server-rendered 403 page", async ({ page }) => {
    await loginAsAdmin(page);
    const createResponse = await page.request.post("/api/admin/users", {
      data: { displayName: "权限测试用户", phone: "13600136008" },
      headers: { origin: APP_ORIGIN },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { temporaryPassword: string };
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("手机号").fill("13600136008");
    await page.getByLabel("密码").fill(created.temporaryPassword);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel("当前密码").fill(created.temporaryPassword);
    await page.getByLabel("新密码").fill("permission-user-pass-2026");
    await page.getByRole("button", { name: "修改密码" }).click();
    await expect(page).toHaveURL(/\/home$/);

    const response = await page.goto("/admin/users");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "无权访问" })).toBeVisible();
    await expect(page.getByText("此页面仅限管理员使用")).toBeVisible();
  });
});
