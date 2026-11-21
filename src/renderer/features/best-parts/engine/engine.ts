// BolBeats best-parts engine. Pure maths + Web Audio scheduling, no imports, so Node can test it directly.
// Analysis: tempo, beats, key, chroma ("tune colour"), MFCC (timbre), loudness.
// Mixing: how well part A's ending fits part B's start, ranked transitions, ordering, timeline, playback.

const N = 2048;
const HOP = 512;
const MELS = 26;
export const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type Analysis = {
    beats: number[];
    bpm: number;
    head: Edge;
    key: Key;
    loudness: number;
    tail: Edge;
};
export type Edge = { chroma: number[]; mfcc: number[][]; rms: number };
export type Key = { minor: boolean; tonic: number };

const mean = (a: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s / (a.length || 1);
};
const meanVec = (vs: ArrayLike<number>[], n: number) => {
    const out = new Array<number>(n).fill(0);
    for (const v of vs) for (let i = 0; i < n; i++) out[i] += v[i] / vs.length;
    return out;
};
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0) => {
    let d = 0;
    let na = 0;
    let nb = 0;
    for (let i = from; i < a.length; i++) {
        d += a[i] * b[i];
        na += a[i] ** 2;
        nb += b[i] ** 2;
    }
    return d / (Math.sqrt(na * nb) || 1);
};
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

// Mixes channels to mono and decimates to ~22 kHz (plenty for rhythm and pitch).
export function toMono(channels: Float32Array[], sr: number) {
    const step = Math.max(1, Math.round(sr / 22050));
    const len = Math.floor(channels[0].length / step);
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        let s = 0;
        for (const ch of channels) for (let k = 0; k < step; k++) s += ch[i * step + k];
        x[i] = s / (channels.length * step);
    }
    return { sr: sr / step, x };
}

