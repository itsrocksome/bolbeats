import assert from 'node:assert/strict';
import { test } from 'node:test';

import { songFinder } from '../src/renderer/features/bolify-folder/relink.ts';

const lib = [
    {
        artistName: 'Tove Lo',
        duration: 161_310,
        id: 'new1',
        name: 'Blood In Your Eyes',
        path: '/New/Tove Lo/Single/Blood In Your Eyes.mp3',
    },
    {
        artistName: 'Justice',
        duration: 225_020,
        id: 'new2',
        name: 'Pusher',
        path: '/New/Pusher.mp3',
    },
    {
        artistName: 'Justice',
        duration: 400_000,
        id: 'new3',
        name: 'Pusher',
        path: '/New/Pusher (Extended).mp3',
    },
];

test('songFinder: path, moved folder, then title + artist + length', () => {
    const find = songFinder(lib, '/New');
    assert.equal(
        find({ artist: 'x', path: '/New/Pusher.mp3', seconds: 0, title: 'x' })?.id,
        'new2',
    );
    assert.equal(
        find({ artist: 'x', path: '/Old/Pusher.mp3', seconds: 0, title: 'x' }, '/Old')?.id,
        'new2',
    );
    assert.equal(
        find({ artist: 'tove lo', path: '/Gone/a.mp3', seconds: 161, title: 'Blood in your eyes!' })
            ?.id,
        'new1',
    );
    assert.equal(find({ artist: 'Justice', path: '', seconds: 401, title: 'Pusher' })?.id, 'new3');
    assert.equal(find({ artist: 'Justice', path: '', seconds: 300, title: 'Pusher' }), undefined); // too different
});
