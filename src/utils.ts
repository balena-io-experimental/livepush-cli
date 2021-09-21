import fsPromises from 'fs/promises';

export const fileExists = async (path: string): Promise<boolean> => {
    try {
        await fsPromises.stat(path);

        return true;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return false;
        } else {
            throw err;
        }
    }
}