function fft(re: Float32Array, im: Float32Array) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j], re[i]];
            [im[i], im[j]] = [im[j], im[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const a = (-2 * Math.PI) / len;
        const wr = Math.cos(a);
        const wi = Math.sin(a);
        const h = len >> 1;
        for (let i = 0; i < n; i += len) {
            let cr = 1;
            let ci = 0;
            for (let k = 0; k < h; k++) {
                const p = i + k;
                const q = p + h;
                const vr = re[q] * cr - im[q] * ci;
                const vi = re[q] * ci + im[q] * cr;
                re[q] = re[p] - vr;
                im[q] = im[p] - vi;
                re[p] += vr;
                im[p] += vi;
                const t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
        }
    }
}

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

export function detectKey(chroma: ArrayLike<number>): Key {
    const center = (a: number[]) => {
        const m = mean(a);
        return a.map((v) => v - m);
    };
    let best = { minor: false, r: -2, tonic: 0 };
    for (let t = 0; t < 12; t++) {
        for (const [minor, prof] of [
            [false, MAJOR],
            [true, MINOR],
        ] as const) {
            const r = cosine(
                center(Array.from({ length: 12 }, (_, i) => chroma[(i + t) % 12])),
                center([...prof]),
            );
            if (r > best.r) best = { minor, r, tonic: t };
        }
    }
    return { minor: best.minor, tonic: best.tonic };
}

// Per-frame features: rms, onset flux, 12-bin chroma, 13 MFCCs.
export function frames(x: Float32Array, sr: number) {
    const nb = N / 2;
    const bin = (k: number) => (k * sr) / N;
    const win = Float32Array.from(
        { length: N },
        (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N),
    );
    const lo = hz2mel(60);
    const hi = hz2mel(Math.min(8000, sr / 2));
    const edges = Array.from(
        { length: MELS + 2 },
        (_, i) => (mel2hz(lo + (i * (hi - lo)) / (MELS + 1)) * N) / sr,
    );
    // BolBeats: mel weights and DCT built once per song, buffers reused per frame (same numbers, a few times faster)
    const melBins = Array.from({ length: MELS }, (_, m) => {
        const [a, c, b] = [edges[m], edges[m + 1], edges[m + 2]];
        const ks: number[] = [];
        const ws: number[] = [];
        for (let k = Math.ceil(a); k < b && k < nb; k++) {
            ks.push(k);
            ws.push(k < c ? (k - a) / (c - a) : (b - k) / (b - c));
        }
        return { ks, ws };
    });
    const dct = Array.from({ length: 13 }, (_, c) =>
        Float64Array.from({ length: MELS }, (_, m) => Math.cos((Math.PI * c * (m + 0.5)) / MELS)),
    );
    const out = {
        chroma: [] as number[][],
        flux: [] as number[],
        mfcc: [] as number[][],
        rms: [] as number[],
    };
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const lin = new Float32Array(nb); // 10 x magnitude, i.e. expm1 of the log magnitude
    const mel = new Float64Array(MELS);
    let mag = new Float32Array(nb);
    let prev = new Float32Array(nb);
    for (let p = 0; p + N <= x.length; p += HOP) {
        im.fill(0);
        let e = 0;
        for (let i = 0; i < N; i++) {
            const v = x[p + i];
            e += v * v;
            re[i] = v * win[i];
        }
        fft(re, im);
        const chroma = new Array<number>(12).fill(0);
        let flux = 0;
        for (let k = 0; k < nb; k++) {
            const l = 10 * Math.sqrt(re[k] * re[k] + im[k] * im[k]);
            lin[k] = l;
            mag[k] = Math.log1p(l);
            flux += Math.max(0, mag[k] - prev[k]);
        }
        // Chroma from spectral peaks at their interpolated frequency; low notes would otherwise smear.
        for (let k = 1; k < nb - 1; k++) {
            if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
            const d = mag[k - 1] - 2 * mag[k] + mag[k + 1];
            const f = bin(k + (d ? (0.5 * (mag[k - 1] - mag[k + 1])) / d : 0));
            if (f >= 60 && f <= 5000)
                chroma[(Math.round(12 * Math.log2(f / 440)) + 9 + 1200) % 12] += lin[k] * lin[k];
        }
        for (let m = 0; m < MELS; m++) {
            const { ks, ws } = melBins[m];
            let v = 0;
            for (let j = 0; j < ks.length; j++) v += lin[ks[j]] * ws[j];
            mel[m] = Math.log(v + 1e-6);
        }
        const mfcc = new Array<number>(13);
        for (let c = 0; c < 13; c++) {
            const row = dct[c];
            let v = 0;
            for (let m = 0; m < MELS; m++) v += mel[m] * row[m];
            mfcc[c] = v;
        }
        out.mfcc.push(mfcc);
        out.rms.push(Math.sqrt(e / N));
        out.flux.push(flux);
        out.chroma.push(chroma);
        [prev, mag] = [mag, prev];
    }
    return out;
}

// Tempo from the autocorrelation of onset strength (70–180 BPM), then the beat grid's best phase.
export function tempo(flux: number[], fps: number) {
    const m = mean(flux);
    const o = flux.map((v) => Math.max(0, v - m));
    const ac = (lag: number) => {
        let s = 0;
        for (let i = lag; i < o.length; i++) s += o[i] * o[i - lag];
        return s / (o.length - lag);
    };
    let best = 0;
    let lag = Math.round((fps * 60) / 120);
    for (let l = Math.floor((fps * 60) / 180); l <= Math.ceil((fps * 60) / 70); l++) {
        const s = ac(l) * Math.exp(-0.5 * (Math.log2((60 * fps) / l / 120) / 0.9) ** 2);
        if (s > best) {
            best = s;
            lag = l;
        }
    }
    const [a, b, c] = [ac(lag - 1), ac(lag), ac(lag + 1)];
    const period = lag + (a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0);
    let phase = 0;
    let top = -1;
    for (let off = 0; off < period; off++) {
        let s = 0;
        for (let t = off; t < o.length; t += period) s += o[Math.round(t)] || 0;
        if (s > top) {
            top = s;
            phase = off;
        }
    }
    const beats: number[] = [];
    for (let t = phase; t < o.length; t += period) beats.push(t / fps);
    return { beats, bpm: (60 * fps) / period };
}
export const keyName = (k: Key) => `${KEYS[k.tonic]} ${k.minor ? 'minor' : 'major'}`;

// Everything the mixer needs about one part. Head/tail = first/last 3 s; MFCC edges = 1.5 s.
export function analyze(channels: Float32Array[], sampleRate: number): Analysis {
    const { sr, x } = toMono(channels, sampleRate);
    const fps = sr / HOP;
    const f = frames(x, sr);
    const n = f.rms.length;
    const w = Math.max(1, Math.min(n >> 1, Math.round(3 * fps)));
    const s = Math.max(1, Math.min(n >> 1, Math.round(1.5 * fps)));
    return {
        ...tempo(f.flux, fps),
        head: {
            chroma: meanVec(f.chroma.slice(0, w), 12),
            mfcc: f.mfcc.slice(0, s),
            rms: mean(f.rms.slice(0, w)),
        },
        key: detectKey(meanVec(f.chroma, 12)),
        loudness: mean(f.rms),
        tail: {
            chroma: meanVec(f.chroma.slice(n - w), 12),
            mfcc: f.mfcc.slice(n - s),
            rms: mean(f.rms.slice(n - w)),
        },
    };
}

// Dynamic time warping over MFCC frames (skipping c0, i.e. loudness). 0 = identical.
export function dtw(A: number[][], B: number[][]) {
    const m = B.length;
    let prev = new Float64Array(m + 1).fill(Infinity);
    prev[0] = 0;
    for (let i = 1; i <= A.length; i++) {
        const cur = new Float64Array(m + 1).fill(Infinity);
        for (let j = 1; j <= m; j++)
            cur[j] = 1 - cosine(A[i - 1], B[j - 1], 1) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
        prev = cur;
    }
    return prev[m] / (A.length + m);
}

// 1 = same key, ~0.8 relative major/minor, ~0.7 a fifth away, falling off after that.
export function keyFit(a: Key, b: Key) {
    const pos = (k: Key) => ((k.minor ? (k.tonic + 3) % 12 : k.tonic) * 7) % 12;
    const d = Math.min((pos(a) - pos(b) + 12) % 12, (pos(b) - pos(a) + 12) % 12);
    return ([1, 0.7, 0.3][d] ?? 0) * (a.minor === b.minor ? 1 : 0.8);
}

// Moves a cut point to the quietest 40 ms within ±win seconds, so words aren't chopped.
export function snapQuiet(x: Float32Array, sr: number, t: number, win = 0.25) {
    const w = Math.round(sr * 0.02);
    let best = t;
    let min = Infinity;
    for (let c = t - win; c <= t + win; c += 0.01) {
        const i = Math.round(c * sr);
        if (i < w || i + w > x.length) continue;
        let e = 0;
        for (let k = i - w; k < i + w; k++) e += x[k] * x[k];
        e += Math.abs(c - t) * 1e-4; // prefer the closer point on ties
        if (e < min) {
            min = e;
            best = c;
        }
    }
    return best;
}

// Suggests the hook: usually the chorus, the section that comes back most often and is loud when it does
// (after Goto's RefraiD chorus finder and Bartsch & Wakefield's audio thumbnails; loudness as the highlight cue from
// Huang et al., "Pop Music Highlighter", 2018). Steps, on 0.5 s blocks of a ~11 kHz copy so whole songs stay fast:
// 1. how alike every two moments are, by harmony (chroma) and sound (timbre);
// 2. for every window, how strongly its first ~12 s come back elsewhere, counting up to three returns (a chorus
//    returns more often than the verse-to-chorus run-up that also repeats);
// 3. plus how loud and busy the whole window is, a bonus for starting where a section starts, minus intro and fade-out;
// 4. start and end moved to the nearest section change, then onto the beat and a breath.
const BLOCK = 0.5;

const unit = (v: number[]) => {
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
};
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const median = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s[s.length >> 1] ?? 0;
};
const spread = (a: number[]) => {
    const lo = median(a);
    const hi = Math.max(...a);
    return a.map((v) => clamp((v - lo) / (hi - lo || 1)));
};

