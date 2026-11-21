import type { Song } from '/@/shared/types/domain-types';

// BolBeats: "let BolBeats pick" - finds the hook of every song in a playlist and makes a best-parts playlist from them,
// for listeners who love the songs but don't want to mix. Songs that already have parts keep them.
import { nanoid } from 'nanoid/non-secure';

import { snapQuiet, toMono } from '/@/renderer/features/best-parts/engine/engine';
import { suggestHookAsync } from '/@/renderer/features/best-parts/engine/hook-async';
import {
    analyzeBuffer,
    decodeSong,
    slice,
    smartOrder,
} from '/@/renderer/features/best-parts/mix-player';
import {
    type BestPart,
    partsOfSong,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';

const hookOf = async (song: Song): Promise<BestPart> => {
    const buf = await decodeSong(song.id);
    const [a, z0] = await suggestHookAsync(buf, 22);
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const mono = toMono(channels, buf.sampleRate);
    const z = Math.max(a + 8, snapQuiet(mono.x, mono.sr, z0)); // end on a breath too, never shorter than 8 s
    return {
        album: song.album,
        analysis: analyzeBuffer(slice(buf, a, z)),
        artist: song.artistName,
        created: Date.now(),
        end: Math.min(z, buf.duration),
        id: nanoid(),
        imageUrl: song.imageUrl,
        songDuration: buf.duration,
        songId: song.id,
        start: a,
        title: song.name,
    };
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
                    const part = await hookOf(song);
                    useBestPartsStore.getState().savePart(part);
                    found[i] = [part];
                } catch {
                    failed.push(song);
                }
            }
            done++;
            await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint between songs
        }
    };
    await Promise.all([lane(), lane()]);
    return { failed, partIds: smartOrder(found.flat().filter(Boolean)) };
};
