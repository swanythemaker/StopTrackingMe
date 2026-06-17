import "./style.css";
import {
  describeAudit,
  isSupportedImageType,
  type AuditSummary,
  type SupportedFormat,
} from "./sanitizer/formats";
import type {
  SanitizeStage,
  WorkerMessage,
  WorkerRequest,
} from "./sanitizer/types";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("App root not found");
}

const ICON = {
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5 4.5 5.5v5.4c0 4.5 3.1 8.7 7.5 10.1 4.4-1.4 7.5-5.6 7.5-10.1V5.5L12 2.5Z"/><path d="m9 12 2 2 4-4.5"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><path d="M12 16.5h.01"/><path d="M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.2" r="1.3"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 19h14"/></svg>`,
  rotateCw: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v4h-4"/></svg>`,
  rotateCcw: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/></svg>`,
  flipH: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16" stroke-dasharray="2 2.4"/><path d="M8 9 4.5 12 8 15"/><path d="m16 9 3.5 3-3.5 3"/></svg>`,
  flipV: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16" stroke-dasharray="2 2.4"/><path d="M9 8 12 4.5 15 8"/><path d="m9 16 3 3.5 3-3.5"/></svg>`,
};

app.innerHTML = `
  <div class="bg-grid" aria-hidden="true"></div>
  <main class="shell">
    <header class="hero">
      <p class="eyebrow">Browser-only image sanitizer</p>
      <div class="hero-lockup">
        <div class="hero-mark">${ICON.shield}</div>
        <h1>STOP<span>TRACKING</span>ME</h1>
      </div>
      <div class="hero-text">
        <p class="subtitle">
          Strip EXIF, GPS, XMP, C2PA and hidden metadata from your photos.
          Everything runs locally in your browser — your image is never uploaded.
        </p>
        <ul class="trust" role="list">
          <li>${ICON.check}<span>No uploads</span></li>
          <li>${ICON.check}<span>No analytics</span></li>
          <li>${ICON.check}<span>Fail-closed audit</span></li>
        </ul>
      </div>
    </header>

    <div class="workbench">
      <section class="panel card-upload" aria-label="Upload and options">
        <div class="dropzone" id="dropzone" role="button" tabindex="0"
             aria-label="Drop an image or press Enter to browse">
          <input id="fileInput" type="file" accept="image/png,image/jpeg,image/webp" hidden />
          <div class="dz-icon">${ICON.upload}</div>
          <strong class="dz-title">Drop an image here</strong>
          <span class="dz-sub">or <u>browse files</u></span>
          <span class="dz-formats">PNG · JPEG · WebP — up to 64&nbsp;MB</span>
        </div>

        <div class="filecard" id="fileCard" hidden>
          <img id="fileThumb" class="filecard-thumb" alt="" />
          <div class="filecard-meta">
            <strong id="fileName" class="filecard-name"></strong>
            <span id="fileFacts" class="filecard-facts"></span>
          </div>
          <button id="clearFile" class="icon-btn" type="button" aria-label="Remove image">${ICON.x}</button>
        </div>

        <div class="controls">
          <label class="switch-row">
            <input id="ultraParanoid" type="checkbox" checked />
            <span class="switch" aria-hidden="true"></span>
            <span class="switch-text">
              <strong>Ultra paranoid mode</strong>
              <small>Force PNG output · strict fail-closed checks</small>
            </span>
          </label>

          <div class="advanced" id="advanced">
            <label class="field">
              <span class="field-label">Output format</span>
              <select id="outputFormat">
                <option value="same">Same as input</option>
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Quality <b id="qualityValue">92</b></span>
              <input id="quality" type="range" min="60" max="100" value="92" />
            </label>
          </div>

          <details class="adjust" id="adjustGroup">
            <summary class="adjust-summary">
              <span class="adjust-title">Adjust <small>resize · rotate · flip</small></span>
              <span class="adjust-state" id="adjustState">Original</span>
            </summary>
            <div class="adjust-body">
              <div class="adjust-field">
                <span class="field-label">Resize</span>
                <div class="seg-row" id="resizeChips" role="group" aria-label="Resize">
                  <button type="button" class="seg is-active" data-pct="100">100%</button>
                  <button type="button" class="seg" data-pct="75">75%</button>
                  <button type="button" class="seg" data-pct="50">50%</button>
                  <button type="button" class="seg" data-pct="25">25%</button>
                  <button type="button" class="seg" id="resizeCustomToggle">Custom</button>
                </div>
                <div class="resize-custom" id="resizeCustom" hidden>
                  <input id="resizeSlider" type="range" min="10" max="100" value="100"
                         aria-label="Resize percentage" />
                  <b id="resizeSliderValue">100%</b>
                </div>
                <p class="dim-readout" id="dimReadout" hidden></p>
              </div>

              <div class="adjust-field">
                <span class="field-label">Rotate &amp; flip</span>
                <div class="seg-row" role="group" aria-label="Rotate and flip">
                  <button type="button" class="seg icon-seg" id="rotateLeft" title="Rotate left 90°" aria-label="Rotate left">${ICON.rotateCcw}</button>
                  <button type="button" class="seg icon-seg" id="rotateRight" title="Rotate right 90°" aria-label="Rotate right">${ICON.rotateCw}</button>
                  <button type="button" class="seg icon-seg" id="flipH" title="Flip horizontal" aria-label="Flip horizontal">${ICON.flipH}</button>
                  <button type="button" class="seg icon-seg" id="flipV" title="Flip vertical" aria-label="Flip vertical">${ICON.flipV}</button>
                </div>
                <p class="adjust-note">Applied to the clean output, before re-encode. Resampling also disrupts pixel-hidden traces — it reduces, not removes.</p>
              </div>
            </div>
          </details>
        </div>

        <button id="sanitizeBtn" class="primary" type="button" disabled>
          <span class="btn-spinner" aria-hidden="true"></span>
          <span class="btn-label">Sanitize image</span>
        </button>

        <div class="progress" id="progress" hidden aria-hidden="true">
          <div class="progress-track"><div class="progress-fill" id="progressFill"></div></div>
          <p class="progress-stage" id="progressStage">Working…</p>
        </div>

        <p id="status" class="status" role="status" aria-live="polite">Select an image to begin.</p>
      </section>

      <section class="panel card-results" aria-label="Results">
        <div class="results-empty" id="resultsEmpty">
          <div class="empty-mark">${ICON.lock}</div>
          <p class="empty-title">Nothing loaded yet</p>
          <p class="empty-sub">Drop an image to preview it, scan its metadata, and get a verified-clean copy back.</p>
        </div>

        <div class="results" id="results" hidden>
          <div class="verdict" id="verdict" hidden></div>

          <div class="preview-grid">
            <figure class="preview">
              <figcaption>Original <span class="size-tag" id="origSize"></span></figcaption>
              <div class="preview-frame"><img id="inputPreview" alt="Original image preview" /></div>
            </figure>
            <figure class="preview">
              <figcaption>Sanitized <span class="size-tag" id="outSize"></span></figcaption>
              <div class="preview-frame" id="outFrame">
                <img id="outputPreview" alt="Sanitized image preview" />
                <div class="frame-pending" id="framePending">Awaiting sanitize</div>
              </div>
            </figure>
          </div>

          <div id="downloadArea"></div>

          <div class="scan-grid">
            <div class="scan-card" id="inputScanCard"></div>
            <div class="scan-card" id="outputScanCard"></div>
          </div>

          <details class="raw">
            <summary>Raw audit output</summary>
            <div class="raw-cols">
              <div><h4>Input scan</h4><pre id="inputReport">No file loaded.</pre></div>
              <div><h4>Output scan</h4><pre id="outputReport">No output yet.</pre></div>
            </div>
          </details>
        </div>
      </section>
    </div>

    <section class="panel docs">
      <div class="docs-grid">
        <article>
          <h2>How it works</h2>
          <ol class="how-list">
            <li>Drop or pick a PNG, JPEG or WebP image.</li>
            <li>We decode it to raw pixels and re-encode a fresh file — no original bytes survive.</li>
            <li>Format-specific stripping removes every non-essential chunk/marker.</li>
            <li>A strict audit re-scans the output. If anything looks off, download is blocked.</li>
            <li>Download your verified-clean image.</li>
          </ol>
        </article>
        <article>
          <h2>What gets removed</h2>
          <ul class="wiki-list">
            <li><b>EXIF</b> — camera, timestamp, and GPS location.</li>
            <li><b>XMP / IPTC</b> — editor &amp; press metadata blocks.</li>
            <li><b>C2PA</b> — provenance &amp; content-credential signatures.</li>
            <li><b>JPEG APP/COM</b> — app marker segments.</li>
            <li><b>PNG text chunks</b> — tEXt, zTXt, iTXt and vendor chunks.</li>
            <li><b>WebP EXIF/XMP/ICCP</b> — metadata chunks.</li>
          </ul>
        </article>
      </div>

      <div class="faq">
        <h2>Questions</h2>
        <details>
          <summary>Why does the input scan say FAIL?</summary>
          <p>That just means metadata or non-essential chunks were detected in your original file — exactly the stuff this tool removes. Only the <b>output</b> scan decides whether the download is allowed.</p>
        </details>
        <details>
          <summary>Does this upload my image anywhere?</summary>
          <p>No. All processing happens in your browser in a Web Worker. The production build ships a Content-Security-Policy that blocks every outbound connection.</p>
        </details>
        <details>
          <summary>Does it remove everything?</summary>
          <p>It removes known metadata and provenance structures. It cannot guarantee removal of steganography hidden inside the pixels themselves.</p>
        </details>
        <details>
          <summary>Why force PNG in Ultra Paranoid mode?</summary>
          <p>PNG is a simpler container with fewer metadata edge-cases, so the fail-closed checks can be stricter and more certain.</p>
        </details>
      </div>

      <div class="roadmap">
        <p class="roadmap-eyebrow">Where this is going</p>
        <h2>Erase every trace — not just the ones we can name yet</h2>
        <p class="roadmap-lead">
          Today it removes the hidden data we already know how to find. But the traces worth fearing
          are the ones built to survive a clean-up. The plan is to keep going — deeper into your
          images, then out to everything else that quietly follows you around — without ever breaking
          the one rule: <b>nothing leaves your device</b>.
        </p>

        <div class="roadmap-groups">
          <section class="roadmap-group">
            <h3>Go deeper on every image</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>See the picture, not just the data.</strong>
                Spot faces, license plates, a reflection in a window, a landmark, or a name on a
                screen — and offer to blur them before you share.
              </li>
              <li>
                <strong>Break what hides in the pixels.</strong>
                A heavy-clean mode that disrupts invisible watermarks, hidden messages and tracking
                fingerprints, with a risk score so you know how exposed a photo really is.
              </li>
              <li>
                <strong>Check the work twice.</strong>
                Rebuild the image through more than one engine and compare, so a single buggy
                converter can never let something slip through.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>A private mind, in your tab</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Reads your file like a paranoid expert.</strong>
                A small model that runs entirely on your device — no upload, no server — asking one
                question: could anything in here point back to you?
              </li>
              <li>
                <strong>Explains itself in plain words.</strong>
                “Removed this, because it could reveal that.” Every decision spelled out, worked out
                locally, never phoning home.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>Beyond photos</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Clean the links you share.</strong>
                Strip the tracking tails off a URL and expand shortened redirects that sneak them
                back in.
              </li>
              <li>
                <strong>Show what's watching.</strong>
                A read-out of what a page can use to fingerprint you, and the third-party calls it
                makes behind your back.
              </li>
              <li>
                <strong>Reset what follows you.</strong>
                One click to wipe the cookies and stored IDs that quietly track you between visits.
              </li>
            </ul>
          </section>

          <section class="roadmap-group">
            <h3>Trust you can verify</h3>
            <ul class="roadmap-list" role="list">
              <li>
                <strong>Open and reproducible.</strong>
                Signed releases you can rebuild yourself, so the app you run is provably the one we
                published.
              </li>
              <li>
                <strong>A receipt for every clean-up.</strong>
                A local report — what went in, what came out, what was removed — that stays on your
                machine.
              </li>
            </ul>
          </section>
        </div>

        <blockquote class="roadmap-quote">
          We're not done at “we removed the location tag.” The goal is simple — <b>nothing you share
          can be traced back to you</b>, not the obvious traces, and not the hidden ones.
        </blockquote>
      </div>
    </section>

    <footer class="foot">
      <span>${ICON.lock}</span>
      <p>100% local. No servers, no accounts, no tracking. Your pixels never leave this tab.</p>
      <span class="foot-version" title="build ${__APP_COMMIT__}">v${__APP_VERSION__}</span>
    </footer>
  </main>

  <div class="drag-overlay" id="dragOverlay" aria-hidden="true">
    <div class="drag-overlay-card">
      <div class="drag-overlay-icon">${ICON.upload}</div>
      <strong>Drop to sanitize</strong>
    </div>
  </div>
`;

