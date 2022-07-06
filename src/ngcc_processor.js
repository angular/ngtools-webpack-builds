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
        const originalProcessTitle = process.title;
        try {
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
        }
        finally {
            process.title = originalProcessTitle;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmdjY19wcm9jZXNzb3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL25nY2NfcHJvY2Vzc29yLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsaURBQTBDO0FBQzFDLG1DQUFvQztBQUNwQywyQkFBK0Y7QUFDL0YsMkNBQTZCO0FBRzdCLDJDQUE0QztBQU01QywyRUFBMkU7QUFDM0Usd0ZBQXdGO0FBRXhGLDBCQUEwQjtBQUMxQixnRkFBZ0Y7QUFDaEYsaUVBQWlFO0FBQ2pFLGlEQUFpRDtBQUVqRCxnRkFBZ0Y7QUFFaEYsTUFBYSxhQUFhO0lBS3hCLFlBQ21CLFlBQXlELEVBQ3pELG9CQUE4QixFQUM5QixtQkFBdUMsRUFDdkMsaUJBQXFDLEVBQ3JDLFFBQWdCLEVBQ2hCLFlBQW9CLEVBQ3BCLGVBQWdDLEVBQ2hDLFFBQTZCO1FBUDdCLGlCQUFZLEdBQVosWUFBWSxDQUE2QztRQUN6RCx5QkFBb0IsR0FBcEIsb0JBQW9CLENBQVU7UUFDOUIsd0JBQW1CLEdBQW5CLG1CQUFtQixDQUFvQjtRQUN2QyxzQkFBaUIsR0FBakIsaUJBQWlCLENBQW9CO1FBQ3JDLGFBQVEsR0FBUixRQUFRLENBQVE7UUFDaEIsaUJBQVksR0FBWixZQUFZLENBQVE7UUFDcEIsb0JBQWUsR0FBZixlQUFlLENBQWlCO1FBQ2hDLGFBQVEsR0FBUixRQUFRLENBQXFCO1FBWnhDLHNCQUFpQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFjNUMsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLFVBQVUsQ0FDM0IsSUFBSSxDQUFDLG1CQUFtQixFQUN4QixJQUFJLENBQUMsaUJBQWlCLEVBQ3RCLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUMzQixDQUFDO1FBQ0YsSUFBSSxDQUFDLHFCQUFxQixHQUFHLElB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dEMsSUFBSTtRQUNGLElBQUEsZUFBVSxFQUFDLFFBQVEsRUFBRSxjQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFckMsT0FBTyxLQUFLLENBQUM7S0FDZDtJQUFDLFdBQU07UUFDTixPQUFPLElBQUksQ0FBQztLQUNiO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ0xldmVsLCBMb2dnZXIgfSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYyc7XG5pbXBvcnQgeyBzcGF3blN5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgYWNjZXNzU3luYywgY29uc3RhbnRzLCBleGlzdHNTeW5jLCBta2RpclN5bmMsIHJlYWRGaWxlU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB0eXBlIHsgQ29tcGlsZXIgfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBJbnB1dEZpbGVTeXN0ZW0gfSBmcm9tICcuL2l2eS9zeXN0ZW0nO1xuXG4vLyBFeHRyYWN0IFJlc29sdmVyIHR5cGUgZnJvbSBXZWJwYWNrIHR5cGVzIHNpbmNlIGl0IGlzIG5vdCBkaXJlY3RseSBleHBvcnRlZFxudHlwZSBSZXNvbHZlcldpdGhPcHRpb25zID0gUmV0dXJuVHlwZTxDb21waWxlclsncmVzb2x2ZXJGYWN0b3J5J11bJ2dldCddPjtcblxuLy8gV2UgY2Fubm90IGNyZWF0ZSBhIHBsdWdpbiBmb3IgdGhpcywgYmVjYXVzZSBOR1RTQyByZXF1aXJlcyBhZGRpdGlvbiB0eXBlXG4vLyBpbmZvcm1hdGlvbiB3aGljaCBuZ2NjIGNyZWF0ZXMgd2hlbiBwcm9jZXNzaW5nIGEgcGFja2FnZSB3aGljaCB3YXMgY29tcGlsZWQgd2l0aCBOR0MuXG5cbi8vIEV4YW1wbGUgb2Ygc3VjaCBlcnJvcnM6XG4vLyBFUlJPUiBpbiBub2RlX21vZHVsZXMvQGFuZ3VsYXIvcGxhdGZvcm0tYnJvd3Nlci9wbGF0Zm9ybS1icm93c2VyLmQudHMoNDIsMjIpOlxuLy8gZXJyb3IgVFMtOTk2MDAyOiBBcHBlYXJzIGluIHRoZSBOZ01vZHVsZS5pbXBvcnRzIG9mIEFwcE1vZHVsZSxcbi8vIGJ1dCBjb3VsZCBub3QgYmUgcmVzb2x2ZWQgdG8gYW4gTmdNb2R1bGUgY2xhc3NcblxuLy8gV2Ugbm93IHRyYW5zZm9ybSBhIHBhY2thZ2UgYW5kIGl0J3MgdHlwaW5ncyB3aGVuIE5HVFNDIGlzIHJlc29sdmluZyBhIG1vZHVsZS5cblxuZXhwb3J0IGNsYXNzIE5nY2NQcm9jZXNzb3Ige1xuICBwcml2YXRlIF9wcm9jZXNzZWRNb2R1bGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgX2xvZ2dlcjogTmdjY0xvZ2dlcjtcbiAgcHJpdmF0ZSBfbm9kZU1vZHVsZXNEaXJlY3Rvcnk6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbXBpbGVyTmdjYzogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpL25nY2MnKSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHByb3BlcnRpZXNUb0NvbnNpZGVyOiBzdHJpbmdbXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbXBpbGF0aW9uV2FybmluZ3M6IChFcnJvciB8IHN0cmluZylbXSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGNvbXBpbGF0aW9uRXJyb3JzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBiYXNlUGF0aDogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgdHNDb25maWdQYXRoOiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBpbnB1dEZpbGVTeXN0ZW06IElucHV0RmlsZVN5c3RlbSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlc29sdmVyOiBSZXNvbHZlcldpdGhPcHRpb25zLFxuICApIHtcbiAgICB0aGlzLl9sb2dnZXIgPSBuZXcgTmdjY0xvZ2dlcihcbiAgICAgIHRoaXMuY29tcGlsYXRpb25XYXJuaW5ncyxcbiAgICAgIHRoaXMuY29tcGlsYXRpb25FcnJvcnMsXG4gICAgICBjb21waWxlck5nY2MuTG9nTGV2ZWwuaW5mbyxcbiAgICApO1xuICAgIHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5ID0gdGhpcy5maW5kTm9kZU1vZHVsZXNEaXJlY3RvcnkodGhpcy5iYXNlUGF0aCk7XG4gIH1cblxuICAvKiogUHJvY2VzcyB0aGUgZW50aXJlIG5vZGUgbW9kdWxlcyB0cmVlLiAqL1xuICBwcm9jZXNzKCkge1xuICAgIC8vIFVuZGVyIEJhemVsIHdoZW4gcnVubmluZyBpbiBzYW5kYm94IG1vZGUgcGFydHMgb2YgdGhlIGZpbGVzeXN0ZW0gaXMgcmVhZC1vbmx5LlxuICAgIGlmIChwcm9jZXNzLmVudi5CQVpFTF9UQVJHRVQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBTa2lwIGlmIG5vZGVfbW9kdWxlcyBhcmUgcmVhZC1vbmx5XG4gICAgY29uc3QgY29yZVBhY2thZ2UgPSB0aGlzLnRyeVJlc29sdmVQYWNrYWdlKCdAYW5ndWxhci9jb3JlJywgdGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnkpO1xuICAgIGlmIChjb3JlUGFja2FnZSAmJiBpc1JlYWRPbmx5RmlsZShjb3JlUGFja2FnZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBQZXJmb3JtIGEgbmdjYyBydW4gY2hlY2sgdG8gZGV0ZXJtaW5lIGlmIGFuIGluaXRpYWwgZXhlY3V0aW9uIGlzIHJlcXVpcmVkLlxuICAgIC8vIElmIGEgcnVuIGhhc2ggZmlsZSBleGlzdHMgdGhhdCBtYXRjaGVzIHRoZSBjdXJyZW50IHBhY2thZ2UgbWFuYWdlciBsb2NrIGZpbGUgYW5kIHRoZVxuICAgIC8vIHByb2plY3QncyB0c2NvbmZpZywgdGhlbiBhbiBpbml0aWFsIG5nY2MgcnVuIGhhcyBhbHJlYWR5IGJlZW4gcGVyZm9ybWVkLlxuICAgIGxldCBza2lwUHJvY2Vzc2luZyA9IGZhbHNlO1xuICAgIGxldCBydW5IYXNoRmlsZVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBydW5IYXNoQmFzZVBhdGggPSBwYXRoLmpvaW4odGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnksICcuY2xpLW5nY2MnKTtcbiAgICBjb25zdCBwcm9qZWN0QmFzZVBhdGggPSBwYXRoLmpvaW4odGhpcy5fbm9kZU1vZHVsZXNEaXJlY3RvcnksICcuLicpO1xuICAgIHRyeSB7XG4gICAgICBsZXQgbmdjY0NvbmZpZ0RhdGE7XG4gICAgICB0cnkge1xuICAgICAgICBuZ2NjQ29uZmlnRGF0YSA9IHJlYWRGaWxlU3luYyhwYXRoLmpvaW4ocHJvamVjdEJhc2VQYXRoLCAnbmdjYy5jb25maWcuanMnKSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgbmdjY0NvbmZpZ0RhdGEgPSAnJztcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVsYXRpdmVUc2NvbmZpZ1BhdGggPSBwYXRoLnJlbGF0aXZlKHByb2plY3RCYXNlUGF0aCwgdGhpcy50c0NvbmZpZ1BhdGgpO1xuICAgICAgY29uc3QgdHNjb25maWdEYXRhID0gcmVhZEZpbGVTeW5jKHRoaXMudHNDb25maWdQYXRoKTtcbiAgICAgIGNvbnN0IHsgbG9ja0ZpbGVEYXRhLCBsb2NrRmlsZVBhdGggfSA9IHRoaXMuZmluZFBhY2thZ2VNYW5hZ2VyTG9ja0ZpbGUocHJvamVjdEJhc2VQYXRoKTtcblxuICAgICAgLy8gR2VuZXJhdGUgYSBoYXNoIHRoYXQgcmVwcmVzZW50cyB0aGUgc3RhdGUgb2YgdGhlIHBhY2thZ2UgbG9jayBmaWxlIGFuZCB1c2VkIHRzY29uZmlnXG4gICAgICBjb25zdCBydW5IYXNoID0gY3JlYXRlSGFzaCgnc2hhMjU2JylcbiAgICAgICAgLnVwZGF0ZShsb2NrRmlsZURhdGEpXG4gICAgICAgIC51cGRhdGUobG9ja0ZpbGVQYXRoKVxuICAgICAgICAudXBkYXRlKG5nY2NDb25maWdEYXRhKVxuICAgICAgICAudXBkYXRlKHRzY29uZmlnRGF0YSlcbiAgICAgICAgLnVwZGF0ZShyZWxhdGl2ZVRzY29uZmlnUGF0aClcbiAgICAgICAgLmRpZ2VzdCgnaGV4Jyk7XG5cbiAgICAgIC8vIFRoZSBoYXNoIGlzIHVzZWQgZGlyZWN0bHkgaW4gdGhlIGZpbGUgbmFtZSB0byBtaXRpZ2F0ZSBwb3RlbnRpYWwgcmVhZC93cml0ZSByYWNlXG4gICAgICAvLyBjb25kaXRpb25zIGFzIHdlbGwgYXMgdG8gb25seSByZXF1aXJlIGEgZmlsZSBleGlzdGVuY2UgY2hlY2tcbiAgICAgIHJ1bkhhc2hGaWxlUGF0aCA9IHBhdGguam9pbihydW5IYXNoQmFzZVBhdGgsIHJ1bkhhc2ggKyAnLmxvY2snKTtcblxuICAgICAgLy8gSWYgdGhlIHJ1biBoYXNoIGxvY2sgZmlsZSBleGlzdHMsIHRoZW4gbmdjYyB3YXMgYWxyZWFkeSBydW4gYWdhaW5zdCB0aGlzIHByb2plY3Qgc3RhdGVcbiAgICAgIGlmIChleGlzdHNTeW5jKHJ1bkhhc2hGaWxlUGF0aCkpIHtcbiAgICAgICAgc2tpcFByb2Nlc3NpbmcgPSB0cnVlO1xuICAgICAgfVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQW55IGVycm9yIG1lYW5zIGFuIG5nY2MgZXhlY3V0aW9uIGlzIG5lZWRlZFxuICAgIH1cblxuICAgIGlmIChza2lwUHJvY2Vzc2luZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRpbWVMYWJlbCA9ICdOZ2NjUHJvY2Vzc29yLnByb2Nlc3MnO1xuICAgIHRpbWUodGltZUxhYmVsKTtcblxuICAgIC8vIFdlIHNwYXduIGluc3RlYWQgb2YgdXNpbmcgdGhlIEFQSSBiZWNhdXNlOlxuICAgIC8vIC0gTkdDQyBBc3luYyB1c2VzIGNsdXN0ZXJpbmcgd2hpY2ggaXMgcHJvYmxlbWF0aWMgd2hlbiB1c2VkIHZpYSB0aGUgQVBJIHdoaWNoIG1lYW5zXG4gICAgLy8gdGhhdCB3ZSBjYW5ub3Qgc2V0dXAgbXVsdGlwbGUgY2x1c3RlciBtYXN0ZXJzIHdpdGggZGlmZmVyZW50IG9wdGlvbnMuXG4gICAgLy8gLSBXZSB3aWxsIG5vdCBiZSBhYmxlIHRvIGhhdmUgY29uY3VycmVudCBidWlsZHMgb3RoZXJ3aXNlIEV4OiBBcHAtU2hlbGwsXG4gICAgLy8gYXMgTkdDQyB3aWxsIGNyZWF0ZSBhIGxvY2sgZmlsZSBmb3IgYm90aCBidWlsZHMgYW5kIGl0IHdpbGwgY2F1c2UgYnVpbGRzIHRvIGZhaWxzLlxuICAgIGNvbnN0IG9yaWdpbmFsUHJvY2Vzc1RpdGxlID0gcHJvY2Vzcy50aXRsZTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBzdGF0dXMsIGVycm9yIH0gPSBzcGF3blN5bmMoXG4gICAgICAgIHByb2Nlc3MuZXhlY1BhdGgsXG4gICAgICAgIFtcbiAgICAgICAgICB0aGlzLmNvbXBpbGVyTmdjYy5uZ2NjTWFpbkZpbGVQYXRoLFxuICAgICAgICAgICctLXNvdXJjZScgLyoqIGJhc2VQYXRoICovLFxuICAgICAgICAgIHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LFxuICAgICAgICAgICctLXByb3BlcnRpZXMnIC8qKiBwcm9wZXJ0aWVzVG9Db25zaWRlciAqLyxcbiAgICAgICAgICAuLi50aGlzLnByb3BlcnRpZXNUb0NvbnNpZGVyLFxuICAgICAgICAgICctLWZpcnN0LW9ubHknIC8qKiBjb21waWxlQWxsRm9ybWF0cyAqLyxcbiAgICAgICAgICAnLS1jcmVhdGUtaXZ5LWVudHJ5LXBvaW50cycgLyoqIGNyZWF0ZU5ld0VudHJ5UG9pbnRGb3JtYXRzICovLFxuICAgICAgICAgICctLWFzeW5jJyxcbiAgICAgICAgICAnLS10c2NvbmZpZycgLyoqIHRzQ29uZmlnUGF0aCAqLyxcbiAgICAgICAgICB0aGlzLnRzQ29uZmlnUGF0aCxcbiAgICAgICAgICAnLS11c2UtcHJvZ3JhbS1kZXBlbmRlbmNpZXMnLFxuICAgICAgICBdLFxuICAgICAgICB7XG4gICAgICAgICAgc3RkaW86IFsnaW5oZXJpdCcsIHByb2Nlc3Muc3RkZXJyLCBwcm9jZXNzLnN0ZGVycl0sXG4gICAgICAgIH0sXG4gICAgICApO1xuXG4gICAgICBpZiAoc3RhdHVzICE9PSAwKSB7XG4gICAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yPy5tZXNzYWdlIHx8ICcnO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlICsgYE5HQ0MgZmFpbGVkJHtlcnJvck1lc3NhZ2UgPyAnLCBzZWUgYWJvdmUnIDogJyd9LmApO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBwcm9jZXNzLnRpdGxlID0gb3JpZ2luYWxQcm9jZXNzVGl0bGU7XG4gICAgfVxuXG4gICAgdGltZUVuZCh0aW1lTGFiZWwpO1xuXG4gICAgLy8gbmdjYyB3YXMgc3VjY2Vzc2Z1bCBzbyBpZiBhIHJ1biBoYXNoIHdhcyBnZW5lcmF0ZWQsIHdyaXRlIGl0IGZvciBuZXh0IHRpbWVcbiAgICBpZiAocnVuSGFzaEZpbGVQYXRoKSB7XG4gICAgICB0cnkge1xuICAgICAgICBpZiAoIWV4aXN0c1N5bmMocnVuSGFzaEJhc2VQYXRoKSkge1xuICAgICAgICAgIG1rZGlyU3luYyhydW5IYXNoQmFzZVBhdGgsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuICAgICAgICB9XG4gICAgICAgIHdyaXRlRmlsZVN5bmMocnVuSGFzaEZpbGVQYXRoLCAnJyk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gRXJyb3JzIGFyZSBub24tZmF0YWxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKiogUHJvY2VzcyBhIG1vZHVsZSBhbmQgaXQncyBkZXBlZGVuY2llcy4gKi9cbiAgcHJvY2Vzc01vZHVsZShcbiAgICBtb2R1bGVOYW1lOiBzdHJpbmcsXG4gICAgcmVzb2x2ZWRNb2R1bGU6IHRzLlJlc29sdmVkTW9kdWxlIHwgdHMuUmVzb2x2ZWRUeXBlUmVmZXJlbmNlRGlyZWN0aXZlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoXG4gICAgICAhcmVzb2x2ZWRGaWxlTmFtZSB8fFxuICAgICAgbW9kdWxlTmFtZS5zdGFydHNXaXRoKCcuJykgfHxcbiAgICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuaGFzKHJlc29sdmVkRmlsZU5hbWUpXG4gICAgKSB7XG4gICAgICAvLyBTa2lwIHdoZW4gbW9kdWxlIGlzIHVua25vd24sIHJlbGF0aXZlIG9yIE5HQ0MgY29tcGlsZXIgaXMgbm90IGZvdW5kIG9yIGFscmVhZHkgcHJvY2Vzc2VkLlxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBhY2thZ2VKc29uUGF0aCA9IHRoaXMudHJ5UmVzb2x2ZVBhY2thZ2UobW9kdWxlTmFtZSwgcmVzb2x2ZWRGaWxlTmFtZSk7XG4gICAgLy8gSWYgdGhlIHBhY2thZ2UuanNvbiBpcyByZWFkIG9ubHkgd2Ugc2hvdWxkIHNraXAgY2FsbGluZyBOR0NDLlxuICAgIC8vIFdpdGggQmF6ZWwgd2hlbiBydW5uaW5nIHVuZGVyIHNhbmRib3ggdGhlIGZpbGVzeXN0ZW0gaXMgcmVhZC1vbmx5LlxuICAgIGlmICghcGFja2FnZUpzb25QYXRoIHx8IGlzUmVhZE9ubHlGaWxlKHBhY2thZ2VKc29uUGF0aCkpIHtcbiAgICAgIC8vIGFkZCBpdCB0byBwcm9jZXNzZWQgc28gdGhlIHNlY29uZCB0aW1lIHJvdW5kIHdlIHNraXAgdGhpcy5cbiAgICAgIHRoaXMuX3Byb2Nlc3NlZE1vZHVsZXMuYWRkKHJlc29sdmVkRmlsZU5hbWUpO1xuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgdGltZUxhYmVsID0gYE5nY2NQcm9jZXNzb3IucHJvY2Vzc01vZHVsZS5uZ2NjLnByb2Nlc3MrJHttb2R1bGVOYW1lfWA7XG4gICAgdGltZSh0aW1lTGFiZWwpO1xuICAgIHRoaXMuY29tcGlsZXJOZ2NjLnByb2Nlc3Moe1xuICAgICAgYmFzZVBhdGg6IHRoaXMuX25vZGVNb2R1bGVzRGlyZWN0b3J5LFxuICAgICAgdGFyZ2V0RW50cnlQb2ludFBhdGg6IHBhdGguZGlybmFtZShwYWNrYWdlSnNvblBhdGgpLFxuICAgICAgcHJvcGVydGllc1RvQ29uc2lkZXI6IHRoaXMucHJvcGVydGllc1RvQ29uc2lkZXIsXG4gICAgICBjb21waWxlQWxsRm9ybWF0czogZmFsc2UsXG4gICAgICBjcmVhdGVOZXdFbnRyeVBvaW50Rm9ybWF0czogdHJ1ZSxcbiAgICAgIGxvZ2dlcjogdGhpcy5fbG9nZ2VyLFxuICAgICAgdHNDb25maWdQYXRoOiB0aGlzLnRzQ29uZmlnUGF0aCxcbiAgICB9KTtcbiAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG5cbiAgICAvLyBQdXJnZSB0aGlzIGZpbGUgZnJvbSBjYWNoZSwgc2luY2UgTkdDQyBhZGQgbmV3IG1haW5GaWVsZHMuIEV4OiBtb2R1bGVfaXZ5X25nY2NcbiAgICAvLyB3aGljaCBhcmUgdW5rbm93biBpbiB0aGUgY2FjaGVkIGZpbGUuXG4gICAgdGhpcy5pbnB1dEZpbGVTeXN0ZW0ucHVyZ2U/LihwYWNrYWdlSnNvblBhdGgpO1xuXG4gICAgdGhpcy5fcHJvY2Vzc2VkTW9kdWxlcy5hZGQocmVzb2x2ZWRGaWxlTmFtZSk7XG4gIH1cblxuICBpbnZhbGlkYXRlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICB0aGlzLl9wcm9jZXNzZWRNb2R1bGVzLmRlbGV0ZShmaWxlTmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogVHJ5IHJlc29sdmUgYSBwYWNrYWdlLmpzb24gZmlsZSBmcm9tIHRoZSByZXNvbHZlZCAuZC50cyBmaWxlLlxuICAgKi9cbiAgcHJpdmF0ZSB0cnlSZXNvbHZlUGFja2FnZShtb2R1bGVOYW1lOiBzdHJpbmcsIHJlc29sdmVkRmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc29sdmVkUGF0aCA9IHRoaXMucmVzb2x2ZXIucmVzb2x2ZVN5bmMoXG4gICAgICAgIHt9LFxuICAgICAgICByZXNvbHZlZEZpbGVOYW1lLFxuICAgICAgICBgJHttb2R1bGVOYW1lfS9wYWNrYWdlLmpzb25gLFxuICAgICAgKTtcblxuICAgICAgcmV0dXJuIHJlc29sdmVkUGF0aCB8fCB1bmRlZmluZWQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBFeDogQGFuZ3VsYXIvY29tcGlsZXIvc3JjL2kxOG4vaTE4bl9hc3QvcGFja2FnZS5qc29uXG4gICAgICAvLyBvciBsb2NhbCBsaWJyYXJpZXMgd2hpY2ggZG9uJ3QgcmVzaWRlIGluIG5vZGVfbW9kdWxlc1xuICAgICAgY29uc3QgcGFja2FnZUpzb25QYXRoID0gcGF0aC5yZXNvbHZlKHJlc29sdmVkRmlsZU5hbWUsICcuLi9wYWNrYWdlLmpzb24nKTtcblxuICAgICAgcmV0dXJuIGV4aXN0c1N5bmMocGFja2FnZUpzb25QYXRoKSA/IHBhY2thZ2VKc29uUGF0aCA6IHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZpbmROb2RlTW9kdWxlc0RpcmVjdG9yeShzdGFydFBvaW50OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGxldCBjdXJyZW50ID0gc3RhcnRQb2ludDtcbiAgICB3aGlsZSAocGF0aC5kaXJuYW1lKGN1cnJlbnQpICE9PSBjdXJyZW50KSB7XG4gICAgICBjb25zdCBub2RlUGF0aCA9IHBhdGguam9pbihjdXJyZW50LCAnbm9kZV9tb2R1bGVzJyk7XG4gICAgICBpZiAoZXhpc3RzU3luYyhub2RlUGF0aCkpIHtcbiAgICAgICAgcmV0dXJuIG5vZGVQYXRoO1xuICAgICAgfVxuXG4gICAgICBjdXJyZW50ID0gcGF0aC5kaXJuYW1lKGN1cnJlbnQpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGxvY2F0ZSB0aGUgJ25vZGVfbW9kdWxlcycgZGlyZWN0b3J5LmApO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5kUGFja2FnZU1hbmFnZXJMb2NrRmlsZShwcm9qZWN0QmFzZVBhdGg6IHN0cmluZyk6IHtcbiAgICBsb2NrRmlsZVBhdGg6IHN0cmluZztcbiAgICBsb2NrRmlsZURhdGE6IEJ1ZmZlcjtcbiAgfSB7XG4gICAgZm9yIChjb25zdCBsb2NrRmlsZSBvZiBbJ3lhcm4ubG9jaycsICdwbnBtLWxvY2sueWFtbCcsICdwYWNrYWdlLWxvY2suanNvbiddKSB7XG4gICAgICBjb25zdCBsb2NrRmlsZVBhdGggPSBwYXRoLmpvaW4ocHJvamVjdEJhc2VQYXRoLCBsb2NrRmlsZSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgbG9ja0ZpbGVQYXRoLFxuICAgICAgICAgIGxvY2tGaWxlRGF0YTogcmVhZEZpbGVTeW5jKGxvY2tGaWxlUGF0aCksXG4gICAgICAgIH07XG4gICAgICB9IGNhdGNoIHt9XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgbG9jYXRlIGEgcGFja2FnZSBtYW5hZ2VyIGxvY2sgZmlsZS4nKTtcbiAgfVxufVxuXG5jbGFzcyBOZ2NjTG9nZ2VyIGltcGxlbWVudHMgTG9nZ2VyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbldhcm5pbmdzOiAoRXJyb3IgfCBzdHJpbmcpW10sXG4gICAgcHJpdmF0ZSByZWFkb25seSBjb21waWxhdGlvbkVycm9yczogKEVycm9yIHwgc3RyaW5nKVtdLFxuICAgIHB1YmxpYyBsZXZlbDogTG9nTGV2ZWwsXG4gICkge31cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWVtcHR5LWZ1bmN0aW9uXG4gIGRlYnVnKCkge31cblxuICBpbmZvKC4uLmFyZ3M6IHN0cmluZ1tdKSB7XG4gICAgLy8gTG9nIHRvIHN0ZGVyciBiZWNhdXNlIGl0J3MgYSBwcm9ncmVzcy1saWtlIGluZm8gbWVzc2FnZS5cbiAgICBwcm9jZXNzLnN0ZGVyci53cml0ZShgXFxuJHthcmdzLmpvaW4oJyAnKX1cXG5gKTtcbiAgfVxuXG4gIHdhcm4oLi4uYXJnczogc3RyaW5nW10pIHtcbiAgICB0aGlzLmNvbXBpbGF0aW9uV2FybmluZ3MucHVzaChhcmdzLmpvaW4oJyAnKSk7XG4gIH1cblxuICBlcnJvciguLi5hcmdzOiBzdHJpbmdbXSkge1xuICAgIHRoaXMuY29tcGlsYXRpb25FcnJvcnMucHVzaChuZXcgRXJyb3IoYXJncy5qb2luKCcgJykpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBpc1JlYWRPbmx5RmlsZShmaWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgYWNjZXNzU3luYyhmaWxlTmFtZSwgY29uc3RhbnRzLldfT0spO1xuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuIl19