import { api } from '/@/renderer/api';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { type Song, SongListSort, SortOrder } from '/@/shared/types/domain-types';

// BolBeats: every song in the local library (fine for personal libraries of a few thousand songs).
export const allLibrarySongs = async (): Promise<Song[]> => {
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return [];
    const res = await api.controller.getSongList({
        apiClientProps: { serverId },
        query: { limit: 20000, sortBy: SongListSort.NAME, sortOrder: SortOrder.ASC, startIndex: 0 },
    });
    return res?.items ?? [];
};

export const isUnknown = (v?: null | string) => !v || /^\[unknown/i.test(v);
export const needsDetails = (s: Song) => isUnknown(s.artistName) || isUnknown(s.album);
export const fileName = (s: Song) => (s.path ?? s.name).split('/').pop() ?? s.name;
