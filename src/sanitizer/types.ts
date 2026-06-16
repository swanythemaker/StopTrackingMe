import type { AuditSummary, SupportedFormat } from "./audit";

export type WorkerRequest = {
  requestId: number;
  sourceName: string;
  sourceType: string;
  inputBuffer: ArrayBuffer;
  outputType: SupportedFormat | "same";
  quality: number;
  ultraParanoid: boolean;
};

export type SanitizeStage =
  | "read"
  | "decode"
  | "encode"
  | "strip"
  | "audit";

export type WorkerProgress = {
  type: "progress";
  requestId: number;
  stage: SanitizeStage;
  pct: number;
};

export type WorkerSuccess = {
  type: "done";
  ok: true;
  requestId: number;
  outputType: SupportedFormat;
  outputAudit: AuditSummary;
  outputBuffer: ArrayBuffer;
  inputByteLength: number;
  width: number;
  height: number;
};

export type WorkerFailure = {
  type: "done";
  ok: false;
  requestId: number;
  error: string;
};

export type WorkerResponse = WorkerSuccess | WorkerFailure;
export type WorkerMessage = WorkerProgress | WorkerResponse;
