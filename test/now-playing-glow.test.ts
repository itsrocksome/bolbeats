import assert from 'node:assert/strict';
import { test } from 'node:test';

import { lift } from '../src/renderer/features/now-playing-glow/lift.ts';

test('lift: dark covers get a visible glow, bright ones keep their hue, greys fall back', () => {
    assert.equal(lift('rgb(42,27,52)'), 'hsl(276 45% 42%)');
    assert.equal(lift('rgb(255,0,0)'), 'hsl(0 100% 50%)');
    assert.equal(lift('rgb(10,10,10)'), null);
    assert.equal(lift('nonsense'), null);
});
