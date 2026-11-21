import type { Song } from '/@/shared/types/domain-types';

// BolBeats: add songs to a best-parts playlist. A song with best parts brings the ones not in the playlist yet; a song
// without any gets its hook picked by BolBeats first (about a second).
import { openModal } from '@mantine/modals';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import styles from './best-parts.module.css';

import { pickHooks } from '/@/renderer/features/best-parts/auto-hooks';
import { Cover } from '/@/renderer/features/best-parts/components/shared';
import {
    partsOfSong,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { Button } from '/@/shared/components/button/button';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

export const openAddToMix = (mixId: string) =>
    openModal({ children: <AddToMix mixId={mixId} />, size: 'lg', title: 'Add songs' });

const AddToMix = ({ mixId }: { mixId: string }) => {
    const [q, setQ] = useState('');
    const [busy, setBusy] = useState<null | string>(null);
    const { data: songs = [], isLoading } = useQuery({
        queryFn: allLibrarySongs,
        queryKey: ['hookline', 'all-songs'],
    });
    const partIds = useBestPartsStore((s) => s.mixes[mixId]?.partIds ?? []);
    const partMap = useBestPartsStore((s) => s.parts);
    const inMix = new Set(partIds);
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = songs
        .filter((s) =>
            words.every((w) => `${s.name} ${s.artistName} ${s.album}`.toLowerCase().includes(w)),
        )
        .slice(0, 60);

    const add = async (song: Song) => {
        setBusy(song.id);
        try {
            let ids = partsOfSong(song.id).map((p) => p.id);
            if (!ids.length)
                ids = (
                    await pickHooks(
                        [song],
                        () => {},
                        () => false,
                    )
                ).partIds;
            const now = useBestPartsStore.getState().mixes[mixId]?.partIds ?? [];
            const fresh = ids.filter((id) => !now.includes(id));
            if (!fresh.length) throw new Error('Its best part couldn’t be found.');
            useBestPartsStore
                .getState()
                .updateMix(mixId, { auto: false, partIds: [...now, ...fresh] });
            toast.success({ message: `${song.name} added at the end.` });
        } catch (e) {
            toast.error({
                message: `${song.name}: ${(e as Error).message}`,
                title: 'Couldn’t add this song',
            });
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className={styles.addSongs}>
            <TextInput
                autoFocus
                label="Find a song"
                onChange={(e) => setQ(e.currentTarget.value)}
                placeholder="Song, artist or album"
                value={q}
            />
            {isLoading && <Text isMuted>Loading your library…</Text>}
            <ul className={styles.addList}>
                {shown.map((s) => {
                    const own = Object.values(partMap).filter((p) => p.songId === s.id);
                    const all = own.length > 0 && own.every((p) => inMix.has(p.id));
                    return (
                        <li key={s.id}>
                            <Cover part={{ songId: s.id, title: s.name }} />
                            <div className={styles.songMeta}>
                                <Text fw={600} truncate>
                                    {s.name}
                                </Text>
                                <Text isMuted size="sm" truncate>
                                    {s.artistName}
                                    {own.length
                                        ? ` · ${own.length} best ${own.length === 1 ? 'part' : 'parts'}`
                                        : ''}
                                </Text>
                            </div>
                            {all ? (
                                <Text isMuted size="sm">
                                    In this playlist
                                </Text>
                            ) : (
                                <Button
                                    disabled={!!busy && busy !== s.id}
                                    loading={busy === s.id}
                                    onClick={() => add(s)}
                                    size="compact-sm"
                                    variant="default"
                                >
                                    {own.length ? 'Add' : 'Add, find its best part'}
                                </Button>
                            )}
                        </li>
                    );
                })}
            </ul>
            {!isLoading && !shown.length && <Text isMuted>No songs match “{q}”.</Text>}
        </div>
    );
};
