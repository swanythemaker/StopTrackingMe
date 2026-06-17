//! sanitize-core — the deterministic, fuzzable half of STOPTRACKINGME's pipeline.
//!
//! Owns decode → pixel transforms → strip → audit. Encode stays in @jsquash on the JS side, so the
//! worker calls this twice: `decode_and_transform` (bytes → RGBA), then JS encodes, then
//! `strip_and_audit` (encoded bytes → clean bytes + verdict). One allowlist drives strip and audit.

pub mod allowlist;
pub mod audit;
pub mod container;
pub mod decode;
pub mod guard;
pub mod strip;
pub mod transform;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransformOpts {
    #[serde(default = "default_resize_pct")]
    resize_pct: u32,
    #[serde(default)]
    rotate: i32,
    #[serde(default)]
    flip_h: bool,
    #[serde(default)]
    flip_v: bool,
}

fn default_resize_pct() -> u32 {
    100
}

/// Result of `decode_and_transform`: read dims (cheap getters) first, then `take_rgba()` last — it
/// moves the pixel buffer out to avoid copying a full frame.
#[wasm_bindgen]
pub struct DecodeResult {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    orig_width: u32,
    orig_height: u32,
}

#[wasm_bindgen]
impl DecodeResult {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
    #[wasm_bindgen(getter, js_name = origWidth)]
    pub fn orig_width(&self) -> u32 {
        self.orig_width
    }
    #[wasm_bindgen(getter, js_name = origHeight)]
    pub fn orig_height(&self) -> u32 {
        self.orig_height
    }
    /// Moves the RGBA8 buffer out (consumes the result). Call after reading the dimensions.
    #[wasm_bindgen(js_name = takeRgba)]
    pub fn take_rgba(self) -> Vec<u8> {
        self.rgba
    }
}

#[wasm_bindgen]
pub struct StripAuditResult {
    bytes: Vec<u8>,
    audit_json: String,
    passed: bool,
}

#[wasm_bindgen]
impl StripAuditResult {
    #[wasm_bindgen(getter)]
    pub fn passed(&self) -> bool {
        self.passed
    }
    #[wasm_bindgen(getter, js_name = auditJson)]
    pub fn audit_json(&self) -> String {
        self.audit_json.clone()
    }
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

/// Decode `input` to upright RGBA8, then apply user transforms (flip → rotate → resize).
#[wasm_bindgen(js_name = decodeAndTransform)]
pub fn decode_and_transform(input: &[u8], opts_json: &str) -> Result<DecodeResult, JsError> {
    let opts: TransformOpts =
        serde_json::from_str(opts_json).map_err(|e| JsError::new(&e.to_string()))?;

    let mut img = decode::decode_upright(input).map_err(|e| JsError::new(&e))?;
    let (orig_width, orig_height) = img.dimensions();

    if opts.flip_h {
        img = transform::flip_horizontal(img);
    }
    if opts.flip_v {
        img = transform::flip_vertical(img);
    }
    img = transform::rotate(img, opts.rotate);
    img = transform::resize(img, opts.resize_pct);

    let (width, height) = img.dimensions();
    Ok(DecodeResult { rgba: img.into_raw(), width, height, orig_width, orig_height })
}

/// Strip the re-encoded bytes to the allowlist, then audit the result with the SAME allowlist.
/// `format` is the MIME of the encoded bytes (`image/png` | `image/jpeg` | `image/webp`).
#[wasm_bindgen(js_name = stripAndAudit)]
pub fn strip_and_audit(encoded: &[u8], format: &str) -> Result<StripAuditResult, JsError> {
    let bytes = strip::strip(format, encoded).map_err(|e| JsError::new(&e))?;
    let summary = audit::audit(format, &bytes);
    let passed = summary.passed;
    let audit_json = serde_json::to_string(&summary).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(StripAuditResult { bytes, audit_json, passed })
}

/// Audit arbitrary image bytes (format auto-detected). Used for the informational input scan, so
/// input and output verdicts come from the exact same code.
#[wasm_bindgen(js_name = auditBytes)]
pub fn audit_bytes(input: &[u8]) -> String {
    let summary = audit::audit_auto(input);
    serde_json::to_string(&summary).unwrap_or_else(|_| "{}".to_string())
}
