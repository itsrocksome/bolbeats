import assert from 'node:assert/strict';
import test from 'node:test';

import {
    guessFromName,
    isSure,
    matchScore,
    parsePlaylistText,
    similarity,
} from '../src/renderer/features/library-tools/match.ts';

test('reads song names out of messy file names', () => {
    const a = guessFromName('Blood In Your Eyes (from GTAVI The Album) - Tove Lo.mp3');
    assert.deepEqual(a.parts, ['Blood In Your Eyes', 'Tove Lo']);
    assert.equal(a.album, 'GTAVI The Album');
    const b = guessFromName('Justice - Pusher (feat. Gesaffelstein) [from GTAVI] - Justice.mp3');
    assert.deepEqual(b.parts, ['Pusher (feat. Gesaffelstein)', 'Justice']);
    assert.equal(b.term, 'Pusher Justice');
});

test('scores the right lookup result highest, in either name order', () => {
    const { parts } = guessFromName('RHYNO (from GTAVI The Album) - Travis Scott.mp3');
    const good = matchScore(
        parts,
        { artist: 'Travis Scott', durationSec: 180, title: 'RHYNO' },
        180,
    );
    const bad = matchScore(
        parts,
        { artist: 'Rhyno Band', durationSec: 240, title: 'Something Else' },
        180,
    );
    assert.ok(good > 0.9 && bad < 0.4, `${good} ${bad}`);
    assert.ok(
        matchScore(['Travis Scott', 'RHYNO'], { artist: 'Travis Scott', title: 'RHYNO' }) > 0.9,
    );
    assert.ok(similarity('Tum Hi Ho (From "Aashiqui 2")', 'Tum Hi Ho') === 1);
    // karaoke version by another artist must lose to the real one
    const p = guessFromName('Suzuki (from GTAVI The Album) - Fuerza Regida.mp3').parts;
    const karaoke = matchScore(p, {
        artist: 'Backing Business',
        title: 'Suzuki (Karaoke Version Originally Performed by Fuerza Regida)',
    });
    const real = matchScore(p, { artist: 'Fuerza Regida', title: 'Suzuki' });
    assert.ok(karaoke < 0.4 && real > 0.9, `${karaoke} ${real}`);
});

test('parses Apple Music, Exportify and plain playlist exports', () => {
    assert.deepEqual(
        parsePlaylistText(
            'Name\tArtist\tComposer\tAlbum\nKesariya\tArijit Singh\tPritam\tBrahmastra',
        ),
        [{ artist: 'Arijit Singh', title: 'Kesariya' }],
    );
    assert.deepEqual(
        parsePlaylistText(
            '"Track URI","Track Name","Artist Name(s)"\n"x","Pasoori","Ali Sethi, Shae Gill"',
        ),
        [{ artist: 'Ali Sethi', title: 'Pasoori' }],
    );
    assert.deepEqual(
        parsePlaylistText(
            '#EXTM3U\n#EXTINF:210,AP Dhillon - Excuses\n/music/excuses.mp3\n1. Tove Lo - Habits',
        ),
        [
            { artist: 'AP Dhillon', title: 'Excuses' },
            { artist: 'Tove Lo', title: 'Habits' },
        ],
    );
});

test('isSure: writes on its own only for a clear match', () => {
    const c = (title: string, artist: string, score: number) => ({ artist, score, title });
    assert.equal(
        isSure([c('Suzuki', 'Fuerza Regida', 0.99), c('EXCESOS', 'Fuerza Regida', 0.34)]),
        true,
    );
    assert.equal(
        isSure([c('Suzuki', 'Fuerza Regida', 0.99), c('Suzuki', 'Fuerza Regida', 0.97)]),
        true,
    ); // single + album take
    assert.equal(isSure([c('Song', 'A', 0.9), c('Song (Live)', 'B', 0.86)]), false); // a different song too close
    assert.equal(isSure([c('Song', 'A', 0.7)]), false); // not strong enough
    assert.equal(isSure([]), false);
});