export function chorusScores(
    chroma: number[][],
    timbre: number[][],
    db: number[],
    flux: number[],
    L: number,
    nov?: number[],
    S = recurrence(chroma, timbre),
) {
    const n = chroma.length;
    // 2. path strength: how alike [t, t+R) is to [t+lag, t+lag+R), from prefix sums along each diagonal
    const R = Math.min(L, Math.round(12 / BLOCK));
    const minLag = Math.round(R * 0.8);
    const back = Array.from({ length: n }, () => [] as [number, number][]); // [other start, strength]
    for (let lag = minLag; lag + R <= n; lag++) {
        const c = new Float64Array(n - lag + 1);
        for (let u = 0; u < n - lag; u++) c[u + 1] = c[u] + S[u][u + lag];
        for (let t = 0; t + lag + R <= n; t++) {
            const v = (c[t + R] - c[t]) / R;
            back[t].push([t + lag, v]);
            back[t + lag].push([t, v]);
        }
    }
    const rep = back.map((list) => {
        const picked: [number, number][] = [];
        const sorted = list.sort((a, b) => b[1] - a[1]);
        for (const cand of sorted) {
            if (picked.length === 3 || cand[1] <= 0) break;
            if (picked.every((p) => Math.abs(p[0] - cand[0]) >= minLag)) picked.push(cand);
        }
        return picked.reduce((s, p, k) => s + p[1] * [1, 0.6, 0.35][k], 0);
    });
    // 3. loudness and busyness of each window
    const win = (a: number[], t: number) => mean(a.slice(t, t + L));
    const starts = Array.from({ length: Math.max(0, n - L + 1) }, (_, t) => t);
    const repN = spread(starts.map((t) => rep[t]));
    const loudN = spread(starts.map((t) => win(db, t)));
    const busyN = spread(starts.map((t) => win(flux, t)));
    const top = nov ? Math.max(...nov) || 1 : 1;
    return starts.map((t, i) => {
        const edge = (t < n * 0.1 ? 0.25 : 0) + (t + L > n * 0.94 ? 0.25 : 0);
        const onset = nov ? Math.max(nov[t - 1] ?? 0, nov[t], nov[t + 1] ?? 0) / top : 0;
        return 0.5 * repN[i] + 0.25 * loudN[i] + 0.1 * busyN[i] + 0.15 * onset - edge;
    });
}

// Section changes: a checkerboard kernel slid along the self-similarity diagonal (Foote 2000), on blocks.
export function novelty(feat: number[][], K = 8) {
    const n = feat.length;
    const out = new Array<number>(n).fill(0);
    for (let i = K; i < n - K; i++) {
        let s = 0;
        for (let a = -K; a < K; a++)
            for (let b = -K; b < K; b++) {
                const w =
                    Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (K * K)) *
                    (a < 0 === b < 0 ? 1 : -1);
                s += w * dot(feat[i + a], feat[i + b]);
            }
        out[i] = Math.max(0, s);
    }
    return out;
}

// Recurrence: two moments recur when each is among the other's closest matches (mutual nearest neighbours,
// Serrà et al. 2012), so a noisy chorus counts as much as a clean verse. 1 = these two blocks sound alike.
export function recurrence(chroma: number[][], timbre: number[][]) {
    const n = chroma.length;
    const S: Float32Array[] = Array.from({ length: n }, () => new Float32Array(n));
    for (let i = 0; i < n; i++)
        for (let j = i; j < n; j++)
            S[i][j] = S[j][i] =
                0.7 * dot(chroma[i], chroma[j]) + (0.3 * (dot(timbre[i], timbre[j]) + 1)) / 2;
    const k = Math.max(4, Math.round(n * 0.1));
    const thr = S.map((row, i) => {
        const far = Array.from(row).filter((_, j) => Math.abs(i - j) >= 8);
        return far.sort((a, b) => b - a)[Math.min(k, far.length) - 1] ?? Infinity;
    });
    for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) S[i][j] = S[i][j] >= thr[i] && S[i][j] >= thr[j] ? 1 : 0;
    return S;
}

const nearestPeak = (nov: number[], target: number, lo: number, hi: number) => {
    const top = Math.max(...nov) || 1;
    let best = -1;
    for (let i = Math.max(1, lo); i <= Math.min(nov.length - 2, hi); i++) {
        const peak = nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1] && nov[i] >= 0.3 * top;
        if (peak && (best < 0 || Math.abs(i - target) < Math.abs(best - target))) best = i;
    }
    return best < 0 ? target : best;
};

