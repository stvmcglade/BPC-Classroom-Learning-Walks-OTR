const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("C:/Users/09024076/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, "analysis.html")).href);
    const csv = [
      "recordId,practiceId,practiceTitle,indicatorNumber,indicatorText,observed",
      "example,opportunities-to-respond,Opportunities to Respond,1,Pair-Share,1",
      "example,opportunities-to-respond,Opportunities to Respond,2,Volunteers,1",
      "example,opportunities-to-respond,Opportunities to Respond,3,Other,1"
    ].join("\n");
    await page.locator("#csv-files").setInputFiles({ name: "sample.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByText("Loaded 1 file with 1 walkthrough and 3 indicator rows.", { exact: true }).waitFor();
    assert.deepEqual(await page.locator(".indicator-row__value").allTextContents(), ["34%", "33%", "33%"]);
    const insights = await page.locator("#indicator-insights").innerText();
    assert(insights.includes("34% of recorded responses (1 of 3)"));
    assert(insights.includes("33% of recorded responses (1 of 3)"));
    const downloadReady = page.waitForEvent("download");
    await page.locator("#download-pdf").click();
    const download = await downloadReady;
    const pdfPath = "tmp/pdfs/browser-export-check.pdf";
    await download.saveAs(pdfPath);
    const pdf = fs.readFileSync(pdfPath, "utf8");
    assert(pdf.includes("/Subtype /Image"));
    assert(pdf.includes("Learning Walk Analysis Report -"));
    assert(pdf.includes("Term 4 2026"));
    for (const [name, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]]) {
      await page.setViewportSize({ width, height });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator("#section-visuals").screenshot({ path: `tmp/pdfs/web-shares-${name}.png` });
    }
    assert.deepEqual(errors, []);
    console.log("Browser checks passed: shares, insight counts, desktop/mobile layout, and no page errors.");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
