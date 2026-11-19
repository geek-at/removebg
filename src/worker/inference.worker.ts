/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { TIERS, type Backend } from '../models';
import { cleanEdges } from '../utils/edgeCleanup';
import { maskToAlpha, toCHW } from '../utils/tensor';
import { createEngine, type SessionLike } from './engine';
import { fetchModel } from './modelCache';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// The wasm binary is emitted by Vite as a hashed asset next to this worker.
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

// ---- engine ----------------------------------------------------------

async function createSession(model: ArrayBuffer, backend: Backend): Promise<SessionLike> {
    const session = await ort.InferenceSession.create(model, { executionProviders: [backend] });
    return {
        async run(input, size) {
            const start = performance.now();
            const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
            const results = await session.run({ [session.inputNames[0]]: tensor });
            const output = results[session.outputNames[0]];
            const data = await output.getData();
            const inferenceMs = performance.now() - start;
            const dims = output.dims;
            const type = output.type;
            for (const t of Object.values(results)) t.dispose();
            if (!(data instanceof Float32Array)) throw new Error(`Unexpected model output type ${type}`);
            return { data, width: dims[dims.length - 1], height: dims[dims.length - 2], inferenceMs };
        },
        release: () => session.release(),
    };
}

const engine = createEngine({
    backends: availableBackends,
    fetchModel: (url, onProgress, signal) => fetchModel(url, onProgress, { signal }),
    createSession,
});

// ---- pipeline ---------------------------------------------------------

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a canvas context');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return ctx;
}

async function process(req: WorkerRequest, signal: AbortSignal): Promise<void> {
    const { id, bitmap } = req;
    const tier = TIERS[req.tier];
    const width = bitmap.width;
    const height = bitmap.height;

    // Model input: the whole image squeezed into the model's square.
    const small = new OffscreenCanvas(tier.size, tier.size);
    const smallCtx = context(small);
    smallCtx.drawImage(bitmap, 0, 0, tier.size, tier.size);
    const input = toCHW(smallCtx.getImageData(0, 0, tier.size, tier.size).data, tier.size, tier.mean, tier.std);

    const { mask, backend } = await engine.infer(
        tier,
        input,
        (text, progress) => post({ id, type: 'status', text, progress }),
        signal,
    );
    if (signal.aborted) throw new Error('superseded');

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

let running: AbortController | null = null;
let waiting: WorkerRequest | null = null;

async function drain(): Promise<void> {
    if (running) return;
    while (waiting) {
        const req = waiting;
        waiting = null;
        running = new AbortController();
        try {
            await process(req, running.signal);
        } catch (e) {
            if (!running.signal.aborted) console.error(e);
            post({ id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
    }
    running = null;
}

self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
    // A newer request makes the running one pointless: stop its download and
    // skip its remaining stages.
    running?.abort();
    waiting?.bitmap.close();
    waiting = ev.data;
    void drain();
});
