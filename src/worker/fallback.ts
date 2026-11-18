import type { Backend } from '../models';

/** Tries each backend in order and reports which one produced the result. */
export async function runWithFallback<T>(
    backends: Backend[],
    attempt: (backend: Backend) => Promise<T>,
): Promise<{ result: T; backend: Backend }> {
    let lastError: unknown = new Error('No backend available');
    for (const backend of backends) {
        try {
            return { result: await attempt(backend), backend };
        } catch (e) {
            lastError = e;
            console.warn(`Backend ${backend} failed`, e);
        }
    }
    throw lastError;
}
