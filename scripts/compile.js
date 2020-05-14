const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

async function run(command, args) {
    if (process.platform === 'win32') {
        args.unshift(command);
        args.unshift('/c');
        command = 'cmd.exe';
    }
    const argsAsString = args.join(' ');
    console.log('>', command, argsAsString);
    await new Promise((resolve, reject) => {
        const child = childProcess.spawn(command, args);
        child.stdout.on('data', output => output && output.toString() && console.info(' ', command, argsAsString, ':', output.toString().trim()));
        child.stderr.on('data', output => output && output.toString() && console.error('E', command, argsAsString, ':', output.toString().trim()));
        child.on('exit', code => (code == 0 ? resolve : reject)());
        child.on('error', error => {
            console.error(command, argsAsString, error);
            reject(error);
        });
    });
}

async function forAllFiles(folder, extension, f) {
    const filenames = fs.readdirSync(folder).filter(_ => _.endsWith(extension));
    for (let i = 0; i < filenames.length; i++) {
        await f(path.join(folder, filenames[i]), filenames[i]);
    }
}

async function compileProtos() {
    const allProtos = [];
    await forAllFiles('src/ttf/protos', '.proto', f => allProtos.push(f));
    createIfNotExists('out/src/ttf');
    await run('node_modules/.bin/grpc_tools_node_protoc', 
        [ 
            `--js_out=import_style=commonjs,binary:./out/src/ttf`,
            `--grpc_out=./out/src/ttf`,
            `--plugin=protoc-gen-grpc=node_modules/.bin/grpc_tools_node_protoc_plugin`,
            `--proto_path=./src/ttf/protos`,
            ...allProtos,
        ]);
    await run('node_modules/.bin/grpc_tools_node_protoc', 
        [ 
            `--ts_out=./src/ttf`,
            `--plugin=protoc-gen-ts=node_modules/.bin/protoc-gen-ts`,
            `--proto_path=./src/ttf/protos`,
            ...allProtos,
        ]);
}

function createIfNotExists(folder) {
    if (!fs.existsSync(folder)){
        fs.mkdirSync(folder);
    }
}

(async function() {

    const watchMode = (process.argv[2] || '').trim() === '-w';

    await run('npm', [ 'install' ]);
    createIfNotExists('out');
    createIfNotExists('out/src');
    await compileProtos();
    await run('tsc', [ '-p',  './' ]);
    await forAllFiles('src/panels', '.scss', file => run('node-sass', [ file, '-o', 'out/panels' ]));
    createIfNotExists('out/panels');
    createIfNotExists('out/panels/bundles');
    await forAllFiles('out/panels', '.main.js', (file, basename) => run('browserify', [ file, '-o', 'out/panels/bundles/' + basename ]));

    if (watchMode) {

        // These exact strings are matched by tasks.json. They signal that the initial compilation is finished
        // and that the debugger can be launched:
        const canary = function() {
            console.log('visual-token-designer can now be launched');
            console.log('visual-token-designer watching for incremental changes');
        };
        canary();
        setInterval(canary, 2000);
        
        const tasks = [];
        tasks.push(run('tsc', [ '-watch', '-p', './' ]));
        await forAllFiles('src/panels', '.scss', file => tasks.push(run('node-sass', [ file, '-wo', 'out/panels' ])));
        await forAllFiles('out/panels', '.main.js', (file, basename) => tasks.push(run('watchify', [ file, '-o', 'out/panels/bundles/' + basename ])));
        await Promise.all(tasks);

    }

})();
