export type TierId = 'fast' | 'balanced' | 'high';
export type Backend = 'webgpu' | 'wasm';

/** How a model's raw output becomes an alpha mask. */
export type MaskPost = 'minmax' | 'clamp';

export interface Tier {
    id: TierId;
    name: string;
    hint: string;
    downloadMB: number;
    url: string;
    /** Square input edge the model expects, in pixels. */
    size: number;
    mean: [number, number, number];
    std: [number, number, number];
    post: MaskPost;
}

const HF = 'https://huggingface.co/';
const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [number, number, number] = [0.229, 0.224, 0.225];

export const TIERS: Record<TierId, Tier> = {
    fast: {
        id: 'fast',
        name: 'Fast (u2netp)',
        hint: 'Quick web images',
        downloadMB: 5,
        url: HF + 'robertwt7/bg-remover-models/resolve/main/onnx/u2netp.onnx',
        size: 320,
        mean: IMAGENET_MEAN,
        std: IMAGENET_STD,
        post: 'minmax',
    },
    balanced: {
        id: 'balanced',
        name: 'Balanced (RMBG-1.4)',
        hint: 'General use',
        downloadMB: 88,
        url: HF + 'briaai/RMBG-1.4/resolve/main/onnx/model_fp16.onnx',
        size: 1024,
        mean: [0.5, 0.5, 0.5],
        std: [1, 1, 1],
        post: 'minmax',
    },
    high: {
        id: 'high',
        name: 'High (BEN2)',
        hint: 'Best edges · slow without a GPU',
        downloadMB: 219,
        url: HF + 'onnx-community/BEN2-ONNX/resolve/main/onnx/model_fp16.onnx',
        size: 1024,
        mean: IMAGENET_MEAN,
        std: IMAGENET_STD,
        post: 'clamp',
    },
};

export const TIER_ORDER: TierId[] = ['fast', 'balanced', 'high'];
