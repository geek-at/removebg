import type { MaskPost } from '../models';

/** RGBA bytes of a size×size image → normalised float planes in R,G,B (CHW) order. */
export function toCHW(rgba: Uint8ClampedArray, size: number, mean: number[], std: number[]): Float32Array {
    const px = size * size;
    const out = new Float32Array(3 * px);
    for (let i = 0; i < px; i++) {
        out[i] = (rgba[i * 4] / 255 - mean[0]) / std[0];
        out[i + px] = (rgba[i * 4 + 1] / 255 - mean[1]) / std[1];
        out[i + 2 * px] = (rgba[i * 4 + 2] / 255 - mean[2]) / std[2];
    }
    return out;
}

/** Raw model output → one alpha byte per pixel. */
export function maskToAlpha(mask: ArrayLike<number>, post: MaskPost): Uint8ClampedArray {
    let min = 0;
    let range = 1;
    if (post === 'minmax') {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < mask.length; i++) {
            const v = mask[i];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        // A flat mask has nothing to stretch; keep its values as they are.
        if (hi > lo) {
            min = lo;
            range = hi - lo;
        }
    }
    const out = new Uint8ClampedArray(mask.length);
    for (let i = 0; i < mask.length; i++) {
        // Uint8ClampedArray clips to 0..255 and maps NaN to 0.
        out[i] = Math.round(((mask[i] - min) / range) * 255);
    }
    return out;
}
