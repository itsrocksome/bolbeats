import assert from 'node:assert/strict';
import test from 'node:test';

import {
    analyze,
    candidates,
    detectKey,
    dtw,
    fit,
    keyFit,
    type MixItem,
    orderGroups,
    snapQuiet,
    suggestHook,
    timeline,
} from '../src/renderer/features/best-parts/engine/engine.ts';

const SR = 22050;
// Kick-like clicks at `bpm` over a sustained chord (MIDI notes).
function song(bpm: number, notes: number[], sec = 20, sr = SR) {
    const beat = 60 / bpm,
        x = new Float32Array(sr * sec);
    for (let i = 0; i < x.length; i++) {
        const t = i / sr,
            since = t % beat;
        x[i] =
            0.5 * Math.exp(-since * 40) * Math.sin(2 * Math.PI * 60 * since) +
            notes.reduce(
                (s, n) => s + 0.1 * Math.sin(2 * Math.PI * 440 * 2 ** ((n - 69) / 12) * t),
                0,
            );
    }
    return x;
}

test('finds tempo and key', () => {
    const a = analyze([song(120, [60, 64, 67])], SR); // C major
    assert.ok(Math.abs(a.bpm - 120) < 3, `bpm ${a.bpm}`);
    assert.deepEqual(a.key, { minor: false, tonic: 0 });
    assert.ok(a.beats.length > 30);
    // 48 kHz (browser decode rate), low notes, D–G–A–D progression → D major
    const parts = [
        [50, 54, 57],
        [55, 59, 62],
        [57, 61, 64],
        [50, 54, 57],
    ].map((n) => song(100, n, 5, 48000));
    const x = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    parts.reduce((o, p) => (x.set(p, o), o + p.length), 0);
    assert.deepEqual(analyze([x], 48000).key, { minor: false, tonic: 2 });
});

test('key fit and DTW basics', () => {
    assert.equal(keyFit({ minor: false, tonic: 0 }, { minor: false, tonic: 0 }), 1);
    assert.ok(keyFit({ minor: false, tonic: 0 }, { minor: false, tonic: 6 }) === 0);
    const v = [Float32Array.of(0, 1, 2), Float32Array.of(0, 2, 1)];
    assert.ok(dtw(v, v) < 1e-9);
    assert.deepEqual(detectKey(Float32Array.of(1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0)).minor, true); // A, C, E, G-ish → A minor
});

test('snaps a cut into silence', () => {
    const x = new Float32Array(SR).fill(0.5);
    x.fill(0, SR / 2 - 400, SR / 2 + 400);
    assert.ok(Math.abs(snapQuiet(x, SR, 0.4) - 0.5) < 0.03);
});

test('mixer prefers the matching pair and builds a sane timeline', () => {
    const A = analyze([song(120, [60, 64, 67])], SR);
    const B = analyze([song(121, [60, 64, 67])], SR);
    const C = analyze([song(90, [66, 70, 73])], SR);
    assert.ok(fit(A, B).total > fit(A, C).total);
    const order = orderGroups([A, C, B], (x, y) => fit(x, y).total);
    assert.equal(Math.abs(order.indexOf(A) - order.indexOf(B)), 1);
    const items: MixItem[] = [A, B].map((a) => ({ a, dur: 20, off: 0, t: null }));
    items[0].t = { ...candidates(fit(A, B)).find((c) => c.type === 'blend')! };
    const at = timeline(items);
    assert.ok(at[1] > 10 && at[1] < 20, `B starts at ${at[1]}`);
    assert.ok(items[0].t!.len! > 0 && Math.abs(items[0].t!.at! + items[0].t!.len! - 20) < 1e-9);
});

test('two parts of the same song join with a seamless jump', () => {
    const A = analyze([song(120, [60, 64, 67])], SR);
    const top = candidates(fit(A, A, true))[0];
    assert.equal(top.type, 'jump');
    const items: MixItem[] = [
        { a: A, dur: 20, t: { ...top } },
        { a: A, dur: 15, t: null },
    ];
    const at = timeline(items);
    assert.ok(Math.abs(at[1] - (20 - 0.25)) < 1e-9, `jump starts at ${at[1]}`);
});

test('suggests the loud repeated section as the hook', () => {
    // verse (quiet, chord A) / chorus (loud, chord B) / verse / chorus / outro
    const sec = (bpm: number, notes: number[], s: number, gain: number) =>
        song(bpm, notes, s).map((v) => v * gain);
    const parts = [
        sec(110, [57, 60, 64], 30, 0.3),
        sec(110, [53, 57, 60, 65], 25, 1),
        sec(110, [57, 60, 64], 30, 0.3),
        sec(110, [53, 57, 60, 65], 25, 1),
        sec(110, [57, 60, 64], 20, 0.3),
    ];
    const x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((o, p) => (x.set(p, o), o + p.length), 0);
    const [a, b] = suggestHook([x], SR);
    const inChorus = (t: number) => (t >= 29 && t <= 56) || (t >= 84 && t <= 111);
    assert.ok(inChorus(a + 1) && b - a > 20, `suggested ${a.toFixed(1)}-${b.toFixed(1)}`);
});
