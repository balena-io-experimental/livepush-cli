import { Dockerfile, Livepush } from 'livepush';
import * as utils from './utils';
import compose from 'docker-compose';
import Docker from 'dockerode';
import dockerignore from '@balena/dockerignore';
import fsPromise from 'fs/promises';
import path from 'path';
import process from 'process';
import yaml from 'yaml';

export type ComposeFragment = {
    composePath: string
};
export type DockerfileContainerFragment = {
    containerId: string,
    dockerfilePath: string,
    context: string
};
export type DockerfileImageTagFragment = {
    image: string,
    tag: string,
    dockerfilePath: string,
    context: string
};
export type ProjectFragment =
    ComposeFragment |
    DockerfileContainerFragment |
    DockerfileImageTagFragment;

export type ImageTag = { image: string, tag: string };

export type LivepushBuildConfiguration = {
    imageTag: ImageTag,
    dockerfile: string,
    context: string,
    filePaths: string[],
    buildArgs: string[]
};

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
                let imageTag = null;
                let containerId = null;
                if ('image' in fragment) {
                    imageTag = { image: fragment.image, tag: fragment.tag };
                } else if ('containerId' in fragment) {
                    containerId = fragment.containerId;
                }

                services.push(await Service.new(
                    imageTag,
                    containerId,
                    fragment.dockerfilePath,
                    fragment.context,
                    []
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

            const dirname = path.basename(process.cwd());
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

                        let containerId: string | null = ps.out.trim();
                        if (containerId.length === 0) {
                            containerId = null;
                        }
                        services.push(await Service.new(
                            { image: `${dirname}_${name}`, tag: 'latest' },
                            containerId,
                            build.dockerfile,
                            build.context || '.',
                            build.args || []
                        ));
                    }
                }
            }
        }

        return new Project(services);
    }

    public async initLivepush(docker: Docker) {
        await Promise.all(this.services.map((service) => {
            return service.initLivepush(docker);
        }));
    }

    public async notifyChanges(filePaths: string[]) {
        await Promise.all(this.services.map((service) => {
            return service.notifyChanges(filePaths);
        }));
    }

    public async livepushBuildConfigurations(): Promise<LivepushBuildConfiguration[]> {
        return Promise.all(this.services.map((service) => {
            return service.livepushBuildConfiguration();
        }));
    }
}

class Service {
    private livepush: Livepush | null = null;

    private constructor(
        private name: string,
        private imageTag: ImageTag | null,
        private containerId: string | null,
        private dockerfile: Dockerfile,
        private dockerfilePath: string,
        private context: string,
        private buildArgs: string[]
    ) { }

    static async new(
        imageTag: ImageTag | null,
        containerId: string | null,
        dockerfilePath: string,
        context: string,
        buildArgs: string[]
    ): Promise<Service> {
        let name = dockerfilePath;
        if (imageTag !== null) {
            name = imageTag.image;
        }

        return new Service(
            name,
            imageTag,
            containerId,
            new Dockerfile(await fsPromise.readFile(dockerfilePath, {})),
            dockerfilePath,
            path.resolve(context),
            buildArgs
        );
    }

    public async initLivepush(docker: Docker) {
        if (this.livepush !== null) {
            return;
        }
        if (this.containerId === null) {
            throw new Error(
                `cannot initialize livepush for a service that has no container: ${this.dockerfilePath}`
            );
        }

        this.livepush = await Livepush.init({
            dockerfile: this.dockerfile,
            context: this.context,
            containerId: this.containerId,
            // TODO
            stageImages: [],
            docker,
        });
        this.livepush.on('commandExecute',
            (
                payload: {
                    stageIdx: number,
                    command: string
                }
            ) => {
                console.log(`${this.name}: running '${payload.command}'`);
            }
        );
        this.livepush.on('commandOutput',
            (
                payload: {
                    stageIdx: number,
                    output: {
                        data: Buffer,
                        isStderr: boolean
                    }
                }
            ) => {
                console.log(`${this.name}: ${payload.output.data}`);
            }
        );
        this.livepush.on('commandReturn',
            (
                payload: {
                    stageIdx: number,
                    returnCode: number,
                    command: string
                }
            ) => {
                if (payload.returnCode === 0) {
                    return;
                }

                console.log(
                    `${this.name}: command '${payload.command}' failed with code ${payload.returnCode}`
                );
            }
        );
    }

    // TODO: honor .dockerignore
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

    public async livepushBuildConfiguration(): Promise<LivepushBuildConfiguration> {
        if (this.imageTag === null) {
            throw new Error(`missing image and tag for '${this.name}'`);
        }

        let fileFilter = (_: string) => true;
        try {
            const dockerignorePath = path.resolve(this.context, '.dockerignore');
            fileFilter = dockerignore()
                .add((await fsPromise.readFile(dockerignorePath)).toString())
                .createFilter()
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }
        // Call `listFilesRecursive` with a relative path so that tarring works
        // without having to relativize all paths
        const relativeContext = path.relative('.', this.context) || '.'

        return {
            imageTag: this.imageTag,
            dockerfile: this.dockerfile.generateLiveDockerfile(),
            context: this.context,
            filePaths: (await utils.listFilesRecursive(relativeContext))
                .filter(fileFilter),
            buildArgs: this.buildArgs
        };
    }
}
