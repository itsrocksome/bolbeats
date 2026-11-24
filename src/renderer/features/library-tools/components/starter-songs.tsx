// BolBeats: Your library > Starter songs, the free songs that ship with the app (main: local-library/starter.ts).
// Removing deletes them from the music folder so the space comes back; their playlists and best parts go with them.
import type { StarterStatus } from '/@/shared/types/local-library';

import { closeAllModals, openModal } from '@mantine/modals';
import { useEffect, useState } from 'react';

import styles from '../library-tools.module.css';

import { api } from '/@/renderer/api';
import { pickHooks } from '/@/renderer/features/best-parts/auto-hooks';
import {
    mixForPlaylist,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import {
    rescanLibrary,
    useLocalLibrary,
} from '/@/renderer/features/local-library/connect-local-library';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { Button } from '/@/shared/components/button/button';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const FOLDER_LISTS = 'hookline_folder_playlists'; // folder-playlists.ts: `${root}|${folder}` -> its playlist

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

// Runs while the songs are still in the library, so their ids can be found.
const forgetStarter = async (root: string, folders: string[]) => {
    const inStarter = (p?: null | string) =>
        !!p && folders.some((f) => p.startsWith(`${root}/${f}/`));
    const ids = new Set(
        (await allLibrarySongs()).filter((s) => inStarter(s.path)).map((s) => s.id),
    );
    const bp = useBestPartsStore.getState();
    const gone = new Set(
        Object.values(bp.parts)
            .filter((p) => ids.has(p.songId))
            .map((p) => p.id),
    );
    const hit = Object.values(bp.mixes).filter((m) => m.partIds.some((p) => gone.has(p)));
    gone.forEach(bp.deletePart);
    for (const m of hit)
        if (!useBestPartsStore.getState().mixes[m.id]?.partIds.length) bp.deleteMix(m.id);

    let made: Record<string, { id: null | string }> = {};
    try {
        made = JSON.parse(localStorage.getItem(FOLDER_LISTS) ?? '{}');
    } catch {
        // unreadable: nothing to forget
    }
    const serverId = useAuthStore.getState().currentServer?.id;
    for (const f of folders) {
        const id = made[`${root}|${f}`]?.id;
        if (id && serverId)
            await api.controller
                .deletePlaylist({ apiClientProps: { serverId }, query: { id } })
                .catch(() => undefined);
        delete made[`${root}|${f}`]; // so adding them back makes the playlist again
    }
    try {
        localStorage.setItem(FOLDER_LISTS, JSON.stringify(made));
    } catch {
        // storage blocked
    }
};

// When a starter folder's playlist is first made, its best-parts version is made too, so the main feature is ready to try.
export const makeStarterBestParts = async (lists: { id: string; name: string }[]) => {
    const { folders } = await window.api.localLibrary.starter('status');
    const serverId = useAuthStore.getState().currentServer?.id;
    if (!serverId) return;
    for (const l of lists.filter((x) => folders.includes(x.name))) {
        if (mixForPlaylist(useBestPartsStore.getState().mixes, l.id)) continue;
        const songs =
            (
                await api.controller.getPlaylistSongList({
                    apiClientProps: { serverId },
                    query: { id: l.id },
                })
            )?.items ?? [];
        const { partIds } = await pickHooks(
            songs,
            () => undefined,
            () => false,
        );
        if (partIds.length)
            useBestPartsStore.getState().createMix(`${l.name} · best parts`, partIds, {
                auto: true,
                sourcePlaylistId: l.id,
            });
    }
};

export const StarterSongs = () => {
    const { folder } = useLocalLibrary();
    const [status, setStatus] = useState<null | StarterStatus>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!folder) return;
        window.api.localLibrary
            .starter('status')
            .then(setStatus)
            .catch(() => setStatus(null));
    }, [folder]);

    const add = async () => {
        setBusy(true);
        try {
            const s = await window.api.localLibrary.starter('add');
            setStatus(s);
            await rescanLibrary();
            window.dispatchEvent(new Event('bolbeats:library-changed')); // folders become playlists
            toast.success({
                message: `${s.songs} songs in ${s.folders.join(' and ')}. Each folder becomes a playlist.`,
                title: 'Starter songs added',
            });
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t add the starter songs' });
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        closeAllModals();
        if (!status) return;
        setBusy(true);
        try {
            await forgetStarter(folder, status.folders);
            const s = await window.api.localLibrary.starter('remove');
            setStatus(s);
            await rescanLibrary();
            toast.success({
                message: `${mb(status.bytes - s.bytes)} freed. You can add them back from Your library.`,
                title: 'Starter songs removed',
            });
        } catch (e) {
            toast.error({
                message: (e as Error).message,
                title: 'Couldn’t remove the starter songs',
            });
        } finally {
            setBusy(false);
        }
    };

    const askRemove = () =>
        openModal({
            children: (
                <ConfirmModal onConfirm={remove}>
                    <Text>
                        Delete the {status?.songs} starter songs from your music folder? This frees{' '}
                        {mb(status?.bytes ?? 0)}. Their playlists and best parts go too. Your own
                        songs aren’t touched, and you can add the starter songs back later.
                    </Text>
                </ConfirmModal>
            ),
            title: 'Remove starter songs',
        });

    if (!status) return null;
    const has = status.count > 0;
    return (
        <div className={styles.home}>
            <div>
                <Text fw={700}>
                    {has
                        ? `Starter songs: ${status.songs} songs, ${mb(status.bytes)}`
                        : 'Starter songs'}
                </Text>
                <Text isMuted size="sm">
                    Free songs that come with BolBeats so you can try playlists and best parts
                    straight away: music by Kevin MacLeod (incompetech.com), shared under Creative
                    Commons Attribution 4.0.{' '}
                    {has
                        ? 'Remove them once your own music is in: they’re deleted from your music folder and the space is freed.'
                        : 'They aren’t in your music folder right now.'}
                </Text>
            </div>
            <div className={styles.actions}>
                {has ? (
                    <Button loading={busy} onClick={askRemove} variant="default">
                        Remove starter songs
                    </Button>
                ) : (
                    <Button loading={busy} onClick={add} variant="default">
                        Add starter songs
                    </Button>
                )}
            </div>
        </div>
    );
};
