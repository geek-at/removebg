import type { Backend, Tier } from '../models';
import { runWithFallback } from './fallback';

export interface RawMask {
    data: Float32Array;
    width: number;
    height: number;
    inferenceMs: number;
}

export interface SessionLike {
    run(input: Float32Array, size: number): Promise<RawMask>;
    release(): Promise<void>;
}

export interface EngineDeps {
    backends(): Promise<Backend[]>;
    fetchModel(url: string, onProgress: (fraction: number | null) => void, signal: AbortSignal): Promise<ArrayBuffer>;
    createSession(model: ArrayBuffer, backend: Backend): Promise<SessionLike>;
}

export type EngineStatus = (text: string, progress: number | null) => void;

/**
 * Owns the single live model session and decides which backend runs a tier.
 *
 * A backend is only skipped for a tier after its session failed to build or
 * run there; download problems and superseded jobs never count against it.
 */
export function createEngine(deps: EngineDeps) {
    let current: { key: string; session: SessionLike } | null = null;
    const broken = new Set<string>();

    async function dropSession(): Promise<void> {
        const old = current;
        current = null;
        await old?.session.release().catch(() => {});
    }

    async function infer(
        tier: Tier,
        input: Float32Array,
        onStatus: EngineStatus,
        signal: AbortSignal,
    ): Promise<{ mask: RawMask; backend: Backend }> {
        const key = (b: Backend) => `${tier.id}/${b}`;
        const stopIfSuperseded = () => {
            if (signal.aborted) throw new Error('superseded');
        };

        const all = await deps.backends();
        let candidates = all.filter((b) => !broken.has(key(b)));
        if (candidates.length === 0) {
            // Everything failed earlier; give it a fresh chance rather than a dead end.
            all.forEach((b) => broken.delete(key(b)));
            candidates = all;
        }

        let model: ArrayBuffer | null = null;

        const { result, backend } = await runWithFallback(candidates, async (b) => {
            stopIfSuperseded();
            if (current?.key !== key(b)) {
                await dropSession();
                if (!model || model.byteLength === 0) {
                    onStatus('Downloading model…', null);
                    model = await deps.fetchModel(tier.url, (p) => onStatus('Downloading model…', p), signal);
                }
                stopIfSuperseded();
                onStatus('Preparing model…', null);
                try {
                    current = { key: key(b), session: await deps.createSession(model, b) };
                } catch (e) {
                    broken.add(key(b));
                    throw e;
                }
            }
            stopIfSuperseded();
            onStatus('Removing background…', null);
            try {
                return await current!.session.run(input, tier.size);
            } catch (e) {
                broken.add(key(b));
                await dropSession();
                throw e;
            }
        });
        return { mask: result, backend };
    }

    return { infer };
}
