import { describe, expect, it } from 'vitest';
import { cleanEdges } from './edgeCleanup';

/**
 * Pure red opaque foreground on the left, pure green transparent background on
 * the right, and a `ramp`-pixel-wide soft edge between them whose colour is the
 * blend a camera would record: red·a + green·(1−a).
 */
function makeEdge(w: number, h: number, ramp: number) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    const alpha = new Uint8ClampedArray(w * h);
    const start = Math.floor((w - ramp) / 2);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = x < start ? 1 : x >= start + ramp ? 0 : 1 - (x - start + 0.5) / ramp;
            const i = y * w + x;
            rgba[i * 4] = 255 * a;
            rgba[i * 4 + 1] = 255 * (1 - a);
            rgba[i * 4 + 3] = 255;
            alpha[i] = Math.round(a * 255);
        }
    }
    return { rgba, alpha, before: rgba.slice() };
}

describe('cleanEdges', () => {
    it('pulls soft-edge colours toward the foreground', () => {
        const w = 40, h = 10;
        const { rgba, alpha, before } = makeEdge(w, h, 4);
        cleanEdges(rgba, alpha, w, h);
        const i = (5 * w + 20) * 4; // inside the soft edge
        expect(alpha[5 * w + 20]).toBeGreaterThan(0);
        expect(alpha[5 * w + 20]).toBeLessThan(255);
        expect(rgba[i + 1]).toBeLessThan(before[i + 1] * 0.5); // background green at least halved
        expect(rgba[i]).toBeGreaterThan(before[i]); // more foreground red
    });

    it('leaves fully opaque and fully transparent pixels untouched', () => {
        const w = 40, h = 10;
        const { rgba, alpha, before } = makeEdge(w, h, 4);
        cleanEdges(rgba, alpha, w, h);
        for (const x of [2, 37]) {
            const i = (5 * w + x) * 4;
            expect([...rgba.slice(i, i + 4)]).toEqual([...before.slice(i, i + 4)]);
        }
    });

    it('handles a large non-square image through the downscaled estimate', () => {
        const w = 2600, h = 300; // wider than the 1024 px working size
        const { rgba, alpha, before } = makeEdge(w, h, 12);
        cleanEdges(rgba, alpha, w, h);
        const x = w / 2 + 2;
        const i = (150 * w + x) * 4;
        expect(alpha[150 * w + x]).toBeGreaterThan(0);
        expect(rgba[i + 1]).toBeLessThan(before[i + 1] * 0.5);
        const opaque = (150 * w + 10) * 4;
        expect([...rgba.slice(opaque, opaque + 3)]).toEqual([255, 0, 0]);
    });

    it('does nothing harmful when the mask has no soft pixels', () => {
        const rgba = new Uint8ClampedArray([9, 8, 7, 255, 1, 2, 3, 255]);
        cleanEdges(rgba, new Uint8ClampedArray([255, 0]), 2, 1);
        expect([...rgba]).toEqual([9, 8, 7, 255, 1, 2, 3, 255]);
    });
});
