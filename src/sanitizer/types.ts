import type { AuditSummary, SupportedFormat } from "./formats";

export type SanitizeRequest = {
  kind: "sanitize";
  requestId: number;
  sourceName: string;
  sourceType: string;
  inputBuffer: ArrayBuffer;
  outputType: SupportedFormat | "same";
  quality: number;
  ultraParanoid: boolean;
  // Edit tools (defaults are identity: 100% / no rotation / no flip).
  resizePct: number; // 10..100
  rotate: number; // 0 | 90 | 180 | 270 (clockwise)
  flipH: boolean;
  flipV: boolean;
};

// Informational input scan, auditing the original via the same wasm audit the output uses.
export type AuditRequest = {
  kind: "audit";
  requestId: number;
  sourceType: string;
  inputBuffer: ArrayBuffer;
};

// Pre-instantiate the wasm module at idle so the first real job skips cold-start.
export type WarmRequest = {
  kind: "warm";
  requestId: number;
};

export type WorkerRequest = SanitizeRequest | AuditRequest | WarmRequest;

export type SanitizeStage = "read" | "decode" | "encode" | "strip" | "audit";

export type WorkerProgress = {
  type: "progress";
  requestId: number;
  stage: SanitizeStage;
  pct: number;
};

// Wall-clock split of the worker pipeline (decode+transform / encode / strip+audit). Additive;
// purely diagnostic, consumed by scripts/bench.mjs. All values in milliseconds.
export type SanitizeTiming = {
  decodeMs: number;
  encodeMs: number;
  stripMs: number;
  totalMs: number;
};

export type WorkerSuccess = {
  type: "done";
  ok: true;
  requestId: number;
  outputType: SupportedFormat;
  outputAudit: AuditSummary;
  outputBuffer: ArrayBuffer;
  inputByteLength: number;
  width: number; // output width (after transforms)
  height: number; // output height (after transforms)
  origWidth: number; // decoded upright width, before user transforms
  origHeight: number;
  timing: SanitizeTiming;
};

export type WorkerFailure = {
  type: "done";
  ok: false;
  requestId: number;
  error: string;
};

export type AuditDone = {
  type: "audit-done";
  requestId: number;
  audit: AuditSummary;
};

export type WarmDone = {
  type: "warm-done";
  requestId: number;
};

export type WorkerResponse = WorkerSuccess | WorkerFailure | AuditDone | WarmDone;
export type WorkerMessage = WorkerProgress | WorkerResponse;
