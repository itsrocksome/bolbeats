// BolBeats: finds a song's hook in a background thread, so the screen never freezes while BolBeats listens.
import { suggestHook } from './engine';

self.onmessage = (
    e: MessageEvent<{ channels: Float32Array[]; len?: number; sampleRate: number }>,
) => {
    const { channels, len, sampleRate } = e.data;
    self.postMessage(suggestHook(channels, sampleRate, len));
};
