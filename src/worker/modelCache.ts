const CACHE_NAME = 'removebg-models-v1';

interface Deps {
    caches?: CacheStorage;
    fetch?: typeof fetch;
}

async function openCache(storage: CacheStorage | undefined): Promise<Cache | null> {
    if (!storage) return null;
    try {
        return await storage.open(CACHE_NAME);
    } catch {
        return null; // private mode, blocked site data, ...
    }
}

/**
 * Returns the model's bytes, from Cache Storage if it was downloaded before.
 * `onProgress` gets the downloaded fraction, or null when the size is unknown.
 * A model is only stored after it arrived completely with an OK status.
 */
export async function fetchModel(
    url: string,
    onProgress: (fraction: number | null) => void,
    deps: Deps = {},
): Promise<ArrayBuffer> {
    const cache = await openCache(deps.caches ?? globalThis.caches);
    const doFetch = deps.fetch ?? globalThis.fetch;

    const hit = await cache?.match(url);
    if (hit) return hit.arrayBuffer();

    const res = await doFetch(url);
    if (!res.ok) throw new Error(`Model download failed (HTTP ${res.status})`);

    const total = Number(res.headers.get('Content-Length')) || 0;
    const chunks: BlobPart[] = [];
    let received = 0;
    const reader = res.body!.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as Uint8Array<ArrayBuffer>);
        received += value.length;
        onProgress(total ? Math.min(1, received / total) : null);
    }
    if (total && received !== total) throw new Error('Model download was incomplete');

    const blob = new Blob(chunks);
    if (cache) {
        try {
            await cache.put(url, new Response(blob));
        } catch (e) {
            console.warn('Could not store the model for next time', e); // e.g. quota
        }
    }
    return blob.arrayBuffer();
}
