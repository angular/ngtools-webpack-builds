"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const core_1 = require("@angular-devkit/core");
const node_1 = require("@angular-devkit/core/node");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const gather_diagnostics_1 = require("./gather_diagnostics");
const ngtools_api_1 = require("./ngtools_api");
// This file should run in a child process with the AUTO_START_ARG argument
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
        const compilerHost = new compiler_host_1.WebpackCompilerHost(_compilerOptions, _basePath, new node_1.NodeJsSyncHost());
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
                console.error(core_1.terminal.bold(core_1.terminal.red('ERROR in ' + message)));
            }
            else {
                // Reset the changed file tracker only if there are no errors.
                this._compilerHost.resetChangedFileTracker();
            }
            if (warnings.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(warnings);
                console.error(core_1.terminal.bold(core_1.terminal.yellow('WARNING in ' + message)));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZV9jaGVja2VyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3R5cGVfY2hlY2tlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFnRDtBQUNoRCxvREFBMkQ7QUFDM0QsaUNBQWlDO0FBQ2pDLDJDQUE0QztBQUM1QyxtREFBc0Q7QUFDdEQsNkRBQTRFO0FBQzVFLCtDQU91QjtBQUd2QiwyRUFBMkU7QUFHM0UsSUFBWSxZQUdYO0FBSEQsV0FBWSxZQUFZO0lBQ3RCLCtDQUFJLENBQUE7SUFDSixtREFBTSxDQUFBO0FBQ1IsQ0FBQyxFQUhXLFlBQVksR0FBWixvQkFBWSxLQUFaLG9CQUFZLFFBR3ZCO0FBRUQsTUFBc0Isa0JBQWtCO0lBQ3RDLFlBQW1CLElBQWtCO1FBQWxCLFNBQUksR0FBSixJQUFJLENBQWM7SUFBSSxDQUFDO0NBQzNDO0FBRkQsZ0RBRUM7QUFFRCxNQUFhLFdBQVksU0FBUSxrQkFBa0I7SUFDakQsWUFDUyxlQUFtQyxFQUNuQyxRQUFnQixFQUNoQixPQUFnQixFQUNoQixTQUFtQjtRQUUxQixLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBTGxCLG9CQUFlLEdBQWYsZUFBZSxDQUFvQjtRQUNuQyxhQUFRLEdBQVIsUUFBUSxDQUFRO1FBQ2hCLFlBQU8sR0FBUCxPQUFPLENBQVM7UUFDaEIsY0FBUyxHQUFULFNBQVMsQ0FBVTtJQUc1QixDQUFDO0NBQ0Y7QUFURCxrQ0FTQztBQUVELE1BQWEsYUFBYyxTQUFRLGtCQUFrQjtJQUNuRCxZQUFtQixTQUFtQixFQUFTLHVCQUFpQztRQUM5RSxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRFYsY0FBUyxHQUFULFNBQVMsQ0FBVTtRQUFTLDRCQUF1QixHQUF2Qix1QkFBdUIsQ0FBVTtJQUVoRixDQUFDO0NBQ0Y7QUFKRCxzQ0FJQztBQUVZLFFB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RUFBRTtnQkFDckIsTUFBTSxPQUFPLEdBQUcsK0JBQWlCLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQzFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsZUFBUSxDQUFDLElBQUksQ0FBQyxlQUFRLENBQUMsR0FBRyxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7YUFDbkU7aUJBQU07Z0JBQ0wsOERBQThEO2dCQUM5RCxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUM7YUFDOUM7WUFFRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUN2QixNQUFNLE9BQU8sR0FBRywrQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDNUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxlQUFRLENBQUMsSUFBSSxDQUFDLGVBQVEsQ0FBQyxNQUFNLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUN4RTtTQUNGO0lBQ0gsQ0FBQztJQUVNLE1BQU0sQ0FBQyxTQUFtQixFQUFFLHVCQUFpQyxFQUN0RCxpQkFBb0M7UUFDaEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsdUJBQXVCLENBQUMsQ0FBQztRQUNqRCxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztRQUM5QixJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDcEMsQ0FBQztDQUNGO0FBM0ZELGtDQTJGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7IHRlcm1pbmFsIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgdGltZSwgdGltZUVuZCB9IGZyb20gJy4vYmVuY2htYXJrJztcbmltcG9ydCB7IFdlYnBhY2tDb21waWxlckhvc3QgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgQ2FuY2VsbGF0aW9uVG9rZW4sIGdhdGhlckRpYWdub3N0aWNzIH0gZnJvbSAnLi9nYXRoZXJfZGlhZ25vc3RpY3MnO1xuaW1wb3J0IHtcbiAgQ29tcGlsZXJIb3N0LFxuICBDb21waWxlck9wdGlvbnMsXG4gIFByb2dyYW0sXG4gIGNyZWF0ZUNvbXBpbGVySG9zdCxcbiAgY3JlYXRlUHJvZ3JhbSxcbiAgZm9ybWF0RGlhZ25vc3RpY3MsXG59IGZyb20gJy4vbmd0b29sc19hcGknO1xuXG5cbi8vIFRoaXMgZmlsZSBzaG91bGQgcnVuIGluIGEgY2hpbGQgcHJvY2VzcyB3aXRoIHRoZSBBVVRPX1NUQVJUX0FSRyBhcmd1bWVudFxuXG5cbmV4cG9ydCBlbnVtIE1FU1NBR0VfS0lORCB7XG4gIEluaXQsXG4gIFVwZGF0ZSxcbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFR5cGVDaGVja2VyTWVzc2FnZSB7XG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBraW5kOiBNRVNTQUdFX0tJTkQpIHsgfVxufVxuXG5leHBvcnQgY2xhc3MgSW5pdE1lc3NhZ2UgZXh0ZW5kcyBUeXBlQ2hlY2tlck1lc3NhZ2Uge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgY29tcGlsZXJPcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4gICAgcHVibGljIGJhc2VQYXRoOiBzdHJpbmcsXG4gICAgcHVibGljIGppdE1vZGU6IGJvb2xlYW4sXG4gICAgcHVibGljIHJvb3ROYW1lczogc3RyaW5nW10sXG4gICkge1xuICAgIHN1cGVyKE1FU1NBR0VfS0lORC5Jbml0KTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVXBkYXRlTWVzc2FnZSBleHRlbmRzIFR5cGVDaGVja2VyTWVzc2FnZSB7XG4gIGNvbnN0cnVjdG9yKHB1YmxpYyByb290TmFtZXM6IHN0cmluZ1tdLCBwdWJsaWMgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgc3VwZXIoTUVTU0FHRV9LSU5ELlVwZGF0ZSk7XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IEFVVE9fU1RBUlRfQVJHID0gJzlkOTNlOTAxLTE1OGEtNGNmOS1iYTFiLTJmMDU4MmZmY2ZlYic7XG5cbmV4cG9ydCBjbGFzcyBUeXBlQ2hlY2tlciB7XG4gIHByaXZhdGUgX3Byb2dyYW06IHRzLlByb2dyYW0gfCBQcm9ncmFtO1xuICBwcml2YXRlIF9jb21waWxlckhvc3Q6IFdlYnBhY2tDb21waWxlckhvc3QgJiBDb21waWxlckhvc3Q7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBfY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgX2Jhc2VQYXRoOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSBfSml0TW9kZTogYm9vbGVhbixcbiAgICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdLFxuICApIHtcbiAgICB0aW1lKCdUeXBlQ2hlY2tlci5jb25zdHJ1Y3RvcicpO1xuICAgIGNvbnN0IGNvbXBpbGVySG9zdCA9IG5ldyBXZWJwYWNrQ29tcGlsZXJIb3N0KFxuICAgICAgX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIF9iYXNlUGF0aCxcbiAgICAgIG5ldyBOb2RlSnNTeW5jSG9zdCgpLFxuICAgICk7XG4gICAgLy8gV2UgZG9uJ3Qgc2V0IGEgYXN5bmMgcmVzb3VyY2UgbG9hZGVyIG9uIHRoZSBjb21waWxlciBob3N0IGJlY2F1c2Ugd2Ugb25seSBzdXBwb3J0XG4gICAgLy8gaHRtbCB0ZW1wbGF0ZXMsIHdoaWNoIGFyZSB0aGUgb25seSBvbmVzIHRoYXQgY2FuIHRocm93IGVycm9ycywgYW5kIHRob3NlIGNhbiBiZSBsb2FkZWRcbiAgICAvLyBzeW5jaHJvbm91c2x5LlxuICAgIC8vIElmIHdlIG5lZWQgdG8gYWxzbyByZXBvcnQgZXJyb3JzIG9uIHN0eWxlcyB0aGVuIHdlJ2xsIG5lZWQgdG8gYXNrIHRoZSBtYWluIHRocmVhZFxuICAgIC8vIGZvciB0aGVzZSByZXNvdXJjZXMuXG4gICAgdGhpcy5fY29tcGlsZXJIb3N0ID0gY3JlYXRlQ29tcGlsZXJIb3N0KHtcbiAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHRzSG9zdDogY29tcGlsZXJIb3N0LFxuICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG4gICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuY29uc3RydWN0b3InKTtcbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZShyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICB0aW1lKCdUeXBlQ2hlY2tlci5fdXBkYXRlJyk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gcm9vdE5hbWVzO1xuICAgIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzLmZvckVhY2goKGZpbGVOYW1lKSA9PiB7XG4gICAgICB0aGlzLl9jb21waWxlckhvc3QuaW52YWxpZGF0ZShmaWxlTmFtZSk7XG4gICAgfSk7XG4gICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuX3VwZGF0ZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgdGhpcy5fcHJvZ3JhbSA9IHRzLmNyZWF0ZVByb2dyYW0oXG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSxcbiAgICAgICkgYXMgdHMuUHJvZ3JhbTtcbiAgICAgIHRpbWVFbmQoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdUeXBlQ2hlY2tlci5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICByb290TmFtZXM6IHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIG9sZFByb2dyYW06IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSxcbiAgICAgIH0pIGFzIFByb2dyYW07XG4gICAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9kaWFnbm9zZShjYW5jZWxsYXRpb25Ub2tlbjogQ2FuY2VsbGF0aW9uVG9rZW4pIHtcbiAgICBjb25zdCBhbGxEaWFnbm9zdGljcyA9IGdhdGhlckRpYWdub3N0aWNzKFxuICAgICAgdGhpcy5fcHJvZ3JhbSwgdGhpcy5fSml0TW9kZSwgJ1R5cGVDaGVja2VyJywgY2FuY2VsbGF0aW9uVG9rZW4pO1xuXG4gICAgLy8gUmVwb3J0IGRpYWdub3N0aWNzLlxuICAgIGlmICghY2FuY2VsbGF0aW9uVG9rZW4uaXNDYW5jZWxsYXRpb25SZXF1ZXN0ZWQoKSkge1xuICAgICAgY29uc3QgZXJyb3JzID0gYWxsRGlhZ25vc3RpY3MuZmlsdGVyKChkKSA9PiBkLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgICAgY29uc3Qgd2FybmluZ3MgPSBhbGxEaWFnbm9zdGljcy5maWx0ZXIoKGQpID0+IGQuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgICBjb25zb2xlLmVycm9yKHRlcm1pbmFsLmJvbGQodGVybWluYWwucmVkKCdFUlJPUiBpbiAnICsgbWVzc2FnZSkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFJlc2V0IHRoZSBjaGFuZ2VkIGZpbGUgdHJhY2tlciBvbmx5IGlmIHRoZXJlIGFyZSBubyBlcnJvcnMuXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgICAgfVxuXG4gICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3Mod2FybmluZ3MpO1xuICAgICAgICBjb25zb2xlLmVycm9yKHRlcm1pbmFsLmJvbGQodGVybWluYWwueWVsbG93KCdXQVJOSU5HIGluICcgKyBtZXNzYWdlKSkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyB1cGRhdGUocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdLFxuICAgICAgICAgICAgICAgIGNhbmNlbGxhdGlvblRva2VuOiBDYW5jZWxsYXRpb25Ub2tlbikge1xuICAgIHRoaXMuX3VwZGF0ZShyb290TmFtZXMsIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzKTtcbiAgICB0aGlzLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKTtcbiAgICB0aGlzLl9kaWFnbm9zZShjYW5jZWxsYXRpb25Ub2tlbik7XG4gIH1cbn1cbiJdfQ==