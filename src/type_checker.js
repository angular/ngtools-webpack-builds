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
const compiler_cli_1 = require("@angular/compiler-cli");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const gather_diagnostics_1 = require("./gather_diagnostics");
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
        this._compilerHost = compiler_cli_1.createCompilerHost({
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
            this._program = compiler_cli_1.createProgram({
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
                const message = compiler_cli_1.formatDiagnostics(errors);
                console.error(core_1.terminal.bold(core_1.terminal.red('ERROR in ' + message)));
            }
            else {
                // Reset the changed file tracker only if there are no errors.
                this._compilerHost.resetChangedFileTracker();
            }
            if (warnings.length > 0) {
                const message = compiler_cli_1.formatDiagnostics(warnings);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZV9jaGVja2VyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3R5cGVfY2hlY2tlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFnRDtBQUNoRCxvREFBMkQ7QUFDM0Qsd0RBTytCO0FBQy9CLGlDQUFpQztBQUNqQywyQ0FBNEM7QUFDNUMsbURBQXNEO0FBQ3RELDZEQUE0RTtBQUc1RSwyRUFBMkU7QUFHM0UsSUFBWSxZQUdYO0FBSEQsV0FBWSxZQUFZO0lBQ3RCLCtDQUFJLENBQUE7SUFDSixtREFBTSxDQUFBO0FBQ1IsQ0FBQyxFQUhXLFlBQVksR0FBWixvQkFBWSxLQUFaLG9CQUFZLFFBR3ZCO0FBRUQsTUFBc0Isa0JBQWtCO0lBQ3RDLFlBQW1CLElBQWtCO1FBQWxCLFNBQUksR0FBSixJQUFJLENBQWM7SUFBSSxDQUFDO0NBQzNDO0FBRkQsZ0RBRUM7QUFFRCxNQUFhLFdBQVksU0FBUSxrQkFBa0I7SUFDakQsWUFDUyxlQUFtQyxFQUNuQyxRQUFnQixFQUNoQixPQUFnQixFQUNoQixTQUFtQjtRQUUxQixLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBTGxCLG9CQUFlLEdBQWYsZUFBZSxDQUFvQjtRQUNuQyxhQUFRLEdBQVIsUUFBUSxDQUFRO1FBQ2hCLFlBQU8sR0FBUCxPQUFPLENBQVM7UUFDaEIsY0FBUyxHQUFULFNBQVMsQ0FBVTtJQUc1QixDQUFDO0NBQ0Y7QUFURCxrQ0FTQztBQUVELE1BQWEsYUFBYyxTQUFRLGtCQUFrQjtJQUNuRCxZQUFtQixTQUFtQixFQUFTLHVCQUFpQztRQUM5RSxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRFYsY0FBUyxHQUFULFNBQVMsQ0FBVTtRQUFTLDRCQUF1QixHQUF2Qix1QkFBdUIsQ0FBVTtJQUVoRixDQUFDO0NBQ0Y7QUFKRCxzQ0FJQztBQUVZLFFB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RUFBRTtnQkFDckIsTUFBTSxPQUFPLEdBQUcsZ0NBQWlCLENBQUMsTUFBTSxDQUFDLENBQUM7Z0JBQzFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsZUFBUSxDQUFDLElBQUksQ0FBQyxlQUFRLENBQUMsR0FBRyxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7YUFDbkU7aUJBQU07Z0JBQ0wsOERBQThEO2dCQUM5RCxJQUFJLENBQUMsYUFBYSxDQUFDLHVCQUF1QixFQUFFLENBQUM7YUFDOUM7WUFFRCxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUN2QixNQUFNLE9BQU8sR0FBRyxnQ0FBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztnQkFDNUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxlQUFRLENBQUMsSUFBSSxDQUFDLGVBQVEsQ0FBQyxNQUFNLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQzthQUN4RTtTQUNGO0lBQ0gsQ0FBQztJQUVNLE1BQU0sQ0FBQyxTQUFtQixFQUFFLHVCQUFpQyxFQUN0RCxpQkFBb0M7UUFDaEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsdUJBQXVCLENBQUMsQ0FBQztRQUNqRCxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztRQUM5QixJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUFDLENBQUM7SUFDcEMsQ0FBQztDQUNGO0FBM0ZELGtDQTJGQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7IHRlcm1pbmFsIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgTm9kZUpzU3luY0hvc3QgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBQcm9ncmFtLFxuICBjcmVhdGVDb21waWxlckhvc3QsXG4gIGNyZWF0ZVByb2dyYW0sXG4gIGZvcm1hdERpYWdub3N0aWNzLFxufSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyBDYW5jZWxsYXRpb25Ub2tlbiwgZ2F0aGVyRGlhZ25vc3RpY3MgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5cblxuLy8gVGhpcyBmaWxlIHNob3VsZCBydW4gaW4gYSBjaGlsZCBwcm9jZXNzIHdpdGggdGhlIEFVVE9fU1RBUlRfQVJHIGFyZ3VtZW50XG5cblxuZXhwb3J0IGVudW0gTUVTU0FHRV9LSU5EIHtcbiAgSW5pdCxcbiAgVXBkYXRlLFxufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgVHlwZUNoZWNrZXJNZXNzYWdlIHtcbiAgY29uc3RydWN0b3IocHVibGljIGtpbmQ6IE1FU1NBR0VfS0lORCkgeyB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbml0TWVzc2FnZSBleHRlbmRzIFR5cGVDaGVja2VyTWVzc2FnZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbiAgICBwdWJsaWMgYmFzZVBhdGg6IHN0cmluZyxcbiAgICBwdWJsaWMgaml0TW9kZTogYm9vbGVhbixcbiAgICBwdWJsaWMgcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgKSB7XG4gICAgc3VwZXIoTUVTU0FHRV9LSU5ELkluaXQpO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBVcGRhdGVNZXNzYWdlIGV4dGVuZHMgVHlwZUNoZWNrZXJNZXNzYWdlIHtcbiAgY29uc3RydWN0b3IocHVibGljIHJvb3ROYW1lczogc3RyaW5nW10sIHB1YmxpYyBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICBzdXBlcihNRVNTQUdFX0tJTkQuVXBkYXRlKTtcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgQVVUT19TVEFSVF9BUkcgPSAnOWQ5M2U5MDEtMTU4YS00Y2Y5LWJhMWItMmYwNTgyZmZjZmViJztcblxuZXhwb3J0IGNsYXNzIFR5cGVDaGVja2VyIHtcbiAgcHJpdmF0ZSBfcHJvZ3JhbTogdHMuUHJvZ3JhbSB8IFByb2dyYW07XG4gIHByaXZhdGUgX2NvbXBpbGVySG9zdDogV2VicGFja0NvbXBpbGVySG9zdCAmIENvbXBpbGVySG9zdDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIF9jb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgICBfYmFzZVBhdGg6IHN0cmluZyxcbiAgICBwcml2YXRlIF9KaXRNb2RlOiBib29sZWFuLFxuICAgIHByaXZhdGUgX3Jvb3ROYW1lczogc3RyaW5nW10sXG4gICkge1xuICAgIHRpbWUoJ1R5cGVDaGVja2VyLmNvbnN0cnVjdG9yJyk7XG4gICAgY29uc3QgY29tcGlsZXJIb3N0ID0gbmV3IFdlYnBhY2tDb21waWxlckhvc3QoXG4gICAgICBfY29tcGlsZXJPcHRpb25zLFxuICAgICAgX2Jhc2VQYXRoLFxuICAgICAgbmV3IE5vZGVKc1N5bmNIb3N0KCksXG4gICAgKTtcbiAgICAvLyBXZSBkb24ndCBzZXQgYSBhc3luYyByZXNvdXJjZSBsb2FkZXIgb24gdGhlIGNvbXBpbGVyIGhvc3QgYmVjYXVzZSB3ZSBvbmx5IHN1cHBvcnRcbiAgICAvLyBodG1sIHRlbXBsYXRlcywgd2hpY2ggYXJlIHRoZSBvbmx5IG9uZXMgdGhhdCBjYW4gdGhyb3cgZXJyb3JzLCBhbmQgdGhvc2UgY2FuIGJlIGxvYWRlZFxuICAgIC8vIHN5bmNocm9ub3VzbHkuXG4gICAgLy8gSWYgd2UgbmVlZCB0byBhbHNvIHJlcG9ydCBlcnJvcnMgb24gc3R5bGVzIHRoZW4gd2UnbGwgbmVlZCB0byBhc2sgdGhlIG1haW4gdGhyZWFkXG4gICAgLy8gZm9yIHRoZXNlIHJlc291cmNlcy5cbiAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgdHNIb3N0OiBjb21waWxlckhvc3QsXG4gICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcbiAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5jb25zdHJ1Y3RvcicpO1xuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIHRpbWUoJ1R5cGVDaGVja2VyLl91cGRhdGUnKTtcbiAgICB0aGlzLl9yb290TmFtZXMgPSByb290TmFtZXM7XG4gICAgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMuZm9yRWFjaCgoZmlsZU5hbWUpID0+IHtcbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKGZpbGVOYW1lKTtcbiAgICB9KTtcbiAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5fdXBkYXRlJyk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgdGltZSgnVHlwZUNoZWNrZXIuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICB0aGlzLl9wcm9ncmFtID0gdHMuY3JlYXRlUHJvZ3JhbShcbiAgICAgICAgdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtLFxuICAgICAgKSBhcyB0cy5Qcm9ncmFtO1xuICAgICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRpbWUoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHByb2dyYW0uXG4gICAgICB0aGlzLl9wcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgb2xkUHJvZ3JhbTogdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtLFxuICAgICAgfSkgYXMgUHJvZ3JhbTtcbiAgICAgIHRpbWVFbmQoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2RpYWdub3NlKGNhbmNlbGxhdGlvblRva2VuOiBDYW5jZWxsYXRpb25Ub2tlbikge1xuICAgIGNvbnN0IGFsbERpYWdub3N0aWNzID0gZ2F0aGVyRGlhZ25vc3RpY3MoXG4gICAgICB0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLCAnVHlwZUNoZWNrZXInLCBjYW5jZWxsYXRpb25Ub2tlbik7XG5cbiAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgaWYgKCFjYW5jZWxsYXRpb25Ub2tlbi5pc0NhbmNlbGxhdGlvblJlcXVlc3RlZCgpKSB7XG4gICAgICBjb25zdCBlcnJvcnMgPSBhbGxEaWFnbm9zdGljcy5maWx0ZXIoKGQpID0+IGQuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvcik7XG4gICAgICBjb25zdCB3YXJuaW5ncyA9IGFsbERpYWdub3N0aWNzLmZpbHRlcigoZCkgPT4gZC5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKGVycm9ycyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IodGVybWluYWwuYm9sZCh0ZXJtaW5hbC5yZWQoJ0VSUk9SIGluICcgKyBtZXNzYWdlKSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUmVzZXQgdGhlIGNoYW5nZWQgZmlsZSB0cmFja2VyIG9ubHkgaWYgdGhlcmUgYXJlIG5vIGVycm9ycy5cbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LnJlc2V0Q2hhbmdlZEZpbGVUcmFja2VyKCk7XG4gICAgICB9XG5cbiAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IodGVybWluYWwuYm9sZCh0ZXJtaW5hbC55ZWxsb3coJ1dBUk5JTkcgaW4gJyArIG1lc3NhZ2UpKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHVwZGF0ZShyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10sXG4gICAgICAgICAgICAgICAgY2FuY2VsbGF0aW9uVG9rZW46IENhbmNlbGxhdGlvblRva2VuKSB7XG4gICAgdGhpcy5fdXBkYXRlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpO1xuICAgIHRoaXMuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpO1xuICAgIHRoaXMuX2RpYWdub3NlKGNhbmNlbGxhdGlvblRva2VuKTtcbiAgfVxufVxuIl19