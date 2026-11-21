import type { Song } from '/@/shared/types/domain-types';
// BolBeats: walk through a playlist (or selected songs), mark best parts song by song, then make a mix.
import type { ContextModalProps } from '@mantine/modals';

import { useMemo, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';
import { useShallow } from 'zustand/react/shallow';

import styles from './part-editor-modal.module.css';

import { PartEditor } from '/@/renderer/features/best-parts/components/part-editor-modal';
import { smartOrder } from '/@/renderer/features/best-parts/mix-player';
import {
    mixForPlaylist,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';

export const MixBuilderModal = ({
    context,
    id,
    innerProps,
}: ContextModalProps<{ name: string; songs: Song[]; sourcePlaylistId?: string }>) => {
    const { name, songs, sourcePlaylistId } = innerProps;
    const navigate = useNavigate();
    const [step, setStep] = useState(0);
    const [order, setOrder] = useState<'smart' | 'source'>('smart');
    const [mixName, setMixName] = useState(sourcePlaylistId ? `${name} · best parts` : name);
    const songIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);
    const parts = useBestPartsStore(
        useShallow((s) => Object.values(s.parts).filter((p) => songIds.has(p.songId))),
    );

    if (step < songs.length) {
        return (
            <PartEditor
                doneLabel={step === songs.length - 1 ? 'Finish' : 'Next song'}
                footerStart={
                    <Group gap="xs">
                        <Text className={styles.stepCount} size="sm">
                            Song {step + 1} of {songs.length}
                        </Text>
                        <Button
                            disabled={step === 0}
                            onClick={() => setStep(step - 1)}
                            size="compact-sm"
                            variant="subtle"
                        >
                            Back
                        </Button>
                    </Group>
                }
                key={songs[step].id}
                onDone={() => setStep(step + 1)}
                song={songs[step]}
            />
        );
    }

    const inSourceOrder = songs.flatMap((s) =>
        parts.filter((p) => p.songId === s.id).sort((a, b) => a.start - b.start),
    );
    const marked = new Set(parts.map((p) => p.songId)).size;
    const create = () => {
        const ids = order === 'smart' ? smartOrder(parts) : inSourceOrder.map((p) => p.id);
        const store = useBestPartsStore.getState();
        const existing = sourcePlaylistId && mixForPlaylist(store.mixes, sourcePlaylistId);
        let mixId = existing ? existing.id : '';
        if (existing)
            store.updateMix(existing.id, {
                auto: false,
                name: mixName.trim() || name,
                partIds: ids,
                picks: {},
            });
        else mixId = store.createMix(mixName.trim() || name, ids, { sourcePlaylistId });
        context.closeModal(id);
        navigate(generatePath(AppRoute.BEST_PARTS_MIX, { mixId }));
    };

    return (
        <div className={styles.root}>
            <Text size="lg">
                {parts.length
                    ? `You marked ${parts.length} parts in ${marked} of ${songs.length} songs.`
                    : 'No parts marked yet. Go back and mark at least one part.'}
            </Text>
            <TextInput
                label="Name"
                onChange={(e) => setMixName(e.currentTarget.value)}
                value={mixName}
            />
            <div>
                <Text mb={6} size="sm">
                    Order
                </Text>
                <SegmentedControl
                    data={[
                        { label: 'Auto-arrange for smooth flow', value: 'smart' },
                        { label: 'Keep my order', value: 'source' },
                    ]}
                    onChange={(v) => setOrder(v as 'smart' | 'source')}
                    value={order}
                />
            </div>
            <Group justify="space-between">
                <Button onClick={() => setStep(songs.length - 1)} variant="subtle">
                    Back
                </Button>
                <Button disabled={!parts.length} onClick={create} size="md" variant="filled">
                    Create best-parts playlist
                </Button>
            </Group>
        </div>
    );
};
