import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    readSharedMix,
    shareFileName,
    toSharedMix,
} from '../src/renderer/features/best-parts/share-mix.ts';

const part = (id: string, title: string, start: number, end: number) => ({
    album: 'Album',
    artist: 'Artist',
    end,
    id,
    seconds: 200.04,
    start,
    title,
});

test('a playlist goes out and comes back with its parts, order and joins', () => {
    const parts = [
        part('a', 'One', 40, 70),
        part('b', 'Two', 60.1234, 95),
        part('c', 'Three', 10, 40),
    ];
    const shared = toSharedMix('Road trip', parts, { 'a>b': 'blend', 'b>c': 'echo', 'c>a': 'cut' });
    assert.deepEqual(shared.joins, { '0>1': 'blend', '1>2': 'echo' }); // only joins between neighbours travel
    assert.equal(shared.parts[1].start, 60.123);
    assert.equal(shared.parts[0].seconds, 200);
    const back = readSharedMix(JSON.stringify(shared));
    assert.deepEqual(back, shared);
});

test("a file that isn't a BolBeats playlist, or is broken, is refused", () => {
    assert.equal(readSharedMix('not json'), null);
    assert.equal(readSharedMix('{"app":"Other","parts":[]}'), null);
    assert.equal(readSharedMix(JSON.stringify({ ...toSharedMix('x', [], {}), parts: [] })), null);
});

test('bad parts, joins and covers from someone else are dropped, the rest kept', () => {
    const shared = toSharedMix('Mix', [part('a', 'One', 40, 70), part('b', 'Two', 60, 95)], {});
    const raw = {
        ...shared,
        cover: 'javascript:alert(1)',
        joins: { '0>1': 'blend', '0>5': 'cut', '1>2': 'explode', __proto__: 'x' },
        name: 'x'.repeat(500),
        parts: [
            ...shared.parts,
            { ...shared.parts[0], end: 10, start: 20 }, // ends before it starts
            { ...shared.parts[0], start: -5 },
            { ...shared.parts[0], title: '' },
            { ...shared.parts[0], start: 'soon' },
        ],
    };
    const back = readSharedMix(JSON.stringify(raw))!;
    assert.equal(back.parts.length, 2);
    assert.deepEqual(back.joins, { '0>1': 'blend' });
    assert.equal(back.cover, undefined);
    assert.equal(back.name, 'Shared best parts');
});

test('file names lose characters the Mac or Windows refuse', () => {
    assert.equal(shareFileName('Late night: hits/vol 2'), 'Late night- hits-vol 2.bolbeats');
    assert.equal(shareFileName('  '), 'Best parts.bolbeats');
});