const worker = new Worker(new URL("./sanitizer/worker.ts", import.meta.url), {
  type: "module",
});

const fileInput = must<HTMLInputElement>("#fileInput");
const outputFormat = must<HTMLSelectElement>("#outputFormat");
const quality = must<HTMLInputElement>("#quality");
const qualityValue = must<HTMLElement>("#qualityValue");
const ultraParanoid = must<HTMLInputElement>("#ultraParanoid");
const advanced = must<HTMLElement>("#advanced");
const sanitizeBtn = must<HTMLButtonElement>("#sanitizeBtn");
const inputReport = must<HTMLElement>("#inputReport");
const outputReport = must<HTMLElement>("#outputReport");
const status = must<HTMLElement>("#status");
const downloadArea = must<HTMLElement>("#downloadArea");
const dropzone = must<HTMLElement>("#dropzone");
const inputPreview = must<HTMLImageElement>("#inputPreview");
const outputPreview = must<HTMLImageElement>("#outputPreview");
const fileCard = must<HTMLElement>("#fileCard");
const fileThumb = must<HTMLImageElement>("#fileThumb");
const fileName = must<HTMLElement>("#fileName");
const fileFacts = must<HTMLElement>("#fileFacts");
const clearFile = must<HTMLButtonElement>("#clearFile");
const resultsEmpty = must<HTMLElement>("#resultsEmpty");
const results = must<HTMLElement>("#results");
const verdict = must<HTMLElement>("#verdict");
const origSize = must<HTMLElement>("#origSize");
const outSize = must<HTMLElement>("#outSize");
const outFrame = must<HTMLElement>("#outFrame");
const framePending = must<HTMLElement>("#framePending");
const inputScanCard = must<HTMLElement>("#inputScanCard");
const outputScanCard = must<HTMLElement>("#outputScanCard");
const progress = must<HTMLElement>("#progress");
const progressFill = must<HTMLElement>("#progressFill");
const progressStage = must<HTMLElement>("#progressStage");
const dragOverlay = must<HTMLElement>("#dragOverlay");
const adjustState = must<HTMLElement>("#adjustState");
const resizeChips = must<HTMLElement>("#resizeChips");
const resizeCustomToggle = must<HTMLButtonElement>("#resizeCustomToggle");
const resizeCustom = must<HTMLElement>("#resizeCustom");
const resizeSlider = must<HTMLInputElement>("#resizeSlider");
const resizeSliderValue = must<HTMLElement>("#resizeSliderValue");
const dimReadout = must<HTMLElement>("#dimReadout");
const rotateLeft = must<HTMLButtonElement>("#rotateLeft");
const rotateRight = must<HTMLButtonElement>("#rotateRight");
const flipHBtn = must<HTMLButtonElement>("#flipH");
const flipVBtn = must<HTMLButtonElement>("#flipV");

