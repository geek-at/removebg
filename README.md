# RemoveBG PWA 🎨

A privacy-first, local background remover PWA using ONNX Runtime Web. Remove backgrounds from images entirely in your browser - no data ever leaves your device!

> **Note:** This whole project was vibe coded with AI assistance, not a single line of code was written by me ✨

## ✨ Features

- **🔒 100% Local Processing**: All image processing happens in your browser
- **🚫 No Server Required**: No uploads, no tracking, complete privacy
- **🤖 3 Quality Tiers**: From a 5 MB fast model to BEN2 for the best edges
- **⚡ WebGPU**: Runs on your GPU when available, with a CPU fallback
- **📱 PWA**: Install as an app, works offline after first load
- **🎨 Modern Brutalist UI**: Bold, high-contrast design

![Screenshot of the page](https://pictshare.net/f89f0n.png)

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
npm run preview
```

## 🤖 Quality Tiers

| Tier | Model | Download | Best For |
|------|-------|----------|----------|
| **Fast** | u2netp | ~5 MB | Quick cut-outs for small web images |
| **Balanced** | RMBG-1.4 | ~88 MB | General use |
| **High** | BEN2 | ~219 MB | Best edges and hair; slow without a GPU |

Models run on your GPU through WebGPU when the browser supports it and fall back
to multi-threaded WebAssembly on the CPU otherwise. Each model is downloaded once
and then kept in the browser's cache storage.

## 🛠️ Tech Stack

- **Frontend**: React + TypeScript + Vite
- **AI Runtime**: ONNX Runtime Web (WebGPU with WebAssembly fallback), running in a Web Worker
- **Models**: 
  - u2netp from [bg-remover-models](https://huggingface.co/robertwt7/bg-remover-models)
  - RMBG-1.4 from [briaai](https://huggingface.co/briaai/RMBG-1.4) (non-commercial licence)
  - BEN2 from [onnx-community](https://huggingface.co/onnx-community/BEN2-ONNX)
- **Tests**: Vitest (`npm test`)
- **PWA**: vite-plugin-pwa
- **Icons**: lucide-react

## 🎯 How It Works

1. **Select a quality tier** based on your speed/quality needs
2. **Upload or drag & drop** an image
3. **Wait for processing** (models download on first use)
4. **Download** your image with transparent background!

## 🔧 Development

Each tier carries its own preprocessing in `src/models.ts` (input size, mean/std,
mask post-processing). Inference runs in `src/worker/inference.worker.ts`; after
the mask is applied, soft edge pixels get a foreground colour cleanup so the old
background doesn't show as a halo.

Multi-threaded WebAssembly needs cross-origin isolation, so the server must send
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless`. The included `nginx.conf` and the
Vite dev server already do.

## 📦 Building

```bash
npm run build
```

The built app will be in the `dist` directory. Deploy it to any static hosting service that can send the two headers above (without them it still works, but single-threaded on CPU).

## 🐳 Docker

### Using Pre-built Image

```bash
docker pull ghcr.io/geek-at/removebg:latest
docker run -p 8080:80 ghcr.io/geek-at/removebg:latest
```

Then open http://localhost:8080

### Building Locally

```bash
docker build -t removebg .
docker run -p 8080:80 removebg
```

### GitHub Actions

The project includes a GitHub Actions workflow that automatically builds and pushes a Docker image to GitHub Container Registry (ghcr.io) on every push to main/master.

To use it:
1. Push your code to GitHub
2. The workflow will automatically build and push the image
3. Pull and run the image from `ghcr.io/geek-at/removebg:latest`

## 🌐 Browser Support

Works in all modern browsers that support:
- WebAssembly
- WebGPU (optional, for GPU speed)
- ES2020
- Service Workers (for PWA features)

## 📄 License

MIT

---

**Made with ✨ vibe coding**
