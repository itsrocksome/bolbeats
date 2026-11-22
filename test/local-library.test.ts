import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ignoreLine } from '../src/main/features/core/bolify-folder/ndignore.ts';
import {
    buildLibrary,
    emptyState,
    filterSongs,
    ignoreMatcher,
    ndAlbum,
    ndArtist,
    ndPlaylist,
    ndSong,
    page,
    scrobble,
    songSorts,
    splitArtists,
    ssSong,
    trackFromTags,
} from '../src/main/features/core/local-library/model.ts';

const file = (rel: string, size = 1000) => ({
    birth: 1_700_000_000_000,
    mtime: 1_700_000_000_000,
    rel,
    size,
});
const audio = { bitrate: 128, channels: 2, codec: 'MP3', durationMs: 221_701, sampleRate: 44100 };

const add = (
    state: ReturnType<typeof emptyState>,
    id: string,
    rel: string,
    tags: Record<string, string[]>,
) => {
    state.tracks[id] = {
        ...trackFromTags(file(rel), tags, audio, true),
        createdAt: '2026-11-21T00:00:00.000Z',
        id,
    };
    state.ids.song[rel] = id;
};

const sample = () => {
    const state = emptyState();
    add(state, 's1', 'punjabi/12. 52 Bars.mp3', {
        album: ['Four You'],
        artist: ['Karan Aujla/Ikky'],
        date: ['2023'],
        title: ['52 Bars'],
    });
    add(state, 's2', 'punjabi/Softly.mp3', {
        album: ['Four You'],
        artist: ['Karan Aujla'],
        date: ['2023'],
        title: ['Softly'],
        tracknumber: ['2/12'],
    });
    add(state, 's3', 'Fun/Hall of Fame.mp3', {
        album: ['#3 Deluxe Version'],
        albumartist: ['The Script'],
        artist: ['The Script feat. will.i.am'],
        genre: ['Pop;Rock'],
        title: ['Hall of Fame'],
    });
    return state;
};

test('artists split the way the library always did, and AC/DC stays one band', () => {
    assert.deepEqual(splitArtists(['Karan Aujla/Ikky']), ['Karan Aujla', 'Ikky']);
    assert.deepEqual(splitArtists(['The Script feat. will.i.am']), ['The Script', 'will.i.am']);
    assert.deepEqual(splitArtists(['AC/DC']), ['AC/DC']);
    assert.deepEqual(splitArtists(['A; B', 'b']), ['A', 'B']);
});

test('.ndignore hides exactly the copies BolBeats wrote, special characters and all', () => {
    const rel = 'Fun/Dil Dooba (From "Khakee") [Remix].mp3';
    const text = ['# >>> BolBeats', ignoreLine(rel)!, '# <<< BolBeats', '*.wav'].join('\n');
    const ignored = ignoreMatcher([{ dir: '', text }]);
    assert.equal(ignored(rel), true);
    assert.equal(ignored('punjabi/Dil Dooba (From "Khakee") [Remix].mp3'), false); // the copy that stays
    assert.equal(ignored('Sleepy/rain.wav'), true);
    assert.equal(ignoreMatcher([{ dir: 'Old', text: '' }])('Old/song.mp3'), true); // empty file hides its folder
});

test('tags become a song shaped like the old library had it', () => {
    const state = sample();
    const lib = buildLibrary(state, '/Music');
    const s1 = ndSong(lib, state, state.tracks.s1);
    assert.equal(s1.artist, 'Karan Aujla • Ikky');
    assert.equal(s1.albumArtist, 'Karan Aujla');
    assert.equal(s1.duration, 221.7);
    assert.equal(s1.year, 2023);
    assert.equal(s1.path, 'punjabi/12. 52 Bars.mp3');
    assert.deepEqual(
        s1.participants.artist.map((p) => p.name),
        ['Karan Aujla', 'Ikky'],
    );
    assert.equal(lib.albums.size, 2); // both Four You songs are one album
    const fame = ndSong(lib, state, state.tracks.s3);
    assert.equal(fame.orderAlbumArtistName, 'script');
    assert.deepEqual(
        fame.genres?.map((g) => g.name),
        ['Pop', 'Rock'],
    );
    assert.equal(state.tracks.s2.track, 2);
});

