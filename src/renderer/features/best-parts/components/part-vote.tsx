// BolBeats: thumbs up / down on the playing best part. Thumbs down leaves it out of the playlists BolBeats makes, of
// Best parts only and of Made for you; thumbs up gives it a made-for-you playlist of its own (store/taste.store.ts).
import { useMemo } from 'react';

import { skipMixPart, useMixPlayer } from '/@/renderer/features/best-parts/mix-player';
import { useBestPartsStore } from '/@/renderer/features/best-parts/store/best-parts.store';
import { useTaste, vote } from '/@/renderer/features/best-parts/store/taste.store';
import { usePlayerSong, usePlayerTimestamp } from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';

export const PartVote = ({ onDown, partId }: { onDown?: () => void; partId?: string }) => {
    const v = useTaste((s) => (partId ? s.votes[partId] : undefined));
    if (!partId) return null;
    return (
        <Group gap={2} wrap="nowrap">
            <ActionIcon
                aria-pressed={v === 1}
                icon="thumbsUp"
                onClick={(e) => {
                    e.stopPropagation();
                    vote(partId, v === 1 ? 0 : 1);
                }}
                size="sm"
                tooltip={{ label: v === 1 ? 'You like this part' : 'I like this part' }}
                variant={v === 1 ? 'light' : 'subtle'}
            />
            <ActionIcon
                aria-pressed={v === -1}
                icon="thumbsDown"
                onClick={(e) => {
                    e.stopPropagation();
                    vote(partId, v === -1 ? 0 : -1);
                    if (v !== -1) onDown?.();
                }}
                size="sm"
                tooltip={{
                    label:
                        v === -1
                            ? 'Left out of the playlists BolBeats makes. Click to undo'
                            : 'Not for me',
                }}
                variant={v === -1 ? 'light' : 'subtle'}
            />
        </Group>
    );
};

// The part playing in a best-parts playlist; thumbs down moves on to the next part.
export const MixPartVote = () => {
    const id = useMixPlayer((s) =>
        s.status === 'idle' || s.preview ? undefined : s.partIds[s.index],
    );
    return <PartVote onDown={() => skipMixPart(1)} partId={id} />;
};

// The saved part the main player is in right now, if any.
export const PlayingPartVote = () => {
    const song = usePlayerSong();
    const now = usePlayerTimestamp();
    const all = useBestPartsStore((s) => s.parts);
    const parts = useMemo(
        () => (song ? Object.values(all).filter((p) => p.songId === song.id) : []),
        [all, song],
    );
    const here = parts.find((p) => now >= p.start && now < p.end);
    return <PartVote partId={here?.id} />;
};
