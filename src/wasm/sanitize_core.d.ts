/* tslint:disable */
/* eslint-disable */

/**
 * Result of `decode_and_transform`: read dims (cheap getters) first, then `take_rgba()` last — it
 * moves the pixel buffer out to avoid copying a full frame.
 */
export class DecodeResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Moves the RGBA8 buffer out (consumes the result). Call after reading the dimensions.
     */
    takeRgba(): Uint8Array;
    readonly height: number;
    readonly origHeight: number;
    readonly origWidth: number;
    readonly width: number;
}

export class StripAuditResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeBytes(): Uint8Array;
    readonly auditJson: string;
    readonly passed: boolean;
}

/**
 * Audit arbitrary image bytes (format auto-detected). Used for the informational input scan, so
 * input and output verdicts come from the exact same code.
 */
export function auditBytes(input: Uint8Array): string;

/**
 * Decode `input` to upright RGBA8, then apply user transforms (flip → rotate → resize).
 */
export function decodeAndTransform(input: Uint8Array, opts_json: string): DecodeResult;

/**
 * Strip the re-encoded bytes to the allowlist, then audit the result with the SAME allowlist.
 * `format` is the MIME of the encoded bytes (`image/png` | `image/jpeg` | `image/webp`).
 */
export function stripAndAudit(encoded: Uint8Array, format: string): StripAuditResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_decoderesult_free: (a: number, b: number) => void;
    readonly __wbg_stripauditresult_free: (a: number, b: number) => void;
    readonly auditBytes: (a: number, b: number, c: number) => void;
    readonly decodeAndTransform: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decoderesult_takeRgba: (a: number, b: number) => void;
    readonly stripAndAudit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly stripauditresult_auditJson: (a: number, b: number) => void;
    readonly stripauditresult_passed: (a: number) => number;
    readonly stripauditresult_takeBytes: (a: number, b: number) => void;
    readonly decoderesult_height: (a: number) => number;
    readonly decoderesult_origHeight: (a: number) => number;
    readonly decoderesult_origWidth: (a: number) => number;
    readonly decoderesult_width: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
