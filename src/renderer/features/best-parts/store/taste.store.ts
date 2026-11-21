// BolBeats: what BolBeats has learned about your taste in best parts (rules in engine/taste-learn.ts). Kept only on this
// Mac, in IndexedDB.
import { del, get, set } from 'idb-keyval';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

import {
    type Edit,
    isDisliked,
    isLiked,
    KEEP,
    learn,
    type TasteState,
} from '/@/renderer/features/best-parts/engine/taste-learn';

export const useTaste = createWithEqualityFn<TasteState>()(
    persist((): TasteState => ({ edits: [], heard: {}, skips: {}, votes: {} }), {
        name: 'hookline_taste',
        storage: createJSONStorage(() => ({
            getItem: async (k) => (await get(k)) ?? null,
            removeItem: del,
            setItem: set,
        })),
        version: 1,
    }),
);

// 1 = thumbs up, -1 = thumbs down, 0 = neither
export const vote = (partId: string, v: -1 | 0 | 1) =>
    useTaste.setState((s) => {
        const votes = { ...s.votes };
        if (v) votes[partId] = v;
        else delete votes[partId];
        return { votes };
    });

export const skippedPart = (partId: string) =>
    useTaste.setState((s) => ({ skips: { ...s.skips, [partId]: (s.skips[partId] ?? 0) + 1 } }));

export const heardPart = (partId: string) =>
    useTaste.setState((s) => ({ heard: { ...s.heard, [partId]: (s.heard[partId] ?? 0) + 1 } }));

// You trimmed or extended a part BolBeats found.
export const editedPart = (found: [number, number], chosen: [number, number]) => {
    if (Math.abs(found[0] - chosen[0]) < 0.5 && Math.abs(found[1] - chosen[1]) < 0.5) return;
    useTaste.setState((s) => ({ edits: [...s.edits, { chosen, found } as Edit].slice(-KEEP) }));
};

export const learnedTaste = () => learn(useTaste.getState());
export const disliked = (partId: string) => isDisliked(useTaste.getState(), partId);
export const liked = (partId: string) => isLiked(useTaste.getState(), partId);
export const forgetTaste = () => useTaste.setState({ edits: [], heard: {}, skips: {}, votes: {} });
