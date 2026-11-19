import { describe, expect, it, vi } from 'vitest';
import { createEngine, type EngineDeps, type SessionLike } from './engine';
import { TIERS, type Backend } from '../models';

const input = new Float32Array(3);
const mask = { data: new Float32Array([1]), width: 1, height: 1, inferenceMs: 5 };
const okSession = (): SessionLike => ({ run: vi.fn(async () => mask), release: vi.fn(async () => {}) });
const live = () => new AbortController().signal;

function deps(over: Partial<EngineDeps> = {}): EngineDeps {
    return {
        backends: async () => ['webgpu', 'wasm'] as Backend[],
        fetchModel: vi.fn(async () => new ArrayBuffer(8)),
        createSession: vi.fn(async () => okSession()),
        ...over,
    };
}

describe('engine', () => {
    it('a failed download does not poison the tier', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const fetchModel = vi.fn()
            .mockRejectedValueOnce(new Error('Model download failed (HTTP 503)'))
            .mockRejectedValueOnce(new Error('Model download failed (HTTP 503)'))
            .mockResolvedValue(new ArrayBuffer(8));
        const engine = createEngine(deps({ fetchModel }));

        await expect(engine.infer(TIERS.balanced, input, () => {}, live())).rejects.toThrow('Model download failed (HTTP 503)');
        const second = await engine.infer(TIERS.balanced, input, () => {}, live());
        expect(second.backend).toBe('webgpu');
    });

    it('falls back to wasm when the webgpu session fails and does not retry webgpu', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const createSession = vi.fn(async (_model: ArrayBuffer, backend: Backend) => {
            if (backend === 'webgpu') throw new Error('shader limit');
            return okSession();
        });
        const fetchModel = vi.fn(async () => new ArrayBuffer(8));
        const engine = createEngine(deps({ createSession, fetchModel }));

        expect((await engine.infer(TIERS.high, input, () => {}, live())).backend).toBe('wasm');
        expect((await engine.infer(TIERS.high, input, () => {}, live())).backend).toBe('wasm');
        expect(createSession.mock.calls.map((c) => c[1])).toEqual(['webgpu', 'wasm']);
        expect(fetchModel).toHaveBeenCalledTimes(1); // bytes reused for the fallback, session reused afterwards
    });

    it('falls back when a webgpu run fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const createSession = vi.fn(async (_model: ArrayBuffer, backend: Backend): Promise<SessionLike> =>
            backend === 'webgpu'
                ? { run: async () => { throw new Error('device lost'); }, release: async () => {} }
                : okSession());
        const engine = createEngine(deps({ createSession }));
        expect((await engine.infer(TIERS.fast, input, () => {}, live())).backend).toBe('wasm');
    });

    it('stops with "superseded" when aborted, without marking anything broken', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const createSession = vi.fn(async () => okSession());
        const engine = createEngine(deps({ createSession }));
        const aborted = new AbortController();
        aborted.abort();

        await expect(engine.infer(TIERS.fast, input, () => {}, aborted.signal)).rejects.toThrow('superseded');
        expect(createSession).not.toHaveBeenCalled();
        expect((await engine.infer(TIERS.fast, input, () => {}, live())).backend).toBe('webgpu');
    });

    it('tries the backends again once all of them have failed', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let failing = true;
        const createSession = vi.fn(async () => {
            if (failing) throw new Error('out of memory');
            return okSession();
        });
        const engine = createEngine(deps({ createSession }));

        await expect(engine.infer(TIERS.high, input, () => {}, live())).rejects.toThrow('out of memory');
        failing = false;
        expect((await engine.infer(TIERS.high, input, () => {}, live())).backend).toBe('webgpu');
    });

    it('releases the previous session when the tier changes', async () => {
        const first = okSession();
        const createSession = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(okSession());
        const engine = createEngine(deps({ createSession }));
        await engine.infer(TIERS.fast, input, () => {}, live());
        await engine.infer(TIERS.balanced, input, () => {}, live());
        expect(first.release).toHaveBeenCalledTimes(1);
    });
});
