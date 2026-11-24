// Starter songs: copied without overwriting your files, removed for good (space back), your files never touched.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
    addStarter,
    removeStarter,
    starterStatus,
} from '../src/main/features/core/local-library/starter.ts';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'bolbeats-starter-'));
after(() => rmSync(tmp, { force: true, recursive: true }));

const bundled = path.join(tmp, 'bundled');
const music = path.join(tmp, 'music');
const put = (p: string, bytes: number) => {
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, Buffer.alloc(bytes, 1));
};
put(path.join(bundled, 'Starter - A', '01 One.mp3'), 1000);
put(path.join(bundled, 'Starter - A', 'CREDITS.txt'), 10);
put(path.join(bundled, 'Starter - B', '01 Two.mp3'), 2000);
put(path.join(bundled, '.DS_Store'), 5);
put(path.join(music, 'Starter - B', '01 Two.mp3'), 7); // a file of yours with the same name
put(path.join(music, 'Starter - B', 'mine.mp3'), 9);

test('adds the starter songs without overwriting a file that is there', async () => {
    const known = await addStarter(bundled, music);
    assert.deepEqual(known.sort(), [
        path.join('Starter - A', '01 One.mp3'),
        path.join('Starter - A', 'CREDITS.txt'),
    ]);
    assert.equal(readdirSync(path.join(music, 'Starter - B')).length, 2);
    const s = await starterStatus(music, known);
    assert.deepEqual(s, { bytes: 1010, count: 2, folders: ['Starter - A'], songs: 1 });
    // adding again keeps what it knew and copies nothing twice
    assert.deepEqual((await addStarter(bundled, music, known)).sort(), known.sort());
});

test('removes only what it copied, then the empty folder; outside paths are ignored', async () => {
    const known = [path.join('Starter - A', '01 One.mp3'), path.join('Starter - A', 'CREDITS.txt')];
    put(path.join(music, 'Starter - A', '.DS_Store'), 3);
    const freed = await removeStarter(music, [
        ...known,
        path.join('..', 'bundled', 'Starter - B', '01 Two.mp3'),
    ]);
    assert.equal(freed, 1010);
    assert.equal(existsSync(path.join(music, 'Starter - A')), false);
    assert.equal(existsSync(path.join(bundled, 'Starter - B', '01 Two.mp3')), true);
    assert.equal(readdirSync(path.join(music, 'Starter - B')).length, 2);
    assert.deepEqual(await starterStatus(music, known), {
        bytes: 0,
        count: 0,
        folders: ['Starter - A'],
        songs: 0,
    });
});
