import type { Song } from '/@/shared/types/domain-types';
import type { ChartSong } from '/@/shared/types/online-lookup';

// BolBeats: what people are playing right now in a country's Apple Music store, with 30-second store previews
// (Apple allows previews only beside a store link, so every preview sits next to one). Songs already in your
// library play from your library instead.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import styles from './news.module.css';

import { allLibrarySongs } from '/@/renderer/features/library-tools/library-songs';
import { matchScore } from '/@/renderer/features/library-tools/match';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Text } from '/@/shared/components/text/text';
import { Play, PlayerStatus } from '/@/shared/types/types';

const regionName = (cc: string) =>
    new Intl.DisplayNames(undefined, { type: 'region' }).of(cc) ?? cc;
const baseTitle = (t: string) =>
    t.replace(/\s*[([](from|feat|ft)\b[^)\]]*[)\]]/gi, '').replace(/\s*\[[^\]]*\]$/, '');

export const Charts = () => {
    // BolBeats: one preview player per chart, made on first use
    const previewRef = useRef<HTMLAudioElement | null>(null);
    const audio = () => (previewRef.current ??= new Audio());
    const { addToQueueByData } = usePlayer();
    const [country, setCountry] = useState('');
    const [playing, setPlaying] = useState<null | string>(null);
    const { data: home } = useQuery({
        queryFn: () => window.api.onlineLookup.country(),
        queryKey: ['bolify-country'],
        staleTime: Infinity,
    });
    const cc = country || home || 'US';
    const chart = useQuery({
        enabled: !!home,
        queryFn: () => window.api.onlineLookup.chart(cc),
        queryKey: ['bolify-chart', cc],
        retry: 1,
        staleTime: 6 * 60 * 60 * 1000,
    });
    const { data: library } = useQuery({
        queryFn: allLibrarySongs,
        queryKey: ['bolify-library-songs'],
        staleTime: 60_000,
    });

    const owned = useMemo(() => {
        const out = new Map<string, Song>();
        for (const c of chart.data ?? []) {
            const hit = library?.find(
                (s) =>
                    matchScore([baseTitle(c.title), c.artist], {
                        artist: s.artistName,
                        title: baseTitle(s.name),
                    }) >= 0.62,
            );
            if (hit) out.set(c.id, hit);
        }
        return out;
    }, [chart.data, library]);

    useEffect(() => {
        const stop = () => setPlaying(null);
        audio().addEventListener('ended', stop);
        return () => {
            audio().removeEventListener('ended', stop);
            audio().pause(); // leaving the page stops the preview
        };
    }, []);

    const toggle = (c: ChartSong) => {
        if (playing === c.id) {
            audio().pause();
            setPlaying(null);
            return;
        }
        const player = usePlayerStoreBase.getState();
        if (player.player.status === PlayerStatus.PLAYING) player.mediaPause();
        audio().src = c.previewUrl!;
        audio().volume = Math.min(1, (player.player.volume ?? 50) / 100);
        audio()
            .play()
            .catch(() => setPlaying(null));
        setPlaying(c.id);
    };

    const regions = [...new Set(['GB', home ?? 'US', 'IN', 'US'])];

    return (
        <section aria-labelledby="charts-title">
            <div className={styles.chartsHead}>
                <h2 id="charts-title">Top songs in {regionName(cc)}</h2>
                <SegmentedControl
                    aria-label="Chart country"
                    data={regions.map((r) => ({ label: regionName(r), value: r }))}
                    onChange={setCountry}
                    size="xs"
                    value={cc}
                />
            </div>
            {chart.isLoading && <Text isMuted>Loading the chart…</Text>}
            {chart.isError && (
                <Text isMuted>
                    The chart didn’t load. Check your internet connection, then open this page
                    again.
                </Text>
            )}
            <ol className={styles.chart}>
                {(chart.data ?? []).map((c) => {
                    const mine = owned.get(c.id);
                    return (
                        <li className={clsx(playing === c.id && styles.playing)} key={c.id}>
                            <span className={styles.rank}>{c.rank}</span>
                            {c.artworkUrl ? (
                                <img
                                    alt=""
                                    className={styles.chartArt}
                                    loading="lazy"
                                    src={c.artworkUrl}
                                />
                            ) : (
                                <span className={styles.chartArt} />
                            )}
                            <span className={styles.chartText}>
                                <Text fw={600} truncate>
                                    {c.title}
                                </Text>
                                <Text isMuted size="sm" truncate>
                                    {c.artist}
                                    {c.genre ? ` · ${c.genre}` : ''}
                                </Text>
                            </span>
                            {mine ? (
                                <button
                                    className={styles.owned}
                                    onClick={() => addToQueueByData([mine], Play.NOW)}
                                    type="button"
                                >
                                    In your library · Play
                                </button>
                            ) : (
                                c.previewUrl && (
                                    <ActionIcon
                                        icon={playing === c.id ? 'mediaStop' : 'mediaPlay'}
                                        onClick={() => toggle(c)}
                                        tooltip={{
                                            label:
                                                playing === c.id
                                                    ? 'Stop preview'
                                                    : `Play a 30-second preview of ${c.title}`,
                                        }}
                                        variant="default"
                                    />
                                )
                            )}
                            <a
                                className={styles.store}
                                href={c.storeUrl}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {c.price ? `Buy ${c.price}` : 'Apple Music'}
                            </a>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
};