const STAGE_TEXT: Record<SanitizeStage, string> = {
  read: "Reading image…",
  decode: "Decoding pixels…",
  encode: "Re-encoding a clean copy…",
  strip: "Stripping metadata…",
  audit: "Auditing output…",
};

let selectedFile: File | null = null;
let pendingRequestId = 0;
let auditRequestId = 0;
let busy = false;
let downloadUrl: string | null = null;
let inputPreviewUrl: string | null = null;
let outputPreviewUrl: string | null = null;
let dragDepth = 0;

// Adjust (edit tools) state — defaults are identity, so the one-drop-clean path is unchanged.
let resizePct = 100;
let customResize = false;
let rotateDeg = 0;
let flipHState = false;
let flipVState = false;
let loadedDims: { w: number; h: number } | null = null;

syncUltraParanoidUi();
ultraParanoid.addEventListener("change", syncUltraParanoidUi);
quality.addEventListener("input", () => {
  qualityValue.textContent = quality.value;
});

// --- Adjust controls (resize / rotate / flip) ---
const resizeSegs = Array.from(
  resizeChips.querySelectorAll<HTMLButtonElement>("button[data-pct]"),
);

for (const seg of resizeSegs) {
  seg.addEventListener("click", () => {
    customResize = false;
    resizeCustom.hidden = true;
    setResizePct(Number(seg.dataset.pct));
  });
}
resizeCustomToggle.addEventListener("click", () => {
  customResize = true;
  resizeCustom.hidden = false;
  setResizePct(Number(resizeSlider.value), true);
});
resizeSlider.addEventListener("input", () => {
  customResize = true;
  setResizePct(Number(resizeSlider.value), true);
});
rotateLeft.addEventListener("click", () => {
  rotateDeg = (rotateDeg + 270) % 360;
  syncRotateFlipUi();
  updateAdjust();
});
rotateRight.addEventListener("click", () => {
  rotateDeg = (rotateDeg + 90) % 360;
  syncRotateFlipUi();
  updateAdjust();
});
flipHBtn.addEventListener("click", () => {
  flipHState = !flipHState;
  syncRotateFlipUi();
  updateAdjust();
});
flipVBtn.addEventListener("click", () => {
  flipVState = !flipVState;
  syncRotateFlipUi();
  updateAdjust();
});

