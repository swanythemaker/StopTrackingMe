export const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type SupportedFormat = (typeof SUPPORTED_TYPES)[number];

export type AuditSummary = {
  kind: "png" | "jpeg" | "webp" | "unknown";
  issues: string[];
  markers: string[];
  byteLength: number;
  passed: boolean;
};

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const PNG_ALLOWED = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
const PNG_DENY = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "iCCP", "sPLT"]);

const JPEG_DENY = new Set(
  Array.from({ length: 16 }, (_, i) => `APP${i}`).concat(["COM"]),
);

const WEBP_ALLOW = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);
const WEBP_DENY = new Set(["EXIF", "XMP ", "ICCP", "ANIM", "ANMF"]);

export function isSupportedImageType(type: string): type is SupportedFormat {
  return SUPPORTED_TYPES.includes(type as SupportedFormat);
}

export function auditBytes(type: string, bytes: ArrayBuffer): AuditSummary {
  const view = new Uint8Array(bytes);
  if (type === "image/png" || hasPngSignature(view)) {
    return auditPng(view);
  }
  if (type === "image/jpeg" || looksLikeJpeg(view)) {
    return auditJpeg(view);
  }
  if (type === "image/webp" || looksLikeWebp(view)) {
    return auditWebp(view);
  }
  return {
    kind: "unknown",
    issues: ["Unknown image structure"],
    markers: [],
    byteLength: view.byteLength,
    passed: false,
  };
}

