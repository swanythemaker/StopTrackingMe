//! Deterministic pixel transforms on the decoded RGBA image, applied BEFORE re-encode so the output
//! still passes strip + audit. All math is pure-Rust `imageops` (no canvas), so the result is
//! byte-identical across browser engines — the property the future report/resize feature relies on.

use image::imageops::{self, FilterType};
use image::RgbaImage;

/// EXIF orientation (1..=8) baked into pixels, so we can then drop the orientation tag without the
/// image coming out sideways. Standard recipe; values outside 1..=8 are treated as "no transform".
pub fn bake_orientation(img: RgbaImage, orientation: u32) -> RgbaImage {
    match orientation {
        2 => imageops::flip_horizontal(&img),
        3 => imageops::rotate180(&img),
        4 => imageops::flip_vertical(&img),
        5 => {
            let f = imageops::flip_horizontal(&img);
            imageops::rotate90(&f)
        }
        6 => imageops::rotate90(&img),
        7 => {
            let f = imageops::flip_horizontal(&img);
            imageops::rotate270(&f)
        }
        8 => imageops::rotate270(&img),
        _ => img, // 1 or unknown
    }
}

/// Manual rotate override in clockwise degrees (0/90/180/270). Other values are no-ops.
pub fn rotate(img: RgbaImage, degrees: i32) -> RgbaImage {
    match degrees.rem_euclid(360) {
        90 => imageops::rotate90(&img),
        180 => imageops::rotate180(&img),
        270 => imageops::rotate270(&img),
        _ => img,
    }
}

pub fn flip_horizontal(img: RgbaImage) -> RgbaImage {
    imageops::flip_horizontal(&img)
}

pub fn flip_vertical(img: RgbaImage) -> RgbaImage {
    imageops::flip_vertical(&img)
}

/// Resize to `pct`% of current dimensions (10..=100). Preserves aspect ratio, rounds to integer px,
/// never < 1px, never upscales (pct is clamped to 100). Lanczos3 for quality + determinism.
pub fn resize(img: RgbaImage, pct: u32) -> RgbaImage {
    let pct = pct.clamp(10, 100);
    if pct == 100 {
        return img;
    }
    let (w, h) = img.dimensions();
    let nw = (((w as u64) * (pct as u64) + 50) / 100).max(1) as u32;
    let nh = (((h as u64) * (pct as u64) + 50) / 100).max(1) as u32;
    if nw == w && nh == h {
        return img;
    }
    imageops::resize(&img, nw, nh, FilterType::Lanczos3)
}
