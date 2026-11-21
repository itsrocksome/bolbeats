// BolBeats: best-parts playlists BolBeats builds for you from your parts, a "tune your own" control, and a nudge to
// make best-parts versions of the playlists you already have. Used on the Best parts page and on Home.
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from './best-parts.module.css';

import { api } from '/@/renderer/api';
import { openPlaylistHooks } from '/@/renderer/features/best-parts/components/playlist-hooks';
import { Poster } from '/@/renderer/features/best-parts/components/shared';
import { keyFit } from '/@/renderer/features/best-parts/engine/engine';
import {
    madeForYou,
    type Suggestion,
    tune,
} from '/@/renderer/features/best-parts/engine/recommend';
import { playParts } from '/@/renderer/features/best-parts/mix-player';
import {
    type BestPart,
    mixForPlaylist,
    type PartMix,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { mixCoverKey } from '/@/renderer/features/covers/covers.store';
import { dayKey, useListeningStore } from '/@/renderer/features/listening/listening.store';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { Icon } from '/@/shared/components/icon/icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

const length = (ps: BestPart[]) => ps.reduce((s, p) => s + p.end - p.start, 0);

export const useMadeForYou = () => {
    const partMap = useBestPartsStore((s) => s.parts);
    const plays = useListeningStore((s) => s.parts);
    const [now] = useState(Date.now);
    return useMemo(
        () =>
            madeForYou(Object.values(partMap), plays, dayKey(), now, (a, b) => keyFit(a, b) >= 0.7),
        [partMap, plays, now],
    );
};

const playList = (
    ids: string[],
    label: string,
    picks: PartMix['picks'] = {},
    mixId: null | string = null,
) => {
    const { parts } = useBestPartsStore.getState();
    playParts(ids.map((id) => parts[id]).filter(Boolean), picks, { label, mixId });
};

const saveSuggestion = (s: Suggestion) => {
    const id = useBestPartsStore
        .getState()
        .createMix(
            `${s.title} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
            s.partIds,
            { auto: true },
        );
    toast.success({ message: 'It’s in your best-parts playlists now.' });
    return id;
};

// A best-parts playlist as a poster card: click plays, the title opens it.
export const PlaylistCard = ({
    badge,
    mix,
    onOpen,
    onPlay,
    sub,
}: {
    badge?: string;
    mix: { id?: string; name: string; partIds: string[] };
    onOpen?: () => void;
    onPlay: () => void;
    sub: string;
}) => {
    const partMap = useBestPartsStore((s) => s.parts);
    const ps = mix.partIds.map((id) => partMap[id]).filter(Boolean);
    return (
        <div className={styles.card2}>
            <button
                aria-label={`Play ${mix.name}`}
                className={styles.card2Art}
                onClick={onPlay}
                type="button"
            >
                <Poster
                    badge={badge}
                    coverKey={mix.id ? mixCoverKey(mix.id) : undefined}
                    name={mix.name}
                    parts={ps}
                />
                <span aria-hidden className={styles.card2Play}>
                    <Icon icon="mediaPlay" size="lg" />
                </span>
            </button>
            {onOpen ? (
                <button className={styles.card2Title} onClick={onOpen} type="button">
                    {mix.name}
                </button>
            ) : (
                <Text fw={700} truncate>
                    {mix.name}
                </Text>
            )}
            <Text isMuted lineClamp={2} size="sm">
                {sub}
            </Text>
        </div>
    );
};

export const MadeForYouShelf = ({ limit }: { limit?: number }) => {
    const recs = useMadeForYou().slice(0, limit);
    const partMap = useBestPartsStore((s) => s.parts);
    const navigate = useNavigate();
    if (!recs.length) return null;
    return (
        <div className={styles.shelf}>
            {recs.map((r) => (
                <div key={r.id}>
                    <PlaylistCard
                        badge="For you"
                        mix={{ name: r.title, partIds: r.partIds }}
                        onPlay={() => playList(r.partIds, r.title)}
                        sub={`${r.why}. ${r.partIds.length} parts, ${formatClock(length(r.partIds.map((id) => partMap[id]).filter(Boolean)))}.`}
                    />
                    <Button
                        leftSection={<Icon icon="add" size="sm" />}
                        mt={6}
                        onClick={() =>
                            navigate(
                                generatePath(AppRoute.BEST_PARTS_MIX, { mixId: saveSuggestion(r) }),
                            )
                        }
                        size="compact-sm"
                        variant="subtle"
                    >
                        Keep it
                    </Button>
                </div>
            ))}
        </div>
    );
};

// You steer: how much energy, how long. BolBeats fills it with the closest parts.
export const TuneYourOwn = () => {
    const partMap = useBestPartsStore((s) => s.parts);
    const [energy, setEnergy] = useState('0.5');
    const [minutes, setMinutes] = useState('10');
    const parts = Object.values(partMap);
    if (parts.length < 3) return null;
    const label = { '0': 'Calm', '0.5': 'Steady', '1': 'Hype' }[energy] ?? 'Mix';
    const go = () =>
        playList(tune(parts, Number(energy), Number(minutes)), `${label}, ${minutes} min`);
    return (
        <div className={styles.tune}>
            <div>
                <Text fw={700}>Tune your own</Text>
                <Text isMuted size="sm">
                    Pick a mood and a length; BolBeats picks the parts and the flow.
                </Text>
            </div>
            <SegmentedControl
                aria-label="Energy"
                data={[
                    { label: 'Calm', value: '0' },
                    { label: 'Steady', value: '0.5' },
                    { label: 'Hype', value: '1' },
                ]}
                onChange={setEnergy}
                value={energy}
            />
            <SegmentedControl
                aria-label="Length"
                data={[
                    { label: '5 min', value: '5' },
                    { label: '10 min', value: '10' },
                    { label: '20 min', value: '20' },
                ]}
                onChange={setMinutes}
                value={minutes}
            />
            <Button leftSection={<Icon icon="mediaPlay" />} onClick={go} variant="filled">
                Play
            </Button>
        </div>
    );
};

// Your full-song playlists that don't have a best-parts version yet.
export const PlaylistsToConvert = ({ heading }: { heading?: ReactNode }) => {
    const serverId = useAuthStore((s) => s.currentServer?.id);
    const mixes = useBestPartsStore((s) => s.mixes);
    const { data } = useQuery({
        enabled: !!serverId,
        queryFn: ({ signal }) =>
            api.controller.getPlaylistList({
                apiClientProps: { serverId: serverId!, signal },
                query: {
                    limit: 50,
                    sortBy: PlaylistListSort.UPDATED_AT,
                    sortOrder: SortOrder.DESC,
                    startIndex: 0,
                },
            }),
        queryKey: ['hookline', 'playlists-to-convert', serverId],
    });
    const todo = (data?.items ?? []).filter(
        (p) => !mixForPlaylist(mixes, p.id) && (p.songCount ?? 0) > 0,
    );
    if (!todo.length) return null;
    return (
        <>
            {heading}
            <ul className={styles.convert}>
                {todo.map((p) => (
                    <li key={p.id}>
                        <span>
                            <Text fw={600} truncate>
                                {p.name}
                            </Text>
                            <Text isMuted size="sm">
                                {p.songCount} songs
                            </Text>
                        </span>
                        <ActionIcon
                            aria-label={`Make a best-parts version of ${p.name}`}
                            icon="autoPick"
                            iconProps={{ size: 'md' }}
                            onClick={() => openPlaylistHooks(p.id, p.name)}
                            size="input-sm"
                            tooltip={{ label: 'Make best-parts version' }}
                            variant="default"
                        />
                    </li>
                ))}
            </ul>
        </>
    );
};
