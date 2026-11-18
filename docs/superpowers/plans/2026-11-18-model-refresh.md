# Model Refresh and WebGPU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2023 model lineup with three tiers (u2netp, RMBG-1.4 fp16, BEN2 fp16) running on WebGPU with WASM fallback, in a Web Worker, with cached models and cleaner edges.

**Architecture:** Pure pixel maths (normalization, mask conversion, edge cleanup) lives in small tested modules. A Web Worker owns ONNX Runtime, the model cache and the whole image pipeline, and returns a PNG blob. The React app talks to the worker through one promise-based client function.

**Tech Stack:** React 18, TypeScript, Vite 5, onnxruntime-web 1.31.1 (WebGPU bundle), Vitest (new, for the pure modules).

**Spec:** `docs/superpowers/specs/2026-11-18-model-refresh-design.md`

## Global Constraints

- All work on a new branch `model-refresh`; one commit per task.
- `onnxruntime-web` pinned to exactly `1.31.1`; import from `onnxruntime-web/webgpu`.
- Only `ort-wasm-simd-threaded.asyncify.mjs` and `.asyncify.wasm` are shipped; they are copied from `node_modules` at build time, not committed.
- No server-side processing; nothing leaves the browser except model downloads from huggingface.co.
- Headers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`.
- Model URLs (all `https://huggingface.co/…`):
  - `robertwt7/bg-remover-models/resolve/main/onnx/u2netp.onnx`
  - `briaai/RMBG-1.4/resolve/main/onnx/model_fp16.onnx`
  - `onnx-community/BEN2-ONNX/resolve/main/onnx/model_fp16.onnx`
- Keep the existing brutalist look; no visual redesign.
- `tsconfig.json` has `noUnusedLocals`/`noUnusedParameters`; `npm run build` must stay clean.

## Review Focus

1. **Non-square and large photos** (e.g. 6000×4000): the mask must be stretched back to the original aspect ratio and the output must keep the original pixel dimensions. Test in Task 2 (`composeAlpha` dimensions) and Task 3 (cleanup on a non-square buffer).
2. **WebGPU missing or failing at run time:** the job must finish on WASM and report `backend: 'wasm'`, not error out. Test in Task 4 (`runWithFallback`).
3. **Model download fails** (offline, HTTP 4xx/5xx, no `Content-Length`): a readable error reaches the status card, nothing is written to the cache, progress doesn't show `NaN`. Test in Task 4 (`fetchModel`).
4. **A new image or tier is chosen while a job is running:** the older job's result must never replace the newer one. Test in Task 5 (client job ids).
5. **Flat masks** (image with no detectable subject, min == max): no division by zero, output is fully transparent or fully opaque, never `NaN`. Test in Task 2.

---

### Task 1: Tooling and runtime setup

**Files:**
- Modify: `package.json`, `copy_files.js`, `vite.config.ts`, `nginx.conf`, `.gitignore`
- Delete: `public/ort-wasm-simd-threaded*.{mjs,wasm}` (all six), `public/test.txt`

- [ ] **Step 1:** `git checkout -b model-refresh`
- [ ] **Step 2:** In `package.json` set `"onnxruntime-web": "1.31.1"`, add devDependency `vitest`, and scripts: `"predev": "node copy_files.js"`, `"prebuild": "node copy_files.js"`, `"test": "vitest run"`. Run `npm install`.
- [ ] **Step 3:** `copy_files.js` copies exactly `ort-wasm-simd-threaded.asyncify.mjs` and `ort-wasm-simd-threaded.asyncify.wasm` from `node_modules/onnxruntime-web/dist` to `public/`, and exits non-zero if either is missing.
- [ ] **Step 4:** `git rm` the six committed ORT files and `public/test.txt`; add `public/ort-wasm-*` to `.gitignore`.
- [ ] **Step 5:** In `vite.config.ts` add the two COOP/COEP headers under both `server.headers` and `preview.headers`, and `worker: { format: 'es' }`. In `nginx.conf` add both headers with `always` at server level **and** inside the static-asset `location` block (nginx drops inherited `add_header` when a block defines its own).
- [ ] **Step 6:** Verify: `npm run build` succeeds and `dist/` contains the two asyncify files. `npm run preview` then `curl -sI localhost:4173/ | grep -i cross-origin` shows both headers.
- [ ] **Step 7:** Commit: `chore: pin onnxruntime-web 1.31.1, add vitest and isolation headers`

