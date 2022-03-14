"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NgccProcessor = void 0;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const benchmark_1 = require("./benchmark");
// We cannot create a plugin for this, because NGTSC requires addition type
// information which ngcc creates when processing a package which was compiled with NGC.
// Example of such errors:
// ERROR in node_modules/@angular/platform-browser/platform-browser.d.ts(42,22):
// error TS-996002: Appears in the NgModule.imports of AppModule,
// but could not be resolved to an NgModule class
// We now transform a package and it's typings when NGTSC is resolving a module.
class NgccProcessor {
    constructor(compilerNgcc, propertiesToConsider, compilationWarnings, compilationErrors, basePath, tsConfigPath, inputFileSystem, resolver) {
        this.compilerNgcc = compilerNgcc;
        this.propertiesToConsider = propertiesToConsider;
        this.compilationWarnings = compilationWarnings;
        this.compilationErrors = compilationErrors;
        this.basePath = basePath;
        this.tsConfigPath = tsConfigPath;
        this.inputFileSystem = inputFileSystem;
        this.resolver = resolver;
        this._processedModules = new Set();
        this._logger = new NgccLogger(this.compilationWarnings, this.compilationErrors, compilerNgcc.LogLevel.info);
        this._nodeModulesDirectory = this.findNodeModulesDirectory(this.basePath);
    }
    /** Process the entire node modules tree. */
    process() {
        // Under Bazel when running in sandbox mode parts of the filesystem is read-only.
        if (process.env.BAZEL_TARGET) {
            return;
        }
        // Skip if node_modules are read-only
        const corePackage = this.tryResolvePackage('@angular/core', this._nodeModulesDirectory);
        if (corePackage && isReadOnlyFile(corePackage)) {
            return;
        }
        // Perform a ngcc run check to determine if an initial execution is required.
        // If a run hash file exists that matches the current package manager lock file and the
        // project's tsconfig, then an initial ngcc run has already been performed.
        let skipProcessing = false;
        let runHashFilePath;
        const runHashBasePath = path.join(this._nodeModulesDirectory, '.cli-ngcc');
        const projectBasePath = path.join(this._nodeModulesDirectory, '..');
        try {
            let ngccConfigData;
            try {
                ngccConfigData = (0, fs_1.readFileSync)(path.join(projectBasePath, 'ngcc.config.js'));
            }
            catch (_a) {
                ngccConfigData = '';
            }
            const relativeTsconfigPath = path.relative(projectBasePath, this.tsConfigPath);
            const tsconfigData = (0, fs_1.readFileSync)(this.tsConfigPath);
            const { lockFileData, lockFilePath } = this.findPackageManagerLockFile(projectBasePath);
            // Generate a hash that represents the state of the package lock file and used tsconfig
            const runHash = (0, crypto_1.createHash)('sha256')
                .update(lockFileData)
                .update(lockFilePath)
                .update(ngccConfigData)
                .update(tsconfigData)
                .update(relativeTsconfigPath)
                .digest('hex');
            // The hash is used directly in the file name to mitigate potential read/write race
            // conditions as well as to only require a file existence check
            runHashFilePath = path.join(runHashBasePath, runHash + '.lock');
            // If the run hash lock file exists, then ngcc was already run against this project state
            if ((0, fs_1.existsSync)(runHashFilePath)) {
                skipProcessing = true;
            }
        }
        catch (_b) {
            // Any error means an ngcc execution is needed
        }
        if (skipProcessing) {
            return;
        }
        const timeLabel = 'NgccProcessor.process';
        (0, benchmark_1.time)(timeLabel);
        // We spawn instead of using the API because:
        // - NGCC Async uses clustering which is problematic when used via the API which means
        // that we cannot setup multiple cluster masters with different options.
        // - We will not be able to have concurrent builds otherwise Ex: App-Shell,
        // as NGCC will create a lock file for both builds and it will cause builds to fails.
        const { status, error } = (0, child_process_1.spawnSync)(process.execPath, [
            this.compilerNgcc.ngccMainFilePath,
            '--source' /** basePath */,
            this._nodeModulesDirectory,
            '--properties' /** propertiesToConsider */,
            ...this.propertiesToConsider,
            '--first-only' /** compileAllFormats */,
            '--create-ivy-entry-points' /** createNewEntryPointFormats */,
            '--async',
            '--tsconfig' /** tsConfigPath */,
            this.tsConfigPath,
            '--use-program-dependencies',
        ], {
            stdio: ['inherit', process.stderr, process.stderr],
        });
        if (status !== 0) {
            const errorMessage = (error === null || error === void 0 ? void 0 : error.message) || '';
            throw new Error(errorMessage + `NGCC failed${errorMessage ? ', see above' : ''}.`);
        }
        (0, benchmark_1.timeEnd)(timeLabel);
        // ngcc was successful so if a run hash was generated, write it for next time
        if (runHashFilePath) {
            try {
                if (!(0, fs_1.existsSync)(runHashBasePath)) {
                    (0, fs_1.mkdirSync)(runHashBasePath, { recursive: true });
                }
                (0, fs_1.writeFileSync)(runHashFilePath, '');
            }
            catch (_c) {
                // Errors are non-fatal
            }
        }
    }
    /** Process a module and it's depedencies. */
    processModule(moduleName, resolvedModule) {
        var _a, _b;
        const resolvedFileName = resolvedModule.resolvedFileName;
        if (!resolvedFileName ||
            moduleName.startsWith('.') ||
            this._processedModules.has(resolvedFileName)) {
            // Skip when module is unknown, relative or NGCC compiler is not found or already processed.
            return;
        }
        const packageJsonPath = this.tryResolvePackage(moduleName, resolvedFileName);
        // If the package.json is read only we should skip calling NGCC.
        // With Bazel when running under sandbox the filesystem is read-only.
        if (!packageJsonPath || isReadOnlyFile(packageJsonPath)) {
            // add it to processed so the second time round we skip this.
            this._processedModules.add(resolvedFileName);
            return;
        }
        const timeLabel = `NgccProcessor.processModule.ngcc.process+${moduleName}`;
        (0, benchmark_1.time)(timeLabel);
        this.compilerNgcc.process({
            basePath: this._nodeModulesDirectory,
            targetEntryPointPath: path.dirname(packageJsonPath),
            propertiesToConsider: this.propertiesToConsider,
            compileAllFormats: false,
            createNewEntryPointFormats: true,
            logger: this._logger,
            tsConfigPath: this.tsConfigPath,
        });
        (0, benchmark_1.timeEnd)(timeLabel);
        // Purge this file from cache, since NGCC add new mainFields. Ex: module_ivy_ngcc
        // which are unknown in the cached file.
        (_b = (_a = this.inputFileSystem).purge) === null || _b === void 0 ? void 0 : _b.call(_a, packageJsonPath);
        this._processedModules.add(resolvedFileName);
    }
    invalidate(fileName) {
        this._processedModules.delete(fileName);
    }
    /**
     * Try resolve a package.json file from the resolved .d.ts file.
     */
    tryResolvePackage(moduleName, resolvedFileName) {
        try {
            const resolvedPath = this.resolver.resolveSync({}, resolvedFileName, `${moduleName}/package.json`);
            return resolvedPath || undefined;
        }
        catch (_a) {
            // Ex: @angular/compiler/src/i18n/i18n_ast/package.json
            // or local libraries which don't reside in node_modules
            const packageJsonPath = path.resolve(resolvedFileName, '../package.json');
            return (0, fs_1.existsSync)(packageJsonPath) ? packageJsonPath : undefined;
        }
    }
    findNodeModulesDirectory(startPoint) {
        let current = startPoint;
        while (path.dirname(current) !== current) {
            const nodePath = path.join(current, 'node_modules');
            if ((0, fs_1.existsSync)(nodePath)) {
                return nodePath;
            }
            current = path.dirname(current);
        }
        throw new Error(`Cannot locate the 'node_modules' directory.`);
    }
    findPackageManagerLockFile(projectBasePath) {
        for (const lockFile of ['yarn.lock', 'pnpm-lock.yaml', 'package-lock.json']) {
            const lockFilePath = path.join(projectBasePath, lockFile);
            try {
                return {
                    lockFilePath,
                    lockFileData: (0, fs_1.readFileSync)(lockFilePath),
                };
            }
            catch (_a) { }
        }
        throw new Error('Cannot locate a package manager lock file.');
    }
}
exports.NgccProcessor = NgccProcessor;
class NgccLogger {
    constructor(compilationWarnings, compilationErrors, level) {
        this.compilationWarnings = compilationWarnings;
        this.compilationErrors = compilationErrors;
        this.level = level;
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    debug() { }
    info(...args) {
        // Log to stderr because it's a progress-like info message.
        process.stderr.write(`\n${args.join(' ')}\n`);
    }
    warn(...args) {
        this.compilationWarnings.push(args.join(' '));
    }
    error(...args) {
        this.compilationErrors.push(new Error(args.join(' ')));
    }
}
function isReadOnlyFile(fileName) {
    try {
        (0, fs_1.accessSync)(fileName, fs_1.constants.W_OK);
        return false;
    }
    catch (_a) {
        return true;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmdjY19wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL25nY2NfcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsaURBQTBDO0FBQzFDLG1DQUFvQztBQUNwQywyQkFBK0Y7QUFDL0YsMkNBQTZCO0FBRzdCLDJDQUE0QztBQU01QywyRUFBMkU7QUFDM0Usd0ZBQXdGO0FBRXhGLDBCQUEwQjtBQUMxQixnRkFBZ0Y7QUFDaEYsaUVBQWlFO0FBQ2pFLGlEQUFpRDtBQUVqRCxnRkFBZ0Y7QUFFaEYsTUFBYSxhQUFhO0lBS3hCLFlBQ21CLFlBQXlELEVBQ3pELG9CQUE4QixFQUM5QixtQkFBdUMsRUFDdkMsaUJBQXFDLEVBQ3JDLFFBQWdCLEVBQ2hCLFlBQW9CLEVBQ3BCLGVBQWdDLEVBQ2hDLFFBQTZCO1FBUDdCLGlCQUFZLEdBQVosWUFBWSxDQUE2QztRQUN6RCx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQVU7UUFDOUIsd0JBQW1CLEdBQW5CLG1CQUFtQixDQUFvQjtRQUN2QyxzQkFBaUIsR0FBakIsaUJBQWlCLENBQW9CO1FBQ3JDLGFBQVEsR0FBUixRQUFRLENBQVE7UUFDaEIsaUJBQVksR0FBWixZQUFZLENBQVE7UUFDcEIsb0JBQWUsR0FBZixlQUFlLENBQWlCO1FBQ2hDLGFBQVEsR0FBUixRQUFRLENBQXFCO1FBWnhDLHNCQUFpQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFjNUMsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFVBQVUsQ0FDM0IsSUFBSSxDQUFDLG1CQUFtQixFQUN4QixJQUFJLENBQUMsaUJBQWlCLEVBQ3RCLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUMzQixDQUFDO1FBQ0YsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElB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Q2I7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9nTGV2ZWwsIExvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJztcbmltcG9ydCB7IHNwYXduU3luYyB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBhY2Nlc3NTeW5jLCBjb25zdGFudHMsIGV4aXN0c1N5bmMsIG1rZGlyU3luYywgcmVhZEZpbGVTeW5jLCB3cml0ZUZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb21waWxlciB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgdGltZSwgdGltZUVuZCB9IGZyb20gJy4vYmVuY2htYXJrJztcbmltcG9ydCB7IElucHV0RmlsZVN5c3RlbSB9IGZyb20gJy4vaXZ5L3N5c3RlbSc7XG5cbi8vIEV4dHJhY3QgUmVzb2x2ZXIgdHlwZSBmcm9tIFdlYnBhY2sgdHlwZXMgc2luY2UgaXQgaXMgbm90IGRpcmVjdGx5IGV4cG9ydGVkXG50eXBlIFJlc29sdmVyV2l0aE9wdGlvbnMgPSBSZXR1cm5UeXBlPENvbXBpbGVyWydyZXNvbHZlckZhY3RvcnknXVsnZ2V0J10+O1xuXG4vLyBXZSBjYW5ub3QgY3JlYXRlIGEgcGx1Z2luIGZvciB0aGlzLCBiZWNhdXNlIE5HVFNDIHJlcXVpcmVzIGFkZGl0aW9uIHR5cGVcbi8vIGluZm9ybWF0aW9uIHdoaWNoIG5nY2MgY3JlYXRlcyB3aGVuIHByb2Nlc3NpbmcgYSBwYWNrYWdlIHdoaWNoIHdhcyBjb21waWxlZCB3aXRoIE5HQy5cblxuLy8gRXhhbXBsZSBvZiBzdWNoIGVycm9yczpcbi8vIEVSUk9SIGluIG5vZGVfbW9kdWxlcy9AYW5ndWxhci9wbGF0Zm9ybS1icm93c2VyL3BsYXRmb3JtLWJyb3dzZXIuZC50cyg0MiwyMik6XG4vLyBlcnJvciBUUy05OTYwMDI6IEFwcGVhcnMgaW4gdGhlIE5nTW9kdWxlLmltcG9ydHMgb2YgQXBwTW9kdWxlLFxuLy8gYnV0IGNvdWxkIG5vdCBiZSByZXNvbHZlZCB0byBhbiBOZ01vZHVsZSBjbGFzc1xuXG4vLyBXZSBub3cgdHJhbnNmb3JtIGEgcGFja2FnZSBhbmQgaXQncyB0eXBpbmdzIHdoZW4gTkdUU0MgaXMgcmVzb2x2aW5nIGEgbW9kdWxlLlxuXG5leHBvcnQgY2xhc3MgTmdjY1Byb2Nlc3NvciB7XG4gIHByaXZhdGUgX3Byb2Nlc3NlZE1vZHVsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBfbG9nZ2VyOiBOZ2NjTG9nZ2VyO1xuICBwcml2YXRlIF9ub2RlTW9kdWxlc0RpcmVjdG9yeTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGlsZXJOZ2NjOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcHJvcGVydGllc1RvQ29uc2lkZXI6IHN0cmluZ1tdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGlsYXRpb25XYXJuaW5nczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGlsYXRpb25FcnJvcnM6IChFcnJvciB8IHN0cmluZylbXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGJhc2VQYXRoOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSB0c0NvbmZpZ1BhdGg6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGlucHV0RmlsZVN5c3RlbTogSW5wdXRGaWxlU3lzdGVtLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVzb2x2ZXI6IFJlc29sdmVyV2l0aE9wdGlvbnMsXG4gICkge1xuICAgIHRoaXMuX2xvZ2dlciA9IG5ldyBOZ2NjTG9nZ2VyKFxuICAgICAgdGhpcy5jb21waWxhdGlvbldhcm5pbmdzLFxuICAgICAgdGhpcy5jb21waWxhdGlvbkVycm9ycyxcbiAgICAgIGNvbXBpbGVyTmdjYy5Mb2dMZXZlbC5pbmZvLFxuICAgICk7XG4gICAgdGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnkgPSB0aGlzLmZpbmROb2RlTW9kdWxlc0RpcmVjdG9yeSh0aGlzLmJhc2VQYXRoKTtcbiAgfVxuXG4gIC8qKiBQcm9jZXNzIHRoZSBlbnRpcmUgbm9kZSBtb2R1bGVzIHRyZWUuICovXG4gIHByb2Nlc3MoKSB7XG4gICAgLy8gVW5kZXIgQmF6ZWwgd2hlbiBydW5uaW5nIGluIHNhbmRib3ggbW9kZSBwYXJ0cyBvZiB0aGUgZmlsZXN5c3RlbSBpcyByZWFkLW9ubHkuXG4gICAgaWYgKHByb2Nlc3MuZW52LkJBWkVMX1RBUkdFVCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFNraXAgaWYgbm9kZV9tb2R1bGVzIGFyZSByZWFkLW9ubHlcbiAgICBjb25zdCBjb3JlUGFja2FnZSA9IHRoaXMudHJ5UmVzb2x2ZVBhY2thZ2UoJ0Bhbmd1bGFyL2NvcmUnLCB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSk7XG4gICAgaWYgKGNvcmVQYWNrYWdlICYmIGlzUmVhZE9ubHlGaWxlKGNvcmVQYWNrYWdlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFBlcmZvcm0gYSBuZ2NjIHJ1biBjaGVjayB0byBkZXRlcm1pbmUgaWYgYW4gaW5pdGlhbCBleGVjdXRpb24gaXMgcmVxdWlyZWQuXG4gICAgLy8gSWYgYSBydW4gaGFzaCBmaWxlIGV4aXN0cyB0aGF0IG1hdGNoZXMgdGhlIGN1cnJlbnQgcGFja2FnZSBtYW5hZ2VyIGxvY2sgZmlsZSBhbmQgdGhlXG4gICAgLy8gcHJvamVjdCdzIHRzY29uZmlnLCB0aGVuIGFuIGluaXRpYWwgbmdjYyBydW4gaGFzIGFscmVhZHkgYmVlbiBwZXJmb3JtZWQuXG4gICAgbGV0IHNraXBQcm9jZXNzaW5nID0gZmFsc2U7XG4gICAgbGV0IHJ1bkhhc2hGaWxlUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IHJ1bkhhc2hCYXNlUGF0aCA9IHBhdGguam9pbih0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSwgJy5jbGktbmdjYycpO1xuICAgIGNvbnN0IHByb2plY3RCYXNlUGF0aCA9IHBhdGguam9pbih0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSwgJy4uJyk7XG4gICAgdHJ5IHtcbiAgICAgIGxldCBuZ2NjQ29uZmlnRGF0YTtcbiAgICAgIHRyeSB7XG4gICAgICAgIG5nY2NDb25maWdEYXRhID0gcmVhZEZpbGVTeW5jKHBhdGguam9pbihwcm9qZWN0QmFzZVBhdGgsICduZ2NjLmNvbmZpZy5qcycpKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBuZ2NjQ29uZmlnRGF0YSA9ICcnO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZWxhdGl2ZVRzY29uZmlnUGF0aCA9IHBhdGgucmVsYXRpdmUocHJvamVjdEJhc2VQYXRoLCB0aGlzLnRzQ29uZmlnUGF0aCk7XG4gICAgICBjb25zdCB0c2NvbmZpZ0RhdGEgPSByZWFkRmlsZVN5bmModGhpcy50c0NvbmZpZ1BhdGgpO1xuICAgICAgY29uc3QgeyBsb2NrRmlsZURhdGEsIGxvY2tGaWxlUGF0aCB9ID0gdGhpcy5maW5kUGFja2FnZU1hbmFnZXJMb2NrRmlsZShwcm9qZWN0QmFzZVBhdGgpO1xuXG4gICAgICAvLyBHZW5lcmF0ZSBhIGhhc2ggdGhhdCByZXByZXNlbnRzIHRoZSBzdGF0ZSBvZiB0aGUgcGFja2FnZSBsb2NrIGZpbGUgYW5kIHVzZWQgdHNjb25maWdcbiAgICAgIGNvbnN0IHJ1bkhhc2ggPSBjcmVhdGVIYXNoKCdzaGEyNTYnKVxuICAgICAgICAudXBkYXRlKGxvY2tGaWxlRGF0YSlcbiAgICAgICAgLnVwZGF0ZShsb2NrRmlsZVBhdGgpXG4gICAgICAgIC51cGRhdGUobmdjY0NvbmZpZ0RhdGEpXG4gICAgICAgIC51cGRhdGUodHNjb25maWdEYXRhKVxuICAgICAgICAudXBkYXRlKHJlbGF0aXZlVHNjb25maWdQYXRoKVxuICAgICAgICAuZGlnZXN0KCdoZXgnKTtcblxuICAgICAgLy8gVGhlIGhhc2ggaXMgdXNlZCBkaXJlY3RseSBpbiB0aGUgZmlsZSBuYW1lIHRvIG1pdGlnYXRlIHBvdGVudGlhbCByZWFkL3dyaXRlIHJhY2VcbiAgICAgIC8vIGNvbmRpdGlvbnMgYXMgd2VsbCBhcyB0byBvbmx5IHJlcXVpcmUgYSBmaWxlIGV4aXN0ZW5jZSBjaGVja1xuICAgICAgcnVuSGFzaEZpbGVQYXRoID0gcGF0aC5qb2luKHJ1bkhhc2hCYXNlUGF0aCwgcnVuSGFzaCArICcubG9jaycpO1xuXG4gICAgICAvLyBJZiB0aGUgcnVuIGhhc2ggbG9jayBmaWxlIGV4aXN0cywgdGhlbiBuZ2NjIHdhcyBhbHJlYWR5IHJ1biBhZ2FpbnN0IHRoaXMgcHJvamVjdCBzdGF0ZVxuICAgICAgaWYgKGV4aXN0c1N5bmMocnVuSGFzaEZpbGVQYXRoKSkge1xuICAgICAgICBza2lwUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBbnkgZXJyb3IgbWVhbnMgYW4gbmdjYyBleGVjdXRpb24gaXMgbmVlZGVkXG4gICAgfVxuXG4gICAgaWYgKHNraXBQcm9jZXNzaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZUxhYmVsID0gJ05nY2NQcm9jZXNzb3IucHJvY2Vzcyc7XG4gICAgdGltZSh0aW1lTGFiZWwpO1xuXG4gICAgLy8gV2Ugc3Bhd24gaW5zdGVhZCBvZiB1c2luZyB0aGUgQVBJIGJlY2F1c2U6XG4gICAgLy8gLSBOR0NDIEFzeW5jIHVzZXMgY2x1c3RlcmluZyB3aGljaCBpcyBwcm9ibGVtYXRpYyB3aGVuIHVzZWQgdmlhIHRoZSBBUEkgd2hpY2ggbWVhbnNcbiAgICAvLyB0aGF0IHdlIGNhbm5vdCBzZXR1cCBtdWx0aXBsZSBjbHVzdGVyIG1hc3RlcnMgd2l0aCBkaWZmZXJlbnQgb3B0aW9ucy5cbiAgICAvLyAtIFdlIHdpbGwgbm90IGJlIGFibGUgdG8gaGF2ZSBjb25jdXJyZW50IGJ1aWxkcyBvdGhlcndpc2UgRXg6IEFwcC1TaGVsbCxcbiAgICAvLyBhcyBOR0NDIHdpbGwgY3JlYXRlIGEgbG9jayBmaWxlIGZvciBib3RoIGJ1aWxkcyBhbmQgaXQgd2lsbCBjYXVzZSBidWlsZHMgdG8gZmFpbHMuXG4gICAgY29uc3QgeyBzdGF0dXMsIGVycm9yIH0gPSBzcGF3blN5bmMoXG4gICAgICBwcm9jZXNzLmV4ZWNQYXRoLFxuICAgICAgW1xuICAgICAgICB0aGlzLmNvbXBpbGVyTmdjYy5uZ2NjTWFpbkZpbGVQYXRoLFxuICAgICAgICAnLS1zb3VyY2UnIC8qKiBiYXNlUGF0aCAqLyxcbiAgICAgICAgdGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnksXG4gICAgICAgICctLXByb3BlcnRpZXMnIC8qKiBwcm9wZXJ0aWVzVG9Db25zaWRlciAqLyxcbiAgICAgICAgLi4udGhpcy5wcm9wZXJ0aWVzVG9Db25zaWRlcixcbiAgICAgICAgJy0tZmlyc3Qtb25seScgLyoqIGNvbXBpbGVBbGxGb3JtYXRzICovLFxuICAgICAgICAnLS1jcmVhdGUtaXZ5LWVudHJ5LXBvaW50cycgLyoqIGNyZWF0ZU5ld0VudHJ5UG9pbnRGb3JtYXRzICovLFxuICAgICAgICAnLS1hc3luYycsXG4gICAgICAgICctLXRzY29uZmlnJyAvKiogdHNDb25maWdQYXRoICovLFxuICAgICAgICB0aGlzLnRzQ29uZmlnUGF0aCxcbiAgICAgICAgJy0tdXNlLXByb2dyYW0tZGVwZW5kZW5jaWVzJyxcbiAgICAgIF0sXG4gICAgICB7XG4gICAgICAgIHN0ZGlvOiBbJ2luaGVyaXQnLCBwcm9jZXNzLnN0ZGVyciwgcHJvY2Vzcy5zdGRlcnJdLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgaWYgKHN0YXR1cyAhPT0gMCkge1xuICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3I/Lm1lc3NhZ2UgfHwgJyc7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlICsgYE5HQ0MgZmFpbGVkJHtlcnJvck1lc3NhZ2UgPyAnLCBzZWUgYWJvdmUnIDogJyd9LmApO1xuICAgIH1cblxuICAgIHRpbWVFbmQodGltZUxhYmVsKTtcblxuICAgIC8vIG5nY2Mgd2FzIHN1Y2Nlc3NmdWwgc28gaWYgYSBydW4gaGFzaCB3YXMgZ2VuZXJhdGVkLCB3cml0ZSBpdCBmb3IgbmV4dCB0aW1lXG4gICAgaWYgKHJ1bkhhc2hGaWxlUGF0aCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHJ1bkhhc2hCYXNlUGF0aCkpIHtcbiAgICAgICAgICBta2RpclN5bmMocnVuSGFzaEJhc2VQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZUZpbGVTeW5jKHJ1bkhhc2hGaWxlUGF0aCwgJycpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEVycm9ycyBhcmUgbm9uLWZhdGFsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqIFByb2Nlc3MgYSBtb2R1bGUgYW5kIGl0J3MgZGVwZWRlbmNpZXMuICovXG4gIHByb2Nlc3NNb2R1bGUoXG4gICAgbW9kdWxlTmFtZTogc3RyaW5nLFxuICAgIHJlc29sdmVkTW9kdWxlOiB0cy5SZXNvbHZlZE1vZHVsZSB8IHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSxcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgcmVzb2x2ZWRGaWxlTmFtZSA9IHJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgaWYgKFxuICAgICAgIXJlc29sdmVkRmlsZU5hbWUgfHxcbiAgICAgIG1vZHVsZU5hbWUuc3RhcnRzV2l0aCgnLicpIHx8XG4gICAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmhhcyhyZXNvbHZlZEZpbGVOYW1lKVxuICAgICkge1xuICAgICAgLy8gU2tpcCB3aGVuIG1vZHVsZSBpcyB1bmtub3duLCByZWxhdGl2ZSBvciBOR0NDIGNvbXBpbGVyIGlzIG5vdCBmb3VuZCBvciBhbHJlYWR5IHByb2Nlc3NlZC5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSB0aGlzLnRyeVJlc29sdmVQYWNrYWdlKG1vZHVsZU5hbWUsIHJlc29sdmVkRmlsZU5hbWUpO1xuICAgIC8vIElmIHRoZSBwYWNrYWdlLmpzb24gaXMgcmVhZCBvbmx5IHdlIHNob3VsZCBza2lwIGNhbGxpbmcgTkdDQy5cbiAgICAvLyBXaXRoIEJhemVsIHdoZW4gcnVubmluZyB1bmRlciBzYW5kYm94IHRoZSBmaWxlc3lzdGVtIGlzIHJlYWQtb25seS5cbiAgICBpZiAoIXBhY2thZ2VKc29uUGF0aCB8fCBpc1JlYWRPbmx5RmlsZShwYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAvLyBhZGQgaXQgdG8gcHJvY2Vzc2VkIHNvIHRoZSBzZWNvbmQgdGltZSByb3VuZCB3ZSBza2lwIHRoaXMuXG4gICAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmFkZChyZXNvbHZlZEZpbGVOYW1lKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBOZ2NjUHJvY2Vzc29yLnByb2Nlc3NNb2R1bGUubmdjYy5wcm9jZXNzKyR7bW9kdWxlTmFtZX1gO1xuICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICB0aGlzLmNvbXBpbGVyTmdjYy5wcm9jZXNzKHtcbiAgICAgIGJhc2VQYXRoOiB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSxcbiAgICAgIHRhcmdldEVudHJ5UG9pbnRQYXRoOiBwYXRoLmRpcm5hbWUocGFja2FnZUpzb25QYXRoKSxcbiAgICAgIHByb3BlcnRpZXNUb0NvbnNpZGVyOiB0aGlzLnByb3BlcnRpZXNUb0NvbnNpZGVyLFxuICAgICAgY29tcGlsZUFsbEZvcm1hdHM6IGZhbHNlLFxuICAgICAgY3JlYXRlTmV3RW50cnlQb2ludEZvcm1hdHM6IHRydWUsXG4gICAgICBsb2dnZXI6IHRoaXMuX2xvZ2dlcixcbiAgICAgIHRzQ29uZmlnUGF0aDogdGhpcy50c0NvbmZpZ1BhdGgsXG4gICAgfSk7XG4gICAgdGltZUVuZCh0aW1lTGFiZWwpO1xuXG4gICAgLy8gUHVyZ2UgdGhpcyBmaWxlIGZyb20gY2FjaGUsIHNpbmNlIE5HQ0MgYWRkIG5ldyBtYWluRmllbGRzLiBFeDogbW9kdWxlX2l2eV9uZ2NjXG4gICAgLy8gd2hpY2ggYXJlIHVua25vd24gaW4gdGhlIGNhY2hlZCBmaWxlLlxuICAgIHRoaXMuaW5wdXRGaWxlU3lzdGVtLnB1cmdlPy4ocGFja2FnZUpzb25QYXRoKTtcblxuICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuYWRkKHJlc29sdmVkRmlsZU5hbWUpO1xuICB9XG5cbiAgaW52YWxpZGF0ZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgdGhpcy5fcHJvY2Vzc2VkTW9kdWxlcy5kZWxldGUoZmlsZU5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRyeSByZXNvbHZlIGEgcGFja2FnZS5qc29uIGZpbGUgZnJvbSB0aGUgcmVzb2x2ZWQgLmQudHMgZmlsZS5cbiAgICovXG4gIHByaXZhdGUgdHJ5UmVzb2x2ZVBhY2thZ2UobW9kdWxlTmFtZTogc3RyaW5nLCByZXNvbHZlZEZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNvbHZlZFBhdGggPSB0aGlzLnJlc29sdmVyLnJlc29sdmVTeW5jKFxuICAgICAgICB7fSxcbiAgICAgICAgcmVzb2x2ZWRGaWxlTmFtZSxcbiAgICAgICAgYCR7bW9kdWxlTmFtZX0vcGFja2FnZS5qc29uYCxcbiAgICAgICk7XG5cbiAgICAgIHJldHVybiByZXNvbHZlZFBhdGggfHwgdW5kZWZpbmVkO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gRXg6IEBhbmd1bGFyL2NvbXBpbGVyL3NyYy9pMThuL2kxOG5fYXN0L3BhY2thZ2UuanNvblxuICAgICAgLy8gb3IgbG9jYWwgbGlicmFyaWVzIHdoaWNoIGRvbid0IHJlc2lkZSBpbiBub2RlX21vZHVsZXNcbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGgucmVzb2x2ZShyZXNvbHZlZEZpbGVOYW1lLCAnLi4vcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIHJldHVybiBleGlzdHNTeW5jKHBhY2thZ2VKc29uUGF0aCkgPyBwYWNrYWdlSnNvblBhdGggOiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTm9kZU1vZHVsZXNEaXJlY3Rvcnkoc3RhcnRQb2ludDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBsZXQgY3VycmVudCA9IHN0YXJ0UG9pbnQ7XG4gICAgd2hpbGUgKHBhdGguZGlybmFtZShjdXJyZW50KSAhPT0gY3VycmVudCkge1xuICAgICAgY29uc3Qgbm9kZVBhdGggPSBwYXRoLmpvaW4oY3VycmVudCwgJ25vZGVfbW9kdWxlcycpO1xuICAgICAgaWYgKGV4aXN0c1N5bmMobm9kZVBhdGgpKSB7XG4gICAgICAgIHJldHVybiBub2RlUGF0aDtcbiAgICAgIH1cblxuICAgICAgY3VycmVudCA9IHBhdGguZGlybmFtZShjdXJyZW50KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBsb2NhdGUgdGhlICdub2RlX21vZHVsZXMnIGRpcmVjdG9yeS5gKTtcbiAgfVxuXG4gIHByaXZhdGUgZmluZFBhY2thZ2VNYW5hZ2VyTG9ja0ZpbGUocHJvamVjdEJhc2VQYXRoOiBzdHJpbmcpOiB7XG4gICAgbG9ja0ZpbGVQYXRoOiBzdHJpbmc7XG4gICAgbG9ja0ZpbGVEYXRhOiBCdWZmZXI7XG4gIH0ge1xuICAgIGZvciAoY29uc3QgbG9ja0ZpbGUgb2YgWyd5YXJuLmxvY2snLCAncG5wbS1sb2NrLnlhbWwnLCAncGFja2FnZS1sb2NrLmpzb24nXSkge1xuICAgICAgY29uc3QgbG9ja0ZpbGVQYXRoID0gcGF0aC5qb2luKHByb2plY3RCYXNlUGF0aCwgbG9ja0ZpbGUpO1xuXG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGxvY2tGaWxlUGF0aCxcbiAgICAgICAgICBsb2NrRmlsZURhdGE6IHJlYWRGaWxlU3luYyhsb2NrRmlsZVBhdGgpLFxuICAgICAgICB9O1xuICAgICAgfSBjYXRjaCB7fVxuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGxvY2F0ZSBhIHBhY2thZ2UgbWFuYWdlciBsb2NrIGZpbGUuJyk7XG4gIH1cbn1cblxuY2xhc3MgTmdjY0xvZ2dlciBpbXBsZW1lbnRzIExvZ2dlciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGlsYXRpb25XYXJuaW5nczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29tcGlsYXRpb25FcnJvcnM6IChFcnJvciB8IHN0cmluZylbXSxcbiAgICBwdWJsaWMgbGV2ZWw6IExvZ0xldmVsLFxuICApIHt9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1lbXB0eS1mdW5jdGlvblxuICBkZWJ1ZygpIHt9XG5cbiAgaW5mbyguLi5hcmdzOiBzdHJpbmdbXSkge1xuICAgIC8vIExvZyB0byBzdGRlcnIgYmVjYXVzZSBpdCdzIGEgcHJvZ3Jlc3MtbGlrZSBpbmZvIG1lc3NhZ2UuXG4gICAgcHJvY2Vzcy5zdGRlcnIud3JpdGUoYFxcbiR7YXJncy5qb2luKCcgJyl9XFxuYCk7XG4gIH1cblxuICB3YXJuKC4uLmFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgdGhpcy5jb21waWxhdGlvbldhcm5pbmdzLnB1c2goYXJncy5qb2luKCcgJykpO1xuICB9XG5cbiAgZXJyb3IoLi4uYXJnczogc3RyaW5nW10pIHtcbiAgICB0aGlzLmNvbXBpbGF0aW9uRXJyb3JzLnB1c2gobmV3IEVycm9yKGFyZ3Muam9pbignICcpKSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gaXNSZWFkT25seUZpbGUoZmlsZU5hbWU6IHN0cmluZyk6IGJvb2xlYW4ge1xuICB0cnkge1xuICAgIGFjY2Vzc1N5bmMoZmlsZU5hbWUsIGNvbnN0YW50cy5XX09LKTtcblxuICAgIHJldHVybiBmYWxzZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cbiJdfQ==