// BolBeats: a best part cut straight out of its MP3, whole frames and no re-encoding, so a mix decodes a few seconds
// of audio instead of whole songs (about 30 ms instead of 0.5-1.5 s each). Pure and import-free so Node tests it.
// Timing: a full decode drops the encoder delay written in the LAME/Info frame plus the decoder's own 529 samples;
// a cut has no such frame, so nothing is dropped. Sample i of the cut is song time (firstFrame * spf - skip + i) / rate.

export type Mp3Index = { frames: number[]; rate: number; skip: number; spf: number };

const V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const PRE = 10; // lead-in frames: the decoder needs earlier frames to rebuild its state (8 was exact on every test song)
const POST = 2;

const header = (b: Uint8Array, o: number) => {
    if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
    const ver = (b[o + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const bri = b[o + 2] >> 4;
    const sri = (b[o + 2] >> 2) & 3;
    if (ver === 1 || ((b[o + 1] >> 1) & 3) !== 1 || bri === 0 || bri === 15 || sri === 3)
        return null; // Layer III only
    const v1 = ver === 3;
    const rate = [44100, 48000, 32000][sri] / (v1 ? 1 : ver === 2 ? 2 : 4);
    const spf = v1 ? 1152 : 576;
    const size =
        Math.floor(((spf / 8) * (v1 ? V1 : V2)[bri] * 1000) / rate) + ((b[o + 2] >> 1) & 1);
    return { mono: b[o + 3] >> 6 === 3, rate, size, spf, v1 };
};

const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// Byte offsets of every audio frame (plus the end), or null when this isn't an MP3 we can cut.
export const indexMp3 = (b: Uint8Array): Mp3Index | null => {
    let o = 0;
    if (tag(b, 0).startsWith('ID3'))
        o = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
    // the first frame is where two valid headers follow each other
    let h = header(b, o);
    for (let n = 0; n < 65536 && !(h && header(b, o + h.size)?.rate === h.rate); n++)
        h = header(b, ++o);
    if (!h) return null;
    const first = h;
    const frames: number[] = [];
    while (h && h.rate === first.rate && o + h.size <= b.length) {
        frames.push(o);
        o += h.size;
        h = header(b, o);
    }
    if (frames.length < 2) return null;
    frames.push(o);
    // an Xing/Info/VBRI frame holds no audio; its LAME part says how many samples the encoder put in front
    let skip = 0;
    const side = first.v1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
    const x = frames[0] + 4 + side;
    if (tag(b, x) === 'Xing' || tag(b, x) === 'Info') {
        const flags = b[x + 7];
        const lame =
            x +
            8 +
            (flags & 1 ? 4 : 0) +
            (flags & 2 ? 4 : 0) +
            (flags & 4 ? 100 : 0) +
            (flags & 8 ? 4 : 0);
        if (/^(LAME|Lavf|Lavc|GOGO)/.test(tag(b, lame)))
            skip = ((b[lame + 21] << 4) | (b[lame + 22] >> 4)) + 529;
        frames.shift();
    } else if (tag(b, frames[0] + 36) === 'VBRI') frames.shift();
    return { frames, rate: first.rate, skip, spf: first.spf };
};

// The frames covering start..end seconds (with a little lead-in), and the song time of the cut's first sample.
export const cutMp3 = (b: Uint8Array, ix: Mp3Index, start: number, end: number) => {
    const n = ix.frames.length - 1;
    const at = (t: number) => (t * ix.rate + ix.skip) / ix.spf;
    const a = Math.max(0, Math.floor(at(start)) - PRE);
    const z = Math.min(n, Math.ceil(at(end)) + POST);
    return {
        bytes: b.slice(ix.frames[a], ix.frames[Math.max(a + 1, z)]),
        offset: (a * ix.spf - ix.skip) / ix.rate,
    };
};