### Task 2: Model table and tensor maths

**Files:**
- Create: `src/models.ts`, `src/utils/tensor.ts`, `src/utils/tensor.test.ts`

**Interfaces — Produces:**

```ts
// src/models.ts
export type TierId = 'fast' | 'balanced' | 'high';
export type Backend = 'webgpu' | 'wasm';
export type MaskPost = 'minmax' | 'clamp';
export interface Tier {
  id: TierId; name: string; hint: string; downloadMB: number;
  url: string; size: number;
  mean: [number, number, number]; std: [number, number, number];
  post: MaskPost;
}
export const TIERS: Record<TierId, Tier>;
export const TIER_ORDER: TierId[]; // ['fast', 'balanced', 'high']

// src/utils/tensor.ts
export function toCHW(rgba: Uint8ClampedArray, size: number, mean: number[], std: number[]): Float32Array;
export function maskToAlpha(mask: ArrayLike<number>, post: MaskPost): Uint8ClampedArray;
```

Tier values:

| id | name | size | mean | std | post | downloadMB |
|---|---|---|---|---|---|---|
| fast | `Fast (u2netp)` | 320 | 0.485, 0.456, 0.406 | 0.229, 0.224, 0.225 | minmax | 5 |
| balanced | `Balanced (RMBG-1.4)` | 1024 | 0.5, 0.5, 0.5 | 1, 1, 1 | minmax | 88 |
| high | `High (BEN2)` | 1024 | 0.485, 0.456, 0.406 | 0.229, 0.224, 0.225 | clamp | 219 |

`hint` is one short line per tier for the selector, e.g. `Quick web images`, `General use`, `Best edges · slow without a GPU`.

- [ ] **Step 1: Write failing tests** in `src/utils/tensor.test.ts`:

```ts
it('toCHW normalises and splits channels', () => {
  const one = toCHW(new Uint8ClampedArray([255, 0, 51, 255]), 1, [0.5, 0.5, 0.5], [1, 1, 1]);
  expect(Array.from(one)).toEqual([0.5, -0.5, expect.closeTo(-0.3, 5)]);
});
it('toCHW lays out planes R,G,B for a 2x2 image', () => {
  const px = [10, 20, 30, 255]; const rgba = new Uint8ClampedArray([...px, ...px, ...px, ...px]);
  const t = toCHW(rgba, 2, [0, 0, 0], [1, 1, 1]);
  expect(t.length).toBe(12);
  expect(t[0]).toBeCloseTo(10 / 255); expect(t[4]).toBeCloseTo(20 / 255); expect(t[8]).toBeCloseTo(30 / 255);
});
it('maskToAlpha minmax stretches to 0..255', () => {
  expect(Array.from(maskToAlpha([0.2, 0.4, 0.6], 'minmax'))).toEqual([0, 128, 255]);
});
it('maskToAlpha clamp keeps values and clips', () => {
  expect(Array.from(maskToAlpha([-0.5, 0.5, 1.5], 'clamp'))).toEqual([0, 128, 255]);
});
it('maskToAlpha handles a flat mask without NaN', () => {
  expect(Array.from(maskToAlpha([0.7, 0.7], 'minmax'))).toEqual([179, 179]); // falls back to clamp when max == min
});
```

- [ ] **Step 2:** `npm test` → FAIL (modules missing).
- [ ] **Step 3:** Implement `src/models.ts` and `src/utils/tensor.ts` to the signatures above. `maskToAlpha` rounds with `Math.round(v * 255)`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `feat: tier table and tensor helpers`

### Task 3: Edge cleanup

**Files:**
- Create: `src/utils/edgeCleanup.ts`, `src/utils/edgeCleanup.test.ts`

**Interfaces — Produces:**

```ts
/** Replaces the colour of semi-transparent pixels with an estimate of the pure
 *  foreground colour, in place. `alpha` has one byte per pixel. Pixels with
 *  alpha 0 or 255 are left untouched. */
export function cleanEdges(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, width: number, height: number): void;
```

Algorithm: one pass of blur-fusion foreground estimation (Forte & Pitié, "Approximate Fast Foreground Colour Estimation", 2021). With `a = alpha/255`, box blur radius `r = max(2, round(max(width, height) / 100))`, computed with summed-area tables so cost is linear in pixels:

