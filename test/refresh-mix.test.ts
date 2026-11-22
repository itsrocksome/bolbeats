import assert from 'node:assert/strict';
import { test } from 'node:test';

import { refreshPlan } from '../src/renderer/features/best-parts/refresh-mix.ts';

const p = (id: string, songId: string, start: number, end: number, created = 1) => ({
    created,
    end,
    id,
    songId,
    start,
});

test('a part made longer is swapped in where the old one was; your order stays', () => {
    const parts = {
        a1: p('a1', 'A', 60, 80),
        a1x: p('a1x', 'A', 55, 90, 5), // the longer find of a1
        b1: p('b1', 'B', 30, 60),
    };
    assert.deepEqual(refreshPlan(['b1', 'a1'], parts), { changed: true, partIds: ['b1', 'a1x'] });
});

test("a song's new part joins right after that song's last part; other songs aren't added", () => {
    const parts = {
        a1: p('a1', 'A', 60, 90),
        a2: p('a2', 'A', 150, 180, 5), // new
        b1: p('b1', 'B', 30, 60),
        c1: p('c1', 'C', 10, 40), // not in the playlist
    };
    assert.deepEqual(refreshPlan(['a1', 'b1'], parts).partIds, ['a1', 'a2', 'b1']);
});

test('deleted parts drop out, and nothing changed means nothing to do', () => {
    const parts = { a1: p('a1', 'A', 60, 90), b1: p('b1', 'B', 30, 60) };
    assert.deepEqual(refreshPlan(['a1', 'gone', 'b1'], parts), {
        changed: true,
        partIds: ['a1', 'b1'],
    });
    assert.equal(refreshPlan(['a1', 'b1'], parts).changed, false);
});

test('an older overlapping part never replaces a newer one', () => {
    const parts = { new1: p('new1', 'A', 60, 95, 9), old1: p('old1', 'A', 62, 80, 1) };
    assert.deepEqual(refreshPlan(['new1'], parts), { changed: false, partIds: ['new1'] });
});

test('a part you made never gives way to one BolBeats found', () => {
    const parts = {
        found: { ...p('found', 'A', 55, 95, 9), auto: true },
        mine: { ...p('mine', 'A', 60, 80, 1), auto: false },
    };
    assert.equal(refreshPlan(['mine'], parts).partIds[0], 'mine');
});

test('a part you took out after it existed is not offered again', () => {
    const parts = { a1: p('a1', 'A', 60, 90, 1), a2: p('a2', 'A', 150, 180, 5) };
    assert.equal(refreshPlan(['a1'], parts, 10).changed, false); // the playlist changed after a2 was made
    assert.deepEqual(refreshPlan(['a1'], parts, 3).partIds, ['a1', 'a2']);
});
