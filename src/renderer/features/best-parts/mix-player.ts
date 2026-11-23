// BolBeats: plans and plays part mixes with the best-parts engine (separate from the main player).
import { nanoid } from 'nanoid/non-secure';
import { createWithEqualityFn } from 'zustand/traditional';

import {
    analyze,
    bestPath,
    candidates,
    type Fit,
    fit,
    gains,
    inSongOrder,
    mashupWeight,
    type MixItem,
    orderGroups,
    play,
    snapQuiet,
    timeline as timelineOf,
    toMono,
} from '/@/renderer/features/best-parts/engine/engine';
import { cutMp3, indexMp3 } from '/@/renderer/features/best-parts/mp3-cut';
import {
    ALL_PARTS_MIX,
    type BestPart,
    useBestPartsStore,
} from '/@/renderer/features/best-parts/store/best-parts.store';
import { disliked, liked, skippedPart } from '/@/renderer/features/best-parts/store/taste.store';
import { formatClock } from '/@/renderer/features/best-parts/utils';
import { useAuthStore } from '/@/renderer/store/auth.store';
import {
    subscribePlayerStatus,
    subscribePlayerVolume,
    usePlayerStoreBase,
} from '/@/renderer/store/player.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import { useTimestampStoreBase } from '/@/renderer/store/timestamp.store';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus } from '/@/shared/types/types';

// ---------- planning ----------

export const seamKey = (a: BestPart, b: BestPart) => `${a.id}>${b.id}`;
const sameSongNext = (a: BestPart, b: BestPart) => a.songId === b.songId && b.start >= a.end - 0.05;

const fits = new Map<string, Fit>();
export const forgetPart = (id: string) =>
    [...fits.keys()].filter((k) => k.includes(id)).forEach((k) => fits.delete(k));
export const fitOf = (a: BestPart, b: BestPart) => {
    const k = seamKey(a, b);
    if (!fits.has(k)) fits.set(k, fit(a.analysis, b.analysis, sameSongNext(a, b)));
    return fits.get(k)!;
};

export const seam = (a: BestPart, b: BestPart, picks: Record<string, string>) => {
    const f = fitOf(a, b);
    const all = candidates(f);
    return { all, f, pick: all.find((c) => c.type === picks[seamKey(a, b)]) ?? all[0] };
};

// One song's parts stay together and in song order; songs are ordered by how well they flow (the best order of
// all of them, see bestPath). Shuffle keeps the old greedy chain from a random start, so it differs every time.
export const smartOrder = (parts: BestPart[], shuffle = false) => {
    const bySong = new Map<string, BestPart[]>();
    for (const p of parts) bySong.set(p.songId, [...(bySong.get(p.songId) ?? []), p]);
    const groups = [...bySong.values()].map((g) => g.sort((a, b) => a.start - b.start));
    const fitG = (g1: BestPart[], g2: BestPart[]) => fitOf(g1[g1.length - 1], g2[0]).total;
    const ordered = shuffle
        ? orderGroups(groups, fitG, true)
        : bestPath(groups.length, (i, j) => fitG(groups[i], groups[j])).map((i) => groups[i]);
    return ordered.flat().map((p) => p.id);
};

// BolBeats mashup: every part on its own, so parts of different songs interleave wherever they fit (A1 B2 B3 A2 B1).
export const mashupOrder = (parts: BestPart[], shuffle = false) => {
    const w = (i: number, j: number) =>
        mashupWeight(parts[i], parts[j], fitOf(parts[i], parts[j]).total) +
        (shuffle ? Math.random() * 0.25 : 0);
    return inSongOrder(bestPath(parts.length, w).map((i) => parts[i])).map((p) => p.id);
};

// BolBeats: how BolBeats arranges parts on its own (auto picks, your hand-picked parts, ticked parts): when a song
// has several parts, songs take turns wherever their joins fit (Mashup order); otherwise the smoothest order.
export const autoOrder = (parts: BestPart[], shuffle = false) =>
    new Set(parts.map((p) => p.songId)).size < parts.length
        ? mashupOrder(parts, shuffle)
        : smartOrder(parts, shuffle);

// How well an order flows: the average fit of its seams (0-1).
export const flowOf = (parts: BestPart[]) =>
    parts.length < 2
        ? 1
        : parts.slice(1).reduce((s, p, i) => s + fitOf(parts[i], p).total, 0) / (parts.length - 1);