function setResizePct(pct: number, fromSlider = false): void {
  resizePct = Math.min(100, Math.max(10, Math.round(pct || 100)));
  for (const seg of resizeSegs) {
    seg.classList.toggle(
      "is-active",
      !customResize && Number(seg.dataset.pct) === resizePct,
    );
  }
  resizeCustomToggle.classList.toggle("is-active", customResize);
  if (!fromSlider) {
    resizeSlider.value = String(resizePct);
  }
  resizeSliderValue.textContent = `${resizePct}%`;
  updateAdjust();
}

function syncRotateFlipUi(): void {
  rotateLeft.classList.toggle("is-active", rotateDeg !== 0);
  rotateRight.classList.toggle("is-active", rotateDeg !== 0);
  flipHBtn.classList.toggle("is-active", flipHState);
  flipVBtn.classList.toggle("is-active", flipVState);
}

function isIdentityAdjust(): boolean {
  return resizePct === 100 && rotateDeg === 0 && !flipHState && !flipVState;
}

function updateAdjust(): void {
  const parts: string[] = [];
  if (resizePct !== 100) parts.push(`${resizePct}%`);
  if (rotateDeg !== 0) parts.push(`↻${rotateDeg}°`);
  if (flipHState) parts.push("↔");
  if (flipVState) parts.push("↕");
  adjustState.textContent = parts.length ? parts.join(" · ") : "Original";
  adjustState.classList.toggle("is-on", parts.length > 0);
  updateDimReadout();
}

