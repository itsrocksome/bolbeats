import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    applyLeadIn,
    type Edit,
    isDisliked,
    learn,
} from '../src/renderer/features/best-parts/engine/taste-learn.ts';

const edit = (found: [number, number], chosen: [number, number]): Edit => ({ chosen, found });

test('nothing is learned from fewer than 3 edits', () => {
    const t = learn({ edits: [edit([60, 90], [50, 110]), edit([30, 60], [20, 80])] });
    assert.deepEqual(t, { edits: 2, leadIn: null, minPart: null });
});

test('someone who keeps making parts longer and starting earlier gets longer, earlier parts', () => {
    const t = learn({
        edits: [
            edit([60, 90], [52, 112]), // 60 s, 8 s earlier
            edit([30, 58], [22, 80]), // 58 s, 8 s earlier
            edit([100, 128], [91, 150]), // 59 s, 9 s earlier
            edit([40, 70], [40, 70]), // left as is (one odd one doesn't swing the median)
        ],
    });
    assert.equal(t.leadIn, 8);
    assert.ok(t.minPart! >= 45 && t.minPart! <= 55, `minPart ${t.minPart}`);
});

test('someone who trims parts gets shorter ones, never under 15 s', () => {
    const t = learn({
        edits: [edit([60, 92], [64, 76]), edit([30, 62], [34, 46]), edit([100, 131], [104, 117])],
    });
    assert.equal(t.minPart, 15);
    assert.equal(t.leadIn, -4);
});

test('a part is disliked by thumbs down or by being skipped more than heard', () => {
    const base = { heard: {}, skips: {}, votes: {} };
    assert.equal(isDisliked({ ...base, votes: { a: -1 } }, 'a'), true);
    assert.equal(isDisliked({ ...base, skips: { a: 1 } }, 'a'), false); // once is a mood, not a verdict
    assert.equal(isDisliked({ ...base, heard: { a: 1 }, skips: { a: 3 } }, 'a'), true);
    assert.equal(isDisliked({ ...base, heard: { a: 5 }, skips: { a: 3 } }, 'a'), false);
    assert.equal(isDisliked({ ...base, skips: { a: 3 }, votes: { a: 1 } }, 'a'), false); // thumbs up wins
});

test('the lead-in never runs into the part before and leaves 8 s', () => {
    assert.deepEqual(applyLeadIn([60, 90], 8, 0), [52, 90]);
    assert.deepEqual(applyLeadIn([60, 90], 8, 56), [56, 90]);
    assert.deepEqual(applyLeadIn([60, 90], -30, 0), [82, 90]);
    assert.deepEqual(applyLeadIn([60, 90], null, 0), [60, 90]);
});
