import type { LocalLibraryInfo } from '/@/shared/types/local-library';

// BolBeats: the private, on-device music library, built into the app (it used to be a bundled Navidrome server).
// It reads the music folder, keeps its index next to the settings file, serves the app on 127.0.0.1 only, and
// never talks to the internet. The first launch after the switch moves everything over from Navidrome's database.
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import {
    existsSync,
    type FSWatcher,
    mkdirSync,
    readFileSync,
    renameSync,
    watch,
    writeFileSync,
} from 'fs';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { migrateNavidrome } from './migrate-navidrome';
import { buildLibrary, emptyState, type Library, type LibraryState } from './model';
import { AUDIO, scanFolder } from './scan';
import { startServer } from './server';
import { addStarter, removeStarter, starterStatus } from './starter';

import { store } from '/@/main/features/core/settings';
import log from '/@/main/logger';

const USERNAME = 'admin';
// Next to the settings file, so dev and packaged builds (and their passwords) never share a library.
const dataDir = path.join(path.dirname(store.path), 'local-library');
const stateFile = path.join(dataDir, 'bolbeats-library.json');
const dirs = { cache: path.join(dataDir, 'covers'), images: path.join(dataDir, 'uploads') };

export const currentMusicFolder = () =>
    (store.get('localLibrary.folder') as string) || defaultFolder();

const defaultFolder = () => {
    const mine = path.join(os.homedir(), 'Music', 'my_music');
    return existsSync(mine) ? mine : path.join(os.homedir(), 'Music');
};

// Starter songs ship in the app's assets; `localLibrary.starter` = music folder -> the files BolBeats copied there.
const bundledStarter = app.isPackaged
    ? path.join(process.resourcesPath, 'assets', 'starter-songs')
    : path.join(__dirname, '../../assets/starter-songs');
const starterKnown = () => (store.get('localLibrary.starter') ?? {}) as Record<string, string[]>;
const setStarterKnown = (files: string[]) =>
    store.set('localLibrary.starter', { ...starterKnown(), [folder]: files });

let state: LibraryState | null = null;
let lib: Library | null = null;
let folder = '';
let scanning: null | Promise<void> = null;
let again: boolean | null = null; // a scan asked for while one runs (true = full)
let watcher: FSWatcher | null = null;
let server: Awaited<ReturnType<typeof startServer>> | null = null;
let starting: null | Promise<LocalLibraryInfo> = null;

const loadState = (): LibraryState => {
    try {
        const s = JSON.parse(readFileSync(stateFile, 'utf8')) as LibraryState;
        if (s.version === 1)
            return { ...emptyState(), ...s, ids: { ...emptyState().ids, ...s.ids } };
    } catch {
        // first launch (or unreadable): start fresh, and bring over the old Navidrome library if there is one
    }
    const fresh = emptyState();
    const nd = path.join(dataDir, 'navidrome.db');
    if (existsSync(nd)) {
        try {
            const moved = migrateNavidrome(nd, fresh, dirs.images);
            log.info('[local-library] moved the Navidrome library over', moved);
        } catch (err) {
            log.error('[local-library] could not read the old Navidrome library', err);
        }
    }
    return fresh;
};

// Written to a temporary file first, so a crash mid-write never leaves a broken index.
const writeNow = () => {
    if (!state) return;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(state));
    renameSync(`${stateFile}.tmp`, stateFile);
};
let saveTimer: null | ReturnType<typeof setTimeout> = null;
const save = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            writeNow();
        } catch (err) {
            log.error('[local-library] could not save the library', err);
        }
    }, 500);
};

let lastChangeAt = '';
const rescan = (full = false) => {
    if (scanning) {
        again = again || full;
        return scanning;
    }
    scanning = (async () => {
        const started = Date.now();
        try {
            const r = await scanFolder(folder, state!, full);
            lib = buildLibrary(state!, folder);
            if (r.added || r.changed || r.removed || full || !lastChangeAt)
                lastChangeAt = state!.lastScan;
            save();
            log.info('[local-library] scanned', { ...r, ms: Date.now() - started });
        } catch (err) {
            log.error('[local-library] scan failed', err);
        } finally {
            scanning = null;
            if (again !== null) {
                const f = again;
                again = null;
                void rescan(f);
            }
        }
    })();
    return scanning;
};

