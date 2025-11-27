import * as ort from 'onnxruntime-web';

// ONNX Runtime will use its bundled WASM files from node_modules

export type ModelType = 'u2netp' | 'silueta' | 'rmbg_quant' | 'rmbg_fp16' | 'rmbg_full';

export interface ModelConfig {
    name: string;
    url: string;
    size: number;
}

export const MODELS: Record<ModelType, ModelConfig> = {
    u2netp: {
        name: 'Fast (u2netp)',
        url: 'https://huggingface.co/robertwt7/bg-remover-models/resolve/main/onnx/u2netp.onnx',
        size: 320
    },
    silueta: {
        name: 'Balanced (silueta)',
        url: 'https://huggingface.co/robertwt7/bg-remover-models/resolve/main/onnx/silueta.onnx',
        size: 320
    },
    rmbg_quant: {
        name: 'Ultra Quant (RMBG)',
        url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx',
        size: 1024
    },
    rmbg_fp16: {
        name: 'Ultra FP16 (RMBG)',
        url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_fp16.onnx',
        size: 1024
    },
    rmbg_full: {
        name: 'Ultra Full (RMBG)',
        url: 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model.onnx',
        size: 1024
    }
};

let session: ort.InferenceSession | null = null;
let currentModel: ModelType | null = null;

export const loadModel = async (modelType: ModelType, onProgress?: (progress: number) => void): Promise<void> => {
    if (session && currentModel === modelType) {
        return;
    }

    // Dispose previous session if exists
    if (session) {
        try {
            // @ts-ignore - release is not always in types but good practice
            session.release();
        } catch (e) {
            console.warn('Failed to release session', e);
        }
        session = null;
    }

    const modelConfig = MODELS[modelType];

    try {
        // We can't easily track download progress with ort.InferenceSession.create directly from URL
        // unless we fetch it manually first.
        // For simplicity, we'll fetch it manually to show progress if needed, or just let ORT handle it.
        // Given the requirement for "no CDNs" (except models), we are fetching from HF.
        // To support progress, we fetch as blob.

        // However, ORT web can take a URL. Let's try fetching manually to support progress bars.

        const response = await fetch(modelConfig.url);
        const reader = response.body?.getReader();
        const contentLength = +response.headers.get('Content-Length')!;

        let receivedLength = 0;
        const chunks = [];

        while (true) {
            const { done, value } = await reader!.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            if (onProgress) {
                onProgress(receivedLength / contentLength);
            }
        }

        const blob = new Blob(chunks);
        const arrayBuffer = await blob.arrayBuffer();

        session = await ort.InferenceSession.create(arrayBuffer, {
            executionProviders: ['wasm'],
        });

        currentModel = modelType;
    } catch (e) {
        console.error('Failed to load model', e);
        throw e;
    }
};

export const runInference = async (inputTensor: ort.Tensor): Promise<ort.Tensor> => {
    if (!session) throw new Error('Model not loaded');

    // Get input name (usually 'input' or 'data')
    const feeds: Record<string, ort.Tensor> = {};
    const inputNames = session.inputNames;
    feeds[inputNames[0]] = inputTensor;

    const results = await session.run(feeds);
    const outputNames = session.outputNames;
    return results[outputNames[0]];
};
