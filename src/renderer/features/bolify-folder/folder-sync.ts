import type { FolderEntry, FolderList } from '/@/shared/types/bolify-folder';

// BolBeats: keeps <music folder>/BolBeats/ up to date (playlist files, best-parts files, backup) and brings things back
// from it after a reinstall or a folder change. Imported once by app.tsx for the automatic saves.
import { createWithEqualityFn } from 'zustand/traditional';

import { api } from '/@/renderer/api';
import {
    ALL_PARTS_MIX,
    type BestPart,
    type PartMix,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { type Findable, songFinder } from '/@/renderer/features/bolify-folder/relink';
import {
    type Cover,
    mixCoverKey,
    playlistCoverKey,
    useCovers,
} from '/@/renderer/features/covers/covers.store';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { useLocalLibrary } from '/@/renderer/features/local-library/connect-local-library';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { PlaylistListSort, type Song, SortOrder } from '/@/shared/types/domain-types';

type Backup = {
    app: 'BolBeats' | 'Bolify'; // Bolify = written before the rename
    covers?: { mixes: Record<string, Cover>; playlists: Record<string, Cover> }; // custom covers (playlists by name)
    mixes: Record<string, PartMix>;
    musicFolder: string;
    parts: (BestPart & { songPath: string })[];
    playlists: { id?: string; name: string; songs: Findable[] }[];
    presets: (null | string)[];
    version: 1;
};

export const useFolderSync = createWithEqualityFn<{
    error: null | string;
    savedAt: null | number;
    saving: boolean;
}>(() => ({
    error: null,
    savedAt: null,
    saving: false,
}));

const serverId = () => useAuthStore.getState().currentServer?.id;
const entry = (s: Song): FolderEntry => ({
    artist: s.artistName,
    path: s.path ?? '',
    seconds: s.duration / 1000,
    title: s.name,
});

const playlistNames = async () => {
    const id = serverId();
    if (!id) return [];
    const res = await api.controller.getPlaylistList({
        apiClientProps: { serverId: id },
        query: {
            limit: 500,
            sortBy: PlaylistListSort.NAME,
            sortOrder: SortOrder.ASC,
            startIndex: 0,
        },
    });
    return res?.items ?? [];
};

let lastKey = '';

const backupHasParts = async () => {
    try {
        return !!(
            JSON.parse((await window.api.bolifyFolder.readBackup()) ?? '{}') as Partial<Backup>
        ).parts?.length;
    } catch {
        return false;
    }
};

// Writes the folder. Skips the write when nothing changed since the last one (unless forced).
export const saveToFolder = async (force = false) => {
    const id = serverId();
    if (!id || useFolderSync.getState().saving || !useBestPartsStore.persist.hasHydrated()) return;
    useFolderSync.setState({ saving: true });
    try {
        const songs = await allLibrarySongs();
        if (!songs.length) return; // library still scanning: never write a backup that knows no songs
        const { mixes, parts, presets } = useBestPartsStore.getState();
        if (!Object.keys(parts).length && (await backupHasParts())) return; // never replace saved parts with nothing
        const byId = new Map(songs.map((s) => [s.id, s]));
        const playlists: (FolderList & { id: string })[] = [];
        for (const p of await playlistNames()) {
            const res = await api.controller.getPlaylistSongList({
                apiClientProps: { serverId: id },
                query: { id: p.id },
            });
            playlists.push({
                entries: (res?.items ?? []).filter((s) => s.path).map(entry),
                id: p.id,
                name: p.name,
            });
        }
        const bestParts: FolderList[] = Object.values(mixes)
            .map((m) => ({
                entries: m.partIds
                    .map((pid) => parts[pid])
                    .filter((p) => p && byId.get(p.songId)?.path)
                    .map((p) => ({
                        artist: p.artist,
                        end: p.end,
                        path: byId.get(p.songId)!.path!,
                        seconds: p.songDuration,
                        start: p.start,
                        title: p.title,
                    })),
                name: m.id === ALL_PARTS_MIX ? 'All best parts' : m.name,
            }))
            .filter((l) => l.entries.length);
        const { covers: all } = useCovers.getState();
        const covers = {
            mixes: Object.fromEntries(
                Object.keys(mixes).flatMap((m) =>
                    all[mixCoverKey(m)] ? [[m, all[mixCoverKey(m)]]] : [],
                ),
            ),
            playlists: Object.fromEntries(
                playlists.flatMap((l) =>
                    all[playlistCoverKey(l.id)] ? [[l.name, all[playlistCoverKey(l.id)]]] : [],
                ),
            ),
        };
        const body = {
            covers,
            mixes,
            musicFolder: useLocalLibrary.getState().folder,
            parts: Object.values(parts).map((p) => ({
                ...p,
                songPath: byId.get(p.songId)?.path ?? '',
            })),
            playlists: playlists.map((l) => ({ id: l.id, name: l.name, songs: l.entries })),
            presets,
        };
        const key = JSON.stringify(body);
        if (!force && key === lastKey) return;
        const backup = JSON.stringify({
            app: 'BolBeats',
            savedAt: new Date().toISOString(),
            version: 1,
            ...body,
        });
        await window.api.bolifyFolder.exportLists({ backup, bestParts, playlists });
        lastKey = key;
        useFolderSync.setState({ error: null, savedAt: Date.now() });
    } catch (e) {
        useFolderSync.setState({ error: (e as Error).message });
    } finally {
        useFolderSync.setState({ saving: false });
    }
};

// After the library moved: point best parts at the same songs in the new folder (title, artist, length).
export const relinkParts = async () => {
    const songs = await allLibrarySongs();
    const have = new Set(songs.map((s) => s.id));
    const find = songFinder(songs, useLocalLibrary.getState().folder);
    const { parts, savePart } = useBestPartsStore.getState();
    let n = 0;
    for (const p of Object.values(parts)) {
        if (have.has(p.songId)) continue;
        const s = find({ artist: p.artist, path: '', seconds: p.songDuration, title: p.title });
        if (s) {
            savePart({ ...p, songId: s.id });
            n++;
        }
    }
    return n;
};

// After the library moved: playlist entries whose file is gone now point at the same song in the folder.
// Entries with no match stay (hidden) so they come back if their file does. Returns how many were repaired.
export const relinkPlaylists = async () => {
    const id = serverId();
    if (!id) return 0;
    const props = { apiClientProps: { serverId: id } };
    const find = songFinder(await allLibrarySongs(), useLocalLibrary.getState().folder);
    let n = 0;
    for (const p of await playlistNames()) {
        const items =
            (
                await api.controller.getPlaylistSongList({
                    ...props,
                    query: { id: p.id, includeMissing: true },
                })
            )?.items ?? [];
        const swap = new Map<string, string>();
        for (const s of items) {
            const to = s.missing && s.playlistItemId ? find(entry(s)) : undefined;
            if (to) swap.set(s.playlistItemId!, to.id);
        }
        if (!swap.size) continue;
        const kept = items.filter(
            (s) => s.playlistItemId && (!s.missing || swap.has(s.playlistItemId)),
        );
        // Add the repaired list first, then remove the old entries: a failure in between leaves duplicates, never a shorter playlist.
        await api.controller.addToPlaylist({
            ...props,
            body: { songId: kept.map((s) => swap.get(s.playlistItemId!) ?? s.id) },
            query: { id: p.id },
        });
        await api.controller.removeFromPlaylist({
            ...props,
            query: { id: p.id, songId: kept.map((s) => s.playlistItemId!) },
        });
        n += swap.size;
    }
    if (n) await queryClient.invalidateQueries();
    return n;
};

// Brings best parts, best-parts playlists, presets and missing playlists back from <folder>/BolBeats/bolbeats-backup.json.
// Merges: anything already here wins. Returns null when the folder has no backup.
export const restoreFromFolder = async (folder?: string) => {
    const raw = await window.api.bolifyFolder.readBackup(folder);
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup;
    if ((b.app !== 'BolBeats' && b.app !== 'Bolify') || !Array.isArray(b.parts)) return null;
    const songs = await allLibrarySongs();
    const have = new Set(songs.map((s) => s.id));
    const find = songFinder(songs, useLocalLibrary.getState().folder);
    const store = useBestPartsStore.getState();
    const parts = { ...store.parts };
    let restored = 0;
    let missing = 0;
    for (const { songPath, ...p } of b.parts) {
        if (parts[p.id] && have.has(parts[p.id].songId)) continue;
        const s = find(
            { artist: p.artist, path: songPath, seconds: p.songDuration, title: p.title },
            b.musicFolder,
        );
        if (!s) {
            missing++;
            parts[p.id] ??= p; // kept (it reconnects once its song is in the folder), so the next backup still has it
            continue;
        }
        parts[p.id] = { ...p, songId: s.id };
        restored++;
    }
    const mixes = { ...b.mixes, ...store.mixes };
    for (const m of Object.values(mixes)) m.partIds = m.partIds.filter((id) => parts[id]);
    const presets = store.presets.some(Boolean) ? store.presets : b.presets;
    useBestPartsStore.setState({ mixes, parts, presets });

    let playlists = 0;
    const id = serverId();
    const names = new Set((await playlistNames()).map((p) => p.name));
    for (const l of b.playlists ?? []) {
        if (!id || names.has(l.name)) continue;
        const ids = l.songs.map((x) => find(x, b.musicFolder)?.id).filter(Boolean) as string[];
        if (!ids.length) continue;
        const created = await api.controller.createPlaylist({
            apiClientProps: { serverId: id },
            body: { name: l.name },
        });
        if (!created?.id) continue;
        await api.controller.addToPlaylist({
            apiClientProps: { serverId: id },
            body: { songId: ids },
            query: { id: created.id },
        });
        playlists++;
        // its best-parts version follows it to the new playlist
        for (const m of Object.values(useBestPartsStore.getState().mixes)) {
            if (l.id && m.sourcePlaylistId === l.id)
                useBestPartsStore.getState().updateMix(m.id, { sourcePlaylistId: created.id });
        }
    }
    // custom covers come back too, unless the playlist already has one here
    const { covers, setCover } = useCovers.getState();
    for (const [m, c] of Object.entries(b.covers?.mixes ?? {}))
        if (!covers[mixCoverKey(m)]) setCover(mixCoverKey(m), c);
    for (const p of await playlistNames()) {
        const c = b.covers?.playlists[p.name];
        if (c && !covers[playlistCoverKey(p.id)]) setCover(playlistCoverKey(p.id), c);
    }
    if (playlists) await queryClient.invalidateQueries();
    return { missing, playlists, restored };
};

// ---------- automatic saves ----------

let timer: null | ReturnType<typeof setTimeout> = null;
const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => saveToFolder(), 5000);
};

const startup = async () => {
    if (
        !serverId() ||
        !useBestPartsStore.persist.hasHydrated() ||
        !(await allLibrarySongs()).length
    )
        return void setTimeout(startup, 5000);
    try {
        // A fresh install (or a wiped app) picks its best parts back up from the folder.
        if (!Object.keys(useBestPartsStore.getState().parts).length) await restoreFromFolder();
        else await relinkParts();
        await relinkPlaylists();
    } catch {
        // nothing to restore; carry on
    }
    await saveToFolder();
    useBestPartsStore.subscribe(soon);
    useCovers.subscribe(soon);
    setInterval(() => saveToFolder(), 3 * 60_000); // picks up playlist edits
};

// Dev builds share your real music folder, so only the installed app saves and restores on its own.
if (!import.meta.env.DEV) setTimeout(startup, 6000);
