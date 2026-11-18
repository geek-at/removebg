// Copies the ONNX Runtime Web wasm binaries the app needs into public/.
// Runs before `npm run dev` and `npm run build`; the copies are not committed.
import fs from 'fs';
import path from 'path';

const srcDir = path.join('node_modules', 'onnxruntime-web', 'dist');
const destDir = 'public';
const files = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

fs.mkdirSync(destDir, { recursive: true });
for (const file of files) {
    const src = path.join(srcDir, file);
    if (!fs.existsSync(src)) {
        console.error(`Missing ${src} - run npm install first.`);
        process.exit(1);
    }
    fs.copyFileSync(src, path.join(destDir, file));
}
console.log(`Copied ${files.length} ONNX Runtime files to ${destDir}/`);
