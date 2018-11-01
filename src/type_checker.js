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
const type_checker_messages_1 = require("./type_checker_messages");
// This file should run in a child process with the AUTO_START_ARG argument
exports.AUTO_START_ARG = '9d93e901-158a-4cf9-ba1b-2f0582ffcfeb';
class TypeChecker {
    constructor(_compilerOptions, _basePath, _JitMode, _rootNames, hostReplacementPaths) {
        this._compilerOptions = _compilerOptions;
        this._JitMode = _JitMode;
        this._rootNames = _rootNames;
        benchmark_1.time('TypeChecker.constructor');
        const host = new core_1.virtualFs.AliasHost(new node_1.NodeJsSyncHost());
        // Add file replacements.
        for (const from in hostReplacementPaths) {
            const normalizedFrom = core_1.resolve(core_1.normalize(_basePath), core_1.normalize(from));
            const normalizedWith = core_1.resolve(core_1.normalize(_basePath), core_1.normalize(hostReplacementPaths[from]));
            host.aliases.set(normalizedFrom, normalizedWith);
        }
        const compilerHost = new compiler_host_1.WebpackCompilerHost(_compilerOptions, _basePath, host);
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
        const allDiagnostics = gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'TypeChecker', gather_diagnostics_1.DiagnosticMode.Semantic, cancellationToken);
        // Report diagnostics.
        if (!cancellationToken.isCancellationRequested()) {
            const errors = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
            const warnings = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Warning);
            if (errors.length > 0) {
                const message = compiler_cli_1.formatDiagnostics(errors);
                this.sendMessage(new type_checker_messages_1.LogMessage('error', 'ERROR in ' + message));
            }
            else {
                // Reset the changed file tracker only if there are no errors.
                this._compilerHost.resetChangedFileTracker();
            }
            if (warnings.length > 0) {
                const message = compiler_cli_1.formatDiagnostics(warnings);
                this.sendMessage(new type_checker_messages_1.LogMessage('warn', 'WARNING in ' + message));
            }
        }
    }
    sendMessage(msg) {
        if (process.send) {
            process.send(msg);
        }
    }
    update(rootNames, changedCompilationFiles, cancellationToken) {
        this._update(rootNames, changedCompilationFiles);
        this._createOrUpdateProgram();
        this._diagnose(cancellationToken);
    }
}
exports.TypeChecker = TypeChecker;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZV9jaGVja2VyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3R5cGVfY2hlY2tlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFxRTtBQUNyRSxvREFBMkQ7QUFDM0Qsd0RBTytCO0FBQy9CLGlDQUFpQztBQUNqQywyQ0FBNEM7QUFDNUMsbURBQXNEO0FBQ3RELDZEQUE0RjtBQUM1RixtRUFBeUU7QUFHekUsMkVBQTJFO0FBQzlELFFBQUEsY0FBYyxHQUFHLHNDQUFzQyxDQUFDO0FBRXJFLE1BQWEsV0FBVztJQUl0QixZQUNVLGdCQUFpQyxFQUN6QyxTQUFpQixFQUNULFFBQWlCLEVBQ2pCLFVBQW9CLEVBQzVCLG9CQUFnRDtRQUp4QyxxQkFBZ0IsR0FBaEIsZ0JBQWdCLENBQWlCO1FBRWpDLGFBQVEsR0FBUixRQUFRLENBQVM7UUFDakIsZUFBVSxHQUFWLFVBQVUsQ0FBVTtRQUc1QixnQkFBSSxDQUFDLHlCQUF5QixDQUFDLENBQUM7UUFDaEMsTUFBTSxJQUFJLEdBQUcsSUFBSSxnQkFBUyxDQUFDLFNBQVMsQ0FBQyxJQUFJLHFCQUFjLEVBQUUsQ0FBQyxDQUFDO1FBRTNELHlCQUF5QjtRQUN6QixLQUFLLE1BQU0sSUFBSSxJQUFJLG9CQUFvQixFQUFFO1lBQ3ZDLE1BQU0sY0FBYyxHQUFHLGNBQU8sQ0FBQyxnQkFBUyxDQUFDLFNBQVMsQ0FBQyxFQUFFLGdCQUFTLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUN0RSxNQUFNLGNBQWMsR0FBRyxjQUFPLENBQzVCLGdCQUFTLENBQUMsU0FBUyxDQUFDLEVBQ3BCLGdCQUFTLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FDdEMsQ0FBQztZQUNGLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsRUFBRSxjQUFjLENBQUMsQ0FBQztTQUNsRDtRQUVELE1BQU0sWUFBWSxHQUFHLElBQUksbUNBQW1CLENBQzFDLGdCQUFnQixFQUNoQixTQUFTLEVBQ1QsSUFBSSxDQUNMLENBQUM7UUFDRixvRkFBb0Y7UUFDcEYseUZBQXlGO1FBQ3pGLGlCQUFpQjtRQUNqQixvRkFBb0Y7UUFDcEYsdUJBQXVCO1FBQ3ZCLElBQUksQ0FBQyxhQUFhLEdBQUcsaUNBQWtCLENBQUM7WUFDdEMsT0FBTyxFQUFFLElBQUksQ0FBQyxnQkFBZ0I7WUFDOUIsTUFBTSxFQUFFLFlBQVk7U0FDckIsQ0FBdUMsQ0FBQztRQUN6QyxtQkFBTyxDQUFDLHlCQUF5QixDQUFDLENBQUM7SUFDckMsQ0FBQztJQUVPLE9BQU8sQ0FBQyxTQUFtQixFQUFFLHVCQUFpQztRQUNwRSxnQkFBSSxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFDNUIsSUFBSSxDQUFDLFVBQVUsR0FBRyxTQUFTLENBQUM7UUFDNUIsdUJBQXVCLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxFQUFFLEVBQUU7WUFDM0MsSUFBSSxDQUFDLGFBQWEsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDMUMsQ0FBQyxDQUFDLENBQUM7UUFDSCxtQkFBTyxDQUFDLHFCQUFxQixDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVPLHNCQUFzQjtRQUM1QixJQUFJLElBQUksQ0FBQyxRQUFRLEVBQUU7WUFDakIsaUNBQWlDO1lBQ2pDLGdCQUFJLENBQUMscURBQXFELENBQUMsQ0FBQztZQUM1RCxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQyxhQUFhLENBQzlCLElBQUksQ0FBQyxVQUFVLEVBQ2YsSUFBSSxDQUFDLGdCQUFnQixFQUNyQixJQUFJLENBQUMsYUFBYSxFQUNsQixJQUFJLENBQUMsUUFBc0IsQ0FDZCxDQUFDO1lBQ2hCLG1CQUFPLENBQUMscURBQXFELENBQUMsQ0FBQztTQUNoRTthQUFNO1lBQ0wsZ0JBQUksQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO1lBQzVELDhCQUE4QjtZQUM5QixJQUFJLENBQUMsUUFBUSxHQUFHLDRCQUFhLENBQUM7Z0JBQzVCLFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDMUIsT0FBTyxFQUFFLElBQUksQ0FBQyxnQkFBZ0I7Z0JBQzlCLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDeEIsVUFBVSxFQUFFLElBQUksQ0FBQyxRQUFtQjthQUNyQyxDQUFZLENBQUM7WUFDZCxtQkFBTyxDQUFDLHFEQUFxRCxDQUFDLENBQUM7U0FDaEU7SUFDSCxDQUFDO0lBRU8sU0FBUyxDQUFDLGlCQUFvQztRQUNwRCxNQUFNLGNBQWMsR0FBRyxzQ0FBaUIsQ0FDdEMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxFQUFFLGFBQWEsRUFBRSxtQ0FBYyxDQUFDLFFBQVEsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBRTNGLHNCQUFzQjtRQUN0QixJQUFJLENBQUMsaUJBQWlCLENBQUMsdUJBQXVCLEVBQUUsRUFBRTtZQUNoRCxNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxLQUFLLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN4RixNQUFNLFFBQVEsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxLQUFLLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUU1RixJQUFJLE1BQU0sQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUNyQixNQUFNLE9BQU8sR0FBRyxnQ0FBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDMUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLGtDQUFVLENBQUMsT0FBTyxFQUFFLFdBQVcsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDO2FBQ2xFO2lCQUFNO2dCQUNMLDhEQUE4RDtnQkFDOUQsSUFBSSxDQUFDLGFBQWEsQ0FBQyx1QkFBdUIsRUFBRSxDQUFDO2FBQzlDO1lBRUQsSUFBSSxRQUFRLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDdkIsTUFBTSxPQUFPLEdBQUcsZ0NBQWlCLENBQUMsUUFBUSxDQUFDLENBQUM7Z0JBQzVDLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxrQ0FBVSxDQUFDLE1BQU0sRUFBRSxhQUFhLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQzthQUNuRTtTQUNGO0lBQ0gsQ0FBQztJQUVPLFdBQVcsQ0FBQyxHQUF1QjtRQUN6QyxJQUFJLE9BQU8sQ0FBQyxJQUFJLEVBQUU7WUFDaEIsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztTQUNuQjtJQUNILENBQUM7SUFFTSxNQUFNLENBQUMsU0FBbUIsRUFBRSx1QkFBaUMsRUFDdEQsaUJBQW9DO1FBQ2hELElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLHVCQUF1QixDQUFDLENBQUM7UUFDakQsSUFBSSxDQUFDLHNCQUFzQixFQUFFLENBQUM7UUFDOUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3BDLENBQUM7Q0FDRjtBQTlHRCxrQ0E4R0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQgeyBub3JtYWxpemUsIHJlc29sdmUsIHZpcnR1YWxGcyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IE5vZGVKc1N5bmNIb3N0IH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUvbm9kZSc7XG5pbXBvcnQge1xuICBDb21waWxlckhvc3QsXG4gIENvbXBpbGVyT3B0aW9ucyxcbiAgUHJvZ3JhbSxcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbn0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXItY2xpJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgdGltZSwgdGltZUVuZCB9IGZyb20gJy4vYmVuY2htYXJrJztcbmltcG9ydCB7IFdlYnBhY2tDb21waWxlckhvc3QgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgQ2FuY2VsbGF0aW9uVG9rZW4sIERpYWdub3N0aWNNb2RlLCBnYXRoZXJEaWFnbm9zdGljcyB9IGZyb20gJy4vZ2F0aGVyX2RpYWdub3N0aWNzJztcbmltcG9ydCB7IExvZ01lc3NhZ2UsIFR5cGVDaGVja2VyTWVzc2FnZSB9IGZyb20gJy4vdHlwZV9jaGVja2VyX21lc3NhZ2VzJztcblxuXG4vLyBUaGlzIGZpbGUgc2hvdWxkIHJ1biBpbiBhIGNoaWxkIHByb2Nlc3Mgd2l0aCB0aGUgQVVUT19TVEFSVF9BUkcgYXJndW1lbnRcbmV4cG9ydCBjb25zdCBBVVRPX1NUQVJUX0FSRyA9ICc5ZDkzZTkwMS0xNThhLTRjZjktYmExYi0yZjA1ODJmZmNmZWInO1xuXG5leHBvcnQgY2xhc3MgVHlwZUNoZWNrZXIge1xuICBwcml2YXRlIF9wcm9ncmFtOiB0cy5Qcm9ncmFtIHwgUHJvZ3JhbTtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIF9iYXNlUGF0aDogc3RyaW5nLFxuICAgIHByaXZhdGUgX0ppdE1vZGU6IGJvb2xlYW4sXG4gICAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgICBob3N0UmVwbGFjZW1lbnRQYXRoczogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0sXG4gICkge1xuICAgIHRpbWUoJ1R5cGVDaGVja2VyLmNvbnN0cnVjdG9yJyk7XG4gICAgY29uc3QgaG9zdCA9IG5ldyB2aXJ0dWFsRnMuQWxpYXNIb3N0KG5ldyBOb2RlSnNTeW5jSG9zdCgpKTtcblxuICAgIC8vIEFkZCBmaWxlIHJlcGxhY2VtZW50cy5cbiAgICBmb3IgKGNvbnN0IGZyb20gaW4gaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRGcm9tID0gcmVzb2x2ZShub3JtYWxpemUoX2Jhc2VQYXRoKSwgbm9ybWFsaXplKGZyb20pKTtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRXaXRoID0gcmVzb2x2ZShcbiAgICAgICAgbm9ybWFsaXplKF9iYXNlUGF0aCksXG4gICAgICAgIG5vcm1hbGl6ZShob3N0UmVwbGFjZW1lbnRQYXRoc1tmcm9tXSksXG4gICAgICApO1xuICAgICAgaG9zdC5hbGlhc2VzLnNldChub3JtYWxpemVkRnJvbSwgbm9ybWFsaXplZFdpdGgpO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBpbGVySG9zdCA9IG5ldyBXZWJwYWNrQ29tcGlsZXJIb3N0KFxuICAgICAgX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIF9iYXNlUGF0aCxcbiAgICAgIGhvc3QsXG4gICAgKTtcbiAgICAvLyBXZSBkb24ndCBzZXQgYSBhc3luYyByZXNvdXJjZSBsb2FkZXIgb24gdGhlIGNvbXBpbGVyIGhvc3QgYmVjYXVzZSB3ZSBvbmx5IHN1cHBvcnRcbiAgICAvLyBodG1sIHRlbXBsYXRlcywgd2hpY2ggYXJlIHRoZSBvbmx5IG9uZXMgdGhhdCBjYW4gdGhyb3cgZXJyb3JzLCBhbmQgdGhvc2UgY2FuIGJlIGxvYWRlZFxuICAgIC8vIHN5bmNocm9ub3VzbHkuXG4gICAgLy8gSWYgd2UgbmVlZCB0byBhbHNvIHJlcG9ydCBlcnJvcnMgb24gc3R5bGVzIHRoZW4gd2UnbGwgbmVlZCB0byBhc2sgdGhlIG1haW4gdGhyZWFkXG4gICAgLy8gZm9yIHRoZXNlIHJlc291cmNlcy5cbiAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgdHNIb3N0OiBjb21waWxlckhvc3QsXG4gICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcbiAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5jb25zdHJ1Y3RvcicpO1xuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIHRpbWUoJ1R5cGVDaGVja2VyLl91cGRhdGUnKTtcbiAgICB0aGlzLl9yb290TmFtZXMgPSByb290TmFtZXM7XG4gICAgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMuZm9yRWFjaCgoZmlsZU5hbWUpID0+IHtcbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKGZpbGVOYW1lKTtcbiAgICB9KTtcbiAgICB0aW1lRW5kKCdUeXBlQ2hlY2tlci5fdXBkYXRlJyk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgdGltZSgnVHlwZUNoZWNrZXIuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICB0aGlzLl9wcm9ncmFtID0gdHMuY3JlYXRlUHJvZ3JhbShcbiAgICAgICAgdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtLFxuICAgICAgKSBhcyB0cy5Qcm9ncmFtO1xuICAgICAgdGltZUVuZCgnVHlwZUNoZWNrZXIuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRpbWUoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHByb2dyYW0uXG4gICAgICB0aGlzLl9wcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgb2xkUHJvZ3JhbTogdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtLFxuICAgICAgfSkgYXMgUHJvZ3JhbTtcbiAgICAgIHRpbWVFbmQoJ1R5cGVDaGVja2VyLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2RpYWdub3NlKGNhbmNlbGxhdGlvblRva2VuOiBDYW5jZWxsYXRpb25Ub2tlbikge1xuICAgIGNvbnN0IGFsbERpYWdub3N0aWNzID0gZ2F0aGVyRGlhZ25vc3RpY3MoXG4gICAgICB0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLCAnVHlwZUNoZWNrZXInLCBEaWFnbm9zdGljTW9kZS5TZW1hbnRpYywgY2FuY2VsbGF0aW9uVG9rZW4pO1xuXG4gICAgLy8gUmVwb3J0IGRpYWdub3N0aWNzLlxuICAgIGlmICghY2FuY2VsbGF0aW9uVG9rZW4uaXNDYW5jZWxsYXRpb25SZXF1ZXN0ZWQoKSkge1xuICAgICAgY29uc3QgZXJyb3JzID0gYWxsRGlhZ25vc3RpY3MuZmlsdGVyKChkKSA9PiBkLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgICAgY29uc3Qgd2FybmluZ3MgPSBhbGxEaWFnbm9zdGljcy5maWx0ZXIoKGQpID0+IGQuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgICB0aGlzLnNlbmRNZXNzYWdlKG5ldyBMb2dNZXNzYWdlKCdlcnJvcicsICdFUlJPUiBpbiAnICsgbWVzc2FnZSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gUmVzZXQgdGhlIGNoYW5nZWQgZmlsZSB0cmFja2VyIG9ubHkgaWYgdGhlcmUgYXJlIG5vIGVycm9ycy5cbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LnJlc2V0Q2hhbmdlZEZpbGVUcmFja2VyKCk7XG4gICAgICB9XG5cbiAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICAgIHRoaXMuc2VuZE1lc3NhZ2UobmV3IExvZ01lc3NhZ2UoJ3dhcm4nLCAnV0FSTklORyBpbiAnICsgbWVzc2FnZSkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2VuZE1lc3NhZ2UobXNnOiBUeXBlQ2hlY2tlck1lc3NhZ2UpIHtcbiAgICBpZiAocHJvY2Vzcy5zZW5kKSB7XG4gICAgICBwcm9jZXNzLnNlbmQobXNnKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgdXBkYXRlKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSxcbiAgICAgICAgICAgICAgICBjYW5jZWxsYXRpb25Ub2tlbjogQ2FuY2VsbGF0aW9uVG9rZW4pIHtcbiAgICB0aGlzLl91cGRhdGUocm9vdE5hbWVzLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlcyk7XG4gICAgdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCk7XG4gICAgdGhpcy5fZGlhZ25vc2UoY2FuY2VsbGF0aW9uVG9rZW4pO1xuICB9XG59XG4iXX0=