// BolBeats: the best parts of a song, strongest first. The first is the hook (usually the chorus); after it, every
// section that sounds different (not another repeat of a part already picked, never overlapping one) and stands out
// from the song at least `stand` as much as the hook does (0.5 = halfway from the song's typical moment to its hook),
// like a drop, a post-chorus or a second hook. How many is up to the song: on 36 real songs, 8 had two. `max` only
// exists so callers can ask for the hook alone.
export function findHooks(
    channels: Float32Array[],
    sampleRate: number,
    len = 24,
    max = Infinity,
    stand = 0.5,
): { median: number; parts: [number, number][]; scores: number[] } {
    const m = toMono(channels, sampleRate);
    const half = new Float32Array(m.x.length >> 1);
    for (let i = 0; i < half.length; i++) half[i] = (m.x[2 * i] + m.x[2 * i + 1]) / 2;
    const sr = m.sr / 2;
    const duration = half.length / sr;
    const f = frames(half, sr);
    const fps = sr / HOP;
    const per = Math.max(1, Math.round(fps * BLOCK));
    const bs = per / fps; // a block's real length (0.51 s at 11 kHz), so times don't drift late in the song
    const n = Math.floor(f.rms.length / per);
    const L = Math.round(len / bs);
    if (n < L * 2) {
        const a = Math.max(0, Math.min(duration * 0.3, duration - len));
        return { median: 0, parts: [[a, Math.min(duration, a + len)]], scores: [0] };
    }
    const block = <T>(a: T[], b: number) => a.slice(b * per, (b + 1) * per);
    const chroma = Array.from({ length: n }, (_, b) => {
        const c = meanVec(block(f.chroma, b), 12);
        const top = Math.max(...c) || 1;
        return unit(c.map((v) => Math.log1p((10 * v) / top)));
    });
    // timbre without the loudness coefficient, each coefficient standardised over the song
    const raw = Array.from({ length: n }, (_, b) => meanVec(block(f.mfcc, b), 13).slice(1));
    const mu = meanVec(raw, 12);
    const sd = mu.map((_, k) => Math.sqrt(mean(raw.map((r) => (r[k] - mu[k]) ** 2))) || 1);
    const timbre = raw.map((r) => unit(r.map((v, k) => (v - mu[k]) / sd[k])));
    const db = Array.from({ length: n }, (_, b) => 20 * Math.log10(mean(block(f.rms, b)) + 1e-6));
    const flux = Array.from({ length: n }, (_, b) => mean(block(f.flux, b)));

    const nov = novelty(
        chroma.map((c, i) => [...c.map((v) => v * 0.8), ...timbre[i].map((v) => v * 0.6)]),
    );
    const S = recurrence(chroma, timbre);
    const scores = chorusScores(chroma, timbre, db, flux, L, nov, S);
    // near-ties are usually the same chorus at different times: take the earliest (Bartsch & Wakefield's rule), so the
    // pick doesn't flip between repeats on tiny decoding differences; a clearly bigger last chorus still wins
    const best = Math.max(...scores);
    const t0 = Math.max(
        0,
        scores.findIndex((v) => v >= best - 0.04),
    );

    // a short kernel places the cut within a beat or two of the real section change
    const sharp = novelty(
        chroma.map((c, i) => [...c.map((v) => v * 0.8), ...timbre[i].map((v) => v * 0.6)]),
        4,
    );
    const { beats, bpm } = tempo(f.flux, fps);
    const onBeat = (s: number) => {
        const b = beats.reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best), s);
        return Math.abs(b - s) <= 0.5 ? b : s;
    };
    const min = Math.round(12 / bs);
    const strong = 0.5 * Math.max(...nov);
    // choruses come in 4-bar phrases (8 or 16 bars mostly)
    const phrase = (16 * 60) / bpm;

    // One part from a starting block: start on the section change, last as long as the section keeps repeating
    // (12-45 s) ending at the first strong section change inside it, rounded to whole phrases, never past `stopAt` s.
    const refine = (t: number, stopAt: number) => {
        const a = nearestPeak(sharp, t, t - 6, t + 6);
        const run = repeatLength(S, a, min, Math.round(45 / bs));
        let cut = -1;
        for (let i = a + min; run && i <= Math.min(n - 2, a + run + 4) && cut < 0; i++)
            if (nov[i] >= strong && nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1]) cut = i;
        const goal = cut >= 0 ? cut : a + run;
        const z = run
            ? nearestPeak(sharp, goal, goal - 4, goal + 4)
            : nearestPeak(sharp, a + L, a + Math.round(L * 0.7), a + Math.round(L * 1.4));
        const start = Math.max(0, snapQuiet(half, sr, onBeat(a * bs), 0.12));
        let phrases = Math.max(2, Math.round(((z - a) * bs) / phrase));
        // a phrase that runs a little into the next picked section is kept and ends where that section starts
        while (
            phrases > 1 &&
            (phrases * phrase > 45 || start + phrases * phrase > stopAt + phrase / 4)
        )
            phrases--;
        const end = Math.min(
            duration,
            stopAt,
            snapQuiet(half, sr, onBeat(start + phrases * phrase), 0.12),
        );
        return { a, end: Math.max(end, Math.min(stopAt, start + 8)), start };
    };

    const hit = (i: number, j: number) => (S[i]?.[j - 1] || S[i]?.[j] || S[i]?.[j + 1] ? 1 : 0);
    // how strongly [t, t + min) happens again somewhere inside [a, z) (a repeat of a part already picked)
    const repeatOf = (t: number, a: number, z: number) => {
        let strongest = 0;
        for (let o = a - 2; o <= Math.max(a, z - min) + 2; o++) {
            if (Math.abs(o - t) < min) continue;
            let m = 0;
            for (let k = 0; k < min; k++) m += hit(t + k, o + k);
            strongest = Math.max(strongest, m / min);
        }
        return strongest;
    };

    // where a picked part and each repeat of it sit (block ranges): later parts start outside these and end before them
    const taken: [number, number][] = [];
    const take = (a: number, zb: number) => {
        taken.push([a, zb]);
        const m = Array.from({ length: Math.max(0, n - min + 1) }, (_, u) => {
            if (Math.abs(u - a) < min) return 0;
            let s = 0;
            for (let k = 0; k < min; k++) s += hit(a + k, u + k);
            return s / min;
        });
        // a repeat sits where the match peaks (a looping beat also half-matches a few seconds either side)
        const h = min >> 1;
        m.forEach((v, u) => {
            if (v >= 0.45 && v >= Math.max(...m.slice(Math.max(0, u - h), u + h + 1)))
                taken.push([u, u + (zb - a)]);
        });
    };

    const first = refine(t0, duration);
    const picked = [{ ...first, score: scores[t0], zb: Math.round(first.end / bs) }];
    take(first.a, picked[0].zb);
    const typical = median(scores);
    const order = scores.map((v, t) => [v, t] as const).sort((x, y) => y[0] - x[0]);
    for (const [v, t] of order) {
        if (
            picked.length >= max ||
            best - typical < 1e-6 ||
            (v - typical) / (best - typical) < stand
        )
            break;
        if (taken.some(([a, z]) => t + min > a - 2 && t < z + 2)) continue; // inside or touching a picked part or a repeat of one
        // the same section again: on real songs other choruses match the hook at 0.48 and up, different sections at 0.43 or less
        if (picked.some((p) => repeatOf(t, p.a, p.zb) >= 0.45)) continue;
        const next = taken.filter(([a]) => a > t).map(([a]) => a * bs);
        const part = refine(t, Math.min(duration, ...next));
        if (part.end - part.start < 8) continue;
        picked.push({ ...part, score: v, zb: Math.round(part.end / bs) });
        take(part.a, picked[picked.length - 1].zb);
    }
    // a part that changes to a clearly different sound halfway (a chorus running into the drop) becomes two parts at
    // that change, each at least a phrase long; played next to each other in a mix they still join seamlessly
    const feat = (a: number, z: number) =>
        unit(
            meanVec(
                chroma
                    .slice(a, z)
                    .map((c, i) => [
                        ...c.map((v) => v * 0.8),
                        ...timbre[a + i].map((v) => v * 0.6),
                    ]),
                24,
            ),
        );
    const novTop = Math.max(...nov) || 1;
    const out: { end: number; score: number; start: number }[] = [];
    for (const p of picked) {
        const pa = Math.round(p.start / bs);
        const pz = Math.round(p.end / bs);
        const minB = Math.round(phrase / bs);
        let cut = -1;
        for (let i = pa + minB; i <= pz - minB; i++)
            if (
                nov[i] >= nov[i - 1] &&
                nov[i] >= nov[i + 1] &&
                nov[i] >= 0.35 * novTop &&
                (cut < 0 || nov[i] > nov[cut])
            )
                cut = i;
        if (cut > 0 && dot(feat(pa, cut), feat(cut, pz)) < 0.8) {
            // split on the phrase line nearest the change
            const k = Math.max(1, Math.round((cut * bs - p.start) / phrase));
            const at = p.start + k * phrase;
            if (
                at - p.start >= Math.max(8, phrase * 0.75) &&
                p.end - at >= Math.max(8, phrase * 0.75)
            ) {
                out.push(
                    { end: at, score: p.score, start: p.start },
                    { end: p.end, score: p.score, start: at },
                );
                continue;
            }
        }
        out.push(p);
    }
    return {
        median: typical,
        parts: out.map((p) => [p.start, p.end] as [number, number]),
        scores: out.map((p) => p.score),
    };
}

