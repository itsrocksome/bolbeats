import type { HiddenCopy } from '/@/shared/types/bolify-folder';

import { api } from '/@/renderer/api';
// BolBeats: keeps the library in step with the music folder (rules in folder-playlists-plan.ts): folders become
// playlists, new songs in a folder join its playlist, and a song saved twice shows once. Runs a few seconds after
// launch, when new songs arrive and after a folder switch. A playlist you delete isn't made again, and a song you
// take out of one isn't put back.
import { partsOfSong } from '/@/renderer/features/best-parts/store/best-parts.store';
import {
    findDuplicates,
    planFolderPlaylists,
} from '/@/renderer/features/bolify-folder/folder-playlists-plan';
import { relinkParts, relinkPlaylists } from '/@/renderer/features/bolify-folder/folder-sync';
import { makeStarterBestParts } from '/@/renderer/features/library-tools/components/starter-songs';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import {
    rescanLibrary,
    useLocalLibrary,
} from '/@/renderer/features/local-library/connect-local-library';
import { queryClient } from '/@/renderer/lib/react-query';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { toast } from '/@/shared/components/toast/toast';
import { PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

const KEY = 'hookline_folder_playlists';
// `${music folder}|${folder name}` -> the playlist made from it (null once you deleted it) and the songs BolBeats added
type Made = Record<string, { added: string[]; id: null | string }>;
const load = (): Made => {
    try {
        return JSON.parse(localStorage.getItem(KEY) ?? '{}');
    } catch {
        return {};
    }
};

const sameList = (a: HiddenCopy[], b: HiddenCopy[]) => {
    const k = (l: HiddenCopy[]) =>
        l
            .map((h) => `${h.hide}|${h.same}`)
            .sort()
            .join('\n');
    return k(a) === k(b);
};

let running: null | Promise<unknown> = null;

export const syncFolderPlaylists = () => (running ??= sync().finally(() => (running = null)));

const sync = async () => {
    // a scan in progress (e.g. the first launch's full rescan) would show a half-read library
    for (let i = 0; i < 180 && useLocalLibrary.getState().scanning; i++)
        await new Promise((r) => setTimeout(r, 1000));
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return null;
    const props = { apiClientProps: { serverId } };
    const { folders, hidden: before, root } = await window.api.bolifyFolder.layout();
    let songs = await allLibrarySongs();

    // 1. one copy of each song: keep earlier choices while both files exist, add new twins
    const visible = new Set(songs.map((s) => s.path));
    const kept = before
        .filter((h) => !h.gone && visible.has(`${root}/${h.same}`))
        .map(({ hide, same }) => ({ hide, same }));
    const fresh = findDuplicates(songs, root, (s) => partsOfSong(s.id).length > 0).filter(
        (h) => !kept.some((k) => k.hide === h.hide),
    );
    let hidden = [...kept, ...fresh];
    if (!sameList(hidden, before)) {
        hidden = await window.api.bolifyFolder.hideCopies(hidden);
        await rescanLibrary();
        songs = await allLibrarySongs();
        await relinkParts(); // best parts and playlist entries of a hidden copy move to the copy that stays
        await relinkPlaylists();
    }

    // 2. folders as playlists
    const made = load();
    const lists =
        (
            await api.controller.getPlaylistList({
                ...props,
                query: {
                    limit: 1000,
                    sortBy: PlaylistListSort.NAME,
                    sortOrder: SortOrder.ASC,
                    startIndex: 0,
                },
            })
        )?.items ?? [];
    const created: string[] = [];
    const createdLists: { id: string; name: string }[] = [];
    let added = 0;
    for (const plan of planFolderPlaylists(folders, songs, hidden, root)) {
        const key = `${root}|${plan.name}`;
        const was = made[key];
        if (was && !was.id) continue; // you deleted it
        let id = was?.id && lists.some((p) => p.id === was.id) ? was.id : null;
        if (was?.id && !id) {
            made[key] = { added: [], id: null };
            continue;
        }
        id ??= lists.find((p) => p.name === plan.name)?.id ?? null; // a playlist of that name already: use it
        if (!id) {
            id =
                (await api.controller.createPlaylist({ ...props, body: { name: plan.name } }))
                    ?.id ?? null;
            if (!id) continue;
            created.push(plan.name);
            createdLists.push({ id, name: plan.name });
        }
        const inList = new Set(
            (
                (await api.controller.getPlaylistSongList({ ...props, query: { id } }))?.items ?? []
            ).map((s) => s.id),
        );
        const done = new Set(was?.added ?? []);
        const add = plan.songIds.filter((s) => !inList.has(s) && !done.has(s));
        if (add.length)
            await api.controller.addToPlaylist({ ...props, body: { songId: add }, query: { id } });
        added += created.includes(plan.name) ? 0 : add.length;
        made[key] = { added: [...new Set([...done, ...plan.songIds])], id };
    }
    try {
        localStorage.setItem(KEY, JSON.stringify(made));
    } catch {
        // storage blocked: the next run finds the playlists by name
    }

    const newlyHidden = hidden.filter(
        (h) => !before.some((b) => b.hide === h.hide && !b.gone),
    ).length;
    if (created.length || added || newlyHidden) {
        await queryClient.invalidateQueries();
        const bits = [
            created.length &&
                `${created.length === 1 ? 'Playlist' : 'Playlists'} made from your folders: ${created.join(', ')}.`,
            added && `${added} new ${added === 1 ? 'song' : 'songs'} added to folder playlists.`,
            newlyHidden &&
                `${newlyHidden} ${newlyHidden === 1 ? 'song was' : 'songs were'} saved twice; each shows once now (the files stay).`,
        ].filter(Boolean);
        toast.success({ message: bits.join(' '), title: 'Your library is up to date' });
    }
    if (createdLists.length)
        void makeStarterBestParts(createdLists).catch((e) =>
            toast.error({ message: (e as Error).message, title: 'Couldn’t find best parts' }),
        );
    return { added, created, hidden };
};

// Dev builds share your real music folder, so only the installed app does this on its own.
if (!import.meta.env.DEV) {
    setTimeout(syncFolderPlaylists, 4000);
    window.addEventListener('bolbeats:library-changed', () =>
        setTimeout(syncFolderPlaylists, 1500),
    );
}
