// Cutting a best part out of an MP3: real files made with ffmpeg (CBR with an Info frame, VBR with a Xing frame,
// no header frame at all), each cut decoded by ffmpeg and compared sample by sample with the full decode.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { cutMp3, indexMp3 } from '../src/renderer/features/best-parts/mp3-cut.ts';

let haveFfmpeg = true;
try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
    haveFfmpeg = false;
}

const dir = mkdtempSync(path.join(os.tmpdir(), 'mp3cut-'));
after(() => rmSync(dir, { force: true, recursive: true }));

const make = (name: string, args: string[]) => {
    const f = path.join(dir, name);
    // a rising chirp, so a cut that is off by any number of samples can't line up by accident
    execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'aevalsrc=0.4*sin(2*PI*(150*t+30*t*t))|0.3*sin(2*PI*(220*t+25*t*t)):s=44100:d=30',
        '-metadata',
        'title=Chirp',
        ...args,
        f,
    ]);
    return f;
};
const pcm = (file: string) => {
    const b = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', file, '-map', '0:a', '-ac', '1', '-f', 'f32le', '-'],
        { maxBuffer: 1 << 28 },
    );
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
const packets = (file: string) =>
    Number(
        execFileSync('ffprobe', [
            '-v',
            'error',
            '-select_streams',
            'a',
            '-count_packets',
            '-show_entries',
            'stream=nb_read_packets',
            '-of',
            'csv=p=0',
            file,
        ])
            .toString()
            .trim(),
    );

const kinds: [string, string[]][] = [
    ['cbr-info.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
    ['vbr-xing.mp3', ['-c:a', 'libmp3lame', '-q:a', '4']],
    ['cbr-plain.mp3', ['-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '0']],
];

for (const [name, args] of kinds) {
    test(
        `mp3 cut lines up with the full decode: ${name}`,
        { skip: !haveFfmpeg && 'needs ffmpeg' },
        () => {
            const file = make(name, args);
            const bytes = new Uint8Array(readFileSync(file));
            const ix = indexMp3(bytes);
            assert.ok(ix, 'indexed');
            assert.equal(ix.rate, 44100);
            assert.equal(ix.frames.length - 1, packets(file), 'same audio frames as ffprobe');
            const full = pcm(file);
            for (const start of [0.2, 7.31, 19.9]) {
                const cut = cutMp3(bytes, ix, start, start + 6);
                const cf = path.join(dir, `cut-${start}-${name}`);
                writeFileSync(cf, cut.bytes);
                const part = pcm(cf);
                const a = Math.round(start * ix.rate);
                const c = Math.round((start - cut.offset) * ix.rate);
                let worst = 0;
                for (let i = 0; i < 6 * ix.rate; i++)
                    worst = Math.max(worst, Math.abs(full[a + i] - part[c + i]));
                assert.ok(worst < 1e-3, `${name} at ${start}s: worst difference ${worst}`);
            }
        },
    );
}

test('mp3 index says no to files it cannot cut', () => {
    const wav = new Uint8Array(4096);
    wav.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    assert.equal(indexMp3(wav), null);
    assert.equal(indexMp3(new Uint8Array(0)), null);
});