// How long the section starting at block `a` keeps repeating: follow it alongside each place it clearly repeats
// (a block either side allows for tempo drift) until the match fades, never past where that repeat starts, and keep
// the longest (a chorus that repeats a line inside itself still counts as one chorus). 0 when nothing repeats clearly.
export function repeatLength(S: Float32Array[], a: number, min: number, max: number) {
    const n = S.length;
    const hit = (i: number, j: number) => (S[i]?.[j - 1] || S[i]?.[j] || S[i]?.[j + 1] ? 1 : 0);
    const partners: number[] = [];
    for (let u = 0; u + min <= n; u++) {
        if (Math.abs(u - a) < min) continue;
        let m = 0;
        for (let k = 0; k < min && a + k < n; k++) m += hit(a + k, u + k);
        if (m / min >= 0.4) partners.push(u);
    }
    const W = 8;
    let longest = 0;
    for (const u of partners) {
        const cap = Math.min(max, Math.abs(u - a), n - a, n - u);
        const hits: number[] = [];
        let run = cap;
        for (let k = 0; k < cap; k++) {
            hits.push(hit(a + k, u + k));
            if (k >= min && hits.slice(-W).reduce((x, y) => x + y, 0) / W < 0.35) {
                run = Math.max(min, k - W / 2);
                break;
            }
        }
        longest = Math.max(longest, run);
    }
    return longest;
}

