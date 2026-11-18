import { describe, expect, it } from 'vitest';
import { maskToAlpha, toCHW } from './tensor';
import { TIERS, TIER_ORDER } from '../models';

describe('toCHW', () => {
    it('normalises with mean and std', () => {
        const one = toCHW(new Uint8ClampedArray([255, 0, 51, 255]), 1, [0.5, 0.5, 0.5], [1, 1, 1]);
        expect(one[0]).toBeCloseTo(0.5, 5);
        expect(one[1]).toBeCloseTo(-0.5, 5);
        expect(one[2]).toBeCloseTo(-0.3, 5);
    });

    it('lays out planes R,G,B for a 2x2 image', () => {
        const px = [10, 20, 30, 255];
        const rgba = new Uint8ClampedArray([...px, ...px, ...px, ...px]);
        const t = toCHW(rgba, 2, [0, 0, 0], [1, 1, 1]);
        expect(t.length).toBe(12);
        expect(t[0]).toBeCloseTo(10 / 255);
        expect(t[4]).toBeCloseTo(20 / 255);
        expect(t[8]).toBeCloseTo(30 / 255);
    });
});

describe('maskToAlpha', () => {
    it('minmax stretches to 0..255', () => {
        expect(Array.from(maskToAlpha([0.2, 0.4, 0.6], 'minmax'))).toEqual([0, 128, 255]);
    });

    it('clamp keeps values and clips', () => {
        expect(Array.from(maskToAlpha([-0.5, 0.5, 1.5], 'clamp'))).toEqual([0, 128, 255]);
    });

    it('handles a flat mask without NaN by falling back to clamp', () => {
        expect(Array.from(maskToAlpha([0.6, 0.6], 'minmax'))).toEqual([153, 153]);
    });
});

describe('TIERS', () => {
    it('lists three tiers in order with RMBG-1.4 using mean 0.5', () => {
        expect(TIER_ORDER).toEqual(['fast', 'balanced', 'high']);
        expect(TIERS.balanced.mean).toEqual([0.5, 0.5, 0.5]);
        expect(TIERS.balanced.std).toEqual([1, 1, 1]);
        expect(TIERS.fast.size).toBe(320);
        expect(TIERS.high.post).toBe('clamp');
        for (const id of TIER_ORDER) expect(TIERS[id].url).toMatch(/^https:\/\/huggingface\.co\/.+\.onnx$/);
    });
});