function outputDims(): { w: number; h: number } | null {
  if (!loadedDims) return null;
  let w = loadedDims.w;
  let h = loadedDims.h;
  if (rotateDeg === 90 || rotateDeg === 270) [w, h] = [h, w];
  w = Math.max(1, Math.round((w * resizePct) / 100));
  h = Math.max(1, Math.round((h * resizePct) / 100));
  return { w, h };
}

function updateDimReadout(): void {
  const out = outputDims();
  if (!loadedDims || !out || isIdentityAdjust()) {
    dimReadout.hidden = true;
    dimReadout.textContent = "";
    return;
  }
  dimReadout.hidden = false;
  dimReadout.textContent = `${loadedDims.w}×${loadedDims.h} → ${out.w}×${out.h}`;
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0] ?? null;
  await handleFileSelection(file);
});

clearFile.addEventListener("click", async () => {
  fileInput.value = "";
  await handleFileSelection(null);
});

// Full-window drag & drop overlay.
window.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dragOverlay.classList.add("active");
});
window.addEventListener("dragover", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
});
window.addEventListener("dragleave", (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragOverlay.classList.remove("active");
});
window.addEventListener("drop", async (event) => {
  if (!event.dataTransfer) return;
  event.preventDefault();
  dragDepth = 0;
  dragOverlay.classList.remove("active");
  const file = event.dataTransfer.files?.[0] ?? null;
  if (file) await handleFileSelection(file);
});