// The hook alone (the first of findHooks).
export function suggestHook(
    channels: Float32Array[],
    sampleRate: number,
    len = 24,
): [number, number] {
    return findHooks(channels, sampleRate, len, 1).parts[0];
}

// All the best parts the song has, strongest first.
export function suggestHooks(
    channels: Float32Array[],
    sampleRate: number,
    len = 24,
): [number, number][] {
    return findHooks(channels, sampleRate, len).parts;
}

// ---------------- mixing ----------------

export const TRANSITIONS = {
    bass: 'Bass swap',
    blend: 'Beat blend',
    breath: 'Breath',
    cut: 'Cut on the beat',
    echo: 'Echo out',
    handoff: 'Sound handoff',
    jump: 'Seamless jump',
    sweep: 'Filter sweep',
} as const;
export type Fit = {
    energy: number;
    key: number;
    pct: number;
    sameSong: boolean;
    sound: number;
    tempo: number;
    total: number;
    tune: number;
};
export type Transition = {
    at?: number;
    beats?: number;
    len?: number;
    score: number;
    sec?: number;
    type: TransitionType;
    why: string;
};
export type TransitionType = keyof typeof TRANSITIONS;

const OVERLAP = new Set<TransitionType>(['bass', 'blend', 'handoff', 'jump', 'sweep']);

export type MixItem = {
    a: Analysis;
    buffer?: AudioBuffer;
    dur: number;
    off?: number;
    t: null | Transition;
    vol?: number;
};

// Mashup order: songs may take turns (A1 B2 B3 A2 B1). Switching songs scores the seam's fit plus a small bonus;
// carrying on in the same song scores 0.7 (its real fit is always perfect), so a switch needs a join fitting better
// than 0.6 to win. Measured on real playlists: smoothness stays close to Smart order and songs weave where they meet well.
export type Placed = { end: number; songId: string; start: number };

// Best order of n items for a playlist: the path that visits each once with the highest total fit w(i, j) between
// neighbours. Every order is compared for up to 12 items (Held-Karp dynamic programming, 2^n·n² steps); past that,
// greedy chains from many starts, polished by moving single items and reversing stretches until nothing improves.
export function bestPath(n: number, w: (i: number, j: number) => number): number[] {
    if (n <= 1) return n ? [0] : [];
    const W = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (_, j) => (i === j ? 0 : w(i, j))),
    );
    const score = (p: number[]) => p.slice(1).reduce((s, j, k) => s + W[p[k]][j], 0);
    if (n <= 12) {
        const full = (1 << n) - 1;
        const dp = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(-Infinity));
        const from = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
        for (let i = 0; i < n; i++) dp[1 << i][i] = 0;
        for (let mask = 1; mask <= full; mask++)
            for (let j = 0; j < n; j++) {
                if (!(mask & (1 << j)) || dp[mask][j] === -Infinity) continue;
                for (let k = 0; k < n; k++) {
                    if (mask & (1 << k)) continue;
                    const v = dp[mask][j] + W[j][k];
                    if (v > dp[mask | (1 << k)][k]) {
                        dp[mask | (1 << k)][k] = v;
                        from[mask | (1 << k)][k] = j;
                    }
                }
            }
        let end = 0;
        for (let j = 1; j < n; j++) if (dp[full][j] > dp[full][end]) end = j;
        const path: number[] = [];
        for (let j = end, mask = full; j >= 0;) {
            path.push(j);
            const prev = from[mask][j];
            mask &= ~(1 << j);
            j = prev;
        }
        return path.reverse();
    }
    let best: number[] = [];
    let bestScore = -Infinity;
    for (let s = 0; s < Math.min(n, 24); s++) {
        const path = [s];
        const left = new Set(Array.from({ length: n }, (_, i) => i).filter((i) => i !== s));
        while (left.size) {
            const last = path[path.length - 1];
            let pick = -1;
            for (const k of left) if (pick < 0 || W[last][k] > W[last][pick]) pick = k;
            path.push(pick);
            left.delete(pick);
        }
        const v = score(path);
        if (v > bestScore) [best, bestScore] = [path, v];
    }
    for (let improved = true, passes = 0; improved && passes < 50; passes++) {
        improved = false;
        for (let i = 0; i < n; i++)
            for (let j = 0; j < n; j++) {
                if (i === j) continue;
                const moved = [...best];
                const [x] = moved.splice(i, 1);
                moved.splice(j, 0, x);
                const v = score(moved);
                if (v > bestScore + 1e-9) [best, bestScore, improved] = [moved, v, true];
            }
        for (let i = 0; i < n - 1; i++)
            for (let j = i + 1; j < n; j++) {
                const flipped = [
                    ...best.slice(0, i),
                    ...best.slice(i, j + 1).reverse(),
                    ...best.slice(j + 1),
                ];
                const v = score(flipped);
                if (v > bestScore + 1e-9) [best, bestScore, improved] = [flipped, v, true];
            }
    }
    return best;
}

