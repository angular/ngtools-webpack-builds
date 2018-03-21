"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const chalk_1 = require("chalk");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const gather_diagnostics_1 = require("./gather_diagnostics");
const ngtools_api_1 = require("./ngtools_api");
// This file should run in a child process with the AUTO_START_ARG argument
// Force basic color support on terminals with no color support.
// Chalk typings don't have the correct constructor parameters.
const chalkCtx = new (chalk_1.default.constructor)(chalk_1.default.supportsColor ? {} : { level: 1 });
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
    constructor(compilerOptions, basePath, jitMode, rootNames) {
        super(MESSAGE_KIND.Init);
        this.compilerOptions = compilerOptions;
        this.basePath = basePath;
        this.jitMode = jitMode;
        this.rootNames = rootNames;
    }
}
exports.InitMessage = InitMessage;
class UpdateMessage extends TypeCheckerMessage {
    constructor(rootNames, changedCompilationFiles) {
        super(MESSAGE_KIND.Update);
        this.rootNames = rootNames;
        this.changedCompilationFiles = changedCompilationFiles;
    }
}
exports.UpdateMessage = UpdateMessage;
exports.AUTO_START_ARG = '9d93e901-158a-4cf9-ba1b-2f0582ffcfeb';
class TypeChecker {
    constructor(_compilerOptions, _basePath, _JitMode, _rootNames) {
        this._compilerOptions = _compilerOptions;
        this._JitMode = _JitMode;
        this._rootNames = _rootNames;
        benchmark_1.time('TypeChecker.constructor');
        const compilerHost = new compiler_host_1.WebpackCompilerHost(_compilerOptions, _basePath);
        compilerHost.enableCaching();
        // We don't set a async resource loader on the compiler host because we only support
        // html templates, which are the only ones that can throw errors, and those can be loaded
        // synchronously.
        // If we need to also report errors on styles then we'll need to ask the main thread
        // for these resources.
        this._compilerHost = ngtools_api_1.createCompilerHost({
            options: this._compilerOptions,
            tsHost: compilerHost,
        });
        benchmark_1.timeEnd('TypeChecker.constructor');
    }
    _update(rootNames, changedCompilationFiles) {
        benchmark_1.time('TypeChecker._update');
        this._rootNames = rootNames;
        changedCompilationFiles.forEach((fileName) => {
            this._compilerHost.invalidate(fileName);
        });
        benchmark_1.timeEnd('TypeChecker._update');
    }
    _createOrUpdateProgram() {
        if (this._JitMode) {
            // Create the TypeScript program.
            benchmark_1.time('TypeChecker._createOrUpdateProgram.ts.createProgram');
            this._program = ts.createProgram(this._rootNames, this._compilerOptions, this._compilerHost, this._program);
            benchmark_1.timeEnd('TypeChecker._createOrUpdateProgram.ts.createProgram');
        }
        else {
            benchmark_1.time('TypeChecker._createOrUpdateProgram.ng.createProgram');
            // Create the Angular program.
            this._program = ngtools_api_1.createProgram({
                rootNames: this._rootNames,
                options: this._compilerOptions,
                host: this._compilerHost,
                oldProgram: this._program,
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
                const message = ngtools_api_1.formatDiagnostics(errors);
                console.error(bold(red('ERROR in ' + message)));
            }
            else {
                // Reset the changed file tracker only if there are no errors.
                this._compilerHost.resetChangedFileTracker();
            }
            if (warnings.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(warnings);
                console.log(bold(yellow('WARNING in ' + message)));
            }
        }
    }
    update(rootNames, changedCompilationFiles, cancellationToken) {
        this._update(rootNames, changedCompilationFiles);
        this._createOrUpdateProgram();
        this._diagnose(cancellationToken);
    }
}
exports.TypeChecker = TypeChecker;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZV9jaGVja2VyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3R5cGVfY2hlY2tlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILGlDQUEwQjtBQUMxQixpQ0FBaUM7QUFDakMsMkNBQTRDO0FBQzVDLG1EQUFzRDtBQUN0RCw2REFBNEU7QUFDNUUsK0NBT3VCO0FBR3ZCLDJFQUEyRTtBQUUzRSxnRUFBZ0U7QUFDaEUsK0RBQStEO0FBQy9ELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxlQUFLLENBQUMsV0FBVyxDQUFDLENBQUMsZUFBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0FBQ2xGLE1BQU0sRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLE1BQU0sRUFBRSxHQUFHLFFBQVEsQ0FBQztBQUd2QyxJQUFZLFlBR1g7QUFIRCxXQUFZLFlBQVk7SUFDdEIsK0NBQUksQ0FBQTtJQUNKLG1EQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsWUFBWSxHQUFaLG9CQUFZLEtBQVosb0JBQVksUUFHdkI7QUFFRDtJQUNFLFlBQW1CLElBQWtCO1FBQWxCLFNBQUksR0FBSixJQUFJLENBQWM7SUFBSSxDQUFDO0NBQzNDO0FBRkQsZ0RBRUM7QUFFRCxpQkFBeUIsU0FBUSxrQkFBa0I7SUFDakQsWUFDUyxlQUFtQyxFQUNuQyxRQUFnQixFQUNoQixPQUFnQixFQUNoQixTQUFtQjtRQUUxQixLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBTGxCLG9CQUFlLEdBQWYsZUFBZSxDQUFvQjtRQUNuQyxhQUFRLEdBQVIsUUFBUSxDQUFRO1FBQ2hCLFlBQU8sR0FBUCxPQUFPLENBQVM7UUFDaEIsY0FBUyxHQUFULFNBQVMsQ0FBVTtJQUc1QixDQUFDO0NBQ0Y7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QUFDLENBQUM7SUFDcEMsQ0FBQztDQUNGO0FBeEZELGtDQXdGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCBjaGFsayBmcm9tICdjaGFsayc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0IH0gZnJvbSAnLi9jb21waWxlcl9ob3N0JztcbmltcG9ydCB7IENhbmNlbGxhdGlvblRva2VuLCBnYXRoZXJEaWFnbm9zdGljcyB9IGZyb20gJy4vZ2F0aGVyX2RpYWdub3N0aWNzJztcbmltcG9ydCB7XG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBQcm9ncmFtLFxuICBjcmVhdGVDb21waWxlckhvc3QsXG4gIGNyZWF0ZVByb2dyYW0sXG4gIGZvcm1hdERpYWdub3N0aWNzLFxufSBmcm9tICcuL25ndG9vbHNfYXBpJztcblxuXG4vLyBUaGlzIGZpbGUgc2hvdWxkIHJ1biBpbiBhIGNoaWxkIHByb2Nlc3Mgd2l0aCB0aGUgQVVUT19TVEFSVF9BUkcgYXJndW1lbnRcblxuLy8gRm9yY2UgYmFzaWMgY29sb3Igc3VwcG9ydCBvbiB0ZXJtaW5hbHMgd2l0aCBubyBjb2xvciBzdXBwb3J0LlxuLy8gQ2hhbGsgdHlwaW5ncyBkb24ndCBoYXZlIHRoZSBjb3JyZWN0IGNvbnN0cnVjdG9yIHBhcmFtZXRlcnMuXG5jb25zdCBjaGFsa0N0eCA9IG5ldyAoY2hhbGsuY29uc3RydWN0b3IpKGNoYWxrLnN1cHBvcnRzQ29sb3IgPyB7fSA6IHsgbGV2ZWw6IDEgfSk7XG5jb25zdCB7IGJvbGQsIHJlZCwgeWVsbG93IH0gPSBjaGFsa0N0eDtcblxuXG5leHBvcnQgZW51bSBNRVNTQUdFX0tJTkQge1xuICBJbml0LFxuICBVcGRhdGUsXG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBUeXBlQ2hlY2tlck1lc3NhZ2Uge1xuICBjb25zdHJ1Y3RvcihwdWJsaWMga2luZDogTUVTU0FHRV9LSU5EKSB7IH1cbn1cblxuZXhwb3J0IGNsYXNzIEluaXRNZXNzYWdlIGV4dGVuZHMgVHlwZUNoZWNrZXJNZXNzYWdlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHVibGljIGNvbXBpbGVyT3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuICAgIHB1YmxpYyBiYXNlUGF0aDogc3RyaW5nLFxuICAgIHB1YmxpYyBqaXRNb2RlOiBib29sZWFuLFxuICAgIHB1YmxpYyByb290TmFtZXM6IHN0cmluZ1tdLFxuICApIHtcbiAgICBzdXBlcihNRVNTQUdFX0tJTkQuSW5pdCk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFVwZGF0ZU1lc3NhZ2UgZXh0ZW5kcyBUeXBlQ2hlY2tlck1lc3NhZ2Uge1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgcm9vdE5hbWVzOiBzdHJpbmdbXSwgcHVibGljIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIHN1cGVyKE1FU1NBR0VfS0lORC5VcGRhdGUpO1xuICB9XG59XG5cbmV4cG9ydCBjb25zdCBBVVRPX1NUQVJUX0FSRyA9ICc5ZDkzZTkwMS0xNThhLTRjZjktYmExYi0yZjA1ODJmZmNmZWInO1xuXG5leHBvcnQgY2xhc3MgVHlwZUNoZWNrZXIge1xuICBwcml2YXRlIF9wcm9ncmFtOiB0cy5Qcm9ncmFtIHwgUHJvZ3JhbTtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIF9iYXNlUGF0aDogc3RyaW5nLFxuICAgIHByaXZhdGUgX0ppdE1vZGU6IGJvb2xlYW4sXG4gICAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgKSB7XG4gICAgdGltZSgnVHlwZUNoZWNrZXIuY29uc3RydWN0b3InKTtcbiAgICBjb25zdCBjb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChfY29tcGlsZXJPcHRpb25zLCBfYmFzZVBhdGgpO1xuICAgIGNvbXBpbGVySG9zdC5lbmFibGVDYWNoaW5nKCk7XG4gICAgLy8gV2UgZG9uJ3Qgc2V0IGEgYXN5bmMgcmVzb3VyY2UgbG9hZGVyIG9uIHRoZSBjb21waWxlciBob3N0IGJlY2F1c2Ugd2Ugb25seSBzdXBwb3J0XG4gICAgLy8gaHRtbCB0ZW1wbGF0ZXMsIHdoaWNoIGFyZSB0aGUgb25seSBvbmVzIHRoYXQgY2FuIHRocm93IGVycm9ycywgYW5kIHRob3NlIGNhbiBiZSBsb2FkZWRcbiAgICAvLyBzeW5jaHJvbm91c2x5LlxuICAgIC8vIElmIHdlIG5lZWQgdG8gYWxzbyByZXBvcnQgZXJyb3JzIG9uIHN0eWxlcyB0aGVuIHdlJ2xsIG5lZWQgdG8gYXNrIHRoZSBtYWluIHRocmVhZFxuICAgIC8vIGZvciB0aGVzZSByZXNvdXJjZXMuXG4gICAgdGhpcy5fY29tcGlsZXJIb3N0ID0gY3JlYXRlQ29tcGlsZXJIb3N0KHtcbiAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHRzSG9zdDogY29tcGlsZXJIb3N0LFxuICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG4gICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuY29uc3RydWN0b3InKTtcbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZShyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICB0aW1lKCdUeXBlQ2hlY2tlci5fdXBkYXRlJyk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gcm9vdE5hbWVzO1xuICAgIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzLmZvckVhY2goKGZpbGVOYW1lKSA9PiB7XG4gICAgICB0aGlzLl9jb21waWxlckhvc3QuaW52YWxpZGF0ZShmaWxlTmFtZSk7XG4gICAgfSk7XG4gICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuX3VwZGF0ZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgdGhpcy5fcHJvZ3JhbSA9IHRzLmNyZWF0ZVByb2dyYW0oXG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSxcbiAgICAgICkgYXMgdHMuUHJvZ3JhbTtcbiAgICAgIHRpbWVFbmQoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdUeXBlQ2hlY2tlci5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICByb290TmFtZXM6IHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIG9sZFByb2dyYW06IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSxcbiAgICAgIH0pIGFzIFByb2dyYW07XG4gICAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9kaWFnbm9zZShjYW5jZWxsYXRpb25Ub2tlbjogQ2FuY2VsbGF0aW9uVG9rZW4pIHtcbiAgICBjb25zdCBhbGxEaWFnbm9zdGljcyA9IGdhdGhlckRpYWdub3N0aWNzKFxuICAgICAgdGhpcy5fcHJvZ3JhbSwgdGhpcy5fSml0TW9kZSwgJ1R5cGVDaGVja2VyJywgY2FuY2VsbGF0aW9uVG9rZW4pO1xuXG4gICAgLy8gUmVwb3J0IGRpYWdub3N0aWNzLlxuICAgIGlmICghY2FuY2VsbGF0aW9uVG9rZW4uaXNDYW5jZWxsYXRpb25SZXF1ZXN0ZWQoKSkge1xuICAgICAgY29uc3QgZXJyb3JzID0gYWxsRGlhZ25vc3RpY3MuZmlsdGVyKChkKSA9PiBkLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgICAgY29uc3Qgd2FybmluZ3MgPSBhbGxEaWFnbm9zdGljcy5maWx0ZXIoKGQpID0+IGQuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgICBjb25zb2xlLmVycm9yKGJvbGQocmVkKCdFUlJPUiBpbiAnICsgbWVzc2FnZSkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFJlc2V0IHRoZSBjaGFuZ2VkIGZpbGUgdHJhY2tlciBvbmx5IGlmIHRoZXJlIGFyZSBubyBlcnJvcnMuXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgICAgfVxuXG4gICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3Mod2FybmluZ3MpO1xuICAgICAgICBjb25zb2xlLmxvZyhib2xkKHllbGxvdygnV0FSTklORyBpbiAnICsgbWVzc2FnZSkpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwdWJsaWMgdXBkYXRlKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSxcbiAgICAgICAgICAgICAgICBjYW5jZWxsYXRpb25Ub2tlbjogQ2FuY2VsbGF0aW9uVG9rZW4pIHtcbiAgICB0aGlzLl91cGRhdGUocm9vdE5hbWVzLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlcyk7XG4gICAgdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCk7XG4gICAgdGhpcy5fZGlhZ25vc2UoY2FuY2VsbGF0aW9uVG9rZW4pO1xuICB9XG59XG4iXX0=