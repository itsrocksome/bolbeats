// BolBeats: sharing a best-parts playlist as a .bolbeats file (no audio inside; see renderer best-parts/share-mix.ts):
// save it anywhere, send it with the macOS share menu (AirDrop, Messages, Mail...), open one with a picker, or
// double-click one in Finder. The file's contents are checked in the renderer before anything uses them.
import { app, BrowserWindow, dialog, ipcMain, ShareMenu } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';

import log from '/@/main/logger';

const EXT = 'bolbeats';
const MAX_BYTES = 2_000_000; // a playlist with its cover is well under this

const safeName = (name: string) =>
    `${
        path
            .basename(name)
            .replace(/[\\/:*?"<>|\n\r\t]/g, '-')
            .slice(0, 90) || 'Best parts'
    }`;

const readShared = async (file: string) => {
    if (path.extname(file).toLowerCase() !== `.${EXT}`) return null;
    if ((await stat(file)).size > MAX_BYTES)
        throw new Error('This file is too big to be a BolBeats playlist.');
    return readFile(file, 'utf8');
};

ipcMain.handle('bolify-mix-save', async (event, fileName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts = {
        defaultPath: path.join(app.getPath('downloads'), safeName(fileName)),
        filters: [{ extensions: [EXT], name: 'BolBeats playlist' }],
    };
    const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
    if (canceled || !filePath) return null;
    await writeFile(filePath, content, 'utf8');
    return filePath;
});

// The share menu sends a file, so the playlist is written to a temporary folder first.
ipcMain.handle('bolify-mix-share', async (event, fileName: string, content: string) => {
    if (process.platform !== 'darwin') return false;
    const dir = path.join(app.getPath('temp'), 'BolBeats share');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(fileName));
    await writeFile(file, content, 'utf8');
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    new ShareMenu({ filePaths: [file] }).popup({ window: win });
    return true;
});

ipcMain.handle('bolify-mix-open', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const opts = {
        filters: [{ extensions: [EXT], name: 'BolBeats playlist' }],
        properties: ['openFile' as const],
    };
    const { canceled, filePaths } = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths[0]) return null;
    return readShared(filePaths[0]);
});

// Double-clicking a .bolbeats file (or "Open with BolBeats" after AirDrop). macOS can send it before the window
// exists, so it waits until the page asks for it.
const waiting: string[] = [];
const deliver = (content: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.webContents.isLoading()) win.webContents.send('bolify-mix-opened', content);
    else waiting.push(content);
};
const isShared = (file: string) => path.extname(file).toLowerCase() === `.${EXT}`;
const openShared = (file: string) =>
    readShared(file)
        .then((content) => content && deliver(content))
        .catch((err) => log.warn('[share] could not read a shared playlist', { err: String(err) }));
app.on('open-file', (e, file) => {
    if (!isShared(file)) return;
    e.preventDefault();
    openShared(file);
});
// Windows and Linux hand a double-clicked file over as an argument: to this launch, or to the copy already running.
process.argv.slice(1).filter(isShared).forEach(openShared);
app.on('second-instance', (_e, argv) => argv.filter(isShared).forEach(openShared));
ipcMain.handle('bolify-mix-waiting', () => waiting.splice(0));
