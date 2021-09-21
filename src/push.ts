import { Project } from './project';
import Docker from 'dockerode';

export const run = async (project: Project, filePaths: string[]) => {
    await project.initLivepush(new Docker());
    await project.notifyChanges(filePaths);
}
