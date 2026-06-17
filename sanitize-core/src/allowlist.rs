//! Single source of truth for what survives sanitization.
//!
//! Both `strip` (what we keep) and `audit` (what we accept) read these and ONLY these tables, so the
//! two can never drift — the standing gotcha that split `normalize.ts` and `audit.ts` in v0.1.

pub const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// PNG chunks kept by strip and accepted by audit.
pub const PNG_ALLOWED: [&[u8; 4]; 5] = [b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS"];

/// PNG chunks audit names explicitly as metadata-bearing (for a precise message).
/// Anything not in PNG_ALLOWED fails regardless; this list just produces "Disallowed" vs
/// "Non-allowlisted" wording.
pub const PNG_DENY: [&[u8; 4]; 6] = [b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"iCCP", b"sPLT"];

/// WebP RIFF chunks kept by strip and accepted by audit.
pub const WEBP_ALLOWED: [&[u8; 4]; 4] = [b"VP8 ", b"VP8L", b"VP8X", b"ALPH"];

/// WebP chunks audit names explicitly (metadata / animation).
pub const WEBP_DENY: [&[u8; 4]; 5] = [b"EXIF", b"XMP ", b"ICCP", b"ANIM", b"ANMF"];

pub fn png_allowed(ctype: &[u8; 4]) -> bool {
    PNG_ALLOWED.iter().any(|t| *t == ctype)
}

pub fn png_denied(ctype: &[u8; 4]) -> bool {
    PNG_DENY.iter().any(|t| *t == ctype)
}

pub fn webp_allowed(ctype: &[u8; 4]) -> bool {
    WEBP_ALLOWED.iter().any(|t| *t == ctype)
}

pub fn webp_denied(ctype: &[u8; 4]) -> bool {
    WEBP_DENY.iter().any(|t| *t == ctype)
}

/// JPEG markers stripped by strip and rejected by audit: every APPn (0xE0..=0xEF) and COM (0xFE).
pub fn jpeg_marker_denied(marker: u8) -> bool {
    (0xe0..=0xef).contains(&marker) || marker == 0xfe
}
