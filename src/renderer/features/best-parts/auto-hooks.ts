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

// Songs already checked for every best part by this finder (parts made before 1.1 came one per song).
const SCANNED = 'hookline_scanned_v2';
const scannedSongs = (): Record<string, 1> => {
    try {
        return JSON.parse(localStorage.getItem(SCANNED) ?? '{}');
    } catch {
        return {};
    }
};
export const isScanned = (songId: string) => !!scannedSongs()[songId];
const markScanned = (songId: string) => {
    try {
        localStorage.setItem(SCANNED, JSON.stringify({ ...scannedSongs(), [songId]: 1 }));
    } catch {
        // storage blocked: the song is just checked again next time
    }
};
const overlaps = (a: Pick<BestPart, 'end' | 'start'>, b: Pick<BestPart, 'end' | 'start'>) =>
    Math.min(a.end, b.end) - Math.max(a.start, b.start) >
    Math.min(a.end - a.start, b.end - b.start) / 2;

// BolBeats: a song that already has parts gets the ones BolBeats finds that don't overlap them (yours are never
// changed). Returns the new parts and, for each existing part under 15 s that a new longer part covers, its replacement.
export const addMoreParts = async (song: Song) => {
    const have = partsOfSong(song.id);
    const found = await hooksOf(song);
    const fresh = found.filter((f) => !have.some((h) => overlaps(h, f)));
    const longer = new Map<string, BestPart>();
    for (const h of have) {
        const f = found.find(
            (x) => overlaps(h, x) && h.end - h.start < 15 && x.end - x.start > h.end - h.start,
        );
        if (f) longer.set(h.id, f);
    }
    for (const p of [...fresh, ...longer.values()]) useBestPartsStore.getState().savePart(p);
    markScanned(song.id);
    adopt(song.id, fresh, longer);
    return { fresh, longer };
};

// Best-parts playlists BolBeats made (never ones you've changed) take a song's new parts, re-arranged where they fit;
// a short old part is swapped for its longer find everywhere it can be, and deleted once nothing of yours uses it.
const adopt = (songId: string, fresh: BestPart[], longer: Map<string, BestPart>) => {
    const store = useBestPartsStore.getState();
    for (const m of Object.values(store.mixes)) {
        if (!m.auto || !m.partIds.some((id) => store.parts[id]?.songId === songId)) continue;
        const ids = [...m.partIds.map((id) => longer.get(id)?.id ?? id), ...fresh.map((p) => p.id)];
        const parts = [...new Set(ids)]
            .map((id) => useBestPartsStore.getState().parts[id])
            .filter(Boolean);
        store.updateMix(m.id, { auto: true, partIds: autoOrder(parts) });
    }
    const mixes = Object.values(useBestPartsStore.getState().mixes);
    for (const old of longer.keys())
        if (!mixes.some((m) => !m.auto && m.partIds.includes(old))) store.deletePart(old);
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
            try {
                if (!have.length) {
                    const parts = await hooksOf(song);
                    for (const p of parts) useBestPartsStore.getState().savePart(p);
                    markScanned(song.id);
                    found[i] = parts;
                } else {
                    // parts from before: add the ones BolBeats finds now (a short old part gives way to its longer find)
                    const { fresh, longer } = isScanned(song.id)
                        ? { fresh: [], longer: new Map() }
                        : await addMoreParts(song);
                    found[i] = [...have.map((h) => longer.get(h.id) ?? h), ...fresh];
                }
            } catch {
                if (have.length) found[i] = have;
                else failed.push(song);
            }
            done++;
            await new Promise((r) => setTimeout(r, 0)); // let the progress bar paint between songs
        }
    };
    await Promise.all([lane(), lane()]);
    return { failed, partIds: autoOrder(found.flat().filter(Boolean)) };
};
