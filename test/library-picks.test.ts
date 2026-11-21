import assert from 'node:assert/strict';
import { test } from 'node:test';

import { libraryPicks } from '../src/renderer/features/for-you/library-picks.ts';

const now = Date.parse('2026-11-20T12:00:00Z');
const song = (
    i: number,
    playCount: number,
    lastDaysAgo: null | number,
    genre = 'Pop',
    artist = 'A',
) => ({
    artistName: artist,
    createdAt: new Date(now - i * 86_400_000).toISOString(),
    genres: [{ name: genre }],
    id: `s${i}`,
    lastPlayedAt:
        lastDaysAgo === null ? null : new Date(now - lastDaysAgo * 86_400_000).toISOString(),
    playCount,
});

test('libraryPicks: repeat, forgotten, fresh, never played, genre and artist playlists', () => {
    const songs = [
        song(1, 9, 1),
        song(2, 5, 40),
        song(3, 3, 45),
        song(4, 2, 50, 'Rock'),
        song(5, 0, null, 'Rock'),
        song(6, 0, null, 'Rock'),
        song(7, 0, null),
    ];
    const picks = libraryPicks(songs, '2026-11-20', now);
    const byId = Object.fromEntries(picks.map((p) => [p.id, p]));
    assert.deepEqual(byId.repeat.songIds, ['s1', 's2', 's3', 's4']);
    assert.deepEqual(byId.forgotten.songIds, ['s2', 's3', 's4']);
    assert.equal(byId.fresh.songIds[0], 's1');
    assert.deepEqual([...byId.unheard.songIds].sort(), ['s5', 's6', 's7']);
    assert.ok(byId['genre:Pop'] && byId['genre:Rock']);
    assert.ok(byId['artist:A']);
    assert.deepEqual(libraryPicks(songs, '2026-11-20', now), picks); // stable within a day
});

test('libraryPicks: a tiny library still gets a shuffle', () => {
    const picks = libraryPicks([song(1, 0, null)], '2026-11-20', now);
    assert.deepEqual(
        picks.map((p) => p.id),
        ['all'],
    );
});
