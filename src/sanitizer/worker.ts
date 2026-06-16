/// <reference lib="webworker" />

import { auditBytes, isSupportedImageType, type SupportedFormat } from "./audit";
import {
  stripJpegAppMarkers,
  stripPngToAllowlist,
  stripWebpToAllowlist,
} from "./normalize";
import type {
  SanitizeStage,
  WorkerProgress,
  WorkerRequest,
  WorkerResponse,
} from "./types";
import { encode as encodeJpeg } from "@jsquash/jpeg";
import { encode as encodePng } from "@jsquash/png";
import { encode as encodeWebp } from "@jsquash/webp";

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const MAX_WIDTH = 16384;
const MAX_HEIGHT = 16384;
const MAX_PIXELS = 100_000_000;

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  try {
    const result = await sanitize(payload);
    self.postMessage(result, [result.outputBuffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: "done",
      ok: false,
      requestId: payload.requestId,
      error: error instanceof Error ? error.message : "Unknown worker error",
    };
    self.postMessage(response);
  }
});

function report(requestId: number, stage: SanitizeStage, pct: number): void {
  const progress: WorkerProgress = { type: "progress", requestId, stage, pct };
  self.postMessage(progress);
}

async function sanitize(request: WorkerRequest): Promise<Extract<WorkerResponse, { ok: true }>> {
  report(request.requestId, "read", 5);
  if (!isSupportedImageType(request.sourceType)) {
    throw new Error(`Unsupported input type "${request.sourceType || "unknown"}". Use PNG, JPEG or WebP.`);
  }
  if (request.inputBuffer.byteLength > MAX_INPUT_BYTES) {
    throw new Error(
      `File is ${mb(request.inputBuffer.byteLength)} — over the ${mb(MAX_INPUT_BYTES)} limit.`,
    );
  }
  const inputByteLength = request.inputBuffer.byteLength;

  const outputType =
    request.ultraParanoid
      ? "image/png"
      : request.outputType === "same"
        ? request.sourceType
        : request.outputType;
  if (!isSupportedImageType(outputType)) {
    throw new Error(`Unsupported output type: ${outputType}`);
  }

  report(request.requestId, "decode", 25);
  const sourceBlob = new Blob([request.inputBuffer], { type: request.sourceType });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(sourceBlob);
  } catch {
    throw new Error("This file could not be decoded as an image. It may be corrupt or a disguised/unsupported format.");
  }
  if (bitmap.width > MAX_WIDTH || bitmap.height > MAX_HEIGHT) {
    const w = bitmap.width;
    const h = bitmap.height;
    bitmap.close();
    throw new Error(`Image is ${w}×${h}px — over the ${MAX_WIDTH}×${MAX_HEIGHT}px limit.`);
  }
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    const mp = (bitmap.width * bitmap.height) / 1_000_000;
    bitmap.close();
    throw new Error(`Image is ${mp.toFixed(1)} MP — over the ${(MAX_PIXELS / 1_000_000).toFixed(0)} MP limit.`);
  }
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Failed to initialize worker canvas");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  report(request.requestId, "encode", 55);
  let outputBuffer = await encodeWithWasm(
    outputType,
    imageData,
    clampQuality(outputType, request.quality),
  );

  report(request.requestId, "strip", 80);
  if (outputType === "image/jpeg") {
    outputBuffer = toArrayBuffer(stripJpegAppMarkers(new Uint8Array(outputBuffer)));
  } else if (outputType === "image/png") {
    outputBuffer = toArrayBuffer(stripPngToAllowlist(new Uint8Array(outputBuffer)));
  } else if (outputType === "image/webp") {
    outputBuffer = toArrayBuffer(stripWebpToAllowlist(new Uint8Array(outputBuffer)));
  }

  report(request.requestId, "audit", 95);
  const outputAudit = auditBytes(outputType, outputBuffer);
  if (!outputAudit.passed) {
    throw new Error(
      `Fail-closed audit rejection: ${outputAudit.issues.join("; ") || "unknown issue"}`,
    );
  }

  return {
    type: "done",
    ok: true,
    requestId: request.requestId,
    outputType: outputType as SupportedFormat,
    outputAudit,
    outputBuffer,
    inputByteLength,
    width,
    height,
  };
}

function clampQuality(type: string, quality: number): number | undefined {
  if (type !== "image/jpeg" && type !== "image/webp") {
    return undefined;
  }
  return Math.min(1, Math.max(0.6, quality));
}

async function encodeWithWasm(
  outputType: SupportedFormat,
  imageData: ImageData,
  quality?: number,
): Promise<ArrayBuffer> {
  if (outputType === "image/png") {
    return encodePng(imageData);
  }
  if (outputType === "image/jpeg") {
    return encodeJpeg(imageData, {
      quality: Math.round((quality ?? 0.92) * 100),
    });
  }
  return encodeWebp(imageData, {
    quality: Math.round((quality ?? 0.92) * 100),
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
