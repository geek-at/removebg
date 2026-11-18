import type { Backend, TierId } from '../models';

export interface WorkerRequest {
    id: number;
    tier: TierId;
    bitmap: ImageBitmap;
}

export type WorkerResponse =
    | { id: number; type: 'status'; text: string; progress: number | null }
    | { id: number; type: 'done'; blob: Blob; backend: Backend; inferenceMs: number }
    | { id: number; type: 'error'; message: string };
