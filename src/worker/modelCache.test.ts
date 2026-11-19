import { describe, expect, it, vi } from 'vitest';
import { fetchModel } from './modelCache';

const URL_A = 'https://example.test/model.onnx';
const bytes = (...v: number[]) => new Uint8Array(v) as Uint8Array<ArrayBuffer>;
type Bytes = Uint8Array<ArrayBuffer>;

function fakeCaches(initial: Record<string, Bytes> = {}) {
    const store = new Map<string, Bytes>(Object.entries(initial));
    const put = vi.fn(async (url: string, res: Response) => {
        store.set(url, new Uint8Array(await res.arrayBuffer()));
    });
    const cache = {
        match: async (url: string) => (store.has(url) ? new Response(store.get(url)!) : undefined),
        put,
    };
    return { caches: { open: async () => cache } as unknown as CacheStorage, put, store };
}

function fakeFetch(body: Bytes, init: { status?: number; contentLength?: boolean } = {}) {
    return vi.fn(async () => {
        const headers = new Headers();
        if (init.contentLength !== false) headers.set('Content-Length', String(body.length));
        return new Response(body, { status: init.status ?? 200, headers });
    }) as unknown as typeof fetch;
}

describe('fetchModel', () => {
    it('returns cached bytes without downloading', async () => {
        const { caches } = fakeCaches({ [URL_A]: bytes(1, 2, 3) });
        const fetch = fakeFetch(bytes(9));
        const buf = await fetchModel(URL_A, () => {}, { caches, fetch });
        expect([...new Uint8Array(buf)]).toEqual([1, 2, 3]);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('downloads on a miss, reports completion and stores the model', async () => {
        const { caches, store } = fakeCaches();
        const progress: (number | null)[] = [];
        const buf = await fetchModel(URL_A, (p) => progress.push(p), { caches, fetch: fakeFetch(bytes(4, 5, 6, 7)) });
        expect([...new Uint8Array(buf)]).toEqual([4, 5, 6, 7]);
        expect(progress[progress.length - 1]).toBe(1);
        expect([...store.get(URL_A)!]).toEqual([4, 5, 6, 7]);
    });

    it('rejects on an HTTP error and stores nothing', async () => {
        const { caches, put } = fakeCaches();
        await expect(fetchModel(URL_A, () => {}, { caches, fetch: fakeFetch(bytes(0), { status: 404 }) }))
            .rejects.toThrow('Model download failed (HTTP 404)');
        expect(put).not.toHaveBeenCalled();
    });

    it('reports null progress when the size is unknown', async () => {
        const { caches } = fakeCaches();
        const progress: (number | null)[] = [];
        await fetchModel(URL_A, (p) => progress.push(p), { caches, fetch: fakeFetch(bytes(1, 2), { contentLength: false }) });
        expect(progress.length).toBeGreaterThan(0);
        expect(progress.every((p) => p === null)).toBe(true);
    });

    it('still downloads when Cache Storage is unavailable', async () => {
        const caches = { open: async () => { throw new Error('denied'); } } as unknown as CacheStorage;
        const buf = await fetchModel(URL_A, () => {}, { caches, fetch: fakeFetch(bytes(8)) });
        expect([...new Uint8Array(buf)]).toEqual([8]);
    });

    it('passes the abort signal to fetch and stores nothing when aborted', async () => {
        const { caches, put } = fakeCaches();
        const controller = new AbortController();
        const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.signal).toBe(controller.signal);
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
        }) as unknown as typeof globalThis.fetch;
        await expect(fetchModel(URL_A, () => {}, { caches, fetch, signal: controller.signal })).rejects.toThrow('Aborted');
        expect(put).not.toHaveBeenCalled();
    });
});
