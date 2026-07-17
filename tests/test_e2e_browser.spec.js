const { test, expect, chromium } = require("@playwright/test");
const path = require("path");
const fs = require("fs");

const EXTENSION_PATH = path.join(__dirname, "..", "extension");

test.describe("Floyd TTY Bridge — Browser E2E", () => {
  let context;
  let extensionId;
  let serviceWorker;

  test.beforeAll(async () => {
    const userDataDir = fs.mkdtempSync(
      path.join(require("os").tmpdir(), "floyd-e2e-")
    );

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        "--disable-default-apps",
      ],
    });

    [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", {
        timeout: 15000,
      });
    }

    extensionId = serviceWorker.url().split("/")[2];
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test("extension loads and service worker starts", async () => {
    expect(serviceWorker).toBeTruthy();
    expect(extensionId).toMatch(/^[a-z]{32}$/);
  });

  test("content script injects into page", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          { type: "tool_call", tool: "get_page_state", requestId: "e2e_1", args: {} },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.result.url).toContain("example.com");
    expect(result.result.title).toContain("Example Domain");
    await page.close();
  });

  test("analyze_page returns structured analysis", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          { type: "tool_call", tool: "analyze_page", requestId: "e2e_2", args: {} },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    const r = result.result;
    expect(r.url).toContain("example.com");
    expect(r.title).toContain("Example Domain");
    expect(r.headings).toBeDefined();
    expect(r.links).toBeDefined();
    expect(r.landmarks).toBeDefined();
    await page.close();
  });

  test("find_elements returns matching elements", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "tool_call",
            tool: "find_elements",
            requestId: "e2e_3",
            args: { query: "a" },
          },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
    expect(result.result.length).toBeGreaterThan(0);
    await page.close();
  });

  test("click_element interacts with DOM", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "tool_call",
            tool: "click_element",
            requestId: "e2e_4",
            args: { selector: "h1" },
          },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.result.clicked).toBe(true);
    await page.close();
  });

  test("extract_text returns page content", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "tool_call",
            tool: "extract_text",
            requestId: "e2e_5",
            args: { selector: "body" },
          },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.result.text).toContain("Example Domain");
    await page.close();
  });

  test("check_accessibility returns audit results", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "tool_call",
            tool: "check_accessibility",
            requestId: "e2e_6",
            args: {},
          },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    const r = result.result;
    expect(r.violations).toBeDefined();
    expect(Array.isArray(r.violations)).toBe(true);
    await page.close();
  });

  test("input validation rejects missing parameters", async () => {
    const page = await context.newPage();
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const result = await serviceWorker.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true });
      const tab = tabs.find((t) => t.url?.includes("example.com"));
      if (!tab) return { error: "no tab" };
      return new Promise((resolve) => {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "tool_call",
            tool: "click_element",
            requestId: "e2e_7",
            args: {},
          },
          (response) => resolve(response)
        );
      });
    });

    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.result.error).toContain("Missing required parameter");
    await page.close();
  });
});
