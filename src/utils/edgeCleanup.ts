/**
 * Foreground colour cleanup for soft mask edges.
 *
 * A semi-transparent edge pixel still carries the old background's colour, which
 * shows as a halo on a new background. This estimates the pure foreground colour
 * with one pass of blur fusion (Forte & Pitié, "Approximate Fast Foreground
 * Colour Estimation", 2021):
 *
 *   F  = blur(I·a) / blur(a)            local foreground colour
 *   B  = blur(I·(1−a)) / blur(1−a)      local background colour
 *   F' = F + a·(I − a·F − (1−a)·B)      corrected with the pixel's own colour
 *
 * F and B are smooth by construction, so they are computed on a grid of at most
 * WORK_SIZE pixels per side and sampled bilinearly. That keeps memory flat for
 * large photos.
 */

const WORK_SIZE = 1024;
const EPS = 1e-6;

/** Sum of `src` over a (2r+1)² window around every cell, via a summed-area table. */
function boxSum(src: Float32Array, w: number, h: number, r: number): Float32Array {
    const sw = w + 1;
    const sat = new Float64Array(sw * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += src[y * w + x];
            sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row;
        }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r);
            const x1 = Math.min(w, x + r + 1);
            out[y * w + x] = sat[y1 * sw + x1] - sat[y0 * sw + x1] - sat[y1 * sw + x0] + sat[y0 * sw + x0];
        }
    }
    return out;
}

/**
 * Replaces the colour of semi-transparent pixels with an estimate of the pure
 * foreground colour, in place. `alpha` has one byte per pixel. Pixels with
 * alpha 0 or 255 are left untouched; the alpha channel of `rgba` is not changed.
 */
export function cleanEdges(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, width: number, height: number): void {
    let hasSoft = false;
    for (let i = 0; i < alpha.length; i++) {
        if (alpha[i] > 0 && alpha[i] < 255) {
            hasSoft = true;
            break;
        }
    }
    if (!hasSoft) return;

    // Accumulate the image onto the working grid.
    const k = Math.max(1, Math.ceil(Math.max(width, height) / WORK_SIZE));
    const lw = Math.ceil(width / k);
    const lh = Math.ceil(height / k);
    const n = lw * lh;
    const sumA = new Float32Array(n);
    const sumInv = new Float32Array(n);
    const fg = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const bg = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let y = 0; y < height; y++) {
        const cellRow = Math.floor(y / k) * lw;
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const cell = cellRow + Math.floor(x / k);
            const a = alpha[p] / 255;
            sumA[cell] += a;
            sumInv[cell] += 1 - a;
            for (let c = 0; c < 3; c++) {
                const v = rgba[p * 4 + c];
                fg[c][cell] += v * a;
                bg[c][cell] += v * (1 - a);
            }
        }
    }

    // Local foreground and background colours.
    const r = Math.max(4, Math.round(Math.max(lw, lh) / 12));
    const blurA = boxSum(sumA, lw, lh, r);
    const blurInv = boxSum(sumInv, lw, lh, r);
    const F = fg.map((plane) => boxSum(plane, lw, lh, r));
    const B = bg.map((plane) => boxSum(plane, lw, lh, r));
    for (let i = 0; i < n; i++) {
        const da = blurA[i] + EPS;
        const db = blurInv[i] + EPS;
        for (let c = 0; c < 3; c++) {
            F[c][i] /= da;
            B[c][i] /= db;
        }
    }

    // Correct each soft pixel at full resolution.
    for (let y = 0; y < height; y++) {
        const gy = Math.min(lh - 1, Math.max(0, (y + 0.5) / k - 0.5));
        const y0 = Math.floor(gy);
        const y1 = Math.min(lh - 1, y0 + 1);
        const ty = gy - y0;
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const a8 = alpha[p];
            if (a8 === 0 || a8 === 255) continue;
            const a = a8 / 255;
            const gx = Math.min(lw - 1, Math.max(0, (x + 0.5) / k - 0.5));
            const x0 = Math.floor(gx);
            const x1 = Math.min(lw - 1, x0 + 1);
            const tx = gx - x0;
            const w00 = (1 - tx) * (1 - ty);
            const w10 = tx * (1 - ty);
            const w01 = (1 - tx) * ty;
            const w11 = tx * ty;
            const i00 = y0 * lw + x0;
            const i10 = y0 * lw + x1;
            const i01 = y1 * lw + x0;
            const i11 = y1 * lw + x1;
            for (let c = 0; c < 3; c++) {
                const f = F[c][i00] * w00 + F[c][i10] * w10 + F[c][i01] * w01 + F[c][i11] * w11;
                const b = B[c][i00] * w00 + B[c][i10] * w10 + B[c][i01] * w01 + B[c][i11] * w11;
                const v = rgba[p * 4 + c];
                rgba[p * 4 + c] = f + a * (v - a * f - (1 - a) * b); // clamped by the array
            }
        }
    }
}
