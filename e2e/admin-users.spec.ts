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

  const createButton = page.getByRole("button", { name: "新增用户", exact: true });
  await createButton.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("账户名称").fill(identity.displayName);
  await page.getByLabel("手机号").fill(identity.phone);
  let releaseCreate: (() => void) | undefined;
  if (viewport.width === 390) {
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    await page.route("**/api/admin/users", async (route) => {
      await createGate;
      await route.continue();
    }, { times: 1 });
  }
  await page.getByRole("button", { name: "确认创建" }).click();
  if (releaseCreate !== undefined) {
    await expect(page.getByRole("button", { name: "提交中…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    const pendingCreate = {
      dialogVisible: await page.getByRole("dialog", { name: "新增用户" }).isVisible(),
      cancelDisabled: await page.getByRole("button", { name: "取消" }).isDisabled(),
    };
    releaseCreate();
    expect(pendingCreate).toEqual({ dialogVisible: true, cancelDisabled: true });
  }
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
  await page.getByRole("button", { name: "搜索", exact: true }).click();
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
  let releaseReset: (() => void) | undefined;
  if (viewport.width === 390) {
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });
    await page.route("**/api/admin/users/*/reset-password", async (route) => {
      await resetGate;
      await route.continue();
    }, { times: 1 });
  }
  await page.keyboard.press("Enter");
  if (releaseReset !== undefined) {
    await expect(page.getByRole("button", { name: "重置中…" })).toBeDisabled();
    await page.keyboard.press("Escape");
    const pendingReset = {
      dialogVisible: await page.getByRole("alertdialog").isVisible(),
      cancelDisabled: await page.getByRole("button", { name: "取消" }).isDisabled(),
    };
    releaseReset();
    expect(pendingReset).toEqual({ dialogVisible: true, cancelDisabled: true });
  }
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
  await expect(page.getByRole("button", { name: `编辑${identity.displayName}` })).toBeFocused();

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
    await page.getByRole("button", { name: "新增用户", exact: true }).click();
    await page.getByLabel("账户名称").fill("满页新增用户");
    await page.getByLabel("手机号").fill("13500135999");
    const authoritativePage = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/admin/users?") &&
        !response.url().includes("query="),
    );
    await page.getByRole("button", { name: "确认创建" }).click();
    await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
    await page.getByRole("button", { name: "我已保存" }).click();
    const authoritativeBody = (await authoritativePage).json() as Promise<{
      items: Array<{ displayName: string }>;
      nextCursor: string | null;
    }>;
    const authoritative = await authoritativeBody;
    await expect(page.getByLabel("搜索用户")).toHaveValue("");
    expect(await page.locator(".desktop-user-table tbody th").allTextContents()).toEqual(
      authoritative.items.map((user) => user.displayName),
    );
    if (authoritative.nextCursor === null) {
      await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
    } else {
      await expect(page.getByRole("button", { name: "下一页" })).toBeEnabled();
    }
  });

  test("creating preserves the active filter and commits refreshed state atomically", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/users");
    await page.getByLabel("搜索用户").fill("测试操作员");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByRole("rowheader", { name: "测试操作员" })).toBeVisible();

    const successfulRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("query=%E6%B5%8B%E8%AF%95%E6%93%8D%E4%BD%9C%E5%91%98"),
    );
    await page.getByRole("button", { name: "新增用户", exact: true }).click();
    await page.getByLabel("账户名称").fill("筛选外新增用户");
    await page.getByLabel("手机号").fill("13600136101");
    await page.getByRole("button", { name: "确认创建" }).click();
    expect((await successfulRefresh).status()).toBe(200);
    await page.getByRole("button", { name: "我已保存" }).click();
    await expect(page.getByLabel("搜索用户")).toHaveValue("测试操作员");
    await expect(page.getByRole("rowheader", { name: "测试操作员" })).toBeVisible();
    await expect(page.getByText("筛选外新增用户")).not.toBeVisible();

    const beforeNames = await page.locator(".desktop-user-table tbody th").allTextContents();
    const previousDisabled = await page.getByRole("button", { name: "上一页" }).isDisabled();
    const nextDisabled = await page.getByRole("button", { name: "下一页" }).isDisabled();
    await page.route("**/api/admin/users?*", (route) => route.abort("failed"), { times: 1 });
    await page.getByRole("button", { name: "新增用户", exact: true }).click();
    await page.getByLabel("账户名称").fill("刷新失败新增用户");
    await page.getByLabel("手机号").fill("13600136102");
    await page.getByRole("button", { name: "确认创建" }).click();
    await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
    await page.getByRole("button", { name: "我已保存" }).click();

    await expect(page.getByLabel("搜索用户")).toHaveValue("测试操作员");
    expect(await page.locator(".desktop-user-table tbody th").allTextContents()).toEqual(beforeNames);
    expect(await page.getByRole("button", { name: "上一页" }).isDisabled()).toBe(previousDisabled);
    expect(await page.getByRole("button", { name: "下一页" }).isDisabled()).toBe(nextDisabled);
    await expect(page.getByRole("alert").filter({ hasText: "加载失败" })).toBeVisible();
  });

  test("editing a user out of the active filter removes it through an authoritative refresh", async ({ page }) => {
    await loginAsAdmin(page);
    const createResponse = await page.request.post("/api/admin/users", {
      data: { displayName: "编辑筛选用户", phone: "13600136103" },
      headers: { origin: APP_ORIGIN },
    });
    expect(createResponse.status()).toBe(201);
    await page.goto("/admin/users");
    await page.getByLabel("搜索用户").fill("编辑筛选用户");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("button", { name: "编辑编辑筛选用户" }).click();
    await page.getByLabel("账户名称").fill("已移出筛选用户");
    const refreshedList = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("query=%E7%BC%96%E8%BE%91%E7%AD%9B%E9%80%89%E7%94%A8%E6%88%B7"),
    );
    await page.getByRole("button", { name: "保存修改" }).click();
    expect((await refreshedList).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "没有找到用户" })).toBeVisible();
    await expect(page.getByText("已移出筛选用户")).not.toBeVisible();
  });

  test("an independent disable conflict closes the modal and focuses an actionable refresh", async ({ page }) => {
    await loginAsAdmin(page);
    const createResponse = await page.request.post("/api/admin/users", {
      data: { displayName: "禁用冲突用户", phone: "13600136104" },
      headers: { origin: APP_ORIGIN },
    });
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as {
      user: { id: string; displayName: string; phone: string; version: number };
    };
    await page.goto("/admin/users");
    await page.getByLabel("搜索用户").fill(created.user.displayName);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("button", { name: `禁用${created.user.displayName}` }).click();

    const concurrentResponse = await page.request.patch(`/api/admin/users/${created.user.id}`, {
      data: {
        displayName: created.user.displayName,
        phone: created.user.phone,
        status: "PAUSED",
        version: created.user.version,
      },
      headers: { origin: APP_ORIGIN },
    });
    expect(concurrentResponse.status()).toBe(200);
    await page.getByRole("button", { name: "确认禁用" }).click();

    await expect(page.getByRole("alertdialog")).not.toBeVisible();
    const conflictAlert = page.getByRole("alert").filter({ hasText: "该用户已被其他管理员修改" });
    await expect(conflictAlert).toBeVisible();
    await expect(conflictAlert).toBeFocused();
    await expect(page.getByRole("button", { name: "刷新列表" })).toBeVisible();
  });

  test("disabling the second duplicate-name user focuses that same stable user id", async ({ page }) => {
    await loginAsAdmin(page);
    const createResponses = await Promise.all([
      page.request.post("/api/admin/users", {
        data: { displayName: "重名用户", phone: "13600136107" },
        headers: { origin: APP_ORIGIN },
      }),
      page.request.post("/api/admin/users", {
        data: { displayName: "重名用户", phone: "13600136108" },
        headers: { origin: APP_ORIGIN },
      }),
    ]);
    expect(createResponses.every((response) => response.status() === 201)).toBe(true);
    const created = await Promise.all(
      createResponses.map((response) =>
        response.json() as Promise<{ user: { id: string; phone: string } }>,
      ),
    );

    await page.goto("/admin/users");
    await page.getByLabel("搜索用户").fill("重名用户");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const matchingRows = page.locator(".desktop-user-table tbody tr");
    await expect(matchingRows).toHaveCount(2);
    const targetRow = matchingRows.nth(1);
    const targetPhone = (await targetRow.locator("td").nth(0).textContent()) ?? "";
    const targetId = created.find((result) => result.user.phone === targetPhone)?.user.id;
    expect(targetId).toBeTruthy();

    await targetRow.getByRole("button", { name: "禁用重名用户" }).click();
    await page.getByRole("button", { name: "确认禁用" }).click();

    await expect(targetRow.getByRole("button", { name: "编辑重名用户" })).toBeFocused();
    expect(await targetRow.getAttribute("data-user-id")).toBe(targetId);
  });

  test("a delayed search cannot be overwritten by an interleaved real create refresh", async ({ page }) => {
    await loginAsAdmin(page);
    const targetResponse = await page.request.post("/api/admin/users", {
      data: { displayName: "并发搜索目标", phone: "13600136105" },
      headers: { origin: APP_ORIGIN },
    });
    expect(targetResponse.status()).toBe(201);
    await page.goto("/admin/users");

    let releaseSearch: (() => void) | undefined;
    let releaseCreateRefresh: (() => void) | undefined;
    const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
    const createRefreshGate = new Promise<void>((resolve) => { releaseCreateRefresh = resolve; });
    const requestUrls: string[] = [];
    const completedRequests: number[] = [];
    await page.route("**/api/admin/users?*", async (route) => {
      if (requestUrls.length >= 2) {
        await route.continue();
        return;
      }
      requestUrls.push(route.request().url());
      const requestNumber = requestUrls.length;
      if (requestNumber === 1) await searchGate;
      if (requestNumber === 2) await createRefreshGate;
      const response = await page.request.get(route.request().url());
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: await response.body(),
      });
      completedRequests.push(requestNumber);
    });

    await page.getByLabel("搜索用户").fill("并发搜索目标");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect.poll(() => requestUrls.length).toBe(1);
    await page.getByRole("button", { name: "新增用户", exact: true }).click();
    await page.getByLabel("账户名称").fill("并发创建用户");
    await page.getByLabel("手机号").fill("13600136106");
    await page.getByRole("button", { name: "确认创建" }).click();
    await expect.poll(() => requestUrls.length).toBe(2);

    releaseSearch?.();
    await expect.poll(() => completedRequests).toContain(1);
    releaseCreateRefresh?.();
    await expect.poll(() => completedRequests).toContain(2);
    await expect(page.getByText("临时密码仅显示一次")).toBeVisible();
    await page.getByRole("button", { name: "我已保存" }).click();

    const expectedResponse = await page.request.get(
      "/api/admin/users?query=%E5%B9%B6%E5%8F%91%E6%90%9C%E7%B4%A2%E7%9B%AE%E6%A0%87&limit=10",
    );
    const expected = (await expectedResponse.json()) as {
      items: Array<{ displayName: string }>;
      nextCursor: string | null;
    };
    await expect(page.getByLabel("搜索用户")).toHaveValue("并发搜索目标");
    expect(await page.locator(".desktop-user-table tbody th").allTextContents()).toEqual(
      expected.items.map((user) => user.displayName),
    );
    await expect(page.getByRole("button", { name: "上一页" })).toBeDisabled();
    if (expected.nextCursor === null) {
      await expect(page.getByRole("button", { name: "下一页" })).toBeDisabled();
    } else {
      await expect(page.getByRole("button", { name: "下一页" })).toBeEnabled();
    }
  });

  test("a delayed next page cannot be overwritten by an interleaved real edit refresh", async ({ page }) => {
    await loginAsAdmin(page);
    const fixtures = Array.from({ length: 9 }, (_, index) => ({
      displayName: `分页交错用户${index + 1}`,
      phone: `13600136${String(index + 200).padStart(3, "0")}`,
    }));
    const createResponses = [];
    for (const fixture of fixtures) {
      createResponses.push(
        await page.request.post("/api/admin/users", {
          data: fixture,
          headers: { origin: APP_ORIGIN },
        }),
      );
    }
    expect(createResponses.every((response) => response.status() === 201)).toBe(true);
    const firstPageResponse = await page.request.get("/api/admin/users?limit=10");
    const firstPage = (await firstPageResponse.json()) as { nextCursor: string | null };
    expect(firstPage.nextCursor).not.toBeNull();
    await page.goto("/admin/users");
    const firstRow = page.locator(".desktop-user-table tbody tr").first();
    const originalName = (await firstRow.getByRole("rowheader").textContent()) ?? "";

    let releasePagination: (() => void) | undefined;
    let releaseEditRefresh: (() => void) | undefined;
    const paginationGate = new Promise<void>((resolve) => { releasePagination = resolve; });
    const editRefreshGate = new Promise<void>((resolve) => { releaseEditRefresh = resolve; });
    const requestUrls: string[] = [];
    const completedRequests: number[] = [];
    await page.route("**/api/admin/users?*", async (route) => {
      if (requestUrls.length >= 2) {
        await route.continue();
        return;
      }
      requestUrls.push(route.request().url());
      const requestNumber = requestUrls.length;
      if (requestNumber === 1) await paginationGate;
      if (requestNumber === 2) await editRefreshGate;
      const response = await page.request.get(route.request().url());
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: await response.body(),
      });
      completedRequests.push(requestNumber);
    });

    await page.getByRole("button", { name: "下一页" }).click();
    await expect.poll(() => requestUrls.length).toBe(1);
    await firstRow.getByRole("button", { name: `编辑${originalName}` }).click();
    await page.getByLabel("账户名称").fill(`${originalName}并发更新`);
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect.poll(() => requestUrls.length).toBe(2);

    releasePagination?.();
    await expect.poll(() => completedRequests).toContain(1);
    releaseEditRefresh?.();
    await expect.poll(() => completedRequests).toContain(2);
    await expect(page.getByRole("dialog", { name: new RegExp(`编辑${originalName}`) })).not.toBeVisible();

    const expectedResponse = await page.request.get(
      `/api/admin/users?cursor=${firstPage.nextCursor}&limit=10`,
    );
    const expected = (await expectedResponse.json()) as {
      items: Array<{ displayName: string }>;
      nextCursor: string | null;
    };
    expect(requestUrls[1]).toContain(`cursor=${firstPage.nextCursor}`);
    expect(await page.locator(".desktop-user-table tbody th").allTextContents()).toEqual(
      expected.items.map((user) => user.displayName),
    );
    await expect(page.getByRole("button", { name: "上一页" })).toBeEnabled();
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
    await page.getByRole("button", { name: "搜索", exact: true }).click();
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
    await page.getByRole("button", { name: "搜索", exact: true }).click();
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
