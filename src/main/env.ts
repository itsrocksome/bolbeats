// BolBeats fork: never auto-update to upstream Feishin builds.
export const disableAutoUpdates = () => true;

export const isMacOS = () => {
    return process.platform === 'darwin';
};

export const isWindows = () => {
    return process.platform === 'win32';
};

export const isLinux = () => {
    return process.platform === 'linux';
};
