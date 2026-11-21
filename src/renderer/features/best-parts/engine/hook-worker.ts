// BolBeats: finds a song's best parts in a background thread, so the screen never freezes while BolBeats listens.
import { suggestHooks } from './engine';

self.onmessage = (
    e: MessageEvent<{
        channels: Float32Array[];
        len?: number;
        minPart?: number;
        sampleRate: number;
    }>,
) => {
    const { channels, len, minPart, sampleRate } = e.data;
    self.postMessage(suggestHooks(channels, sampleRate, len, minPart));
};
