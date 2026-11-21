// BolBeats: suggestHook off the main thread. Two workers take requests side by side (a playlist's songs are found two
// at a time); if workers aren't available it works in place (slower to paint, same answer).
import HookWorker from './hook-worker?worker&inline';

import { suggestHooks, toMono } from '/@/renderer/features/best-parts/engine/engine';

const POOL = 2;
const idle: Worker[] = [];
const waiting: ((w: Worker) => void)[] = [];
let made = 0;

const take = () =>
    new Promise<Worker>((resolve) => {
        const w = idle.pop() ?? (made < POOL ? (made++, new HookWorker()) : undefined);
        if (w) resolve(w);
        else waiting.push(resolve);
    });
const give = (w: Worker) => {
    const next = waiting.shift();
    if (next) next(w);
    else idle.push(w);
};

const inWorker = async (x: Float32Array, sampleRate: number, len?: number) => {
    const w = await take();
    return new Promise<[number, number][]>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<[number, number][]>) => {
            give(w);
            resolve(e.data);
        };
        w.onerror = (e) => {
            made--;
            w.terminate();
            reject(e);
        };
        w.postMessage({ channels: [x], len, sampleRate }, [x.buffer]);
    });
};

// Every best part of a song, strongest first (see findHooks in engine.ts).
export const suggestHooksAsync = (buf: AudioBuffer, len?: number): Promise<[number, number][]> => {
    // the finder works on mono at ~22 kHz anyway; sending that is a quarter of the stereo song (same answer)
    const { sr, x } = toMono(
        Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)),
        buf.sampleRate,
    );
    return inWorker(x.slice(), sr, len).catch(() => suggestHooks([x], sr, len));
};

// The hook alone.
export const suggestHookAsync = (buf: AudioBuffer, len?: number): Promise<[number, number]> =>
    suggestHooksAsync(buf, len).then((parts) => parts[0]);
