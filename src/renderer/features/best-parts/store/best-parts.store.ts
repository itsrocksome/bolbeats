import type { Analysis, TransitionType } from '/@/renderer/features/best-parts/engine/engine';

// BolBeats: saved best parts and part mixes, kept in IndexedDB on this Mac.
import { del, get, set } from 'idb-keyval';
import { nanoid } from 'nanoid/non-secure';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

import { mixCoverKey, useCovers } from '/@/renderer/features/covers/covers.store';

export type BestPart = {
    album: null | string;
    analysis: Analysis;
    artist: string;
    created: number;
    end: number; // seconds into the song
    id: string;
    imageUrl: null | string;
    songDuration: number; // seconds
    songId: string;
    start: number;
    title: string;
};

// A best-parts playlist (called a "mix" in code).
export type PartMix = {
    auto?: boolean; // BolBeats picked the parts and the order
    created: number;
    id: string;
    name: string;
    partIds: string[]; // play order
    picks: Record<string, TransitionType>; // "partA>partB" -> chosen transition
    sourcePlaylistId?: string; // the full-song playlist this is the best-parts version of
};

type Actions = {
    createMix: (
        name: string,
        partIds: string[],
        extra?: Pick<PartMix, 'auto' | 'sourcePlaylistId'>,
    ) => string;
    deleteMix: (id: string) => void;
    deletePart: (id: string) => void;
    savePart: (part: BestPart) => void;
    setPreset: (index: number, mixId: null | string) => void;
    updateMix: (id: string, patch: Partial<Omit<PartMix, 'id'>>) => void;
};

type State = {
    mixes: Record<string, PartMix>;
    parts: Record<string, BestPart>;
    presets: (null | string)[]; // six car-radio style preset keys -> mix ids
};

export const ALL_PARTS_MIX = 'all';

export const useBestPartsStore = createWithEqualityFn<Actions & State>()(
    persist(
        (setState) => ({
            createMix: (name, partIds, extra) => {
                const id = nanoid();
                setState((s) => ({
                    mixes: {
                        ...s.mixes,
                        [id]: { ...extra, created: Date.now(), id, name, partIds, picks: {} },
                    },
                }));
                return id;
            },
            deleteMix: (id) => {
                useCovers.getState().removeCover(mixCoverKey(id)); // its custom cover goes with it
                setState((s) => {
                    const mixes = { ...s.mixes };
                    delete mixes[id];
                    return { mixes, presets: s.presets.map((p) => (p === id ? null : p)) };
                });
            },
            deletePart: (id) =>
                setState((s) => {
                    const parts = { ...s.parts };
                    delete parts[id];
                    const mixes = Object.fromEntries(
                        Object.entries(s.mixes).map(([k, m]) => [
                            k,
                            { ...m, partIds: m.partIds.filter((p) => p !== id) },
                        ]),
                    );
                    return { mixes, parts };
                }),
            mixes: {},
            parts: {},
            presets: [null, null, null, null, null, null],
            savePart: (part) => setState((s) => ({ parts: { ...s.parts, [part.id]: part } })),
            // one key per playlist: putting it on a key takes it off any other
            setPreset: (index, mixId) =>
                setState((s) => ({
                    presets: s.presets.map((p, i) =>
                        i === index ? mixId : mixId && p === mixId ? null : p,
                    ),
                })),
            updateMix: (id, patch) =>
                setState((s) =>
                    s.mixes[id] ? { mixes: { ...s.mixes, [id]: { ...s.mixes[id], ...patch } } } : s,
                ),
        }),
        {
            name: 'hookline_best_parts',
            partialize: (s) => ({ mixes: s.mixes, parts: s.parts, presets: s.presets }),
            // BolBeats: idb-keyval gives undefined for a missing key; zustand would JSON.parse it and never finish loading
            storage: createJSONStorage(() => ({
                getItem: async (k) => (await get(k)) ?? null,
                removeItem: del,
                setItem: set,
            })),
            version: 1,
        },
    ),
);

// The best-parts version of a playlist, if one was made.
export const mixForPlaylist = (mixes: Record<string, PartMix>, playlistId: string) =>
    Object.values(mixes).find((m) => m.sourcePlaylistId === playlistId);

export const partsOfSong = (songId: string) =>
    Object.values(useBestPartsStore.getState().parts)
        .filter((p) => p.songId === songId)
        .sort((a, b) => a.start - b.start);
