import type { Song } from '/@/shared/types/domain-types';

// BolBeats: "let BolBeats pick" - finds the best parts of every song in a playlist (the hook, plus any other section
// that sounds different and stands out nearly as much) and makes a best-parts playlist from them, for listeners who
// love the songs but don't want to mix. Songs that already have parts keep them.
import { nanoid } from 'nanoid/non-secure';

import { snapQuiet, toMono } from '/@/renderer/features/best-parts/engine/engine';
import { suggestHooksAsync } from '/@/renderer/features/best-parts/engine/hook-async';
import {
    analyzeBuffer,
    autoOrder,
    decodeSong,
    slice,
} from '/@/renderer/features/best-parts/mix-player';
import {
    type BestPart,
    partsOfSong,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';

const hooksOf = async (song: Song): Promise<BestPart[]> => {
    const buf = await decodeSong(song.id);
    const found = await suggestHooksAsync(buf, 22);
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const mono = toMono(channels, buf.sampleRate);
    return found
        .sort(([a], [b]) => a - b)
        .map(([a, z0], i, all) => {
            // end on a breath too, never shorter than 8 s, never into the next part
            const z = Math.min(
                all[i + 1]?.[0] ?? buf.duration,
                Math.max(a + 8, snapQuiet(mono.x, mono.sr, z0)),
            );
            return {
                album: song.album,
                analysis: analyzeBuffer(slice(buf, a, z)),
                artist: song.artistName,
                created: Date.now() + i,
                end: Math.min(z, buf.duration),
                id: nanoid(),
                imageUrl: song.imageUrl,
                songDuration: buf.duration,
                songId: song.id,
                start: a,
                title: song.name,
            };
        });
};

// Returns the part ids in a smooth play order. onStep reports progress; cancelled() stops early.
// BolBeats: two songs at a time (decoding and the finder both run off the main thread); parts keep playlist order.
export const pickHooks = async (
    songs: Song[],
    onStep: (done: number, song: Song) => void,
    cancelled: () => boolean,
): Promise<{ failed: Song[]; partIds: string[] }> => {
    const found: BestPart[][] = [];
    const failed: Song[] = [];
    let next = 0;
    let done = 0;
    const lane = async () => {
        while (next < songs.length && !cancelled()) {
            const i = next++;
            const song = songs[i];
            onStep(done, song);
            const have = partsOfSong(song.id);
            if (have.length) found[i] = have;
            else {
                try {
                    const parts = await hooksOf(song);
                    for (const p of parts) useBestPartsStore.getState().savePart(p);
                    found[i] = parts;
                } catch {
                    failed.push(song);
                }
            }
            done++;
            await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint between songs
        }
    };
    await Promise.all([lane(), lane()]);
    return { failed, partIds: autoOrder(found.flat().filter(Boolean)) };
};