// ---------- audio ----------

// BolBeats: two loud songs overlapping in a transition can go past full scale and crackle; this catches the peaks
// just below it (in playback and in saved mixes).
const limiter = (c: BaseAudioContext) => {
    const l = c.createDynamicsCompressor();
    l.threshold.value = -1;
    l.knee.value = 0;
    l.ratio.value = 20;
    l.attack.value = 0.002;
    l.release.value = 0.1;
    l.connect(c.destination);
    return l;
};

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
const audioCtx = () => {
    if (!ctx) {
        ctx = new AudioContext();
        out = ctx.createGain();
        out.connect(limiter(ctx));
        applyVolume();
    }
    return ctx;
};
const applyVolume = () => {
    const { muted, volume } = usePlayerStoreBase.getState().player;
    if (out) out.gain.value = muted ? 0 : (volume / 100) ** 2; // perceptual curve
};

const streamUrl = (songId: string) => {
    const s = useAuthStore.getState().currentServer;
    if (!s) throw new Error('Your music library is not connected.');
    return `${s.url}/rest/stream?id=${encodeURIComponent(songId)}&format=raw&c=BolBeats&v=1.13.0&${s.credential}`;
};

// The last song's file, so parts of one song (and the editor) share one fetch.
let lastFile: null | { bytes: Promise<Uint8Array>; id: string } = null;
const songFile = (songId: string) => {
    if (lastFile?.id !== songId) {
        const bytes = fetch(streamUrl(songId)).then(async (res) => {
            if (!res.ok) throw new Error(`Couldn’t load this song (${res.status}).`);
            return new Uint8Array(await res.arrayBuffer());
        });
        lastFile = { bytes, id: songId };
        bytes.catch(() => lastFile?.bytes === bytes && (lastFile = null)); // let a failed song be retried
    }
    return lastFile.bytes;
};

// BolBeats: decode at the file's own rate (an MP3 says it in every frame). Resampling to the speaker's rate made
// decoding ~3x slower and the suggested part depend on which speaker was connected.
const decodeFile = (bytes: Uint8Array, rate = indexMp3(bytes)?.rate) =>
    new OfflineAudioContext(2, 1, rate ?? audioCtx().sampleRate).decodeAudioData(
        bytes.slice().buffer,
    );

// Keep only one full song in memory; callers asking for the same song share one decode.
let lastSong: null | { buf: Promise<AudioBuffer>; id: string } = null;
export const decodeSong = (songId: string) => {
    if (lastSong?.id !== songId) {
        const buf = songFile(songId).then((b) => decodeFile(b));
        lastSong = { buf, id: songId };
        buf.catch(() => lastSong?.buf === buf && (lastSong = null));
    }
    return lastSong.buf;
};

export const slice = (buf: AudioBuffer, s: number, e: number) => {
    const a = Math.floor(s * buf.sampleRate);
    const z = Math.min(buf.length, Math.floor(e * buf.sampleRate));
    const o = audioCtx().createBuffer(buf.numberOfChannels, Math.max(1, z - a), buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++)
        o.copyToChannel(buf.getChannelData(c).subarray(a, z), c);
    return o;
};

export const analyzeBuffer = (b: AudioBuffer) =>
    analyze(
        Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)),
        b.sampleRate,
    );

// Parts ready to play, newest last. An MP3 part is kept as its cut frames (~0.5 MB, decoded in ~15 ms when played);
// other formats keep the decoded part (~8 MB per 20 s), so the cap stays at 32.
type Cut = { buffer: AudioBuffer } | { bytes: Uint8Array; offset: number; rate: number };
const cuts = new Map<string, Cut>();
const MAX_CUTS = 32;
const cutOf = async (p: BestPart) => {
    const k = `${p.id}@${p.start}-${p.end}`;
    let c = cuts.get(k);
    if (!c) {
        const bytes = await songFile(p.songId);
        const ix = indexMp3(bytes);
        c = ix
            ? { ...cutMp3(bytes, ix, p.start, p.end), rate: ix.rate }
            : { buffer: slice(await decodeFile(bytes), p.start, p.end) };
    }
    cuts.delete(k);
    cuts.set(k, c);
    if (cuts.size > MAX_CUTS) cuts.delete(cuts.keys().next().value!);
    return c;
};
const partBuffer = async (p: BestPart) => {
    const c = await cutOf(p);
    return 'buffer' in c
        ? c.buffer
        : slice(await decodeFile(c.bytes, c.rate), p.start - c.offset, p.end - c.offset);
};

