import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    dueReminders,
    kindOf,
    mergeReleases,
    describe as say,
} from '../src/renderer/features/news/feed.ts';

const now = Date.parse('2026-11-20T12:00:00Z');
const day = 86_400_000;
const rel = (title: string, offsetDays: number, source: 'iTunes' | 'MusicBrainz', extra = {}) => ({
    artist: 'Arijit Singh',
    artworkUrl: null,
    date: new Date(now + offsetDays * day).toISOString(),
    source,
    title,
    trackCount: 12,
    url: `${source}:${title}`,
    ...extra,
});

test('mergeReleases: one post per release, store link preferred, newest first', () => {
    const merged = mergeReleases([
        [rel('Old Album', -40, 'iTunes'), rel('New Song - Single', -2, 'iTunes')],
        [rel('New Song', -2, 'MusicBrainz'), rel('Next Album', 15, 'MusicBrainz')],
    ]);
    assert.deepEqual(
        merged.map((r) => r.url),
        ['MusicBrainz:Next Album', 'iTunes:New Song - Single', 'iTunes:Old Album'],
    );
});

test('describe: plain words for past and announced releases', () => {
    assert.deepEqual(say(rel('New Song - Single', -2, 'iTunes'), now), {
        verb: 'dropped a new single',
        when: '2 days ago',
    });
    assert.equal(
        say(rel('Next Album', 15, 'MusicBrainz', { kind: 'Album' }), now).verb,
        'announced an album',
    );
    assert.match(say(rel('Next Album', 15, 'MusicBrainz'), now).when, /in 15 days$/);
    assert.equal(kindOf(rel('Tiny', 0, 'iTunes', { trackCount: 1 })), 'single');
});

test('dueReminders: only releases whose day has come', () => {
    const due = dueReminders(
        {
            a: { artist: 'A', date: new Date(now - day).toISOString(), title: 'Out', url: 'a' },
            b: { artist: 'B', date: new Date(now + day).toISOString(), title: 'Soon', url: 'b' },
        },
        now,
    );
    assert.deepEqual(
        due.map((r) => r.url),
        ['a'],
    );
});
