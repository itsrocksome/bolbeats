import type { LocalLibraryInfo } from '/@/shared/types/local-library';

// BolBeats: runs the bundled Navidrome as a private, localhost-only library for this Mac.
// It starts with the app, stops when the app quits, and never talks to the internet.
import { type ChildProcess, execFileSync, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { store } from '/@/main/features/core/settings';
import log from '/@/main/logger';

const USERNAME = 'admin';
// Next to the settings file, so dev and packaged builds (and their passwords) never share a library.
const dataDir = path.join(path.dirname(store.path), 'local-library');
const pidFile = path.join(dataDir, 'navidrome.pid');
// BolBeats: downloaded songs often list artists as "Karan Aujla/Ikky"; split on a bare "/" too, so each artist is one
// artist with all their songs (names that contain a slash stay whole). Changing these needs one full rescan.
const TAGS = [
    'Tags.Artist.Split = [" / ", "/", " feat. ", " feat ", " ft. ", " ft ", "; "]',
    'Tags.AlbumArtist.Split = [" / ", "/", " feat. ", " feat ", " ft. ", " ft ", "; "]',
    'Scanner.ArtistSplitExceptions = "AC/DC"',
];
const binary = app.isPackaged
    ? path.join(process.resourcesPath, 'navidrome', 'navidrome')
    : path.join(app.getAppPath(), 'resources', 'navidrome', 'navidrome');

let child: ChildProcess | null = null;
let starting: null | Promise<LocalLibraryInfo> = null;

export const currentMusicFolder = () =>
    (store.get('localLibrary.folder') as string) || defaultFolder();

const defaultFolder = () => {
    const mine = path.join(os.homedir(), 'Music', 'my_music');
    return existsSync(mine) ? mine : path.join(os.homedir(), 'Music');
};

const freePort = (port: number): Promise<number> =>
    new Promise((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(freePort(port + 1)));
        s.listen(port, '127.0.0.1', () => s.close(() => resolve(port)));
    });

// A previous run that crashed can leave Navidrome behind; stop it only if that pid really is Navidrome.
const killStale = () => {
    try {
        const pid = Number(readFileSync(pidFile, 'utf8'));
        const name = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
        if (name.includes('navidrome')) process.kill(pid);
    } catch {
        // no pid file, or the process is gone
    }
};

const waitUntilUp = async (url: string) => {
    for (let i = 0; i < 100; i++) {
        try {
            await fetch(`${url}/ping`);
            return;
        } catch {
            await new Promise((r) => setTimeout(r, 150));
        }
    }
    throw new Error('The local music library did not start in time.');
};

const start = async (): Promise<LocalLibraryInfo> => {
    mkdirSync(dataDir, { recursive: true });
    killStale();
    const folder = (store.get('localLibrary.folder') as string) || defaultFolder();
    let password = store.get('localLibrary.password') as string;
    if (!password) {
        password = randomBytes(18).toString('hex');
        store.set('localLibrary.password', password);
    }
    const port = await freePort(45330);
    const config = path.join(dataDir, 'navidrome.toml');
    writeFileSync(
        config,
        [
            'Address = "127.0.0.1"',
            `Port = ${port}`,
            `MusicFolder = ${JSON.stringify(folder)}`,
            `DataFolder = ${JSON.stringify(dataDir)}`,
            'EnableExternalServices = false',
            'EnableInsightsCollector = false',
            'LogLevel = "error"',
            // BolBeats writes playlist files into <music folder>/BolBeats/; they're a copy, not new playlists.
            'AutoImportPlaylists = false',
            'SessionTimeout = "8760h"',
            ...TAGS,
        ].join('\n'),
    );
    const proc = spawn(binary, ['--nobanner', '--configfile', config], {
        // Only used when the database has no users yet (first run).
        env: { ...process.env, ND_DEVAUTOCREATEADMINPASSWORD: password },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = proc;
    proc.stderr?.on('data', (d) => log.warn('[local-library]', String(d).trim()));
    proc.on('exit', (code) => {
        log.info('[local-library] stopped', { code });
        // An old library stopping (after a folder change) must not forget the new one.
        if (child === proc) {
            child = null;
            starting = null;
        }
    });
    writeFileSync(pidFile, String(proc.pid));
    const url = `http://127.0.0.1:${port}`;
    await waitUntilUp(url);
    log.info('[local-library] ready', { folder, url });
    const fullScan = store.get('localLibrary.tags') !== TAGS.join('\n');
    store.set('localLibrary.tags', TAGS.join('\n'));
    return { folder, fullScan, password, url, username: USERNAME };
};

const stop = () => {
    child?.kill();
    child = null;
    starting = null;
};

// Waits for the old library to exit so the new one can open the same database.
const stopAndWait = () =>
    new Promise<void>((resolve) => {
        const old = child;
        stop();
        if (!old || old.exitCode !== null) return resolve();
        old.once('exit', () => resolve());
        setTimeout(resolve, 3000);
    });

// A failed start is forgotten so the next request tries again.
const startOnce = () => {
    starting ??= start().catch((err) => {
        starting = null;
        throw err;
    });
    return starting;
};

ipcMain.handle('local-library-start', startOnce);

ipcMain.handle('local-library-choose-folder', async (event, testPath?: string) => {
    let folder = !app.isPackaged && testPath ? testPath : ''; // tests pass a path; people use the picker
    if (!folder) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const res = await dialog.showOpenDialog(win!, {
            defaultPath: (store.get('localLibrary.folder') as string) || defaultFolder(),
            properties: ['openDirectory'],
            title: 'Choose your music folder',
        });
        if (res.canceled || !res.filePaths[0]) return null;
        folder = res.filePaths[0];
    }
    store.set('localLibrary.folder', folder);
    await stopAndWait();
    return startOnce();
});

app.on('will-quit', stop);
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(sig, () => (stop(), app.quit()));
