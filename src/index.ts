import { program } from 'commander';
import { Project, DockerfileFragment, ComposeFragment, ProjectFragment } from './project';
import * as push from './push';
import * as utils from './utils';
import process from 'process';

const parseOptionMultiple = (value: string, previous: ComposeFragment[]): ComposeFragment[] => {
    return previous.concat([{ composePath: value }]);
}

const parseDockerfileOption = (value: string, previous: DockerfileFragment[]): DockerfileFragment[] => {
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

const projectFromOptions = async (options: { composeFile: ComposeFragment[], dockerfile: DockerfileFragment[] }): Promise<Project> => {
    const composeFile = options.composeFile;
    const dockerfile = options.dockerfile;
    if (composeFile.length > 0 || dockerfile.length > 0) {
        return Project.new((composeFile as ProjectFragment[]).concat(dockerfile as ProjectFragment[]));
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
    const dockerfileOption = '-d, --dockerfile <pathAndContext>';
    const dockerfileHelp = 'Use the given Dockerfile, container ID and context, in the format `containerId:dockerfile:context`, where the context is optional and defaults to `.`. May be specified multiple times.'
    program
        .command('push <paths...>')
        .option(composeOption, composeHelp, parseOptionMultiple, [])
        .option(dockerfileOption, dockerfileHelp, parseDockerfileOption, [])
        .action(async (filePaths, options) => {
            await push.run(await projectFromOptions(options), filePaths);
        });
    await program.parseAsync(process.argv);
}

main();
