// The chorus finder on synthetic pop songs whose chorus positions are known: chords change every 2 s, verse and chorus
// share chords but in a different order (so only a real repeat lines up), the chorus has its own melody and hi-hats.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { suggestHook } from '../src/renderer/features/best-parts/engine/engine.ts';

const SR = 22050;
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const triad = (root: number, minor = false) => [root, root + (minor ? 3 : 4), root + 7];
const Am = triad(57, true),
    C = triad(48),
    Dm = triad(50, true),
    Em = triad(52, true),
    F = triad(53),
    G = triad(55);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

type Sec = {
    chords: number[][];
    gain: number;
    hats?: boolean;
    melody?: number[];
    sec: number;
    up?: number;
};

// 120 BPM: a kick every 0.5 s, chords every 2 s, one melody note per 0.5 s, hi-hats on eighths when `hats`.
const render = (s: Sec) => {
    const x = new Float32Array(Math.round(s.sec * SR));
    const up = s.up ?? 0;
    for (let i = 0; i < x.length; i++) {
        const t = i / SR;
        const beat = t % 0.5;
        const ch = s.chords[Math.floor(t / 2) % s.chords.length];
        let v = 0.35 * Math.exp(-beat * 30) * Math.sin(2 * Math.PI * 55 * beat);
        for (const n of ch) v += 0.08 * Math.sin(2 * Math.PI * hz(n + up) * t);
        if (s.melody)
            v +=
                0.12 *
                Math.sin(
                    2 * Math.PI * hz(s.melody[Math.floor(t / 0.5) % s.melody.length] + up) * t,
                );
        if (s.hats) v += 0.05 * Math.exp(-(t % 0.25) * 80) * rnd();
        x[i] = v * s.gain;
    }
    return x;
};

const build = (secs: Sec[]) => {
    const parts = secs.map(render);
    const x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    const at: number[] = [];
    parts.reduce((o, p) => (at.push(o / SR), x.set(p, o), o + p.length), 0);
    // a gentle fade on the last section
    const last = parts.at(-1)!.length;
    for (let i = 0; i < last; i++) x[x.length - last + i] *= 1 - i / last;
    return { at, x };
};

const verse: Sec = {
    chords: [Am, F, C, G],
    gain: 0.45,
    melody: [69, 69, 67, 64, 65, 65, 64, 60],
    sec: 16,
};
const chorus: Sec = {
    chords: [F, G, Am, C],
    gain: 0.85,
    hats: true,
    melody: [72, 76, 74, 72, 74, 76, 79, 76],
    sec: 16,
};
const intro: Sec = { chords: [Am, F], gain: 0.25, sec: 8 };
const bridge: Sec = { chords: [Dm, Em], gain: 0.6, melody: [62, 64, 65, 67], sec: 12 };
const outro: Sec = { chords: [Am, F], gain: 0.3, sec: 10 };

const inside = (a: number, b: number, starts: number[], len: number) =>
    starts.some((s) => Math.abs(a - s) <= 1 && Math.abs(b - (s + len)) <= 3);

test('finds the chorus of a verse-chorus song, starting where the chorus starts', () => {
    const song = [intro, verse, chorus, verse, chorus, bridge, chorus, outro];
    const { at, x } = build(song);
    const choruses = song.map((s, i) => (s === chorus ? at[i] : -1)).filter((t) => t >= 0);
    const [a, b] = suggestHook([x], SR, 16);
    assert.ok(
        inside(a, b, choruses, 16),
        `picked ${a.toFixed(1)}-${b.toFixed(1)}, choruses at ${choruses.join(', ')}`,
    );
});

