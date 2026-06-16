const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const PNG_ALLOWED = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS"]);
const WEBP_ALLOWED = new Set(["VP8 ", "VP8L", "VP8X", "ALPH"]);

export function stripPngToAllowlist(input: Uint8Array): Uint8Array {
  if (!isPng(input)) {
    throw new Error("Not a PNG payload");
  }

  const chunks: Uint8Array[] = [PNG_SIGNATURE];
  let cursor = PNG_SIGNATURE.length;
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;

  while (cursor < input.byteLength) {
    if (cursor + 12 > input.byteLength) {
      throw new Error("Truncated PNG chunk header");
    }

    const length = readU32be(input, cursor);
    const type = readAscii(input, cursor + 4, 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const crcPos = dataEnd;

    if (dataEnd > input.byteLength || crcPos + 4 > input.byteLength) {
      throw new Error(`Invalid PNG chunk length for ${type}`);
    }

    const expectedCrc = readU32be(input, crcPos);
    const actualCrc = crc32(input.subarray(cursor + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      throw new Error(`PNG CRC mismatch for ${type}`);
    }

    if (type === "IHDR") {
      if (cursor !== PNG_SIGNATURE.length) {
        throw new Error("IHDR must be first PNG chunk");
      }
      sawIHDR = true;
    }
    if (type === "IDAT") sawIDAT = true;
    if (type === "IEND") sawIEND = true;

    if (PNG_ALLOWED.has(type)) {
      const chunk = input.subarray(cursor, crcPos + 4);
      chunks.push(rebuildPngChunk(chunk));
    }

    cursor = crcPos + 4;
    if (type === "IEND") {
      if (cursor !== input.byteLength) {
        throw new Error("Trailing bytes after PNG IEND");
      }
      break;
    }
  }

  if (!sawIHDR || !sawIDAT || !sawIEND) {
    throw new Error("Missing required PNG chunks");
  }

  return concat(chunks);
}

export function stripJpegAppMarkers(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) {
    throw new Error("Not a JPEG payload");
  }

  const out: number[] = [0xff, 0xd8];
  let cursor = 2;
  let sawEoi = false;

  while (cursor < input.byteLength) {
    if (input[cursor] !== 0xff) {
      throw new Error("Malformed JPEG marker stream");
    }

    while (cursor < input.byteLength && input[cursor] === 0xff) {
      cursor += 1;
    }
    if (cursor >= input.byteLength) {
      throw new Error("Unexpected JPEG EOF");
    }

    const marker = input[cursor];
    cursor += 1;

    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      sawEoi = true;
      if (cursor !== input.byteLength) {
        throw new Error("Trailing bytes after JPEG EOI");
      }
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      continue;
    }

    if (cursor + 1 >= input.byteLength) {
      throw new Error("Truncated JPEG segment length");
    }

    const len = readU16be(input, cursor);
    const segEnd = cursor + len;
    if (len < 2 || segEnd > input.byteLength) {
      throw new Error("Invalid JPEG segment length");
    }

    const isDisallowed = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;

    if (marker === 0xda) {
      out.push(0xff, marker);
      pushRange(out, input, cursor, segEnd);
      const eoi = findJpegEoi(input, segEnd);
      if (eoi === -1) {
        throw new Error("JPEG EOI not found after SOS");
      }
      pushRange(out, input, segEnd, eoi + 2);
      if (eoi + 2 !== input.byteLength) {
        throw new Error("Trailing bytes after JPEG EOI");
      }
      sawEoi = true;
      break;
    }

    if (!isDisallowed) {
      out.push(0xff, marker);
      pushRange(out, input, cursor, segEnd);
    }

    cursor = segEnd;
  }

  if (!sawEoi) {
    throw new Error("JPEG EOI marker missing");
  }

  return new Uint8Array(out);
}

export function stripWebpToAllowlist(input: Uint8Array): Uint8Array {
  if (!isWebp(input)) {
    throw new Error("Not a WebP payload");
  }

  const outChunks: Uint8Array[] = [];
  let cursor = 12;
  let sawImageData = false;

  while (cursor < input.byteLength) {
    if (cursor + 8 > input.byteLength) {
      throw new Error("Truncated WebP chunk header");
    }

    const chunkType = readAscii(input, cursor, 4);
    const chunkLen = readU32le(input, cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + chunkLen;
    const paddedEnd = dataEnd + (chunkLen % 2);

    if (paddedEnd > input.byteLength) {
      throw new Error(`Invalid WebP chunk length for ${chunkType}`);
    }

    if (chunkType === "ANIM" || chunkType === "ANMF") {
      throw new Error("Animated WebP is not supported in paranoid mode");
    }

    if (chunkType === "VP8 " || chunkType === "VP8L") {
      sawImageData = true;
    }

    if (WEBP_ALLOWED.has(chunkType)) {
      const data = input.subarray(dataStart, dataEnd);
      if (chunkType === "VP8X") {
        const cleaned = cleanseVp8x(data);
        outChunks.push(buildWebpChunk(chunkType, cleaned));
      } else {
        outChunks.push(buildWebpChunk(chunkType, data));
      }
    }

    cursor = paddedEnd;
  }

  if (!sawImageData) {
    throw new Error("WebP image payload missing");
  }

  const body = concat(outChunks);
  const out = new Uint8Array(12 + body.byteLength);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  writeU32le(out, 4, body.byteLength + 4);
  out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  out.set(body, 12);
  return out;
}

function cleanseVp8x(data: Uint8Array): Uint8Array {
  if (data.byteLength < 10) {
    throw new Error("Invalid VP8X chunk length");
  }
  const clean = data.slice();
  clean[0] &= 0b00111101; // clear ICCP, EXIF, XMP and animation bits
  return clean;
}

function buildWebpChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.byteLength + (data.byteLength % 2));
  writeAscii(out, 0, type);
  writeU32le(out, 4, data.byteLength);
  out.set(data, 8);
  return out;
}

function rebuildPngChunk(rawChunk: Uint8Array): Uint8Array {
  const length = readU32be(rawChunk, 0);
  const chunkType = rawChunk.subarray(4, 8);
  const chunkData = rawChunk.subarray(8, 8 + length);
  const out = new Uint8Array(12 + length);
  writeU32be(out, 0, length);
  out.set(chunkType, 4);
  out.set(chunkData, 8);
  const crc = crc32(out.subarray(4, 8 + length));
  writeU32be(out, 8 + length, crc);
  return out;
}

function isPng(bytes: Uint8Array): boolean {
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

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength > 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 12 &&
    readAscii(bytes, 0, 4) === "RIFF" &&
    readAscii(bytes, 8, 4) === "WEBP"
  );
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(bytes[start + i] ?? 0);
  }
  return text;
}

function writeAscii(bytes: Uint8Array, start: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    bytes[start + i] = text.charCodeAt(i);
  }
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

function writeU32be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeU32le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function findJpegEoi(bytes: Uint8Array, start: number): number {
  for (let i = start; i + 1 < bytes.byteLength; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return i;
    }
  }
  return -1;
}

function pushRange(target: number[], source: Uint8Array, start: number, end: number): void {
  for (let i = start; i < end; i += 1) {
    target.push(source[i]);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
