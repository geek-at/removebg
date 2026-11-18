import type { Backend, TierId } from './models';
import type { WorkerRequest, WorkerResponse } from './worker/protocol';

export interface RemoveResult {
    blob: Blob;
    backend: Backend;
    inferenceMs: number;
}

export type StatusHandler = (text: string, progress: number | null) => void;

interface WorkerLike {
    postMessage(message: WorkerRequest, transfer: Transferable[]): void;
    addEventListener(type: string, listener: (ev: any) => void): void;
}

interface Job {
    id: number;
    onStatus: StatusHandler;
    resolve: (r: RemoveResult) => void;
    reject: (e: Error) => void;
}

/**
 * Wraps the inference worker in a promise API. Only the most recent call
 * matters: starting a new one rejects the previous with Error('superseded')
 * and its late messages are dropped.
 */
export function createClient(worker: WorkerLike, toBitmap: (file: File) => Promise<ImageBitmap>) {
    let lastId = 0;
    let job: Job | null = null;

    worker.addEventListener('message', (ev: { data: WorkerResponse }) => {
        const msg = ev.data;
        if (!job || msg.id !== job.id) return;
        if (msg.type === 'status') {
            job.onStatus(msg.text, msg.progress);
            return;
        }
        const finished = job;
        job = null;
        if (msg.type === 'done') {
            finished.resolve({ blob: msg.blob, backend: msg.backend, inferenceMs: msg.inferenceMs });
        } else {
            finished.reject(new Error(msg.message));
        }
    });

    worker.addEventListener('error', (ev: { message?: string }) => {
        job?.reject(new Error(ev.message || 'The background-removal worker crashed'));
        job = null;
    });

    async function removeBackground(file: File, tier: TierId, onStatus: StatusHandler): Promise<RemoveResult> {
        const id = ++lastId;
        job?.reject(new Error('superseded'));
        job = null;

        const bitmap = await toBitmap(file);
        if (id !== lastId) {
            bitmap.close?.();
            throw new Error('superseded');
        }
        return new Promise<RemoveResult>((resolve, reject) => {
            job = { id, onStatus, resolve, reject };
            worker.postMessage({ id, tier, bitmap }, [bitmap]);
        });
    }

    return { removeBackground };
}

let shared: ReturnType<typeof createClient> | null = null;

/** Removes the background of `file` using the app's shared worker. */
export function removeBackground(file: File, tier: TierId, onStatus: StatusHandler): Promise<RemoveResult> {
    if (!shared) {
        const worker = new Worker(new URL('./worker/inference.worker.ts', import.meta.url), { type: 'module' });
        shared = createClient(worker, (f) => createImageBitmap(f));
    }
    return shared.removeBackground(file, tier, onStatus);
}
