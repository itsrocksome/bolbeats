// BolBeats: best parts made before 1.1 came one per song. Once, a little after launch, every song that has parts is
// checked for its other best parts (and a part under 15 s for its longer find); best-parts playlists BolBeats made take
// them in. Your own parts and playlists you've changed are left as they are.
import type { Song } from '/@/shared/types/domain-types';

import { addMoreParts, isScanned } from '/@/renderer/features/best-parts/auto-hooks';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

let running = false;

export const findMoreParts = async () => {
    if (
        running ||
        !useAuthStore.getState().currentServer ||
        !useBestPartsStore.persist.hasHydrated()
    )
        return;
    running = true;
    let added = 0;
    let songs = 0;
    try {
        const bySong = new Map(
            Object.values(useBestPartsStore.getState().parts).map((p) => [p.songId, p]),
        );
        for (const [songId, p] of bySong) {
            if (isScanned(songId)) continue;
            const song = {
                _itemType: LibraryItem.SONG,
                album: p.album,
                artistName: p.artist,
                duration: p.songDuration * 1000,
                id: songId,
                imageUrl: p.imageUrl,
                name: p.title,
            } as Song;
            try {
                const { fresh, longer } = await addMoreParts(song);
                if (fresh.length || longer.size) songs++;
                added += fresh.length;
            } catch {
                // the song is gone or can't be read: try again next launch
            }
        }
    } finally {
        running = false;
    }
    if (songs)
        toast.success({
            message: `${added ? `${added} more best ${added === 1 ? 'part' : 'parts'} in ${songs} ${songs === 1 ? 'song' : 'songs'}` : `Longer parts in ${songs} ${songs === 1 ? 'song' : 'songs'}`}. The best-parts playlists BolBeats made have them now.`,
            title: 'BolBeats found more best parts',
        });
};

setTimeout(findMoreParts, 25_000);