sanitizeBtn.addEventListener("click", async () => {
  if (!selectedFile || busy) {
    return;
  }

  clearDownload();
  setBusy(true);
  setStage("read", 2);
  outFrame.classList.add("loading");
  framePending.hidden = true;
  verdict.hidden = true;
  outputReport.textContent = "Working…";
  outputScanCard.innerHTML = "";
  setOutputPreview(null);
  setStatus("Sanitizing in a local worker…", "muted");

  const inputBuffer = await selectedFile.arrayBuffer();
  const requestId = ++pendingRequestId;
  const request: WorkerRequest = {
    kind: "sanitize",
    requestId,
    sourceName: selectedFile.name,
    sourceType: selectedFile.type,
    inputBuffer,
    outputType:
      outputFormat.value === "same"
        ? "same"
        : (outputFormat.value as SupportedFormat),
    quality: Number(quality.value) / 100,
    ultraParanoid: ultraParanoid.checked,
    resizePct,
    rotate: rotateDeg,
    flipH: flipHState,
    flipV: flipVState,
  };

  worker.postMessage(request, [inputBuffer]);
});

worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const payload = event.data;

  if (payload.type === "audit-done") {
    if (payload.requestId !== auditRequestId) return;
    inputReport.textContent = describeAudit(payload.audit);
    renderScanCard(inputScanCard, payload.audit, "Input scan");
    if (payload.audit.passed) {
      setStatus("Looks clean already — sanitize to get a freshly re-encoded copy.", "good");
    } else {
      setStatus("Metadata detected. Ready to sanitize.", "muted");
    }
    return;
  }

  if (payload.requestId !== pendingRequestId) {
    return;
  }

  if (payload.type === "progress") {
    setStage(payload.stage, payload.pct);
    return;
  }

  setBusy(false);
  outFrame.classList.remove("loading");

  if (!payload.ok) {
    const info = explainError(payload.error);
    framePending.hidden = false;
    framePending.textContent = "Blocked";
    outputReport.textContent = payload.error;
    renderVerdict(false, info.detail, undefined, info.title);
    renderScanCard(outputScanCard, null, "Output scan", payload.error);
    setStatus(info.status, "bad");
    return;
  }

  setProgress(100);
  outputReport.textContent = describeAudit(payload.outputAudit);
  renderScanCard(outputScanCard, payload.outputAudit, "Output scan");

  const outBytes = payload.outputBuffer.byteLength;
  const blob = new Blob([payload.outputBuffer], { type: payload.outputType });
  const safeName = `sanitized_${Date.now()}${extForMime(payload.outputType)}`;
  const url = URL.createObjectURL(blob);
  downloadUrl = url;
  setOutputPreview(url);
  outSize.textContent = formatBytes(outBytes);

  renderDownload(url, safeName, outBytes);
  renderVerdict(true, "", {
    inBytes: payload.inputByteLength,
    outBytes,
    width: payload.width,
    height: payload.height,
    origWidth: payload.origWidth,
    origHeight: payload.origHeight,
  });
  setStatus("Done. Output passed the strict fail-closed audit.", "good");

  // hide the progress bar shortly after completion
  window.setTimeout(() => {
    if (!busy) {
      progress.hidden = true;
      progress.setAttribute("aria-hidden", "true");
    }
  }, 600);
});

