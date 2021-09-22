import { Project } from './project';
import Docker from 'dockerode';
import tarFs from 'tar-fs';

export const run = async (project: Project, buildArgs: string[]) => {
    const buildArgsDict: { [key: string]: string } = {};
    for (const buildArg of buildArgs) {
        let key = '';
        let value = '';
        const equalsIndex = buildArg.indexOf('=');
        if (equalsIndex === -1) {
            key = buildArg;
            value = process.env[buildArg] || '';
        } else {
            key = buildArg.substring(0, equalsIndex);
            value = buildArg.substring(equalsIndex + 1, buildArg.length);
        }
        buildArgsDict[key] = value;
    }

    const docker = new Docker();
    for (const configuration of await project.livepushBuildConfigurations()) {
        const imageTag = `${configuration.imageTag.image}:${configuration.imageTag.tag}`;
        console.log(`Building ${imageTag}`);
        let filesSent = 0;
        const totalFileCount = configuration.filePaths.length;
        const stream = await docker.buildImage(
            tarFs.pack(
                configuration.context,
                {
                    entries: configuration.filePaths,
                    map: (header) => {
                        process.stdout.write(
                            `\rSending files ${filesSent}/${totalFileCount}`
                        );
                        filesSent += 1;

                        return header;
                    },
                    finalize: false,
                    finish: (pack) => {
                        console.log(
                            `\rSending files ${totalFileCount}/${totalFileCount}`
                        );
                        pack.entry({ name: 'Dockerfile' }, configuration.dockerfile);
                        pack.finalize();
                    }
                }
            ),
            {
                t: imageTag,
                buildargs: buildArgsDict,
            }
        );
        // TODO: build failures just hang
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(
                stream,
                (err, res) => err ? reject(err) : resolve(res),
                (msg) => {
                    if ('stream' in msg) {
                        process.stdout.write(msg.stream);
                    }
                }
            );
        });
    }
}
