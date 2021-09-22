import fsPromises from 'fs/promises';
import path from 'path';

export const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fsPromises.stat(filePath);

        return true;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return false;
        } else {
            throw err;
        }
    }
}

export const listFilesRecursive = async (dirPath: string): Promise<string[]> => {
    const files = [];
    for (const entry of await fsPromises.readdir(dirPath, { withFileTypes: true })) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFilesRecursive(entryPath));
        } else {
            files.push(entryPath);
        }
    }

    return files;
}