async function handleFileSelection(file: File | null): Promise<void> {
  clearDownload();
  selectedFile = null;
  sanitizeBtn.disabled = true;
  outputReport.textContent = "No output yet.";
  outputScanCard.innerHTML = "";
  outSize.textContent = "";
  verdict.hidden = true;
  setOutputPreview(null);
  framePending.hidden = false;
  framePending.textContent = "Awaiting sanitize";
  outFrame.classList.remove("loading");
  progress.hidden = true;

  if (!file) {
    inputReport.textContent = "No file loaded.";
    inputScanCard.innerHTML = "";
    setStatus("Select an image to begin.", "muted");
    setInputPreview(null);
    fileCard.hidden = true;
    results.hidden = true;
    resultsEmpty.hidden = false;
    loadedDims = null;
    updateDimReadout();
    return;
  }

  if (!isSupportedImageType(file.type)) {
    inputReport.textContent = `Unsupported type: ${file.type || "unknown"}`;
    inputScanCard.innerHTML = "";
    setStatus(`Unsupported file type${file.type ? ` (${file.type})` : ""}. Use PNG, JPEG or WebP.`, "bad");
    setInputPreview(null);
    fileCard.hidden = true;
    results.hidden = true;
    resultsEmpty.hidden = false;
    return;
  }

  const inputBytes = await file.arrayBuffer();
  const previewUrl = URL.createObjectURL(new Blob([inputBytes], { type: file.type }));

  selectedFile = file;
  sanitizeBtn.disabled = false;

  resultsEmpty.hidden = true;
  results.hidden = false;

  setInputPreview(previewUrl);
  fileThumb.src = previewUrl;
  fileName.textContent = file.name;
  origSize.textContent = formatBytes(inputBytes.byteLength);
  fileCard.hidden = false;

  // dimensions for the file facts line + the resize readout
  loadedDims = null;
  loadDimensions(previewUrl).then((dim) => {
    const facts = [
      shortType(file.type),
      dim ? `${dim.w}×${dim.h}` : null,
      formatBytes(file.size),
    ].filter(Boolean);
    fileFacts.textContent = facts.join("  ·  ");
    loadedDims = dim;
    updateDimReadout();
  });

  // Input scan runs through the same wasm audit the output gate uses.
  inputReport.textContent = "Scanning…";
  inputScanCard.innerHTML = "";
  setStatus("Scanning metadata…", "muted");
  const auditId = ++auditRequestId;
  worker.postMessage({
    kind: "audit",
    requestId: auditId,
    sourceType: file.type,
    inputBuffer: inputBytes,
  });
}

function renderVerdict(
  ok: boolean,
  error: string,
  stats?: {
    inBytes: number;
    outBytes: number;
    width: number;
    height: number;
    origWidth: number;
    origHeight: number;
  },
  titleOverride?: string,
): void {
  verdict.hidden = false;
  verdict.className = `verdict ${ok ? "ok" : "bad"}`;
  verdict.innerHTML = "";

  const icon = document.createElement("div");
  icon.className = "verdict-icon";
  icon.innerHTML = ok ? ICON.check : ICON.alert;

  const body = document.createElement("div");
  body.className = "verdict-body";

  const title = document.createElement("strong");
  title.textContent = ok ? "Clean — safe to download" : titleOverride || "Export blocked";
  body.appendChild(title);

  const sub = document.createElement("p");
  if (ok && stats) {
    const delta = stats.inBytes > 0
      ? Math.round(((stats.outBytes - stats.inBytes) / stats.inBytes) * 100)
      : 0;
    const sign = delta > 0 ? "+" : "";
    const resized =
      stats.origWidth !== stats.width || stats.origHeight !== stats.height;
    const dims = resized
      ? `${stats.origWidth}×${stats.origHeight} → ${stats.width}×${stats.height}`
      : `${stats.width}×${stats.height}`;
    sub.textContent =
      `Metadata removed and output re-verified. ${dims} · ` +
      `${formatBytes(stats.inBytes)} → ${formatBytes(stats.outBytes)} (${sign}${delta}%).`;
  } else {
    sub.textContent = error || "The output did not pass the strict audit, so download was blocked.";
  }
  body.appendChild(sub);

  verdict.appendChild(icon);
  verdict.appendChild(body);
}

function renderDownload(url: string, name: string, bytes: number): void {
  downloadArea.innerHTML = "";
  const a = document.createElement("a");
  a.className = "download-btn";
  a.href = url;
  a.download = name;
  a.innerHTML = `${ICON.download}<span class="dl-text">Download clean image<small>${name} · ${formatBytes(bytes)}</small></span>`;
  downloadArea.appendChild(a);
}

