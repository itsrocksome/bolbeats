// BolBeats: the private on-device library (bundled Navidrome on 127.0.0.1).
// fullScan: the tag settings changed since the last launch, so the library must reread every file once
export type LocalLibraryInfo = {
    folder: string;
    fullScan?: boolean;
    password: string;
    url: string;
    username: string;
};
