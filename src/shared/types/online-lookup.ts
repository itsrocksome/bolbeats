export type ArtistRelease = {
    artist: string;
    artworkUrl: null | string;
    date: string; // ISO; in the future = announced / pre-order
    kind?: string; // "Album", "Single", "EP" when the source says so
    source?: 'iTunes' | 'MusicBrainz';
    title: string;
    trackCount: null | number;
    url: string;
};

// One song on a store chart. previewUrl is a 30-second store preview: Apple allows it only next to a store link.
export type ChartSong = {
    artist: string;
    artworkUrl: null | string;
    genre: null | string;
    id: string;
    previewUrl: null | string;
    price: null | string;
    rank: number;
    releaseDate: null | string;
    storeUrl: string;
    title: string;
};

// BolBeats: shapes returned by the online-lookup IPC.
export type LookupCandidate = {
    album: null | string;
    artist: string;
    artworkUrl: null | string;
    buyUrl?: null | string; // iTunes Store page, where the song can be bought as a DRM-free file
    durationSec: null | number;
    genre: null | string;
    price?: null | string; // e.g. "₹15.00"
    source: 'iTunes' | 'MusicBrainz';
    title: string;
    year: null | number;
};