function renderScanCard(
  container: HTMLElement,
  summary: AuditSummary | null,
  label: string,
  errorText?: string,
): void {
  container.innerHTML = "";
  container.classList.remove("pass", "fail");

  const head = document.createElement("div");
  head.className = "scan-head";
  const title = document.createElement("h3");
  title.textContent = label;
  head.appendChild(title);

  const passed = summary ? summary.passed : false;
  container.classList.add(passed ? "pass" : "fail");

  const pill = document.createElement("span");
  pill.className = `pill ${passed ? "pill-pass" : "pill-fail"}`;
  pill.innerHTML = `${passed ? ICON.check : ICON.alert}<span>${passed ? "PASS" : "FAIL"}</span>`;
  head.appendChild(pill);
  container.appendChild(head);

  if (!summary) {
    const p = document.createElement("p");
    p.className = "scan-note";
    p.textContent = errorText || "No data.";
    container.appendChild(p);
    return;
  }

  const meta = document.createElement("p");
  meta.className = "scan-meta";
  meta.textContent = `${summary.kind.toUpperCase()} · ${formatBytes(summary.byteLength)}`;
  container.appendChild(meta);

  const uniqueMarkers = [...new Set(summary.markers)];
  if (uniqueMarkers.length) {
    const chips = document.createElement("div");
    chips.className = "chips";
    for (const marker of uniqueMarkers) {
      const flagged = summary.issues.some((issue) => issue.includes(marker));
      const chip = document.createElement("span");
      chip.className = `chip${flagged ? " chip-flag" : ""}`;
      chip.textContent = marker.trim() || marker;
      chips.appendChild(chip);
    }
    container.appendChild(chips);
  }

  if (summary.issues.length) {
    const list = document.createElement("ul");
    list.className = "issues";
    for (const issue of summary.issues) {
      const li = document.createElement("li");
      li.textContent = issue;
      list.appendChild(li);
    }
    container.appendChild(list);
  } else {
    const ok = document.createElement("p");
    ok.className = "scan-ok";
    ok.textContent = "No metadata or structural issues found.";
    container.appendChild(ok);
  }
}

function setBusy(value: boolean): void {
  busy = value;
  sanitizeBtn.disabled = value || !selectedFile;
  sanitizeBtn.classList.toggle("loading", value);
  if (value) {
    progress.hidden = false;
    progress.setAttribute("aria-hidden", "false");
  }
}

function setStage(stage: SanitizeStage, pct: number): void {
  progressStage.textContent = STAGE_TEXT[stage];
  setProgress(pct);
}

function setProgress(pct: number): void {
  progressFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function setStatus(message: string, tone: "good" | "bad" | "muted"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function clearDownload(): void {
  if (downloadUrl) {
    URL.revokeObjectURL(downloadUrl);
    downloadUrl = null;
  }
  downloadArea.innerHTML = "";
}

function setInputPreview(url: string | null): void {
  if (inputPreviewUrl) {
    URL.revokeObjectURL(inputPreviewUrl);
    inputPreviewUrl = null;
  }
  inputPreview.src = url ?? "";
  fileThumb.src = url ?? "";
  if (url) {
    inputPreviewUrl = url;
  }
}

function setOutputPreview(url: string | null): void {
  if (outputPreviewUrl && outputPreviewUrl !== url) {
    URL.revokeObjectURL(outputPreviewUrl);
    outputPreviewUrl = null;
  }
  outputPreview.src = url ?? "";
  if (url) {
    outputPreviewUrl = url;
  }
}

function loadDimensions(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function explainError(raw: string): { status: string; title: string; detail: string } {
  const e = (raw || "").trim() || "Unknown error.";
  if (/(over the|exceed|too large|MP limit)/i.test(e)) {
    return {
      title: "Image too large",
      status: `Blocked — ${e}`,
      detail: `${e} Try a smaller image, or resize it before sanitizing.`,
    };
  }
  if (/(could not be decoded|unsupported|disguised|corrupt|not a (png|jpeg|webp))/i.test(e)) {
    return {
      title: "Couldn't read this image",
      status: `Blocked — ${e}`,
      detail: e,
    };
  }
  if (/audit/i.test(e)) {
    return {
      title: "Export blocked by audit",
      status: "Blocked — output failed the strict safety audit.",
      detail: `${e} The cleaned file was not provably safe, so download was refused (fail-closed).`,
    };
  }
  return { title: "Couldn't process this image", status: `Blocked — ${e}`, detail: e };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function shortType(mime: string): string {
  if (mime === "image/png") return "PNG";
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/webp") return "WebP";
  return mime || "image";
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function extForMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

function must<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing required node: ${selector}`);
  }
  return node;
}

function syncUltraParanoidUi(): void {
  const active = ultraParanoid.checked;
  outputFormat.disabled = active;
  quality.disabled = active;
  advanced.classList.toggle("disabled", active);
  if (active) {
    outputFormat.value = "image/png";
  }
}
