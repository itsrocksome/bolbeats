import { openContextModal } from '@mantine/modals';
import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { openPlaylistHooks } from '/@/renderer/features/best-parts/components/playlist-hooks';
import { playMixById, playParts } from '/@/renderer/features/best-parts/mix-player';
import {
    ALL_PARTS_MIX,
    mixForPlaylist,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { toast } from '/@/shared/components/toast/toast';
import { Playlist, Song } from '/@/shared/types/domain-types';

// BolBeats: one song opens the best-parts editor; several songs open the builder; a playlist gets a best-parts version.
export const openMixBuilder = (songs: Song[], name: string, sourcePlaylistId?: string) =>
    openContextModal({
        innerProps: { name, songs, sourcePlaylistId },
        modal: 'bestPartsBuilder',
        size: 'xl',
        title: `Pick the best parts: ${name}`,
    });

export const MarkBestPartsAction = ({ songs }: { songs: Song[] }) => {
    const one = songs.length === 1 ? songs[0] : undefined;
    const parts = useBestPartsStore(
        useShallow((s) =>
            one
                ? Object.values(s.parts)
                      .filter((p) => p.songId === one.id)
                      .sort((a, b) => a.start - b.start)
                : [],
        ),
    );
    const mixes = useBestPartsStore(
        useShallow((s) => Object.values(s.mixes).filter((m) => m.id !== ALL_PARTS_MIX)),
    );
    const onSelect = useCallback(() => {
        if (one) {
            openContextModal({
                innerProps: { song: one },
                modal: 'bestParts',
                size: 'xl',
                title: `Best parts of “${one.name}”`,
            });
        } else openMixBuilder(songs, `${songs.length} songs · best parts`);
    }, [one, songs]);

    // BolBeats: a song that already has best parts gets them right here: play, add to a best-parts playlist, edit
    const addTo = (mixId: string) => {
        const mix = useBestPartsStore.getState().mixes[mixId];
        if (!mix) return;
        useBestPartsStore.getState().updateMix(mixId, {
            partIds: [
                ...mix.partIds,
                ...parts.map((p) => p.id).filter((id) => !mix.partIds.includes(id)),
            ],
        });
        toast.success({ message: `Added to “${mix.name}”.` });
    };
    const newMix = () => {
        const id = useBestPartsStore.getState().createMix(
            `${one?.name ?? 'New'} · best parts`,
            parts.map((p) => p.id),
        );
        toast.success({ message: 'New best-parts playlist made. Rename it on its page.' });
        return id;
    };

    return (
        <>
            {parts.length > 0 && (
                <ContextMenu.Item
                    leftIcon="mediaPlay"
                    onSelect={() =>
                        playParts(parts, {}, { label: `${one?.name}, best part`, mixId: null })
                    }
                >
                    {parts.length > 1
                        ? `Play its ${parts.length} best parts`
                        : 'Play its best part'}
                </ContextMenu.Item>
            )}
            {parts.length > 0 && (
                <ContextMenu.Submenu>
                    <ContextMenu.SubmenuTarget>
                        <ContextMenu.Item leftIcon="add" rightIcon="arrowRightS">
                            Add best part to…
                        </ContextMenu.Item>
                    </ContextMenu.SubmenuTarget>
                    <ContextMenu.SubmenuContent>
                        {mixes.map((m) => (
                            <ContextMenu.Item key={m.id} onSelect={() => addTo(m.id)}>
                                {m.name}
                            </ContextMenu.Item>
                        ))}
                        {mixes.length > 0 && <ContextMenu.Divider />}
                        <ContextMenu.Item leftIcon="add" onSelect={newMix}>
                            New best-parts playlist
                        </ContextMenu.Item>
                    </ContextMenu.SubmenuContent>
                </ContextMenu.Submenu>
            )}
            <ContextMenu.Item disabled={!songs.length} leftIcon="bestParts" onSelect={onSelect}>
                {songs.length > 1
                    ? `Make a best-parts playlist (${songs.length} songs)`
                    : parts.length
                      ? 'Edit best parts'
                      : 'Mark best parts'}
            </ContextMenu.Item>
        </>
    );
};

export const BuildMixFromPlaylistAction = ({ playlist }: { playlist?: Playlist }) => {
    const version = useBestPartsStore((s) =>
        playlist ? mixForPlaylist(s.mixes, playlist.id) : undefined,
    );
    const onSelect = useCallback(
        () => playlist && openPlaylistHooks(playlist.id, playlist.name),
        [playlist],
    );

    return (
        <>
            {version && (
                <ContextMenu.Item leftIcon="mediaPlay" onSelect={() => playMixById(version.id)}>
                    Play best-parts version
                </ContextMenu.Item>
            )}
            <ContextMenu.Item disabled={!playlist} leftIcon="bestParts" onSelect={onSelect}>
                {version ? 'Redo best-parts version' : 'Make best-parts version'}
            </ContextMenu.Item>
        </>
    );
};