test('a chorus that repeats beats one louder moment that never comes back', () => {
    const loudBridge: Sec = {
        chords: [Dm, Em, Dm, G],
        gain: 1.1,
        hats: true,
        melody: [74, 77, 79, 81],
        sec: 16,
    };
    const quieterChorus: Sec = { ...chorus, gain: 0.6 };
    const song = [
        intro,
        verse,
        quieterChorus,
        verse,
        quieterChorus,
        loudBridge,
        quieterChorus,
        outro,
    ];
    const { at, x } = build(song);
    const choruses = song.map((s, i) => (s === quieterChorus ? at[i] : -1)).filter((t) => t >= 0);
    const [a, b] = suggestHook([x], SR, 16);
    assert.ok(
        inside(a, b, choruses, 16),
        `picked ${a.toFixed(1)}-${b.toFixed(1)}, choruses at ${choruses.join(', ')}`,
    );
});

test('a last chorus in a higher key still counts as the chorus', () => {
    const lift: Sec = { ...chorus, gain: 0.95, up: 2 };
    const song = [intro, verse, chorus, verse, chorus, bridge, lift, outro];
    const { at, x } = build(song);
    const choruses = song
        .map((s, i) => (s === chorus || s === lift ? at[i] : -1))
        .filter((t) => t >= 0);
    const [a, b] = suggestHook([x], SR, 16);
    assert.ok(
        inside(a, b, choruses, 16),
        `picked ${a.toFixed(1)}-${b.toFixed(1)}, choruses at ${choruses.join(', ')}`,
    );
});

test('a long quiet intro is never the hook, and the 22 s default still lands on a chorus', () => {
    const longIntro: Sec = { ...intro, sec: 20 };
    const song = [longIntro, verse, chorus, verse, chorus, chorus, outro];
    const { at, x } = build(song);
    const choruses = song.map((s, i) => (s === chorus ? at[i] : -1)).filter((t) => t >= 0);
    const [a, b] = suggestHook([x], SR, 22);
    assert.ok(a >= 20, `picked ${a.toFixed(1)} inside the intro`);
    assert.ok(
        choruses.some((s) => a >= s - 1.5 && a < s + 16),
        `picked ${a.toFixed(1)}-${b.toFixed(1)}, choruses at ${choruses.join(', ')}`,
    );
    assert.ok(b - a >= 15 && b - a <= 32, `length ${(b - a).toFixed(1)}`);
});

test('short songs still get a sensible part inside the song', () => {
    const { x } = build([verse, { ...chorus, sec: 12 }]);
    const dur = x.length / SR;
    const [a, b] = suggestHook([x], SR, 22);
    assert.ok(
        a >= 0 && b <= dur + 1e-6 && b > a,
        `picked ${a.toFixed(1)}-${b.toFixed(1)} of ${dur.toFixed(1)}`,
    );
});

test('the part is as long as the chorus: 8, 12 and 16-bar choruses', () => {
    for (const len of [16, 24, 32]) {
        const c: Sec = { ...chorus, sec: len };
        const song = [intro, verse, c, verse, c, bridge, c, outro];
        const { at, x } = build(song);
        const choruses = song.map((s, i) => (s === c ? at[i] : -1)).filter((t) => t >= 0);
        const [a, b] = suggestHook([x], SR, 22);
        assert.ok(
            inside(a, b, choruses, len),
            `${len} s chorus: picked ${a.toFixed(1)}-${b.toFixed(1)} (${(b - a).toFixed(1)} s), choruses at ${choruses.join(', ')}`,
        );
    }
});

// verse and chorus always come as a pair here, so the pair repeats too: the part must still stop where the chorus does
test('a chorus always followed by the same verse still ends with the chorus', () => {
    for (const len of [16, 24]) {
        const c: Sec = { ...chorus, sec: len };
        const song = [intro, verse, c, verse, c, verse, c, outro];
        const { at, x } = build(song);
        const choruses = song.map((s, i) => (s === c ? at[i] : -1)).filter((t) => t >= 0);
        const [a, b] = suggestHook([x], SR, 22);
        const msg = `${len} s chorus: picked ${a.toFixed(1)}-${b.toFixed(1)}, choruses at ${choruses.join(', ')}`;
        assert.ok(
            choruses.some((s) => Math.abs(b - (s + len)) <= 3),
            msg,
        );
        assert.ok(b - a <= len + 10, msg); // never a whole verse (16 s) extra
    }
});