// Cut a mix's parts ahead of time so pressing Play starts at once.
export const prepareParts = async (parts: BestPart[]) => {
    for (const p of parts.slice(0, MAX_CUTS)) await cutOf(p).catch(() => undefined);
};

// Plays one stretch of a song (editor preview). Returns stop().
export const playRange = (buf: AudioBuffer, start: number, end: number, onEnded: () => void) => {
    stopMix();
    usePlayerStoreBase.getState().mediaPause();
    const c = audioCtx();
    c.resume();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(out!);
    src.start(0, start, end - start);
    src.onended = onEnded;
    const startedAt = c.currentTime;
    return {
        position: () => start + c.currentTime - startedAt,
        stop: () => {
            src.onended = null;
            try {
                src.stop();
            } catch {
                /* already stopped */
            }
        },
    };
};

// ---------- mix playback state ----------

export type MixPlayerState = {
    at: number[];
    index: number;
    label: string;
    mixId: null | string;
    offset: number; // where in the whole playlist this run started (part numbers stay right after a skip)
    partIds: string[];
    preview: boolean;
    seams: number[];
    status: 'idle' | 'loading' | 'paused' | 'playing';
    t0: number;
    total: number;
};
const idle: MixPlayerState = {
    at: [],
    index: -1,
    label: '',
    mixId: null,
    offset: 0,
    partIds: [],
    preview: false,
    seams: [],
    status: 'idle',
    t0: 0,
    total: 0,
};
export const useMixPlayer = createWithEqualityFn<MixPlayerState>(() => idle);

let handle: null | { stop: () => void; t0: number } = null;
let ticker: null | ReturnType<typeof setInterval> = null;
let runId = 0;

export const mixElapsed = () => {
    const s = useMixPlayer.getState();
    return ctx && s.status !== 'idle' && s.status !== 'loading'
        ? Math.min(s.total, Math.max(0, ctx.currentTime - s.t0))
        : 0;
};

export const stopMix = () => {
    runId++;
    handle?.stop();
    handle = null;
    if (ticker) clearInterval(ticker);
    ticker = null;
    useMixPlayer.setState(idle);
};

export const toggleMixPause = async () => {
    const s = useMixPlayer.getState();
    if (!ctx || (s.status !== 'playing' && s.status !== 'paused')) return;
    if (s.status === 'playing') await ctx.suspend();
    else await ctx.resume();
    useMixPlayer.setState({ status: s.status === 'playing' ? 'paused' : 'playing' });
};

