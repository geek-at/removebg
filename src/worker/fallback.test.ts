import { describe, expect, it, vi } from 'vitest';
import { runWithFallback } from './fallback';
import type { Backend } from '../models';

describe('runWithFallback', () => {
    it('uses the first backend when it works', async () => {
        const attempt = vi.fn(async (b: Backend) => b + '-ok');
        expect(await runWithFallback(['webgpu', 'wasm'], attempt)).toEqual({ result: 'webgpu-ok', backend: 'webgpu' });
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it('falls back to the next backend when one throws', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const attempt = vi.fn(async (b: Backend) => {
            if (b === 'webgpu') throw new Error('shader limit');
            return 'mask';
        });
        expect(await runWithFallback(['webgpu', 'wasm'], attempt)).toEqual({ result: 'mask', backend: 'wasm' });
        expect(attempt).toHaveBeenCalledTimes(2);
    });

    it('rethrows the last error when every backend fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(runWithFallback(['wasm'], async () => { throw new Error('out of memory'); }))
            .rejects.toThrow('out of memory');
    });
});