// Transition options for one seam, best first. beats/sec = how long the overlap lasts.
export function candidates(f: Fit): Transition[] {
    const keys = f.key >= 0.7 ? 'keys match' : f.key >= 0.3 ? 'keys are close' : 'keys differ';
    const list: Transition[] = [
        {
            beats: 8,
            score: 0.6 * f.tempo + 0.2 * f.tune + 0.2 * f.key,
            type: 'blend',
            why: `Tempos ${Math.round(f.pct)}% apart, ${keys}`,
        },
        {
            beats: 8,
            score: 0.5 * f.tempo + 0.3 * f.key + 0.2 * f.energy - 0.05,
            type: 'bass',
            why: 'Swaps the bass lines halfway so they never clash',
        },
        {
            score: 0.9 * f.sound ** 2,
            sec: 1.2,
            type: 'handoff',
            why: `The seam sounds alike (${Math.round(f.sound * 100)}% match)`,
        },
        {
            beats: 4,
            score: 0.45 + 0.2 * f.energy,
            type: 'sweep',
            why: 'Muffles the first part out while the next one opens up',
        },
        {
            beats: 2,
            score: 0.4 + 0.2 * (1 - f.tempo),
            type: 'echo',
            why: 'Echoes the last beat into the next part',
        },
        {
            beats: 0,
            score: 0.8 * f.tempo * f.energy,
            type: 'cut',
            why: 'A clean cut; tempo and energy already line up',
        },
        { score: 0.3, sec: 0.4, type: 'breath', why: 'A short pause, then the next part' },
    ];
    // Two parts of the same song share tempo and key: a tiny crossfade sounds like a radio edit.
    if (f.sameSong)
        list.push({
            score: 2,
            sec: 0.25,
            type: 'jump',
            why: 'Same song: jumps straight to the next part',
        });
    return list.sort((x, y) => y.score - x.score);
}

export function fit(a: Analysis, b: Analysis, sameSong = false): Fit {
    const r = Math.log2(b.bpm / a.bpm);
    const d = Math.min(Math.abs(r), Math.abs(r - 1), Math.abs(r + 1)); // half/double time counts
    const pct = (2 ** d - 1) * 100;
    const f = {
        energy: 1 - Math.abs(a.tail.rms - b.head.rms) / (Math.max(a.tail.rms, b.head.rms) || 1),
        key: keyFit(a.key, b.key),
        pct,
        sameSong,
        sound: clamp(1 - dtw(a.tail.mfcc, b.head.mfcc) / 0.5), // shortcut: 0.5 is a guessed scale; tune on real songs
        tempo: Math.exp(-((pct / 4) ** 2)),
        total: 0,
        tune: clamp(cosine(a.tail.chroma, b.head.chroma)),
    };
    f.total = sameSong
        ? 1
        : 0.3 * f.tempo + 0.25 * f.tune + 0.2 * f.key + 0.15 * f.energy + 0.1 * f.sound;
    return f;
}
// Evens out loudness: each part is scaled toward the median loudness, within ×0.5–×2.
export function gains(loudness: number[]) {
    const med = [...loudness].sort((a, b) => a - b)[loudness.length >> 1];
    return loudness.map((l) => Math.min(2, Math.max(0.5, med / (l || med))));
}

// A song's parts always play in song order, even with other songs between them: its places in the mix are
// refilled earliest part first.
export function inSongOrder<T extends Placed>(order: T[]): T[] {
    const bySong = new Map<string, T[]>();
    for (const p of order) bySong.set(p.songId, [...(bySong.get(p.songId) ?? []), p]);
    for (const list of bySong.values()) list.sort((a, b) => a.start - b.start);
    const used = new Map<string, number>();
    return order.map((p) => {
        const k = used.get(p.songId) ?? 0;
        used.set(p.songId, k + 1);
        return bySong.get(p.songId)![k];
    });
}

export function mashupWeight(a: Placed, b: Placed, crossFit: number) {
    if (a.songId !== b.songId) return crossFit + 0.1;
    return b.start >= a.end - 0.05 ? 0.7 : -1;
}

// Orders groups (one group = one song's parts, kept in song order) by how well each end fits the next start.
// Greedy from every start; shuffle=true picks a different, still good, order.
export function orderGroups<T>(groups: T[], fitOf: (a: T, b: T) => number, shuffle = false): T[] {
    if (groups.length < 3 && !shuffle) return groups;
    let best: null | { path: T[]; total: number } = null;
    // Greedy chains from up to 16 starting songs: good enough, and stays fast for big libraries (n² per start).
    const starts = shuffle
        ? [groups[Math.floor(Math.random() * groups.length)]]
        : groups.slice(0, 16);
    for (const s of starts) {
        const path = [s];
        const left = new Set(groups);
        left.delete(s);
        let total = 0;
        while (left.size) {
            const ranked = [...left]
                .map((g) => [g, fitOf(path[path.length - 1], g)] as const)
                .sort((x, y) => y[1] - x[1]);
            const [g, v] = ranked[shuffle && ranked.length > 1 && Math.random() < 0.5 ? 1 : 0];
            path.push(g);
            left.delete(g);
            total += v;
        }
        if (!best || total > best.total) best = { path, total };
    }
    return best!.path;
}

