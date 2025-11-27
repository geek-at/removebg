import * as ort from 'onnxruntime-web';

export const processImage = async (
    file: File,
    targetSize: number,
    modelType: 'u2netp' | 'silueta' | 'rmbg'
): Promise<{ tensor: ort.Tensor; originalImage: HTMLImageElement }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // Resize to target size (all models)
            canvas.width = targetSize;
            canvas.height = targetSize;
            ctx.drawImage(img, 0, 0, targetSize, targetSize);

            const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
            const { data } = imageData;

            const input = new Float32Array(3 * targetSize * targetSize);

            if (modelType === 'rmbg') {
                // RMBG models: simple 0-1 normalization
                for (let i = 0; i < targetSize * targetSize; i++) {
                    const r = data[i * 4] / 255;
                    const g = data[i * 4 + 1] / 255;
                    const b = data[i * 4 + 2] / 255;

                    // CHW format
                    input[i] = r;
                    input[i + targetSize * targetSize] = g;
                    input[i + 2 * targetSize * targetSize] = b;
                }
            } else {
                // u2netp and silueta: ImageNet normalization
                const mean = [0.485, 0.456, 0.406];
                const std = [0.229, 0.224, 0.225];

                for (let i = 0; i < targetSize * targetSize; i++) {
                    const r = data[i * 4] / 255;
                    const g = data[i * 4 + 1] / 255;
                    const b = data[i * 4 + 2] / 255;

                    // CHW format with ImageNet normalization
                    input[i] = (r - mean[0]) / std[0];
                    input[i + targetSize * targetSize] = (g - mean[1]) / std[1];
                    input[i + 2 * targetSize * targetSize] = (b - mean[2]) / std[2];
                }
            }

            const tensor = new ort.Tensor('float32', input, [1, 3, targetSize, targetSize]);
            resolve({ tensor, originalImage: img });
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
};

export const applyMask = (
    originalImage: HTMLImageElement,
    maskTensor: ort.Tensor,
    targetSize: number
): string => {
    const maskData = maskTensor.data as Float32Array;

    const canvas = document.createElement('canvas');
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get context');

    // Draw original image
    ctx.drawImage(originalImage, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = targetSize;
    maskCanvas.height = targetSize;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error('Could not get mask context');

    const maskImgData = maskCtx.createImageData(targetSize, targetSize);

    // Check if we need to apply sigmoid (for models that output logits)
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < maskData.length; i++) {
        if (maskData[i] < min) min = maskData[i];
        if (maskData[i] > max) max = maskData[i];
    }

    const needsSigmoid = min < -0.1 || max > 1.1;

    for (let i = 0; i < maskData.length; i++) {
        let val = maskData[i];
        if (needsSigmoid) {
            val = 1 / (1 + Math.exp(-val));
        }

        const pixelIndex = i * 4;
        maskImgData.data[pixelIndex] = 0;
        maskImgData.data[pixelIndex + 1] = 0;
        maskImgData.data[pixelIndex + 2] = 0;
        maskImgData.data[pixelIndex + 3] = val * 255;
    }

    maskCtx.putImageData(maskImgData, 0, 0);

    // Scale mask to original image size
    const scaledMaskCanvas = document.createElement('canvas');
    scaledMaskCanvas.width = canvas.width;
    scaledMaskCanvas.height = canvas.height;
    const scaledMaskCtx = scaledMaskCanvas.getContext('2d');
    if (!scaledMaskCtx) throw new Error('No context');

    scaledMaskCtx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

    const scaledMaskData = scaledMaskCtx.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < data.length; i += 4) {
        const maskAlpha = scaledMaskData.data[i + 3];
        data[i + 3] = maskAlpha;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
};
