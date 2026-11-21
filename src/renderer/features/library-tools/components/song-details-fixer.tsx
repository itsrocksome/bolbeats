import type { Song } from '/@/shared/types/domain-types';

// BolBeats: finds songs with missing details, looks them up online, lets you review, then writes the tags.
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import styles from '../library-tools.module.css';

import {
    setAutoDetails,
    undoAutoFix,
    useAutoDetails,
} from '/@/renderer/features/library-tools/auto-details';
import {
    type Cand,
    CONFIDENT,
    lookUpSong,
    writeDetails,
} from '/@/renderer/features/library-tools/details';
import {
    allLibrarySongs,
    fileName,
    needsDetails,
} from '/@/renderer/features/library-tools/library-songs';
import { rescanLibrary } from '/@/renderer/features/local-library/connect-local-library';
import { Button } from '/@/shared/components/button/button';
import { Checkbox } from '/@/shared/components/checkbox/checkbox';
import { Icon } from '/@/shared/components/icon/icon';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

type Row = { accept: boolean; cands: Cand[]; pick: number; song: Song };

export const SongDetailsFixer = () => {
    const [songs, setSongs] = useState<null | Song[]>(null);
    const [rows, setRows] = useState<Row[]>([]);
    const [phase, setPhase] = useState<'applying' | 'idle' | 'looking' | 'review'>('idle');
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        allLibrarySongs()
            .then((all) => setSongs(all.filter(needsDetails)))
            .catch(() => setSongs([]));
    }, [phase]);

    const lookUp = async () => {
        if (!songs?.length) return;
        setPhase('looking');
        const out: Row[] = [];
        for (const [i, song] of songs.entries()) {
            setProgress(i / songs.length);
            const cands = await lookUpSong(song);
            out.push({ accept: (cands[0]?.score ?? 0) >= CONFIDENT, cands, pick: 0, song });
            setRows([...out]);
        }
        setProgress(1);
        setPhase('review');
    };

    const update = (i: number, patch: Partial<Row>) =>
        setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

    const apply = async () => {
        const chosen = rows.filter((r) => r.accept && r.cands[r.pick] && r.song.path);
        if (!chosen.length) return;
        setPhase('applying');
        try {
            const backup = await window.api.onlineLookup.backupFiles(
                chosen.map((r) => r.song.path!),
            );
            let failed = 0;
            for (const [i, r] of chosen.entries()) {
                setProgress(i / chosen.length);
                if (!(await writeDetails(r.song, r.cands[r.pick]))) failed++;
            }
            await rescanLibrary();
            toast.success({
                message: `Updated ${chosen.length - failed} songs${failed ? `, ${failed} failed` : ''}. Originals are backed up in ${backup}.`,
                title: 'Song details saved',
            });
            setRows([]);
        } catch (e) {
            toast.error({
                message: `Nothing was lost; your files are unchanged or backed up. ${(e as Error).message}`,
                title: 'Couldn’t save details',
            });
        } finally {
            setPhase('idle');
        }
    };

    if (songs === null) return <Text isMuted>Checking your songs…</Text>;
    const accepted = rows.filter((r) => r.accept).length;

    return (
        <div className={styles.block}>
            <AutoDetailsPanel />
            {phase === 'idle' && !rows.length && (
                <div className={styles.callout}>
                    <Text size="lg">
                        {songs.length
                            ? `${songs.length} ${songs.length === 1 ? 'song is' : 'songs are'} missing an artist or album.`
                            : 'Every song has its details. Nice.'}
                    </Text>
                    {songs.length > 0 && (
                        <Button
                            leftSection={<Icon icon="search" />}
                            onClick={lookUp}
                            size="md"
                            variant="filled"
                        >
                            Look up details online
                        </Button>
                    )}
                    <Text isMuted size="sm">
                        Sends only song and artist names to iTunes Search and MusicBrainz. You
                        review every change before it is written, and originals are backed up first.
                        Clear matches are already filled in on their own (see above).
                    </Text>
                </div>
            )}

            {(phase === 'looking' || phase === 'applying') && (
                <div
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={Math.round(progress * 100)}
                    className={styles.progress}
                    role="progressbar"
                >
                    <span style={{ transform: `scaleX(${progress})` }} />
                    <Text size="sm">
                        {phase === 'looking'
                            ? 'Looking up songs…'
                            : 'Writing details and rescanning…'}
                    </Text>
                </div>
            )}

            {rows.length > 0 && (
                <>
                    <ul className={styles.rows}>
                        {rows.map((r, i) => {
                            const c = r.cands[r.pick];
                            return (
                                <li
                                    className={clsx(styles.row, !r.accept && styles.skipped)}
                                    key={r.song.id}
                                >
                                    <Checkbox
                                        aria-label={`Use the details found for ${fileName(r.song)}`}
                                        checked={r.accept}
                                        disabled={!c || phase !== 'review'}
                                        onChange={(e) =>
                                            update(i, { accept: e.currentTarget.checked })
                                        }
                                    />
                                    <Text
                                        className={styles.from}
                                        isMuted
                                        size="sm"
                                        title={fileName(r.song)}
                                    >
                                        {fileName(r.song)}
                                    </Text>
                                    {c ? (
                                        <>
                                            {c.artworkUrl ? (
                                                <img
                                                    alt=""
                                                    className={styles.art}
                                                    src={c.artworkUrl}
                                                />
                                            ) : (
                                                <span className={styles.art} />
                                            )}
                                            <div className={styles.to}>
                                                <Text fw={600} truncate>
                                                    {c.title}
                                                </Text>
                                                <Text isMuted size="sm" truncate>
                                                    {[c.artist, c.album, c.year]
                                                        .filter(Boolean)
                                                        .join(', ')}
                                                </Text>
                                            </div>
                                            <span
                                                className={clsx(
                                                    styles.score,
                                                    c.score >= CONFIDENT && styles.good,
                                                )}
                                            >
                                                {Math.round(c.score * 100)}% match
                                            </span>
                                            {r.cands.length > 1 ? (
                                                <Select
                                                    aria-label="Other matches"
                                                    className={styles.alt}
                                                    data={r.cands.map((x, j) => ({
                                                        label: `${x.title} - ${x.artist} (${x.source})`,
                                                        value: String(j),
                                                    }))}
                                                    onChange={(v) =>
                                                        v &&
                                                        update(i, { accept: true, pick: Number(v) })
                                                    }
                                                    size="xs"
                                                    value={String(r.pick)}
                                                />
                                            ) : (
                                                <span />
                                            )}
                                        </>
                                    ) : (
                                        <Text className={styles.to} isMuted size="sm">
                                            {phase === 'looking'
                                                ? 'Looking…'
                                                : 'No match found. Fix it by hand with Edit metadata.'}
                                        </Text>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                    {phase === 'review' && (
                        <div className={styles.actions}>
                            <Button disabled={!accepted} onClick={apply} size="md" variant="filled">
                                Save details for {accepted} songs
                            </Button>
                            <Button
                                onClick={() => (setRows([]), setPhase('idle'))}
                                variant="subtle"
                            >
                                Cancel
                            </Button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

// BolBeats: the automatic fixer's switch and its recent changes, each with Undo.
const AutoDetailsPanel = () => {
    const { fixed, on, running } = useAutoDetails();
    return (
        <div className={styles.auto}>
            <Switch
                checked={on}
                description="A song with no artist, album or cover is looked up online; a clear match is written into the file. Unsure ones wait for you below."
                label="Fill in missing details and covers automatically"
                onChange={(e) => setAutoDetails(e.currentTarget.checked)}
            />
            {running && (
                <Text isMuted size="sm">
                    Looking up songs…
                </Text>
            )}
            {fixed.length > 0 && (
                <ul aria-label="Filled in automatically" className={styles.fixed}>
                    {fixed.slice(0, 8).map((f) => (
                        <li key={`${f.path}-${f.when}`}>
                            <Text size="sm" truncate>
                                {f.what === 'cover' ? 'Cover added: ' : ''}
                                <b>{f.title}</b> by {f.artist}
                                {f.what !== 'cover' && (
                                    <span className={styles.from}> (was “{f.file}”)</span>
                                )}
                            </Text>
                            <Button
                                onClick={() =>
                                    undoAutoFix(f).catch((e) =>
                                        toast.error({
                                            message: (e as Error).message,
                                            title: 'Couldn’t undo',
                                        }),
                                    )
                                }
                                size="compact-sm"
                                variant="subtle"
                            >
                                Undo
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
