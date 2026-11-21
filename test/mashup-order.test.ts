// Ordering a playlist of best parts: the exact search really finds the best order, the big-playlist search beats a
// plain greedy chain, and mashup weighting interleaves parts of different songs (A1 B2 B3 A2 B1).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    bestPath,
    inSongOrder,
    mashupWeight,
    orderGroups,
} from '../src/renderer/features/best-parts/engine/engine.ts';

let seed = 3;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const matrix = (n: number) =>
    Array.from({ length: n }, () => Array.from({ length: n }, () => rnd()));
const total = (W: number[][], p: number[]) => p.slice(1).reduce((s, j, k) => s + W[p[k]][j], 0);
const perms = (a: number[]): number[][] =>
    a.length <= 1
        ? [a]
        : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));

test('bestPath finds the best of every possible order (checked against all orders)', () => {
    for (let round = 0; round < 20; round++) {
        const n = 3 + (round % 5); // 3..7 items
        const W = matrix(n);
        const p = bestPath(n, (i, j) => W[i][j]);
        assert.equal(new Set(p).size, n, 'each item once');
        const best = Math.max(...perms([...Array(n).keys()]).map((q) => total(W, q)));
        assert.ok(Math.abs(total(W, p) - best) < 1e-9, `round ${round}: ${total(W, p)} vs ${best}`);
    }
});

test('big playlists: the search is never worse than a greedy chain, and visits everything once', () => {
    for (const n of [13, 20, 40]) {
        const W = matrix(n);
        const p = bestPath(n, (i, j) => W[i][j]);
        assert.equal(new Set(p).size, n);
        const greedy = orderGroups([...Array(n).keys()], (i, j) => W[i][j]);
        assert.ok(
            total(W, p) >= total(W, greedy) - 1e-9,
            `n=${n}: ${total(W, p).toFixed(2)} < greedy ${total(W, greedy).toFixed(2)}`,
        );
    }
});

test('mashup: parts of two songs interleave where they fit (A1 B2 B3 A2 B1), never rewinding a song', () => {
    const parts = {
        A1: { end: 20, songId: 'A', start: 0 },
        A2: { end: 112, songId: 'A', start: 100 },
        B1: { end: 154, songId: 'B', start: 134 },
        B2: { end: 42, songId: 'B', start: 30 },
        B3: { end: 82, songId: 'B', start: 70 },
    };
    const names = Object.keys(parts) as (keyof typeof parts)[];
    // how well the end of one part fits the start of another, across songs
    const cross: Record<string, number> = { 'A1>B2': 0.95, 'A2>B1': 0.95, 'B3>A2': 0.95 };
    const w = (i: number, j: number) =>
        mashupWeight(parts[names[i]], parts[names[j]], cross[`${names[i]}>${names[j]}`] ?? 0.3);
    const order = bestPath(names.length, w).map((i) => names[i]);
    assert.deepEqual(order, ['A1', 'B2', 'B3', 'A2', 'B1']);
    // the same parts kept song by song would flow worse here
    const byScore = (o: string[]) =>
        o
            .slice(1)
            .reduce((s, x, k) => s + w(names.indexOf(o[k] as never), names.indexOf(x as never)), 0);
    assert.ok(byScore(order) > byScore(['A1', 'A2', 'B2', 'B3', 'B1']));
    // never a backwards jump inside one song (B3 then B2)
    for (let k = 1; k < order.length; k++) {
        const a = parts[order[k - 1] as keyof typeof parts];
        const b = parts[order[k] as keyof typeof parts];
        assert.ok(
            a.songId !== b.songId || b.start >= a.end - 0.05,
            `${order[k - 1]} → ${order[k]} rewinds`,
        );
    }
});

test('mashup: a song never goes back in time, even with other songs between its parts', () => {
    const A1 = { end: 20, songId: 'A', start: 0 };
    const A2 = { end: 80, songId: 'A', start: 60 };
    const A3 = { end: 140, songId: 'A', start: 120 };
    const B1 = { end: 30, songId: 'B', start: 10 };
    assert.deepEqual(inSongOrder([A3, B1, A1, A2]), [A1, B1, A2, A3]);
    assert.deepEqual(inSongOrder([B1, A1, A2]), [B1, A1, A2]);
});

test('mashup: switching songs must fit well to beat carrying on in the same song', () => {
    const a = { end: 20, songId: 'A', start: 0 };
    const next = { end: 80, songId: 'A', start: 60 };
    const other = { end: 30, songId: 'B', start: 10 };
    assert.ok(mashupWeight(a, other, 0.55) < mashupWeight(a, next, 1));
    assert.ok(mashupWeight(a, other, 0.7) > mashupWeight(a, next, 1));
});