```
F = blur(I·a) / (blur(a) + ε)
B = blur(I·(1−a)) / (blur(1−a) + ε)
F' = clamp(F + a·(I − a·F − (1−a)·B), 0, 255)
```

Write `F'` only where `0 < alpha < 255`.

- [ ] **Step 1: Write failing tests:**

```ts
// 40x10 image: left 15 columns pure red opaque, right 15 pure green transparent,
// 10 columns between: linear alpha ramp, colour = red·a + green·(1−a).
it('pulls edge colours toward the foreground', () => {
  const { rgba, alpha, w, h, before } = makeRamp(40, 10);
  cleanEdges(rgba, alpha, w, h);
  const i = (5 * w + 20) * 4;               // middle of the ramp
  expect(rgba[i + 1]).toBeLessThan(before[i + 1] * 0.5); // green contamination at least halved
  expect(rgba[i]).toBeGreaterThan(before[i]);            // more red
});
it('leaves fully opaque and fully transparent pixels untouched', () => {
  const { rgba, alpha, w, h, before } = makeRamp(40, 10);
  cleanEdges(rgba, alpha, w, h);
  for (const x of [2, 37]) { const i = (5 * w + x) * 4; expect([...rgba.slice(i, i + 3)]).toEqual([...before.slice(i, i + 3)]); }
});
it('works on a non-square buffer and never produces NaN', () => {
  const { rgba, alpha } = makeRamp(64, 7);
  cleanEdges(rgba, alpha, 64, 7);
  expect(rgba.every((v) => Number.isFinite(v))).toBe(true);
});
```

`makeRamp(w, h)` is a helper in the test file building the image described in the comment, scaling the three zones proportionally to `w`.

- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `cleanEdges`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `feat: foreground colour cleanup for soft edges`

### Task 4: Model cache and backend fallback

**Files:**
- Create: `src/worker/modelCache.ts`, `src/worker/fallback.ts`, and a `.test.ts` beside each

**Interfaces — Produces:**

```ts
// modelCache.ts — cache name 'removebg-models-v1'
export async function fetchModel(
  url: string,
  onProgress: (fraction: number | null) => void,   // null when total size is unknown
  deps?: { caches?: CacheStorage; fetch?: typeof fetch },
): Promise<ArrayBuffer>;

// fallback.ts
export async function runWithFallback<T>(
  backends: Backend[],                 // e.g. ['webgpu', 'wasm'] or ['wasm']
  attempt: (backend: Backend) => Promise<T>,
): Promise<{ result: T; backend: Backend }>;
```

`fetchModel`: return the cached body if present; otherwise stream the download, report progress, and store it only after the full body arrived with an OK status. Throws `Error('Model download failed (HTTP <status>)')` on a non-OK response. Works when Cache Storage is unavailable (just downloads).

`runWithFallback`: tries backends in order; on a throw, logs a warning and tries the next; rethrows the last error if all fail.

- [ ] **Step 1: Write failing tests** (fake `caches`/`fetch` passed through `deps`):
  - `fetchModel` returns cached bytes without calling `fetch`.
  - On a miss it calls `fetch`, reports a final progress of `1`, and stores the response under the URL.
  - HTTP 404 → rejects with `Model download failed (HTTP 404)` and `cache.put` was not called.
  - Missing `Content-Length` → every progress call receives `null`, never `NaN`.
  - `runWithFallback(['webgpu','wasm'], …)` with a WebGPU attempt that throws → resolves `{ backend: 'wasm' }` and called attempt twice.
  - `runWithFallback(['wasm'], …)` that throws → rejects with that error.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit: `feat: persistent model cache and backend fallback`

### Task 5: Inference worker and client

**Files:**
- Create: `src/worker/inference.worker.ts`, `src/inferenceClient.ts`, `src/inferenceClient.test.ts`
- Delete: `src/utils/onnxHelper.ts`, `src/utils/imageProcessing.ts` (after Task 6 no longer imports them; delete in Task 6 if the build needs them until then)

**Interfaces — Consumes:** `TIERS`, `toCHW`, `maskToAlpha`, `cleanEdges`, `fetchModel`, `runWithFallback`.

**Interfaces — Produces:**

