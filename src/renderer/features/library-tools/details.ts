// BolBeats: looking a song up online and writing what was found into its file. Shared by the Song details review
// (Your library) and the automatic fixer (auto-details.ts). Only the song and artist names leave the Mac.
import { fileName } from '/@/renderer/features/library-tools/library-songs';
import { guessFromName, matchScore, similarity } from '/@/renderer/features/library-tools/match';

export { isSure, SURE } from '/@/renderer/features/library-tools/match';
import type { Song } from '/@/shared/types/domain-types';
import type { LookupCandidate } from '/@/shared/types/online-lookup';

export type Cand = LookupCandidate & { score: number };

export const CONFIDENT = 0.6; // pre-ticked in the review list

const noFeat = (p: string) => p.replace(/\s*[([](feat|ft|with)\b[^)\]]*[)\]]/gi, '').trim();

// Best matches first, duplicates dropped, at most five. Near-equal scores (within 2%, e.g. the single and the album
// take of the same song): the album we expect wins ("from GTAVI The Album" → "Grand Theft Auto VI: The Album").
const rank = (
    found: LookupCandidate[],
    parts: string[],
    seconds: number,
    album: null | string,
): Cand[] => {
    const onAlbum = (c: LookupCandidate) => (album && c.album ? similarity(album, c.album) : 0);
    const band = (v: number) => Math.round(v * 50);
    return found
        .map((c) => ({ ...c, score: matchScore(parts, c, seconds) }))
        .sort(
            (a, b) => band(b.score) - band(a.score) || onAlbum(b) - onAlbum(a) || b.score - a.score,
        )
        .filter(
            (c, j, all) =>
                all.findIndex(
                    (x) => x.title === c.title && x.artist === c.artist && x.album === c.album,
                ) === j,
        )
        .slice(0, 5);
};

// For a song with missing details: guesses the title and artist from its file name.
export const lookUpSong = async (song: Song): Promise<Cand[]> => {
    const guess = guessFromName(fileName(song));
    // title and artist without "(feat. ...)" for the field-by-field MusicBrainz search
    const parts = guess.parts.slice(0, 2).map(noFeat);
    let found: LookupCandidate[] = await window.api.onlineLookup
        .songLookup(guess.term, parts)
        .catch(() => []);
    const best = Math.max(0, ...found.map((c) => matchScore(guess.parts, c, song.duration / 1000)));
    // weak first try: search again with the album named in the file ("from GTAVI The Album")
    if (best < 0.75 && guess.album) {
        found = found.concat(
            await window.api.onlineLookup
                .songLookup(`${guess.term} ${guess.album}`)
                .catch(() => [] as LookupCandidate[]),
        );
    }
    return rank(found, guess.parts, song.duration / 1000, guess.album);
};

// For a song that has its details but no cover: searches by its own title and artist.
export const lookUpByTags = async (song: Song): Promise<Cand[]> => {
    const parts = [noFeat(song.name), noFeat(song.artistName)];
    const found = await window.api.onlineLookup
        .songLookup(parts.join(' '), parts)
        .catch(() => [] as LookupCandidate[]);
    return rank(found, parts, song.duration / 1000, song.album || null);
};

// Puts only a cover into the file; every other tag stays as it is. Back it up first.
export const writeCover = async (song: Song, artworkUrl: string) => {
    const art = await window.api.onlineLookup.fetchImage(artworkUrl).catch(() => null);
    if (!art) return false;
    const res = await window.api.utils.writeSongTagsBatch([song.path!], {}, [], {
        bytes: art.bytes,
        mimeType: art.mimeType,
        type: 'set',
    });
    return res.success;
};

// Writes title, artist, album artist, album, year, genre and the cover into the file. Back it up first.
export const writeDetails = async (song: Song, c: LookupCandidate) => {
    const edits: Record<string, string> = {
        ALBUMARTIST: c.artist,
        ARTIST: c.artist,
        TITLE: c.title,
    };
    if (c.album) edits.ALBUM = c.album;
    if (c.year) edits.DATE = String(c.year);
    if (c.genre) edits.GENRE = c.genre;
    const art = c.artworkUrl
        ? await window.api.onlineLookup.fetchImage(c.artworkUrl).catch(() => null)
        : null;
    const res = await window.api.utils.writeSongTagsBatch(
        [song.path!],
        edits,
        [],
        art ? { bytes: art.bytes, mimeType: art.mimeType, type: 'set' } : undefined,
    );
    return res.success;
};
