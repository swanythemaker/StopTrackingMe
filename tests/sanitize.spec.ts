import { expect, test, type Page } from "@playwright/test";

// Build a deterministic test image of the given mime, in-page, and return its bytes.
async function makeImage(page: Page, mime: string, w = 48, h = 32): Promise<Buffer> {
  const arr = await page.evaluate(
    async ({ mime, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d")!;
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#123a2a");
      g.addColorStop(1, "#d4b25a");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.fillStyle = "#fff";
      x.fillRect(2, 2, 6, 6); // an asymmetric mark so rotation/flip is observable
      const blob = await new Promise<Blob>((res) =>
        c.toBlob((b) => res(b!), mime, 0.9),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { mime, w, h },
  );
  return Buffer.from(arr);
}

// Dropping a file auto-runs the input scan + first sanitize (the carousel transition), then lands
// on the result slide. No Sanitize button, the upload itself drives the flow.
async function uploadAndClean(page: Page, name: string, mime: string, buffer: Buffer) {
  await page.setInputFiles("#fileInput", { name, mimeType: mime, buffer });
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 25000 });
  await expect(page.locator(".verdict.ok")).toBeVisible();
}

// Adjust controls (resize/rotate/flip, format, quality) live in the inline mini-editor on step 2.
async function enterEdit(page: Page) {
  await page.locator("#editBtn").click();
  await expect(page.locator("#editor")).toBeVisible();
}

// The Ultra Paranoid checkbox is a styled switch (hidden input), so toggle it in the DOM.
async function setUltra(page: Page, on: boolean) {
  await page.evaluate((want) => {
    const cb = document.querySelector<HTMLInputElement>("#ultraParanoid")!;
    if (cb.checked !== want) {
      cb.checked = want;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, on);
}

async function outputDims(page: Page): Promise<{ w: number; h: number }> {
  await page.waitForFunction(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview");
    return !!i && i.naturalWidth > 0;
  });
  return page.evaluate(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview")!;
    return { w: i.naturalWidth, h: i.naturalHeight };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

for (const { mime, ext, kind } of [
  { mime: "image/png", ext: "png", kind: "png" },
  { mime: "image/jpeg", ext: "jpg", kind: "jpeg" },
  { mime: "image/webp", ext: "webp", kind: "webp" },
]) {
  test(`sanitize ${mime} produces a clean downloadable output`, async ({ page }) => {
    const buf = await makeImage(page, mime);
    await uploadAndClean(page, `in.${ext}`, mime, buf);

    // Re-encode to this format (turn off Ultra Paranoid, which forces PNG) via the mini-editor.
    await enterEdit(page);
    await setUltra(page, false);
    await page.locator("#outputFormat").selectOption(mime);
    // The output scan report names the container kind once the inline re-clean completes.
    await expect(page.locator("#outputReport")).toContainText(`kind: ${kind}`, {
      timeout: 25000,
    });

    const report = await page.locator("#outputReport").textContent();
    expect(report).toContain("status: PASS");
    const dims = await outputDims(page);
    expect(dims).toEqual({ w: 48, h: 32 });
  });
}

test("resize 50% halves the output dimensions", async ({ page }) => {
  const buf = await makeImage(page, "image/png");
  await uploadAndClean(page, "in.png", "image/png", buf);
  await enterEdit(page);
  await page.locator('#resizeChips button[data-pct="50"]').click();
  await expect(page.locator("#dimReadout")).toContainText("48×32 → 24×16");
  await page.waitForFunction(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview");
    return !!i && i.naturalWidth === 24 && i.naturalHeight === 16;
  }, null, { timeout: 25000 });

  const dims = await outputDims(page);
  expect(dims).toEqual({ w: 24, h: 16 });
  await expect(page.locator(".verdict.ok")).toContainText("48×32 → 24×16");
});

test("rotate 90° swaps the output dimensions", async ({ page }) => {
  const buf = await makeImage(page, "image/png", 48, 32);
  await uploadAndClean(page, "in.png", "image/png", buf);
  await enterEdit(page);
  await page.locator("#rotateRight").click();
  await page.waitForFunction(() => {
    const i = document.querySelector<HTMLImageElement>("#outputPreview");
    return !!i && i.naturalWidth === 32 && i.naturalHeight === 48;
  }, null, { timeout: 25000 });

  const dims = await outputDims(page);
  expect(dims).toEqual({ w: 32, h: 48 });
});

test("oversized inputs are still rejected (guard in wasm)", async ({ page }) => {
  // 17000px exceeds the 16384px guard; build a tall 1px-wide PNG to stay light.
  const buf = await makeImage(page, "image/png", 17000, 1);
  await page.setInputFiles("#fileInput", {
    name: "tall.png",
    mimeType: "image/png",
    buffer: buf,
  });
  await expect(page.locator(".verdict.bad")).toBeVisible({ timeout: 25000 });
  await expect(page.locator("#downloadArea a")).toHaveCount(0);
});
