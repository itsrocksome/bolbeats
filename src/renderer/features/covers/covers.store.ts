// BolBeats: custom covers for playlists and best-parts playlists, kept on this Mac (the library server has no place
// for playlist pictures). Keys: `playlist:<id>` and `mix:<id>`. Each cover is a 600 px image as a data URL.
import { del, get, set } from 'idb-keyval';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

export type Cover = { dataUrl: string; kind: 'art' | 'emoji' | 'picture' };

type State = {
    covers: Record<string, Cover>;
    removeCover: (key: string) => void;
    setCover: (key: string, cover: Cover) => void;
};

export const useCovers = createWithEqualityFn<State>()(
    persist(
        (setState) => ({
            covers: {},
            removeCover: (key) =>
                setState((s) => {
                    const covers = { ...s.covers };
                    delete covers[key];
                    return { covers };
                }),
            setCover: (key, cover) => setState((s) => ({ covers: { ...s.covers, [key]: cover } })),
        }),
        {
            name: 'hookline_covers',
            partialize: (s) => ({ covers: s.covers }),
            // idb-keyval gives undefined for a missing key; zustand would JSON.parse it and never finish loading
            storage: createJSONStorage(() => ({
                getItem: async (k) => (await get(k)) ?? null,
                removeItem: del,
                setItem: set,
            })),
            version: 1,
        },
    ),
);

export const playlistCoverKey = (id: string) => `playlist:${id}`;
export const mixCoverKey = (id: string) => `mix:${id}`;
// Navidrome image ids look like "<playlist id>&_=<updated>"
export const playlistIdFromImageId = (imageId: string) => imageId.split('&')[0];
