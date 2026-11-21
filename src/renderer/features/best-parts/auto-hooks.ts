// BolBeats: "let BolBeats pick" - finds the best parts of every song in a playlist (the hook, plus any other section
// that sounds different and stands out nearly as much) and makes a best-parts playlist from them, for listeners who
// love the songs but don't want to mix. Songs that already have parts keep them.
import { nanoid } from 'nanoid/non-secure';

import { snapQuiet, toMono } from '/@/renderer/features/best-parts/engine/engine';
import { suggestHooksAsync } from '/@/renderer/features/best-parts/engine/hook-async';
import { applyLeadIn } from '/@/renderer/features/best-parts/engine/taste-learn';
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
import { learnedTaste, useTaste } from '/@/renderer/features/best-parts/store/taste.store';
import { LibraryItem, type Song } from '/@/shared/types/domain-types';

const hooksOf = async (song: Song): Promise<BestPart[]> => {
    const buf = await decodeSong(song.id);
    const taste = learnedTaste(); // your usual part length and start, once you've edited a few
    const found = await suggestHooksAsync(buf, 22, taste.minPart ?? undefined);
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const mono = toMono(channels, buf.sampleRate);
    const sorted = found.sort(([a], [b]) => a - b);
    // start the way you do (never into the part before), then end each part before the next one starts
    const starts = sorted.map(([a0, z0], i) => {
        const prevEnd = sorted[i - 1]?.[1] ?? 0;
        const [a1] = applyLeadIn([a0, z0], taste.leadIn, prevEnd);
        return taste.leadIn ? Math.max(prevEnd, snapQuiet(mono.x, mono.sr, a1)) : a1;
    });
    return sorted.map(([, z0], i) => {
        const a = starts[i];
        // end on a breath too, never shorter than 8 s, never into the next part
        const z = Math.min(
            starts[i + 1] ?? buf.duration,
            Math.max(a + 8, snapQuiet(mono.x, mono.sr, z0)),
        );
        return {
            album: song.album,
            analysis: analyzeBuffer(slice(buf, a, z)),
            artist: song.artistName,
            auto: true,
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
const SCANNED = 'hookline_scanned_v3'; // v3: parts of 25 s or more (1.3.0), every song is checked once more
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
    // a short old part gives way to its longer find. A part from before parts were tagged (maybe yours) is joined with
    // the find instead, so everything you picked stays in it; parts you made or edited (auto: false) are left alone.
    const longer = new Map<string, BestPart>();
    for (const h of have) {
        if (h.auto === false || h.end - h.start >= 24.5) continue;
        const f = found.find((x) => overlaps(h, x) && x.end - x.start > h.end - h.start);
        if (!f) continue;
        if (h.auto) {
            longer.set(h.id, f);
            continue;
        }
        // joined, up to (never into) the parts next to it
        const others = have.filter((o) => o.id !== h.id);
        const start = Math.max(
            Math.min(h.start, f.start),
            ...others.filter((o) => o.end <= h.start + 0.01).map((o) => o.end),
        );
        const end = Math.min(
            Math.max(h.end, f.end),
            ...others.filter((o) => o.start >= h.end - 0.01).map((o) => o.start),
        );
        if (end - start <= h.end - h.start + 1) continue;
        const buf = await decodeSong(song.id); // just decoded by hooksOf: cached
        longer.set(h.id, { ...f, analysis: analyzeBuffer(slice(buf, start, end)), end, start });
    }
    for (const p of [...fresh, ...longer.values()]) useBestPartsStore.getState().savePart(p);
    markScanned(song.id);
    adopt(song.id, fresh, longer);
    return { fresh, longer };
};

// A song to look at again, from one of its saved parts (enough for decoding and labelling new parts).
export const songOfPart = (p: BestPart) =>
    ({
        _itemType: LibraryItem.SONG,
        album: p.album,
        artistName: p.artist,
        duration: p.songDuration * 1000,
        id: p.songId,
        imageUrl: p.imageUrl,
        name: p.title,
    }) as Song;

// "Re-pick with what BolBeats learned": every part BolBeats found that you haven't rated is found again with your
// learned length and start (parts you made, edited, liked or disliked stay as they are). Returns how many changed.
export const repickAutoParts = async (onStep?: (done: number, total: number) => void) => {
    const open = (p: BestPart) => p.auto === true && !useTaste.getState().votes[p.id];
    const songs = [
        ...new Map(
            Object.values(useBestPartsStore.getState().parts)
                .filter(open)
                .map((p) => [p.songId, p]),
        ).values(),
    ];
    let changed = 0;
    for (const [i, p] of songs.entries()) {
        onStep?.(i, songs.length);
        try {
            const have = partsOfSong(p.songId);
            const found = await hooksOf(songOfPart(p));
            const fresh = found.filter((f) => !have.some((h) => overlaps(h, f)));
            const longer = new Map<string, BestPart>();
            for (const h of have.filter(open)) {
                const f = found.find((x) => overlaps(h, x));
                if (f && (Math.abs(f.start - h.start) > 0.5 || Math.abs(f.end - h.end) > 0.5))
                    longer.set(h.id, f);
            }
            for (const n of [...fresh, ...longer.values()])
                useBestPartsStore.getState().savePart(n);
            adopt(p.songId, fresh, longer);
            changed += fresh.length + longer.size;
        } catch {
            // the song is gone or can't be read: leave its parts
        }
    }
    onStep?.(songs.length, songs.length);
    return changed;
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
