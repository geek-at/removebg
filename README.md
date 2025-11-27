# RemoveBG PWA

A privacy-first, local background remover PWA using ONNX Runtime Web.

## Features
- **Privacy First**: No data leaves your device.
- **Offline Capable**: Works without internet after initial load.
- **High Quality Models**: Supports RMBG-1.4, U2Net, and Silueta.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

## Models
- **Fast (u2netp)**: Fastest, lower quality.
- **Balanced (silueta)**: Good balance.
- **Ultra (RMBG-1.4)**: Best quality, larger download.

## License
MIT
