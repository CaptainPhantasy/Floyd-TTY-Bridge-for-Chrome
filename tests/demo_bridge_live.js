const { chromium } = require("@playwright/test");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXTENSION_PATH = "/Volumes/Storage/Floyd TTY Bridge for Chrome/extension";
const EVIDENCE_DIR = path.join(__dirname, "..", ".sisyphus", "evidence");

function summarizeResult(tool, payload) {
  if (!payload || typeof payload !== "object") return "no payload";
  if (payload.error) return `error=${payload.error}`;
  if (payload.success === false) return `success=false error=${payload.error || "unknown"}`;

  let result = payload.result;
  if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "success")) {
    result = result.result;
  }
  if (!result || typeof result !== "object") return "success=true";

  switch (tool) {
    case "get_page_state":
      return `url=${result.url || ""} title=${result.title || ""}`;
    case "analyze_page":
      return `headings=${(result.headings || []).length} links=${(result.links || []).length} landmarks=${Object.keys(result.landmarks || {}).length}`;
    case "find_elements":
      return `results_count=${result.results_count || 0}`;
    case "check_accessibility":
      return `violations=${result.violations_count || (result.violations || []).length || 0}`;
    case "take_screenshot":
      return `format=${result.format || "png"} bytes=${(result.screenshot || "").length}`;
    case "extract_text":
      return `count=${result.count || 0}`;
    case "scroll_to":
      return `scrolled_to=${result.scrolled_to || ""} y=${result.position ? result.position.y : ""}`;
    case "list_tabs":
      return `tabs=${Array.isArray(result) ? result.length : 0}`;
    case "click_element":
      return `clicked=${result.clicked || ""} url_after=${result.url_after || ""}`;
    default:
      return `keys=${Object.keys(result).join(",")}`;
  }
}