export function describeAudit(summary: AuditSummary): string {
  const lines = [
    `kind: ${summary.kind}`,
    `size: ${summary.byteLength} bytes`,
    `markers: ${summary.markers.join(", ") || "none"}`,
    `status: ${summary.passed ? "PASS" : "FAIL"}`,
  ];
  if (summary.issues.length) {
    lines.push("issues:");
    for (const issue of summary.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join("\n");
}

function auditPng(bytes: Uint8Array): AuditSummary {
  const issues: string[] = [];
  const markers: string[] = [];

  if (!hasPngSignature(bytes)) {
    return fail("png", bytes.byteLength, markers, "Missing PNG signature");
  }

  let cursor = PNG_SIGNATURE.length;
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;

  while (cursor < bytes.byteLength) {
    if (cursor + 12 > bytes.byteLength) {
      issues.push("Truncated PNG chunk header");
      break;
    }

    const length = readU32be(bytes, cursor);
    const type = readAscii(bytes, cursor + 4, 4);
    markers.push(type);

    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const crcPos = dataEnd;
    if (dataEnd > bytes.byteLength || crcPos + 4 > bytes.byteLength) {
      issues.push(`Invalid PNG chunk length for ${type}`);
      break;
    }

    const expectedCrc = readU32be(bytes, crcPos);
    const actualCrc = crc32(bytes.subarray(cursor + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      issues.push(`PNG CRC mismatch for ${type}`);
    }

    if (type === "IHDR") {
      if (cursor !== PNG_SIGNATURE.length) {
        issues.push("IHDR must be first chunk");
      }
      sawIHDR = true;
    }
    if (type === "IDAT") {
      sawIDAT = true;
    }
    if (type === "IEND") {
      sawIEND = true;
      if (crcPos + 4 !== bytes.byteLength) {
        issues.push("Trailing bytes after IEND");
      }
    }

    if (PNG_DENY.has(type)) {
      issues.push(`Disallowed PNG chunk found: ${type}`);
    } else if (!PNG_ALLOWED.has(type)) {
      issues.push(`Non-allowlisted PNG chunk found: ${type}`);
    }

    cursor = crcPos + 4;
    if (type === "IEND") {
      break;
    }
  }

  if (!sawIHDR || !sawIDAT || !sawIEND) {
    issues.push("Required PNG chunks missing");
  }

  return {
    kind: "png",
    issues,
    markers,
    byteLength: bytes.byteLength,
    passed: issues.length === 0,
  };
}

function auditJpeg(bytes: Uint8Array): AuditSummary {
  const issues: string[] = [];
  const markers: string[] = [];

  if (!looksLikeJpeg(bytes)) {
    return fail("jpeg", bytes.byteLength, markers, "Missing JPEG SOI marker");
  }

  markers.push("SOI");
  let cursor = 2;

  while (cursor < bytes.byteLength) {
    if (bytes[cursor] !== 0xff) {
      issues.push("Unexpected JPEG entropy byte before marker");
      break;
    }

    while (cursor < bytes.byteLength && bytes[cursor] === 0xff) {
      cursor += 1;
    }
    if (cursor >= bytes.byteLength) {
      issues.push("Unexpected JPEG EOF before marker");
      break;
    }

    const markerByte = bytes[cursor];
    const markerName = jpegMarkerName(markerByte);
    markers.push(markerName);
    cursor += 1;

    if (markerByte === 0xd9) {
      if (cursor !== bytes.byteLength) {
        issues.push("Trailing bytes after JPEG EOI");
      }
      break;
    }

    if (markerByte === 0x01 || (markerByte >= 0xd0 && markerByte <= 0xd7)) {
      continue;
    }

    if (cursor + 1 >= bytes.byteLength) {
      issues.push(`Truncated JPEG marker length for ${markerName}`);
      break;
    }

    const len = readU16be(bytes, cursor);
    if (len < 2 || cursor + len > bytes.byteLength) {
      issues.push(`Invalid segment length for marker ${markerName}`);
      break;
    }

    if (JPEG_DENY.has(markerName)) {
      issues.push(`Disallowed JPEG marker found: ${markerName}`);
    }

    if (markerByte === 0xda) {
      const eoi = findJpegEoi(bytes, cursor + len);
      if (eoi === -1) {
        issues.push("EOI marker not found");
      } else {
        markers.push("EOI");
        if (eoi + 2 !== bytes.byteLength) {
          issues.push("Trailing bytes after JPEG EOI");
        }
      }
      break;
    }

    cursor += len;
  }

  if (!markers.includes("EOI")) {
    issues.push("EOI marker not found");
  }

  return {
    kind: "jpeg",
    issues,
    markers,
    byteLength: bytes.byteLength,
    passed: issues.length === 0,
  };
}

function auditWebp(bytes: Uint8Array): AuditSummary {
  const issues: string[] = [];
  const markers: string[] = [];

  if (!looksLikeWebp(bytes)) {
    return fail("webp", bytes.byteLength, markers, "Invalid WebP RIFF header");
  }

  markers.push("RIFF", "WEBP");
  const riffSize = readU32le(bytes, 4);
  if (riffSize + 8 !== bytes.byteLength) {
    issues.push("WebP RIFF size mismatch");
  }

  let cursor = 12;
  let sawImageData = false;

  while (cursor < bytes.byteLength) {
    if (cursor + 8 > bytes.byteLength) {
      issues.push("Truncated WebP chunk header");
      break;
    }

    const chunkType = readAscii(bytes, cursor, 4);
    const chunkLen = readU32le(bytes, cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + chunkLen;
    const paddedEnd = dataEnd + (chunkLen % 2);

    markers.push(chunkType);

    if (paddedEnd > bytes.byteLength) {
      issues.push(`Invalid WebP chunk length for ${chunkType}`);
      break;
    }

    if (WEBP_DENY.has(chunkType)) {
      issues.push(`Disallowed WebP chunk found: ${chunkType}`);
    } else if (!WEBP_ALLOW.has(chunkType)) {
      issues.push(`Non-allowlisted WebP chunk found: ${chunkType}`);
    }

    if (chunkType === "VP8 " || chunkType === "VP8L") {
      sawImageData = true;
    }

    if (chunkType === "VP8X" && chunkLen >= 1) {
      const flags = bytes[dataStart];
      if ((flags & 0b11000000) !== 0) {
        issues.push("WebP VP8X metadata flags are set");
      }
      if ((flags & 0b00000010) !== 0) {
        issues.push("Animated WebP is not allowed");
      }
    }

    cursor = paddedEnd;
  }

  if (!sawImageData) {
    issues.push("Missing WebP image payload chunk");
  }

  return {
    kind: "webp",
    issues,
    markers,
    byteLength: bytes.byteLength,
    passed: issues.length === 0,
  };
}

function fail(
  kind: AuditSummary["kind"],
  byteLength: number,
  markers: string[],
  issue: string,
): AuditSummary {
  return {
    kind,
    issues: [issue],
    markers,
    byteLength,
    passed: false,
  };
}

function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }
  return true;
}

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function looksLikeWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }
  return readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP";
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(bytes[start + i] ?? 0);
  }
  return text;
}

function readU16be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)) >>> 0;
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readU32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function jpegMarkerName(markerByte: number): string {
  if (markerByte >= 0xe0 && markerByte <= 0xef) {
    return `APP${markerByte - 0xe0}`;
  }
  if (markerByte === 0xfe) return "COM";
  if (markerByte === 0xdb) return "DQT";
  if (markerByte === 0xc0) return "SOF0";
  if (markerByte === 0xc2) return "SOF2";
  if (markerByte === 0xc4) return "DHT";
  if (markerByte === 0xdd) return "DRI";
  if (markerByte === 0xda) return "SOS";
  if (markerByte === 0xd9) return "EOI";
  return `0x${markerByte.toString(16).toUpperCase()}`;
}

function findJpegEoi(bytes: Uint8Array, start: number): number {
  for (let i = start; i + 1 < bytes.byteLength; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return i;
    }
  }
  return -1;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= data[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