// Plays parts in order. preview = index of one seam to audition (last ~8 s of A into first ~8 s of B).
export const playParts = async (
    parts: BestPart[],
    picks: Record<string, string>,
    opts: { label: string; mixId: null | string; offset?: number; preview?: number },
) => {
    stopMix();
    // the whole run (not a restart from a later part), so next / previous can move through it
    if (opts.preview == null && !opts.offset) run = { label: opts.label, parts, picks };
    const runNow = runId;
    usePlayerStoreBase.getState().mediaPause();
    const use = opts.preview != null ? parts.slice(opts.preview, opts.preview + 2) : parts;
    if (!use.length) return;
    useMixPlayer.setState({
        ...idle,
        label: opts.label,
        mixId: opts.mixId,
        offset: opts.offset ?? 0,
        partIds: use.map((p) => p.id),
        preview: opts.preview != null,
        status: 'loading',
    });
    const c = audioCtx();
    await c.resume();
    const got = await Promise.all(
        use.map((p) =>
            partBuffer(p).then(
                (b) => ({ b }),
                (e: Error) => ({ e }),
            ),
        ),
    ); // decode side by side
    if (runNow !== runId) return; // stopped while loading
    // BolBeats: a part whose song can't be loaded (its file was deleted, say) is left out, not the whole mix
    const ok = use.filter((_, i) => 'b' in got[i]);
    const buffers = got.flatMap((g) => ('b' in g ? [g.b] : []));
    const failed = got.find((g) => 'e' in g);
    if (!ok.length) {
        stopMix(); // never leave the mix stuck on "loading"
        toast.error({
            message: `${use[0].title}: ${failed && 'e' in failed ? failed.e.message : ''}`,
            title: 'Couldn’t play this mix',
        });
        return;
    }
    if (ok.length < use.length) {
        // the run's list drops them too, so part numbers and picking a part stay in step with what plays
        const gone = new Set(use.filter((_, i) => !('b' in got[i])).map((p) => p.id));
        if (run && opts.preview == null)
            run = { ...run, parts: run.parts.filter((p) => !gone.has(p.id)) };
        const n = use.length - ok.length;
        toast.warn({
            message: `Left out ${n} part${n > 1 ? 's' : ''} whose song couldn’t be loaded.`,
            title: 'Playing the rest',
        });
        useMixPlayer.setState({ partIds: ok.map((p) => p.id) });
    }
    const vols = gains(ok.map((p) => p.analysis.loudness));
    const items: MixItem[] = ok.map((p, i) => ({
        a: p.analysis,
        buffer: buffers[i],
        dur: p.end - p.start,
        off: 0,
        t: i < ok.length - 1 ? { ...seam(p, ok[i + 1], picks).pick } : null,
        vol: vols[i],
    }));
    if (opts.preview != null && items.length === 2) {
        const [A, B] = items;
        A.off = Math.max(0, A.dur - 8);
        A.dur -= A.off;
        B.dur = Math.min(B.dur, 8);
    }
    const at = items.length > 1 ? timelineOf(items) : [0];
    handle = play(c, items, at, out!);
    const total = at[at.length - 1] + items[items.length - 1].dur;
    useMixPlayer.setState({
        at,
        index: 0,
        seams: items.slice(0, -1).map((x) => x.t!.at!),
        status: 'playing',
        t0: handle.t0,
        total,
    });
    ticker = setInterval(() => {
        const s = useMixPlayer.getState();
        const e = mixElapsed();
        if (e >= s.total) {
            // BolBeats: with Auto DJ on, a finished best-parts playlist carries on with parts that join its last one
            const more = s.preview ? null : carryOn;
            carryOn = null;
            if (more?.length && autoDjOn())
                return void playParts(more, {}, { label: 'Auto DJ', mixId: null });
            return stopMix();
        }
        const index = s.at.findLastIndex((a) => a <= e);
        if (index !== s.index) useMixPlayer.setState({ index });
        // on the last part: choose what comes next and get it ready, so the next run starts quickly
        if (index === s.partIds.length - 1 && !s.preview && !carryOn && autoDjOn()) {
            const last = useBestPartsStore.getState().parts[s.partIds[index]];
            carryOn = last ? nextRun(last) : null;
            if (carryOn) void prepareParts(carryOn);
        }
    }, 200);
};

// ---------- Auto DJ for best parts ----------

let carryOn: BestPart[] | null = null;
// the parts of the current run, for next / previous when it isn't a saved playlist
let run: null | { label: string; parts: BestPart[]; picks: Record<string, string> } = null;
const heardRuns = new Set<string>(); // parts played since BolBeats started, so Auto DJ keeps it fresh
const autoDjOn = () => Boolean(useSettingsStore.getState().autoDJ?.enabled);

// Up to 8 parts, one per song, that join well with `last` (thumbs up first, never thumbs down or songs just heard)
const nextRun = (last: BestPart): BestPart[] | null => {
    const all = Object.values(useBestPartsStore.getState().parts).filter(
        (p) => p.songId !== last.songId && !disliked(p.id),
    );
    let pool = all.filter((p) => !heardRuns.has(p.id));
    if (pool.length < 4) {
        heardRuns.clear();
        pool = all;
    }
    const ranked = pool
        .map(
            (p) =>
                [p, fitOf(last, p).total + (liked(p.id) ? 0.15 : 0) + Math.random() * 0.1] as const,
        )
        .sort((a, b) => b[1] - a[1])
        .map(([p]) => p);
    const picked: BestPart[] = [];
    for (const p of ranked) {
        if (picked.length >= 8) break;
        if (!picked.some((q) => q.songId === p.songId)) picked.push(p);
    }
    if (!picked.length) return null;
    const [first, ...rest] = picked;
    const parts = useBestPartsStore.getState().parts;
    return [first, ...autoOrder(rest).map((id) => parts[id])];
};
useMixPlayer.subscribe((s, prev) => {
    if (s.status === 'playing' && prev.status === 'loading')
        s.partIds.forEach((id) => heardRuns.add(id));
    if (s.status === 'idle' && prev.status !== 'idle' && !useMixPlayer.getState().partIds.length)
        carryOn = null;
});