```ts
// messages
type Request  = { id: number; tier: TierId; bitmap: ImageBitmap };
type Response =
  | { id: number; type: 'status'; text: string; progress: number | null }
  | { id: number; type: 'done'; blob: Blob; backend: Backend; inferenceMs: number }
  | { id: number; type: 'error'; message: string };

// src/inferenceClient.ts
export interface RemoveResult { blob: Blob; backend: Backend; inferenceMs: number }
export function removeBackground(
  file: File, tier: TierId,
  onStatus: (text: string, progress: number | null) => void,
): Promise<RemoveResult>;                       // rejects with Error('superseded') if a newer call started
export function createClient(worker: Pick<Worker, 'postMessage' | 'addEventListener'>,
  toBitmap: (f: File) => Promise<ImageBitmap>): { removeBackground: typeof removeBackground };
```

Worker behaviour:
- `ort.env.wasm.wasmPaths = '/'`; `numThreads = crossOriginIsolated ? min(hardwareConcurrency, 8) : 1`.
- Backends to try: `['webgpu', 'wasm']` if `navigator.gpu.requestAdapter()` yields an adapter, else `['wasm']`.
- Keeps one session, keyed by tier + backend; releases the old one before creating another. A WebGPU failure during `run` also falls back (the fallback wraps create **and** run).
- Pipeline per request: draw bitmap to an `OffscreenCanvas` of `tier.size`² with high smoothing → `toCHW` → run (input tensor float32; if `session.inputMetadata[0].type === 'float16'`, convert) → `maskToAlpha` → scale the mask to the bitmap's size on a canvas → read the scaled alpha → `cleanEdges` on the full-size pixels → write alpha → `convertToBlob({ type: 'image/png' })`.
- Status texts: `Downloading model…` (with progress), `Preparing model…`, `Removing background…`.
- Requests are processed one at a time; a newer request waits for the running one.

Client behaviour: a module-level singleton builds the worker with `new Worker(new URL('./worker/inference.worker.ts', import.meta.url), { type: 'module' })`; `createClient` exists so the job-id logic is testable with a fake worker. Each call gets an incrementing id; messages for older ids are ignored and the older promise rejects with `Error('superseded')`.

- [ ] **Step 1: Write failing tests** in `src/inferenceClient.test.ts` using a fake worker:
  - A `done` message resolves the matching call with `{ blob, backend, inferenceMs }`.
  - `status` messages reach `onStatus` with text and progress.
  - An `error` message rejects with that message.
  - Starting call B while A is pending: A rejects with `superseded`; a late `done` for A does not resolve B and does not call B's `onStatus`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement the client, then the worker.
- [ ] **Step 4:** `npm test` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5:** Commit: `feat: inference worker with WebGPU and WASM fallback`

### Task 6: UI wiring, cleanup and docs

**Files:**
- Modify: `src/App.tsx`, `src/components/ModelSelector.tsx`, `README.md`
- Delete: `src/utils/onnxHelper.ts`, `src/utils/imageProcessing.ts`

**Interfaces — Consumes:** `TIERS`, `TIER_ORDER`, `TierId`, `removeBackground`, `RemoveResult`.

- [ ] **Step 1:** `ModelSelector` lists `TIER_ORDER`, showing `name`, `hint` and `~<downloadMB> MB` per button; props change to `TierId`.
- [ ] **Step 2:** `App.tsx`: replace the load/process/apply sequence with one `removeBackground` call. Ignore `superseded` rejections silently. The result image and download link use an object URL made from the blob; revoke the previous result URL and the previous original-image URL when replaced or cleared. Status card shows `Done in <ms> ms · GPU` or `· CPU`. The progress bar shows only while progress is a number. Tier buttons stay enabled during processing (the client handles superseding); default selected tier is `balanced`.
- [ ] **Step 3:** Delete the two old utils; `npm run build` and `npm test` pass.
- [ ] **Step 4:** README: replace the model table and tech-stack model list with the three tiers, mention WebGPU with CPU fallback and the BEN2 source repo; remove the claim of five models.
- [ ] **Step 5: End-to-end check on WASM.** `npm run preview`, then drive headless Chrome over the DevTools protocol (set the file input to a test photo, select each tier in turn) and confirm for all three tiers: a result image appears, its natural size equals the input's, it has both transparent and opaque pixels, and no console errors. Use a non-square test photo.
- [ ] **Step 6:** Commit: `feat: three-tier UI on the new inference worker`
- [ ] **Step 7:** Hand to Chris for the WebGPU check in his own browser (all three tiers, status shows GPU, timings in the range of the spec's table).