// Schedules every part and transition on the context. Returns t0 (context time of mix start) and stop().
export function play(
    ctx: AudioContext,
    items: MixItem[],
    at: number[],
    out: AudioNode = ctx.destination,
) {
    const t0 = ctx.currentTime + 0.15;
    const master = ctx.createGain();
    master.connect(out);
    const n = items.map((it, i) => {
        const src = ctx.createBufferSource();
        const shelf = ctx.createBiquadFilter();
        const hp = ctx.createBiquadFilter();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        src.buffer = it.buffer!;
        shelf.type = 'lowshelf';
        shelf.frequency.value = 220;
        hp.type = 'highpass';
        hp.frequency.value = 10;
        lp.type = 'lowpass';
        lp.frequency.value = 20000;
        g.gain.value = 0;
        src.connect(shelf).connect(hp).connect(lp).connect(g).connect(master);
        src.start(t0 + at[i], it.off ?? 0, it.dur);
        return {
            end: t0 + at[i] + it.dur,
            g,
            hp,
            lp,
            shelf,
            src,
            start: t0 + at[i],
            v: it.vol ?? 1,
        };
    });
    n[0].g.gain.setValueAtTime(0, n[0].start);
    n[0].g.gain.linearRampToValueAtTime(n[0].v, n[0].start + 0.05);
    const last = n[n.length - 1];
    fade(last.g.gain, last.v, 0, last.end - 0.4, 0.4);
    const timers: ReturnType<typeof setTimeout>[] = [];

    items.slice(0, -1).forEach(({ t }, i) => {
        const A = n[i];
        const B = n[i + 1];
        const s = t0 + t!.at!;
        const len = t!.len!;
        const e = s + len;
        switch (t!.type) {
            case 'bass': {
                const mid = s + len / 2;
                fade(A.g.gain, A.v, 0, s, len);
                fade(B.g.gain, 0, B.v, s, len * 0.6);
                B.shelf.gain.setValueAtTime(-30, s);
                B.shelf.gain.setValueAtTime(-30, mid - 0.05);
                B.shelf.gain.linearRampToValueAtTime(0, mid);
                A.shelf.gain.setValueAtTime(0, mid - 0.05);
                A.shelf.gain.linearRampToValueAtTime(-30, mid);
                break;
            }
            case 'blend':
            case 'handoff':
            case 'jump':
                fade(A.g.gain, A.v, 0, s, len);
                fade(B.g.gain, 0, B.v, s, len);
                break;
            case 'echo': {
                const send = ctx.createGain();
                const delay = ctx.createDelay(4);
                const fb = ctx.createGain();
                delay.delayTime.value = len * 0.75;
                fb.gain.value = 0.45;
                send.gain.value = 0;
                A.lp.connect(send).connect(delay).connect(master);
                delay.connect(fb).connect(delay);
                send.gain.setValueAtTime(0, s);
                send.gain.linearRampToValueAtTime(0.8, e);
                send.gain.setValueAtTime(0, e + 0.01);
                // let the echo ring out, then stop feeding back
                timers.push(
                    setTimeout(() => (fb.gain.value = 0), (e - ctx.currentTime + 4 * len) * 1000),
                );
                fade(A.g.gain, A.v, 0, s, len);
                fade(B.g.gain, 0, B.v, B.start, 0.05);
                break;
            }
            case 'sweep':
                A.lp.frequency.setValueAtTime(20000, s);
                A.lp.frequency.exponentialRampToValueAtTime(300, e);
                B.hp.frequency.setValueAtTime(1500, s);
                B.hp.frequency.exponentialRampToValueAtTime(10, e);
                fade(A.g.gain, A.v, 0, s + len * 0.5, len * 0.5);
                fade(B.g.gain, 0, B.v, s, len * 0.5);
                break;
            default: {
                // cut, breath
                const f = t!.type === 'cut' ? 0.015 : 0.12;
                fade(A.g.gain, A.v, 0, A.end - f, f);
                fade(B.g.gain, 0, B.v, B.start, 0.02);
            }
        }
    });
    return {
        stop: () => {
            timers.forEach(clearTimeout);
            master.disconnect();
            n.forEach((x) => {
                try {
                    x.src.stop();
                } catch {
                    /* not started */
                }
            });
        },
        t0,
    };
}

// Returns start times (s); fills t.at (when the transition starts) and t.len (how long it lasts).
export function timeline(items: MixItem[]) {
    const at = [0];
    for (let i = 0; i < items.length - 1; i++) {
        const { a, dur, off = 0 } = items[i];
        const t = items[i].t!;
        const b = items[i + 1];
        const beat = 60 / a.bpm;
        const end = at[i] + dur;
        let next: number;
        if (OVERLAP.has(t.type)) {
            const want = Math.min(
                t.beats != null ? t.beats * beat : (t.sec ?? 1),
                dur / 2,
                b.dur / 2,
            );
            let s = dur - want;
            const free = t.type === 'handoff' || t.type === 'jump';
            const bOff = b.off ?? 0;
            const lead = free ? 0 : (b.a.beats.find((x) => x >= bOff) ?? bOff) - bOff;
            if (!free)
                s =
                    a.beats
                        .map((x) => x - off)
                        .filter((x) => x <= s && x > dur / 2)
                        .pop() ?? s; // land on A's beat
            next = Math.max(at[i] + dur / 2, at[i] + s - lead);
            Object.assign(t, { at: next, len: end - next });
        } else if (t.type === 'echo') {
            next = end;
            Object.assign(t, { at: end - beat, len: beat });
        } else {
            next = end + (t.type === 'breath' ? (t.sec ?? 0.4) : 0);
            Object.assign(t, { at: end, len: 0 });
        }
        at.push(next);
    }
    return at;
}

// Equal-power fade; falls back to a straight ramp if it collides with another automation event.
function fade(p: AudioParam, from: number, to: number, s: number, len: number) {
    const curve = Float32Array.from({ length: 64 }, (_, i) => {
        const x = ((Math.PI / 2) * i) / 63;
        return to > from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x);
    });
    try {
        p.setValueCurveAtTime(curve, s, Math.max(0.01, len));
    } catch {
        p.setValueAtTime(from, s);
        p.linearRampToValueAtTime(to, s + Math.max(0.01, len));
    }
}