// The main player and a mix never play at once; volume follows the main player.
subscribePlayerStatus(({ status }) => {
    if (status === PlayerStatus.PLAYING && useMixPlayer.getState().status !== 'idle') stopMix();
});
subscribePlayerVolume(applyVolume);

// ---------- presets, export, "mark this moment" ----------

// from = position in the playlist's own list; dir says which way to look when that part is left out
export const playMixById = (mixId: string, from = 0, dir: -1 | 1 = 1) => {
    const { mixes, parts } = useBestPartsStore.getState();
    const mix = mixes[mixId];
    if (!mix) return false;
    // BolBeats: playlists BolBeats made (and All best parts) leave out parts you've given a thumbs down or keep skipping;
    // a playlist you made plays what you put in it
    const list = mix.partIds
        .map((id, i) => [parts[id], i] as const)
        .filter(([p]) => p && (!(mix.auto || mixId === ALL_PARTS_MIX) || !disliked(p.id)));
    if (!list.length) return false;
    let at =
        dir > 0 ? list.findIndex(([, i]) => i >= from) : list.findLastIndex(([, i]) => i <= from);
    if (at < 0) at = dir > 0 ? list.length - 1 : 0;
    // the whole list being played, so next / previous / pick a part count in the same list
    run = { label: mix.name, parts: list.map(([p]) => p), picks: mix.picks };
    playParts(
        list.slice(at).map(([p]) => p),
        mix.picks,
        { label: mix.name, mixId, offset: at },
    );
    return true;
};

// BolBeats: previous / next part of the playing best-parts playlist (restarts the mix from that part).
// BolBeats: also for parts that aren't a saved playlist (Made for you, Tune your own, a song's parts, Auto DJ): those
// used to ignore next / previous. Previous on the first part, or a few seconds into any part, starts it again; next on
// the last part carries on with Auto DJ when it's on, else stops.
export const skipMixPart = (d: -1 | 1) => {
    const s = useMixPlayer.getState();
    if (s.preview || s.status === 'idle' || s.status === 'loading') return;
    const part = useBestPartsStore.getState().parts[s.partIds[s.index]];
    const into = mixElapsed() - (s.at[s.index] ?? 0);
    let step: -1 | 0 | 1 = d < 0 && into > 3 ? 0 : d;
    // BolBeats: always the list that is playing (a saved playlist used to be looked up by id, so "Play all", which
    // has no saved list, ignored next and previous)
    const ids = run?.parts ?? [];
    const here = s.offset + s.index;
    if (!ids.length) return;
    if (here + step < 0) step = 0;
    // moving on before a part's halfway point teaches BolBeats you'd rather not hear it
    if (d > 0 && part && into < (part.end - part.start) / 2) skippedPart(part.id);
    if (here + step >= ids.length) {
        const more = autoDjOn() && part ? nextRun(part) : null;
        return more?.length
            ? void playParts(more, {}, { label: 'Auto DJ', mixId: null })
            : stopMix();
    }
    playRunFrom(here + step);
};

// BolBeats: every part of the playing run (a saved playlist or not), with its place in it, so any one can be picked.
export const runParts = (): { at: number; part: BestPart }[] =>
    (run?.parts ?? []).map((part, at) => ({ at, part }));

// Plays the playing run from part `at` on (a place from runParts), like next / previous but any distance.
export const playRunFrom = (at: number) => {
    if (!run) return;
    void playParts(run.parts.slice(at), run.picks, {
        label: run.label,
        mixId: useMixPlayer.getState().mixId, // keeps its playlist page showing what plays
        offset: at,
    });
};

const typing = (e: KeyboardEvent) =>
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable="true"]');

