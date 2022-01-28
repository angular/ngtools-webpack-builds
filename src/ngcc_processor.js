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
            let lockData;
            let lockFile = 'yarn.lock';
            try {
                lockData = (0, fs_1.readFileSync)(path.join(projectBasePath, lockFile));
            }
            catch (_a) {
                lockFile = 'package-lock.json';
                lockData = (0, fs_1.readFileSync)(path.join(projectBasePath, lockFile));
            }
            let ngccConfigData;
            try {
                ngccConfigData = (0, fs_1.readFileSync)(path.join(projectBasePath, 'ngcc.config.js'));
            }
            catch (_b) {
                ngccConfigData = '';
            }
            const relativeTsconfigPath = path.relative(projectBasePath, this.tsConfigPath);
            const tsconfigData = (0, fs_1.readFileSync)(this.tsConfigPath);
            // Generate a hash that represents the state of the package lock file and used tsconfig
            const runHash = (0, crypto_1.createHash)('sha256')
                .update(lockData)
                .update(lockFile)
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
        catch (_c) {
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
            catch (_d) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmdjY19wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL25nY2NfcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHSCxpREFBMEM7QUFDMUMsbUNBQW9DO0FBQ3BDLDJCQUErRjtBQUMvRiwyQ0FBNkI7QUFHN0IsMkNBQTRDO0FBTTVDLDJFQUEyRTtBQUMzRSx3RkFBd0Y7QUFFeEYsMEJBQTBCO0FBQzFCLGdGQUFnRjtBQUNoRixpRUFBaUU7QUFDakUsaURBQWlEO0FBRWpELGdGQUFnRjtBQUVoRixNQUFhLGFBQWE7SUFLeEIsWUFDbUIsWUFBeUQsRUFDekQsb0JBQThCLEVBQzlCLG1CQUF1QyxFQUN2QyxpQkFBcUMsRUFDckMsUUFBZ0IsRUFDaEIsWUFBb0IsRUFDcEIsZUFBZ0MsRUFDaEMsUUFBNkI7UUFQN0IsaUJBQVksR0FBWixZQUFZLENBQTZDO1FBQ3pELHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBVTtRQUM5Qix3QkFBbUIsR0FBbkIsbUJBQW1CLENBQW9CO1FBQ3ZDLHNCQUFpQixHQUFqQixpQkFBaUIsQ0FBb0I7UUFDckMsYUFBUSxHQUFSLFFBQVEsQ0FBUTtRQUNoQixpQkFBWSxHQUFaLFlBQVksQ0FBUTtRQUNwQixvQkFBZSxHQUFmLGVBQWUsQ0FBaUI7UUFDaEMsYUFBUSxHQUFSLFFBQVEsQ0FBcUI7UUFaeEMsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztRQWM1QyxJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksVUFBVSxDQUMzQixJQUFJLENBQUMsbUJBQW1CLEVBQ3hCLElBQUksQ0FBQyxpQkFBaUIsRUFDdEIsWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQzNCLENBQUM7UUFDRixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxD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NkMsQ0FBQyxDQUFDO0lBQ2pFLENBQUM7Q0FDRjtBQTNORCxzQ0EyTkM7QUFFRCxNQUFNLFVBQVU7SUFDZCxZQUNtQixtQkFBdUMsRUFDdkMsaUJBQXFDLEVBQy9DLEtBQWU7UUFGTCx3QkFBbUIsR0FBbkIsbUJBQW1CLENBQW9CO1FBQ3ZDLHNCQUFpQixHQUFqQixpQkFBaUIsQ0FBb0I7UUFDL0MsVUFBSyxHQUFMLEtBQUssQ0FBVTtJQUNyQixDQUFDO0lBRUosZ0VBQWdFO0lBQ2hFLEtBQUssS0FBSSxDQUFDO0lBRVYsSUFBSSxDQUFDLEdBQUcsSUFBYztRQUNwQiwyREFBMkQ7UUFDM0QsT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRUQsSUFBSSxDQUFDLEdBQUcsSUFBYztRQUNwQixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQUcsSUFBYztRQUNyQixJQUFJLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3pELENBQUM7Q0FDRjtBQUVELFNBQVMsY0FBYyxDQUFDLFFBQWdCO0lBQ3RDLElBQUk7UUFDRixJQUFBLGVBQVUsRUFBQyxRQUFRLEVBQUUsY0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRXJDLE9BQU8sS0FBSyxDQUFDO0tBQ2Q7SUFBQyxXQUFNO1FBQ04sT0FBTyxJQUFJLENBQUM7S0FDYjtBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dMZXZlbCwgTG9nZ2VyIH0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXItY2xpL25nY2MnO1xuaW1wb3J0IHsgc3Bhd25TeW5jIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IGFjY2Vzc1N5bmMsIGNvbnN0YW50cywgZXhpc3RzU3luYywgbWtkaXJTeW5jLCByZWFkRmlsZVN5bmMsIHdyaXRlRmlsZVN5bmMgfSBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgdHlwZSB7IENvbXBpbGVyIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgSW5wdXRGaWxlU3lzdGVtIH0gZnJvbSAnLi9pdnkvc3lzdGVtJztcblxuLy8gRXh0cmFjdCBSZXNvbHZlciB0eXBlIGZyb20gV2VicGFjayB0eXBlcyBzaW5jZSBpdCBpcyBub3QgZGlyZWN0bHkgZXhwb3J0ZWRcbnR5cGUgUmVzb2x2ZXJXaXRoT3B0aW9ucyA9IFJldHVyblR5cGU8Q29tcGlsZXJbJ3Jlc29sdmVyRmFjdG9yeSddWydnZXQnXT47XG5cbi8vIFdlIGNhbm5vdCBjcmVhdGUgYSBwbHVnaW4gZm9yIHRoaXMsIGJlY2F1c2UgTkdUU0MgcmVxdWlyZXMgYWRkaXRpb24gdHlwZVxuLy8gaW5mb3JtYXRpb24gd2hpY2ggbmdjYyBjcmVhdGVzIHdoZW4gcHJvY2Vzc2luZyBhIHBhY2thZ2Ugd2hpY2ggd2FzIGNvbXBpbGVkIHdpdGggTkdDLlxuXG4vLyBFeGFtcGxlIG9mIHN1Y2ggZXJyb3JzOlxuLy8gRVJST1IgaW4gbm9kZV9tb2R1bGVzL0Bhbmd1bGFyL3BsYXRmb3JtLWJyb3dzZXIvcGxhdGZvcm0tYnJvd3Nlci5kLnRzKDQyLDIyKTpcbi8vIGVycm9yIFRTLTk5NjAwMjogQXBwZWFycyBpbiB0aGUgTmdNb2R1bGUuaW1wb3J0cyBvZiBBcHBNb2R1bGUsXG4vLyBidXQgY291bGQgbm90IGJlIHJlc29sdmVkIHRvIGFuIE5nTW9kdWxlIGNsYXNzXG5cbi8vIFdlIG5vdyB0cmFuc2Zvcm0gYSBwYWNrYWdlIGFuZCBpdCdzIHR5cGluZ3Mgd2hlbiBOR1RTQyBpcyByZXNvbHZpbmcgYSBtb2R1bGUuXG5cbmV4cG9ydCBjbGFzcyBOZ2NjUHJvY2Vzc29yIHtcbiAgcHJpdmF0ZSBfcHJvY2Vzc2VkTW9kdWxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIF9sb2dnZXI6IE5nY2NMb2dnZXI7XG4gIHByaXZhdGUgX25vZGVNb2R1bGVzRGlyZWN0b3J5OiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxlck5nY2M6IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyksXG4gICAgcHJpdmF0ZSByZWFkb25seSBwcm9wZXJ0aWVzVG9Db25zaWRlcjogc3RyaW5nW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbldhcm5pbmdzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbkVycm9yczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgYmFzZVBhdGg6IHN0cmluZyxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHRzQ29uZmlnUGF0aDogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgaW5wdXRGaWxlU3lzdGVtOiBJbnB1dEZpbGVTeXN0ZW0sXG4gICAgcHJpdmF0ZSByZWFkb25seSByZXNvbHZlcjogUmVzb2x2ZXJXaXRoT3B0aW9ucyxcbiAgKSB7XG4gICAgdGhpcy5fbG9nZ2VyID0gbmV3IE5nY2NMb2dnZXIoXG4gICAgICB0aGlzLmNvbXBpbGF0aW9uV2FybmluZ3MsXG4gICAgICB0aGlzLmNvbXBpbGF0aW9uRXJyb3JzLFxuICAgICAgY29tcGlsZXJOZ2NjLkxvZ0xldmVsLmluZm8sXG4gICAgKTtcbiAgICB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSA9IHRoaXMuZmluZE5vZGVNb2R1bGVzRGlyZWN0b3J5KHRoaXMuYmFzZVBhdGgpO1xuICB9XG5cbiAgLyoqIFByb2Nlc3MgdGhlIGVudGlyZSBub2RlIG1vZHVsZXMgdHJlZS4gKi9cbiAgcHJvY2VzcygpIHtcbiAgICAvLyBVbmRlciBCYXplbCB3aGVuIHJ1bm5pbmcgaW4gc2FuZGJveCBtb2RlIHBhcnRzIG9mIHRoZSBmaWxlc3lzdGVtIGlzIHJlYWQtb25seS5cbiAgICBpZiAocHJvY2Vzcy5lbnYuQkFaRUxfVEFSR0VUKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gU2tpcCBpZiBub2RlX21vZHVsZXMgYXJlIHJlYWQtb25seVxuICAgIGNvbnN0IGNvcmVQYWNrYWdlID0gdGhpcy50cnlSZXNvbHZlUGFja2FnZSgnQGFuZ3VsYXIvY29yZScsIHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5KTtcbiAgICBpZiAoY29yZVBhY2thZ2UgJiYgaXNSZWFkT25seUZpbGUoY29yZVBhY2thZ2UpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUGVyZm9ybSBhIG5nY2MgcnVuIGNoZWNrIHRvIGRldGVybWluZSBpZiBhbiBpbml0aWFsIGV4ZWN1dGlvbiBpcyByZXF1aXJlZC5cbiAgICAvLyBJZiBhIHJ1biBoYXNoIGZpbGUgZXhpc3RzIHRoYXQgbWF0Y2hlcyB0aGUgY3VycmVudCBwYWNrYWdlIG1hbmFnZXIgbG9jayBmaWxlIGFuZCB0aGVcbiAgICAvLyBwcm9qZWN0J3MgdHNjb25maWcsIHRoZW4gYW4gaW5pdGlhbCBuZ2NjIHJ1biBoYXMgYWxyZWFkeSBiZWVuIHBlcmZvcm1lZC5cbiAgICBsZXQgc2tpcFByb2Nlc3NpbmcgPSBmYWxzZTtcbiAgICBsZXQgcnVuSGFzaEZpbGVQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgcnVuSGFzaEJhc2VQYXRoID0gcGF0aC5qb2luKHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LCAnLmNsaS1uZ2NjJyk7XG4gICAgY29uc3QgcHJvamVjdEJhc2VQYXRoID0gcGF0aC5qb2luKHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LCAnLi4nKTtcbiAgICB0cnkge1xuICAgICAgbGV0IGxvY2tEYXRhO1xuICAgICAgbGV0IGxvY2tGaWxlID0gJ3lhcm4ubG9jayc7XG4gICAgICB0cnkge1xuICAgICAgICBsb2NrRGF0YSA9IHJlYWRGaWxlU3luYyhwYXRoLmpvaW4ocHJvamVjdEJhc2VQYXRoLCBsb2NrRmlsZSkpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGxvY2tGaWxlID0gJ3BhY2thZ2UtbG9jay5qc29uJztcbiAgICAgICAgbG9ja0RhdGEgPSByZWFkRmlsZVN5bmMocGF0aC5qb2luKHByb2plY3RCYXNlUGF0aCwgbG9ja0ZpbGUpKTtcbiAgICAgIH1cblxuICAgICAgbGV0IG5nY2NDb25maWdEYXRhO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmdjY0NvbmZpZ0RhdGEgPSByZWFkRmlsZVN5bmMocGF0aC5qb2luKHByb2plY3RCYXNlUGF0aCwgJ25nY2MuY29uZmlnLmpzJykpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIG5nY2NDb25maWdEYXRhID0gJyc7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlbGF0aXZlVHNjb25maWdQYXRoID0gcGF0aC5yZWxhdGl2ZShwcm9qZWN0QmFzZVBhdGgsIHRoaXMudHNDb25maWdQYXRoKTtcbiAgICAgIGNvbnN0IHRzY29uZmlnRGF0YSA9IHJlYWRGaWxlU3luYyh0aGlzLnRzQ29uZmlnUGF0aCk7XG5cbiAgICAgIC8vIEdlbmVyYXRlIGEgaGFzaCB0aGF0IHJlcHJlc2VudHMgdGhlIHN0YXRlIG9mIHRoZSBwYWNrYWdlIGxvY2sgZmlsZSBhbmQgdXNlZCB0c2NvbmZpZ1xuICAgICAgY29uc3QgcnVuSGFzaCA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgICAgIC51cGRhdGUobG9ja0RhdGEpXG4gICAgICAgIC51cGRhdGUobG9ja0ZpbGUpXG4gICAgICAgIC51cGRhdGUobmdjY0NvbmZpZ0RhdGEpXG4gICAgICAgIC51cGRhdGUodHNjb25maWdEYXRhKVxuICAgICAgICAudXBkYXRlKHJlbGF0aXZlVHNjb25maWdQYXRoKVxuICAgICAgICAuZGlnZXN0KCdoZXgnKTtcblxuICAgICAgLy8gVGhlIGhhc2ggaXMgdXNlZCBkaXJlY3RseSBpbiB0aGUgZmlsZSBuYW1lIHRvIG1pdGlnYXRlIHBvdGVudGlhbCByZWFkL3dyaXRlIHJhY2VcbiAgICAgIC8vIGNvbmRpdGlvbnMgYXMgd2VsbCBhcyB0byBvbmx5IHJlcXVpcmUgYSBmaWxlIGV4aXN0ZW5jZSBjaGVja1xuICAgICAgcnVuSGFzaEZpbGVQYXRoID0gcGF0aC5qb2luKHJ1bkhhc2hCYXNlUGF0aCwgcnVuSGFzaCArICcubG9jaycpO1xuXG4gICAgICAvLyBJZiB0aGUgcnVuIGhhc2ggbG9jayBmaWxlIGV4aXN0cywgdGhlbiBuZ2NjIHdhcyBhbHJlYWR5IHJ1biBhZ2FpbnN0IHRoaXMgcHJvamVjdCBzdGF0ZVxuICAgICAgaWYgKGV4aXN0c1N5bmMocnVuSGFzaEZpbGVQYXRoKSkge1xuICAgICAgICBza2lwUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBbnkgZXJyb3IgbWVhbnMgYW4gbmdjYyBleGVjdXRpb24gaXMgbmVlZGVkXG4gICAgfVxuXG4gICAgaWYgKHNraXBQcm9jZXNzaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZUxhYmVsID0gJ05nY2NQcm9jZXNzb3IucHJvY2Vzcyc7XG4gICAgdGltZSh0aW1lTGFiZWwpO1xuXG4gICAgLy8gV2Ugc3Bhd24gaW5zdGVhZCBvZiB1c2luZyB0aGUgQVBJIGJlY2F1c2U6XG4gICAgLy8gLSBOR0NDIEFzeW5jIHVzZXMgY2x1c3RlcmluZyB3aGljaCBpcyBwcm9ibGVtYXRpYyB3aGVuIHVzZWQgdmlhIHRoZSBBUEkgd2hpY2ggbWVhbnNcbiAgICAvLyB0aGF0IHdlIGNhbm5vdCBzZXR1cCBtdWx0aXBsZSBjbHVzdGVyIG1hc3RlcnMgd2l0aCBkaWZmZXJlbnQgb3B0aW9ucy5cbiAgICAvLyAtIFdlIHdpbGwgbm90IGJlIGFibGUgdG8gaGF2ZSBjb25jdXJyZW50IGJ1aWxkcyBvdGhlcndpc2UgRXg6IEFwcC1TaGVsbCxcbiAgICAvLyBhcyBOR0NDIHdpbGwgY3JlYXRlIGEgbG9jayBmaWxlIGZvciBib3RoIGJ1aWxkcyBhbmQgaXQgd2lsbCBjYXVzZSBidWlsZHMgdG8gZmFpbHMuXG4gICAgY29uc3QgeyBzdGF0dXMsIGVycm9yIH0gPSBzcGF3blN5bmMoXG4gICAgICBwcm9jZXNzLmV4ZWNQYXRoLFxuICAgICAgW1xuICAgICAgICB0aGlzLmNvbXBpbGVyTmdjYy5uZ2NjTWFpbkZpbGVQYXRoLFxuICAgICAgICAnLS1zb3VyY2UnIC8qKiBiYXNlUGF0aCAqLyxcbiAgICAgICAgdGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnksXG4gICAgICAgICctLXByb3BlcnRpZXMnIC8qKiBwcm9wZXJ0aWVzVG9Db25zaWRlciAqLyxcbiAgICAgICAgLi4udGhpcy5wcm9wZXJ0aWVzVG9Db25zaWRlcixcbiAgICAgICAgJy0tZmlyc3Qtb25seScgLyoqIGNvbXBpbGVBbGxGb3JtYXRzICovLFxuICAgICAgICAnLS1jcmVhdGUtaXZ5LWVudHJ5LXBvaW50cycgLyoqIGNyZWF0ZU5ld0VudHJ5UG9pbnRGb3JtYXRzICovLFxuICAgICAgICAnLS1hc3luYycsXG4gICAgICAgICctLXRzY29uZmlnJyAvKiogdHNDb25maWdQYXRoICovLFxuICAgICAgICB0aGlzLnRzQ29uZmlnUGF0aCxcbiAgICAgICAgJy0tdXNlLXByb2dyYW0tZGVwZW5kZW5jaWVzJyxcbiAgICAgIF0sXG4gICAgICB7XG4gICAgICAgIHN0ZGlvOiBbJ2luaGVyaXQnLCBwcm9jZXNzLnN0ZGVyciwgcHJvY2Vzcy5zdGRlcnJdLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgaWYgKHN0YXR1cyAhPT0gMCkge1xuICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3I/Lm1lc3NhZ2UgfHwgJyc7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlICsgYE5HQ0MgZmFpbGVkJHtlcnJvck1lc3NhZ2UgPyAnLCBzZWUgYWJvdmUnIDogJyd9LmApO1xuICAgIH1cblxuICAgIHRpbWVFbmQodGltZUxhYmVsKTtcblxuICAgIC8vIG5nY2Mgd2FzIHN1Y2Nlc3NmdWwgc28gaWYgYSBydW4gaGFzaCB3YXMgZ2VuZXJhdGVkLCB3cml0ZSBpdCBmb3IgbmV4dCB0aW1lXG4gICAgaWYgKHJ1bkhhc2hGaWxlUGF0aCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKCFleGlzdHNTeW5jKHJ1bkhhc2hCYXNlUGF0aCkpIHtcbiAgICAgICAgICBta2RpclN5bmMocnVuSGFzaEJhc2VQYXRoLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICAgICAgfVxuICAgICAgICB3cml0ZUZpbGVTeW5jKHJ1bkhhc2hGaWxlUGF0aCwgJycpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIEVycm9ycyBhcmUgbm9uLWZhdGFsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqIFByb2Nlc3MgYSBtb2R1bGUgYW5kIGl0J3MgZGVwZWRlbmNpZXMuICovXG4gIHByb2Nlc3NNb2R1bGUoXG4gICAgbW9kdWxlTmFtZTogc3RyaW5nLFxuICAgIHJlc29sdmVkTW9kdWxlOiB0cy5SZXNvbHZlZE1vZHVsZSB8IHRzLlJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZSxcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgcmVzb2x2ZWRGaWxlTmFtZSA9IHJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgaWYgKFxuICAgICAgIXJlc29sdmVkRmlsZU5hbWUgfHxcbiAgICAgIG1vZHVsZU5hbWUuc3RhcnRzV2l0aCgnLicpIHx8XG4gICAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmhhcyhyZXNvbHZlZEZpbGVOYW1lKVxuICAgICkge1xuICAgICAgLy8gU2tpcCB3aGVuIG1vZHVsZSBpcyB1bmtub3duLCByZWxhdGl2ZSBvciBOR0NDIGNvbXBpbGVyIGlzIG5vdCBmb3VuZCBvciBhbHJlYWR5IHByb2Nlc3NlZC5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwYWNrYWdlSnNvblBhdGggPSB0aGlzLnRyeVJlc29sdmVQYWNrYWdlKG1vZHVsZU5hbWUsIHJlc29sdmVkRmlsZU5hbWUpO1xuICAgIC8vIElmIHRoZSBwYWNrYWdlLmpzb24gaXMgcmVhZCBvbmx5IHdlIHNob3VsZCBza2lwIGNhbGxpbmcgTkdDQy5cbiAgICAvLyBXaXRoIEJhemVsIHdoZW4gcnVubmluZyB1bmRlciBzYW5kYm94IHRoZSBmaWxlc3lzdGVtIGlzIHJlYWQtb25seS5cbiAgICBpZiAoIXBhY2thZ2VKc29uUGF0aCB8fCBpc1JlYWRPbmx5RmlsZShwYWNrYWdlSnNvblBhdGgpKSB7XG4gICAgICAvLyBhZGQgaXQgdG8gcHJvY2Vzc2VkIHNvIHRoZSBzZWNvbmQgdGltZSByb3VuZCB3ZSBza2lwIHRoaXMuXG4gICAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmFkZChyZXNvbHZlZEZpbGVOYW1lKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBOZ2NjUHJvY2Vzc29yLnByb2Nlc3NNb2R1bGUubmdjYy5wcm9jZXNzKyR7bW9kdWxlTmFtZX1gO1xuICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICB0aGlzLmNvbXBpbGVyTmdjYy5wcm9jZXNzKHtcbiAgICAgIGJhc2VQYXRoOiB0aGlzLl9ub2RlTW9kdWxlc0RpcmVjdG9yeSxcbiAgICAgIHRhcmdldEVudHJ5UG9pbnRQYXRoOiBwYXRoLmRpcm5hbWUocGFja2FnZUpzb25QYXRoKSxcbiAgICAgIHByb3BlcnRpZXNUb0NvbnNpZGVyOiB0aGlzLnByb3BlcnRpZXNUb0NvbnNpZGVyLFxuICAgICAgY29tcGlsZUFsbEZvcm1hdHM6IGZhbHNlLFxuICAgICAgY3JlYXRlTmV3RW50cnlQb2ludEZvcm1hdHM6IHRydWUsXG4gICAgICBsb2dnZXI6IHRoaXMuX2xvZ2dlcixcbiAgICAgIHRzQ29uZmlnUGF0aDogdGhpcy50c0NvbmZpZ1BhdGgsXG4gICAgfSk7XG4gICAgdGltZUVuZCh0aW1lTGFiZWwpO1xuXG4gICAgLy8gUHVyZ2UgdGhpcyBmaWxlIGZyb20gY2FjaGUsIHNpbmNlIE5HQ0MgYWRkIG5ldyBtYWluRmllbGRzLiBFeDogbW9kdWxlX2l2eV9uZ2NjXG4gICAgLy8gd2hpY2ggYXJlIHVua25vd24gaW4gdGhlIGNhY2hlZCBmaWxlLlxuICAgIHRoaXMuaW5wdXRGaWxlU3lzdGVtLnB1cmdlPy4ocGFja2FnZUpzb25QYXRoKTtcblxuICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuYWRkKHJlc29sdmVkRmlsZU5hbWUpO1xuICB9XG5cbiAgaW52YWxpZGF0ZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgdGhpcy5fcHJvY2Vzc2VkTW9kdWxlcy5kZWxldGUoZmlsZU5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRyeSByZXNvbHZlIGEgcGFja2FnZS5qc29uIGZpbGUgZnJvbSB0aGUgcmVzb2x2ZWQgLmQudHMgZmlsZS5cbiAgICovXG4gIHByaXZhdGUgdHJ5UmVzb2x2ZVBhY2thZ2UobW9kdWxlTmFtZTogc3RyaW5nLCByZXNvbHZlZEZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNvbHZlZFBhdGggPSB0aGlzLnJlc29sdmVyLnJlc29sdmVTeW5jKFxuICAgICAgICB7fSxcbiAgICAgICAgcmVzb2x2ZWRGaWxlTmFtZSxcbiAgICAgICAgYCR7bW9kdWxlTmFtZX0vcGFja2FnZS5qc29uYCxcbiAgICAgICk7XG5cbiAgICAgIHJldHVybiByZXNvbHZlZFBhdGggfHwgdW5kZWZpbmVkO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gRXg6IEBhbmd1bGFyL2NvbXBpbGVyL3NyYy9pMThuL2kxOG5fYXN0L3BhY2thZ2UuanNvblxuICAgICAgLy8gb3IgbG9jYWwgbGlicmFyaWVzIHdoaWNoIGRvbid0IHJlc2lkZSBpbiBub2RlX21vZHVsZXNcbiAgICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHBhdGgucmVzb2x2ZShyZXNvbHZlZEZpbGVOYW1lLCAnLi4vcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIHJldHVybiBleGlzdHNTeW5jKHBhY2thZ2VKc29uUGF0aCkgPyBwYWNrYWdlSnNvblBhdGggOiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBmaW5kTm9kZU1vZHVsZXNEaXJlY3Rvcnkoc3RhcnRQb2ludDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBsZXQgY3VycmVudCA9IHN0YXJ0UG9pbnQ7XG4gICAgd2hpbGUgKHBhdGguZGlybmFtZShjdXJyZW50KSAhPT0gY3VycmVudCkge1xuICAgICAgY29uc3Qgbm9kZVBhdGggPSBwYXRoLmpvaW4oY3VycmVudCwgJ25vZGVfbW9kdWxlcycpO1xuICAgICAgaWYgKGV4aXN0c1N5bmMobm9kZVBhdGgpKSB7XG4gICAgICAgIHJldHVybiBub2RlUGF0aDtcbiAgICAgIH1cblxuICAgICAgY3VycmVudCA9IHBhdGguZGlybmFtZShjdXJyZW50KTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBsb2NhdGUgdGhlICdub2RlX21vZHVsZXMnIGRpcmVjdG9yeS5gKTtcbiAgfVxufVxuXG5jbGFzcyBOZ2NjTG9nZ2VyIGltcGxlbWVudHMgTG9nZ2VyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbldhcm5pbmdzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbkVycm9yczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHB1YmxpYyBsZXZlbDogTG9nTGV2ZWwsXG4gICkge31cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWVtcHR5LWZ1bmN0aW9uXG4gIGRlYnVnKCkge31cblxuICBpbmZvKC4uLmFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgLy8gTG9nIHRvIHN0ZGVyciBiZWNhdXNlIGl0J3MgYSBwcm9ncmVzcy1saWtlIGluZm8gbWVzc2FnZS5cbiAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgXFxuJHthcmdzLmpvaW4oJyAnKX1cXG5gKTtcbiAgfVxuXG4gIHdhcm4oLi4uYXJnczogc3RyaW5nW10pIHtcbiAgICB0aGlzLmNvbXBpbGF0aW9uV2FybmluZ3MucHVzaChhcmdzLmpvaW4oJyAnKSk7XG4gIH1cblxuICBlcnJvciguLi5hcmdzOiBzdHJpbmdbXSkge1xuICAgIHRoaXMuY29tcGlsYXRpb25FcnJvcnMucHVzaChuZXcgRXJyb3IoYXJncy5qb2luKCcgJykpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1JlYWRPbmx5RmlsZShmaWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgYWNjZXNzU3luYyhmaWxlTmFtZSwgY29uc3RhbnRzLldfT0spO1xuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuIl19