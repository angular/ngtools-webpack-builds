"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const process = require("process");
const ts = require("typescript");
const chalk = require("chalk");
const compiler_host_1 = require("./compiler_host");
const benchmark_1 = require("./benchmark");
const gather_diagnostics_1 = require("./gather_diagnostics");
const ngtools_api_1 = require("./ngtools_api");
// Force basic color support on terminals with no color support.
// Chalk typings don't have the correct constructor parameters.
const chalkCtx = new chalk.constructor(chalk.supportsColor ? {} : { level: 1 });
const { bold, red, yellow } = chalkCtx;
var MESSAGE_KIND;
(function (MESSAGE_KIND) {
    MESSAGE_KIND[MESSAGE_KIND["Init"] = 0] = "Init";
    MESSAGE_KIND[MESSAGE_KIND["Update"] = 1] = "Update";
})(MESSAGE_KIND = exports.MESSAGE_KIND || (exports.MESSAGE_KIND = {}));
class TypeCheckerMessage {
    constructor(kind) {
        this.kind = kind;
    }
}
exports.TypeCheckerMessage = TypeCheckerMessage;
class InitMessage extends TypeCheckerMessage {
    constructor(compilerOptions, basePath, jitMode, tsFilenames) {
        super(MESSAGE_KIND.Init);
        this.compilerOptions = compilerOptions;
        this.basePath = basePath;
        this.jitMode = jitMode;
        this.tsFilenames = tsFilenames;
    }
}
exports.InitMessage = InitMessage;
class UpdateMessage extends TypeCheckerMessage {
    constructor(changedTsFiles) {
        super(MESSAGE_KIND.Update);
        this.changedTsFiles = changedTsFiles;
    }
}
exports.UpdateMessage = UpdateMessage;
let typeChecker;
let lastCancellationToken;
process.on('message', (message) => {
    benchmark_1.time('TypeChecker.message');
    switch (message.kind) {
        case MESSAGE_KIND.Init:
            const initMessage = message;
            typeChecker = new TypeChecker(initMessage.compilerOptions, initMessage.basePath, initMessage.jitMode, initMessage.tsFilenames);
            break;
        case MESSAGE_KIND.Update:
            if (!typeChecker) {
                throw new Error('TypeChecker: update message received before initialization');
            }
            if (lastCancellationToken) {
                // This cancellation token doesn't seem to do much, messages don't seem to be processed
                // before the diagnostics finish.
                lastCancellationToken.requestCancellation();
            }
            const updateMessage = message;
            lastCancellationToken = new gather_diagnostics_1.CancellationToken();
            typeChecker.update(updateMessage.changedTsFiles, lastCancellationToken);
            break;
        default:
            throw new Error(`TypeChecker: Unexpected message received: ${message}.`);
    }
    benchmark_1.timeEnd('TypeChecker.message');
});
class TypeChecker {
    constructor(_angularCompilerOptions, _basePath, _JitMode, _tsFilenames) {
        this._angularCompilerOptions = _angularCompilerOptions;
        this._JitMode = _JitMode;
        this._tsFilenames = _tsFilenames;
        benchmark_1.time('TypeChecker.constructor');
        const compilerHost = new compiler_host_1.WebpackCompilerHost(_angularCompilerOptions, _basePath);
        compilerHost.enableCaching();
        this._angularCompilerHost = ngtools_api_1.createCompilerHost({
            options: this._angularCompilerOptions,
            tsHost: compilerHost
        });
        this._tsFilenames = [];
        benchmark_1.timeEnd('TypeChecker.constructor');
    }
    _updateTsFilenames(changedTsFiles) {
        benchmark_1.time('TypeChecker._updateTsFilenames');
        changedTsFiles.forEach((fileName) => {
            this._angularCompilerHost.invalidate(fileName);
            if (!this._tsFilenames.includes(fileName)) {
                this._tsFilenames.push(fileName);
            }
        });
        benchmark_1.timeEnd('TypeChecker._updateTsFilenames');
    }
    _createOrUpdateProgram() {
        if (this._JitMode) {
            // Create the TypeScript program.
            benchmark_1.time('TypeChecker._createOrUpdateProgram.ts.createProgram');
            this._program = ts.createProgram(this._tsFilenames, this._angularCompilerOptions, this._angularCompilerHost, this._program);
            benchmark_1.timeEnd('TypeChecker._createOrUpdateProgram.ts.createProgram');
        }
        else {
            benchmark_1.time('TypeChecker._createOrUpdateProgram.ng.createProgram');
            // Create the Angular program.
            this._program = ngtools_api_1.createProgram({
                rootNames: this._tsFilenames,
                options: this._angularCompilerOptions,
                host: this._angularCompilerHost,
                oldProgram: this._program
            });
            benchmark_1.timeEnd('TypeChecker._createOrUpdateProgram.ng.createProgram');
        }
    }
    _diagnose(cancellationToken) {
        const allDiagnostics = gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'TypeChecker', cancellationToken);
        // Report diagnostics.
        if (!cancellationToken.isCancellationRequested()) {
            const errors = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
            const warnings = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Warning);
            if (errors.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(this._angularCompilerOptions, errors);
                console.error(bold(red('ERROR in ' + message)));
            }
            if (warnings.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(this._angularCompilerOptions, warnings);
                console.log(bold(yellow('WARNING in ' + message)));
            }
        }
    }
    update(changedTsFiles, cancellationToken) {
        this._updateTsFilenames(changedTsFiles);
        this._createOrUpdateProgram();
        this._diagnose(cancellationToken);
    }
}
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/type_checker.js.map