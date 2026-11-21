import type { Song } from '/@/shared/types/domain-types';
// BolBeats: make the best-parts version of a playlist. Two ways: BolBeats picks every hook and the order (for people who
// love the songs but don't mix), or you pick them song by song (for people who like to fine-tune).
import type { ContextModalProps } from '@mantine/modals';

import { useRef, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from './best-parts.module.css';

import { pickHooks } from '/@/renderer/features/best-parts/auto-hooks';
import {
    mixForPlaylist,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { openMixBuilder } from '/@/renderer/features/context-menu/actions/mark-best-parts-action';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

type Props = { name: string; playlistId: string; songs: Song[] };

export const PlaylistHooksModal = ({ context, id, innerProps }: ContextModalProps<Props>) => {
    const { name, playlistId, songs } = innerProps;
    const navigate = useNavigate();
    const existing = useBestPartsStore((s) => mixForPlaylist(s.mixes, playlistId));
    const [progress, setProgress] = useState<null | { done: number; song: string }>(null);
    const stop = useRef(false);

    const auto = async () => {
        stop.current = false;
        setProgress({ done: 0, song: songs[0]?.name ?? '' });
        const { failed, partIds } = await pickHooks(
            songs,
            (done, song) => setProgress({ done, song: song.name }),
            () => stop.current,
        );
        if (stop.current) return setProgress(null);
        const store = useBestPartsStore.getState();
        let mixId = existing?.id;
        if (mixId) store.updateMix(mixId, { auto: true, partIds, picks: {} });
        else
            mixId = store.createMix(`${name} · best parts`, partIds, {
                auto: true,
                sourcePlaylistId: playlistId,
            });
        context.closeModal(id);
        toast.success({
            message: failed.length
                ? `${failed.length} song(s) couldn’t be read and were left out.`
                : 'Change any part or the order whenever you like.',
            title: `Best parts of ${name} are ready`,
        });
        navigate(generatePath(AppRoute.BEST_PARTS_MIX, { mixId }));
    };

    const custom = () => {
        context.closeModal(id);
        openMixBuilder(songs, name, playlistId);
    };

    if (progress) {
        return (
            <div className={styles.autoRun} role="status">
                <Text size="lg">Finding the hook of every song…</Text>
                <div
                    className={styles.autoBar}
                    style={{ ['--p' as string]: (progress.done + 1) / songs.length }}
                >
                    <span />
                </div>
                <Text isMuted size="sm" truncate>
                    Song {progress.done + 1} of {songs.length}: {progress.song}
                </Text>
                <Button onClick={() => (stop.current = true)} variant="subtle">
                    Cancel
                </Button>
            </div>
        );
    }

    return (
        <div className={styles.choice}>
            <Text isMuted>
                {songs.length} songs. The playlist itself stays as it is: this makes a separate
                best-parts playlist that plays only the parts, mixed together.
            </Text>
            {existing && (
                <Button
                    leftSection={<Icon icon="bestParts" />}
                    onClick={() => (
                        context.closeModal(id),
                        navigate(generatePath(AppRoute.BEST_PARTS_MIX, { mixId: existing.id }))
                    )}
                    variant="default"
                >
                    Open the best-parts version you already made
                </Button>
            )}
            <div className={styles.choiceGrid}>
                <button className={styles.choiceCard} onClick={auto} type="button">
                    <Icon icon="autoPick" size="xl" />
                    <b>{existing ? 'Let BolBeats redo it' : 'Let BolBeats pick'}</b>
                    <span>
                        Finds the hook of every song and puts them in an order that flows. About a
                        second per song.
                    </span>
                </button>
                <button className={styles.choiceCard} onClick={custom} type="button">
                    <Icon icon="edit" size="xl" />
                    <b>I’ll pick the parts</b>
                    <span>
                        Go song by song with a suggested hook ready, keep or move it, add more
                        parts, then choose the order.
                    </span>
                </button>
            </div>
        </div>
    );
};
