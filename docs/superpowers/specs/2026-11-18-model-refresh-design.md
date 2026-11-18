# Model refresh and WebGPU: design

Date: 2026-11-18

## Intent

The app is a personal tool used at different quality levels: sometimes a
high-quality cut-out of a business portrait, sometimes a quick 400×400 image for
a website. The models and runtime setup date from 2023. Bring both up to date
while keeping selectable quality tiers.

## Goals

- Keep quality tiers; add a clearly better top tier.
- Make every tier faster by using the GPU where available.
- Keep the UI responsive during inference.
- Don't re-download models every session.

## Non-goals (this round)

Batch processing, clipboard paste, before/after slider, PWA offline fixes,
visual redesign.

## Anti-goals

- A tier that is offered but can't run on the current device.
- Any server-side processing; everything stays in the browser.

## Measured constraints (test page, 2026-11-18, ONNX Runtime Web 1.31.1)

Chris's machine: Chrome 157, AMD RDNA 4, 24 threads. Second-run times at 1024px.

| Model | WebGPU | WASM (10 threads, headless) |
|---|---|---|
| u2netp (5 MB, 320px) | 51 ms | ~250 ms |
| RMBG-1.4 fp16 (88 MB) | 134 ms | ~1,900 ms |
| RMBG-1.4 quantized (44 MB) | 1,948 ms | ~1,600 ms |
| BEN2 fp16 (219 MB) | 556 ms | ~13.5 s |
| BiRefNet lite fp16/fp32 | fails | fails (out of memory) |
| BiRefNet portrait fp16 | fails | not tested |

BiRefNet fails on the native WebGPU engine (`maxStorageBuffersPerShaderStage`
exceeded) and on the JSEP engine (`std::bad_alloc` / buffer allocation failure).
It is not usable in the browser today.

RMBG-1.4's preprocessor config specifies mean 0.5, std 1. The current code
only divides by 255, so its input is off by 0.5.

## Approaches considered

1. **Keep the hand-written ONNX Runtime code; add WebGPU, a worker, caching and
   new tiers.** Chosen: small, full control over pre/post-processing, speeds up
   the existing tiers too.
2. **Switch to transformers.js.** Rejected: a rewrite of working code and a
   heavier dependency for a ~580-line app, with less control over the mask.
3. **Only swap models, stay on WASM.** Rejected: the better models don't run on
   WASM at all.

## Design

### Tiers

| Tier | Model | Files |
|---|---|---|
| Fast | u2netp | one file, both backends |
| Balanced | RMBG-1.4 | fp16, both backends (on WASM it is about as fast as the quantized file, so one file suffices) |
| High | BEN2 | fp16, both backends (slow on WASM, ~13 s; the UI says so) |

silueta and RMBG-1.4 quantized/full are removed. Each tier carries its own input size,
mean/std and mask post-processing (min-max or sigmoid) in the model table,
replacing the `startsWith('rmbg')` branching and the sigmoid-guessing heuristic.

### Runtime

- ONNX Runtime Web pinned to 1.31.1, WebGPU bundle; only the wasm files that
  bundle needs are shipped in `public/`.
- Backend: WebGPU if an adapter is available, else WASM. If a WebGPU session
  fails to create or run, retry once on WASM where the tier supports it. The
  active backend is shown in the status card.
- Inference (model load, preprocessing, run) lives in a Web Worker. The main
  thread sends an `ImageBitmap` and tier; the worker reports download progress
  and returns the mask.
- Model files are stored in Cache Storage after download and read from there
  afterwards.
- `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless` in `nginx.conf` and the Vite
  dev/preview server, enabling multi-threaded WASM.

### Output quality

- RMBG-1.4 normalization corrected to mean 0.5.
- Mask upscaled with high-quality smoothing and composited on a canvas.
- Foreground colour cleanup on semi-transparent edge pixels to remove
  background-coloured halos.
- Result produced with `toBlob` and an object URL; object URLs are revoked when
  replaced.

## Left to the builder

- Worker message protocol and file layout.
- The edge-cleanup algorithm (a simple blur-fusion style estimate is enough).
- README update for the new tiers.

## Verification

- `npm run build` passes.
- Each tier produces a correct cut-out in headless Chrome on WASM.
- Chris confirms the WebGPU path and BEN2 quality in his own browser.
