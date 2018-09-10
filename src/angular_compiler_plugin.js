"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const core_1 = require("@angular-devkit/core");
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const entry_resolver_1 = require("./entry_resolver");
const gather_diagnostics_1 = require("./gather_diagnostics");
const lazy_routes_1 = require("./lazy_routes");
const ngtools_api_1 = require("./ngtools_api");
const paths_plugin_1 = require("./paths-plugin");
const resource_loader_1 = require("./resource_loader");
const transformers_1 = require("./transformers");
const ast_helpers_1 = require("./transformers/ast_helpers");
const type_checker_1 = require("./type_checker");
const virtual_file_system_decorator_1 = require("./virtual_file_system_decorator");
const webpack_input_host_1 = require("./webpack-input-host");
const treeKill = require('tree-kill');
var PLATFORM;
(function (PLATFORM) {
    PLATFORM[PLATFORM["Browser"] = 0] = "Browser";
    PLATFORM[PLATFORM["Server"] = 1] = "Server";
})(PLATFORM = exports.PLATFORM || (exports.PLATFORM = {}));
class AngularCompilerPlugin {
    constructor(options) {
        this._singleFileIncludes = [];
        // Contains `moduleImportPath#exportName` => `fullModulePath`.
        this._lazyRoutes = Object.create(null);
        this._transformers = [];
        this._platformTransformers = null;
        this._JitMode = false;
        this._emitSkipped = true;
        this._changedFileExtensions = new Set(['ts', 'html', 'css']);
        // Webpack plugin.
        this._firstRun = true;
        this._warnings = [];
        this._errors = [];
        // TypeChecker process.
        this._forkTypeChecker = true;
        this._forkedTypeCheckerInitialized = false;
        ngtools_api_1.CompilerCliIsSupported();
        this._options = Object.assign({}, options);
        this._setupOptions(this._options);
    }
    get _ngCompilerSupportsNewApi() {
        if (this._JitMode) {
            return false;
        }
        else {
            return !!this._program.listLazyRoutes;
        }
    }
    get options() { return this._options; }
    get done() { return this._donePromise; }
    get entryModule() {
        if (!this._entryModule) {
            return null;
        }
        const splitted = this._entryModule.split(/(#[a-zA-Z_]([\w]+))$/);
        const path = splitted[0];
        const className = !!splitted[1] ? splitted[1].substring(1) : 'default';
        return { path, className };
    }
    get typeChecker() {
        const tsProgram = this._getTsProgram();
        return tsProgram ? tsProgram.getTypeChecker() : null;
    }
    static isSupported() {
        return ngtools_api_1.VERSION && parseInt(ngtools_api_1.VERSION.major) >= 5;
    }
    _setupOptions(options) {
        benchmark_1.time('AngularCompilerPlugin._setupOptions');
        // Fill in the missing options.
        if (!options.hasOwnProperty('tsConfigPath')) {
            throw new Error('Must specify "tsConfigPath" in the configuration of @ngtools/webpack.');
        }
        // TS represents paths internally with '/' and expects the tsconfig path to be in this format
        this._tsConfigPath = options.tsConfigPath.replace(/\\/g, '/');
        // Check the base path.
        const maybeBasePath = path.resolve(process.cwd(), this._tsConfigPath);
        let basePath = maybeBasePath;
        if (fs.statSync(maybeBasePath).isFile()) {
            basePath = path.dirname(basePath);
        }
        if (options.basePath !== undefined) {
            basePath = path.resolve(process.cwd(), options.basePath);
        }
        if (options.singleFileIncludes !== undefined) {
            this._singleFileIncludes.push(...options.singleFileIncludes);
        }
        // Parse the tsconfig contents.
        const config = ngtools_api_1.readConfiguration(this._tsConfigPath);
        if (config.errors && config.errors.length) {
            throw new Error(ngtools_api_1.formatDiagnostics(config.errors));
        }
        this._rootNames = config.rootNames.concat(...this._singleFileIncludes);
        this._compilerOptions = Object.assign({}, config.options, options.compilerOptions);
        this._basePath = config.options.basePath || basePath || '';
        // Overwrite outDir so we can find generated files next to their .ts origin in compilerHost.
        this._compilerOptions.outDir = '';
        this._compilerOptions.suppressOutputPathCheck = true;
        // Default plugin sourceMap to compiler options setting.
        if (!options.hasOwnProperty('sourceMap')) {
            options.sourceMap = this._compilerOptions.sourceMap || false;
        }
        // Force the right sourcemap options.
        if (options.sourceMap) {
            this._compilerOptions.sourceMap = true;
            this._compilerOptions.inlineSources = true;
            this._compilerOptions.inlineSourceMap = false;
            this._compilerOptions.mapRoot = undefined;
            // We will set the source to the full path of the file in the loader, so we don't
            // need sourceRoot here.
            this._compilerOptions.sourceRoot = undefined;
        }
        else {
            this._compilerOptions.sourceMap = false;
            this._compilerOptions.sourceRoot = undefined;
            this._compilerOptions.inlineSources = undefined;
            this._compilerOptions.inlineSourceMap = undefined;
            this._compilerOptions.mapRoot = undefined;
            this._compilerOptions.sourceRoot = undefined;
        }
        // We want to allow emitting with errors so that imports can be added
        // to the webpack dependency tree and rebuilds triggered by file edits.
        this._compilerOptions.noEmitOnError = false;
        // Set JIT (no code generation) or AOT mode.
        if (options.skipCodeGeneration !== undefined) {
            this._JitMode = options.skipCodeGeneration;
        }
        // Process i18n options.
        if (options.i18nInFile !== undefined) {
            this._compilerOptions.i18nInFile = options.i18nInFile;
        }
        if (options.i18nInFormat !== undefined) {
            this._compilerOptions.i18nInFormat = options.i18nInFormat;
        }
        if (options.i18nOutFile !== undefined) {
            this._compilerOptions.i18nOutFile = options.i18nOutFile;
        }
        if (options.i18nOutFormat !== undefined) {
            this._compilerOptions.i18nOutFormat = options.i18nOutFormat;
        }
        if (options.locale !== undefined) {
            this._compilerOptions.i18nInLocale = options.locale;
            this._compilerOptions.i18nOutLocale = options.locale;
            this._normalizedLocale = this._validateLocale(options.locale);
        }
        if (options.missingTranslation !== undefined) {
            this._compilerOptions.i18nInMissingTranslations =
                options.missingTranslation;
        }
        // Process forked type checker options.
        if (options.forkTypeChecker !== undefined) {
            this._forkTypeChecker = options.forkTypeChecker;
        }
        // Add custom platform transformers.
        if (options.platformTransformers !== undefined) {
            this._platformTransformers = options.platformTransformers;
        }
        // Default ContextElementDependency to the one we can import from here.
        // Failing to use the right ContextElementDependency will throw the error below:
        // "No module factory available for dependency type: ContextElementDependency"
        // Hoisting together with peer dependencies can make it so the imported
        // ContextElementDependency does not come from the same Webpack instance that is used
        // in the compilation. In that case, we can pass the right one as an option to the plugin.
        this._contextElementDependencyConstructor = options.contextElementDependencyConstructor
            || require('webpack/lib/dependencies/ContextElementDependency');
        // Use entryModule if available in options, otherwise resolve it from mainPath after program
        // creation.
        if (this._options.entryModule) {
            this._entryModule = this._options.entryModule;
        }
        else if (this._compilerOptions.entryModule) {
            this._entryModule = path.resolve(this._basePath, this._compilerOptions.entryModule); // temporary cast for type issue
        }
        // Set platform.
        this._platform = options.platform || PLATFORM.Browser;
        // Make transformers.
        this._makeTransformers();
        benchmark_1.timeEnd('AngularCompilerPlugin._setupOptions');
    }
    _getTsProgram() {
        if (!this._program) {
            return undefined;
        }
        return this._JitMode ? this._program : this._program.getTsProgram();
    }
    _getChangedTsFiles() {
        return this._compilerHost.getChangedFilePaths()
            .filter(k => (k.endsWith('.ts') || k.endsWith('.tsx')) && !k.endsWith('.d.ts'))
            .filter(k => this._compilerHost.fileExists(k));
    }
    updateChangedFileExtensions(extension) {
        if (extension) {
            this._changedFileExtensions.add(extension);
        }
    }
    _getChangedCompilationFiles() {
        return this._compilerHost.getChangedFilePaths()
            .filter(k => {
            for (const ext of this._changedFileExtensions) {
                if (k.endsWith(ext)) {
                    return true;
                }
            }
            return false;
        });
    }
    _createOrUpdateProgram() {
        return Promise.resolve()
            .then(() => {
            // Get the root files from the ts config.
            // When a new root name (like a lazy route) is added, it won't be available from
            // following imports on the existing files, so we need to get the new list of root files.
            const config = ngtools_api_1.readConfiguration(this._tsConfigPath);
            this._rootNames = config.rootNames.concat(...this._singleFileIncludes);
            // Update the forked type checker with all changed compilation files.
            // This includes templates, that also need to be reloaded on the type checker.
            if (this._forkTypeChecker && this._typeCheckerProcess && !this._firstRun) {
                this._updateForkedTypeChecker(this._rootNames, this._getChangedCompilationFiles());
            }
            // Use an identity function as all our paths are absolute already.
            this._moduleResolutionCache = ts.createModuleResolutionCache(this._basePath, x => x);
            const tsProgram = this._getTsProgram();
            const oldFiles = new Set(tsProgram ?
                tsProgram.getSourceFiles().map(sf => sf.fileName)
                : []);
            if (this._JitMode) {
                // Create the TypeScript program.
                benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
                this._program = ts.createProgram(this._rootNames, this._compilerOptions, this._compilerHost, tsProgram);
                benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
                const newFiles = this._program.getSourceFiles().filter(sf => !oldFiles.has(sf.fileName));
                for (const newFile of newFiles) {
                    this._compilerHost.invalidate(newFile.fileName);
                }
                return Promise.resolve();
            }
            else {
                benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
                // Create the Angular program.
                this._program = ngtools_api_1.createProgram({
                    rootNames: this._rootNames,
                    options: this._compilerOptions,
                    host: this._compilerHost,
                    oldProgram: this._program,
                });
                benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
                benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync');
                return this._program.loadNgStructureAsync()
                    .then(() => {
                    benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync');
                    const newFiles = this._program.getTsProgram()
                        .getSourceFiles().filter(sf => !oldFiles.has(sf.fileName));
                    for (const newFile of newFiles) {
                        this._compilerHost.invalidate(newFile.fileName);
                    }
                });
            }
        })
            .then(() => {
            // If there's still no entryModule try to resolve from mainPath.
            if (!this._entryModule && this._mainPath) {
                benchmark_1.time('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
                this._entryModule = entry_resolver_1.resolveEntryModuleFromMain(this._mainPath, this._compilerHost, this._getTsProgram());
                benchmark_1.timeEnd('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
            }
        });
    }
    _getLazyRoutesFromNgtools() {
        try {
            benchmark_1.time('AngularCompilerPlugin._getLazyRoutesFromNgtools');
            const result = ngtools_api_1.__NGTOOLS_PRIVATE_API_2.listLazyRoutes({
                program: this._getTsProgram(),
                host: this._compilerHost,
                angularCompilerOptions: Object.assign({}, this._compilerOptions, {
                    // genDir seems to still be needed in @angular\compiler-cli\src\compiler_host.js:226.
                    genDir: '',
                }),
                // TODO: fix compiler-cli typings; entryModule should not be string, but also optional.
                // tslint:disable-next-line:no-non-null-assertion
                entryModule: this._entryModule,
            });
            benchmark_1.timeEnd('AngularCompilerPlugin._getLazyRoutesFromNgtools');
            return result;
        }
        catch (err) {
            // We silence the error that the @angular/router could not be found. In that case, there is
            // basically no route supported by the app itself.
            if (err.message.startsWith('Could not resolve module @angular/router')) {
                return {};
            }
            else {
                throw err;
            }
        }
    }
    _findLazyRoutesInAst(changedFilePaths) {
        benchmark_1.time('AngularCompilerPlugin._findLazyRoutesInAst');
        const result = Object.create(null);
        for (const filePath of changedFilePaths) {
            const fileLazyRoutes = lazy_routes_1.findLazyRoutes(filePath, this._compilerHost, undefined, this._compilerOptions);
            for (const routeKey of Object.keys(fileLazyRoutes)) {
                const route = fileLazyRoutes[routeKey];
                result[routeKey] = route;
            }
        }
        benchmark_1.timeEnd('AngularCompilerPlugin._findLazyRoutesInAst');
        return result;
    }
    _listLazyRoutesFromProgram() {
        const ngProgram = this._program;
        if (!ngProgram.listLazyRoutes) {
            throw new Error('_listLazyRoutesFromProgram was called with an old program.');
        }
        const lazyRoutes = ngProgram.listLazyRoutes();
        return lazyRoutes.reduce((acc, curr) => {
            const ref = curr.route;
            if (ref in acc && acc[ref] !== curr.referencedModule.filePath) {
                throw new Error(+`Duplicated path in loadChildren detected: "${ref}" is used in 2 loadChildren, `
                    + `but they point to different modules "(${acc[ref]} and `
                    + `"${curr.referencedModule.filePath}"). Webpack cannot distinguish on context and `
                    + 'would fail to load the proper one.');
            }
            acc[ref] = curr.referencedModule.filePath;
            return acc;
        }, {});
    }
    // Process the lazy routes discovered, adding then to _lazyRoutes.
    // TODO: find a way to remove lazy routes that don't exist anymore.
    // This will require a registry of known references to a lazy route, removing it when no
    // module references it anymore.
    _processLazyRoutes(discoveredLazyRoutes) {
        Object.keys(discoveredLazyRoutes)
            .forEach(lazyRouteKey => {
            const [lazyRouteModule, moduleName] = lazyRouteKey.split('#');
            if (!lazyRouteModule) {
                return;
            }
            const lazyRouteTSFile = discoveredLazyRoutes[lazyRouteKey].replace(/\\/g, '/');
            let modulePath, moduleKey;
            if (this._JitMode) {
                modulePath = lazyRouteTSFile;
                moduleKey = `${lazyRouteModule}${moduleName ? '#' + moduleName : ''}`;
            }
            else {
                modulePath = lazyRouteTSFile.replace(/(\.d)?\.tsx?$/, '');
                modulePath += '.ngfactory.js';
                const factoryModuleName = moduleName ? `#${moduleName}NgFactory` : '';
                moduleKey = `${lazyRouteModule}.ngfactory${factoryModuleName}`;
            }
            modulePath = compiler_host_1.workaroundResolve(modulePath);
            if (moduleKey in this._lazyRoutes) {
                if (this._lazyRoutes[moduleKey] !== modulePath) {
                    // Found a duplicate, this is an error.
                    this._warnings.push(new Error(`Duplicated path in loadChildren detected during a rebuild. `
                        + `We will take the latest version detected and override it to save rebuild time. `
                        + `You should perform a full build to validate that your routes don't overlap.`));
                }
            }
            else {
                // Found a new route, add it to the map.
                this._lazyRoutes[moduleKey] = modulePath;
            }
        });
    }
    _createForkedTypeChecker() {
        // Bootstrap type checker is using local CLI.
        const g = typeof global !== 'undefined' ? global : {}; // tslint:disable-line:no-any
        const typeCheckerFile = g['_DevKitIsLocal']
            ? './type_checker_bootstrap.js'
            : './type_checker_worker.js';
        const debugArgRegex = /--inspect(?:-brk|-port)?|--debug(?:-brk|-port)/;
        const execArgv = process.execArgv.filter((arg) => {
            // Remove debug args.
            // Workaround for https://github.com/nodejs/node/issues/9435
            return !debugArgRegex.test(arg);
        });
        // Signal the process to start listening for messages
        // Solves https://github.com/angular/angular-cli/issues/9071
        const forkArgs = [type_checker_1.AUTO_START_ARG];
        const forkOptions = { execArgv };
        this._typeCheckerProcess = child_process_1.fork(path.resolve(__dirname, typeCheckerFile), forkArgs, forkOptions);
        // Handle child process exit.
        this._typeCheckerProcess.once('exit', (_, signal) => {
            this._typeCheckerProcess = null;
            // If process exited not because of SIGTERM (see _killForkedTypeChecker), than something
            // went wrong and it should fallback to type checking on the main thread.
            if (signal !== 'SIGTERM') {
                this._forkTypeChecker = false;
                const msg = 'AngularCompilerPlugin: Forked Type Checker exited unexpectedly. ' +
                    'Falling back to type checking on main thread.';
                this._warnings.push(msg);
            }
        });
    }
    _killForkedTypeChecker() {
        if (this._typeCheckerProcess && this._typeCheckerProcess.pid) {
            treeKill(this._typeCheckerProcess.pid, 'SIGTERM');
            this._typeCheckerProcess = null;
        }
    }
    _updateForkedTypeChecker(rootNames, changedCompilationFiles) {
        if (this._typeCheckerProcess) {
            if (!this._forkedTypeCheckerInitialized) {
                this._typeCheckerProcess.send(new type_checker_1.InitMessage(this._compilerOptions, this._basePath, this._JitMode, this._rootNames));
                this._forkedTypeCheckerInitialized = true;
            }
            this._typeCheckerProcess.send(new type_checker_1.UpdateMessage(rootNames, changedCompilationFiles));
        }
    }
    // Registration hook for webpack plugin.
    apply(compiler) {
        // Decorate inputFileSystem to serve contents of CompilerHost.
        // Use decorated inputFileSystem in watchFileSystem.
        compiler.hooks.environment.tap('angular-compiler', () => {
            // The webpack types currently do not include these
            const compilerWithFileSystems = compiler;
            let host = this._options.host || new webpack_input_host_1.WebpackInputHost(compilerWithFileSystems.inputFileSystem);
            let replacements;
            if (this._options.hostReplacementPaths) {
                if (typeof this._options.hostReplacementPaths == 'function') {
                    const replacementResolver = this._options.hostReplacementPaths;
                    replacements = path => core_1.normalize(replacementResolver(core_1.getSystemPath(path)));
                    host = new class extends core_1.virtualFs.ResolverHost {
                        _resolve(path) {
                            return core_1.normalize(replacementResolver(core_1.getSystemPath(path)));
                        }
                    }(host);
                }
                else {
                    replacements = new Map();
                    const aliasHost = new core_1.virtualFs.AliasHost(host);
                    for (const from in this._options.hostReplacementPaths) {
                        const normalizedFrom = core_1.resolve(core_1.normalize(this._basePath), core_1.normalize(from));
                        const normalizedWith = core_1.resolve(core_1.normalize(this._basePath), core_1.normalize(this._options.hostReplacementPaths[from]));
                        aliasHost.aliases.set(normalizedFrom, normalizedWith);
                        replacements.set(normalizedFrom, normalizedWith);
                    }
                    host = aliasHost;
                }
            }
            // Create the webpack compiler host.
            const webpackCompilerHost = new compiler_host_1.WebpackCompilerHost(this._compilerOptions, this._basePath, host);
            // Create and set a new WebpackResourceLoader.
            this._resourceLoader = new resource_loader_1.WebpackResourceLoader();
            webpackCompilerHost.setResourceLoader(this._resourceLoader);
            // Use the WebpackCompilerHost with a resource loader to create an AngularCompilerHost.
            this._compilerHost = ngtools_api_1.createCompilerHost({
                options: this._compilerOptions,
                tsHost: webpackCompilerHost,
            });
            // Resolve mainPath if provided.
            if (this._options.mainPath) {
                this._mainPath = this._compilerHost.resolve(this._options.mainPath);
            }
            const inputDecorator = new virtual_file_system_decorator_1.VirtualFileSystemDecorator(compilerWithFileSystems.inputFileSystem, this._compilerHost);
            compilerWithFileSystems.inputFileSystem = inputDecorator;
            compilerWithFileSystems.watchFileSystem = new virtual_file_system_decorator_1.VirtualWatchFileSystemDecorator(inputDecorator, replacements);
        });
        // Add lazy modules to the context module for @angular/core
        compiler.hooks.contextModuleFactory.tap('angular-compiler', cmf => {
            const angularCorePackagePath = require.resolve('@angular/core/package.json');
            // APFv6 does not have single FESM anymore. Instead of verifying if we're pointing to
            // FESMs, we resolve the `@angular/core` path and verify that the path for the
            // module starts with it.
            // This may be slower but it will be compatible with both APF5, 6 and potential future
            // versions (until the dynamic import appears outside of core I suppose).
            // We resolve any symbolic links in order to get the real path that would be used in webpack.
            const angularCoreDirname = fs.realpathSync(path.dirname(angularCorePackagePath));
            cmf.hooks.afterResolve.tapPromise('angular-compiler', (result) => __awaiter(this, void 0, void 0, function* () {
                // Alter only request from Angular.
                if (!result || !this.done || !result.resource.startsWith(angularCoreDirname)) {
                    return result;
                }
                return this.done.then(() => {
                    // This folder does not exist, but we need to give webpack a resource.
                    // TODO: check if we can't just leave it as is (angularCoreModuleDir).
                    result.resource = path.join(this._basePath, '$$_lazy_route_resource');
                    // tslint:disable-next-line:no-any
                    result.dependencies.forEach((d) => d.critical = false);
                    // tslint:disable-next-line:no-any
                    result.resolveDependencies = (_fs, options, callback) => {
                        const dependencies = Object.keys(this._lazyRoutes)
                            .map((key) => {
                            const modulePath = this._lazyRoutes[key];
                            const importPath = key.split('#')[0];
                            if (modulePath !== null) {
                                const name = importPath.replace(/(\.ngfactory)?\.(js|ts)$/, '');
                                return new this._contextElementDependencyConstructor(modulePath, name);
                            }
                            else {
                                return null;
                            }
                        })
                            .filter(x => !!x);
                        if (this._options.nameLazyFiles) {
                            options.chunkName = '[request]';
                        }
                        callback(null, dependencies);
                    };
                    return result;
                }, () => undefined);
            }));
        });
        // Create and destroy forked type checker on watch mode.
        compiler.hooks.watchRun.tap('angular-compiler', () => {
            if (this._forkTypeChecker && !this._typeCheckerProcess) {
                this._createForkedTypeChecker();
            }
        });
        compiler.hooks.watchClose.tap('angular-compiler', () => this._killForkedTypeChecker());
        // Remake the plugin on each compilation.
        compiler.hooks.make.tapPromise('angular-compiler', compilation => this._make(compilation));
        compiler.hooks.invalid.tap('angular-compiler', () => this._firstRun = false);
        compiler.hooks.afterEmit.tap('angular-compiler', compilation => {
            // tslint:disable-next-line:no-any
            compilation._ngToolsWebpackPluginInstance = null;
        });
        compiler.hooks.done.tap('angular-compiler', () => {
            this._donePromise = null;
        });
        compiler.hooks.afterResolvers.tap('angular-compiler', compiler => {
            compiler.hooks.normalModuleFactory.tap('angular-compiler', nmf => {
                // Virtual file system.
                // TODO: consider if it's better to remove this plugin and instead make it wait on the
                // VirtualFileSystemDecorator.
                // Wait for the plugin to be done when requesting `.ts` files directly (entry points), or
                // when the issuer is a `.ts` or `.ngfactory.js` file.
                nmf.hooks.beforeResolve.tapPromise('angular-compiler', (request) => __awaiter(this, void 0, void 0, function* () {
                    if (this.done && request) {
                        const name = request.request;
                        const issuer = request.contextInfo.issuer;
                        if (name.endsWith('.ts') || name.endsWith('.tsx')
                            || (issuer && /\.ts|ngfactory\.js$/.test(issuer))) {
                            try {
                                yield this.done;
                            }
                            catch (_a) { }
                        }
                    }
                    return request;
                }));
            });
        });
        compiler.hooks.normalModuleFactory.tap('angular-compiler', nmf => {
            nmf.hooks.beforeResolve.tapAsync('angular-compiler', (request, callback) => {
                paths_plugin_1.resolveWithPaths(request, callback, this._compilerOptions, this._compilerHost, this._moduleResolutionCache);
            });
        });
    }
    _make(compilation) {
        return __awaiter(this, void 0, void 0, function* () {
            benchmark_1.time('AngularCompilerPlugin._make');
            this._emitSkipped = true;
            // tslint:disable-next-line:no-any
            if (compilation._ngToolsWebpackPluginInstance) {
                throw new Error('An @ngtools/webpack plugin already exist for this compilation.');
            }
            // Set a private variable for this plugin instance.
            // tslint:disable-next-line:no-any
            compilation._ngToolsWebpackPluginInstance = this;
            // Update the resource loader with the new webpack compilation.
            this._resourceLoader.update(compilation);
            return this._donePromise = Promise.resolve()
                .then(() => this._update())
                .then(() => {
                this.pushCompilationErrors(compilation);
                benchmark_1.timeEnd('AngularCompilerPlugin._make');
            }, err => {
                compilation.errors.push(err);
                this.pushCompilationErrors(compilation);
                benchmark_1.timeEnd('AngularCompilerPlugin._make');
            });
        });
    }
    pushCompilationErrors(compilation) {
        compilation.errors.push(...this._errors);
        compilation.warnings.push(...this._warnings);
        this._errors = [];
        this._warnings = [];
    }
    _makeTransformers() {
        const isAppPath = (fileName) => !fileName.endsWith('.ngfactory.ts') && !fileName.endsWith('.ngstyle.ts');
        const isMainPath = (fileName) => fileName === (this._mainPath ? compiler_host_1.workaroundResolve(this._mainPath) : this._mainPath);
        const getEntryModule = () => this.entryModule
            ? { path: compiler_host_1.workaroundResolve(this.entryModule.path), className: this.entryModule.className }
            : this.entryModule;
        const getLazyRoutes = () => this._lazyRoutes;
        const getTypeChecker = () => this._getTsProgram().getTypeChecker();
        if (this._JitMode) {
            // Replace resources in JIT.
            this._transformers.push(transformers_1.replaceResources(isAppPath));
        }
        else {
            // Remove unneeded angular decorators.
            this._transformers.push(transformers_1.removeDecorators(isAppPath, getTypeChecker));
        }
        if (this._platformTransformers !== null) {
            this._transformers.push(...this._platformTransformers);
        }
        else {
            if (this._platform === PLATFORM.Browser) {
                // If we have a locale, auto import the locale data file.
                // This transform must go before replaceBootstrap because it looks for the entry module
                // import, which will be replaced.
                if (this._normalizedLocale) {
                    this._transformers.push(transformers_1.registerLocaleData(isAppPath, getEntryModule, this._normalizedLocale));
                }
                if (!this._JitMode) {
                    // Replace bootstrap in browser AOT.
                    this._transformers.push(transformers_1.replaceBootstrap(isAppPath, getEntryModule, getTypeChecker));
                }
            }
            else if (this._platform === PLATFORM.Server) {
                this._transformers.push(transformers_1.exportLazyModuleMap(isMainPath, getLazyRoutes));
                if (!this._JitMode) {
                    this._transformers.push(transformers_1.exportNgFactory(isMainPath, getEntryModule), transformers_1.replaceServerBootstrap(isMainPath, getEntryModule, getTypeChecker));
                }
            }
        }
    }
    _update() {
        benchmark_1.time('AngularCompilerPlugin._update');
        // We only want to update on TS and template changes, but all kinds of files are on this
        // list, like package.json and .ngsummary.json files.
        const changedFiles = this._getChangedCompilationFiles();
        // If nothing we care about changed and it isn't the first run, don't do anything.
        if (changedFiles.length === 0 && !this._firstRun) {
            return Promise.resolve();
        }
        return Promise.resolve()
            // Make a new program and load the Angular structure.
            .then(() => this._createOrUpdateProgram())
            .then(() => {
            if (this.entryModule) {
                // Try to find lazy routes if we have an entry module.
                // We need to run the `listLazyRoutes` the first time because it also navigates libraries
                // and other things that we might miss using the (faster) findLazyRoutesInAst.
                // Lazy routes modules will be read with compilerHost and added to the changed files.
                if (this._ngCompilerSupportsNewApi) {
                    this._processLazyRoutes(this._listLazyRoutesFromProgram());
                }
                else if (this._firstRun) {
                    this._processLazyRoutes(this._getLazyRoutesFromNgtools());
                }
                else {
                    const changedTsFiles = this._getChangedTsFiles();
                    if (changedTsFiles.length > 0) {
                        this._processLazyRoutes(this._findLazyRoutesInAst(changedTsFiles));
                    }
                }
                if (this._options.additionalLazyModules) {
                    this._processLazyRoutes(this._options.additionalLazyModules);
                }
            }
        })
            .then(() => {
            // Emit and report errors.
            // We now have the final list of changed TS files.
            // Go through each changed file and add transforms as needed.
            const sourceFiles = this._getChangedTsFiles()
                .map((fileName) => this._getTsProgram().getSourceFile(fileName))
                // At this point we shouldn't need to filter out undefined files, because any ts file
                // that changed should be emitted.
                // But due to hostReplacementPaths there can be files (the environment files)
                // that changed but aren't part of the compilation, specially on `ng test`.
                // So we ignore missing source files files here.
                // hostReplacementPaths needs to be fixed anyway to take care of the following issue.
                // https://github.com/angular/angular-cli/issues/7305#issuecomment-332150230
                .filter((x) => !!x);
            // Emit files.
            benchmark_1.time('AngularCompilerPlugin._update._emit');
            const { emitResult, diagnostics } = this._emit(sourceFiles);
            benchmark_1.timeEnd('AngularCompilerPlugin._update._emit');
            // Report diagnostics.
            const errors = diagnostics
                .filter((diag) => diag.category === ts.DiagnosticCategory.Error);
            const warnings = diagnostics
                .filter((diag) => diag.category === ts.DiagnosticCategory.Warning);
            if (errors.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(errors);
                this._errors.push(new Error(message));
            }
            if (warnings.length > 0) {
                const message = ngtools_api_1.formatDiagnostics(warnings);
                this._warnings.push(message);
            }
            this._emitSkipped = !emitResult || emitResult.emitSkipped;
            // Reset changed files on successful compilation.
            if (!this._emitSkipped && this._errors.length === 0) {
                this._compilerHost.resetChangedFileTracker();
            }
            benchmark_1.timeEnd('AngularCompilerPlugin._update');
        });
    }
    writeI18nOutFile() {
        function _recursiveMkDir(p) {
            if (!fs.existsSync(p)) {
                _recursiveMkDir(path.dirname(p));
                fs.mkdirSync(p);
            }
        }
        // Write the extracted messages to disk.
        if (this._compilerOptions.i18nOutFile) {
            const i18nOutFilePath = path.resolve(this._basePath, this._compilerOptions.i18nOutFile);
            const i18nOutFileContent = this._compilerHost.readFile(i18nOutFilePath);
            if (i18nOutFileContent) {
                _recursiveMkDir(path.dirname(i18nOutFilePath));
                fs.writeFileSync(i18nOutFilePath, i18nOutFileContent);
            }
        }
    }
    getCompiledFile(fileName) {
        const outputFile = fileName.replace(/.tsx?$/, '.js');
        let outputText;
        let sourceMap;
        let errorDependencies = [];
        if (this._emitSkipped) {
            const text = this._compilerHost.readFile(outputFile);
            if (text) {
                // If the compilation didn't emit files this time, try to return the cached files from the
                // last compilation and let the compilation errors show what's wrong.
                outputText = text;
                sourceMap = this._compilerHost.readFile(outputFile + '.map');
            }
            else {
                // There's nothing we can serve. Return an empty string to prevent lenghty webpack errors,
                // add the rebuild warning if it's not there yet.
                // We also need to all changed files as dependencies of this file, so that all of them
                // will be watched and trigger a rebuild next time.
                outputText = '';
                errorDependencies = this._getChangedCompilationFiles()
                    // These paths are used by the loader so we must denormalize them.
                    .map((p) => this._compilerHost.denormalizePath(p));
            }
        }
        else {
            // Check if the TS input file and the JS output file exist.
            if (((fileName.endsWith('.ts') || fileName.endsWith('.tsx'))
                && !this._compilerHost.fileExists(fileName))
                || !this._compilerHost.fileExists(outputFile, false)) {
                let msg = `${fileName} is missing from the TypeScript compilation. `
                    + `Please make sure it is in your tsconfig via the 'files' or 'include' property.`;
                if (/(\\|\/)node_modules(\\|\/)/.test(fileName)) {
                    msg += '\nThe missing file seems to be part of a third party library. '
                        + 'TS files in published libraries are often a sign of a badly packaged library. '
                        + 'Please open an issue in the library repository to alert its author and ask them '
                        + 'to package the library using the Angular Package Format (https://goo.gl/jB3GVv).';
                }
                throw new Error(msg);
            }
            outputText = this._compilerHost.readFile(outputFile) || '';
            sourceMap = this._compilerHost.readFile(outputFile + '.map');
        }
        return { outputText, sourceMap, errorDependencies };
    }
    getDependencies(fileName) {
        const resolvedFileName = this._compilerHost.resolve(fileName);
        const sourceFile = this._compilerHost.getSourceFile(resolvedFileName, ts.ScriptTarget.Latest);
        if (!sourceFile) {
            return [];
        }
        const options = this._compilerOptions;
        const host = this._compilerHost;
        const cache = this._moduleResolutionCache;
        const esImports = ast_helpers_1.collectDeepNodes(sourceFile, ts.SyntaxKind.ImportDeclaration)
            .map(decl => {
            const moduleName = decl.moduleSpecifier.text;
            const resolved = ts.resolveModuleName(moduleName, resolvedFileName, options, host, cache);
            if (resolved.resolvedModule) {
                return resolved.resolvedModule.resolvedFileName;
            }
            else {
                return null;
            }
        })
            .filter(x => x);
        const resourceImports = transformers_1.findResources(sourceFile)
            .map((resourceReplacement) => resourceReplacement.resourcePaths)
            .reduce((prev, curr) => prev.concat(curr), [])
            .map((resourcePath) => core_1.resolve(core_1.dirname(resolvedFileName), core_1.normalize(resourcePath)));
        // These paths are meant to be used by the loader so we must denormalize them.
        const uniqueDependencies = new Set([
            ...esImports,
            ...resourceImports,
            ...this.getResourceDependencies(this._compilerHost.denormalizePath(resolvedFileName)),
        ].map((p) => p && this._compilerHost.denormalizePath(p)));
        return [...uniqueDependencies]
            .filter(x => !!x);
    }
    getResourceDependencies(fileName) {
        return this._resourceLoader.getResourceDependencies(fileName);
    }
    // This code mostly comes from `performCompilation` in `@angular/compiler-cli`.
    // It skips the program creation because we need to use `loadNgStructureAsync()`,
    // and uses CustomTransformers.
    _emit(sourceFiles) {
        benchmark_1.time('AngularCompilerPlugin._emit');
        const program = this._program;
        const allDiagnostics = [];
        let emitResult;
        try {
            if (this._JitMode) {
                const tsProgram = program;
                if (this._firstRun) {
                    // Check parameter diagnostics.
                    benchmark_1.time('AngularCompilerPlugin._emit.ts.getOptionsDiagnostics');
                    allDiagnostics.push(...tsProgram.getOptionsDiagnostics());
                    benchmark_1.timeEnd('AngularCompilerPlugin._emit.ts.getOptionsDiagnostics');
                }
                if ((this._firstRun || !this._forkTypeChecker) && this._program) {
                    allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'AngularCompilerPlugin._emit.ts'));
                }
                if (!gather_diagnostics_1.hasErrors(allDiagnostics)) {
                    if (this._firstRun || sourceFiles.length > 20) {
                        emitResult = tsProgram.emit(undefined, undefined, undefined, undefined, { before: this._transformers });
                        allDiagnostics.push(...emitResult.diagnostics);
                    }
                    else {
                        sourceFiles.forEach((sf) => {
                            const timeLabel = `AngularCompilerPlugin._emit.ts+${sf.fileName}+.emit`;
                            benchmark_1.time(timeLabel);
                            emitResult = tsProgram.emit(sf, undefined, undefined, undefined, { before: this._transformers });
                            allDiagnostics.push(...emitResult.diagnostics);
                            benchmark_1.timeEnd(timeLabel);
                        });
                    }
                }
            }
            else {
                const angularProgram = program;
                // Check Angular structural diagnostics.
                benchmark_1.time('AngularCompilerPlugin._emit.ng.getNgStructuralDiagnostics');
                allDiagnostics.push(...angularProgram.getNgStructuralDiagnostics());
                benchmark_1.timeEnd('AngularCompilerPlugin._emit.ng.getNgStructuralDiagnostics');
                if (this._firstRun) {
                    // Check TypeScript parameter diagnostics.
                    benchmark_1.time('AngularCompilerPlugin._emit.ng.getTsOptionDiagnostics');
                    allDiagnostics.push(...angularProgram.getTsOptionDiagnostics());
                    benchmark_1.timeEnd('AngularCompilerPlugin._emit.ng.getTsOptionDiagnostics');
                    // Check Angular parameter diagnostics.
                    benchmark_1.time('AngularCompilerPlugin._emit.ng.getNgOptionDiagnostics');
                    allDiagnostics.push(...angularProgram.getNgOptionDiagnostics());
                    benchmark_1.timeEnd('AngularCompilerPlugin._emit.ng.getNgOptionDiagnostics');
                }
                if ((this._firstRun || !this._forkTypeChecker) && this._program) {
                    allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'AngularCompilerPlugin._emit.ng'));
                }
                if (!gather_diagnostics_1.hasErrors(allDiagnostics)) {
                    benchmark_1.time('AngularCompilerPlugin._emit.ng.emit');
                    const extractI18n = !!this._compilerOptions.i18nOutFile;
                    const emitFlags = extractI18n ? ngtools_api_1.EmitFlags.I18nBundle : ngtools_api_1.EmitFlags.Default;
                    emitResult = angularProgram.emit({
                        emitFlags, customTransformers: {
                            beforeTs: this._transformers,
                        },
                    });
                    allDiagnostics.push(...emitResult.diagnostics);
                    if (extractI18n) {
                        this.writeI18nOutFile();
                    }
                    benchmark_1.timeEnd('AngularCompilerPlugin._emit.ng.emit');
                }
            }
        }
        catch (e) {
            benchmark_1.time('AngularCompilerPlugin._emit.catch');
            // This function is available in the import below, but this way we avoid the dependency.
            // import { isSyntaxError } from '@angular/compiler';
            function isSyntaxError(error) {
                return error['ngSyntaxError']; // tslint:disable-line:no-any
            }
            let errMsg;
            let code;
            if (isSyntaxError(e)) {
                // don't report the stack for syntax errors as they are well known errors.
                errMsg = e.message;
                code = ngtools_api_1.DEFAULT_ERROR_CODE;
            }
            else {
                errMsg = e.stack;
                // It is not a syntax error we might have a program with unknown state, discard it.
                this._program = null;
                code = ngtools_api_1.UNKNOWN_ERROR_CODE;
            }
            allDiagnostics.push({ category: ts.DiagnosticCategory.Error, messageText: errMsg, code, source: ngtools_api_1.SOURCE });
            benchmark_1.timeEnd('AngularCompilerPlugin._emit.catch');
        }
        benchmark_1.timeEnd('AngularCompilerPlugin._emit');
        return { program, emitResult, diagnostics: allDiagnostics };
    }
    _validateLocale(locale) {
        // Get the path of the common module.
        const commonPath = path.dirname(require.resolve('@angular/common/package.json'));
        // Check if the locale file exists
        if (!fs.existsSync(path.resolve(commonPath, 'locales', `${locale}.js`))) {
            // Check for an alternative locale (if the locale id was badly formatted).
            const locales = fs.readdirSync(path.resolve(commonPath, 'locales'))
                .filter(file => file.endsWith('.js'))
                .map(file => file.replace('.js', ''));
            let newLocale;
            const normalizedLocale = locale.toLowerCase().replace(/_/g, '-');
            for (const l of locales) {
                if (l.toLowerCase() === normalizedLocale) {
                    newLocale = l;
                    break;
                }
            }
            if (newLocale) {
                locale = newLocale;
            }
            else {
                // Check for a parent locale
                const parentLocale = normalizedLocale.split('-')[0];
                if (locales.indexOf(parentLocale) !== -1) {
                    locale = parentLocale;
                }
                else {
                    this._warnings.push(`AngularCompilerPlugin: Unable to load the locale data file ` +
                        `"@angular/common/locales/${locale}", ` +
                        `please check that "${locale}" is a valid locale id.
            If needed, you can use "registerLocaleData" manually.`);
                    return null;
                }
            }
        }
        return locale;
    }
}
exports.AngularCompilerPlugin = AngularCompilerPlugin;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFtRztBQUNuRyxpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9FO0FBQ3BFLCtDQUE2RDtBQUM3RCwrQ0FnQnVCO0FBQ3ZCLGlEQUFrRDtBQUNsRCx1REFBMEQ7QUFDMUQsaURBU3dCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFBNEU7QUFDNUUsbUZBR3lDO0FBT3pDLDZEQUF3RDtBQUV4RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7QUE4Q3RDLElBQVksUUFHWDtBQUhELFdBQVksUUFBUTtJQUNsQiw2Q0FBTyxDQUFBO0lBQ1AsMkNBQU0sQ0FBQTtBQUNSLENBQUMsRUFIVyxRQUFRLEdBQVIsZ0JBQVEsS0FBUixnQkFBUSxRQUduQjtBQUVELE1BQWEscUJBQXFCO0lBNkNoQyxZQUFZLE9BQXFDO1FBdkN6Qyx3QkFBbUIsR0FBYSxFQUFFLENBQUM7UUFLM0MsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUVo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QUksU0FBUyxDQUFDO1lBQ2QsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNqRSxLQUFLLE1BQU0sQ0FBQyxJQUFJLE9BQU8sRUFBRTtnQkFDdkIsSUFBSSxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssZ0JBQWdCLEVBQUU7b0JBQ3hDLFNBQVMsR0FBRyxDQUFDLENBQUM7b0JBQ2QsTUFBTTtpQkFDUDthQUNGO1lBRUQsSUFBSSxTQUFTLEVBQUU7Z0JBQ2IsTUFBTSxHQUFHLFNBQVMsQ0FBQzthQUNwQjtpQkFBTTtnQkFDTCw0QkFBNEI7Z0JBQzVCLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEQsSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO29CQUN4QyxNQUFNLEdBQUcsWUFBWSxDQUFDO2lCQUN2QjtxQkFBTTtvQkFDTCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyw2REFBNkQ7d0JBQy9FLDRCQUE0QixNQUFNLEtBQUs7d0JBQ3ZDLHNCQUFzQixNQUFNO2tFQUMwQixDQUFDLENBQUM7b0JBRTFELE9BQU8sSUFBSSxDQUFDO2lCQUNiO2FBQ0Y7U0FDRjtRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7Q0FDRjtBQXBsQ0Qsc0RBb2xDQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7IFBhdGgsIGRpcm5hbWUsIGdldFN5c3RlbVBhdGgsIG5vcm1hbGl6ZSwgcmVzb2x2ZSwgdmlydHVhbEZzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBGb3JrT3B0aW9ucywgZm9yayB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgQ29tcGlsZXIsIGNvbXBpbGF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCwgd29ya2Fyb3VuZFJlc29sdmUgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4gfSBmcm9tICcuL2VudHJ5X3Jlc29sdmVyJztcbmltcG9ydCB7IGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBMYXp5Um91dGVNYXAsIGZpbmRMYXp5Um91dGVzIH0gZnJvbSAnLi9sYXp5X3JvdXRlcyc7XG5pbXBvcnQge1xuICBDb21waWxlckNsaUlzU3VwcG9ydGVkLFxuICBDb21waWxlckhvc3QsXG4gIENvbXBpbGVyT3B0aW9ucyxcbiAgREVGQVVMVF9FUlJPUl9DT0RFLFxuICBEaWFnbm9zdGljLFxuICBFbWl0RmxhZ3MsXG4gIFByb2dyYW0sXG4gIFNPVVJDRSxcbiAgVU5LTk9XTl9FUlJPUl9DT0RFLFxuICBWRVJTSU9OLFxuICBfX05HVE9PTFNfUFJJVkFURV9BUElfMixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJy4vbmd0b29sc19hcGknO1xuaW1wb3J0IHsgcmVzb2x2ZVdpdGhQYXRocyB9IGZyb20gJy4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7XG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHsgQVVUT19TVEFSVF9BUkcsIEluaXRNZXNzYWdlLCBVcGRhdGVNZXNzYWdlIH0gZnJvbSAnLi90eXBlX2NoZWNrZXInO1xuaW1wb3J0IHtcbiAgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG4gIFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG59IGZyb20gJy4vdmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3InO1xuaW1wb3J0IHtcbiAgQ2FsbGJhY2ssXG4gIElucHV0RmlsZVN5c3RlbSxcbiAgTm9kZVdhdGNoRmlsZVN5c3RlbUludGVyZmFjZSxcbiAgTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QsXG59IGZyb20gJy4vd2VicGFjayc7XG5pbXBvcnQgeyBXZWJwYWNrSW5wdXRIb3N0IH0gZnJvbSAnLi93ZWJwYWNrLWlucHV0LWhvc3QnO1xuXG5jb25zdCB0cmVlS2lsbCA9IHJlcXVpcmUoJ3RyZWUta2lsbCcpO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB7fVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yIHtcbiAgbmV3KG1vZHVsZVBhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nKTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5O1xufVxuXG4vKipcbiAqIE9wdGlvbiBDb25zdGFudHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zIHtcbiAgc291cmNlTWFwPzogYm9vbGVhbjtcbiAgdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIGJhc2VQYXRoPzogc3RyaW5nO1xuICBlbnRyeU1vZHVsZT86IHN0cmluZztcbiAgbWFpblBhdGg/OiBzdHJpbmc7XG4gIHNraXBDb2RlR2VuZXJhdGlvbj86IGJvb2xlYW47XG4gIGhvc3RSZXBsYWNlbWVudFBhdGhzPzogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0gfCAoKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nKTtcbiAgZm9ya1R5cGVDaGVja2VyPzogYm9vbGVhbjtcbiAgLy8gVE9ETzogcmVtb3ZlIHNpbmdsZUZpbGVJbmNsdWRlcyBmb3IgMi4wLCB0aGlzIGlzIGp1c3QgdG8gc3VwcG9ydCBvbGQgcHJvamVjdHMgdGhhdCBkaWQgbm90XG4gIC8vIGluY2x1ZGUgJ3BvbHlmaWxscy50cycgaW4gYHRzY29uZmlnLnNwZWMuanNvbicuXG4gIHNpbmdsZUZpbGVJbmNsdWRlcz86IHN0cmluZ1tdO1xuICBpMThuSW5GaWxlPzogc3RyaW5nO1xuICBpMThuSW5Gb3JtYXQ/OiBzdHJpbmc7XG4gIGkxOG5PdXRGaWxlPzogc3RyaW5nO1xuICBpMThuT3V0Rm9ybWF0Pzogc3RyaW5nO1xuICBsb2NhbGU/OiBzdHJpbmc7XG4gIG1pc3NpbmdUcmFuc2xhdGlvbj86IHN0cmluZztcbiAgcGxhdGZvcm0/OiBQTEFURk9STTtcbiAgbmFtZUxhenlGaWxlcz86IGJvb2xlYW47XG5cbiAgLy8gYWRkZWQgdG8gdGhlIGxpc3Qgb2YgbGF6eSByb3V0ZXNcbiAgYWRkaXRpb25hbExhenlNb2R1bGVzPzogeyBbbW9kdWxlOiBzdHJpbmddOiBzdHJpbmcgfTtcblxuICAvLyBUaGUgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IG9mIGNvcnJlY3QgV2VicGFjayBjb21waWxhdGlvbi5cbiAgLy8gVGhpcyBpcyBuZWVkZWQgd2hlbiB0aGVyZSBhcmUgbXVsdGlwbGUgV2VicGFjayBpbnN0YWxscy5cbiAgY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I/OiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjtcblxuICAvLyBVc2UgdHNjb25maWcgdG8gaW5jbHVkZSBwYXRoIGdsb2JzLlxuICBjb21waWxlck9wdGlvbnM/OiB0cy5Db21waWxlck9wdGlvbnM7XG5cbiAgaG9zdD86IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPjtcbiAgcGxhdGZvcm1UcmFuc2Zvcm1lcnM/OiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXTtcbn1cblxuZXhwb3J0IGVudW0gUExBVEZPUk0ge1xuICBCcm93c2VyLFxuICBTZXJ2ZXIsXG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyQ29tcGlsZXJQbHVnaW4ge1xuICBwcml2YXRlIF9vcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zO1xuXG4gIC8vIFRTIGNvbXBpbGF0aW9uLlxuICBwcml2YXRlIF9jb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSBfc2luZ2xlRmlsZUluY2x1ZGVzOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIF9wcm9ncmFtOiAodHMuUHJvZ3JhbSB8IFByb2dyYW0pIHwgbnVsbDtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuICBwcml2YXRlIF9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU6IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZTtcbiAgcHJpdmF0ZSBfcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgLy8gQ29udGFpbnMgYG1vZHVsZUltcG9ydFBhdGgjZXhwb3J0TmFtZWAgPT4gYGZ1bGxNb2R1bGVQYXRoYC5cbiAgcHJpdmF0ZSBfbGF6eVJvdXRlczogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgcHJpdmF0ZSBfdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX2VudHJ5TW9kdWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF9tYWluUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIF9iYXNlUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF90cmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdID0gW107XG4gIHByaXZhdGUgX3BsYXRmb3JtVHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9wbGF0Zm9ybTogUExBVEZPUk07XG4gIHByaXZhdGUgX0ppdE1vZGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBfZW1pdFNraXBwZWQgPSB0cnVlO1xuICBwcml2YXRlIF9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsndHMnLCAnaHRtbCcsICdjc3MnXSk7XG5cbiAgLy8gV2VicGFjayBwbHVnaW4uXG4gIHByaXZhdGUgX2ZpcnN0UnVuID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfZG9uZVByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsO1xuICBwcml2YXRlIF9ub3JtYWxpemVkTG9jYWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF93YXJuaW5nczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG4gIHByaXZhdGUgX2Vycm9yczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG4gIHByaXZhdGUgX2NvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjtcblxuICAvLyBUeXBlQ2hlY2tlciBwcm9jZXNzLlxuICBwcml2YXRlIF9mb3JrVHlwZUNoZWNrZXIgPSB0cnVlO1xuICBwcml2YXRlIF90eXBlQ2hlY2tlclByb2Nlc3M6IENoaWxkUHJvY2VzcyB8IG51bGw7XG4gIHByaXZhdGUgX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICBwcml2YXRlIGdldCBfbmdDb21waWxlclN1cHBvcnRzTmV3QXBpKCkge1xuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAhISh0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0pLmxpc3RMYXp5Um91dGVzO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICBDb21waWxlckNsaUlzU3VwcG9ydGVkKCk7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIGdldCB0eXBlQ2hlY2tlcigpOiB0cy5UeXBlQ2hlY2tlciB8IG51bGwge1xuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuXG4gICAgcmV0dXJuIHRzUHJvZ3JhbSA/IHRzUHJvZ3JhbS5nZXRUeXBlQ2hlY2tlcigpIDogbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIGlmIChvcHRpb25zLnNpbmdsZUZpbGVJbmNsdWRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9zaW5nbGVGaWxlSW5jbHVkZXMucHVzaCguLi5vcHRpb25zLnNpbmdsZUZpbGVJbmNsdWRlcyk7XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgdGhlIHRzY29uZmlnIGNvbnRlbnRzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgaWYgKGNvbmZpZy5lcnJvcnMgJiYgY29uZmlnLmVycm9ycy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihmb3JtYXREaWFnbm9zdGljcyhjb25maWcuZXJyb3JzKSk7XG4gICAgfVxuXG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcy5jb25jYXQoLi4udGhpcy5fc2luZ2xlRmlsZUluY2x1ZGVzKTtcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMgPSB7IC4uLmNvbmZpZy5vcHRpb25zLCAuLi5vcHRpb25zLmNvbXBpbGVyT3B0aW9ucyB9O1xuICAgIHRoaXMuX2Jhc2VQYXRoID0gY29uZmlnLm9wdGlvbnMuYmFzZVBhdGggfHwgYmFzZVBhdGggfHwgJyc7XG5cbiAgICAvLyBPdmVyd3JpdGUgb3V0RGlyIHNvIHdlIGNhbiBmaW5kIGdlbmVyYXRlZCBmaWxlcyBuZXh0IHRvIHRoZWlyIC50cyBvcmlnaW4gaW4gY29tcGlsZXJIb3N0LlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSAnJztcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuXG4gICAgLy8gRGVmYXVsdCBwbHVnaW4gc291cmNlTWFwIHRvIGNvbXBpbGVyIG9wdGlvbnMgc2V0dGluZy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3NvdXJjZU1hcCcpKSB7XG4gICAgICBvcHRpb25zLnNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgfHwgZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gRm9yY2UgdGhlIHJpZ2h0IHNvdXJjZW1hcCBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLnNvdXJjZU1hcCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIC8vIFdlIHdpbGwgc2V0IHRoZSBzb3VyY2UgdG8gdGhlIGZ1bGwgcGF0aCBvZiB0aGUgZmlsZSBpbiB0aGUgbG9hZGVyLCBzbyB3ZSBkb24ndFxuICAgICAgLy8gbmVlZCBzb3VyY2VSb290IGhlcmUuXG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIFdlIHdhbnQgdG8gYWxsb3cgZW1pdHRpbmcgd2l0aCBlcnJvcnMgc28gdGhhdCBpbXBvcnRzIGNhbiBiZSBhZGRlZFxuICAgIC8vIHRvIHRoZSB3ZWJwYWNrIGRlcGVuZGVuY3kgdHJlZSBhbmQgcmVidWlsZHMgdHJpZ2dlcmVkIGJ5IGZpbGUgZWRpdHMuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcblxuICAgIC8vIFNldCBKSVQgKG5vIGNvZGUgZ2VuZXJhdGlvbikgb3IgQU9UIG1vZGUuXG4gICAgaWYgKG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX0ppdE1vZGUgPSBvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbjtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGkxOG4gb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5pMThuSW5GaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5GaWxlID0gb3B0aW9ucy5pMThuSW5GaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuSW5Gb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZvcm1hdCA9IG9wdGlvbnMuaTE4bkluRm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0RmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUgPSBvcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0Rm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0Rm9ybWF0ID0gb3B0aW9ucy5pMThuT3V0Rm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5sb2NhbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkxvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRMb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUgPSB0aGlzLl92YWxpZGF0ZUxvY2FsZShvcHRpb25zLmxvY2FsZSk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTWlzc2luZ1RyYW5zbGF0aW9ucyA9XG4gICAgICAgIG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uIGFzICdlcnJvcicgfCAnd2FybmluZycgfCAnaWdub3JlJztcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGZvcmtlZCB0eXBlIGNoZWNrZXIgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5mb3JrVHlwZUNoZWNrZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gb3B0aW9ucy5mb3JrVHlwZUNoZWNrZXI7XG4gICAgfVxuXG4gICAgLy8gQWRkIGN1c3RvbSBwbGF0Zm9ybSB0cmFuc2Zvcm1lcnMuXG4gICAgaWYgKG9wdGlvbnMucGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgPSBvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHRvIHRoZSBvbmUgd2UgY2FuIGltcG9ydCBmcm9tIGhlcmUuXG4gICAgLy8gRmFpbGluZyB0byB1c2UgdGhlIHJpZ2h0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB3aWxsIHRocm93IHRoZSBlcnJvciBiZWxvdzpcbiAgICAvLyBcIk5vIG1vZHVsZSBmYWN0b3J5IGF2YWlsYWJsZSBmb3IgZGVwZW5kZW5jeSB0eXBlOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lcIlxuICAgIC8vIEhvaXN0aW5nIHRvZ2V0aGVyIHdpdGggcGVlciBkZXBlbmRlbmNpZXMgY2FuIG1ha2UgaXQgc28gdGhlIGltcG9ydGVkXG4gICAgLy8gQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IGRvZXMgbm90IGNvbWUgZnJvbSB0aGUgc2FtZSBXZWJwYWNrIGluc3RhbmNlIHRoYXQgaXMgdXNlZFxuICAgIC8vIGluIHRoZSBjb21waWxhdGlvbi4gSW4gdGhhdCBjYXNlLCB3ZSBjYW4gcGFzcyB0aGUgcmlnaHQgb25lIGFzIGFuIG9wdGlvbiB0byB0aGUgcGx1Z2luLlxuICAgIHRoaXMuX2NvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yID0gb3B0aW9ucy5jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvclxuICAgICAgfHwgcmVxdWlyZSgnd2VicGFjay9saWIvZGVwZW5kZW5jaWVzL0NvbnRleHRFbGVtZW50RGVwZW5kZW5jeScpO1xuXG4gICAgLy8gVXNlIGVudHJ5TW9kdWxlIGlmIGF2YWlsYWJsZSBpbiBvcHRpb25zLCBvdGhlcndpc2UgcmVzb2x2ZSBpdCBmcm9tIG1haW5QYXRoIGFmdGVyIHByb2dyYW1cbiAgICAvLyBjcmVhdGlvbi5cbiAgICBpZiAodGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSB0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlO1xuICAgIH0gZWxzZSBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlIGFzIHN0cmluZyk7IC8vIHRlbXBvcmFyeSBjYXN0IGZvciB0eXBlIGlzc3VlXG4gICAgfVxuXG4gICAgLy8gU2V0IHBsYXRmb3JtLlxuICAgIHRoaXMuX3BsYXRmb3JtID0gb3B0aW9ucy5wbGF0Zm9ybSB8fCBQTEFURk9STS5Ccm93c2VyO1xuXG4gICAgLy8gTWFrZSB0cmFuc2Zvcm1lcnMuXG4gICAgdGhpcy5fbWFrZVRyYW5zZm9ybWVycygpO1xuXG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9zZXR1cE9wdGlvbnMnKTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldFRzUHJvZ3JhbSgpIHtcbiAgICBpZiAoIXRoaXMuX3Byb2dyYW0pIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX0ppdE1vZGUgPyB0aGlzLl9wcm9ncmFtIGFzIHRzLlByb2dyYW0gOiAodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5nZXRUc1Byb2dyYW0oKTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldENoYW5nZWRUc0ZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpXG4gICAgICAuZmlsdGVyKGsgPT4gKGsuZW5kc1dpdGgoJy50cycpIHx8IGsuZW5kc1dpdGgoJy50c3gnKSkgJiYgIWsuZW5kc1dpdGgoJy5kLnRzJykpXG4gICAgICAuZmlsdGVyKGsgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoaykpO1xuICB9XG5cbiAgdXBkYXRlQ2hhbmdlZEZpbGVFeHRlbnNpb25zKGV4dGVuc2lvbjogc3RyaW5nKSB7XG4gICAgaWYgKGV4dGVuc2lvbikge1xuICAgICAgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zLmFkZChleHRlbnNpb24pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpXG4gICAgICAuZmlsdGVyKGsgPT4ge1xuICAgICAgICBmb3IgKGNvbnN0IGV4dCBvZiB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMpIHtcbiAgICAgICAgICBpZiAoay5lbmRzV2l0aChleHQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gR2V0IHRoZSByb290IGZpbGVzIGZyb20gdGhlIHRzIGNvbmZpZy5cbiAgICAgICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAgICAgLy8gZm9sbG93aW5nIGltcG9ydHMgb24gdGhlIGV4aXN0aW5nIGZpbGVzLCBzbyB3ZSBuZWVkIHRvIGdldCB0aGUgbmV3IGxpc3Qgb2Ygcm9vdCBmaWxlcy5cbiAgICAgICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICAgICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcy5jb25jYXQoLi4udGhpcy5fc2luZ2xlRmlsZUluY2x1ZGVzKTtcblxuICAgICAgICAvLyBVcGRhdGUgdGhlIGZvcmtlZCB0eXBlIGNoZWNrZXIgd2l0aCBhbGwgY2hhbmdlZCBjb21waWxhdGlvbiBmaWxlcy5cbiAgICAgICAgLy8gVGhpcyBpbmNsdWRlcyB0ZW1wbGF0ZXMsIHRoYXQgYWxzbyBuZWVkIHRvIGJlIHJlbG9hZGVkIG9uIHRoZSB0eXBlIGNoZWNrZXIuXG4gICAgICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIHRoaXMuX3VwZGF0ZUZvcmtlZFR5cGVDaGVja2VyKHRoaXMuX3Jvb3ROYW1lcywgdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICAgICAgdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlID0gdHMuY3JlYXRlTW9kdWxlUmVzb2x1dGlvbkNhY2hlKHRoaXMuX2Jhc2VQYXRoLCB4ID0+IHgpO1xuXG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuICAgICAgICBjb25zdCBvbGRGaWxlcyA9IG5ldyBTZXQodHNQcm9ncmFtID9cbiAgICAgICAgICB0c1Byb2dyYW0uZ2V0U291cmNlRmlsZXMoKS5tYXAoc2YgPT4gc2YuZmlsZU5hbWUpXG4gICAgICAgICAgOiBbXSxcbiAgICAgICAgKTtcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgICAgICB0aGlzLl9wcm9ncmFtID0gdHMuY3JlYXRlUHJvZ3JhbShcbiAgICAgICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgICAgIHRzUHJvZ3JhbSxcbiAgICAgICAgICApO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QuaW52YWxpZGF0ZShuZXdGaWxlLmZpbGVOYW1lKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgb2xkUHJvZ3JhbTogdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5fcHJvZ3JhbS5sb2FkTmdTdHJ1Y3R1cmVBc3luYygpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgICAgICAgICAgY29uc3QgbmV3RmlsZXMgPSAodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5nZXRUc1Byb2dyYW0oKVxuICAgICAgICAgICAgICAgIC5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICAgICAgICAgIGZvciAoY29uc3QgbmV3RmlsZSBvZiBuZXdGaWxlcykge1xuICAgICAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gSWYgdGhlcmUncyBzdGlsbCBubyBlbnRyeU1vZHVsZSB0cnkgdG8gcmVzb2x2ZSBmcm9tIG1haW5QYXRoLlxuICAgICAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbihcbiAgICAgICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpIHtcbiAgICB0cnkge1xuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMnKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IF9fTkdUT09MU19QUklWQVRFX0FQSV8yLmxpc3RMYXp5Um91dGVzKHtcbiAgICAgICAgcHJvZ3JhbTogdGhpcy5fZ2V0VHNQcm9ncmFtKCksXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgYW5ndWxhckNvbXBpbGVyT3B0aW9uczogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fY29tcGlsZXJPcHRpb25zLCB7XG4gICAgICAgICAgLy8gZ2VuRGlyIHNlZW1zIHRvIHN0aWxsIGJlIG5lZWRlZCBpbiBAYW5ndWxhclxcY29tcGlsZXItY2xpXFxzcmNcXGNvbXBpbGVyX2hvc3QuanM6MjI2LlxuICAgICAgICAgIGdlbkRpcjogJycsXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBUT0RPOiBmaXggY29tcGlsZXItY2xpIHR5cGluZ3M7IGVudHJ5TW9kdWxlIHNob3VsZCBub3QgYmUgc3RyaW5nLCBidXQgYWxzbyBvcHRpb25hbC5cbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLW5vbi1udWxsLWFzc2VydGlvblxuICAgICAgICBlbnRyeU1vZHVsZTogdGhpcy5fZW50cnlNb2R1bGUgISxcbiAgICAgIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMnKTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIFdlIHNpbGVuY2UgdGhlIGVycm9yIHRoYXQgdGhlIEBhbmd1bGFyL3JvdXRlciBjb3VsZCBub3QgYmUgZm91bmQuIEluIHRoYXQgY2FzZSwgdGhlcmUgaXNcbiAgICAgIC8vIGJhc2ljYWxseSBubyByb3V0ZSBzdXBwb3J0ZWQgYnkgdGhlIGFwcCBpdHNlbGYuXG4gICAgICBpZiAoZXJyLm1lc3NhZ2Uuc3RhcnRzV2l0aCgnQ291bGQgbm90IHJlc29sdmUgbW9kdWxlIEBhbmd1bGFyL3JvdXRlcicpKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRGaWxlUGF0aHM6IHN0cmluZ1tdKTogTGF6eVJvdXRlTWFwIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2ZpbmRMYXp5Um91dGVzSW5Bc3QnKTtcbiAgICBjb25zdCByZXN1bHQ6IExhenlSb3V0ZU1hcCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBjaGFuZ2VkRmlsZVBhdGhzKSB7XG4gICAgICBjb25zdCBmaWxlTGF6eVJvdXRlcyA9IGZpbmRMYXp5Um91dGVzKGZpbGVQYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHVuZGVmaW5lZCxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zKTtcbiAgICAgIGZvciAoY29uc3Qgcm91dGVLZXkgb2YgT2JqZWN0LmtleXMoZmlsZUxhenlSb3V0ZXMpKSB7XG4gICAgICAgIGNvbnN0IHJvdXRlID0gZmlsZUxhenlSb3V0ZXNbcm91dGVLZXldO1xuICAgICAgICByZXN1bHRbcm91dGVLZXldID0gcm91dGU7XG4gICAgICB9XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZmluZExhenlSb3V0ZXNJbkFzdCcpO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0oKTogTGF6eVJvdXRlTWFwIHtcbiAgICBjb25zdCBuZ1Byb2dyYW0gPSB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW07XG4gICAgaWYgKCFuZ1Byb2dyYW0ubGlzdExhenlSb3V0ZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0gd2FzIGNhbGxlZCB3aXRoIGFuIG9sZCBwcm9ncmFtLicpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhenlSb3V0ZXMgPSBuZ1Byb2dyYW0ubGlzdExhenlSb3V0ZXMoKTtcblxuICAgIHJldHVybiBsYXp5Um91dGVzLnJlZHVjZShcbiAgICAgIChhY2MsIGN1cnIpID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gY3Vyci5yb3V0ZTtcbiAgICAgICAgaWYgKHJlZiBpbiBhY2MgJiYgYWNjW3JlZl0gIT09IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICsgYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQ6IFwiJHtyZWZ9XCIgaXMgdXNlZCBpbiAyIGxvYWRDaGlsZHJlbiwgYFxuICAgICAgICAgICAgKyBgYnV0IHRoZXkgcG9pbnQgdG8gZGlmZmVyZW50IG1vZHVsZXMgXCIoJHthY2NbcmVmXX0gYW5kIGBcbiAgICAgICAgICAgICsgYFwiJHtjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGh9XCIpLiBXZWJwYWNrIGNhbm5vdCBkaXN0aW5ndWlzaCBvbiBjb250ZXh0IGFuZCBgXG4gICAgICAgICAgICArICd3b3VsZCBmYWlsIHRvIGxvYWQgdGhlIHByb3BlciBvbmUuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFjY1tyZWZdID0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAge30gYXMgTGF6eVJvdXRlTWFwLFxuICAgICk7XG4gIH1cblxuICAvLyBQcm9jZXNzIHRoZSBsYXp5IHJvdXRlcyBkaXNjb3ZlcmVkLCBhZGRpbmcgdGhlbiB0byBfbGF6eVJvdXRlcy5cbiAgLy8gVE9ETzogZmluZCBhIHdheSB0byByZW1vdmUgbGF6eSByb3V0ZXMgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuICAvLyBUaGlzIHdpbGwgcmVxdWlyZSBhIHJlZ2lzdHJ5IG9mIGtub3duIHJlZmVyZW5jZXMgdG8gYSBsYXp5IHJvdXRlLCByZW1vdmluZyBpdCB3aGVuIG5vXG4gIC8vIG1vZHVsZSByZWZlcmVuY2VzIGl0IGFueW1vcmUuXG4gIHByaXZhdGUgX3Byb2Nlc3NMYXp5Um91dGVzKGRpc2NvdmVyZWRMYXp5Um91dGVzOiBMYXp5Um91dGVNYXApIHtcbiAgICBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkTGF6eVJvdXRlcylcbiAgICAgIC5mb3JFYWNoKGxhenlSb3V0ZUtleSA9PiB7XG4gICAgICAgIGNvbnN0IFtsYXp5Um91dGVNb2R1bGUsIG1vZHVsZU5hbWVdID0gbGF6eVJvdXRlS2V5LnNwbGl0KCcjJyk7XG5cbiAgICAgICAgaWYgKCFsYXp5Um91dGVNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXp5Um91dGVUU0ZpbGUgPSBkaXNjb3ZlcmVkTGF6eVJvdXRlc1tsYXp5Um91dGVLZXldLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgbGV0IG1vZHVsZVBhdGg6IHN0cmluZywgbW9kdWxlS2V5OiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ke21vZHVsZU5hbWUgPyAnIycgKyBtb2R1bGVOYW1lIDogJyd9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlLnJlcGxhY2UoLyhcXC5kKT9cXC50c3g/JC8sICcnKTtcbiAgICAgICAgICBtb2R1bGVQYXRoICs9ICcubmdmYWN0b3J5LmpzJztcbiAgICAgICAgICBjb25zdCBmYWN0b3J5TW9kdWxlTmFtZSA9IG1vZHVsZU5hbWUgPyBgIyR7bW9kdWxlTmFtZX1OZ0ZhY3RvcnlgIDogJyc7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfS5uZ2ZhY3Rvcnkke2ZhY3RvcnlNb2R1bGVOYW1lfWA7XG4gICAgICAgIH1cblxuICAgICAgICBtb2R1bGVQYXRoID0gd29ya2Fyb3VuZFJlc29sdmUobW9kdWxlUGF0aCk7XG5cbiAgICAgICAgaWYgKG1vZHVsZUtleSBpbiB0aGlzLl9sYXp5Um91dGVzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSAhPT0gbW9kdWxlUGF0aCkge1xuICAgICAgICAgICAgLy8gRm91bmQgYSBkdXBsaWNhdGUsIHRoaXMgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQgZHVyaW5nIGEgcmVidWlsZC4gYFxuICAgICAgICAgICAgICAgICsgYFdlIHdpbGwgdGFrZSB0aGUgbGF0ZXN0IHZlcnNpb24gZGV0ZWN0ZWQgYW5kIG92ZXJyaWRlIGl0IHRvIHNhdmUgcmVidWlsZCB0aW1lLiBgXG4gICAgICAgICAgICAgICAgKyBgWW91IHNob3VsZCBwZXJmb3JtIGEgZnVsbCBidWlsZCB0byB2YWxpZGF0ZSB0aGF0IHlvdXIgcm91dGVzIGRvbid0IG92ZXJsYXAuYCksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGb3VuZCBhIG5ldyByb3V0ZSwgYWRkIGl0IHRvIHRoZSBtYXAuXG4gICAgICAgICAgdGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldID0gbW9kdWxlUGF0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICAvLyBCb290c3RyYXAgdHlwZSBjaGVja2VyIGlzIHVzaW5nIGxvY2FsIENMSS5cbiAgICBjb25zdCBnOiBhbnkgPSB0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJyA/IGdsb2JhbCA6IHt9OyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICBjb25zdCB0eXBlQ2hlY2tlckZpbGU6IHN0cmluZyA9IGdbJ19EZXZLaXRJc0xvY2FsJ11cbiAgICAgID8gJy4vdHlwZV9jaGVja2VyX2Jvb3RzdHJhcC5qcydcbiAgICAgIDogJy4vdHlwZV9jaGVja2VyX3dvcmtlci5qcyc7XG5cbiAgICBjb25zdCBkZWJ1Z0FyZ1JlZ2V4ID0gLy0taW5zcGVjdCg/Oi1icmt8LXBvcnQpP3wtLWRlYnVnKD86LWJya3wtcG9ydCkvO1xuXG4gICAgY29uc3QgZXhlY0FyZ3YgPSBwcm9jZXNzLmV4ZWNBcmd2LmZpbHRlcigoYXJnKSA9PiB7XG4gICAgICAvLyBSZW1vdmUgZGVidWcgYXJncy5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvOTQzNVxuICAgICAgcmV0dXJuICFkZWJ1Z0FyZ1JlZ2V4LnRlc3QoYXJnKTtcbiAgICB9KTtcbiAgICAvLyBTaWduYWwgdGhlIHByb2Nlc3MgdG8gc3RhcnQgbGlzdGVuaW5nIGZvciBtZXNzYWdlc1xuICAgIC8vIFNvbHZlcyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvOTA3MVxuICAgIGNvbnN0IGZvcmtBcmdzID0gW0FVVE9fU1RBUlRfQVJHXTtcbiAgICBjb25zdCBmb3JrT3B0aW9uczogRm9ya09wdGlvbnMgPSB7IGV4ZWNBcmd2IH07XG5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBmb3JrKFxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgdHlwZUNoZWNrZXJGaWxlKSxcbiAgICAgIGZvcmtBcmdzLFxuICAgICAgZm9ya09wdGlvbnMpO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIHByb2Nlc3MgZXhpdC5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub25jZSgnZXhpdCcsIChfLCBzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG5cbiAgICAgIC8vIElmIHByb2Nlc3MgZXhpdGVkIG5vdCBiZWNhdXNlIG9mIFNJR1RFUk0gKHNlZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKSwgdGhhbiBzb21ldGhpbmdcbiAgICAgIC8vIHdlbnQgd3JvbmcgYW5kIGl0IHNob3VsZCBmYWxsYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIHRoZSBtYWluIHRocmVhZC5cbiAgICAgIGlmIChzaWduYWwgIT09ICdTSUdURVJNJykge1xuICAgICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbXNnID0gJ0FuZ3VsYXJDb21waWxlclBsdWdpbjogRm9ya2VkIFR5cGUgQ2hlY2tlciBleGl0ZWQgdW5leHBlY3RlZGx5LiAnICtcbiAgICAgICAgICAnRmFsbGluZyBiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gbWFpbiB0aHJlYWQuJztcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCkge1xuICAgICAgdHJlZUtpbGwodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCwgJ1NJR1RFUk0nKTtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgaWYgKCF0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkKSB7XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcykpO1xuICAgICAgICB0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBVcGRhdGVNZXNzYWdlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RyYXRpb24gaG9vayBmb3Igd2VicGFjayBwbHVnaW4uXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlcikge1xuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIC8vIFRoZSB3ZWJwYWNrIHR5cGVzIGN1cnJlbnRseSBkbyBub3QgaW5jbHVkZSB0aGVzZVxuICAgICAgY29uc3QgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMgPSBjb21waWxlciBhcyBDb21waWxlciAmIHtcbiAgICAgICAgaW5wdXRGaWxlU3lzdGVtOiBJbnB1dEZpbGVTeXN0ZW0sXG4gICAgICAgIHdhdGNoRmlsZVN5c3RlbTogTm9kZVdhdGNoRmlsZVN5c3RlbUludGVyZmFjZSxcbiAgICAgIH07XG5cbiAgICAgIGxldCBob3N0OiB2aXJ0dWFsRnMuSG9zdDxmcy5TdGF0cz4gPSB0aGlzLl9vcHRpb25zLmhvc3QgfHwgbmV3IFdlYnBhY2tJbnB1dEhvc3QoXG4gICAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSxcbiAgICAgICk7XG5cbiAgICAgIGxldCByZXBsYWNlbWVudHM6IE1hcDxQYXRoLCBQYXRoPiB8ICgocGF0aDogUGF0aCkgPT4gUGF0aCkgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGNvbnN0IHJlcGxhY2VtZW50UmVzb2x2ZXIgPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzO1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IHBhdGggPT4gbm9ybWFsaXplKHJlcGxhY2VtZW50UmVzb2x2ZXIoZ2V0U3lzdGVtUGF0aChwYXRoKSkpO1xuICAgICAgICAgIGhvc3QgPSBuZXcgY2xhc3MgZXh0ZW5kcyB2aXJ0dWFsRnMuUmVzb2x2ZXJIb3N0PGZzLlN0YXRzPiB7XG4gICAgICAgICAgICBfcmVzb2x2ZShwYXRoOiBQYXRoKSB7XG4gICAgICAgICAgICAgIHJldHVybiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfShob3N0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXBsYWNlbWVudHMgPSBuZXcgTWFwKCk7XG4gICAgICAgICAgY29uc3QgYWxpYXNIb3N0ID0gbmV3IHZpcnR1YWxGcy5BbGlhc0hvc3QoaG9zdCk7XG4gICAgICAgICAgZm9yIChjb25zdCBmcm9tIGluIHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRGcm9tID0gcmVzb2x2ZShub3JtYWxpemUodGhpcy5fYmFzZVBhdGgpLCBub3JtYWxpemUoZnJvbSkpO1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFdpdGggPSByZXNvbHZlKFxuICAgICAgICAgICAgICBub3JtYWxpemUodGhpcy5fYmFzZVBhdGgpLFxuICAgICAgICAgICAgICBub3JtYWxpemUodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRoc1tmcm9tXSksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxpYXNIb3N0LmFsaWFzZXMuc2V0KG5vcm1hbGl6ZWRGcm9tLCBub3JtYWxpemVkV2l0aCk7XG4gICAgICAgICAgICByZXBsYWNlbWVudHMuc2V0KG5vcm1hbGl6ZWRGcm9tLCBub3JtYWxpemVkV2l0aCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGhvc3QgPSBhbGlhc0hvc3Q7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ3JlYXRlIHRoZSB3ZWJwYWNrIGNvbXBpbGVyIGhvc3QuXG4gICAgICBjb25zdCB3ZWJwYWNrQ29tcGlsZXJIb3N0ID0gbmV3IFdlYnBhY2tDb21waWxlckhvc3QoXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIGhvc3QsXG4gICAgICApO1xuXG4gICAgICAvLyBDcmVhdGUgYW5kIHNldCBhIG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIuXG4gICAgICB0aGlzLl9yZXNvdXJjZUxvYWRlciA9IG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIoKTtcbiAgICAgIHdlYnBhY2tDb21waWxlckhvc3Quc2V0UmVzb3VyY2VMb2FkZXIodGhpcy5fcmVzb3VyY2VMb2FkZXIpO1xuXG4gICAgICAvLyBVc2UgdGhlIFdlYnBhY2tDb21waWxlckhvc3Qgd2l0aCBhIHJlc291cmNlIGxvYWRlciB0byBjcmVhdGUgYW4gQW5ndWxhckNvbXBpbGVySG9zdC5cbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCA9IGNyZWF0ZUNvbXBpbGVySG9zdCh7XG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdHNIb3N0OiB3ZWJwYWNrQ29tcGlsZXJIb3N0LFxuICAgICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcblxuICAgICAgLy8gUmVzb2x2ZSBtYWluUGF0aCBpZiBwcm92aWRlZC5cbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLm1haW5QYXRoKSB7XG4gICAgICAgIHRoaXMuX21haW5QYXRoID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUodGhpcy5fb3B0aW9ucy5tYWluUGF0aCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlucHV0RGVjb3JhdG9yID0gbmV3IFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0sXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICk7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0gPSBpbnB1dERlY29yYXRvcjtcbiAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLndhdGNoRmlsZVN5c3RlbSA9IG5ldyBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBpbnB1dERlY29yYXRvcixcbiAgICAgICAgcmVwbGFjZW1lbnRzLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBsYXp5IG1vZHVsZXMgdG8gdGhlIGNvbnRleHQgbW9kdWxlIGZvciBAYW5ndWxhci9jb3JlXG4gICAgY29tcGlsZXIuaG9va3MuY29udGV4dE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY21mID0+IHtcbiAgICAgIGNvbnN0IGFuZ3VsYXJDb3JlUGFja2FnZVBhdGggPSByZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvcmUvcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIC8vIEFQRnY2IGRvZXMgbm90IGhhdmUgc2luZ2xlIEZFU00gYW55bW9yZS4gSW5zdGVhZCBvZiB2ZXJpZnlpbmcgaWYgd2UncmUgcG9pbnRpbmcgdG9cbiAgICAgIC8vIEZFU01zLCB3ZSByZXNvbHZlIHRoZSBgQGFuZ3VsYXIvY29yZWAgcGF0aCBhbmQgdmVyaWZ5IHRoYXQgdGhlIHBhdGggZm9yIHRoZVxuICAgICAgLy8gbW9kdWxlIHN0YXJ0cyB3aXRoIGl0LlxuXG4gICAgICAvLyBUaGlzIG1heSBiZSBzbG93ZXIgYnV0IGl0IHdpbGwgYmUgY29tcGF0aWJsZSB3aXRoIGJvdGggQVBGNSwgNiBhbmQgcG90ZW50aWFsIGZ1dHVyZVxuICAgICAgLy8gdmVyc2lvbnMgKHVudGlsIHRoZSBkeW5hbWljIGltcG9ydCBhcHBlYXJzIG91dHNpZGUgb2YgY29yZSBJIHN1cHBvc2UpLlxuICAgICAgLy8gV2UgcmVzb2x2ZSBhbnkgc3ltYm9saWMgbGlua3MgaW4gb3JkZXIgdG8gZ2V0IHRoZSByZWFsIHBhdGggdGhhdCB3b3VsZCBiZSB1c2VkIGluIHdlYnBhY2suXG4gICAgICBjb25zdCBhbmd1bGFyQ29yZURpcm5hbWUgPSBmcy5yZWFscGF0aFN5bmMocGF0aC5kaXJuYW1lKGFuZ3VsYXJDb3JlUGFja2FnZVBhdGgpKTtcblxuICAgICAgY21mLmhvb2tzLmFmdGVyUmVzb2x2ZS50YXBQcm9taXNlKCdhbmd1bGFyLWNvbXBpbGVyJywgYXN5bmMgcmVzdWx0ID0+IHtcbiAgICAgICAgLy8gQWx0ZXIgb25seSByZXF1ZXN0IGZyb20gQW5ndWxhci5cbiAgICAgICAgaWYgKCFyZXN1bHQgfHwgIXRoaXMuZG9uZSB8fCAhcmVzdWx0LnJlc291cmNlLnN0YXJ0c1dpdGgoYW5ndWxhckNvcmVEaXJuYW1lKSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5kb25lLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gVGhpcyBmb2xkZXIgZG9lcyBub3QgZXhpc3QsIGJ1dCB3ZSBuZWVkIHRvIGdpdmUgd2VicGFjayBhIHJlc291cmNlLlxuICAgICAgICAgICAgLy8gVE9ETzogY2hlY2sgaWYgd2UgY2FuJ3QganVzdCBsZWF2ZSBpdCBhcyBpcyAoYW5ndWxhckNvcmVNb2R1bGVEaXIpLlxuICAgICAgICAgICAgcmVzdWx0LnJlc291cmNlID0gcGF0aC5qb2luKHRoaXMuX2Jhc2VQYXRoLCAnJCRfbGF6eV9yb3V0ZV9yZXNvdXJjZScpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LmRlcGVuZGVuY2llcy5mb3JFYWNoKChkOiBhbnkpID0+IGQuY3JpdGljYWwgPSBmYWxzZSk7XG4gICAgICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgICAgICByZXN1bHQucmVzb2x2ZURlcGVuZGVuY2llcyA9IChfZnM6IGFueSwgb3B0aW9uczogYW55LCBjYWxsYmFjazogQ2FsbGJhY2spID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gT2JqZWN0LmtleXModGhpcy5fbGF6eVJvdXRlcylcbiAgICAgICAgICAgICAgICAubWFwKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZVBhdGggPSB0aGlzLl9sYXp5Um91dGVzW2tleV07XG4gICAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRQYXRoID0ga2V5LnNwbGl0KCcjJylbMF07XG4gICAgICAgICAgICAgICAgICBpZiAobW9kdWxlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuYW1lID0gaW1wb3J0UGF0aC5yZXBsYWNlKC8oXFwubmdmYWN0b3J5KT9cXC4oanN8dHMpJC8sICcnKTtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IHRoaXMuX2NvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yKG1vZHVsZVBhdGgsIG5hbWUpO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuZmlsdGVyKHggPT4gISF4KTtcblxuICAgICAgICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5uYW1lTGF6eUZpbGVzKSB7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy5jaHVua05hbWUgPSAnW3JlcXVlc3RdJztcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIGRlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICAgIH0sXG4gICAgICAgICAgKCkgPT4gdW5kZWZpbmVkLFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYW5kIGRlc3Ryb3kgZm9ya2VkIHR5cGUgY2hlY2tlciBvbiB3YXRjaCBtb2RlLlxuICAgIGNvbXBpbGVyLmhvb2tzLndhdGNoUnVuLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgIXRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgICB0aGlzLl9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGNvbXBpbGVyLmhvb2tzLndhdGNoQ2xvc2UudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4gdGhpcy5fa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkpO1xuXG4gICAgLy8gUmVtYWtlIHRoZSBwbHVnaW4gb24gZWFjaCBjb21waWxhdGlvbi5cbiAgICBjb21waWxlci5ob29rcy5tYWtlLnRhcFByb21pc2UoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxhdGlvbiA9PiB0aGlzLl9tYWtlKGNvbXBpbGF0aW9uKSk7XG4gICAgY29tcGlsZXIuaG9va3MuaW52YWxpZC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9maXJzdFJ1biA9IGZhbHNlKTtcbiAgICBjb21waWxlci5ob29rcy5hZnRlckVtaXQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY29tcGlsYXRpb24gPT4ge1xuICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSBudWxsO1xuICAgIH0pO1xuICAgIGNvbXBpbGVyLmhvb2tzLmRvbmUudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgdGhpcy5fZG9uZVByb21pc2UgPSBudWxsO1xuICAgIH0pO1xuXG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY29tcGlsZXIgPT4ge1xuICAgICAgY29tcGlsZXIuaG9va3Mubm9ybWFsTW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBubWYgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcFByb21pc2UoXG4gICAgICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgICAgIGFzeW5jIChyZXF1ZXN0PzogTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgcmVxdWVzdCkge1xuICAgICAgICAgICAgICBjb25zdCBuYW1lID0gcmVxdWVzdC5yZXF1ZXN0O1xuICAgICAgICAgICAgICBjb25zdCBpc3N1ZXIgPSByZXF1ZXN0LmNvbnRleHRJbmZvLmlzc3VlcjtcbiAgICAgICAgICAgICAgaWYgKG5hbWUuZW5kc1dpdGgoJy50cycpIHx8IG5hbWUuZW5kc1dpdGgoJy50c3gnKVxuICAgICAgICAgICAgICAgICAgfHwgKGlzc3VlciAmJiAvXFwudHN8bmdmYWN0b3J5XFwuanMkLy50ZXN0KGlzc3VlcikpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuZG9uZTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHt9XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJlcXVlc3Q7XG4gICAgICAgICAgfSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29tcGlsZXIuaG9va3Mubm9ybWFsTW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBubWYgPT4ge1xuICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwQXN5bmMoXG4gICAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgICAgKHJlcXVlc3Q6IE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0LCBjYWxsYmFjazogQ2FsbGJhY2s8Tm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3Q+KSA9PiB7XG4gICAgICAgICAgcmVzb2x2ZVdpdGhQYXRocyhcbiAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSxcbiAgICAgICAgICApO1xuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgX21ha2UoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSB0cnVlO1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICBpZiAoKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQW4gQG5ndG9vbHMvd2VicGFjayBwbHVnaW4gYWxyZWFkeSBleGlzdCBmb3IgdGhpcyBjb21waWxhdGlvbi4nKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgYSBwcml2YXRlIHZhcmlhYmxlIGZvciB0aGlzIHBsdWdpbiBpbnN0YW5jZS5cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSB0aGlzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSByZXNvdXJjZSBsb2FkZXIgd2l0aCB0aGUgbmV3IHdlYnBhY2sgY29tcGlsYXRpb24uXG4gICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uKTtcblxuICAgIHJldHVybiB0aGlzLl9kb25lUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl91cGRhdGUoKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UnKTtcbiAgICAgIH0sIGVyciA9PiB7XG4gICAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKGVycik7XG4gICAgICAgIHRoaXMucHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKC4uLnRoaXMuX2Vycm9ycyk7XG4gICAgY29tcGlsYXRpb24ud2FybmluZ3MucHVzaCguLi50aGlzLl93YXJuaW5ncyk7XG4gICAgdGhpcy5fZXJyb3JzID0gW107XG4gICAgdGhpcy5fd2FybmluZ3MgPSBbXTtcbiAgfVxuXG4gIHByaXZhdGUgX21ha2VUcmFuc2Zvcm1lcnMoKSB7XG4gICAgY29uc3QgaXNBcHBQYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+XG4gICAgICAhZmlsZU5hbWUuZW5kc1dpdGgoJy5uZ2ZhY3RvcnkudHMnKSAmJiAhZmlsZU5hbWUuZW5kc1dpdGgoJy5uZ3N0eWxlLnRzJyk7XG4gICAgY29uc3QgaXNNYWluUGF0aCA9IChmaWxlTmFtZTogc3RyaW5nKSA9PiBmaWxlTmFtZSA9PT0gKFxuICAgICAgdGhpcy5fbWFpblBhdGggPyB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLl9tYWluUGF0aCkgOiB0aGlzLl9tYWluUGF0aFxuICAgICk7XG4gICAgY29uc3QgZ2V0RW50cnlNb2R1bGUgPSAoKSA9PiB0aGlzLmVudHJ5TW9kdWxlXG4gICAgICA/IHsgcGF0aDogd29ya2Fyb3VuZFJlc29sdmUodGhpcy5lbnRyeU1vZHVsZS5wYXRoKSwgY2xhc3NOYW1lOiB0aGlzLmVudHJ5TW9kdWxlLmNsYXNzTmFtZSB9XG4gICAgICA6IHRoaXMuZW50cnlNb2R1bGU7XG4gICAgY29uc3QgZ2V0TGF6eVJvdXRlcyA9ICgpID0+IHRoaXMuX2xhenlSb3V0ZXM7XG4gICAgY29uc3QgZ2V0VHlwZUNoZWNrZXIgPSAoKSA9PiAodGhpcy5fZ2V0VHNQcm9ncmFtKCkgYXMgdHMuUHJvZ3JhbSkuZ2V0VHlwZUNoZWNrZXIoKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBSZXBsYWNlIHJlc291cmNlcyBpbiBKSVQuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZXBsYWNlUmVzb3VyY2VzKGlzQXBwUGF0aCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdmUgdW5uZWVkZWQgYW5ndWxhciBkZWNvcmF0b3JzLlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVtb3ZlRGVjb3JhdG9ycyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSBudWxsKSB7XG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaCguLi50aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uQnJvd3Nlcikge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgbG9jYWxlLCBhdXRvIGltcG9ydCB0aGUgbG9jYWxlIGRhdGEgZmlsZS5cbiAgICAgICAgLy8gVGhpcyB0cmFuc2Zvcm0gbXVzdCBnbyBiZWZvcmUgcmVwbGFjZUJvb3RzdHJhcCBiZWNhdXNlIGl0IGxvb2tzIGZvciB0aGUgZW50cnkgbW9kdWxlXG4gICAgICAgIC8vIGltcG9ydCwgd2hpY2ggd2lsbCBiZSByZXBsYWNlZC5cbiAgICAgICAgaWYgKHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZWdpc3RlckxvY2FsZURhdGEoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgYm9vdHN0cmFwIGluIGJyb3dzZXIgQU9ULlxuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VCb290c3RyYXAoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uU2VydmVyKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKGV4cG9ydExhenlNb2R1bGVNYXAoaXNNYWluUGF0aCwgZ2V0TGF6eVJvdXRlcykpO1xuICAgICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChcbiAgICAgICAgICAgIGV4cG9ydE5nRmFjdG9yeShpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSksXG4gICAgICAgICAgICByZXBsYWNlU2VydmVyQm9vdHN0cmFwKGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlKCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgLy8gV2Ugb25seSB3YW50IHRvIHVwZGF0ZSBvbiBUUyBhbmQgdGVtcGxhdGUgY2hhbmdlcywgYnV0IGFsbCBraW5kcyBvZiBmaWxlcyBhcmUgb24gdGhpc1xuICAgIC8vIGxpc3QsIGxpa2UgcGFja2FnZS5qc29uIGFuZCAubmdzdW1tYXJ5Lmpzb24gZmlsZXMuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKTtcblxuICAgIC8vIElmIG5vdGhpbmcgd2UgY2FyZSBhYm91dCBjaGFuZ2VkIGFuZCBpdCBpc24ndCB0aGUgZmlyc3QgcnVuLCBkb24ndCBkbyBhbnl0aGluZy5cbiAgICBpZiAoY2hhbmdlZEZpbGVzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgICAvLyBUcnkgdG8gZmluZCBsYXp5IHJvdXRlcyBpZiB3ZSBoYXZlIGFuIGVudHJ5IG1vZHVsZS5cbiAgICAgICAgICAvLyBXZSBuZWVkIHRvIHJ1biB0aGUgYGxpc3RMYXp5Um91dGVzYCB0aGUgZmlyc3QgdGltZSBiZWNhdXNlIGl0IGFsc28gbmF2aWdhdGVzIGxpYnJhcmllc1xuICAgICAgICAgIC8vIGFuZCBvdGhlciB0aGluZ3MgdGhhdCB3ZSBtaWdodCBtaXNzIHVzaW5nIHRoZSAoZmFzdGVyKSBmaW5kTGF6eVJvdXRlc0luQXN0LlxuICAgICAgICAgIC8vIExhenkgcm91dGVzIG1vZHVsZXMgd2lsbCBiZSByZWFkIHdpdGggY29tcGlsZXJIb3N0IGFuZCBhZGRlZCB0byB0aGUgY2hhbmdlZCBmaWxlcy5cbiAgICAgICAgICBpZiAodGhpcy5fbmdDb21waWxlclN1cHBvcnRzTmV3QXBpKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCkpO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgY2hhbmdlZFRzRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkVHNGaWxlcygpO1xuICAgICAgICAgICAgaWYgKGNoYW5nZWRUc0ZpbGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fZmluZExhenlSb3V0ZXNJbkFzdChjaGFuZ2VkVHNGaWxlcykpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX29wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIEVtaXQgYW5kIHJlcG9ydCBlcnJvcnMuXG5cbiAgICAgICAgLy8gV2Ugbm93IGhhdmUgdGhlIGZpbmFsIGxpc3Qgb2YgY2hhbmdlZCBUUyBmaWxlcy5cbiAgICAgICAgLy8gR28gdGhyb3VnaCBlYWNoIGNoYW5nZWQgZmlsZSBhbmQgYWRkIHRyYW5zZm9ybXMgYXMgbmVlZGVkLlxuICAgICAgICBjb25zdCBzb3VyY2VGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRUc0ZpbGVzKClcbiAgICAgICAgICAubWFwKChmaWxlTmFtZSkgPT4gKHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pLmdldFNvdXJjZUZpbGUoZmlsZU5hbWUpKVxuICAgICAgICAgIC8vIEF0IHRoaXMgcG9pbnQgd2Ugc2hvdWxkbid0IG5lZWQgdG8gZmlsdGVyIG91dCB1bmRlZmluZWQgZmlsZXMsIGJlY2F1c2UgYW55IHRzIGZpbGVcbiAgICAgICAgICAvLyB0aGF0IGNoYW5nZWQgc2hvdWxkIGJlIGVtaXR0ZWQuXG4gICAgICAgICAgLy8gQnV0IGR1ZSB0byBob3N0UmVwbGFjZW1lbnRQYXRocyB0aGVyZSBjYW4gYmUgZmlsZXMgKHRoZSBlbnZpcm9ubWVudCBmaWxlcylcbiAgICAgICAgICAvLyB0aGF0IGNoYW5nZWQgYnV0IGFyZW4ndCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvbiwgc3BlY2lhbGx5IG9uIGBuZyB0ZXN0YC5cbiAgICAgICAgICAvLyBTbyB3ZSBpZ25vcmUgbWlzc2luZyBzb3VyY2UgZmlsZXMgZmlsZXMgaGVyZS5cbiAgICAgICAgICAvLyBob3N0UmVwbGFjZW1lbnRQYXRocyBuZWVkcyB0byBiZSBmaXhlZCBhbnl3YXkgdG8gdGFrZSBjYXJlIG9mIHRoZSBmb2xsb3dpbmcgaXNzdWUuXG4gICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzczMDUjaXNzdWVjb21tZW50LTMzMjE1MDIzMFxuICAgICAgICAgIC5maWx0ZXIoKHgpID0+ICEheCkgYXMgdHMuU291cmNlRmlsZVtdO1xuXG4gICAgICAgIC8vIEVtaXQgZmlsZXMuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgICAgIGNvbnN0IHsgZW1pdFJlc3VsdCwgZGlhZ25vc3RpY3MgfSA9IHRoaXMuX2VtaXQoc291cmNlRmlsZXMpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZS5fZW1pdCcpO1xuXG4gICAgICAgIC8vIFJlcG9ydCBkaWFnbm9zdGljcy5cbiAgICAgICAgY29uc3QgZXJyb3JzID0gZGlhZ25vc3RpY3NcbiAgICAgICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgICAgICBjb25zdCB3YXJuaW5ncyA9IGRpYWdub3N0aWNzXG4gICAgICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgICAgIHRoaXMuX2Vycm9ycy5wdXNoKG5ldyBFcnJvcihtZXNzYWdlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtZXNzYWdlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gIWVtaXRSZXN1bHQgfHwgZW1pdFJlc3VsdC5lbWl0U2tpcHBlZDtcblxuICAgICAgICAvLyBSZXNldCBjaGFuZ2VkIGZpbGVzIG9uIHN1Y2Nlc3NmdWwgY29tcGlsYXRpb24uXG4gICAgICAgIGlmICghdGhpcy5fZW1pdFNraXBwZWQgJiYgdGhpcy5fZXJyb3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHdyaXRlSTE4bk91dEZpbGUoKSB7XG4gICAgZnVuY3Rpb24gX3JlY3Vyc2l2ZU1rRGlyKHA6IHN0cmluZykge1xuICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKHApKSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUocCkpO1xuICAgICAgICBmcy5ta2RpclN5bmMocCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgdGhlIGV4dHJhY3RlZCBtZXNzYWdlcyB0byBkaXNrLlxuICAgIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpIHtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCwgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKTtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlQ29udGVudCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShpMThuT3V0RmlsZVBhdGgpO1xuICAgICAgaWYgKGkxOG5PdXRGaWxlQ29udGVudCkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKGkxOG5PdXRGaWxlUGF0aCkpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGkxOG5PdXRGaWxlUGF0aCwgaTE4bk91dEZpbGVDb250ZW50KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXRDb21waWxlZEZpbGUoZmlsZU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IG91dHB1dEZpbGUgPSBmaWxlTmFtZS5yZXBsYWNlKC8udHN4PyQvLCAnLmpzJyk7XG4gICAgbGV0IG91dHB1dFRleHQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlTWFwOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGVycm9yRGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKHRoaXMuX2VtaXRTa2lwcGVkKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgLy8gSWYgdGhlIGNvbXBpbGF0aW9uIGRpZG4ndCBlbWl0IGZpbGVzIHRoaXMgdGltZSwgdHJ5IHRvIHJldHVybiB0aGUgY2FjaGVkIGZpbGVzIGZyb20gdGhlXG4gICAgICAgIC8vIGxhc3QgY29tcGlsYXRpb24gYW5kIGxldCB0aGUgY29tcGlsYXRpb24gZXJyb3JzIHNob3cgd2hhdCdzIHdyb25nLlxuICAgICAgICBvdXRwdXRUZXh0ID0gdGV4dDtcbiAgICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlcmUncyBub3RoaW5nIHdlIGNhbiBzZXJ2ZS4gUmV0dXJuIGFuIGVtcHR5IHN0cmluZyB0byBwcmV2ZW50IGxlbmdodHkgd2VicGFjayBlcnJvcnMsXG4gICAgICAgIC8vIGFkZCB0aGUgcmVidWlsZCB3YXJuaW5nIGlmIGl0J3Mgbm90IHRoZXJlIHlldC5cbiAgICAgICAgLy8gV2UgYWxzbyBuZWVkIHRvIGFsbCBjaGFuZ2VkIGZpbGVzIGFzIGRlcGVuZGVuY2llcyBvZiB0aGlzIGZpbGUsIHNvIHRoYXQgYWxsIG9mIHRoZW1cbiAgICAgICAgLy8gd2lsbCBiZSB3YXRjaGVkIGFuZCB0cmlnZ2VyIGEgcmVidWlsZCBuZXh0IHRpbWUuXG4gICAgICAgIG91dHB1dFRleHQgPSAnJztcbiAgICAgICAgZXJyb3JEZXBlbmRlbmNpZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpXG4gICAgICAgICAgLy8gVGhlc2UgcGF0aHMgYXJlIHVzZWQgYnkgdGhlIGxvYWRlciBzbyB3ZSBtdXN0IGRlbm9ybWFsaXplIHRoZW0uXG4gICAgICAgICAgLm1hcCgocCkgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBUUyBpbnB1dCBmaWxlIGFuZCB0aGUgSlMgb3V0cHV0IGZpbGUgZXhpc3QuXG4gICAgICBpZiAoKChmaWxlTmFtZS5lbmRzV2l0aCgnLnRzJykgfHwgZmlsZU5hbWUuZW5kc1dpdGgoJy50c3gnKSlcbiAgICAgICAgJiYgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGZpbGVOYW1lKSlcbiAgICAgICAgfHwgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKG91dHB1dEZpbGUsIGZhbHNlKSkge1xuICAgICAgICBsZXQgbXNnID0gYCR7ZmlsZU5hbWV9IGlzIG1pc3NpbmcgZnJvbSB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbi4gYFxuICAgICAgICAgICsgYFBsZWFzZSBtYWtlIHN1cmUgaXQgaXMgaW4geW91ciB0c2NvbmZpZyB2aWEgdGhlICdmaWxlcycgb3IgJ2luY2x1ZGUnIHByb3BlcnR5LmA7XG5cbiAgICAgICAgaWYgKC8oXFxcXHxcXC8pbm9kZV9tb2R1bGVzKFxcXFx8XFwvKS8udGVzdChmaWxlTmFtZSkpIHtcbiAgICAgICAgICBtc2cgKz0gJ1xcblRoZSBtaXNzaW5nIGZpbGUgc2VlbXMgdG8gYmUgcGFydCBvZiBhIHRoaXJkIHBhcnR5IGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1RTIGZpbGVzIGluIHB1Ymxpc2hlZCBsaWJyYXJpZXMgYXJlIG9mdGVuIGEgc2lnbiBvZiBhIGJhZGx5IHBhY2thZ2VkIGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1BsZWFzZSBvcGVuIGFuIGlzc3VlIGluIHRoZSBsaWJyYXJ5IHJlcG9zaXRvcnkgdG8gYWxlcnQgaXRzIGF1dGhvciBhbmQgYXNrIHRoZW0gJ1xuICAgICAgICAgICAgKyAndG8gcGFja2FnZSB0aGUgbGlicmFyeSB1c2luZyB0aGUgQW5ndWxhciBQYWNrYWdlIEZvcm1hdCAoaHR0cHM6Ly9nb28uZ2wvakIzR1Z2KS4nO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9XG5cbiAgICAgIG91dHB1dFRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSkgfHwgJyc7XG4gICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgb3V0cHV0VGV4dCwgc291cmNlTWFwLCBlcnJvckRlcGVuZGVuY2llcyB9O1xuICB9XG5cbiAgZ2V0RGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVzb2x2ZWRGaWxlTmFtZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKGZpbGVOYW1lKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5fY29tcGlsZXJIb3N0LmdldFNvdXJjZUZpbGUocmVzb2x2ZWRGaWxlTmFtZSwgdHMuU2NyaXB0VGFyZ2V0LkxhdGVzdCk7XG4gICAgaWYgKCFzb3VyY2VGaWxlKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucztcbiAgICBjb25zdCBob3N0ID0gdGhpcy5fY29tcGlsZXJIb3N0O1xuICAgIGNvbnN0IGNhY2hlID0gdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuXG4gICAgY29uc3QgZXNJbXBvcnRzID0gY29sbGVjdERlZXBOb2Rlczx0cy5JbXBvcnREZWNsYXJhdGlvbj4oc291cmNlRmlsZSxcbiAgICAgIHRzLlN5bnRheEtpbmQuSW1wb3J0RGVjbGFyYXRpb24pXG4gICAgICAubWFwKGRlY2wgPT4ge1xuICAgICAgICBjb25zdCBtb2R1bGVOYW1lID0gKGRlY2wubW9kdWxlU3BlY2lmaWVyIGFzIHRzLlN0cmluZ0xpdGVyYWwpLnRleHQ7XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUobW9kdWxlTmFtZSwgcmVzb2x2ZWRGaWxlTmFtZSwgb3B0aW9ucywgaG9zdCwgY2FjaGUpO1xuXG4gICAgICAgIGlmIChyZXNvbHZlZC5yZXNvbHZlZE1vZHVsZSkge1xuICAgICAgICAgIHJldHVybiByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmZpbHRlcih4ID0+IHgpO1xuXG4gICAgY29uc3QgcmVzb3VyY2VJbXBvcnRzID0gZmluZFJlc291cmNlcyhzb3VyY2VGaWxlKVxuICAgICAgLm1hcCgocmVzb3VyY2VSZXBsYWNlbWVudCkgPT4gcmVzb3VyY2VSZXBsYWNlbWVudC5yZXNvdXJjZVBhdGhzKVxuICAgICAgLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5jb25jYXQoY3VyciksIFtdKVxuICAgICAgLm1hcCgocmVzb3VyY2VQYXRoKSA9PiByZXNvbHZlKGRpcm5hbWUocmVzb2x2ZWRGaWxlTmFtZSksIG5vcm1hbGl6ZShyZXNvdXJjZVBhdGgpKSk7XG5cbiAgICAvLyBUaGVzZSBwYXRocyBhcmUgbWVhbnQgdG8gYmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICBjb25zdCB1bmlxdWVEZXBlbmRlbmNpZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXModGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChyZXNvbHZlZEZpbGVOYW1lKSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8vIFRoaXMgY29kZSBtb3N0bHkgY29tZXMgZnJvbSBgcGVyZm9ybUNvbXBpbGF0aW9uYCBpbiBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYC5cbiAgLy8gSXQgc2tpcHMgdGhlIHByb2dyYW0gY3JlYXRpb24gYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZSBgbG9hZE5nU3RydWN0dXJlQXN5bmMoKWAsXG4gIC8vIGFuZCB1c2VzIEN1c3RvbVRyYW5zZm9ybWVycy5cbiAgcHJpdmF0ZSBfZW1pdChzb3VyY2VGaWxlczogdHMuU291cmNlRmlsZVtdKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG4gICAgY29uc3QgcHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW07XG4gICAgY29uc3QgYWxsRGlhZ25vc3RpY3M6IEFycmF5PHRzLkRpYWdub3N0aWMgfCBEaWFnbm9zdGljPiA9IFtdO1xuXG4gICAgbGV0IGVtaXRSZXN1bHQ6IHRzLkVtaXRSZXN1bHQgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHByb2dyYW0gYXMgdHMuUHJvZ3JhbTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4udHNQcm9ncmFtLmdldE9wdGlvbnNEaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuIHx8IHNvdXJjZUZpbGVzLmxlbmd0aCA+IDIwKSB7XG4gICAgICAgICAgICBlbWl0UmVzdWx0ID0gdHNQcm9ncmFtLmVtaXQoXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNvdXJjZUZpbGVzLmZvckVhY2goKHNmKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzZi5maWxlTmFtZX0rLmVtaXRgO1xuICAgICAgICAgICAgICB0aW1lKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICAgIGVtaXRSZXN1bHQgPSB0c1Byb2dyYW0uZW1pdChzZiwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgICAgIHRpbWVFbmQodGltZUxhYmVsKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBwcm9ncmFtIGFzIFByb2dyYW07XG5cbiAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBzdHJ1Y3R1cmFsIGRpYWdub3N0aWNzLlxuICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcygpKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgVHlwZVNjcmlwdCBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=