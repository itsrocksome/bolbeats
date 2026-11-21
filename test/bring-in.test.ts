// Bring songs in, end to end: real audio files made with ffmpeg, real tags read with TagLib, real copies on disk.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { TagLib } from 'taglib-wasm';

import { audioFiles, bringIn, safe } from '../src/main/features/core/bolify-folder/bring-in.ts';

const hasFfmpeg = (() => {
    try {
        execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

let tmp = '';
let src = '';
let root = '';
let taglib: TagLib;

const readTags = async (file: string) => {
    const f = await taglib.open(file);
    try {
        const t = f.tag();
        return {
            album: t.album,
            albumArtist: f.getProperty('albumArtist') ?? undefined,
            artist: t.artist,
            title: t.title,
            track: t.track,
        };
    } finally {
        f.dispose();
    }
};

// One second of tone, tagged. seconds/freq make two files with the same tags differ in size.
const song = (rel: string, tags: Record<string, string> = {}, seconds = 1, freq = 440) => {
    const out = path.join(src, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    const meta = Object.entries(tags).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);
    const codec = /\.m4a$/.test(out)
        ? ['-c:a', 'aac']
        : /\.opus$/.test(out)
          ? ['-c:a', 'libopus']
          : /\.ogg$/.test(out)
            ? ['-c:a', 'vorbis', '-strict', '-2', '-ac', '2']
            : [];
    execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${freq}:duration=${seconds}`,
        ...codec,
        ...meta,
        out,
    ]);
    return out;
};

const all = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
            ? all(path.join(dir, e.name))
            : [path.relative(root, path.join(dir, e.name))],
    );

before(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'bolify-bring-in-'));
    src = path.join(tmp, 'Downloads');
    root = path.join(tmp, 'Music');
    mkdirSync(root);
    taglib = await TagLib.initialize();
});

after(() => {
    if (!tmp) return;
    try {
        chmodSync(path.join(src, 'locked.mp3'), 0o644);
    } catch {
        // not created
    }
    rmSync(tmp, { force: true, recursive: true });
});

test('safe(): file names that work on macOS and Windows', () => {
    assert.equal(safe('AC/DC: Back?'), 'AC-DC- Back-');
    assert.equal(safe('..hidden. '), 'hidden');
    assert.equal(safe('   '), 'Untitled');
    assert.equal(safe('तुम ही हो'), 'तुम ही हो');
    const long = safe('😀'.repeat(200));
    assert.equal(Array.from(long).length, 120);
    assert.ok(!/[\uD800-\uDFFF]/.test(long.replace(/😀/g, '')), 'no half emoji at the cut');
});

test(
    'bring songs in: formats, scripts, duplicates, junk, originals untouched',
    { skip: !hasFfmpeg && 'ffmpeg not installed' },
    async () => {
        const tagged = song('album/03 pusher.mp3', {
            album: 'Pusher - Single',
            album_artist: 'Justice',
            artist: 'Justice & Gesaffelstein',
            title: 'Pusher',
            track: '3',
        });
        song('more/Blood.m4a', { album: 'GTA VI', artist: 'Tove Lo', title: 'Blood In Your Eyes' });
        song('more/flac/rhyno.flac', {
            album: 'GTA VI',
            artist: 'Travis Scott',
            title: 'RHYNO',
            track: '12',
        });
        song('more/plain.WAV'); // no tags, upper-case extension
        song('more/vorbis.ogg', { artist: 'Fuerza Regida', title: 'Suzuki' });
        song('more/opus.opus', { artist: 'CA7RIEL & Paco Amoroso', title: 'Sexy Magic' });
        song('hindi/a.mp3', { album: 'आशिकी 2', artist: 'अरिजीत सिंह', title: 'तुम ही हो' });
        song('punjabi/b.mp3', { album: 'ਗੀਤ', artist: 'ਦਿਲਜੀਤ ਦੋਸਾਂਝ', title: 'ਲਵਰ' });
        song('tamil/c.mp3', { artist: 'அனிருத்', title: 'வாத்தி கம்மிங்' });
        song('emoji.mp3', { artist: 'Artist 🎧', title: 'Night drive 🌙' });
        song('bad name.mp3', { artist: 'AC/DC', title: 'Back: In Black?' });
        song('deep/1/2/3/4/5/deep.mp3', { artist: 'Deep', title: 'Very nested' });
        // same tags, different recording: kept as "(2)"
        song('v1/song.mp3', { album: 'Same', artist: 'Same', title: 'Same name' }, 1, 440);
        song('v2/song.mp3', { album: 'Same', artist: 'Same', title: 'Same name' }, 2, 660);
        // the very same file twice: copied once
        song('copy-a/twice.mp3', { album: 'Twice', artist: 'Twice', title: 'Twice' });
        song('copy-b/twice.mp3', { album: 'Twice', artist: 'Twice', title: 'Twice' });
        // junk that must be ignored
        writeFileSync(path.join(src, '.DS_Store'), 'x');
        writeFileSync(path.join(src, 'album', '._03 pusher.mp3'), 'apple double');
        writeFileSync(path.join(src, 'album', 'cover.jpg'), 'jpg');
        writeFileSync(path.join(src, 'album', 'notes.txt'), 'txt');
        symlinkSync(tagged, path.join(src, 'link.mp3'));
        // a file that is not really audio: copied under Unknown, never crashes the run
        writeFileSync(path.join(src, 'broken.mp3'), 'not audio at all');
        // a file we can't read: reported, the rest still copied
        const locked = song('locked.mp3', { title: 'Locked' });
        chmodSync(locked, 0o000);
        const before = statSync(tagged);

        const steps: string[] = [];
        const res = await bringIn([src], root, readTags, (_n, name) => steps.push(name));
        const files = all(root).sort();

        assert.ok(
            files.includes(path.join('Justice', 'Pusher - Single', '03 Pusher.mp3')),
            'album artist folder, padded track number',
        );
        assert.ok(files.includes(path.join('Tove Lo', 'GTA VI', 'Blood In Your Eyes.m4a')));
        assert.ok(files.includes(path.join('Travis Scott', 'GTA VI', '12 RHYNO.flac')));
        assert.ok(
            files.includes(path.join('Unknown artist', 'Unknown album', 'plain.wav')),
            'untagged keeps its file name, lower-case extension',
        );
        assert.ok(files.includes(path.join('Fuerza Regida', 'Unknown album', 'Suzuki.ogg')));
        assert.ok(
            files.includes(path.join('CA7RIEL & Paco Amoroso', 'Unknown album', 'Sexy Magic.opus')),
        );
        assert.ok(
            files.includes(path.join('अरिजीत सिंह', 'आशिकी 2', 'तुम ही हो.mp3')),
            'Devanagari',
        );
        assert.ok(files.includes(path.join('ਦਿਲਜੀਤ ਦੋਸਾਂਝ', 'ਗੀਤ', 'ਲਵਰ.mp3')), 'Gurmukhi');
        assert.ok(
            files.includes(path.join('அனிருத்', 'Unknown album', 'வாத்தி கம்மிங்.mp3')),
            'Tamil',
        );
        assert.ok(
            files.includes(path.join('Artist 🎧', 'Unknown album', 'Night drive 🌙.mp3')),
            'emoji',
        );
        assert.ok(
            files.includes(path.join('AC-DC', 'Unknown album', 'Back- In Black-.mp3')),
            'unsafe characters replaced',
        );
        assert.ok(
            files.includes(path.join('Deep', 'Unknown album', 'Very nested.mp3')),
            'deep folders',
        );
        assert.ok(
            files.includes(path.join('Same', 'Same', 'Same name.mp3')) &&
                files.includes(path.join('Same', 'Same', 'Same name (2).mp3')),
            'same name, different song',
        );
        assert.equal(
            files.filter((f) => f.includes('Twice')).length,
            1,
            'identical file copied once',
        );
        assert.ok(
            files.includes(path.join('Unknown artist', 'Unknown album', 'broken.mp3')),
            'unreadable tags fall back to the file name',
        );
        assert.ok(
            !files.some((f) => /cover\.jpg|notes\.txt|DS_Store|\._/.test(f)),
            'non-audio and hidden files ignored',
        );
        assert.ok(!steps.includes('link.mp3'), 'symlinks inside a folder are skipped');
        assert.deepEqual(res.failed, ['locked.mp3']);
        assert.equal(res.copied, files.length);
        assert.equal(res.skipped, 1); // the second "twice"

        // originals are never moved or changed
        assert.ok(existsSync(tagged));
        assert.equal(statSync(tagged).size, before.size);
        assert.equal(statSync(tagged).mtimeMs, before.mtimeMs);

        // a second run copies nothing
        const again = await bringIn([src], root, readTags);
        assert.equal(again.copied, 0);
        assert.equal(again.skipped, res.copied + 1);

        // files already in the music folder are left alone
        const inFolder = await bringIn([root], root, readTags);
        assert.equal(inFolder.copied, 0);
        assert.equal(inFolder.skipped, files.length);
    },
);

test(
    'bring songs in: empty folder, missing path, single file',
    { skip: !hasFfmpeg && 'ffmpeg not installed' },
    async () => {
        const empty = path.join(tmp, 'empty');
        mkdirSync(empty);
        assert.deepEqual(await bringIn([empty], root, readTags), {
            copied: 0,
            failed: [],
            skipped: 0,
        });
        assert.deepEqual((await bringIn([path.join(tmp, 'gone')], root, readTags)).failed, [
            'gone',
        ]);
        const one = song('single/one.mp3', { artist: 'Solo', title: 'Just one' });
        assert.equal((await bringIn([one], root, readTags)).copied, 1);
        const listed: string[] = [];
        for await (const f of audioFiles(path.join(src, 'single'))) listed.push(path.basename(f));
        assert.deepEqual(listed, ['one.mp3']);
    },
);
