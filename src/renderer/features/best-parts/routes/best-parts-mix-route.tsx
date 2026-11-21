// BolBeats: one part mix: order, transitions per seam (reroll / pick / preview), playback.
import { closeAllModals, openModal } from '@mantine/modals';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { generatePath, Link, useNavigate, useParams } from 'react-router';

import { api } from '/@/renderer/api';
import { openAddToMix } from '/@/renderer/features/best-parts/components/add-to-mix-modal';
import styles from '/@/renderer/features/best-parts/components/best-parts.module.css';
import {
    Cover,
    facts,
    NowPlaying,
    openPartEditor,
    openSongMenu,
    partLength,
    Poster,
    QuickKeySelect,
} from '/@/renderer/features/best-parts/components/shared';
import { TRANSITIONS, type TransitionType } from '/@/renderer/features/best-parts/engine/engine';
import {
    flowOf,
    mashupOrder,
    playMixById,
    playParts,
    prepareParts,
    saveMixAsFile,
    seam,
    seamKey,
    smartOrder,
    toggleMixPause,
    useMixPlayer,
} from '/@/renderer/features/best-parts/mix-player';
import {
    ALL_PARTS_MIX,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { openCoverPicker } from '/@/renderer/features/covers/cover-modal';
import { mixCoverKey } from '/@/renderer/features/covers/covers.store';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { useAuthStore } from '/@/renderer/store/auth.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { ConfirmModal } from '/@/shared/components/modal/modal';
import { Select } from '/@/shared/components/select/select';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const MixRoute = () => {
    const { mixId = ALL_PARTS_MIX } = useParams();
    const navigate = useNavigate();
    const partMap = useBestPartsStore((s) => s.parts);
    const mix = useBestPartsStore((s) => s.mixes[mixId]);
    const { createMix, deleteMix, updateMix } = useBestPartsStore.getState();
    const player = useMixPlayer();
    const isAll = mixId === ALL_PARTS_MIX;
    const [renaming, setRenaming] = useState(false);
    const [saving, setSaving] = useState(false);
    const [openJoin, setOpenJoin] = useState<null | number>(null);
    const [drag, setDrag] = useState<null | number>(null);
    const [over, setOver] = useState<null | number>(null);

    // "All best parts" is a real mix record so its order and transition picks are remembered;
    // it follows the part library: new parts join in the smart order, deleted ones leave.
    useEffect(() => {
        if (!isAll) return;
        const all = Object.values(partMap);
        const ids = new Set(all.map((p) => p.id));
        const cur = useBestPartsStore.getState().mixes[ALL_PARTS_MIX];
        const kept = cur?.partIds.filter((id) => ids.has(id)) ?? [];
        if (cur && kept.length === ids.size && kept.length === cur.partIds.length) return;
        const partIds = kept.length === ids.size ? kept : smartOrder(all);
        if (!cur)
            useBestPartsStore.setState((s) => ({
                mixes: {
                    ...s.mixes,
                    [ALL_PARTS_MIX]: {
                        created: 0,
                        id: ALL_PARTS_MIX,
                        name: 'All best parts',
                        partIds,
                        picks: {},
                    },
                },
            }));
        else updateMix(ALL_PARTS_MIX, { partIds });
    }, [isAll, partMap, updateMix]);

    const parts = useMemo(
        () => (mix?.partIds ?? []).map((id) => partMap[id]).filter(Boolean),
        [mix, partMap],
    );
    const serverId = useAuthStore((s) => s.currentServer?.id);
    const { data: source } = useQuery({
        enabled: !!mix?.sourcePlaylistId && !!serverId,
        queryFn: () =>
            api.controller.getPlaylistDetail({
                apiClientProps: { serverId: serverId! },
                query: { id: mix!.sourcePlaylistId! },
            }),
        queryKey: ['hookline', 'source-playlist', serverId, mix?.sourcePlaylistId],
    });

    useEffect(() => {
        prepareParts(parts);
    }, [parts]);

    if (!mix) {
        return (
            <AnimatedPage scroll>
                <section className={styles.empty}>
                    <h1>This mix doesn’t exist anymore</h1>
                    <Button onClick={() => navigate(AppRoute.BEST_PARTS)} variant="filled">
                        Back to best parts
                    </Button>
                </section>
            </AnimatedPage>
        );
    }

    const picks = mix.picks;
    const isThis = player.mixId === mix.id && player.status !== 'idle';
    const playingId = isThis && !player.preview ? player.partIds[player.index] : null;
    // any change by hand makes the playlist yours: the "Picked by BolBeats" badge goes
    const setOrder = (partIds: string[]) => updateMix(mix.id, { auto: false, partIds });
    const moveTo = (from: number, to: number) => {
        if (to < 0 || to >= parts.length || from === to) return;
        const ids = [...mix.partIds];
        const [id] = ids.splice(from, 1);
        ids.splice(to, 0, id);
        setOrder(ids);
    };
    const remove = (id: string) => setOrder(mix.partIds.filter((x) => x !== id));
    const pick = (i: number, type: TransitionType) =>
        updateMix(mix.id, { picks: { ...picks, [seamKey(parts[i], parts[i + 1])]: type } });
    const preview = (i: number, nextPicks = picks) =>
        playParts(parts, nextPicks, { label: `${mix.name}: preview`, mixId: mix.id, preview: i });
    const reroll = (i: number) => {
        const s = seam(parts[i], parts[i + 1], picks);
        const next = s.all[(s.all.indexOf(s.pick) + 1) % s.all.length];
        const nextPicks = { ...picks, [seamKey(parts[i], parts[i + 1])]: next.type };
        updateMix(mix.id, { picks: nextPicks });
        preview(i, nextPicks);
    };
    const playFrom = (i: number) => playMixById(mix.id, i);
    const exportMix = async () => {
        setSaving(true);
        try {
            await saveMixAsFile(parts, picks, mix.name);
        } catch (e) {
            toast.error({ message: (e as Error).message, title: 'Couldn’t save the mix' });
        } finally {
            setSaving(false);
        }
    };
    const duplicate = () => navigate(`/best-parts/${createMix(`${mix.name} copy`, mix.partIds)}`);
    const askDelete = () =>
        openModal({
            children: (
                <ConfirmModal
                    onConfirm={() => (
                        closeAllModals(),
                        deleteMix(mix.id),
                        navigate(AppRoute.BEST_PARTS)
                    )}
                >
                    <Text>
                        Delete “{mix.name}”? Its best parts stay in Best parts; only this playlist
                        goes.
                    </Text>
                </ConfirmModal>
            ),
            title: 'Delete best-parts playlist',
        });
    const hasRepeats = new Set(parts.map((p) => p.songId)).size < parts.length;
    const drop = (to: number) => {
        if (drag != null) moveTo(drag, drag < to ? to - 1 : to);
        setDrag(null);
        setOver(null);
    };

    return (
        <AnimatedPage scroll>
            <div className={styles.mixPage}>
                <button
                    className={styles.back}
                    onClick={() => navigate(AppRoute.BEST_PARTS)}
                    type="button"
                >
                    <Icon icon="arrowLeftS" /> Best parts
                </button>
                <div className={styles.mixLayout}>
                    <aside className={styles.mixSide}>
                        <button
                            aria-label="Change cover"
                            className={styles.heroCoverButton}
                            onClick={() => openCoverPicker(mixCoverKey(mix.id), mix.name)}
                            title="Change cover"
                            type="button"
                        >
                            <Poster
                                badge={mix.auto ? 'Picked by BolBeats' : undefined}
                                className={styles.heroArt}
                                coverKey={mixCoverKey(mix.id)}
                                name={mix.name}
                                parts={parts}
                            />
                            <span aria-hidden className={styles.heroCoverHint}>
                                <Icon icon="image" size="sm" /> Change cover
                            </span>
                        </button>
                        <div className={styles.mixTitle}>
                            {renaming && !isAll ? (
                                <TextInput
                                    aria-label="Playlist name"
                                    autoFocus
                                    defaultValue={mix.name}
                                    onBlur={(e) => (
                                        updateMix(mix.id, {
                                            name: e.currentTarget.value.trim() || mix.name,
                                        }),
                                        setRenaming(false)
                                    )}
                                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                    size="md"
                                />
                            ) : (
                                <h1
                                    onDoubleClick={() => !isAll && setRenaming(true)}
                                    title={isAll ? undefined : 'Double-click to rename'}
                                >
                                    {mix.name}
                                </h1>
                            )}
                            <Text isMuted size="sm">
                                {parts.length} {parts.length === 1 ? 'part' : 'parts'}, about{' '}
                                {formatClock(partLength(parts))}
                                {parts.length > 1 && (
                                    <span title="How well each part flows into the next, on average">
                                        {' '}
                                        · flows {Math.round(flowOf(parts) * 100)}%
                                    </span>
                                )}
                                {source && (
                                    <>
                                        {' · from '}
                                        <Link
                                            className={styles.sourceLink}
                                            to={generatePath(AppRoute.PLAYLISTS_DETAIL_SONGS, {
                                                playlistId: source.id,
                                            })}
                                        >
                                            {source.name}
                                        </Link>
                                    </>
                                )}
                            </Text>
                        </div>
                        <div className={styles.mixActions}>
                            {isThis && !player.preview ? (
                                <Button
                                    leftSection={
                                        <Icon
                                            icon={
                                                player.status === 'playing'
                                                    ? 'mediaPause'
                                                    : 'mediaPlay'
                                            }
                                        />
                                    }
                                    onClick={toggleMixPause}
                                    size="md"
                                    variant="filled"
                                >
                                    {player.status === 'playing' ? 'Pause' : 'Resume'}
                                </Button>
                            ) : (
                                <Button
                                    disabled={parts.length < 1}
                                    leftSection={<Icon icon="mediaPlay" />}
                                    onClick={() => playFrom(0)}
                                    size="md"
                                    variant="filled"
                                >
                                    Play
                                </Button>
                            )}
                            <DropdownMenu position="bottom-start">
                                <DropdownMenu.Target>
                                    <Button
                                        disabled={parts.length < 2}
                                        leftSection={<Icon icon="sort" />}
                                        size="md"
                                        variant="default"
                                    >
                                        Order
                                    </Button>
                                </DropdownMenu.Target>
                                <DropdownMenu.Dropdown>
                                    <DropdownMenu.Item
                                        leftSection={<Icon icon="refresh" />}
                                        onClick={() => setOrder(smartOrder(parts))}
                                    >
                                        Smoothest flow (each song’s parts together)
                                    </DropdownMenu.Item>
                                    {hasRepeats && (
                                        <DropdownMenu.Item
                                            leftSection={<Icon icon="autoPick" />}
                                            onClick={() => setOrder(mashupOrder(parts))}
                                        >
                                            Mashup (songs take turns where they fit)
                                        </DropdownMenu.Item>
                                    )}
                                    <DropdownMenu.Item
                                        leftSection={<Icon icon="mediaShuffle" />}
                                        onClick={() => setOrder(smartOrder(parts, true))}
                                    >
                                        Shuffle
                                    </DropdownMenu.Item>
                                </DropdownMenu.Dropdown>
                            </DropdownMenu>
                            <DropdownMenu position="bottom-end">
                                <DropdownMenu.Target>
                                    <ActionIcon
                                        aria-label="More for this playlist"
                                        icon="ellipsisHorizontal"
                                        iconProps={{ size: 'lg' }}
                                        size="input-md"
                                        tooltip={{ label: 'More' }}
                                        variant="default"
                                    />
                                </DropdownMenu.Target>
                                <DropdownMenu.Dropdown>
                                    {!isAll && (
                                        <DropdownMenu.Item
                                            leftSection={<Icon icon="plus" />}
                                            onClick={() => openAddToMix(mix.id)}
                                        >
                                            Add songs…
                                        </DropdownMenu.Item>
                                    )}
                                    {!isAll && (
                                        <DropdownMenu.Item
                                            leftSection={<Icon icon="edit" />}
                                            onClick={() => setRenaming(true)}
                                        >
                                            Rename
                                        </DropdownMenu.Item>
                                    )}
                                    <DropdownMenu.Item
                                        disabled={!parts.length || saving}
                                        leftSection={<Icon icon="download" />}
                                        onClick={exportMix}
                                    >
                                        {saving ? 'Saving…' : 'Save as audio file'}
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Item
                                        leftSection={<Icon icon="add" />}
                                        onClick={duplicate}
                                    >
                                        Save a copy to edit
                                    </DropdownMenu.Item>
                                    {!isAll && <DropdownMenu.Divider />}
                                    {!isAll && (
                                        <DropdownMenu.Item
                                            isDanger
                                            leftSection={<Icon icon="delete" />}
                                            onClick={askDelete}
                                        >
                                            Delete this playlist
                                        </DropdownMenu.Item>
                                    )}
                                </DropdownMenu.Dropdown>
                            </DropdownMenu>
                        </div>
                        {!isAll && (
                            <div className={styles.sideWide}>
                                <QuickKeySelect mixId={mix.id} />
                            </div>
                        )}
                        <NowPlaying mixId={mix.id} />
                    </aside>

                    <section aria-label="Parts" className={styles.mixMain}>
                        <div className={styles.listHead}>
                            <Text isMuted size="sm">
                                {parts.length > 1
                                    ? 'Drag to reorder. Click a number to play from there.'
                                    : 'Add at least two parts to hear the joins.'}
                            </Text>
                            {!isAll && (
                                <Button
                                    leftSection={<Icon icon="plus" />}
                                    onClick={() => openAddToMix(mix.id)}
                                    size="compact-sm"
                                    variant="default"
                                >
                                    Add songs
                                </Button>
                            )}
                        </div>
                        <ol className={styles.tape}>
                            {parts.map((p, i) => {
                                const s =
                                    i < parts.length - 1 ? seam(p, parts[i + 1], picks) : null;
                                const fit = s ? Math.round(s.f.total * 100) : 0;
                                return (
                                    <li
                                        className={clsx(
                                            over === i && drag !== i && styles.dropHere,
                                            drag === i && styles.dragging,
                                        )}
                                        draggable={!renaming}
                                        key={p.id}
                                        onDragEnd={() => (setDrag(null), setOver(null))}
                                        onDragOver={(e) => (e.preventDefault(), setOver(i))}
                                        onDragStart={(e) => (
                                            setDrag(i),
                                            (e.dataTransfer.effectAllowed = 'move')
                                        )}
                                        onDrop={(e) => (e.preventDefault(), drop(i))}
                                    >
                                        <div
                                            className={clsx(
                                                styles.row,
                                                playingId === p.id && styles.isPlaying,
                                            )}
                                            onContextMenu={(e) => openSongMenu(p.songId, e)}
                                        >
                                            <button
                                                aria-label={`Play from ${p.title}`}
                                                className={styles.rowPlay}
                                                onClick={() => playFrom(i)}
                                                title="Play from here"
                                                type="button"
                                            >
                                                <span className={styles.num}>{i + 1}</span>
                                                <Icon className={styles.numPlay} icon="mediaPlay" />
                                            </button>
                                            <Cover part={p} />
                                            <div className={styles.songMeta} title={facts(p)}>
                                                <Text fw={600} truncate>
                                                    {p.title}
                                                </Text>
                                                <Text isMuted size="sm" truncate>
                                                    {p.artist || 'Unknown artist'} ·{' '}
                                                    {formatClock(p.start)}–{formatClock(p.end)} ·{' '}
                                                    {Math.round(p.end - p.start)} s
                                                </Text>
                                            </div>
                                            <span className={styles.rowBtns}>
                                                <ActionIcon
                                                    icon="edit"
                                                    onClick={() => openPartEditor(p, mix.id)}
                                                    tooltip={{ label: 'Change this part' }}
                                                    variant="subtle"
                                                />
                                                {!isAll && (
                                                    <ActionIcon
                                                        icon="x"
                                                        onClick={() => remove(p.id)}
                                                        tooltip={{
                                                            label: 'Remove from this playlist',
                                                        }}
                                                        variant="subtle"
                                                    />
                                                )}
                                                <DropdownMenu position="bottom-end">
                                                    <DropdownMenu.Target>
                                                        <ActionIcon
                                                            aria-label={`More for ${p.title}`}
                                                            icon="ellipsisHorizontal"
                                                            tooltip={{ label: 'More' }}
                                                            variant="subtle"
                                                        />
                                                    </DropdownMenu.Target>
                                                    <DropdownMenu.Dropdown>
                                                        <DropdownMenu.Item
                                                            leftSection={<Icon icon="mediaPlay" />}
                                                            onClick={() => playFrom(i)}
                                                        >
                                                            Play from here
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Item
                                                            disabled={i === 0}
                                                            leftSection={<Icon icon="arrowUp" />}
                                                            onClick={() => moveTo(i, i - 1)}
                                                        >
                                                            Move up
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Item
                                                            disabled={i === parts.length - 1}
                                                            leftSection={<Icon icon="arrowDown" />}
                                                            onClick={() => moveTo(i, i + 1)}
                                                        >
                                                            Move down
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Item
                                                            disabled={i === 0}
                                                            leftSection={
                                                                <Icon icon="arrowUpToLine" />
                                                            }
                                                            onClick={() => moveTo(i, 0)}
                                                        >
                                                            Move to the top
                                                        </DropdownMenu.Item>
                                                        <DropdownMenu.Item
                                                            leftSection={<Icon icon="edit" />}
                                                            onClick={() =>
                                                                openPartEditor(p, mix.id)
                                                            }
                                                        >
                                                            Change this part…
                                                        </DropdownMenu.Item>
                                                        {!isAll && (
                                                            <DropdownMenu.Item
                                                                isDanger
                                                                leftSection={<Icon icon="x" />}
                                                                onClick={() => remove(p.id)}
                                                            >
                                                                Remove from this playlist
                                                            </DropdownMenu.Item>
                                                        )}
                                                        <DropdownMenu.Divider />
                                                        <DropdownMenu.Item
                                                            leftSection={
                                                                <Icon icon="ellipsisHorizontal" />
                                                            }
                                                            onClick={(e) =>
                                                                openSongMenu(p.songId, e)
                                                            }
                                                        >
                                                            Song options (queue, playlists…)
                                                        </DropdownMenu.Item>
                                                    </DropdownMenu.Dropdown>
                                                </DropdownMenu>
                                            </span>
                                        </div>
                                        {s && (
                                            <div
                                                className={styles.join}
                                                style={{ ['--fit' as string]: s.f.total }}
                                            >
                                                <button
                                                    aria-expanded={openJoin === i}
                                                    className={styles.joinChip}
                                                    onClick={() =>
                                                        setOpenJoin(openJoin === i ? null : i)
                                                    }
                                                    title="How these two parts join. Click to change."
                                                    type="button"
                                                >
                                                    <i aria-hidden className={styles.fitDot} />
                                                    {fit}% · {TRANSITIONS[s.pick.type]}
                                                    <Icon
                                                        icon={
                                                            openJoin === i
                                                                ? 'arrowUpS'
                                                                : 'arrowDownS'
                                                        }
                                                        size="sm"
                                                    />
                                                </button>
                                                {openJoin === i && (
                                                    <div className={styles.joinPanel}>
                                                        <Select
                                                            allowDeselect={false}
                                                            aria-label="Transition"
                                                            className={styles.pick}
                                                            data={s.all.map((c) => ({
                                                                label: TRANSITIONS[c.type],
                                                                value: c.type,
                                                            }))}
                                                            onChange={(v) =>
                                                                v && pick(i, v as TransitionType)
                                                            }
                                                            size="xs"
                                                            value={s.pick.type}
                                                        />
                                                        <Button
                                                            leftSection={
                                                                <Icon icon="refresh" size="sm" />
                                                            }
                                                            onClick={() => reroll(i)}
                                                            size="compact-sm"
                                                            variant="default"
                                                        >
                                                            Try another
                                                        </Button>
                                                        <Button
                                                            leftSection={
                                                                <Icon icon="mediaPlay" size="sm" />
                                                            }
                                                            onClick={() => preview(i)}
                                                            size="compact-sm"
                                                            variant="default"
                                                        >
                                                            Hear this join
                                                        </Button>
                                                        <Text
                                                            className={styles.why}
                                                            isMuted
                                                            size="sm"
                                                        >
                                                            {s.pick.why}
                                                        </Text>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                    </section>
                </div>
            </div>
        </AnimatedPage>
    );
};

const MixRouteWithBoundary = () => (
    <PageErrorBoundary>
        <MixRoute />
    </PageErrorBoundary>
);

export default MixRouteWithBoundary;