test('albums, artists and playlists are complete; gone songs do not count', () => {
    const state = sample();
    const lib = buildLibrary(state, '/Music');
    state.playlists.p1 = {
        comment: '',
        createdAt: '2026-11-21T00:00:00.000Z',
        id: 'p1',
        name: 'GTA6',
        public: false,
        rules: null,
        sync: false,
        tracks: ['s1', 'gone', 's3'],
        updatedAt: '2026-11-21T00:00:00.000Z',
    };
    const four = ndAlbum(lib, state, lib.albumOf.get('s1')!);
    assert.equal(four.songCount, 2);
    assert.equal(four.albumArtist, 'Karan Aujla');
    assert.equal(four.maxYear, 2023);
    const ikky = ndArtist(state, lib.artistByName.get('ikky')!);
    assert.deepEqual([ikky.albumCount, ikky.songCount], [1, 1]);
    assert.equal(lib.artistByName.get('the script')!.stats.albumartist.songCount, 1);
    const pl = ndPlaylist(lib, state, state.playlists.p1);
    assert.equal(pl.songCount, 2); // a song that is gone is not counted
    assert.equal(ssSong(lib, state, state.tracks.s1).coverArt.startsWith('mf-s1_'), true);
});

test('lists filter, sort and page like Navidrome (_start/_end, _end 0 = all)', () => {
    const state = sample();
    const lib = buildLibrary(state, '/Music');
    const sorts = songSorts(lib, state);
    const byTitle = page(lib.songs, { _order: 'ASC', _sort: 'title' }, sorts, 'title');
    assert.deepEqual(
        byTitle.items.map((t) => t.title),
        ['52 Bars', 'Hall of Fame', 'Softly'],
    );
    const desc = page(
        lib.songs,
        { _end: '2', _order: 'DESC', _sort: 'title', _start: '0' },
        sorts,
        'title',
    );
    assert.deepEqual(
        desc.items.map((t) => t.title),
        ['Softly', 'Hall of Fame'],
    );
    assert.equal(desc.total, 3);
    const ikky = lib.artistByName.get('ikky')!.id;
    assert.deepEqual(
        filterSongs(lib, state, { artists_id: [ikky] }).map((t) => t.id),
        ['s1'],
    );
    assert.deepEqual(
        filterSongs(lib, state, { title: 'hall' }).map((t) => t.id),
        ['s3'],
    );
    const albumId = lib.albumOf.get('s2')!.id;
    const album = page(
        filterSongs(lib, state, { album_id: [albumId] }),
        { _end: '0', _sort: 'album' },
        sorts,
        'title',
    );
    assert.deepEqual(
        album.items.map((t) => t.id),
        ['s1', 's2'],
    ); // no track number first, then track 2
});

test('a play counts for the song, its album and its artists; ids stay put when rebuilt', () => {
    const state = sample();
    const lib = buildLibrary(state, '/Music');
    assert.equal(scrobble(lib, state, 's1', '2026-11-22T10:00:00.000Z'), true);
    const al = lib.albumOf.get('s1')!;
    assert.equal(state.ann.s1.playCount, 1);
    assert.equal(state.ann[al.id].playCount, 1);
    assert.equal(state.ann[lib.artistByName.get('ikky')!.id].playDate, '2026-11-22T10:00:00.000Z');
    assert.equal(scrobble(lib, state, 'nope'), false);
    const again = buildLibrary(state, '/Music');
    assert.equal(again.albumOf.get('s1')!.id, al.id);
    assert.equal(again.artistByName.get('ikky')!.id, lib.artistByName.get('ikky')!.id);
});

test("albums keep Navidrome's ids after the move, without two albums sharing one", () => {
    const state = sample();
    state.legacyAlbum = { s1: 'ND_ALBUM', s2: 'ND_ALBUM', s3: 'ND_ALBUM' };
    const lib = buildLibrary(state, '/Music');
    assert.equal(lib.albumOf.get('s1')!.id, 'ND_ALBUM');
    assert.notEqual(lib.albumOf.get('s3')!.id, 'ND_ALBUM');
});
