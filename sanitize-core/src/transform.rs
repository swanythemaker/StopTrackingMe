//! Deterministic pixel transforms on the decoded RGBA image, applied BEFORE re-encode so the output
//! still passes strip + audit. All math is pure-Rust `imageops` (no canvas), so the result is
//! byte-identical across browser engines — the property the future report/resize feature relies on.

use fast_image_resize::images::Image as FirImage;
use fast_image_resize::{FilterType as FirFilter, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::imageops;
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
/// never < 1px, never upscales (pct is clamped to 100). Lanczos3 convolution via fast_image_resize:
/// SIMD-accelerated (wasm `simd128`) and byte-deterministic (fixed-point U8 math, identical across
/// engines). Falls back to `image`'s resampler only if the SIMD path can't be set up.
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
    resize_fir(&img, nw, nh).unwrap_or_else(|| {
        imageops::resize(&img, nw, nh, image::imageops::FilterType::Lanczos3)
    })
}

/// fast_image_resize path: RGBA8 Lanczos3 convolution. Returns None on any setup error so the
/// caller can fall back. Deterministic: the crate uses fixed-point integer accumulation for U8x4.
fn resize_fir(img: &RgbaImage, nw: u32, nh: u32) -> Option<RgbaImage> {
    let (w, h) = img.dimensions();
    let src = FirImage::from_vec_u8(w, h, img.as_raw().clone(), PixelType::U8x4).ok()?;
    let mut dst = FirImage::new(nw, nh, PixelType::U8x4);
    let opts = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FirFilter::Lanczos3));
    Resizer::new().resize(&src, &mut dst, &opts).ok()?;
    RgbaImage::from_raw(nw, nh, dst.into_vec())
}
