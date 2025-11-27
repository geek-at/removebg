# RemoveBG PWA 🎨

A privacy-first, local background remover PWA using ONNX Runtime Web. Remove backgrounds from images entirely in your browser - no data ever leaves your device!

> **Note:** This whole project was vibe coded with AI assistance, not a single line of code was written by me ✨

## ✨ Features

- **🔒 100% Local Processing**: All image processing happens in your browser using WebAssembly
- **🚫 No Server Required**: No uploads, no tracking, complete privacy
- **🤖 5 AI Models**: Choose from fast to ultra-quality background removal
- **📱 PWA**: Install as an app, works offline after first load
- **🎨 Modern Brutalist UI**: Bold, high-contrast design

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

## 🤖 Available Models

| Model | Speed | Quality | Size | Best For |
|-------|-------|---------|------|----------|
| **Fast (u2netp)** | ⚡⚡⚡ | ⭐⭐ | 320x320 | Quick previews |
| **Balanced (silueta)** | ⚡⚡ | ⭐⭐⭐ | 320x320 | General use |
| **Ultra Quant (RMBG)** | ⚡ | ⭐⭐⭐⭐ | 1024x1024 | High quality, faster |
| **Ultra FP16 (RMBG)** | ⚡ | ⭐⭐⭐⭐⭐ | 1024x1024 | Best quality/speed |
| **Ultra Full (RMBG)** | 🐌 | ⭐⭐⭐⭐⭐ | 1024x1024 | Maximum quality |

## 🛠️ Tech Stack

- **Frontend**: React + TypeScript + Vite
- **AI Runtime**: ONNX Runtime Web (WebAssembly)
- **Models**: 
  - u2netp & silueta from [bg-remover-models](https://huggingface.co/robertwt7/bg-remover-models)
  - RMBG-1.4 from [briaai](https://huggingface.co/briaai/RMBG-1.4)
- **PWA**: vite-plugin-pwa
- **Icons**: lucide-react

## 🎯 How It Works

1. **Select a model** based on your speed/quality needs
2. **Upload or drag & drop** an image
3. **Wait for processing** (models download on first use)
4. **Download** your image with transparent background!

## 🔧 Development

The app uses model-specific preprocessing:
- **RMBG models**: Simple 0-1 normalization
- **u2netp/silueta**: ImageNet normalization (mean/std)

All processing happens client-side using WebAssembly for maximum performance and privacy.

## 📦 Building

```bash
npm run build
```

The built app will be in the `dist` directory. Deploy it to any static hosting service!

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
3. Pull and run the image from `ghcr.io/YOUR_USERNAME/removebg:latest`

## 🌐 Browser Support

Works in all modern browsers that support:
- WebAssembly
- ES2020
- Service Workers (for PWA features)

## 📄 License

MIT

---

**Made with ✨ vibe coding**
