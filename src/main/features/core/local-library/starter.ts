import type { StarterStatus } from '/@/shared/types/local-library';

// BolBeats: starter songs (free to share, CC BY 4.0, credits in each folder) that ship inside the app, so a new
// library isn't empty. Each folder becomes a playlist. Pure Node (relative imports only) so test/starter.test.ts runs it.
// Only files BolBeats copied are ever removed, and removing deletes them for good, so their space comes back.
import { constants, promises as fs } from 'fs';
import path from 'path';

// Every file in each folder of `bundled`, as `folder/file` (dotfiles skipped).
const bundledFiles = async (bundled: string) => {
    const out: string[] = [];
    for (const dir of await fs.readdir(bundled).catch(() => [] as string[])) {
        if (dir.startsWith('.')) continue;
        const files = await fs.readdir(path.join(bundled, dir)).catch(() => [] as string[]);
        for (const f of files) if (!f.startsWith('.')) out.push(path.join(dir, f));
    }
    return out;
};

// Copies the starter folders into `folder`, never over a file that is already there. Returns every starter file
// that is now there because of BolBeats (`known` = ones copied before), to remember for removing later.
export const addStarter = async (bundled: string, folder: string, known: string[] = []) => {
    const mine = new Set(known);
    for (const rel of await bundledFiles(bundled)) {
        const to = path.join(folder, rel);
        await fs.mkdir(path.dirname(to), { recursive: true });
        try {
            await fs.copyFile(path.join(bundled, rel), to, constants.COPYFILE_EXCL);
            mine.add(rel);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err; // a file of yours: left alone
        }
    }
    return [...mine];
};

export const starterStatus = async (folder: string, known: string[]): Promise<StarterStatus> => {
    let bytes = 0;
    let count = 0;
    let songs = 0;
    for (const rel of known) {
        const st = await fs.stat(path.join(folder, rel)).catch(() => null);
        if (!st?.isFile()) continue;
        bytes += st.size;
        count++;
        if (!rel.endsWith('.txt')) songs++;
    }
    const folders = [...new Set(known.map((r) => r.split(path.sep)[0]))];
    return { bytes, count, folders, songs };
};

// Deletes the files BolBeats copied (only ones inside `folder`), then their folders if nothing else is left in them.
export const removeStarter = async (folder: string, known: string[]) => {
    let freed = 0;
    for (const rel of known) {
        const p = path.resolve(folder, rel);
        if (!p.startsWith(path.resolve(folder) + path.sep)) continue;
        const st = await fs.stat(p).catch(() => null);
        if (!st?.isFile()) continue;
        await fs.rm(p);
        freed += st.size;
    }
    for (const dir of new Set(known.map((r) => r.split(path.sep)[0]))) {
        const p = path.join(folder, dir);
        const left = await fs.readdir(p).catch(() => null);
        if (left && left.every((f) => f === '.DS_Store')) await fs.rm(p, { recursive: true });
    }
    return freed;
};
