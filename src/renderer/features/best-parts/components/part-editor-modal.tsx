import type { Song } from '/@/shared/types/domain-types';
// BolBeats: mark one or more best parts of a song on its waveform.
import type { ContextModalProps } from '@mantine/modals';

import clsx from 'clsx';
import { nanoid } from 'nanoid/non-secure';
import {
    type PointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useShallow } from 'zustand/react/shallow';

import styles from './part-editor-modal.module.css';

import { snapQuiet, toMono } from '/@/renderer/features/best-parts/engine/engine';
import { suggestHooksAsync } from '/@/renderer/features/best-parts/engine/hook-async';
import {
    analyzeBuffer,
    decodeSong,
    forgetPart,
    playRange,
    slice,
} from '/@/renderer/features/best-parts/mix-player';
import {
    type BestPart,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { learnedTaste } from '/@/renderer/features/best-parts/store/taste.store';
import { editedPart } from '/@/renderer/features/best-parts/store/taste.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Slider } from '/@/shared/components/slider/slider';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const MIN_LEN = 3;
const cssVar = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// BolBeats: a part added while editing from a best-parts playlist joins that playlist, after the song's other parts
const addToMix = (mixId: string, p: BestPart) => {
    const { mixes, parts, updateMix } = useBestPartsStore.getState();
    const ids = mixes[mixId]?.partIds;
    if (!ids || ids.includes(p.id)) return;
    const last = ids.findLastIndex((i) => parts[i]?.songId === p.songId);
    updateMix(mixId, {
        partIds:
            last < 0 ? [...ids, p.id] : [...ids.slice(0, last + 1), p.id, ...ids.slice(last + 1)],
    });
};

export const PartEditorModal = ({
    context,
    id,
    innerProps,
}: ContextModalProps<{ mixId?: string; song: Song }>) => (
    <PartEditor
        onDone={() => context.closeModal(id)}
        onNewPart={innerProps.mixId ? (p) => addToMix(innerProps.mixId!, p) : undefined}
        song={innerProps.song}
    />
);

type PartEditorProps = {
    doneLabel?: string;
    footerStart?: ReactNode; // e.g. the builder's "song 3 of 12" and Back/Skip
    onDone: () => void;
    onNewPart?: (p: BestPart) => void;
    song: Song;
};

export const PartEditor = ({
    doneLabel = 'Done',
    footerStart,
    onDone,
    onNewPart,
    song,
}: PartEditorProps) => {
    const parts = useBestPartsStore(
        useShallow((s) =>
            Object.values(s.parts)
                .filter((p) => p.songId === song.id)
                .sort((a, b) => a.start - b.start),
        ),
    );
    const [buf, setBuf] = useState<AudioBuffer | null>(null);
    const [error, setError] = useState<null | string>(null);
    const [sel, setSel] = useState<[number, number]>([0, 0]);
    const [found, setFound] = useState<[number, number][]>([]); // BolBeats' suggested parts, in song order
    const [editingId, setEditingId] = useState<null | string>(null);
    const [snap, setSnap] = useState(true);
    const [playing, setPlaying] = useState(false);
    const [saving, setSaving] = useState(false);
    // BolBeats: listen first, then mark. `head` is where listening starts (and follows the music while it plays);
    // listening plays the song on from there, previewing plays just the selection
    const [head, setHead] = useState(0);
    const listening = useRef(false);
    const downSel = useRef<null | { editing: null | string; sel: [number, number] }>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const preview = useRef<null | ReturnType<typeof playRange>>(null);
    const drag = useRef<null | { anchor?: number; edge?: 0 | 1 }>(null);

    const mono = useMemo(
        () =>
            buf &&
            toMono(
                Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)),
                buf.sampleRate,
            ),
        [buf],
    );
    const dur = buf?.duration ?? song.duration / 1000;

    const selectPart = useCallback((p: BestPart) => {
        setEditingId(p.id);
        setSel([p.start, p.end]);
    }, []);

    const newPart = useCallback(
        (after?: BestPart) => {
            const start = after ? Math.min(after.end + 5, Math.max(0, dur - 30)) : dur * 0.4;
            setEditingId(null);
            setSel([start, Math.min(dur, start + 30)]);
        },
        [dur],
    );

    // The part finder (in the background): the hook first, plus any other section that sounds different and stands out.
    const suggest = useCallback(() => {
        if (!buf) return;
        setEditingId(null);
        suggestHooksAsync(buf, undefined, learnedTaste().minPart ?? undefined).then((all) => {
            setSel(all[0]);
            setFound([...all].sort(([a], [b]) => a - b));
        });
    }, [buf]);

    useEffect(() => {
        let alive = true;
        decodeSong(song.id)
            .then((b) => alive && setBuf(b))
            .catch((e: Error) => alive && setError(e.message));
        return () => {
            alive = false;
            preview.current?.stop();
        };
    }, [song.id]);

    // First open: edit the first saved part, or propose a new one.
    useEffect(() => {
        if (!buf) return;
        const first = useBestPartsStore.getState().parts;
        const mine = Object.values(first)
            .filter((p) => p.songId === song.id)
            .sort((a, b) => a.start - b.start);
        if (mine.length) selectPart(mine[0]);
        else setTimeout(suggest, 0); // let the waveform paint first
    }, [buf, selectPart, song.id, suggest]);

    const draw = useCallback(() => {
        const cv = canvas.current;
        if (!cv || !mono) return;
        const dpr = devicePixelRatio || 1;
        const W = (cv.width = cv.clientWidth * dpr);
        const H = (cv.height = cv.clientHeight * dpr);
        const g = cv.getContext('2d')!;
        const accent = cssVar('--theme-colors-primary') || '#4d8bff';
        const wave = cssVar('--theme-colors-foreground-muted') || '#777';
        const fg = cssVar('--theme-colors-foreground') || '#fff';
        const x = (t: number) => (t / dur) * W;
        // saved parts (other than the one being edited)
        for (const [i, p] of parts.entries()) {
            if (p.id === editingId) continue;
            g.globalAlpha = 0.18;
            g.fillStyle = accent;
            g.fillRect(x(p.start), 0, x(p.end) - x(p.start), H);
            g.globalAlpha = 0.9;
            g.font = `${600} ${11 * dpr}px system-ui`;
            g.fillText(String(i + 1), x(p.start) + 5 * dpr, 14 * dpr);
        }
        const [a, b] = sel.map(x);
        g.globalAlpha = 0.16;
        g.fillStyle = accent;
        g.fillRect(a, 0, b - a, H);
        g.globalAlpha = 1;
        // marquee bulbs along the selected part, top and bottom
        g.save();
        g.shadowColor = accent;
        g.shadowBlur = 6 * dpr;
        for (let px = a + 6 * dpr; px < b - 3 * dpr; px += 12 * dpr) {
            for (const py of [7 * dpr, H - 7 * dpr]) {
                g.beginPath();
                g.arc(px, py, 2.6 * dpr, 0, Math.PI * 2);
                g.fill();
            }
        }
        g.restore();
        const bar = 2 * dpr;
        const step = bar + dpr;
        const cols = Math.floor(W / step);
        const per = mono.x.length / cols;
        // RMS per column, scaled to this song's loudest column, so loud masters still show their shape.
        const level = Array.from({ length: cols }, (_, i) => {
            let s = 0;
            let n = 0;
            for (let e = Math.floor((i + 1) * per), k = Math.floor(i * per); k < e; k += 4, n++)
                s += mono.x[k] ** 2;
            return Math.sqrt(s / (n || 1));
        });
        const peak = Math.max(...level) || 1;
        for (let i = 0; i < cols; i++) {
            const h = Math.max(dpr, (level[i] / peak) ** 1.5 * (H - 18 * dpr));
            const px = i * step;
            const inPart = parts.some((p) => px >= x(p.start) && px <= x(p.end));
            g.fillStyle = px >= a && px <= b ? accent : inPart ? fg : wave;
            g.globalAlpha = px >= a && px <= b ? 1 : inPart ? 0.55 : 0.4;
            g.fillRect(px, (H - h) / 2, bar, h);
        }
        g.globalAlpha = 1;
        g.fillStyle = fg;
        for (const px of [a, b]) g.fillRect(px - dpr, 0, 2 * dpr, H);
        if (preview.current) g.fillRect(x(preview.current.position()), 0, 2 * dpr, H);
        else if (head > 0) {
            // where Listen starts
            g.globalAlpha = 0.6;
            g.fillRect(x(head), 0, dpr, H);
            g.globalAlpha = 1;
        }
    }, [dur, editingId, head, mono, parts, sel]);

    useEffect(() => {
        draw();
        if (!playing) return;
        let raf = 0;
        const loop = () => {
            draw();
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [draw, playing]);

    useEffect(() => {
        if (!playing) return;
        const t = setInterval(() => {
            if (listening.current && preview.current) setHead(preview.current.position());
        }, 200);
        return () => clearInterval(t);
    }, [playing]);

    useEffect(() => {
        const ro = new ResizeObserver(draw);
        if (canvas.current) ro.observe(canvas.current);
        return () => ro.disconnect();
    }, [draw]);

    const stopPreview = () => {
        if (listening.current && preview.current) setHead(preview.current.position());
        preview.current?.stop();
        preview.current = null;
        listening.current = false;
        setPlaying(false);
    };
    const togglePreview = () => {
        if (!buf) return;
        if (preview.current && !listening.current) return stopPreview();
        stopPreview();
        preview.current = playRange(buf, sel[0], sel[1], stopPreview);
        setPlaying(true);
    };
    // play the song on from `from` (until you pause), with the playhead following
    const listen = (from: number) => {
        if (!buf) return;
        stopPreview();
        const at = Math.max(0, Math.min(dur - 0.5, from));
        listening.current = true;
        preview.current = playRange(buf, at, dur, stopPreview);
        setHead(at);
        setPlaying(true);
    };
    const now = () => (listening.current && preview.current ? preview.current.position() : head);

    const setRange = (a: number, b: number) => {
        const lo = Math.max(0, Math.min(a, b));
        const hi = Math.min(dur, Math.max(a, b));
        setSel([lo, hi]);
        if (preview.current && !listening.current) stopPreview(); // marking while listening keeps the music going
    };
    const markStart = () => {
        const t = now();
        setRange(t, sel[1] > t + 3 ? sel[1] : Math.min(dur, t + 30));
    };
    const markEnd = () => {
        const t = now();
        setRange(sel[0] < t - 3 ? sel[0] : Math.max(0, t - 30), t);
    };

    const timeAt = (e: PointerEvent) => {
        const r = e.currentTarget.getBoundingClientRect();
        return ((e.clientX - r.left) / r.width) * dur;
    };
    const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
        const t = timeAt(e);
        const near = (8 / e.currentTarget.clientWidth) * dur;
        e.currentTarget.setPointerCapture(e.pointerId);
        downSel.current = { editing: editingId, sel };
        if (Math.abs(t - sel[0]) < near) drag.current = { edge: 0 };
        else if (Math.abs(t - sel[1]) < near) drag.current = { edge: 1 };
        else {
            const hit = parts.find((p) => p.id !== editingId && t >= p.start && t <= p.end);
            if (hit) {
                selectPart(hit);
                drag.current = null;
                return;
            }
            setEditingId(null);
            drag.current = { anchor: t };
            setRange(t, t);
        }
    };
    const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
        const d = drag.current;
        if (!d) return;
        const t = timeAt(e);
        if (d.anchor != null) return setRange(d.anchor, t);
        const next: [number, number] = [...sel];
        next[d.edge!] = t;
        if (next[0] > next[1]) {
            next.reverse();
            d.edge = d.edge === 0 ? 1 : 0;
        }
        setRange(next[0], next[1]);
    };

    const nudge = (edge: 0 | 1, by: number) => {
        const next: [number, number] = [...sel];
        next[edge] += by;
        setRange(next[0], next[1]);
    };

    const store = (range: [number, number], editing: null | string) => {
        let [a, z] = range;
        if (snap) [a, z] = [snapQuiet(mono!.x, mono!.sr, a), snapQuiet(mono!.x, mono!.sr, z)];
        const partId = editing ?? nanoid();
        // BolBeats: trimming or extending a part BolBeats found teaches it your idea of a best part
        const before = editing ? useBestPartsStore.getState().parts[editing] : undefined;
        if (before?.auto) editedPart([before.start, before.end], [a, z]);
        const part: BestPart = {
            album: song.album,
            analysis: analyzeBuffer(slice(buf!, a, z)),
            artist: song.artistName,
            auto: false, // BolBeats: yours; its finder never changes it
            created: useBestPartsStore.getState().parts[partId]?.created ?? Date.now(),
            end: z,
            id: partId,
            imageUrl: song.imageUrl,
            songDuration: buf!.duration,
            songId: song.id,
            start: a,
            title: song.name,
        };
        forgetPart(partId);
        useBestPartsStore.getState().savePart(part);
        if (!editing) onNewPart?.(part);
        return part;
    };

    const save = async () => {
        if (!buf || !mono) return;
        setSaving(true);
        stopPreview();
        try {
            const part = store(sel, editingId);
            selectPart(part);
            toast.success({ message: editingId ? 'Best part updated' : 'Best part saved' });
        } catch (e) {
            toast.error({ message: `Couldn’t save this part. ${(e as Error).message}` });
        } finally {
            setSaving(false);
        }
    };

    const unsaved = found.filter(
        ([a, z]) => !parts.some((p) => Math.min(p.end, z) - Math.max(p.start, a) > (z - a) / 2),
    );
    const saveAll = () => {
        if (!buf || !mono) return;
        stopPreview();
        const made = unsaved.map((r) => store(r, null));
        if (made.length) selectPart(made[0]);
        toast.success({
            message: `${made.length} best ${made.length === 1 ? 'part' : 'parts'} saved`,
        });
    };

    const remove = () => {
        if (!editingId) return;
        stopPreview();
        useBestPartsStore.getState().deletePart(editingId);
        forgetPart(editingId);
        newPart(parts[parts.length - 1]);
        toast.success({ message: 'Best part deleted' });
    };

    if (error)
        return (
            <Text isMuted>
                Couldn’t load “{song.name}”. {error}
            </Text>
        );
    if (!buf) {
        return (
            <Group className={styles.loading} gap="sm">
                <Spinner />
                <Text isMuted>Reading the waveform…</Text>
            </Group>
        );
    }

    const len = sel[1] - sel[0];
    return (
        <div
            className={styles.root}
            onKeyDown={(e) => {
                const typing = (e.target as HTMLElement).closest('button, input');
                if (e.key === ' ' && !typing) {
                    e.preventDefault();
                    if (playing && listening.current) stopPreview();
                    else if (listening.current || head > 0) listen(head);
                    else togglePreview();
                }
                if (e.key === '[' && !typing) markStart();
                if (e.key === ']' && !typing) markEnd();
            }}
            tabIndex={-1}
        >
            <Text isMuted size="sm">
                Listen first: click anywhere on the song (or drag the bar below) to hear it from
                there, then press Start here and End here, or [ and ]. You can also drag across the
                part you love and drag its edges.
            </Text>
            <canvas
                aria-label="Song waveform. Drag to select a best part."
                className={styles.wave}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={(e) => {
                    // a click without a drag: listen from there, keeping the part you had
                    const d = drag.current;
                    drag.current = null;
                    const t = timeAt(e);
                    if (d?.anchor != null && Math.abs(t - d.anchor) < 0.004 * dur + 0.2) {
                        if (downSel.current) {
                            setSel(downSel.current.sel);
                            setEditingId(downSel.current.editing);
                        }
                        listen(t);
                    }
                }}
                ref={canvas}
            />
            <div className={styles.listen}>
                <Button
                    leftSection={
                        <Icon icon={playing && listening.current ? 'mediaPause' : 'mediaPlay'} />
                    }
                    onClick={() => (playing && listening.current ? stopPreview() : listen(head))}
                    size="compact-sm"
                    variant="default"
                >
                    {playing && listening.current ? 'Pause' : `Listen from ${formatClock(head)}`}
                </Button>
                <Slider
                    aria-label="Where to listen from"
                    className={styles.scrub}
                    label={(v) => formatClock(v)}
                    max={dur}
                    min={0}
                    onChange={setHead}
                    onChangeEnd={(v) => (playing && listening.current ? listen(v) : setHead(v))}
                    step={0.1}
                    value={head}
                />
                <Button onClick={markStart} size="compact-sm" title="[" variant="default">
                    Start here
                </Button>
                <Button onClick={markEnd} size="compact-sm" title="]" variant="default">
                    End here
                </Button>
            </div>
            <div className={styles.row}>
                <span className={styles.nudge}>
                    <Text isMuted size="sm">
                        Starts
                    </Text>
                    <b>{formatClock(sel[0], true)}</b>
                    <Button
                        aria-label="Start 0.1 seconds earlier"
                        onClick={() => nudge(0, -0.1)}
                        size="compact-xs"
                        variant="default"
                    >
                        −
                    </Button>
                    <Button
                        aria-label="Start 0.1 seconds later"
                        onClick={() => nudge(0, 0.1)}
                        size="compact-xs"
                        variant="default"
                    >
                        +
                    </Button>
                </span>
                <span className={styles.nudge}>
                    <Text isMuted size="sm">
                        Ends
                    </Text>
                    <b>{formatClock(sel[1], true)}</b>
                    <Button
                        aria-label="End 0.1 seconds earlier"
                        onClick={() => nudge(1, -0.1)}
                        size="compact-xs"
                        variant="default"
                    >
                        −
                    </Button>
                    <Button
                        aria-label="End 0.1 seconds later"
                        onClick={() => nudge(1, 0.1)}
                        size="compact-xs"
                        variant="default"
                    >
                        +
                    </Button>
                </span>
                <Text isMuted size="sm">
                    {Math.round(len)} s selected
                </Text>
            </div>

            <div className={styles.parts}>
                {parts.map((p, i) => (
                    <button
                        className={clsx(styles.chip, p.id === editingId && styles.active)}
                        key={p.id}
                        onClick={() => selectPart(p)}
                        type="button"
                    >
                        Part {i + 1}{' '}
                        <span>
                            {formatClock(p.start)}–{formatClock(p.end)}
                        </span>
                    </button>
                ))}
                <button
                    className={clsx(styles.chip, styles.add, !editingId && styles.active)}
                    onClick={() => newPart(parts[parts.length - 1])}
                    type="button"
                >
                    + New part
                </button>
                <button
                    className={clsx(styles.chip, styles.suggest)}
                    onClick={suggest}
                    type="button"
                >
                    <Icon icon="bestParts" size="sm" /> Suggest best parts
                </button>
            </div>
            {unsaved.length > 0 && (
                <div className={styles.parts}>
                    <Text isMuted size="sm">
                        {unsaved.length === 1
                            ? 'BolBeats suggests:'
                            : `BolBeats found ${unsaved.length} parts:`}
                    </Text>
                    {unsaved.map(([a, z]) => (
                        <button
                            className={clsx(
                                styles.chip,
                                !editingId && sel[0] === a && sel[1] === z && styles.active,
                            )}
                            key={a}
                            onClick={() => (setEditingId(null), setSel([a, z]))}
                            type="button"
                        >
                            Suggested{' '}
                            <span>
                                {formatClock(a)}–{formatClock(z)}
                            </span>
                        </button>
                    ))}
                    {unsaved.length > 1 && (
                        <button
                            className={clsx(styles.chip, styles.suggest)}
                            onClick={saveAll}
                            type="button"
                        >
                            Add all {unsaved.length}
                        </button>
                    )}
                </div>
            )}

            <div className={styles.footer}>
                {footerStart}
                <Switch
                    checked={snap}
                    label="Move cuts to the nearest quiet moment"
                    onChange={(e) => setSnap(e.currentTarget.checked)}
                />
                <Group gap="sm">
                    {editingId && (
                        <Button color="red" onClick={remove} variant="subtle">
                            Delete part
                        </Button>
                    )}
                    <Button onClick={togglePreview} variant="default">
                        {playing ? 'Stop' : 'Play selection'}
                    </Button>
                    <Button
                        disabled={len < MIN_LEN}
                        loading={saving}
                        onClick={save}
                        variant="filled"
                    >
                        {editingId ? 'Update part' : 'Save part'}
                    </Button>
                    <Button onClick={onDone} variant={footerStart ? 'default' : 'subtle'}>
                        {doneLabel}
                    </Button>
                </Group>
            </div>
        </div>
    );
};
