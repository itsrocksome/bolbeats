import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    arc,
    energies,
    madeForYou,
    seeded,
    streak,
    tune,
} from '../src/renderer/features/best-parts/engine/recommend.ts';

const part = (i: number, loudness: number, bpm: number, tonic = 0) => ({
    analysis: { bpm, key: { minor: false, tonic }, loudness },
    end: 20,
    id: `p${i}`,
    songId: `s${i}`,
    start: 0,
});
const parts = Array.from({ length: 10 }, (_, i) => part(i, 0.1 + i * 0.05, 80 + i * 8, i % 3));
const sameTonic = (a: { tonic: number }, b: { tonic: number }) => a.tonic === b.tonic;

test('energies: calm parts score low, loud fast parts high', () => {
    const e = energies(parts);
    assert.equal(e.get('p0'), 0);
    assert.equal(e.get('p9'), 1);
});

test('arc: climbs to a peak inside the set, not at the edges', () => {
    const order = arc([1, 2, 3, 4, 5, 6, 7, 8, 9], (x) => x);
    const peak = order.indexOf(9);
    assert.ok(peak > 0 && peak < order.length - 1, `peak at ${peak}`);
    assert.equal(order[0], 1);
});

test('seeded: same day, same picks', () => {
    assert.equal(seeded('2026-11-20')(), seeded('2026-11-20')());
    assert.notEqual(seeded('2026-11-20')(), seeded('2026-11-21')());
});

test('madeForYou: daily mix plus energy and key playlists, no repeated songs', () => {
    const recs = madeForYou(parts, {}, '2026-11-20', Date.now(), sameTonic);
    const ids = recs.map((r) => r.id);
    assert.deepEqual(ids, ['daily', 'hype', 'calm', 'key']);
    for (const r of recs) assert.equal(new Set(r.partIds).size, r.partIds.length);
    assert.deepEqual(madeForYou(parts, {}, '2026-11-20', 0, sameTonic)[0].partIds, recs[0].partIds);
});

test('tune: fills about the asked length with parts near the asked energy', () => {
    const ids = tune(parts, 1, 1); // 1 minute of hype = three 20 s parts
    assert.equal(ids.length, 3);
    assert.ok(ids.includes('p9'));
});

test('streak: counts consecutive days with a minute or more', () => {
    const days = { '2026-11-18': 300, '2026-11-19': 90, '2026-11-20': 10 };
    assert.equal(streak(days, new Date(2026, 10, 20, 12)), 2); // today not started yet: counts from yesterday
    assert.equal(streak({ ...days, '2026-11-20': 61 }, new Date(2026, 10, 20, 12)), 3);
});

test('madeForYou: thumbs-up parts get a playlist of their own once there are three', () => {
    const two = madeForYou(parts, {}, '2026-11-20', 0, sameTonic, new Set(['p1', 'p4']));
    assert.ok(!two.some((r) => r.id === 'liked'));
    const three = madeForYou(parts, {}, '2026-11-20', 0, sameTonic, new Set(['p1', 'p4', 'p7']));
    assert.deepEqual(three.find((r) => r.id === 'liked')?.partIds.sort(), ['p1', 'p4', 'p7']);
});
