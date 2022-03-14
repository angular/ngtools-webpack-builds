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
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmdjY19wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL25nY2NfcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHSCxpREFBMEM7QUFDMUMsbUNBQW9DO0FBQ3BDLDJCQUErRjtBQUMvRiwyQ0FBNkI7QUFHN0IsMkNBQTRDO0FBTTVDLDJFQUEyRTtBQUMzRSx3RkFBd0Y7QUFFeEYsMEJBQTBCO0FBQzFCLGdGQUFnRjtBQUNoRixpRUFBaUU7QUFDakUsaURBQWlEO0FBRWpELGdGQUFnRjtBQUVoRixNQUFhLGFBQWE7SUFLeEIsWUFDbUIsWUFBeUQsRUFDekQsb0JBQThCLEVBQzlCLG1CQUF1QyxFQUN2QyxpQkFBcUMsRUFDckMsUUFBZ0IsRUFDaEIsWUFBb0IsRUFDcEIsZUFBZ0MsRUFDaEMsUUFBNkI7UUFQN0IsaUJBQVksR0FBWixZQUFZLENBQTZDO1FBQ3pELHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBVTtRQUM5Qix3QkFBbUIsR0FBbkIsbUJBQW1CLENBQW9CO1FBQ3ZDLHNCQUFpQixHQUFqQixpQkFBaUIsQ0FBb0I7UUFDckMsYUFBUSxHQUFSLFFBQVEsQ0FBUTtRQUNoQixpQkFBWSxHQUFaLFlBQVksQ0FBUTtRQUNwQixvQkFBZSxHQUFmLGVBQWUsQ0FBaUI7UUFDaEMsYUFBUSxHQUFSLFFBQVEsQ0FBcUI7UUFaeEMsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztRQWM1QyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksVUFBVSxDQUMzQixJQUFJLENBQUMsbUJBQW1CLEVBQ3hCLElBQUksQ0FBQyxpQkFBaUIsRUFDdEIsWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQzNCLENBQUM7UUFDRixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxD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QUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dMZXZlbCwgTG9nZ2VyIH0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXItY2xpL25nY2MnO1xuaW1wb3J0IHsgc3Bhd25TeW5jIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IGFjY2Vzc1N5bmMsIGNvbnN0YW50cywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgdHlwZSB7IENvbXBpbGVyIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgSW5wdXRGaWxlU3lzdGVtIH0gZnJvbSAnLi9pdnkvc3lzdGVtJztcblxuLy8gRXh0cmFjdCBSZXNvbHZlciB0eXBlIGZyb20gV2VicGFjayB0eXBlcyBzaW5jZSBpdCBpcyBub3QgZGlyZWN0bHkgZXhwb3J0ZWRcbnR5cGUgUmVzb2x2ZXJXaXRoT3B0aW9ucyA9IFJldHVyblR5cGU8Q29tcGlsZXJbJ3Jlc29sdmVyRmFjdG9yeSddWydnZXQnXT47XG5cbi8vIFdlIGNhbm5vdCBjcmVhdGUgYSBwbHVnaW4gZm9yIHRoaXMsIGJlY2F1c2UgTkdUU0MgcmVxdWlyZXMgYWRkaXRpb24gdHlwZVxuLy8gaW5mb3JtYXRpb24gd2hpY2ggbmdjYyBjcmVhdGVzIHdoZW4gcHJvY2Vzc2luZyBhIHBhY2thZ2Ugd2hpY2ggd2FzIGNvbXBpbGVkIHdpdGggTkdDLlxuXG4vLyBFeGFtcGxlIG9mIHN1Y2ggZXJyb3JzOlxuLy8gRVJST1IgaW4gbm9kZV9tb2R1bGVzL0Bhbmd1bGFyL3BsYXRmb3JtLWJyb3dzZXIvcGxhdGZvcm0tYnJvd3Nlci5kLnRzKDQyLDIyKTpcbi8vIGVycm9yIFRTLTk5NjAwMjogQXBwZWFycyBpbiB0aGUgTmdNb2R1bGUuaW1wb3J0cyBvZiBBcHBNb2R1bGUsXG4vLyBidXQgY291bGQgbm90IGJlIHJlc29sdmVkIHRvIGFuIE5nTW9kdWxlIGNsYXNzXG5cbi8vIFdlIG5vdyB0cmFuc2Zvcm0gYSBwYWNrYWdlIGFuZCBpdCdzIHR5cGluZ3Mgd2hlbiBOR1RTQyBpcyByZXNvbHZpbmcgYSBtb2R1bGUuXG5cbmV4cG9ydCBjbGFzcyBOZ2NjUHJvY2Vzc29yIHtcbiAgcHJpdmF0ZSBfcHJvY2Vzc2VkTW9kdWxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIF9sb2dnZXI6IE5nY2NMb2dnZXI7XG4gIHByaXZhdGUgX25vZGVNb2R1bGVzRGlyZWN0b3J5OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxlck5nY2M6IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyksXG4gICAgcHJpdmF0ZSByZWFkb25seSBwcm9wZXJ0aWVzVG9Db25zaWRlcjogc3RyaW5nW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbldhcm5pbmdzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbkVycm9yczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmFzZVBhdGg6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHRzQ29uZmlnUGF0aDogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgaW5wdXRGaWxlU3lzdGVtOiBJbnB1dEZpbGVTeXN0ZW0sXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvbHZlcjogUmVzb2x2ZXJXaXRoT3B0aW9ucyxcbiAgKSB7XG4gICAgdGhpcy5fbG9nZ2VyID0gbmV3IE5nY2NMb2dnZXIoXG4gICAgICB0aGlzLmNvbXBpbGF0aW9uV2FybmluZ3MsXG4gICAgICB0aGlzLmNvbXBpbGF0aW9uRXJyb3JzLFxuICAgICAgY29tcGlsZXJOZ2NjLkxvZ0xldmVsLmluZm8sXG4gICAgKTtcbiAgICB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSA9IHRoaXMuZmluZE5vZGVNb2R1bGVzRGlyZWN0b3J5KHRoaXMuYmFzZVBhdGgpO1xuICB9XG5cbiAgLyoqIFByb2Nlc3MgdGhlIGVudGlyZSBub2RlIG1vZHVsZXMgdHJlZS4gKi9cbiAgcHJvY2VzcygpIHtcbiAgICAvLyBVbmRlciBCYXplbCB3aGVuIHJ1bm5pbmcgaW4gc2FuZGJveCBtb2RlIHBhcnRzIG9mIHRoZSBmaWxlc3lzdGVtIGlzIHJlYWQtb25seS5cbiAgICBpZiAocHJvY2Vzcy5lbnYuQkFaRUxfVEFSR0VUKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gU2tpcCBpZiBub2RlX21vZHVsZXMgYXJlIHJlYWQtb25seVxuICAgIGNvbnN0IGNvcmVQYWNrYWdlID0gdGhpcy50cnlSZXNvbHZlUGFja2FnZSgnQGFuZ3VsYXIvY29yZScsIHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5KTtcbiAgICBpZiAoY29yZVBhY2thZ2UgJiYgaXNSZWFkT25seUZpbGUoY29yZVBhY2thZ2UpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBhIG5nY2MgcnVuIGNoZWNrIHRvIGRldGVybWluZSBpZiBhbiBpbml0aWFsIGV4ZWN1dGlvbiBpcyByZXF1aXJlZC5cbiAgICAvLyBJZiBhIHJ1biBoYXNoIGZpbGUgZXhpc3RzIHRoYXQgbWF0Y2hlcyB0aGUgY3VycmVudCBwYWNrYWdlIG1hbmFnZXIgbG9jayBmaWxlIGFuZCB0aGVcbiAgICAvLyBwcm9qZWN0J3MgdHNjb25maWcsIHRoZW4gYW4gaW5pdGlhbCBuZ2NjIHJ1biBoYXMgYWxyZWFkeSBiZWVuIHBlcmZvcm1lZC5cbiAgICBsZXQgc2tpcFByb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICBsZXQgcnVuSGFzaEZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgcnVuSGFzaEJhc2VQYXRoID0gcGF0aC5qb2luKHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LCAnLmNsaS1uZ2NjJyk7XG4gICAgY29uc3QgcHJvamVjdEJhc2VQYXRoID0gcGF0aC5qb2luKHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LCAnLi4nKTtcbiAgICB0cnkge1xuICAgICAgbGV0IG5nY2NDb25maWdEYXRhO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmdjY0NvbmZpZ0RhdGEgPSByZWFkRmlsZVN5bmMocGF0aC5qb2luKHByb2plY3RCYXNlUGF0aCwgJ25nY2MuY29uZmlnLmpzJykpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG5nY2NDb25maWdEYXRhID0gJyc7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0aXZlVHNjb25maWdQYXRoID0gcGF0aC5yZWxhdGl2ZShwcm9qZWN0QmFzZVBhdGgsIHRoaXMudHNDb25maWdQYXRoKTtcbiAgICAgIGNvbnN0IHRzY29uZmlnRGF0YSA9IHJlYWRGaWxlU3luYyh0aGlzLnRzQ29uZmlnUGF0aCk7XG4gICAgICBjb25zdCB7IGxvY2tGaWxlRGF0YSwgbG9ja0ZpbGVQYXRoIH0gPSB0aGlzLmZpbmRQYWNrYWdlTWFuYWdlckxvY2tGaWxlKHByb2plY3RCYXNlUGF0aCk7XG5cbiAgICAgIC8vIEdlbmVyYXRlIGEgaGFzaCB0aGF0IHJlcHJlc2VudHMgdGhlIHN0YXRlIG9mIHRoZSBwYWNrYWdlIGxvY2sgZmlsZSBhbmQgdXNlZCB0c2NvbmZpZ1xuICAgICAgY29uc3QgcnVuSGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgIC51cGRhdGUobG9ja0ZpbGVEYXRhKVxuICAgICAgICAudXBkYXRlKGxvY2tGaWxlUGF0aClcbiAgICAgICAgLnVwZGF0ZShuZ2NjQ29uZmlnRGF0YSlcbiAgICAgICAgLnVwZGF0ZSh0c2NvbmZpZ0RhdGEpXG4gICAgICAgIC51cGRhdGUocmVsYXRpdmVUc2NvbmZpZ1BhdGgpXG4gICAgICAgIC5kaWdlc3QoJ2hleCcpO1xuXG4gICAgICAvLyBUaGUgaGFzaCBpcyB1c2VkIGRpcmVjdGx5IGluIHRoZSBmaWxlIG5hbWUgdG8gbWl0aWdhdGUgcG90ZW50aWFsIHJlYWQvd3JpdGUgcmFjZVxuICAgICAgLy8gY29uZGl0aW9ucyBhcyB3ZWxsIGFzIHRvIG9ubHkgcmVxdWlyZSBhIGZpbGUgZXhpc3RlbmNlIGNoZWNrXG4gICAgICBydW5IYXNoRmlsZVBhdGggPSBwYXRoLmpvaW4ocnVuSGFzaEJhc2VQYXRoLCBydW5IYXNoICsgJy5sb2NrJyk7XG5cbiAgICAgIC8vIElmIHRoZSBydW4gaGFzaCBsb2NrIGZpbGUgZXhpc3RzLCB0aGVuIG5nY2Mgd2FzIGFscmVhZHkgcnVuIGFnYWluc3QgdGhpcyBwcm9qZWN0IHN0YXRlXG4gICAgICBpZiAoZXhpc3RzU3luYyhydW5IYXNoRmlsZVBhdGgpKSB7XG4gICAgICAgIHNraXBQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIEFueSBlcnJvciBtZWFucyBhbiBuZ2NjIGV4ZWN1dGlvbiBpcyBuZWVkZWRcbiAgICB9XG5cbiAgICBpZiAoc2tpcFByb2Nlc3NpbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0aW1lTGFiZWwgPSAnTmdjY1Byb2Nlc3Nvci5wcm9jZXNzJztcbiAgICB0aW1lKHRpbWVMYWJlbCk7XG5cbiAgICAvLyBXZSBzcGF3biBpbnN0ZWFkIG9mIHVzaW5nIHRoZSBBUEkgYmVjYXVzZTpcbiAgICAvLyAtIE5HQ0MgQXN5bmMgdXNlcyBjbHVzdGVyaW5nIHdoaWNoIGlzIHByb2JsZW1hdGljIHdoZW4gdXNlZCB2aWEgdGhlIEFQSSB3aGljaCBtZWFuc1xuICAgIC8vIHRoYXQgd2UgY2Fubm90IHNldHVwIG11bHRpcGxlIGNsdXN0ZXIgbWFzdGVycyB3aXRoIGRpZmZlcmVudCBvcHRpb25zLlxuICAgIC8vIC0gV2Ugd2lsbCBub3QgYmUgYWJsZSB0byBoYXZlIGNvbmN1cnJlbnQgYnVpbGRzIG90aGVyd2lzZSBFeDogQXBwLVNoZWxsLFxuICAgIC8vIGFzIE5HQ0Mgd2lsbCBjcmVhdGUgYSBsb2NrIGZpbGUgZm9yIGJvdGggYnVpbGRzIGFuZCBpdCB3aWxsIGNhdXNlIGJ1aWxkcyB0byBmYWlscy5cbiAgICBjb25zdCB7IHN0YXR1cywgZXJyb3IgfSA9IHNwYXduU3luYyhcbiAgICAgIHByb2Nlc3MuZXhlY1BhdGgsXG4gICAgICBbXG4gICAgICAgIHRoaXMuY29tcGlsZXJOZ2NjLm5nY2NNYWluRmlsZVBhdGgsXG4gICAgICAgICctLXNvdXJjZScgLyoqIGJhc2VQYXRoICovLFxuICAgICAgICB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSxcbiAgICAgICAgJy0tcHJvcGVydGllcycgLyoqIHByb3BlcnRpZXNUb0NvbnNpZGVyICovLFxuICAgICAgICAuLi50aGlzLnByb3BlcnRpZXNUb0NvbnNpZGVyLFxuICAgICAgICAnLS1maXJzdC1vbmx5JyAvKiogY29tcGlsZUFsbEZvcm1hdHMgKi8sXG4gICAgICAgICctLWNyZWF0ZS1pdnktZW50cnktcG9pbnRzJyAvKiogY3JlYXRlTmV3RW50cnlQb2ludEZvcm1hdHMgKi8sXG4gICAgICAgICctLWFzeW5jJyxcbiAgICAgICAgJy0tdHNjb25maWcnIC8qKiB0c0NvbmZpZ1BhdGggKi8sXG4gICAgICAgIHRoaXMudHNDb25maWdQYXRoLFxuICAgICAgICAnLS11c2UtcHJvZ3JhbS1kZXBlbmRlbmNpZXMnLFxuICAgICAgXSxcbiAgICAgIHtcbiAgICAgICAgc3RkaW86IFsnaW5oZXJpdCcsIHByb2Nlc3Muc3RkZXJyLCBwcm9jZXNzLnN0ZGVycl0sXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBpZiAoc3RhdHVzICE9PSAwKSB7XG4gICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvcj8ubWVzc2FnZSB8fCAnJztcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UgKyBgTkdDQyBmYWlsZWQke2Vycm9yTWVzc2FnZSA/ICcsIHNlZSBhYm92ZScgOiAnJ30uYCk7XG4gICAgfVxuXG4gICAgdGltZUVuZCh0aW1lTGFiZWwpO1xuXG4gICAgLy8gbmdjYyB3YXMgc3VjY2Vzc2Z1bCBzbyBpZiBhIHJ1biBoYXNoIHdhcyBnZW5lcmF0ZWQsIHdyaXRlIGl0IGZvciBuZXh0IHRpbWVcbiAgICBpZiAocnVuSGFzaEZpbGVQYXRoKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMocnVuSGFzaEJhc2VQYXRoKSkge1xuICAgICAgICAgIG1rZGlyU3luYyhydW5IYXNoQmFzZVBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG4gICAgICAgIHdyaXRlRmlsZVN5bmMocnVuSGFzaEZpbGVQYXRoLCAnJyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gRXJyb3JzIGFyZSBub24tZmF0YWxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogUHJvY2VzcyBhIG1vZHVsZSBhbmQgaXQncyBkZXBlZGVuY2llcy4gKi9cbiAgcHJvY2Vzc01vZHVsZShcbiAgICBtb2R1bGVOYW1lOiBzdHJpbmcsXG4gICAgcmVzb2x2ZWRNb2R1bGU6IHRzLlJlc29sdmVkTW9kdWxlIHwgdHMuUmVzb2x2ZWRUeXBlUmVmZXJlbmNlRGlyZWN0aXZlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoXG4gICAgICAhcmVzb2x2ZWRGaWxlTmFtZSB8fFxuICAgICAgbW9kdWxlTmFtZS5zdGFydHNXaXRoKCcuJykgfHxcbiAgICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuaGFzKHJlc29sdmVkRmlsZU5hbWUpXG4gICAgKSB7XG4gICAgICAvLyBTa2lwIHdoZW4gbW9kdWxlIGlzIHVua25vd24sIHJlbGF0aXZlIG9yIE5HQ0MgY29tcGlsZXIgaXMgbm90IGZvdW5kIG9yIGFscmVhZHkgcHJvY2Vzc2VkLlxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHRoaXMudHJ5UmVzb2x2ZVBhY2thZ2UobW9kdWxlTmFtZSwgcmVzb2x2ZWRGaWxlTmFtZSk7XG4gICAgLy8gSWYgdGhlIHBhY2thZ2UuanNvbiBpcyByZWFkIG9ubHkgd2Ugc2hvdWxkIHNraXAgY2FsbGluZyBOR0NDLlxuICAgIC8vIFdpdGggQmF6ZWwgd2hlbiBydW5uaW5nIHVuZGVyIHNhbmRib3ggdGhlIGZpbGVzeXN0ZW0gaXMgcmVhZC1vbmx5LlxuICAgIGlmICghcGFja2FnZUpzb25QYXRoIHx8IGlzUmVhZE9ubHlGaWxlKHBhY2thZ2VKc29uUGF0aCkpIHtcbiAgICAgIC8vIGFkZCBpdCB0byBwcm9jZXNzZWQgc28gdGhlIHNlY29uZCB0aW1lIHJvdW5kIHdlIHNraXAgdGhpcy5cbiAgICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuYWRkKHJlc29sdmVkRmlsZU5hbWUpO1xuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZUxhYmVsID0gYE5nY2NQcm9jZXNzb3IucHJvY2Vzc01vZHVsZS5uZ2NjLnByb2Nlc3MrJHttb2R1bGVOYW1lfWA7XG4gICAgdGltZSh0aW1lTGFiZWwpO1xuICAgIHRoaXMuY29tcGlsZXJOZ2NjLnByb2Nlc3Moe1xuICAgICAgYmFzZVBhdGg6IHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LFxuICAgICAgdGFyZ2V0RW50cnlQb2ludFBhdGg6IHBhdGguZGlybmFtZShwYWNrYWdlSnNvblBhdGgpLFxuICAgICAgcHJvcGVydGllc1RvQ29uc2lkZXI6IHRoaXMucHJvcGVydGllc1RvQ29uc2lkZXIsXG4gICAgICBjb21waWxlQWxsRm9ybWF0czogZmFsc2UsXG4gICAgICBjcmVhdGVOZXdFbnRyeVBvaW50Rm9ybWF0czogdHJ1ZSxcbiAgICAgIGxvZ2dlcjogdGhpcy5fbG9nZ2VyLFxuICAgICAgdHNDb25maWdQYXRoOiB0aGlzLnRzQ29uZmlnUGF0aCxcbiAgICB9KTtcbiAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG5cbiAgICAvLyBQdXJnZSB0aGlzIGZpbGUgZnJvbSBjYWNoZSwgc2luY2UgTkdDQyBhZGQgbmV3IG1haW5GaWVsZHMuIEV4OiBtb2R1bGVfaXZ5X25nY2NcbiAgICAvLyB3aGljaCBhcmUgdW5rbm93biBpbiB0aGUgY2FjaGVkIGZpbGUuXG4gICAgdGhpcy5pbnB1dEZpbGVTeXN0ZW0ucHVyZ2U/LihwYWNrYWdlSnNvblBhdGgpO1xuXG4gICAgdGhpcy5fcHJvY2Vzc2VkTW9kdWxlcy5hZGQocmVzb2x2ZWRGaWxlTmFtZSk7XG4gIH1cblxuICBpbnZhbGlkYXRlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmRlbGV0ZShmaWxlTmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogVHJ5IHJlc29sdmUgYSBwYWNrYWdlLmpzb24gZmlsZSBmcm9tIHRoZSByZXNvbHZlZCAuZC50cyBmaWxlLlxuICAgKi9cbiAgcHJpdmF0ZSB0cnlSZXNvbHZlUGFja2FnZShtb2R1bGVOYW1lOiBzdHJpbmcsIHJlc29sdmVkRmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkUGF0aCA9IHRoaXMucmVzb2x2ZXIucmVzb2x2ZVN5bmMoXG4gICAgICAgIHt9LFxuICAgICAgICByZXNvbHZlZEZpbGVOYW1lLFxuICAgICAgICBgJHttb2R1bGVOYW1lfS9wYWNrYWdlLmpzb25gLFxuICAgICAgKTtcblxuICAgICAgcmV0dXJuIHJlc29sdmVkUGF0aCB8fCB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBFeDogQGFuZ3VsYXIvY29tcGlsZXIvc3JjL2kxOG4vaTE4bl9hc3QvcGFja2FnZS5qc29uXG4gICAgICAvLyBvciBsb2NhbCBsaWJyYXJpZXMgd2hpY2ggZG9uJ3QgcmVzaWRlIGluIG5vZGVfbW9kdWxlc1xuICAgICAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcGF0aC5yZXNvbHZlKHJlc29sdmVkRmlsZU5hbWUsICcuLi9wYWNrYWdlLmpzb24nKTtcblxuICAgICAgcmV0dXJuIGV4aXN0c1N5bmMocGFja2FnZUpzb25QYXRoKSA/IHBhY2thZ2VKc29uUGF0aCA6IHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZpbmROb2RlTW9kdWxlc0RpcmVjdG9yeShzdGFydFBvaW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCBjdXJyZW50ID0gc3RhcnRQb2ludDtcbiAgICB3aGlsZSAocGF0aC5kaXJuYW1lKGN1cnJlbnQpICE9PSBjdXJyZW50KSB7XG4gICAgICBjb25zdCBub2RlUGF0aCA9IHBhdGguam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJyk7XG4gICAgICBpZiAoZXhpc3RzU3luYyhub2RlUGF0aCkpIHtcbiAgICAgICAgcmV0dXJuIG5vZGVQYXRoO1xuICAgICAgfVxuXG4gICAgICBjdXJyZW50ID0gcGF0aC5kaXJuYW1lKGN1cnJlbnQpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGxvY2F0ZSB0aGUgJ25vZGVfbW9kdWxlcycgZGlyZWN0b3J5LmApO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kUGFja2FnZU1hbmFnZXJMb2NrRmlsZShwcm9qZWN0QmFzZVBhdGg6IHN0cmluZyk6IHtcbiAgICBsb2NrRmlsZVBhdGg6IHN0cmluZztcbiAgICBsb2NrRmlsZURhdGE6IEJ1ZmZlcjtcbiAgfSB7XG4gICAgZm9yIChjb25zdCBsb2NrRmlsZSBvZiBbJ3lhcm4ubG9jaycsICdwbnBtLWxvY2sueWFtbCcsICdwYWNrYWdlLWxvY2suanNvbiddKSB7XG4gICAgICBjb25zdCBsb2NrRmlsZVBhdGggPSBwYXRoLmpvaW4ocHJvamVjdEJhc2VQYXRoLCBsb2NrRmlsZSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgbG9ja0ZpbGVQYXRoLFxuICAgICAgICAgIGxvY2tGaWxlRGF0YTogcmVhZEZpbGVTeW5jKGxvY2tGaWxlUGF0aCksXG4gICAgICAgIH07XG4gICAgICB9IGNhdGNoIHt9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgbG9jYXRlIGEgcGFja2FnZSBtYW5hZ2VyIGxvY2sgZmlsZS4nKTtcbiAgfVxufVxuXG5jbGFzcyBOZ2NjTG9nZ2VyIGltcGxlbWVudHMgTG9nZ2VyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbldhcm5pbmdzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbkVycm9yczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHB1YmxpYyBsZXZlbDogTG9nTGV2ZWwsXG4gICkge31cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWVtcHR5LWZ1bmN0aW9uXG4gIGRlYnVnKCkge31cblxuICBpbmZvKC4uLmFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgLy8gTG9nIHRvIHN0ZGVyciBiZWNhdXNlIGl0J3MgYSBwcm9ncmVzcy1saWtlIGluZm8gbWVzc2FnZS5cbiAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgXFxuJHthcmdzLmpvaW4oJyAnKX1cXG5gKTtcbiAgfVxuXG4gIHdhcm4oLi4uYXJnczogc3RyaW5nW10pIHtcbiAgICB0aGlzLmNvbXBpbGF0aW9uV2FybmluZ3MucHVzaChhcmdzLmpvaW4oJyAnKSk7XG4gIH1cblxuICBlcnJvciguLi5hcmdzOiBzdHJpbmdbXSkge1xuICAgIHRoaXMuY29tcGlsYXRpb25FcnJvcnMucHVzaChuZXcgRXJyb3IoYXJncy5qb2luKCcgJykpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1JlYWRPbmx5RmlsZShmaWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgYWNjZXNzU3luYyhmaWxlTmFtZSwgY29uc3RhbnRzLldfT0spO1xuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuIl19