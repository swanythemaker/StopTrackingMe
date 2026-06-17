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

// The Ultra Paranoid checkbox is visually replaced by a switch (hidden input), so toggle it in the
// DOM and fire `change` rather than clicking the invisible element.
async function setUltra(page: Page, on: boolean) {
  await page.evaluate((want) => {
    const cb = document.querySelector<HTMLInputElement>("#ultraParanoid")!;
    if (cb.checked !== want) {
      cb.checked = want;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, on);
}

async function loadFile(page: Page, name: string, mime: string, buffer: Buffer) {
  await page.setInputFiles("#fileInput", { name, mimeType: mime, buffer });
  await expect(page.locator("#sanitizeBtn")).toBeEnabled({ timeout: 15000 });
}

async function sanitizeAndWait(page: Page) {
  await page.getByRole("button", { name: "Sanitize" }).click();
  await expect(page.locator("#downloadArea a")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".verdict.ok")).toBeVisible();
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

for (const { mime, ext } of [
  { mime: "image/png", ext: "png" },
  { mime: "image/jpeg", ext: "jpg" },
  { mime: "image/webp", ext: "webp" },
]) {
  test(`sanitize ${mime} produces a clean downloadable output`, async ({ page }) => {
    // Turn off Ultra Paranoid (which forces PNG) so each format round-trips itself.
    await setUltra(page, false);
    const buf = await makeImage(page, mime);
    await loadFile(page, `in.${ext}`, mime, buf);
    await sanitizeAndWait(page);

    const report = await page.locator("#outputReport").textContent();
    expect(report).toContain("status: PASS");
    const dims = await outputDims(page);
    expect(dims).toEqual({ w: 48, h: 32 });
  });
}

test("resize 50% halves the output dimensions", async ({ page }) => {
  const buf = await makeImage(page, "image/png");
  await loadFile(page, "in.png", "image/png", buf);
  await page.locator("#adjustGroup > summary").click(); // open Adjust
  await page.locator('#resizeChips button[data-pct="50"]').click();
  await expect(page.locator("#dimReadout")).toContainText("48×32 → 24×16");
  await sanitizeAndWait(page);

  const dims = await outputDims(page);
  expect(dims).toEqual({ w: 24, h: 16 });
  await expect(page.locator(".verdict.ok")).toContainText("48×32 → 24×16");
});

test("rotate 90° swaps the output dimensions", async ({ page }) => {
  const buf = await makeImage(page, "image/png", 48, 32);
  await loadFile(page, "in.png", "image/png", buf);
  await page.locator("#adjustGroup > summary").click();
  await page.locator("#rotateRight").click();
  await sanitizeAndWait(page);

  const dims = await outputDims(page);
  expect(dims).toEqual({ w: 32, h: 48 });
});

test("oversized inputs are still rejected (guard in wasm)", async ({ page }) => {
  // 17000px exceeds the 16384px guard; build a tall 1px-wide PNG to stay light.
  const buf = await makeImage(page, "image/png", 17000, 1);
  await loadFile(page, "tall.png", "image/png", buf);
  await page.getByRole("button", { name: "Sanitize" }).click();
  await expect(page.locator(".verdict.bad")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#downloadArea a")).toHaveCount(0);
});
