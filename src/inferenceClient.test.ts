import { describe, expect, it, vi } from 'vitest';
import { createClient } from './inferenceClient';
import type { WorkerResponse } from './worker/protocol';

function setup() {
    const listeners: ((ev: { data: WorkerResponse }) => void)[] = [];
    const posted: { id: number; tier: string }[] = [];
    const worker = {
        postMessage: (msg: { id: number; tier: string }) => { posted.push(msg); },
        addEventListener: (type: string, fn: (ev: { data: WorkerResponse }) => void) => {
            if (type === 'message') listeners.push(fn);
        },
    };
    const emit = (data: WorkerResponse) => listeners.forEach((fn) => fn({ data }));
    const bitmap = {} as ImageBitmap;
    const client = createClient(worker, async () => bitmap);
    const file = {} as File;
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return { client, emit, posted, file, flush };
}

describe('inference client', () => {
    it('resolves with the worker result', async () => {
        const { client, emit, posted, file, flush } = setup();
        const p = client.removeBackground(file, 'fast', () => {});
        await flush();
        expect(posted[0].tier).toBe('fast');
        const blob = new Blob(['x']);
        emit({ id: posted[0].id, type: 'done', blob, backend: 'wasm', inferenceMs: 42 });
        await expect(p).resolves.toEqual({ blob, backend: 'wasm', inferenceMs: 42 });
    });

    it('forwards status updates', async () => {
        const { client, emit, posted, file, flush } = setup();
        const onStatus = vi.fn();
        const p = client.removeBackground(file, 'high', onStatus);
        await flush();
        emit({ id: posted[0].id, type: 'status', text: 'Downloading model…', progress: 0.25 });
        expect(onStatus).toHaveBeenCalledWith('Downloading model…', 0.25);
        emit({ id: posted[0].id, type: 'error', message: 'boom' });
        await expect(p).rejects.toThrow('boom');
    });

    it('rejects an older call as superseded and ignores its late messages', async () => {
        const { client, emit, posted, file, flush } = setup();
        const statusB = vi.fn();
        const a = client.removeBackground(file, 'fast', () => {});
        await flush();
        const b = client.removeBackground(file, 'balanced', statusB);
        await expect(a).rejects.toThrow('superseded');
        await flush();
        const [idA, idB] = posted.map((m) => m.id);

        const late = new Blob(['old']);
        emit({ id: idA, type: 'status', text: 'old', progress: null });
        emit({ id: idA, type: 'done', blob: late, backend: 'wasm', inferenceMs: 1 });
        expect(statusB).not.toHaveBeenCalled();

        const fresh = new Blob(['new']);
        emit({ id: idB, type: 'done', blob: fresh, backend: 'webgpu', inferenceMs: 2 });
        expect((await b).blob).toBe(fresh);
    });

    it('supersedes a call that is still decoding its image', async () => {
        const { client, posted, file, flush } = setup();
        const a = client.removeBackground(file, 'fast', () => {});
        const b = client.removeBackground(file, 'high', () => {});
        await expect(a).rejects.toThrow('superseded');
        await flush();
        expect(posted.map((m) => m.tier)).toEqual(['high']);
        void b;
    });
});
