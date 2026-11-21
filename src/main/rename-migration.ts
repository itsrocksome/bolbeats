// BolBeats: the app was called Hookline, then Bolify. Its data folders (library, best parts, settings) are named after
// the app, so move the newest old one to the current name once, before anything reads them. Must be the first import
// in main/index.ts.
import { app } from 'electron';
import { existsSync, readdirSync, renameSync, rmdirSync } from 'fs';
import path from 'path';

const base = path.dirname(app.getPath('userData'));
// Electron may already have made an empty folder under the new name; that doesn't count as data.
const empty = (dir: string) => {
    try {
        return readdirSync(dir).length === 0;
    } catch {
        return false;
    }
};
for (const suffix of ['', '-dev']) {
    const to = path.join(base, `BolBeats${suffix}`);
    if (existsSync(to) && !empty(to)) continue;
    const from = ['Bolify', 'Hookline']
        .map((n) => path.join(base, `${n}${suffix}`))
        .find((d) => existsSync(d) && !empty(d));
    if (!from) continue;
    try {
        if (existsSync(to)) rmdirSync(to);
        renameSync(from, to);
    } catch {
        // left in place; the app then starts fresh rather than failing to start
    }
}
