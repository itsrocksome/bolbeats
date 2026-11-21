// BolBeats: "Bring songs in" COPIES audio files (never moves or deletes the originals) into the music folder as
// Album artist/Album/NN Title.ext. Pure Node (no Electron, no path aliases) so test/bring-in.test.ts runs it for real.
import { constants } from 'fs';
import { copyFile, mkdir, readdir, stat } from 'fs/promises';
import path from 'path';

import type { BringInResult } from '../../../../shared/types/bolify-folder';

export type BasicTags = null | {
    album?: string;
    albumArtist?: string;
    artist?: string;
    title?: string;
    track?: number;
};

export const AUDIO = /\.(mp3|m4a|aac|flac|alac|wav|aiff?|ogg|oga|opus|wma|ape|wv)$/i;

// A name that is safe as one file or folder name on macOS and Windows.
// Cut by characters, not UTF-16 units, so an emoji or Indic cluster at the cut never leaves half a character.
export const safe = (s: string) =>
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    Array.from(s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-'))
        .slice(0, 120)
        .join('')
        .replace(/^[.\s]+|[.\s]+$/g, '') || 'Untitled';

export const inside = (file: string, dir: string) => {
    const rel = path.relative(dir, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// Audio files under p (or p itself). Skips dotfiles (.DS_Store, ._ AppleDouble copies) and symlinked entries;
// a file or folder that can't be read is reported and the walk goes on.
export async function* audioFiles(
    p: string,
    onError: (p: string) => void = () => {},
): AsyncGenerator<string> {
    try {
        const st = await stat(p);
        if (st.isFile()) {
            if (AUDIO.test(p)) yield p;
            return;
        }
        for (const e of await readdir(p, { withFileTypes: true })) {
            if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
            yield* audioFiles(path.join(p, e.name), onError);
        }
    } catch {
        onError(p);
    }
}

// Where a file goes inside root. Album artist keeps an album with guest artists in one folder.
export const destinationFor = (root: string, file: string, t: BasicTags) => {
    const ext = path.extname(file).toLowerCase();
    const title = safe(t?.title || path.parse(file).name);
    const dir = path.join(
        root,
        safe(t?.albumArtist || t?.artist || 'Unknown artist'),
        safe(t?.album || 'Unknown album'),
    );
    const base = `${t?.track ? `${String(t.track).padStart(2, '0')} ` : ''}${title}`;
    return { base, dir, ext };
};

export const bringIn = async (
    sources: string[],
    root: string,
    readTags: (file: string) => Promise<BasicTags>,
    onStep: (done: number, name: string) => void = () => {},
): Promise<BringInResult> => {
    const out: BringInResult = { copied: 0, failed: [], skipped: 0 };
    let done = 0;
    for (const source of sources) {
        for await (const file of audioFiles(source, (p) => out.failed.push(path.basename(p)))) {
            onStep(++done, path.basename(file));
            if (inside(file, root)) {
                out.skipped++; // already in your music folder
                continue;
            }
            try {
                const t = await readTags(file).catch(() => null);
                const { base, dir, ext } = destinationFor(root, file, t);
                const size = (await stat(file)).size;
                let dest = path.join(dir, base + ext);
                for (let i = 2; ; i++) {
                    const there = await stat(dest).catch(() => null);
                    if (!there) break;
                    if (there.size === size) {
                        dest = '';
                        break;
                    }
                    dest = path.join(dir, `${base} (${i})${ext}`);
                }
                if (!dest) {
                    out.skipped++; // the same song is already there
                    continue;
                }
                await mkdir(dir, { recursive: true });
                await copyFile(file, dest, constants.COPYFILE_EXCL);
                out.copied++;
            } catch {
                out.failed.push(path.basename(file));
            }
        }
    }
    return out;
};