// Car-radio presets: keys 1-6 play the mix saved on that preset. B marks the current moment of the playing song.
document.addEventListener('keydown', (e) => {
    if (typing(e) || e.repeat) return;
    if (/^[1-6]$/.test(e.key)) {
        const id = useBestPartsStore.getState().presets[Number(e.key) - 1];
        if (id && playMixById(id)) e.preventDefault();
    } else if (e.key === 'b' || e.key === 'B') {
        toggleMarkMoment();
    }
});

export const wav = (b: AudioBuffer) => {
    const ch = b.numberOfChannels;
    const n = b.length;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o: number, s: string) =>
        [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF');
    out.setUint32(4, 36 + n * ch * 2, true);
    str(8, 'WAVEfmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, ch, true);
    out.setUint32(24, b.sampleRate, true);
    out.setUint32(28, b.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true);
    out.setUint16(34, 16, true);
    str(36, 'data');
    out.setUint32(40, n * ch * 2, true);
    const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
    for (let i = 0, o = 44; i < n; i++)
        for (let c = 0; c < ch; c++, o += 2)
            out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
    return new Blob([out.buffer], { type: 'audio/wav' });
};

// Renders the whole mix offline (faster than real time) and saves it as a WAV file.
export const saveMixAsFile = async (
    parts: BestPart[],
    picks: Record<string, string>,
    name: string,
) => {
    const vols = gains(parts.map((p) => p.analysis.loudness));
    const items: MixItem[] = [];
    for (const [i, p] of parts.entries()) {
        items.push({
            a: p.analysis,
            buffer: await partBuffer(p),
            dur: p.end - p.start,
            off: 0,
            t: i < parts.length - 1 ? { ...seam(p, parts[i + 1], picks).pick } : null,
            vol: vols[i],
        });
    }
    const at = items.length > 1 ? timelineOf(items) : [0];
    const sr = items[0].buffer!.sampleRate;
    const total = at[at.length - 1] + items[items.length - 1].dur + 1;
    const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    play(off as unknown as AudioContext, items, at, limiter(off));
    const url = URL.createObjectURL(wav(await off.startRendering()));
    const a = Object.assign(document.createElement('a'), {
        download: `${name.replace(/[\\/:*?"<>|]/g, '-')}.wav`,
        href: url,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// "Mark this moment": first press notes where the part starts in the playing song, second press saves it.
export const useMarkMoment = createWithEqualityFn<{ songId: null | string; start: number }>(() => ({
    songId: null,
    start: 0,
}));

export const toggleMarkMoment = async () => {
    const { currentSong } = usePlayerStoreBase.getState().getPlayerData();
    const now = useTimestampStoreBase.getState().timestamp;
    const mark = useMarkMoment.getState();
    if (!currentSong) {
        toast.info({ message: 'Play a song first, then press B when your favourite part starts.' });
        return;
    }
    if (mark.songId !== currentSong.id) {
        useMarkMoment.setState({ songId: currentSong.id, start: now });
        toast.info({
            message: `Marking from ${formatClock(now)}. Press B again when the part ends.`,
            title: 'Best part started',
        });
        return;
    }
    useMarkMoment.setState({ songId: null, start: 0 });
    const start = Math.max(0, Math.min(mark.start, now));
    let end = Math.max(mark.start, now);
    if (end - start < 3) end = start + 20; // a quick double-press keeps the next 20 seconds
    try {
        const buf = await decodeSong(currentSong.id);
        end = Math.min(end, buf.duration);
        const mono = toMono(
            Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)),
            buf.sampleRate,
        );
        const a = snapQuiet(mono.x, mono.sr, start);
        const z = snapQuiet(mono.x, mono.sr, end);
        const part: BestPart = {
            album: currentSong.album,
            analysis: analyzeBuffer(slice(buf, a, z)),
            artist: currentSong.artistName,
            auto: false, // BolBeats: yours; its finder never changes it
            created: Date.now(),
            end: z,
            id: nanoid(),
            imageUrl: currentSong.imageUrl,
            songDuration: buf.duration,
            songId: currentSong.id,
            start: a,
            title: currentSong.name,
        };
        useBestPartsStore.getState().savePart(part);
        toast.success({
            message: `${currentSong.name}, ${formatClock(a)}–${formatClock(z)}`,
            title: 'Best part saved',
        });
    } catch (e) {
        toast.error({ message: (e as Error).message, title: 'Couldn’t save that part' });
    }
};
