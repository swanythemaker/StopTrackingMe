import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.URL || "http://127.0.0.1:8890";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

// Draw a neutral, pleasant test image and return JPEG bytes.
// Browser-encoded JPEG carries a JFIF APP0 marker, so the input scan
// will report FAIL (metadata present) -> demonstrates the FAIL->PASS story.
async function makeTestImage(page) {
  const arr = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 420;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 640, 420);
    g.addColorStop(0, "#123a2a");
    g.addColorStop(0.5, "#1f6f4a");
    g.addColorStop(1, "#d4b25a");
    x.fillStyle = g;
    x.fillRect(0, 0, 640, 420);
    x.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.arc(80 + i * 70, 120 + (i % 3) * 90, 40 + (i % 4) * 14, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "#f7f2e4";
    x.font = "bold 58px system-ui, sans-serif";
    x.fillText("vacation.jpg", 70, 260);
    x.font = "20px system-ui, sans-serif";
    x.fillText("GPS: 48.8566, 2.3522  ·  iPhone 15 Pro", 72, 300);
    const blob = await new Promise((res) =>
      c.toBlob((b) => res(b), "image/jpeg", 0.9),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(arr);
}

async function runFlow(page, label, full = true) {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector("#dropzone");
  await page.screenshot({ path: `${OUT}/${label}-empty.png`, fullPage: full });

  const buffer = await makeTestImage(page);
  await page.setInputFiles("#fileInput", {
    name: "vacation.jpg",
    mimeType: "image/jpeg",
    buffer,
  });
  await page.waitForSelector("#results:not([hidden])");
  await page.waitForFunction(() => {
    const el = document.querySelector("#inputScanCard");
    return el && el.childElementCount > 0;
  });
  await page.screenshot({ path: `${OUT}/${label}-loaded.png`, fullPage: full });

  // Kick off sanitize and try to catch the loading state.
  await page.click("#sanitizeBtn");
  try {
    await page.waitForSelector(".primary.loading", { timeout: 400 });
    await page.screenshot({ path: `${OUT}/${label}-loading.png`, fullPage: full });
  } catch {
    /* worker finished too fast to catch the spinner */
  }

  await page.waitForSelector("#downloadArea a", { timeout: 15000 });
  await page.waitForSelector(".verdict.ok");
  await page.screenshot({ path: `${OUT}/${label}-result.png`, fullPage: full });
}

const browser = await chromium.launch();

// Desktop
const desktop = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const dpage = await desktop.newPage();
await runFlow(dpage, "desktop");

// Drag overlay (desktop) — synthesize a file dragenter.
await dpage.evaluate(() => {
  const dt = new DataTransfer();
  const ev = new DragEvent("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  Object.defineProperty(dt, "types", { value: ["Files"] });
  window.dispatchEvent(ev);
});
await dpage.waitForTimeout(250);
await dpage.screenshot({ path: `${OUT}/desktop-dragover.png` });
await desktop.close();

// Mobile
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const mpage = await mobile.newPage();
await runFlow(mpage, "mobile");
await mobile.close();

await browser.close();
console.log("screenshots written to", OUT);
