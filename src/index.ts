import { program } from 'commander';
import {
    Project,
    DockerfileContainerFragment,
    DockerfileImageTagFragment,
    ComposeFragment,
    ProjectFragment
} from './project';
import * as build from './build';
import * as push from './push';
import * as utils from './utils';
import process from 'process';

const parseOptionMultiple = (
    value: string,
    previous: string[]
): string[] => {
    return previous.concat([value]);
}

const parseMultipleComposePath = (
    value: string,
    previous: ComposeFragment[]
): ComposeFragment[] => {
    return previous.concat([{ composePath: value }]);
}

const parseDockerfileContainerOption = (
    value: string,
    previous: DockerfileContainerFragment[]
): DockerfileContainerFragment[] => {
    const fields = value.split(':');
    if (fields.length < 2) {
        throw new Error(`'${value}' is not a valid '--dockerfile' argument`);
    } else if (fields.length == 2) {
        return previous.concat([{
            containerId: fields[0],
            dockerfilePath: fields[1],
            context: '.',
        }]);
    } else {
        return previous.concat([{
            containerId: fields[0],
            dockerfilePath: fields[1],
            context: fields.slice(2).join(':'),
        }]);
    }
}

const parseDockerfileTagOption = (
    value: string,
    previous: DockerfileImageTagFragment[]
): DockerfileImageTagFragment[] => {
    const fields = value.split(':');
    if (fields.length < 3) {
        throw new Error(`'${value}' is not a valid '--dockerfile' argument`);
    } else if (fields.length == 3) {
        return previous.concat([{
            image: fields[0],
            tag: fields[1],
            dockerfilePath: fields[2],
            context: '.',
        }]);
    } else {
        return previous.concat([{
            image: fields[0],
            tag: fields[1],
            dockerfilePath: fields[2],
            context: fields.slice(3).join(':'),
        }]);
    }
}

const projectFromOptions = async (
    options: {
        composeFile: ComposeFragment[],
        dockerfile: DockerfileContainerFragment[]
    }
): Promise<Project> => {
    const composeFile = options.composeFile;
    const dockerfile = options.dockerfile;
    if (composeFile.length > 0 || dockerfile.length > 0) {
        return Project.new(
            (composeFile as ProjectFragment[])
                .concat(dockerfile as ProjectFragment[])
        );
    } else if (await utils.fileExists('docker-compose.yml')) {
        return Project.new([{ composePath: 'docker-compose.yml' }]);
    } else {
        throw new Error(
            'could not find a `docker-compose.yml` and neither `--compose-file` nor `--dockerfile` were specified'
        );
    }
}

const main = async () => {
    const composeOption = '-c, --compose-file <path>';
    const composeHelp = 'Use the given compose file. May be specified multiple times. If not specified, defaults to `docker-compose.yml` if it exists in the current directory.';
    const dockerfileOption = '-d, --dockerfile <containerPathAndContext>';
    const dockerfileTagHelp = 'Use the given image, tag, Dockerfile and context, in the format `image:tag:dockerfile:context`, where the context is optional and defaults to `.`. May be specified multiple times.'
    const dockerfileContainerHelp = 'Use the given container ID, Dockerfile and context, in the format `containerId:dockerfile:context`, where the context is optional and defaults to `.`. May be specified multiple times.'
    program
        .command('build')
        .option(composeOption, composeHelp, parseMultipleComposePath, [])
        .option(dockerfileOption, dockerfileTagHelp, parseDockerfileTagOption, [])
        .option('--build-arg <arg>', 'Set the given build argument during build, in the format `key=value`. `value` is optional and if not given it will be set to the same value as in the environment. May be specified multiple times.', parseOptionMultiple, [])
        .action(async (options) => {
            await build.run(await projectFromOptions(options), options.buildArg);
        });
    program.command('push <paths...>')
        .option(composeOption, composeHelp, parseMultipleComposePath, [])
        .option(dockerfileOption, dockerfileContainerHelp, parseDockerfileContainerOption, [])
        .action(async (filePaths, options) => {
            await push.run(await projectFromOptions(options), filePaths);
        });
    await program.parseAsync(process.argv);
}

main();