// New, changed or removed songs show up by themselves a moment later.
const watchFolder = () => {
    watcher?.close();
    let timer: null | ReturnType<typeof setTimeout> = null;
    try {
        watcher = watch(folder, { recursive: true }, (_event, name) => {
            const file = String(name ?? '');
            const ext = path.extname(file).slice(1).toLowerCase();
            if (ext && !AUDIO.has(ext) && path.basename(file) !== '.ndignore') return; // playlists, covers, notes
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void rescan(false), 1500);
        });
        watcher.on('error', () => undefined);
    } catch (err) {
        log.warn(
            '[local-library] cannot watch the music folder; use Rescan after adding songs',
            err,
        );
    }
};

// An older BolBeats that crashed could leave its Navidrome running; stop it only if that pid really is Navidrome.
const stopOldNavidrome = () => {
    try {
        const pid = Number(readFileSync(path.join(dataDir, 'navidrome.pid'), 'utf8'));
        const name = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
        if (name.includes('navidrome')) process.kill(pid);
    } catch {
        // no pid file, the process is gone, or no `ps` (Windows)
    }
};

const start = async (): Promise<LocalLibraryInfo> => {
    mkdirSync(dataDir, { recursive: true });
    stopOldNavidrome();
    state ??= loadState();
    folder = currentMusicFolder();
    let password = store.get('localLibrary.password') as string;
    if (!password) {
        password = randomBytes(18).toString('hex');
        store.set('localLibrary.password', password);
    }
    const firstScan = !state.lastScan || Object.values(state.tracks).some((t) => t.mtime === -1);
    lib = buildLibrary(state, folder);
    if (!server) {
        const host = {
            dirs,
            lib: () => lib!,
            password,
            rescan: (full: boolean) => void rescan(full),
            save,
            scanStatus: () => ({
                count: lib?.songs.length ?? 0,
                folderCount: new Set(lib?.songs.map((t) => path.posix.dirname(t.rel))).size,
                lastScan: lastChangeAt || state!.lastScan,
                scanning: Boolean(scanning),
            }),
            state,
            warn: (m: string) => log.warn('[local-library]', m),
        };
        // The port the old library used, so saved cover links keep working; any free one if it is taken.
        server = await startServer(host, 45330).catch(() => startServer(host, 0));
    }
    const scan = rescan(false);
    if (firstScan) await scan; // the very first time, open with the songs already there
    // A brand-new, empty library starts with the starter songs (once; you can add them again from Your library).
    if (firstScan && !lib?.songs.length && !store.get('localLibrary.starterOffered')) {
        store.set('localLibrary.starterOffered', true);
        try {
            setStarterKnown(await addStarter(bundledStarter, folder));
            await rescan(false);
        } catch (err) {
            log.warn('[local-library] could not add the starter songs', err);
        }
    }
    watchFolder();
    log.info('[local-library] ready', { folder, url: server.url });
    return { folder, password, url: server.url, username: USERNAME };
};

const stop = () => {
    watcher?.close();
    watcher = null;
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        try {
            writeNow();
        } catch {
            // quitting anyway
        }
    }
};

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
    let picked = !app.isPackaged && testPath ? testPath : ''; // tests pass a path; people use the picker
    if (!picked) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const res = await dialog.showOpenDialog(win!, {
            defaultPath: (store.get('localLibrary.folder') as string) || defaultFolder(),
            properties: ['openDirectory'],
            title: 'Choose your music folder',
        });
        if (res.canceled || !res.filePaths[0]) return null;
        picked = res.filePaths[0];
    }
    if (!(await fs.stat(picked).catch(() => null))?.isDirectory()) return null;
    store.set('localLibrary.folder', picked);
    await scanning;
    starting = null;
    return startOnce();
});

ipcMain.handle('local-library-starter', async (_event, action: 'add' | 'remove' | 'status') => {
    await startOnce();
    const known = starterKnown()[folder] ?? [];
    if (action === 'add') setStarterKnown(await addStarter(bundledStarter, folder, known));
    if (action === 'remove') {
        await removeStarter(folder, known);
        setStarterKnown([]);
    }
    return starterStatus(folder, starterKnown()[folder] ?? []);
});

app.on('will-quit', stop);
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(sig, () => (stop(), app.quit()));
