import fs from 'fs';
import path from 'path';

const srcDir = path.join('node_modules', 'onnxruntime-web', 'dist');
const destDir = 'public';

const files = [
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.jsep.wasm'
];

console.log(`Copying from ${srcDir} to ${destDir}`);

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
}

files.forEach(file => {
    try {
        const src = path.join(srcDir, file);
        const dest = path.join(destDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            console.log(`Copied ${file}`);
        } else {
            console.error(`Source file not found: ${src}`);
        }
    } catch (e) {
        console.error(`Failed to copy ${file}:`, e);
    }
});
