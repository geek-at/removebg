import * as ort from 'onnxruntime-web';

export const processImage = async (
    file: File,
    targetSize: number
): Promise<{ tensor: ort.Tensor; originalImage: HTMLImageElement }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = targetSize;
            canvas.height = targetSize;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // Resize image to target size
            ctx.drawImage(img, 0, 0, targetSize, targetSize);

            const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
            const { data } = imageData;

            // Preprocess: Normalize to 0-1 range (and potentially standard deviation if needed by specific models)
            // u2netp and silueta usually expect 0-1 or specific mean/std.
            // RMBG usually expects 0-1.
            // Most generic background removal models trained on general datasets work well with simple 0-1 normalization.
            // Or sometimes (value - mean) / std.
            // For u2netp: (x/255 - 0.485) / 0.229 ... (ImageNet stats)
            // Let's implement standard ImageNet normalization as it's common for these models.

            const input = new Float32Array(3 * targetSize * targetSize);

            // Mean and Std for ImageNet
            const mean = [0.485, 0.456, 0.406];
            const std = [0.229, 0.224, 0.225];

            for (let i = 0; i < targetSize * targetSize; i++) {
                const r = data[i * 4] / 255;
                const g = data[i * 4 + 1] / 255;
                const b = data[i * 4 + 2] / 255;

                // CHW format
                input[i] = (r - mean[0]) / std[0];
                input[i + targetSize * targetSize] = (g - mean[1]) / std[1];
                input[i + 2 * targetSize * targetSize] = (b - mean[2]) / std[2];
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
    // maskTensor is usually 1x1xHxW or 1x1xHxW with values 0-1 (probability)
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

    // We need to resize the mask to the original image size
    // Since doing bicubic interpolation in JS is slow, we can draw the mask on a small canvas and scale it up

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = targetSize;
    maskCanvas.height = targetSize;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) throw new Error('Could not get mask context');

    const maskImgData = maskCtx.createImageData(targetSize, targetSize);

    // Find min/max of mask to normalize if needed, but usually it's sigmoid output 0-1
    // Some models output logits. u2netp outputs logits. We need sigmoid.
    // Let's assume we need to apply sigmoid if values are outside 0-1 range significantly?
    // Actually u2netp output is usually logits.

    for (let i = 0; i < maskData.length; i++) {
        let val = maskData[i];
        // Sigmoid if needed. How to detect?
        // If we see negative values, it's likely logits.
        // Simple sigmoid: 1 / (1 + exp(-x))
        // Optimization: check range.

        // For safety, let's apply sigmoid if it looks like logits (e.g. < -1 or > 1)
        // But u2netp output can be large.
        // Let's just apply sigmoid always? No, if it's already 0-1 it will break.
        // RMBG output is 0-1.
        // u2netp is logits.
        // We might need model-specific post-processing.
        // For now, let's clamp 0-1. If it's logits, we need sigmoid.

        // Heuristic: if min < 0 or max > 1.5, apply sigmoid.
    }

    // Let's do a pass to check range
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
        maskImgData.data[pixelIndex] = 0; // R (irrelevant)
        maskImgData.data[pixelIndex + 1] = 0; // G
        maskImgData.data[pixelIndex + 2] = 0; // B
        maskImgData.data[pixelIndex + 3] = val * 255; // Alpha
    }

    maskCtx.putImageData(maskImgData, 0, 0);

    // Now draw the mask onto a temporary canvas scaled to original size
    // using 'destination-in' composite operation to mask the original image?
    // No, we want to use the mask as alpha channel.

    // Better approach:
    // 1. Draw original image on main canvas.
    // 2. Draw mask on a separate canvas, scale it to original size.
    // 3. Get mask data from scaled canvas.
    // 4. Update alpha of main canvas.

    const scaledMaskCanvas = document.createElement('canvas');
    scaledMaskCanvas.width = canvas.width;
    scaledMaskCanvas.height = canvas.height;
    const scaledMaskCtx = scaledMaskCanvas.getContext('2d');
    if (!scaledMaskCtx) throw new Error('No context');

    // Draw the small mask canvas onto the large one (scaling it)
    scaledMaskCtx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height);

    const scaledMaskData = scaledMaskCtx.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < data.length; i += 4) {
        // Apply the mask alpha to the original image alpha
        // The mask is grayscale/alpha. We put the value in Alpha channel of maskImgData.
        // So we read the Alpha channel of scaledMaskData.
        const maskAlpha = scaledMaskData.data[i + 3];

        // Thresholding can be useful for sharp edges, but soft edges are better for hair etc.
        // data[i+3] is original alpha (usually 255).
        data[i + 3] = maskAlpha;
    }

    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
};
