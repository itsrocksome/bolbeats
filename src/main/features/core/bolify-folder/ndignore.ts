// BolBeats: hides second copies of a song from the library through <music folder>/.ndignore, the library's own
// "skip these files" list. Only BolBeats' block is ever changed; lines you add yourself stay. Pure, so tests load it.
// The library (local-library/model.ts ignoreMatcher) reads each line as a path pattern ("*" stays a wildcard), so
// other regex characters are escaped here; a leading "/" ties the line to the top of the music folder.
// An .ndignore with no patterns at all hides EVERYTHING, so a file that would be left without any is deleted instead.
import type { HiddenCopy } from '/@/shared/types/bolify-folder';

const START =
    '# >>> BolBeats: songs already in your library from another folder. The files stay where they are.';
const END = '# <<< BolBeats';

export const ignoreLine = (rel: string) =>
    /[\\*\n\r]|^\s|\s$/.test(rel) ? null : `/${rel.replace(/[()[\]{}+^$|]/g, '\\$&')}`;

const block = (text: string) => {
    const a = text.indexOf(START);
    const z = a < 0 ? -1 : text.indexOf(END, a);
    return a < 0 || z < 0 ? null : { a, z: z + END.length };
};

export const readHidden = (text: string): HiddenCopy[] => {
    const b = block(text);
    if (!b) return [];
    return text
        .slice(b.a, b.z)
        .split('\n')
        .filter((l) => l.startsWith('# {'))
        .flatMap((l) => {
            try {
                const h = JSON.parse(l.slice(2));
                return typeof h.hide === 'string' && typeof h.same === 'string'
                    ? [{ hide: h.hide, same: h.same }]
                    : [];
            } catch {
                return [];
            }
        });
};

// The new file text, or null when the file should be deleted (nothing left to ignore).
export const writeHidden = (
    text: string,
    hidden: HiddenCopy[],
): { text: null | string; written: HiddenCopy[] } => {
    const b = block(text);
    const own = (b ? text.slice(0, b.a) + text.slice(b.z) : text).replace(/\n{3,}/g, '\n\n').trim();
    const written = hidden.filter((h) => ignoreLine(h.hide));
    const lines = written.flatMap((h) => [`# ${JSON.stringify(h)}`, ignoreLine(h.hide)!]);
    if (!lines.length) {
        if (!b) return { text, written }; // never touched: left as it is
        const ownPatterns = own.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'));
        return { text: ownPatterns ? `${own}\n` : null, written };
    }
    return { text: `${own ? `${own}\n\n` : ''}${START}\n${lines.join('\n')}\n${END}\n`, written };
};
