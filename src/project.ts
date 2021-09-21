import { Dockerfile, Livepush } from 'livepush';
import * as utils from './utils';
import compose from 'docker-compose';
import Docker from 'dockerode';
import fsPromise from 'fs/promises';
import path from 'path';
import process from 'process';
import yaml from 'yaml';

export type ComposeFragment = { composePath: string };
export type DockerfileFragment = { containerId: string, dockerfilePath: string, context: string };

export type ProjectFragment = ComposeFragment | DockerfileFragment;

export class Project {
    private constructor(private services: Service[]) { }

    public static async new(fragments: ProjectFragment[]): Promise<Project> {
        // Accumulate all compose paths so we can call `docker-compose config`
        // on all at the same time
        const composePaths: string[] = [];
        const services = [];
        for (const fragment of fragments) {
            if ('composePath' in fragment) {
                composePaths.push(fragment.composePath);
            } else {
                services.push(await Service.new(
                    fragment.dockerfilePath,
                    fragment.containerId,
                    fragment.dockerfilePath,
                    fragment.context
                ));
            }
        }

        if (composePaths.length > 0) {
            const config = await compose.config({
                cwd: process.cwd(),
                config: composePaths,
            });
            if (config.exitCode !== 0) {
                throw new Error(
                    `failed to run 'docker-compose config -f ${composePaths.join(' -f ')}'`
                );
            }

            const composeServices = yaml.parse(config.out).services;
            for (const [name, definition] of Object.entries(composeServices)) {
                if ('build' in (definition as any)) {
                    const build = (definition as any).build;
                    if ('dockerfile' in build) {
                        const ps = await compose.ps({
                            cwd: process.cwd(),
                            config: composePaths,
                            commandOptions: ['--quiet', '--', name]
                        });
                        if (ps.exitCode !== 0) {
                            throw new Error(
                                `failed to run 'docker-compose ps --quiet -- ${name}'`
                            );
                        }

                        services.push(await Service.new(
                            name,
                            ps.out.trim(),
                            build.dockerfile,
                            build.context || '.'
                        ));
                    }
                }
            }
        }

        return new Project(services);
    }

    public async initLivepush(docker: Docker) {
        for (const service of this.services) {
            await service.initLivepush(docker);
        }
    }

    public async notifyChanges(filePaths: string[]) {
        for (const service of this.services) {
            await service.notifyChanges(filePaths);
        }
    }
}

class Service {
    private livepush: Livepush | null = null;

    private constructor(
        private name: string,
        private containerId: string,
        private dockerfile: Dockerfile,
        private context: string
    ) { }

    static async new(
        name: string,
        containerId: string,
        dockerfilePath: string,
        context: string
    ): Promise<Service> {
        return new Service(
            name,
            containerId,
            new Dockerfile(await fsPromise.readFile(dockerfilePath, {})),
            path.resolve(context)
        );
    }

    public async initLivepush(docker: Docker) {
        if (this.livepush !== null) {
            return;
        }

        this.livepush = await Livepush.init({
            dockerfile: this.dockerfile,
            context: this.context,
            containerId: this.containerId,
            // TODO
            stageImages: [],
            docker,
        });
        this.livepush.on('commandExecute', (payload: { stageIdx: number, command: string }) => {
            console.log(`${this.name}: running '${payload.command}'`);
        });
        this.livepush.on('commandOutput', (payload: { stageIdx: number, output: { data: Buffer, isStderr: boolean } }) => {
            console.log(`${this.name}: ${payload.output.data}`);
        });
        this.livepush.on('commandReturn', (payload: { stageIdx: number, returnCode: number, command: string }) => {
            if (payload.returnCode === 0) {
                return;
            }

            console.log(`${this.name}: command '${payload.command}' failed with code ${payload.returnCode}`);
        });
    }

    public async notifyChanges(filePaths: string[]) {
        if (this.livepush === null) {
            throw new Error('`initLivepush` was not called');
        }

        const addedOrUpdated = [];
        const deleted = [];
        for (const filePath of filePaths) {
            if (path.relative(this.context, filePath).startsWith('..')) {
                continue;
            }

            if (await utils.fileExists(filePath)) {
                addedOrUpdated.push(filePath);
            } else {
                deleted.push(filePath);
            }
        }

        if (addedOrUpdated.length === 0 && deleted.length === 0) {
            return;
        }

        console.log(
            `${this.name}: adding or updating ${addedOrUpdated.length} files and deleting ${deleted.length} files`
        );
        await this.livepush.performLivepush(addedOrUpdated, deleted);
    }
}
