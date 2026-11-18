/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { TIERS, type Backend, type Tier } from '../models';
import { cleanEdges } from '../utils/edgeCleanup';
import { maskToAlpha, toCHW } from '../utils/tensor';
import { runWithFallback } from './fallback';
import { fetchModel } from './modelCache';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// The wasm binaries are copied to the site root by copy_files.js.
ort.env.wasm.wasmPaths = new URL(import.meta.env.BASE_URL, self.location.origin).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1;

const post = (msg: WorkerResponse) => self.postMessage(msg);

// ---- backends ---------------------------------------------------------

let backendsPromise: Promise<Backend[]> | null = null;
function availableBackends(): Promise<Backend[]> {
    backendsPromise ??= (async () => {
        try {
            const adapter = await (navigator as any).gpu?.requestAdapter();
            if (adapter) return ['webgpu', 'wasm'] as Backend[];
        } catch {
            // fall through to CPU
        }
        return ['wasm'] as Backend[];
    })();
    return backendsPromise;
}

/** Tier/backend pairs that failed once; not retried in this session. */
const broken = new Set<string>();

// ---- session (one at a time) -----------------------------------------

let session: ort.InferenceSession | null = null;
let sessionKey = '';

async function getSession(tier: Tier, backend: Backend, id: number): Promise<ort.InferenceSession> {
    const key = `${tier.id}/${backend}`;
    if (session && sessionKey === key) return session;

    if (session) {
        const old = session;
        session = null;
        sessionKey = '';
        await old.release().catch(() => {});
    }

    post({ id, type: 'status', text: 'Downloading model…', progress: null });
    const model = await fetchModel(tier.url, (progress) =>
        post({ id, type: 'status', text: 'Downloading model…', progress }),
    );

    post({ id, type: 'status', text: 'Preparing model…', progress: null });
    const created = await ort.InferenceSession.create(model, { executionProviders: [backend] });
    session = created;
    sessionKey = key;
    return created;
}

// ---- pipeline ---------------------------------------------------------

interface RawMask {
    data: Float32Array;
    width: number;
    height: number;
    inferenceMs: number;
}

async function infer(tier: Tier, backend: Backend, input: Float32Array, id: number): Promise<RawMask> {
    const key = `${tier.id}/${backend}`;
    if (broken.has(key)) throw new Error(`${backend} already failed for this model`);
    try {
        const s = await getSession(tier, backend, id);
        post({ id, type: 'status', text: 'Removing background…', progress: null });
        const start = performance.now();
        const tensor = new ort.Tensor('float32', input, [1, 3, tier.size, tier.size]);
        const results = await s.run({ [s.inputNames[0]]: tensor });
        const output = results[s.outputNames[0]];
        const data = await output.getData();
        const inferenceMs = performance.now() - start;
        const dims = output.dims;
        for (const t of Object.values(results)) t.dispose();
        if (!(data instanceof Float32Array)) throw new Error(`Unexpected model output type ${output.type}`);
        return { data, width: dims[dims.length - 1], height: dims[dims.length - 2], inferenceMs };
    } catch (e) {
        broken.add(key);
        throw e;
    }
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
}

async function process(req: WorkerRequest): Promise<void> {
    const { id, bitmap } = req;
    const tier = TIERS[req.tier];
    const width = bitmap.width;
    const height = bitmap.height;

    // Model input: the whole image squeezed into the model's square.
    const small = new OffscreenCanvas(tier.size, tier.size);
    const smallCtx = context(small);
    smallCtx.drawImage(bitmap, 0, 0, tier.size, tier.size);
    const input = toCHW(smallCtx.getImageData(0, 0, tier.size, tier.size).data, tier.size, tier.mean, tier.std);

    const { result: mask, backend } = await runWithFallback(await availableBackends(), (b) => infer(tier, b, input, id));

    // Mask → alpha bytes → stretched back to the image's own size.
    const maskAlpha = maskToAlpha(mask.data, tier.post);
    const maskImage = new ImageData(mask.width, mask.height);
    for (let i = 0; i < maskAlpha.length; i++) maskImage.data[i * 4 + 3] = maskAlpha[i];
    const maskCanvas = new OffscreenCanvas(mask.width, mask.height);
    context(maskCanvas).putImageData(maskImage, 0, 0);

    const full = new OffscreenCanvas(width, height);
    const ctx = context(full);
    ctx.drawImage(maskCanvas, 0, 0, width, height);
    const scaled = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = scaled[i * 4 + 3];

    // Original pixels with cleaned edges and the new alpha.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    for (let i = 0; i < alpha.length; i++) {
        // Keep transparency the source image already had.
        const a = (alpha[i] * px[i * 4 + 3]) / 255;
        alpha[i] = a;
    }
    cleanEdges(px, alpha, width, height);
    for (let i = 0; i < alpha.length; i++) px[i * 4 + 3] = alpha[i];
    ctx.putImageData(image, 0, 0);

    const blob = await full.convertToBlob({ type: 'image/png' });
    post({ id, type: 'done', blob, backend, inferenceMs: mask.inferenceMs });
}

// ---- queue: one job at a time, only the newest waiting job is kept ----

let running = false;
let waiting: WorkerRequest | null = null;

async function drain(): Promise<void> {
    if (running) return;
    running = true;
    while (waiting) {
        const req = waiting;
        waiting = null;
        try {
            await process(req);
        } catch (e) {
            console.error(e);
            post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
    }
    running = false;
}

self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
    waiting?.bitmap.close();
    waiting = ev.data;
    void drain();
});
