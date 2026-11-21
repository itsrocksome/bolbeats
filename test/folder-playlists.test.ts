// Folders as playlists and songs saved twice: the planning rules and BolBeats' block in .ndignore.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    ignoreLine,
    readHidden,
    writeHidden,
} from '../src/main/features/core/bolify-folder/ndignore.ts';
import {
    findDuplicates,
    isAlbumFolder,
    planFolderPlaylists,
    type PlanSong,
} from '../src/renderer/features/bolify-folder/folder-playlists-plan.ts';

const R = '/Music/my_music';
const song = (
    id: string,
    rel: string,
    name: string,
    artistName: string,
    duration: number,
    bitRate = 320,
    album = 'Single',
): PlanSong => ({
    album,
    artistName,
    bitRate,
    duration,
    id,
    name,
    path: `${R}/${rel}`,
});

const songs = [
    song(
        'rh1',
        'GTA6/RHYNO (from GTAVI The Album) - Travis Scott.mp3',
        'RHYNO',
        'Travis Scott',
        180000,
    ),
    song('rh2', 'move_playlist/9. RHYNO.mp3', 'RHYNO', 'Travis Scott', 180400),
    song(
        'bs1',
        'punjabi/3. Born to Shine.mp3',
        'Born to Shine',
        'Diljit Dosanjh',
        218000,
        256,
        'G.O.A.T.',
    ),
    song(
        'bs2',
        'move_playlist/10. Born to Shine (128k).mp3',
        'Born To Shine',
        'Diljit  Dosanjh',
        218900,
        128,
        'G.O.A.T.',
    ),
    song('ext', 'move_playlist/11. RHYNO (extended).mp3', 'RHYNO', 'Travis Scott', 260000),
    song('oth', 'move_playlist/12. RHYNO.mp3', 'RHYNO', 'Someone Else', 180000),
    song('wf', 'move_playlist/1. Wavin Flag.mp3', "Wavin' Flag", "K'NAAN", 225000),
    song(
        'mm1',
        'Making Memories/1. Softly.mp3',
        'Softly',
        'Karan Aujla',
        171000,
        320,
        'Making Memories',
    ),
    song(
        'mm2',
        'Making Memories/2. Jee Ni Lagda.mp3',
        'Jee Ni Lagda',
        'Karan Aujla',
        142000,
        320,
        'Making Memories',
    ),
];

test('a song saved twice shows once: same title and artist, lengths within 2 s', () => {
    const d = findDuplicates(songs, R);
    assert.deepEqual(d, [
        {
            hide: 'move_playlist/9. RHYNO.mp3',
            same: 'GTA6/RHYNO (from GTAVI The Album) - Travis Scott.mp3',
        },
        {
            hide: 'move_playlist/10. Born to Shine (128k).mp3',
            same: 'punjabi/3. Born to Shine.mp3',
        }, // better bitrate stays
    ]);
});

test('the copy with best parts stays, even at a lower bitrate', () => {
    const d = findDuplicates(songs, R, (s) => s.id === 'bs2');
    assert.ok(
        d.some(
            (h) =>
                h.hide === 'punjabi/3. Born to Shine.mp3' &&
                h.same === 'move_playlist/10. Born to Shine (128k).mp3',
        ),
    );
});

test('a folder holding one album stays an album; other folders are playlists', () => {
    assert.equal(isAlbumFolder('Making Memories', ['Making Memories', 'Making Memories']), true);
    assert.equal(isAlbumFolder('punjabi', ['Making Memories', 'G.O.A.T.']), false);
    assert.equal(isAlbumFolder('sleepy', ['Night Songs']), false);
    assert.equal(isAlbumFolder('Karan Aujla - Making Memories (2023)', ['Making Memories']), true);
});

test('folder playlists keep file order and point at the copy that stays', () => {
    const folders = [
        {
            files: ['1. Wavin Flag.mp3', '9. RHYNO.mp3', '10. Born to Shine (128k).mp3'].map(
                (f) => `${R}/move_playlist/${f}`,
            ),
            name: 'move_playlist',
        },
        {
            files: [
                `${R}/Making Memories/1. Softly.mp3`,
                `${R}/Making Memories/2. Jee Ni Lagda.mp3`,
            ],
            name: 'Making Memories',
        },
        { files: [`${R}/empty/gone.mp3`], name: 'empty' },
    ];
    const hidden = findDuplicates(songs, R);
    const visible = songs.filter((s) => !hidden.some((h) => s.path === `${R}/${h.hide}`));
    assert.deepEqual(planFolderPlaylists(folders, visible, hidden, R), [
        { name: 'move_playlist', songIds: ['wf', 'rh1', 'bs1'] },
    ]);
});

test('.ndignore lines match the file exactly', () => {
    assert.equal(
        ignoreLine('GTA6/Justice - Flower (ft Tame Impala) [from GTAVI] - Justice.mp3'),
        '/GTA6/Justice - Flower \\(ft Tame Impala\\) \\[from GTAVI\\] - Justice.mp3',
    );
    assert.equal(ignoreLine('a/Song $ + {1} ^ |.mp3'), '/a/Song \\$ \\+ \\{1\\} \\^ \\|.mp3');
    assert.equal(ignoreLine('a/what?.mp3'), '/a/what?.mp3'); // Navidrome escapes "." and "?" itself
    assert.equal(ignoreLine('a/star*.mp3'), null); // can't be matched exactly: left visible
    assert.equal(ignoreLine('a/trailing .mp3 '), null);
});

test('BolBeats only touches its own block and never leaves an .ndignore that hides everything', () => {
    const h = [{ hide: 'move_playlist/9. RHYNO.mp3', same: 'GTA6/RHYNO.mp3' }];
    const mine = 'Podcasts/\n# my note\n';
    const a = writeHidden(mine, h);
    assert.ok(a.text!.startsWith('Podcasts/\n# my note\n\n# >>> BolBeats'));
    assert.deepEqual(readHidden(a.text!), h);
    assert.ok(a.text!.includes('\n/move_playlist/9. RHYNO.mp3\n'));
    // emptied: the user's lines stay
    assert.equal(writeHidden(a.text!, []).text, 'Podcasts/\n# my note\n');
    // a file that was only BolBeats' is deleted rather than left without patterns
    assert.equal(writeHidden(writeHidden('', h).text!, []).text, null);
    assert.equal(writeHidden('# just a note\n' + writeHidden('', h).text!, []).text, null);
    // nothing to hide and never touched: left exactly as it was
    assert.equal(writeHidden('', []).text, '');
    assert.equal(writeHidden('Old/\n', []).text, 'Old/\n');
    // rewriting is stable
    assert.equal(writeHidden(a.text!, h).text, a.text);
});