function saveDataUrlToPng(dataUrl, outPath) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Screenshot response is not a PNG data URL");
  }
  const base64 = dataUrl.split(",")[1];
  fs.writeFileSync(outPath, Buffer.from(base64, "base64"));
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "floyd-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chromium",
    slowMo: 500,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--no-first-run",
      "--disable-default-apps",
    ],
  });

  let serviceWorker;
  [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }

  const extensionId = serviceWorker.url().split("/")[2];
  console.log(`Extension loaded: ${extensionId}`);

  const page = await context.newPage();
  await page.bringToFront();

  let toolCount = 0;
  async function callTool(tool, args) {
    toolCount += 1;
    const requestId = `demo_${toolCount}`;
    const normalizedArgs =
      tool === "scroll_to" && args && typeof args === "object" && args.position && !args.target
        ? { ...args, target: args.position }
        : args;

    const response = await serviceWorker.evaluate(
      async ({ toolName, toolArgs, reqId }) => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const tab = tabs[0];
        if (!tab) return { success: false, error: "no active tab" };
        return new Promise((resolve) => {
          chrome.tabs.sendMessage(
            tab.id,
            { type: "tool_call", tool: toolName, requestId: reqId, args: toolArgs || {} },
            (result) => {
              const runtimeError = chrome.runtime.lastError;
              if (runtimeError) {
                resolve({ success: false, error: runtimeError.message });
                return;
              }
              resolve(result);
            }
          );
        });
      },
      { toolName: tool, toolArgs: normalizedArgs || {}, reqId: requestId }
    );

    let normalizedResult = response ? response.result : null;
    if (
      normalizedResult &&
      typeof normalizedResult === "object" &&
      Object.prototype.hasOwnProperty.call(normalizedResult, "success")
    ) {
      if (normalizedResult.success === false || normalizedResult.error) {
        throw new Error(`Tool failed: ${tool} :: ${JSON.stringify(response)}`);
      }
      normalizedResult = normalizedResult.result;
    }

    console.log(`[tool] ${tool} -> ${summarizeResult(tool, response)}`);
    if (!response || response.success === false || response.error) {
      throw new Error(`Tool failed: ${tool} :: ${JSON.stringify(response)}`);
    }
    return normalizedResult;
  }

  try {
    await page.goto("https://news.ycombinator.com", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const pageState1 = await callTool("get_page_state", {});
    console.log(`HN page state: ${pageState1.url} | ${pageState1.title}`);

    const analysis1 = await callTool("analyze_page", {});
    console.log(
      `HN analysis: headings=${(analysis1.headings || []).length}, links=${(analysis1.links || []).length}, landmarks=${Object.keys(analysis1.landmarks || {}).length}`
    );

    const found = await callTool("find_elements", { query: ".titleline a", max_results: 5, limit: 5 });
    let topStories = Array.isArray(found.results) ? found.results.slice(0, 5) : [];
    if (topStories.length === 0) {
      const firstVisibleStoryTitle = ((await page.locator(".titleline a").first().textContent()) || "").trim();
      const fallbackQuery = firstVisibleStoryTitle.slice(0, 24);
      if (fallbackQuery) {
        const fallbackFound = await callTool("find_elements", {
          query: fallbackQuery,
          max_results: 5,
          limit: 5,
        });
        topStories = Array.isArray(fallbackFound.results) ? fallbackFound.results.slice(0, 5) : [];
      }
    }
    console.log("Top 5 story titles:");
    topStories.forEach((story, idx) => {
      console.log(`  ${idx + 1}. ${story.text || "(no text)"}`);
    });

    const a11y = await callTool("check_accessibility", {});
    console.log(`A11y violations: ${a11y.violations_count || (a11y.violations || []).length || 0}`);

    const shot1 = await callTool("take_screenshot", {});
    const hnHomepageShot = path.join(EVIDENCE_DIR, "demo-hn-homepage.png");
    saveDataUrlToPng(shot1.screenshot, hnHomepageShot);
    console.log(`Saved screenshot: ${hnHomepageShot}`);

    if (topStories.length === 0 || !topStories[0].selector) {
      throw new Error("No story selectors found from find_elements");
    }

    console.log(`[action] click first story selector via Playwright: ${topStories[0].selector}`);
    await page.locator(topStories[0].selector).first().click();
    await page.waitForTimeout(3000);

    const pageState2 = await callTool("get_page_state", {});
    console.log(`Article page state: ${pageState2.url} | ${pageState2.title}`);

    const extracted = await callTool("extract_text", {
      selector: "body",
      max_length: 2000,
      limit: 1,
    });
    const extractedText = (Array.isArray(extracted.results)
      ? extracted.results.map((r) => r.text || "").join("\n\n")
      : "").slice(0, 2000);
    const extractPath = path.join(EVIDENCE_DIR, "demo-extracted-content.txt");
    fs.writeFileSync(extractPath, extractedText, "utf8");
    console.log(`Saved extracted text: ${extractPath}`);

    const shot2 = await callTool("take_screenshot", {});
    const articleShot = path.join(EVIDENCE_DIR, "demo-hn-article.png");
    saveDataUrlToPng(shot2.screenshot, articleShot);
    console.log(`Saved screenshot: ${articleShot}`);

    await callTool("scroll_to", { position: "bottom" });

    const analysis2 = await callTool("analyze_page", {});
    console.log(
      `Article analysis: headings=${(analysis2.headings || []).length}, links=${(analysis2.links || []).length}, landmarks=${Object.keys(analysis2.landmarks || {}).length}`
    );

    await page.goBack({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);

    const pageState3 = await callTool("get_page_state", {});
    console.log(`Back on HN: ${pageState3.url}`);

    const tabs = await callTool("list_tabs", {});
    console.log("Open tabs:");
    (tabs || []).forEach((tab, idx) => {
      console.log(`  ${idx + 1}. [${tab.active ? "active" : "inactive"}] ${tab.title} :: ${tab.url}`);
    });

    console.log(`BRIDGE DEMO COMPLETE — ${toolCount} tools exercised`);
    await page.waitForTimeout(5000);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exitCode = 1;
});
