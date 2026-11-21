// BolBeats: the private library has no artist photos (the server would fetch them from the internet, which is off),
// so every artist showed the same blank picture. An artist's picture is the cover of one of their songs instead: a
// song where they are the first name credited, so a guest verse doesn't decide it. Built once per launch.
import { createWithEqualityFn } from 'zustand/traditional';

import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { useAuthStore } from '/@/renderer/store/auth.store';

// artist id -> a song's image id
export const useArtistCovers = createWithEqualityFn<{ byArtist: Record<string, string> }>(() => ({
    byArtist: {},
}));

let built = false;

export const buildArtistCovers = async () => {
    if (built || !useAuthStore.getState().currentServer) return;
    built = true;
    const byArtist: Record<string, string> = {};
    const songs = await allLibrarySongs().catch(() => []);
    // first-credited songs win over guest appearances
    for (const lead of [true, false])
        for (const s of songs) {
            if (!s.imageId) continue;
            const credited = [...(s.albumArtists ?? []), ...(s.artists ?? [])];
            for (const [i, a] of credited.entries())
                if ((!lead || i === 0) && !byArtist[a.id]) byArtist[a.id] = s.imageId;
        }
    if (!songs.length) built = false; // not connected yet: try again later
    useArtistCovers.setState({ byArtist });
};
