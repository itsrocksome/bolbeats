// BolBeats: what you listen to and when, kept only on this Mac (IndexedDB). Powers the streak, "your evenings",
// and fresher daily picks. Time blocks follow how listening splits over a day (Heggli et al. 2021).
import { del, get, set } from 'idb-keyval';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

export const BLOCKS = ['late night', 'morning', 'afternoon', 'evening', 'night'] as const;

// 1-6 late night, 6-12 morning, 12-17 afternoon, 17-21 evening, 21-1 night.
export const blockOf = (d = new Date()) => {
    const h = d.getHours();
    if (h >= 1 && h < 6) return 0;
    if (h >= 6 && h < 12) return 1;
    if (h >= 12 && h < 17) return 2;
    if (h >= 17 && h < 21) return 3;
    return 4;
};

export const dayKey = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export type Count = { blocks: number[]; last: number; n: number };

type State = {
    days: Record<string, number>; // seconds listened per day
    mixes: Record<string, Count>; // best-parts playlists started
    parts: Record<string, Count>; // parts heard in a mix
    songs: Record<string, Count>; // songs started in the main player
};

const bump = (c: Count | undefined): Count => {
    const blocks = [...(c?.blocks ?? [0, 0, 0, 0, 0])];
    blocks[blockOf()]++;
    return { blocks, last: Date.now(), n: (c?.n ?? 0) + 1 };
};

export const useListeningStore = createWithEqualityFn<State>()(
    persist(() => ({ days: {}, mixes: {}, parts: {}, songs: {} }), {
        name: 'hookline_listening',
        // BolBeats: idb-keyval gives undefined for a missing key; zustand would JSON.parse it and never finish loading
        storage: createJSONStorage(() => ({
            getItem: async (k) => (await get(k)) ?? null,
            removeItem: del,
            setItem: set,
        })),
        version: 1,
    }),
);

export const listened = (seconds: number) =>
    useListeningStore.setState((s) => ({
        days: { ...s.days, [dayKey()]: (s.days[dayKey()] ?? 0) + seconds },
    }));

export const counted = (kind: 'mixes' | 'parts' | 'songs', id: string) =>
    useListeningStore.setState((s) => ({ [kind]: { ...s[kind], [id]: bump(s[kind][id]) } }));

// The ids played most in this part of the day (at least twice), most first.
export const topInBlock = (counts: Record<string, Count>, block = blockOf(), limit = 20) =>
    Object.entries(counts)
        .filter(([, c]) => c.blocks[block] >= 2)
        .sort((a, b) => b[1].blocks[block] - a[1].blocks[block])
        .slice(0, limit)
        .map(([id]) => id);
