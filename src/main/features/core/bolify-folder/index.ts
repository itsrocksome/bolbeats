import type {
    FolderExport,
    FolderLayout,
    FolderList,
    HiddenCopy,
} from '/@/shared/types/bolify-folder';

// BolBeats: your music folder is the one place for everything, and it outlives the app.
// - "Bring songs in" COPIES audio files (never moves or deletes the originals) into the music folder (see bring-in.ts).
// - Playlists and best-parts playlists are written into <music folder>/BolBeats/ as .m3u8 files (best parts carry VLC
//   start/stop times, so other players play just the parts), plus bolbeats-backup.json for a reinstalled BolBeats to restore.
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';

import { AUDIO, bringIn, safe } from '/@/main/features/core/bolify-folder/bring-in';
import { readHidden, writeHidden } from '/@/main/features/core/bolify-folder/ndignore';
import { currentMusicFolder } from '/@/main/features/core/local-library';
import { readBasicTags } from '/@/main/features/core/tag-editor/taglib-service';
import log from '/@/main/logger';

import './share';

const BACKUP = 'bolbeats-backup.json';
// Earlier names of the folder and backup (the app was called Bolify); read when the new ones aren't there.
const OLD_DIR = 'Bolify';
const OLD_BACKUP = 'bolify-backup.json';

// <music folder>/BolBeats, taking over a folder an earlier version wrote under the old name.
const homeDir = async (root = currentMusicFolder()) => {
    const dir = path.join(root, 'BolBeats');
    const old = path.join(root, OLD_DIR);
    const [hasNew, hasOld] = await Promise.all([
        stat(dir).then(
            () => true,
            () => false,
        ),
        stat(old).then(
            () => true,
            () => false,
        ),
    ]);
    if (!hasNew && hasOld) {
        await rename(old, dir).catch(() => {});
        await rename(path.join(dir, OLD_BACKUP), path.join(dir, BACKUP)).catch(() => {});
    }
    return dir;
};

const m3u = (dir: string, list: FolderList) =>
    [
        '#EXTM3U',
        `#PLAYLIST:${list.name}`,
        ...list.entries.flatMap((e) => [
            `#EXTINF:${Math.round(e.end != null && e.start != null ? e.end - e.start : e.seconds)},${e.artist} - ${e.title}`,
            ...(e.start != null && e.end != null
                ? [
                      `#EXTVLCOPT:start-time=${e.start.toFixed(2)}`,
                      `#EXTVLCOPT:stop-time=${e.end.toFixed(2)}`,
                  ]
                : []),
            path.relative(dir, e.path).split(path.sep).join('/'),
        ]),
        '',
    ].join('\n');

// Writes one .m3u8 per list and removes .m3u8 files BolBeats wrote earlier for lists that no longer exist.
const writeLists = async (dir: string, lists: FolderList[]) => {
    await mkdir(dir, { recursive: true });
    const keep = new Set<string>();
    for (const list of lists) {
        let name = `${safe(list.name)}.m3u8`;
        for (let i = 2; keep.has(name); i++) name = `${safe(list.name)} (${i}).m3u8`;
        keep.add(name);
        const file = path.join(dir, name);
        const text = m3u(dir, list);
        if ((await readFile(file, 'utf8').catch(() => '')) !== text) await writeFile(file, text);
    }
    for (const f of await readdir(dir))
        if (f.endsWith('.m3u8') && !keep.has(f)) await unlink(path.join(dir, f));
};

const README = `This folder is written by BolBeats, so your playlists and best parts live with your music.

Playlists/    one .m3u8 file per playlist. Open them in VLC, Apple Music (File > Library > Import) or most players.
Best parts/   one .m3u8 per best-parts playlist. VLC plays just the parts (each line has its start and stop time).
${BACKUP}  everything BolBeats needs to bring your best parts and playlists back after a reinstall
              (Your library > Restore from this folder).

BolBeats rewrites these files when you change playlists. Your songs are never moved or deleted by BolBeats.
`;

ipcMain.handle('bolify-bring-in', async (event, testPaths?: string[]) => {
    let sources = !app.isPackaged && testPaths?.length ? testPaths : null; // tests pass paths; people use the picker
    if (!sources) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const res = await dialog.showOpenDialog(win!, {
            buttonLabel: 'Bring in',
            message:
                'Songs are copied into your music folder and sorted by artist and album. The originals stay where they are.',
            properties: ['openFile', 'openDirectory', 'multiSelections'],
            title: 'Bring songs into your music folder',
        });
        if (res.canceled || !res.filePaths.length) return null;
        sources = res.filePaths;
    }
    const res = await bringIn(sources, currentMusicFolder(), readBasicTags, (done, name) =>
        event.sender.send('bolify-bring-in-progress', { done, name }),
    );
    if (res.failed.length) log.warn('[bolify-folder] could not copy', { failed: res.failed });
    return res;
});

ipcMain.handle('bolify-export', async (_e, data: FolderExport) => {
    const base = await homeDir();
    await writeLists(path.join(base, 'Playlists'), data.playlists);
    await writeLists(path.join(base, 'Best parts'), data.bestParts);
    await writeFile(path.join(base, BACKUP), data.backup);
    await writeFile(path.join(base, 'README.txt'), README);
    return base;
});

// Reads <folder>/BolBeats/bolbeats-backup.json (the current music folder by default), or the backup an earlier version
// left under the old names. Only those file names are read.
ipcMain.handle('bolify-read-backup', async (_e, folder?: string) => {
    const root = folder || currentMusicFolder();
    for (const f of [
        path.join(root, 'BolBeats', BACKUP),
        path.join(root, OLD_DIR, OLD_BACKUP),
        path.join(root, 'BolBeats', OLD_BACKUP),
    ]) {
        const text = await readFile(f, 'utf8').catch(() => null);
        if (text) return text;
    }
    return null;
});

ipcMain.handle('bolify-open-folder', async () => shell.openPath(await homeDir()));

// BolBeats: folders as playlists. Each folder at the top of the music folder (not BolBeats' own) with the songs directly
// inside, in file-name order ("2." before "10."), plus the second copies BolBeats hides.
const exists = (p: string) =>
    stat(p).then(
        () => true,
        () => false,
    );
ipcMain.handle('bolify-folder-layout', async (): Promise<FolderLayout> => {
    const root = currentMusicFolder();
    const folders: FolderLayout['folders'] = [];
    for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (
            !d.isDirectory() ||
            d.name.startsWith('.') ||
            d.name === 'BolBeats' ||
            d.name === OLD_DIR
        )
            continue;
        const files = (
            await readdir(path.join(root, d.name), { withFileTypes: true }).catch(() => [])
        )
            .filter((f) => f.isFile() && !f.name.startsWith('.') && AUDIO.test(f.name))
            .map((f) => f.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map((n) => path.join(root, d.name, n));
        if (files.length) folders.push({ files, name: d.name });
    }
    const text = await readFile(path.join(root, '.ndignore'), 'utf8').catch(() => '');
    const hidden: FolderLayout['hidden'] = [];
    for (const h of readHidden(text))
        hidden.push({
            ...h,
            gone:
                !(await exists(path.join(root, h.hide))) ||
                !(await exists(path.join(root, h.same))),
        });
    return { folders, hidden, root };
});

// Rewrites BolBeats' block of <music folder>/.ndignore; returns the copies actually hidden.
ipcMain.handle('bolify-hide-copies', async (_e, hidden: HiddenCopy[]) => {
    const file = path.join(currentMusicFolder(), '.ndignore');
    const before = await readFile(file, 'utf8').catch(() => '');
    const next = writeHidden(before, hidden);
    if (next.text === null) await unlink(file).catch(() => {});
    else if (next.text !== before) await writeFile(file, next.text);
    return next.written;
});
