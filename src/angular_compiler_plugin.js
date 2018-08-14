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
            if (this._JitMode) {
                // Create the TypeScript program.
                benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
                this._program = ts.createProgram(this._rootNames, this._compilerOptions, this._compilerHost, this._program);
                benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
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
                // tslint:disable-next-line:non-null-operator
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
            webpackCompilerHost.enableCaching();
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
                const changedTsFiles = this._getChangedTsFiles();
                if (this._ngCompilerSupportsNewApi) {
                    this._processLazyRoutes(this._listLazyRoutesFromProgram());
                }
                else if (this._firstRun) {
                    this._processLazyRoutes(this._getLazyRoutesFromNgtools());
                }
                else if (changedTsFiles.length > 0) {
                    this._processLazyRoutes(this._findLazyRoutesInAst(changedTsFiles));
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
                && !this._compilerHost.fileExists(fileName, false))
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
                    sourceFiles.forEach((sf) => {
                        const timeLabel = `AngularCompilerPlugin._emit.ts+${sf.fileName}+.emit`;
                        benchmark_1.time(timeLabel);
                        emitResult = tsProgram.emit(sf, undefined, undefined, undefined, { before: this._transformers });
                        allDiagnostics.push(...emitResult.diagnostics);
                        benchmark_1.timeEnd(timeLabel);
                    });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7OztBQUFBOzs7Ozs7R0FNRztBQUNILCtDQUFtRztBQUNuRyxpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9FO0FBQ3BFLCtDQUE2RDtBQUM3RCwrQ0FnQnVCO0FBQ3ZCLGlEQUFrRDtBQUNsRCx1REFBMEQ7QUFDMUQsaURBU3dCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFBNEU7QUFDNUUsbUZBR3lDO0FBT3pDLDZEQUF3RDtBQUV4RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7QUE4Q3RDLElBQVksUUFHWDtBQUhELFdBQVksUUFBUTtJQUNsQiw2Q0FBTyxDQUFBO0lBQ1AsMkNBQU0sQ0FBQTtBQUNSLENBQUMsRUFIVyxRQUFRLEdBQVIsZ0JBQVEsS0FBUixnQkFBUSxRQUduQjtBQUVEO0lBNkNFLFlBQVksT0FBcUM7UUF2Q3pDLHdCQUFtQixHQUFhLEVBQUUsQ0FBQztRQUszQyw4REFBOEQ7UUFDdEQsZ0JBQVcsR0FBaUIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUtoRCxrQkFBYSxHQUEyQyxFQUFFLENBQUM7UUFDM0QsMEJBQXFCLEdBQWtELElBQUksQ0FBQztRQUU1RSxhQUFRLEdBQUcsS0FBSyxDQUFDO1FBQ2pCLGlCQUFZLEdBQUcsSUFBSSxDQUFDO1FBQ3BCLDJCQUFzQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBRWhFLGtCQUFrQjtRQUNW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QUN2QixJQUFJLENBQUMsQ0FBQyxXQUFXLEVBQUUsS0FBSyxnQkFBZ0IsRUFBRTtvQkFDeEMsU0FBUyxHQUFHLENBQUMsQ0FBQztvQkFDZCxNQUFNO2lCQUNQO2FBQ0Y7WUFFRCxJQUFJLFNBQVMsRUFBRTtnQkFDYixNQUFNLEdBQUcsU0FBUyxDQUFDO2FBQ3BCO2lCQUFNO2dCQUNMLDRCQUE0QjtnQkFDNUIsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7b0JBQ3hDLE1BQU0sR0FBRyxZQUFZLENBQUM7aUJBQ3ZCO3FCQUFNO29CQUNMLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLDZEQUE2RDt3QkFDL0UsNEJBQTRCLE1BQU0sS0FBSzt3QkFDdkMsc0JBQXNCLE1BQU07a0VBQzBCLENBQUMsQ0FBQztvQkFFMUQsT0FBTyxJQUFJLENBQUM7aUJBQ2I7YUFDRjtTQUNGO1FBRUQsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBbmpDRCxzREFtakNDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHsgUGF0aCwgZGlybmFtZSwgZ2V0U3lzdGVtUGF0aCwgbm9ybWFsaXplLCByZXNvbHZlLCB2aXJ0dWFsRnMgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBDb21waWxlciwgY29tcGlsYXRpb24gfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgZ2F0aGVyRGlhZ25vc3RpY3MsIGhhc0Vycm9ycyB9IGZyb20gJy4vZ2F0aGVyX2RpYWdub3N0aWNzJztcbmltcG9ydCB7IExhenlSb3V0ZU1hcCwgZmluZExhenlSb3V0ZXMgfSBmcm9tICcuL2xhenlfcm91dGVzJztcbmltcG9ydCB7XG4gIENvbXBpbGVyQ2xpSXNTdXBwb3J0ZWQsXG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBERUZBVUxUX0VSUk9SX0NPREUsXG4gIERpYWdub3N0aWMsXG4gIEVtaXRGbGFncyxcbiAgUHJvZ3JhbSxcbiAgU09VUkNFLFxuICBVTktOT1dOX0VSUk9SX0NPREUsXG4gIFZFUlNJT04sXG4gIF9fTkdUT09MU19QUklWQVRFX0FQSV8yLFxuICBjcmVhdGVDb21waWxlckhvc3QsXG4gIGNyZWF0ZVByb2dyYW0sXG4gIGZvcm1hdERpYWdub3N0aWNzLFxuICByZWFkQ29uZmlndXJhdGlvbixcbn0gZnJvbSAnLi9uZ3Rvb2xzX2FwaSc7XG5pbXBvcnQgeyByZXNvbHZlV2l0aFBhdGhzIH0gZnJvbSAnLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi9yZXNvdXJjZV9sb2FkZXInO1xuaW1wb3J0IHtcbiAgZXhwb3J0TGF6eU1vZHVsZU1hcCxcbiAgZXhwb3J0TmdGYWN0b3J5LFxuICBmaW5kUmVzb3VyY2VzLFxuICByZWdpc3RlckxvY2FsZURhdGEsXG4gIHJlbW92ZURlY29yYXRvcnMsXG4gIHJlcGxhY2VCb290c3RyYXAsXG4gIHJlcGxhY2VSZXNvdXJjZXMsXG4gIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAsXG59IGZyb20gJy4vdHJhbnNmb3JtZXJzJztcbmltcG9ydCB7IGNvbGxlY3REZWVwTm9kZXMgfSBmcm9tICcuL3RyYW5zZm9ybWVycy9hc3RfaGVscGVycyc7XG5pbXBvcnQgeyBBVVRPX1NUQVJUX0FSRywgSW5pdE1lc3NhZ2UsIFVwZGF0ZU1lc3NhZ2UgfSBmcm9tICcuL3R5cGVfY2hlY2tlcic7XG5pbXBvcnQge1xuICBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcixcbiAgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcixcbn0gZnJvbSAnLi92aXJ0dWFsX2ZpbGVfc3lzdGVtX2RlY29yYXRvcic7XG5pbXBvcnQge1xuICBDYWxsYmFjayxcbiAgSW5wdXRGaWxlU3lzdGVtLFxuICBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcbmltcG9ydCB7IFdlYnBhY2tJbnB1dEhvc3QgfSBmcm9tICcuL3dlYnBhY2staW5wdXQtaG9zdCc7XG5cbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHt9XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3Ige1xuICBuZXcobW9kdWxlUGF0aDogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3k7XG59XG5cbi8qKlxuICogT3B0aW9uIENvbnN0YW50c1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMge1xuICBzb3VyY2VNYXA/OiBib29sZWFuO1xuICB0c0NvbmZpZ1BhdGg6IHN0cmluZztcbiAgYmFzZVBhdGg/OiBzdHJpbmc7XG4gIGVudHJ5TW9kdWxlPzogc3RyaW5nO1xuICBtYWluUGF0aD86IHN0cmluZztcbiAgc2tpcENvZGVHZW5lcmF0aW9uPzogYm9vbGVhbjtcbiAgaG9zdFJlcGxhY2VtZW50UGF0aHM/OiB7IFtwYXRoOiBzdHJpbmddOiBzdHJpbmcgfSB8ICgocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcpO1xuICBmb3JrVHlwZUNoZWNrZXI/OiBib29sZWFuO1xuICAvLyBUT0RPOiByZW1vdmUgc2luZ2xlRmlsZUluY2x1ZGVzIGZvciAyLjAsIHRoaXMgaXMganVzdCB0byBzdXBwb3J0IG9sZCBwcm9qZWN0cyB0aGF0IGRpZCBub3RcbiAgLy8gaW5jbHVkZSAncG9seWZpbGxzLnRzJyBpbiBgdHNjb25maWcuc3BlYy5qc29uJy5cbiAgc2luZ2xlRmlsZUluY2x1ZGVzPzogc3RyaW5nW107XG4gIGkxOG5JbkZpbGU/OiBzdHJpbmc7XG4gIGkxOG5JbkZvcm1hdD86IHN0cmluZztcbiAgaTE4bk91dEZpbGU/OiBzdHJpbmc7XG4gIGkxOG5PdXRGb3JtYXQ/OiBzdHJpbmc7XG4gIGxvY2FsZT86IHN0cmluZztcbiAgbWlzc2luZ1RyYW5zbGF0aW9uPzogc3RyaW5nO1xuICBwbGF0Zm9ybT86IFBMQVRGT1JNO1xuICBuYW1lTGF6eUZpbGVzPzogYm9vbGVhbjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gIC8vIFRoZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgb2YgY29ycmVjdCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAvLyBUaGlzIGlzIG5lZWRlZCB3aGVuIHRoZXJlIGFyZSBtdWx0aXBsZSBXZWJwYWNrIGluc3RhbGxzLlxuICBjb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcj86IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0PzogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+O1xuICBwbGF0Zm9ybVRyYW5zZm9ybWVycz86IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdO1xufVxuXG5leHBvcnQgZW51bSBQTEFURk9STSB7XG4gIEJyb3dzZXIsXG4gIFNlcnZlcixcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJDb21waWxlclBsdWdpbiB7XG4gIHByaXZhdGUgX29wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnM7XG5cbiAgLy8gVFMgY29tcGlsYXRpb24uXG4gIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zO1xuICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdO1xuICBwcml2YXRlIF9zaW5nbGVGaWxlSW5jbHVkZXM6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgX3Byb2dyYW06ICh0cy5Qcm9ncmFtIHwgUHJvZ3JhbSkgfCBudWxsO1xuICBwcml2YXRlIF9jb21waWxlckhvc3Q6IFdlYnBhY2tDb21waWxlckhvc3QgJiBDb21waWxlckhvc3Q7XG4gIHByaXZhdGUgX21vZHVsZVJlc29sdXRpb25DYWNoZTogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuICBwcml2YXRlIF9yZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyO1xuICAvLyBDb250YWlucyBgbW9kdWxlSW1wb3J0UGF0aCNleHBvcnROYW1lYCA9PiBgZnVsbE1vZHVsZVBhdGhgLlxuICBwcml2YXRlIF9sYXp5Um91dGVzOiBMYXp5Um91dGVNYXAgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICBwcml2YXRlIF90c0NvbmZpZ1BhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfZW50cnlNb2R1bGU6IHN0cmluZyB8IG51bGw7XG4gIHByaXZhdGUgX21haW5QYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgX2Jhc2VQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX3RyYW5zZm9ybWVyczogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W10gPSBbXTtcbiAgcHJpdmF0ZSBfcGxhdGZvcm1UcmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgX3BsYXRmb3JtOiBQTEFURk9STTtcbiAgcHJpdmF0ZSBfSml0TW9kZSA9IGZhbHNlO1xuICBwcml2YXRlIF9lbWl0U2tpcHBlZCA9IHRydWU7XG4gIHByaXZhdGUgX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucyA9IG5ldyBTZXQoWyd0cycsICdodG1sJywgJ2NzcyddKTtcblxuICAvLyBXZWJwYWNrIHBsdWdpbi5cbiAgcHJpdmF0ZSBfZmlyc3RSdW4gPSB0cnVlO1xuICBwcml2YXRlIF9kb25lUHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGw7XG4gIHByaXZhdGUgX25vcm1hbGl6ZWRMb2NhbGU6IHN0cmluZyB8IG51bGw7XG4gIHByaXZhdGUgX3dhcm5pbmdzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcbiAgcHJpdmF0ZSBfZXJyb3JzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcbiAgcHJpdmF0ZSBfY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I6IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFR5cGVDaGVja2VyIHByb2Nlc3MuXG4gIHByaXZhdGUgX2ZvcmtUeXBlQ2hlY2tlciA9IHRydWU7XG4gIHByaXZhdGUgX3R5cGVDaGVja2VyUHJvY2VzczogQ2hpbGRQcm9jZXNzIHwgbnVsbDtcbiAgcHJpdmF0ZSBfZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IGZhbHNlO1xuXG4gIHByaXZhdGUgZ2V0IF9uZ0NvbXBpbGVyU3VwcG9ydHNOZXdBcGkoKSB7XG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuICEhKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkubGlzdExhenlSb3V0ZXM7XG4gICAgfVxuICB9XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIENvbXBpbGVyQ2xpSXNTdXBwb3J0ZWQoKTtcbiAgICB0aGlzLl9vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgb3B0aW9ucyk7XG4gICAgdGhpcy5fc2V0dXBPcHRpb25zKHRoaXMuX29wdGlvbnMpO1xuICB9XG5cbiAgZ2V0IG9wdGlvbnMoKSB7IHJldHVybiB0aGlzLl9vcHRpb25zOyB9XG4gIGdldCBkb25lKCkgeyByZXR1cm4gdGhpcy5fZG9uZVByb21pc2U7IH1cbiAgZ2V0IGVudHJ5TW9kdWxlKCkge1xuICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBzcGxpdHRlZCA9IHRoaXMuX2VudHJ5TW9kdWxlLnNwbGl0KC8oI1thLXpBLVpfXShbXFx3XSspKSQvKTtcbiAgICBjb25zdCBwYXRoID0gc3BsaXR0ZWRbMF07XG4gICAgY29uc3QgY2xhc3NOYW1lID0gISFzcGxpdHRlZFsxXSA/IHNwbGl0dGVkWzFdLnN1YnN0cmluZygxKSA6ICdkZWZhdWx0JztcblxuICAgIHJldHVybiB7IHBhdGgsIGNsYXNzTmFtZSB9O1xuICB9XG5cbiAgZ2V0IHR5cGVDaGVja2VyKCk6IHRzLlR5cGVDaGVja2VyIHwgbnVsbCB7XG4gICAgY29uc3QgdHNQcm9ncmFtID0gdGhpcy5fZ2V0VHNQcm9ncmFtKCk7XG5cbiAgICByZXR1cm4gdHNQcm9ncmFtID8gdHNQcm9ncmFtLmdldFR5cGVDaGVja2VyKCkgOiBudWxsO1xuICB9XG5cbiAgc3RhdGljIGlzU3VwcG9ydGVkKCkge1xuICAgIHJldHVybiBWRVJTSU9OICYmIHBhcnNlSW50KFZFUlNJT04ubWFqb3IpID49IDU7XG4gIH1cblxuICBwcml2YXRlIF9zZXR1cE9wdGlvbnMob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gICAgLy8gRmlsbCBpbiB0aGUgbWlzc2luZyBvcHRpb25zLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgndHNDb25maWdQYXRoJykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTXVzdCBzcGVjaWZ5IFwidHNDb25maWdQYXRoXCIgaW4gdGhlIGNvbmZpZ3VyYXRpb24gb2YgQG5ndG9vbHMvd2VicGFjay4nKTtcbiAgICB9XG4gICAgLy8gVFMgcmVwcmVzZW50cyBwYXRocyBpbnRlcm5hbGx5IHdpdGggJy8nIGFuZCBleHBlY3RzIHRoZSB0c2NvbmZpZyBwYXRoIHRvIGJlIGluIHRoaXMgZm9ybWF0XG4gICAgdGhpcy5fdHNDb25maWdQYXRoID0gb3B0aW9ucy50c0NvbmZpZ1BhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgLy8gQ2hlY2sgdGhlIGJhc2UgcGF0aC5cbiAgICBjb25zdCBtYXliZUJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgbGV0IGJhc2VQYXRoID0gbWF5YmVCYXNlUGF0aDtcbiAgICBpZiAoZnMuc3RhdFN5bmMobWF5YmVCYXNlUGF0aCkuaXNGaWxlKCkpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKGJhc2VQYXRoKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuYmFzZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgYmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgb3B0aW9ucy5iYXNlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuc2luZ2xlRmlsZUluY2x1ZGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3NpbmdsZUZpbGVJbmNsdWRlcy5wdXNoKC4uLm9wdGlvbnMuc2luZ2xlRmlsZUluY2x1ZGVzKTtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSB0aGUgdHNjb25maWcgY29udGVudHMuXG4gICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICBpZiAoY29uZmlnLmVycm9ycyAmJiBjb25maWcuZXJyb3JzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGZvcm1hdERpYWdub3N0aWNzKGNvbmZpZy5lcnJvcnMpKTtcbiAgICB9XG5cbiAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzLmNvbmNhdCguLi50aGlzLl9zaW5nbGVGaWxlSW5jbHVkZXMpO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyA9IHsgLi4uY29uZmlnLm9wdGlvbnMsIC4uLm9wdGlvbnMuY29tcGlsZXJPcHRpb25zIH07XG4gICAgdGhpcy5fYmFzZVBhdGggPSBjb25maWcub3B0aW9ucy5iYXNlUGF0aCB8fCBiYXNlUGF0aCB8fCAnJztcblxuICAgIC8vIE92ZXJ3cml0ZSBvdXREaXIgc28gd2UgY2FuIGZpbmQgZ2VuZXJhdGVkIGZpbGVzIG5leHQgdG8gdGhlaXIgLnRzIG9yaWdpbiBpbiBjb21waWxlckhvc3QuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm91dERpciA9ICcnO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zdXBwcmVzc091dHB1dFBhdGhDaGVjayA9IHRydWU7XG5cbiAgICAvLyBEZWZhdWx0IHBsdWdpbiBzb3VyY2VNYXAgdG8gY29tcGlsZXIgb3B0aW9ucyBzZXR0aW5nLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc291cmNlTWFwJykpIHtcbiAgICAgIG9wdGlvbnMuc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCB8fCBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBGb3JjZSB0aGUgcmlnaHQgc291cmNlbWFwIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuc291cmNlTWFwKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgLy8gV2Ugd2lsbCBzZXQgdGhlIHNvdXJjZSB0byB0aGUgZnVsbCBwYXRoIG9mIHRoZSBmaWxlIGluIHRoZSBsb2FkZXIsIHNvIHdlIGRvbid0XG4gICAgICAvLyBuZWVkIHNvdXJjZVJvb3QgaGVyZS5cbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gV2Ugd2FudCB0byBhbGxvdyBlbWl0dGluZyB3aXRoIGVycm9ycyBzbyB0aGF0IGltcG9ydHMgY2FuIGJlIGFkZGVkXG4gICAgLy8gdG8gdGhlIHdlYnBhY2sgZGVwZW5kZW5jeSB0cmVlIGFuZCByZWJ1aWxkcyB0cmlnZ2VyZWQgYnkgZmlsZSBlZGl0cy5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubm9FbWl0T25FcnJvciA9IGZhbHNlO1xuXG4gICAgLy8gU2V0IEpJVCAobm8gY29kZSBnZW5lcmF0aW9uKSBvciBBT1QgbW9kZS5cbiAgICBpZiAob3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fSml0TW9kZSA9IG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgaTE4biBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZpbGUgPSBvcHRpb25zLmkxOG5JbkZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRm9ybWF0ID0gb3B0aW9ucy5pMThuSW5Gb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSA9IG9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGb3JtYXQgPSBvcHRpb25zLmkxOG5PdXRGb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmxvY2FsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dExvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSA9IHRoaXMuX3ZhbGlkYXRlTG9jYWxlKG9wdGlvbnMubG9jYWxlKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5NaXNzaW5nVHJhbnNsYXRpb25zID1cbiAgICAgICAgb3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gYXMgJ2Vycm9yJyB8ICd3YXJuaW5nJyB8ICdpZ25vcmUnO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgZm9ya2VkIHR5cGUgY2hlY2tlciBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmZvcmtUeXBlQ2hlY2tlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBvcHRpb25zLmZvcmtUeXBlQ2hlY2tlcjtcbiAgICB9XG5cbiAgICAvLyBBZGQgY3VzdG9tIHBsYXRmb3JtIHRyYW5zZm9ybWVycy5cbiAgICBpZiAob3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyA9IG9wdGlvbnMucGxhdGZvcm1UcmFuc2Zvcm1lcnM7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgdG8gdGhlIG9uZSB3ZSBjYW4gaW1wb3J0IGZyb20gaGVyZS5cbiAgICAvLyBGYWlsaW5nIHRvIHVzZSB0aGUgcmlnaHQgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHdpbGwgdGhyb3cgdGhlIGVycm9yIGJlbG93OlxuICAgIC8vIFwiTm8gbW9kdWxlIGZhY3RvcnkgYXZhaWxhYmxlIGZvciBkZXBlbmRlbmN5IHR5cGU6IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeVwiXG4gICAgLy8gSG9pc3RpbmcgdG9nZXRoZXIgd2l0aCBwZWVyIGRlcGVuZGVuY2llcyBjYW4gbWFrZSBpdCBzbyB0aGUgaW1wb3J0ZWRcbiAgICAvLyBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgZG9lcyBub3QgY29tZSBmcm9tIHRoZSBzYW1lIFdlYnBhY2sgaW5zdGFuY2UgdGhhdCBpcyB1c2VkXG4gICAgLy8gaW4gdGhlIGNvbXBpbGF0aW9uLiBJbiB0aGF0IGNhc2UsIHdlIGNhbiBwYXNzIHRoZSByaWdodCBvbmUgYXMgYW4gb3B0aW9uIHRvIHRoZSBwbHVnaW4uXG4gICAgdGhpcy5fY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3IgPSBvcHRpb25zLmNvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yXG4gICAgICB8fCByZXF1aXJlKCd3ZWJwYWNrL2xpYi9kZXBlbmRlbmNpZXMvQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Jyk7XG5cbiAgICAvLyBVc2UgZW50cnlNb2R1bGUgaWYgYXZhaWxhYmxlIGluIG9wdGlvbnMsIG90aGVyd2lzZSByZXNvbHZlIGl0IGZyb20gbWFpblBhdGggYWZ0ZXIgcHJvZ3JhbVxuICAgIC8vIGNyZWF0aW9uLlxuICAgIGlmICh0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGU7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUgYXMgc3RyaW5nKTsgLy8gdGVtcG9yYXJ5IGNhc3QgZm9yIHR5cGUgaXNzdWVcbiAgICB9XG5cbiAgICAvLyBTZXQgcGxhdGZvcm0uXG4gICAgdGhpcy5fcGxhdGZvcm0gPSBvcHRpb25zLnBsYXRmb3JtIHx8IFBMQVRGT1JNLkJyb3dzZXI7XG5cbiAgICAvLyBNYWtlIHRyYW5zZm9ybWVycy5cbiAgICB0aGlzLl9tYWtlVHJhbnNmb3JtZXJzKCk7XG5cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0VHNQcm9ncmFtKCkge1xuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkVHNGaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IChrLmVuZHNXaXRoKCcudHMnKSB8fCBrLmVuZHNXaXRoKCcudHN4JykpICYmICFrLmVuZHNXaXRoKCcuZC50cycpKVxuICAgICAgLmZpbHRlcihrID0+IHRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGspKTtcbiAgfVxuXG4gIHVwZGF0ZUNoYW5nZWRGaWxlRXh0ZW5zaW9ucyhleHRlbnNpb246IHN0cmluZykge1xuICAgIGlmIChleHRlbnNpb24pIHtcbiAgICAgIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucy5hZGQoZXh0ZW5zaW9uKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBleHQgb2YgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zKSB7XG4gICAgICAgICAgaWYgKGsuZW5kc1dpdGgoZXh0KSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgICAgIC8vIFdoZW4gYSBuZXcgcm9vdCBuYW1lIChsaWtlIGEgbGF6eSByb3V0ZSkgaXMgYWRkZWQsIGl0IHdvbid0IGJlIGF2YWlsYWJsZSBmcm9tXG4gICAgICAgIC8vIGZvbGxvd2luZyBpbXBvcnRzIG9uIHRoZSBleGlzdGluZyBmaWxlcywgc28gd2UgbmVlZCB0byBnZXQgdGhlIG5ldyBsaXN0IG9mIHJvb3QgZmlsZXMuXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXMuY29uY2F0KC4uLnRoaXMuX3NpbmdsZUZpbGVJbmNsdWRlcyk7XG5cbiAgICAgICAgLy8gVXBkYXRlIHRoZSBmb3JrZWQgdHlwZSBjaGVja2VyIHdpdGggYWxsIGNoYW5nZWQgY29tcGlsYXRpb24gZmlsZXMuXG4gICAgICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICB0aGlzLl91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcih0aGlzLl9yb290TmFtZXMsIHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXNlIGFuIGlkZW50aXR5IGZ1bmN0aW9uIGFzIGFsbCBvdXIgcGF0aHMgYXJlIGFic29sdXRlIGFscmVhZHkuXG4gICAgICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSA9IHRzLmNyZWF0ZU1vZHVsZVJlc29sdXRpb25DYWNoZSh0aGlzLl9iYXNlUGF0aCwgeCA9PiB4KTtcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgICAgICB0aGlzLl9wcm9ncmFtID0gdHMuY3JlYXRlUHJvZ3JhbShcbiAgICAgICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgICAgIHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSxcbiAgICAgICAgICApO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAgICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHByb2dyYW0uXG4gICAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9wcm9ncmFtLmxvYWROZ1N0cnVjdHVyZUFzeW5jKClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBJZiB0aGVyZSdzIHN0aWxsIG5vIGVudHJ5TW9kdWxlIHRyeSB0byByZXNvbHZlIGZyb20gbWFpblBhdGguXG4gICAgICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUgJiYgdGhpcy5fbWFpblBhdGgpIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluKFxuICAgICAgICAgICAgdGhpcy5fbWFpblBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdGhpcy5fZ2V0VHNQcm9ncmFtKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpIHtcbiAgICB0cnkge1xuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMnKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IF9fTkdUT09MU19QUklWQVRFX0FQSV8yLmxpc3RMYXp5Um91dGVzKHtcbiAgICAgICAgcHJvZ3JhbTogdGhpcy5fZ2V0VHNQcm9ncmFtKCksXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgYW5ndWxhckNvbXBpbGVyT3B0aW9uczogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fY29tcGlsZXJPcHRpb25zLCB7XG4gICAgICAgICAgLy8gZ2VuRGlyIHNlZW1zIHRvIHN0aWxsIGJlIG5lZWRlZCBpbiBAYW5ndWxhclxcY29tcGlsZXItY2xpXFxzcmNcXGNvbXBpbGVyX2hvc3QuanM6MjI2LlxuICAgICAgICAgIGdlbkRpcjogJycsXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBUT0RPOiBmaXggY29tcGlsZXItY2xpIHR5cGluZ3M7IGVudHJ5TW9kdWxlIHNob3VsZCBub3QgYmUgc3RyaW5nLCBidXQgYWxzbyBvcHRpb25hbC5cbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vbi1udWxsLW9wZXJhdG9yXG4gICAgICAgIGVudHJ5TW9kdWxlOiB0aGlzLl9lbnRyeU1vZHVsZSAhLFxuICAgICAgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2dldExhenlSb3V0ZXNGcm9tTmd0b29scycpO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gV2Ugc2lsZW5jZSB0aGUgZXJyb3IgdGhhdCB0aGUgQGFuZ3VsYXIvcm91dGVyIGNvdWxkIG5vdCBiZSBmb3VuZC4gSW4gdGhhdCBjYXNlLCB0aGVyZSBpc1xuICAgICAgLy8gYmFzaWNhbGx5IG5vIHJvdXRlIHN1cHBvcnRlZCBieSB0aGUgYXBwIGl0c2VsZi5cbiAgICAgIGlmIChlcnIubWVzc2FnZS5zdGFydHNXaXRoKCdDb3VsZCBub3QgcmVzb2x2ZSBtb2R1bGUgQGFuZ3VsYXIvcm91dGVyJykpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2ZpbmRMYXp5Um91dGVzSW5Bc3QoY2hhbmdlZEZpbGVQYXRoczogc3RyaW5nW10pOiBMYXp5Um91dGVNYXAge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZmluZExhenlSb3V0ZXNJbkFzdCcpO1xuICAgIGNvbnN0IHJlc3VsdDogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIGNoYW5nZWRGaWxlUGF0aHMpIHtcbiAgICAgIGNvbnN0IGZpbGVMYXp5Um91dGVzID0gZmluZExhenlSb3V0ZXMoZmlsZVBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdW5kZWZpbmVkLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMpO1xuICAgICAgZm9yIChjb25zdCByb3V0ZUtleSBvZiBPYmplY3Qua2V5cyhmaWxlTGF6eVJvdXRlcykpIHtcbiAgICAgICAgY29uc3Qgcm91dGUgPSBmaWxlTGF6eVJvdXRlc1tyb3V0ZUtleV07XG4gICAgICAgIHJlc3VsdFtyb3V0ZUtleV0gPSByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGNvbnN0IG5nUHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbTtcbiAgICBpZiAoIW5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSB3YXMgY2FsbGVkIHdpdGggYW4gb2xkIHByb2dyYW0uJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcygpO1xuXG4gICAgcmV0dXJuIGxhenlSb3V0ZXMucmVkdWNlKFxuICAgICAgKGFjYywgY3VycikgPT4ge1xuICAgICAgICBjb25zdCByZWYgPSBjdXJyLnJvdXRlO1xuICAgICAgICBpZiAocmVmIGluIGFjYyAmJiBhY2NbcmVmXSAhPT0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgKyBgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZDogXCIke3JlZn1cIiBpcyB1c2VkIGluIDIgbG9hZENoaWxkcmVuLCBgXG4gICAgICAgICAgICArIGBidXQgdGhleSBwb2ludCB0byBkaWZmZXJlbnQgbW9kdWxlcyBcIigke2FjY1tyZWZdfSBhbmQgYFxuICAgICAgICAgICAgKyBgXCIke2N1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aH1cIikuIFdlYnBhY2sgY2Fubm90IGRpc3Rpbmd1aXNoIG9uIGNvbnRleHQgYW5kIGBcbiAgICAgICAgICAgICsgJ3dvdWxkIGZhaWwgdG8gbG9hZCB0aGUgcHJvcGVyIG9uZS4nLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgYWNjW3JlZl0gPSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGg7XG5cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sXG4gICAgICB7fSBhcyBMYXp5Um91dGVNYXAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFByb2Nlc3MgdGhlIGxhenkgcm91dGVzIGRpc2NvdmVyZWQsIGFkZGluZyB0aGVuIHRvIF9sYXp5Um91dGVzLlxuICAvLyBUT0RPOiBmaW5kIGEgd2F5IHRvIHJlbW92ZSBsYXp5IHJvdXRlcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG4gIC8vIFRoaXMgd2lsbCByZXF1aXJlIGEgcmVnaXN0cnkgb2Yga25vd24gcmVmZXJlbmNlcyB0byBhIGxhenkgcm91dGUsIHJlbW92aW5nIGl0IHdoZW4gbm9cbiAgLy8gbW9kdWxlIHJlZmVyZW5jZXMgaXQgYW55bW9yZS5cbiAgcHJpdmF0ZSBfcHJvY2Vzc0xhenlSb3V0ZXMoZGlzY292ZXJlZExhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCkge1xuICAgIE9iamVjdC5rZXlzKGRpc2NvdmVyZWRMYXp5Um91dGVzKVxuICAgICAgLmZvckVhY2gobGF6eVJvdXRlS2V5ID0+IHtcbiAgICAgICAgY29uc3QgW2xhenlSb3V0ZU1vZHVsZSwgbW9kdWxlTmFtZV0gPSBsYXp5Um91dGVLZXkuc3BsaXQoJyMnKTtcblxuICAgICAgICBpZiAoIWxhenlSb3V0ZU1vZHVsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxhenlSb3V0ZVRTRmlsZSA9IGRpc2NvdmVyZWRMYXp5Um91dGVzW2xhenlSb3V0ZUtleV0ucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICAgICAgICBsZXQgbW9kdWxlUGF0aDogc3RyaW5nLCBtb2R1bGVLZXk6IHN0cmluZztcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGU7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfSR7bW9kdWxlTmFtZSA/ICcjJyArIG1vZHVsZU5hbWUgOiAnJ31gO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGUucmVwbGFjZSgvKFxcLmQpP1xcLnRzeD8kLywgJycpO1xuICAgICAgICAgIG1vZHVsZVBhdGggKz0gJy5uZ2ZhY3RvcnkuanMnO1xuICAgICAgICAgIGNvbnN0IGZhY3RvcnlNb2R1bGVOYW1lID0gbW9kdWxlTmFtZSA/IGAjJHttb2R1bGVOYW1lfU5nRmFjdG9yeWAgOiAnJztcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9Lm5nZmFjdG9yeSR7ZmFjdG9yeU1vZHVsZU5hbWV9YDtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZHVsZVBhdGggPSB3b3JrYXJvdW5kUmVzb2x2ZShtb2R1bGVQYXRoKTtcblxuICAgICAgICBpZiAobW9kdWxlS2V5IGluIHRoaXMuX2xhenlSb3V0ZXMpIHtcbiAgICAgICAgICBpZiAodGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldICE9PSBtb2R1bGVQYXRoKSB7XG4gICAgICAgICAgICAvLyBGb3VuZCBhIGR1cGxpY2F0ZSwgdGhpcyBpcyBhbiBlcnJvci5cbiAgICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2goXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZCBkdXJpbmcgYSByZWJ1aWxkLiBgXG4gICAgICAgICAgICAgICAgKyBgV2Ugd2lsbCB0YWtlIHRoZSBsYXRlc3QgdmVyc2lvbiBkZXRlY3RlZCBhbmQgb3ZlcnJpZGUgaXQgdG8gc2F2ZSByZWJ1aWxkIHRpbWUuIGBcbiAgICAgICAgICAgICAgICArIGBZb3Ugc2hvdWxkIHBlcmZvcm0gYSBmdWxsIGJ1aWxkIHRvIHZhbGlkYXRlIHRoYXQgeW91ciByb3V0ZXMgZG9uJ3Qgb3ZlcmxhcC5gKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEZvdW5kIGEgbmV3IHJvdXRlLCBhZGQgaXQgdG8gdGhlIG1hcC5cbiAgICAgICAgICB0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gPSBtb2R1bGVQYXRoO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIC8vIEJvb3RzdHJhcCB0eXBlIGNoZWNrZXIgaXMgdXNpbmcgbG9jYWwgQ0xJLlxuICAgIGNvbnN0IGc6IGFueSA9IHR5cGVvZiBnbG9iYWwgIT09ICd1bmRlZmluZWQnID8gZ2xvYmFsIDoge307ICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgIGNvbnN0IHR5cGVDaGVja2VyRmlsZTogc3RyaW5nID0gZ1snX0RldktpdElzTG9jYWwnXVxuICAgICAgPyAnLi90eXBlX2NoZWNrZXJfYm9vdHN0cmFwLmpzJ1xuICAgICAgOiAnLi90eXBlX2NoZWNrZXJfd29ya2VyLmpzJztcblxuICAgIGNvbnN0IGRlYnVnQXJnUmVnZXggPSAvLS1pbnNwZWN0KD86LWJya3wtcG9ydCk/fC0tZGVidWcoPzotYnJrfC1wb3J0KS87XG5cbiAgICBjb25zdCBleGVjQXJndiA9IHByb2Nlc3MuZXhlY0FyZ3YuZmlsdGVyKChhcmcpID0+IHtcbiAgICAgIC8vIFJlbW92ZSBkZWJ1ZyBhcmdzLlxuICAgICAgLy8gV29ya2Fyb3VuZCBmb3IgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy85NDM1XG4gICAgICByZXR1cm4gIWRlYnVnQXJnUmVnZXgudGVzdChhcmcpO1xuICAgIH0pO1xuICAgIC8vIFNpZ25hbCB0aGUgcHJvY2VzcyB0byBzdGFydCBsaXN0ZW5pbmcgZm9yIG1lc3NhZ2VzXG4gICAgLy8gU29sdmVzIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy85MDcxXG4gICAgY29uc3QgZm9ya0FyZ3MgPSBbQVVUT19TVEFSVF9BUkddO1xuICAgIGNvbnN0IGZvcmtPcHRpb25zOiBGb3JrT3B0aW9ucyA9IHsgZXhlY0FyZ3YgfTtcblxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IGZvcmsoXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCB0eXBlQ2hlY2tlckZpbGUpLFxuICAgICAgZm9ya0FyZ3MsXG4gICAgICBmb3JrT3B0aW9ucyk7XG5cbiAgICAvLyBIYW5kbGUgY2hpbGQgcHJvY2VzcyBleGl0LlxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5vbmNlKCdleGl0JywgKF8sIHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcblxuICAgICAgLy8gSWYgcHJvY2VzcyBleGl0ZWQgbm90IGJlY2F1c2Ugb2YgU0lHVEVSTSAoc2VlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIpLCB0aGFuIHNvbWV0aGluZ1xuICAgICAgLy8gd2VudCB3cm9uZyBhbmQgaXQgc2hvdWxkIGZhbGxiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gdGhlIG1haW4gdGhyZWFkLlxuICAgICAgaWYgKHNpZ25hbCAhPT0gJ1NJR1RFUk0nKSB7XG4gICAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtc2cgPSAnQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBGb3JrZWQgVHlwZSBDaGVja2VyIGV4aXRlZCB1bmV4cGVjdGVkbHkuICcgK1xuICAgICAgICAgICdGYWxsaW5nIGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiBtYWluIHRocmVhZC4nO1xuICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1zZyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkKSB7XG4gICAgICB0cmVlS2lsbCh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkLCAnU0lHVEVSTScpO1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcihyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICBpZiAoIXRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IEluaXRNZXNzYWdlKHRoaXMuX2NvbXBpbGVyT3B0aW9ucywgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgICAgdGhpcy5fSml0TW9kZSwgdGhpcy5fcm9vdE5hbWVzKSk7XG4gICAgICAgIHRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IFVwZGF0ZU1lc3NhZ2Uocm9vdE5hbWVzLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlcykpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlZ2lzdHJhdGlvbiBob29rIGZvciB3ZWJwYWNrIHBsdWdpbi5cbiAgYXBwbHkoY29tcGlsZXI6IENvbXBpbGVyKSB7XG4gICAgLy8gRGVjb3JhdGUgaW5wdXRGaWxlU3lzdGVtIHRvIHNlcnZlIGNvbnRlbnRzIG9mIENvbXBpbGVySG9zdC5cbiAgICAvLyBVc2UgZGVjb3JhdGVkIGlucHV0RmlsZVN5c3RlbSBpbiB3YXRjaEZpbGVTeXN0ZW0uXG4gICAgY29tcGlsZXIuaG9va3MuZW52aXJvbm1lbnQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgLy8gVGhlIHdlYnBhY2sgdHlwZXMgY3VycmVudGx5IGRvIG5vdCBpbmNsdWRlIHRoZXNlXG4gICAgICBjb25zdCBjb21waWxlcldpdGhGaWxlU3lzdGVtcyA9IGNvbXBpbGVyIGFzIENvbXBpbGVyICYge1xuICAgICAgICBpbnB1dEZpbGVTeXN0ZW06IElucHV0RmlsZVN5c3RlbSxcbiAgICAgICAgd2F0Y2hGaWxlU3lzdGVtOiBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICAgICAgfTtcblxuICAgICAgbGV0IGhvc3Q6IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPiA9IHRoaXMuX29wdGlvbnMuaG9zdCB8fCBuZXcgV2VicGFja0lucHV0SG9zdChcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgKTtcblxuICAgICAgbGV0IHJlcGxhY2VtZW50czogTWFwPFBhdGgsIFBhdGg+IHwgKChwYXRoOiBQYXRoKSA9PiBQYXRoKSB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRSZXNvbHZlciA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gcGF0aCA9PiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgaG9zdCA9IG5ldyBjbGFzcyBleHRlbmRzIHZpcnR1YWxGcy5SZXNvbHZlckhvc3Q8ZnMuU3RhdHM+IHtcbiAgICAgICAgICAgIF9yZXNvbHZlKHBhdGg6IFBhdGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KGhvc3QpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgICBjb25zdCBhbGlhc0hvc3QgPSBuZXcgdmlydHVhbEZzLkFsaWFzSG9zdChob3N0KTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGZyb20gaW4gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSByZXNvbHZlKG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksIG5vcm1hbGl6ZShmcm9tKSk7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkV2l0aCA9IHJlc29sdmUoXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzW2Zyb21dKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGlhc0hvc3QuYWxpYXNlcy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50cy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaG9zdCA9IGFsaWFzSG9zdDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDcmVhdGUgdGhlIHdlYnBhY2sgY29tcGlsZXIgaG9zdC5cbiAgICAgIGNvbnN0IHdlYnBhY2tDb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgaG9zdCxcbiAgICAgICk7XG4gICAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LmVuYWJsZUNhY2hpbmcoKTtcblxuICAgICAgLy8gQ3JlYXRlIGFuZCBzZXQgYSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyLlxuICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LnNldFJlc291cmNlTG9hZGVyKHRoaXMuX3Jlc291cmNlTG9hZGVyKTtcblxuICAgICAgLy8gVXNlIHRoZSBXZWJwYWNrQ29tcGlsZXJIb3N0IHdpdGggYSByZXNvdXJjZSBsb2FkZXIgdG8gY3JlYXRlIGFuIEFuZ3VsYXJDb21waWxlckhvc3QuXG4gICAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRzSG9zdDogd2VicGFja0NvbXBpbGVySG9zdCxcbiAgICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG5cbiAgICAgIC8vIFJlc29sdmUgbWFpblBhdGggaWYgcHJvdmlkZWQuXG4gICAgICBpZiAodGhpcy5fb3B0aW9ucy5tYWluUGF0aCkge1xuICAgICAgICB0aGlzLl9tYWluUGF0aCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKHRoaXMuX29wdGlvbnMubWFpblBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnB1dERlY29yYXRvciA9IG5ldyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICApO1xuICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtID0gaW5wdXREZWNvcmF0b3I7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy53YXRjaEZpbGVTeXN0ZW0gPSBuZXcgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgaW5wdXREZWNvcmF0b3IsXG4gICAgICAgIHJlcGxhY2VtZW50cyxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgbGF6eSBtb2R1bGVzIHRvIHRoZSBjb250ZXh0IG1vZHVsZSBmb3IgQGFuZ3VsYXIvY29yZVxuICAgIGNvbXBpbGVyLmhvb2tzLmNvbnRleHRNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNtZiA9PiB7XG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVBhY2thZ2VQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb3JlL3BhY2thZ2UuanNvbicpO1xuXG4gICAgICAvLyBBUEZ2NiBkb2VzIG5vdCBoYXZlIHNpbmdsZSBGRVNNIGFueW1vcmUuIEluc3RlYWQgb2YgdmVyaWZ5aW5nIGlmIHdlJ3JlIHBvaW50aW5nIHRvXG4gICAgICAvLyBGRVNNcywgd2UgcmVzb2x2ZSB0aGUgYEBhbmd1bGFyL2NvcmVgIHBhdGggYW5kIHZlcmlmeSB0aGF0IHRoZSBwYXRoIGZvciB0aGVcbiAgICAgIC8vIG1vZHVsZSBzdGFydHMgd2l0aCBpdC5cblxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVEaXJuYW1lID0gZnMucmVhbHBhdGhTeW5jKHBhdGguZGlybmFtZShhbmd1bGFyQ29yZVBhY2thZ2VQYXRoKSk7XG5cbiAgICAgIGNtZi5ob29rcy5hZnRlclJlc29sdmUudGFwUHJvbWlzZSgnYW5ndWxhci1jb21waWxlcicsIGFzeW5jIHJlc3VsdCA9PiB7XG4gICAgICAgIC8vIEFsdGVyIG9ubHkgcmVxdWVzdCBmcm9tIEFuZ3VsYXIuXG4gICAgICAgIGlmICghcmVzdWx0IHx8ICF0aGlzLmRvbmUgfHwgIXJlc3VsdC5yZXNvdXJjZS5zdGFydHNXaXRoKGFuZ3VsYXJDb3JlRGlybmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZG9uZS50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoaXMgZm9sZGVyIGRvZXMgbm90IGV4aXN0LCBidXQgd2UgbmVlZCB0byBnaXZlIHdlYnBhY2sgYSByZXNvdXJjZS5cbiAgICAgICAgICAgIC8vIFRPRE86IGNoZWNrIGlmIHdlIGNhbid0IGp1c3QgbGVhdmUgaXQgYXMgaXMgKGFuZ3VsYXJDb3JlTW9kdWxlRGlyKS5cbiAgICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICAgICAgIHJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZDogYW55KSA9PiBkLmNyaXRpY2FsID0gZmFsc2UpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LnJlc29sdmVEZXBlbmRlbmNpZXMgPSAoX2ZzOiBhbnksIG9wdGlvbnM6IGFueSwgY2FsbGJhY2s6IENhbGxiYWNrKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IE9iamVjdC5rZXlzKHRoaXMuX2xhenlSb3V0ZXMpXG4gICAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVQYXRoID0gdGhpcy5fbGF6eVJvdXRlc1trZXldO1xuICAgICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0UGF0aCA9IGtleS5zcGxpdCgnIycpWzBdO1xuICAgICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGltcG9ydFBhdGgucmVwbGFjZSgvKFxcLm5nZmFjdG9yeSk/XFwuKGpzfHRzKSQvLCAnJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcihtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcih4ID0+ICEheCk7XG5cbiAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubmFtZUxhenlGaWxlcykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuY2h1bmtOYW1lID0gJ1tyZXF1ZXN0XSc7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgICgpID0+IHVuZGVmaW5lZCxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGFuZCBkZXN0cm95IGZvcmtlZCB0eXBlIGNoZWNrZXIgb24gd2F0Y2ggbW9kZS5cbiAgICBjb21waWxlci5ob29rcy53YXRjaFJ1bi50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy53YXRjaENsb3NlLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpKTtcblxuICAgIC8vIFJlbWFrZSB0aGUgcGx1Z2luIG9uIGVhY2ggY29tcGlsYXRpb24uXG4gICAgY29tcGlsZXIuaG9va3MubWFrZS50YXBQcm9taXNlKCdhbmd1bGFyLWNvbXBpbGVyJywgY29tcGlsYXRpb24gPT4gdGhpcy5fbWFrZShjb21waWxhdGlvbikpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmludmFsaWQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4gdGhpcy5fZmlyc3RSdW4gPSBmYWxzZSk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJFbWl0LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGF0aW9uID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gbnVsbDtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGVyID0+IHtcbiAgICAgIGNvbXBpbGVyLmhvb2tzLm5vcm1hbE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgbm1mID0+IHtcbiAgICAgICAgLy8gVmlydHVhbCBmaWxlIHN5c3RlbS5cbiAgICAgICAgLy8gVE9ETzogY29uc2lkZXIgaWYgaXQncyBiZXR0ZXIgdG8gcmVtb3ZlIHRoaXMgcGx1Z2luIGFuZCBpbnN0ZWFkIG1ha2UgaXQgd2FpdCBvbiB0aGVcbiAgICAgICAgLy8gVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IuXG4gICAgICAgIC8vIFdhaXQgZm9yIHRoZSBwbHVnaW4gdG8gYmUgZG9uZSB3aGVuIHJlcXVlc3RpbmcgYC50c2AgZmlsZXMgZGlyZWN0bHkgKGVudHJ5IHBvaW50cyksIG9yXG4gICAgICAgIC8vIHdoZW4gdGhlIGlzc3VlciBpcyBhIGAudHNgIG9yIGAubmdmYWN0b3J5LmpzYCBmaWxlLlxuICAgICAgICBubWYuaG9va3MuYmVmb3JlUmVzb2x2ZS50YXBQcm9taXNlKFxuICAgICAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgICAgICBhc3luYyAocmVxdWVzdD86IE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0KSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5kb25lICYmIHJlcXVlc3QpIHtcbiAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IHJlcXVlc3QucmVxdWVzdDtcbiAgICAgICAgICAgICAgY29uc3QgaXNzdWVyID0gcmVxdWVzdC5jb250ZXh0SW5mby5pc3N1ZXI7XG4gICAgICAgICAgICAgIGlmIChuYW1lLmVuZHNXaXRoKCcudHMnKSB8fCBuYW1lLmVuZHNXaXRoKCcudHN4JylcbiAgICAgICAgICAgICAgICAgIHx8IChpc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChpc3N1ZXIpKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmRvbmU7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7fVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLm5vcm1hbE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgbm1mID0+IHtcbiAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcEFzeW5jKFxuICAgICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAgIChyZXF1ZXN0OiBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCwgY2FsbGJhY2s6IENhbGxiYWNrPE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0PikgPT4ge1xuICAgICAgICAgIHJlc29sdmVXaXRoUGF0aHMoXG4gICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgICAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9tYWtlKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgaWYgKChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbik7XG5cbiAgICByZXR1cm4gdGhpcy5fZG9uZVByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fdXBkYXRlKCkpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMucHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgICB9LCBlcnIgPT4ge1xuICAgICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbjogY29tcGlsYXRpb24uQ29tcGlsYXRpb24pIHtcbiAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaCguLi50aGlzLl9lcnJvcnMpO1xuICAgIGNvbXBpbGF0aW9uLndhcm5pbmdzLnB1c2goLi4udGhpcy5fd2FybmluZ3MpO1xuICAgIHRoaXMuX2Vycm9ycyA9IFtdO1xuICAgIHRoaXMuX3dhcm5pbmdzID0gW107XG4gIH1cblxuICBwcml2YXRlIF9tYWtlVHJhbnNmb3JtZXJzKCkge1xuICAgIGNvbnN0IGlzQXBwUGF0aCA9IChmaWxlTmFtZTogc3RyaW5nKSA9PlxuICAgICAgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdmYWN0b3J5LnRzJykgJiYgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdzdHlsZS50cycpO1xuICAgIGNvbnN0IGlzTWFpblBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT4gZmlsZU5hbWUgPT09IChcbiAgICAgIHRoaXMuX21haW5QYXRoID8gd29ya2Fyb3VuZFJlc29sdmUodGhpcy5fbWFpblBhdGgpIDogdGhpcy5fbWFpblBhdGhcbiAgICApO1xuICAgIGNvbnN0IGdldEVudHJ5TW9kdWxlID0gKCkgPT4gdGhpcy5lbnRyeU1vZHVsZVxuICAgICAgPyB7IHBhdGg6IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuZW50cnlNb2R1bGUucGF0aCksIGNsYXNzTmFtZTogdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWUgfVxuICAgICAgOiB0aGlzLmVudHJ5TW9kdWxlO1xuICAgIGNvbnN0IGdldExhenlSb3V0ZXMgPSAoKSA9PiB0aGlzLl9sYXp5Um91dGVzO1xuICAgIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gdGhpcy5fZ2V0VHNQcm9ncmFtKCkuZ2V0VHlwZUNoZWNrZXIoKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBSZXBsYWNlIHJlc291cmNlcyBpbiBKSVQuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZXBsYWNlUmVzb3VyY2VzKGlzQXBwUGF0aCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdmUgdW5uZWVkZWQgYW5ndWxhciBkZWNvcmF0b3JzLlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVtb3ZlRGVjb3JhdG9ycyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSBudWxsKSB7XG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaCguLi50aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uQnJvd3Nlcikge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgbG9jYWxlLCBhdXRvIGltcG9ydCB0aGUgbG9jYWxlIGRhdGEgZmlsZS5cbiAgICAgICAgLy8gVGhpcyB0cmFuc2Zvcm0gbXVzdCBnbyBiZWZvcmUgcmVwbGFjZUJvb3RzdHJhcCBiZWNhdXNlIGl0IGxvb2tzIGZvciB0aGUgZW50cnkgbW9kdWxlXG4gICAgICAgIC8vIGltcG9ydCwgd2hpY2ggd2lsbCBiZSByZXBsYWNlZC5cbiAgICAgICAgaWYgKHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZWdpc3RlckxvY2FsZURhdGEoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgYm9vdHN0cmFwIGluIGJyb3dzZXIgQU9ULlxuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VCb290c3RyYXAoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uU2VydmVyKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKGV4cG9ydExhenlNb2R1bGVNYXAoaXNNYWluUGF0aCwgZ2V0TGF6eVJvdXRlcykpO1xuICAgICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChcbiAgICAgICAgICAgIGV4cG9ydE5nRmFjdG9yeShpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSksXG4gICAgICAgICAgICByZXBsYWNlU2VydmVyQm9vdHN0cmFwKGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlKCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgLy8gV2Ugb25seSB3YW50IHRvIHVwZGF0ZSBvbiBUUyBhbmQgdGVtcGxhdGUgY2hhbmdlcywgYnV0IGFsbCBraW5kcyBvZiBmaWxlcyBhcmUgb24gdGhpc1xuICAgIC8vIGxpc3QsIGxpa2UgcGFja2FnZS5qc29uIGFuZCAubmdzdW1tYXJ5Lmpzb24gZmlsZXMuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKTtcblxuICAgIC8vIElmIG5vdGhpbmcgd2UgY2FyZSBhYm91dCBjaGFuZ2VkIGFuZCBpdCBpc24ndCB0aGUgZmlyc3QgcnVuLCBkb24ndCBkbyBhbnl0aGluZy5cbiAgICBpZiAoY2hhbmdlZEZpbGVzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgICAvLyBUcnkgdG8gZmluZCBsYXp5IHJvdXRlcyBpZiB3ZSBoYXZlIGFuIGVudHJ5IG1vZHVsZS5cbiAgICAgICAgICAvLyBXZSBuZWVkIHRvIHJ1biB0aGUgYGxpc3RMYXp5Um91dGVzYCB0aGUgZmlyc3QgdGltZSBiZWNhdXNlIGl0IGFsc28gbmF2aWdhdGVzIGxpYnJhcmllc1xuICAgICAgICAgIC8vIGFuZCBvdGhlciB0aGluZ3MgdGhhdCB3ZSBtaWdodCBtaXNzIHVzaW5nIHRoZSAoZmFzdGVyKSBmaW5kTGF6eVJvdXRlc0luQXN0LlxuICAgICAgICAgIC8vIExhenkgcm91dGVzIG1vZHVsZXMgd2lsbCBiZSByZWFkIHdpdGggY29tcGlsZXJIb3N0IGFuZCBhZGRlZCB0byB0aGUgY2hhbmdlZCBmaWxlcy5cbiAgICAgICAgICBjb25zdCBjaGFuZ2VkVHNGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRUc0ZpbGVzKCk7XG4gICAgICAgICAgaWYgKHRoaXMuX25nQ29tcGlsZXJTdXBwb3J0c05ld0FwaSkge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMoKSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChjaGFuZ2VkVHNGaWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRUc0ZpbGVzKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gRW1pdCBhbmQgcmVwb3J0IGVycm9ycy5cblxuICAgICAgICAvLyBXZSBub3cgaGF2ZSB0aGUgZmluYWwgbGlzdCBvZiBjaGFuZ2VkIFRTIGZpbGVzLlxuICAgICAgICAvLyBHbyB0aHJvdWdoIGVhY2ggY2hhbmdlZCBmaWxlIGFuZCBhZGQgdHJhbnNmb3JtcyBhcyBuZWVkZWQuXG4gICAgICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKVxuICAgICAgICAgIC5tYXAoKGZpbGVOYW1lKSA9PiB0aGlzLl9nZXRUc1Byb2dyYW0oKS5nZXRTb3VyY2VGaWxlKGZpbGVOYW1lKSlcbiAgICAgICAgICAvLyBBdCB0aGlzIHBvaW50IHdlIHNob3VsZG4ndCBuZWVkIHRvIGZpbHRlciBvdXQgdW5kZWZpbmVkIGZpbGVzLCBiZWNhdXNlIGFueSB0cyBmaWxlXG4gICAgICAgICAgLy8gdGhhdCBjaGFuZ2VkIHNob3VsZCBiZSBlbWl0dGVkLlxuICAgICAgICAgIC8vIEJ1dCBkdWUgdG8gaG9zdFJlcGxhY2VtZW50UGF0aHMgdGhlcmUgY2FuIGJlIGZpbGVzICh0aGUgZW52aXJvbm1lbnQgZmlsZXMpXG4gICAgICAgICAgLy8gdGhhdCBjaGFuZ2VkIGJ1dCBhcmVuJ3QgcGFydCBvZiB0aGUgY29tcGlsYXRpb24sIHNwZWNpYWxseSBvbiBgbmcgdGVzdGAuXG4gICAgICAgICAgLy8gU28gd2UgaWdub3JlIG1pc3Npbmcgc291cmNlIGZpbGVzIGZpbGVzIGhlcmUuXG4gICAgICAgICAgLy8gaG9zdFJlcGxhY2VtZW50UGF0aHMgbmVlZHMgdG8gYmUgZml4ZWQgYW55d2F5IHRvIHRha2UgY2FyZSBvZiB0aGUgZm9sbG93aW5nIGlzc3VlLlxuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy83MzA1I2lzc3VlY29tbWVudC0zMzIxNTAyMzBcbiAgICAgICAgICAuZmlsdGVyKCh4KSA9PiAhIXgpIGFzIHRzLlNvdXJjZUZpbGVbXTtcblxuICAgICAgICAvLyBFbWl0IGZpbGVzLlxuICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZS5fZW1pdCcpO1xuICAgICAgICBjb25zdCB7IGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzIH0gPSB0aGlzLl9lbWl0KHNvdXJjZUZpbGVzKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcblxuICAgICAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgICAgIGNvbnN0IGVycm9ycyA9IGRpYWdub3N0aWNzXG4gICAgICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yKTtcbiAgICAgICAgY29uc3Qgd2FybmluZ3MgPSBkaWFnbm9zdGljc1xuICAgICAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3MoZXJyb3JzKTtcbiAgICAgICAgICB0aGlzLl9lcnJvcnMucHVzaChuZXcgRXJyb3IobWVzc2FnZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3Mod2FybmluZ3MpO1xuICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobWVzc2FnZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9lbWl0U2tpcHBlZCA9ICFlbWl0UmVzdWx0IHx8IGVtaXRSZXN1bHQuZW1pdFNraXBwZWQ7XG5cbiAgICAgICAgLy8gUmVzZXQgY2hhbmdlZCBmaWxlcyBvbiBzdWNjZXNzZnVsIGNvbXBpbGF0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuX2VtaXRTa2lwcGVkICYmIHRoaXMuX2Vycm9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QucmVzZXRDaGFuZ2VkRmlsZVRyYWNrZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICAgICAgfSk7XG4gIH1cblxuICB3cml0ZUkxOG5PdXRGaWxlKCkge1xuICAgIGZ1bmN0aW9uIF9yZWN1cnNpdmVNa0RpcihwOiBzdHJpbmcpIHtcbiAgICAgIGlmICghZnMuZXhpc3RzU3luYyhwKSkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKHApKTtcbiAgICAgICAgZnMubWtkaXJTeW5jKHApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdyaXRlIHRoZSBleHRyYWN0ZWQgbWVzc2FnZXMgdG8gZGlzay5cbiAgICBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKSB7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSk7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZUNvbnRlbnQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUoaTE4bk91dEZpbGVQYXRoKTtcbiAgICAgIGlmIChpMThuT3V0RmlsZUNvbnRlbnQpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShpMThuT3V0RmlsZVBhdGgpKTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhpMThuT3V0RmlsZVBhdGgsIGkxOG5PdXRGaWxlQ29udGVudCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0Q29tcGlsZWRGaWxlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvdXRwdXRGaWxlID0gZmlsZU5hbWUucmVwbGFjZSgvLnRzeD8kLywgJy5qcycpO1xuICAgIGxldCBvdXRwdXRUZXh0OiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZU1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGxldCBlcnJvckRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmICh0aGlzLl9lbWl0U2tpcHBlZCkge1xuICAgICAgY29uc3QgdGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIC8vIElmIHRoZSBjb21waWxhdGlvbiBkaWRuJ3QgZW1pdCBmaWxlcyB0aGlzIHRpbWUsIHRyeSB0byByZXR1cm4gdGhlIGNhY2hlZCBmaWxlcyBmcm9tIHRoZVxuICAgICAgICAvLyBsYXN0IGNvbXBpbGF0aW9uIGFuZCBsZXQgdGhlIGNvbXBpbGF0aW9uIGVycm9ycyBzaG93IHdoYXQncyB3cm9uZy5cbiAgICAgICAgb3V0cHV0VGV4dCA9IHRleHQ7XG4gICAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm90aGluZyB3ZSBjYW4gc2VydmUuIFJldHVybiBhbiBlbXB0eSBzdHJpbmcgdG8gcHJldmVudCBsZW5naHR5IHdlYnBhY2sgZXJyb3JzLFxuICAgICAgICAvLyBhZGQgdGhlIHJlYnVpbGQgd2FybmluZyBpZiBpdCdzIG5vdCB0aGVyZSB5ZXQuXG4gICAgICAgIC8vIFdlIGFsc28gbmVlZCB0byBhbGwgY2hhbmdlZCBmaWxlcyBhcyBkZXBlbmRlbmNpZXMgb2YgdGhpcyBmaWxlLCBzbyB0aGF0IGFsbCBvZiB0aGVtXG4gICAgICAgIC8vIHdpbGwgYmUgd2F0Y2hlZCBhbmQgdHJpZ2dlciBhIHJlYnVpbGQgbmV4dCB0aW1lLlxuICAgICAgICBvdXRwdXRUZXh0ID0gJyc7XG4gICAgICAgIGVycm9yRGVwZW5kZW5jaWVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKVxuICAgICAgICAgIC8vIFRoZXNlIHBhdGhzIGFyZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgICAgICAgIC5tYXAoKHApID0+IHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDaGVjayBpZiB0aGUgVFMgaW5wdXQgZmlsZSBhbmQgdGhlIEpTIG91dHB1dCBmaWxlIGV4aXN0LlxuICAgICAgaWYgKCgoZmlsZU5hbWUuZW5kc1dpdGgoJy50cycpIHx8IGZpbGVOYW1lLmVuZHNXaXRoKCcudHN4JykpXG4gICAgICAgICYmICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhmaWxlTmFtZSwgZmFsc2UpKVxuICAgICAgICB8fCAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMob3V0cHV0RmlsZSwgZmFsc2UpKSB7XG4gICAgICAgIGxldCBtc2cgPSBgJHtmaWxlTmFtZX0gaXMgbWlzc2luZyBmcm9tIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uLiBgXG4gICAgICAgICAgKyBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcblxuICAgICAgICBpZiAoLyhcXFxcfFxcLylub2RlX21vZHVsZXMoXFxcXHxcXC8pLy50ZXN0KGZpbGVOYW1lKSkge1xuICAgICAgICAgIG1zZyArPSAnXFxuVGhlIG1pc3NpbmcgZmlsZSBzZWVtcyB0byBiZSBwYXJ0IG9mIGEgdGhpcmQgcGFydHkgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnVFMgZmlsZXMgaW4gcHVibGlzaGVkIGxpYnJhcmllcyBhcmUgb2Z0ZW4gYSBzaWduIG9mIGEgYmFkbHkgcGFja2FnZWQgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnUGxlYXNlIG9wZW4gYW4gaXNzdWUgaW4gdGhlIGxpYnJhcnkgcmVwb3NpdG9yeSB0byBhbGVydCBpdHMgYXV0aG9yIGFuZCBhc2sgdGhlbSAnXG4gICAgICAgICAgICArICd0byBwYWNrYWdlIHRoZSBsaWJyYXJ5IHVzaW5nIHRoZSBBbmd1bGFyIFBhY2thZ2UgRm9ybWF0IChodHRwczovL2dvby5nbC9qQjNHVnYpLic7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICAgIH1cblxuICAgICAgb3V0cHV0VGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKSB8fCAnJztcbiAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBvdXRwdXRUZXh0LCBzb3VyY2VNYXAsIGVycm9yRGVwZW5kZW5jaWVzIH07XG4gIH1cblxuICBnZXREZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUoZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLl9jb21waWxlckhvc3QuZ2V0U291cmNlRmlsZShyZXNvbHZlZEZpbGVOYW1lLCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0KTtcbiAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fY29tcGlsZXJPcHRpb25zO1xuICAgIGNvbnN0IGhvc3QgPSB0aGlzLl9jb21waWxlckhvc3Q7XG4gICAgY29uc3QgY2FjaGUgPSB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG5cbiAgICBjb25zdCBlc0ltcG9ydHMgPSBjb2xsZWN0RGVlcE5vZGVzPHRzLkltcG9ydERlY2xhcmF0aW9uPihzb3VyY2VGaWxlLFxuICAgICAgdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgIC5tYXAoZGVjbCA9PiB7XG4gICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSAoZGVjbC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dDtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShtb2R1bGVOYW1lLCByZXNvbHZlZEZpbGVOYW1lLCBvcHRpb25zLCBob3N0LCBjYWNoZSk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkLnJlc29sdmVkTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKHggPT4geCk7XG5cbiAgICBjb25zdCByZXNvdXJjZUltcG9ydHMgPSBmaW5kUmVzb3VyY2VzKHNvdXJjZUZpbGUpXG4gICAgICAubWFwKChyZXNvdXJjZVJlcGxhY2VtZW50KSA9PiByZXNvdXJjZVJlcGxhY2VtZW50LnJlc291cmNlUGF0aHMpXG4gICAgICAucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LmNvbmNhdChjdXJyKSwgW10pXG4gICAgICAubWFwKChyZXNvdXJjZVBhdGgpID0+IHJlc29sdmUoZGlybmFtZShyZXNvbHZlZEZpbGVOYW1lKSwgbm9ybWFsaXplKHJlc291cmNlUGF0aCkpKTtcblxuICAgIC8vIFRoZXNlIHBhdGhzIGFyZSBtZWFudCB0byBiZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgIGNvbnN0IHVuaXF1ZURlcGVuZGVuY2llcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uZXNJbXBvcnRzLFxuICAgICAgLi4ucmVzb3VyY2VJbXBvcnRzLFxuICAgICAgLi4udGhpcy5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyh0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHJlc29sdmVkRmlsZU5hbWUpKSxcbiAgICBdLm1hcCgocCkgPT4gcCAmJiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKSk7XG5cbiAgICByZXR1cm4gWy4uLnVuaXF1ZURlcGVuZGVuY2llc11cbiAgICAgIC5maWx0ZXIoeCA9PiAhIXgpIGFzIHN0cmluZ1tdO1xuICB9XG5cbiAgZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICByZXR1cm4gdGhpcy5fcmVzb3VyY2VMb2FkZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoZmlsZU5hbWUpO1xuICB9XG5cbiAgLy8gVGhpcyBjb2RlIG1vc3RseSBjb21lcyBmcm9tIGBwZXJmb3JtQ29tcGlsYXRpb25gIGluIGBAYW5ndWxhci9jb21waWxlci1jbGlgLlxuICAvLyBJdCBza2lwcyB0aGUgcHJvZ3JhbSBjcmVhdGlvbiBiZWNhdXNlIHdlIG5lZWQgdG8gdXNlIGBsb2FkTmdTdHJ1Y3R1cmVBc3luYygpYCxcbiAgLy8gYW5kIHVzZXMgQ3VzdG9tVHJhbnNmb3JtZXJzLlxuICBwcml2YXRlIF9lbWl0KHNvdXJjZUZpbGVzOiB0cy5Tb3VyY2VGaWxlW10pIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcbiAgICBjb25zdCBwcm9ncmFtID0gdGhpcy5fcHJvZ3JhbTtcbiAgICBjb25zdCBhbGxEaWFnbm9zdGljczogQXJyYXk8dHMuRGlhZ25vc3RpYyB8IERpYWdub3N0aWM+ID0gW107XG5cbiAgICBsZXQgZW1pdFJlc3VsdDogdHMuRW1pdFJlc3VsdCB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgY29uc3QgdHNQcm9ncmFtID0gcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi50c1Byb2dyYW0uZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICgodGhpcy5fZmlyc3RSdW4gfHwgIXRoaXMuX2ZvcmtUeXBlQ2hlY2tlcikgJiYgdGhpcy5fcHJvZ3JhbSkge1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModGhpcy5fcHJvZ3JhbSwgdGhpcy5fSml0TW9kZSxcbiAgICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMnKSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhc0Vycm9ycyhhbGxEaWFnbm9zdGljcykpIHtcbiAgICAgICAgICBzb3VyY2VGaWxlcy5mb3JFYWNoKChzZikgPT4ge1xuICAgICAgICAgICAgY29uc3QgdGltZUxhYmVsID0gYEFuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cyske3NmLmZpbGVOYW1lfSsuZW1pdGA7XG4gICAgICAgICAgICB0aW1lKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICBlbWl0UmVzdWx0ID0gdHNQcm9ncmFtLmVtaXQoc2YsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHsgYmVmb3JlOiB0aGlzLl90cmFuc2Zvcm1lcnMgfSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgdGltZUVuZCh0aW1lTGFiZWwpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IHByb2dyYW0gYXMgUHJvZ3JhbTtcblxuICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHN0cnVjdHVyYWwgZGlhZ25vc3RpY3MuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzKCkpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBUeXBlU2NyaXB0IHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0VHNPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuXG4gICAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICgodGhpcy5fZmlyc3RSdW4gfHwgIXRoaXMuX2ZvcmtUeXBlQ2hlY2tlcikgJiYgdGhpcy5fcHJvZ3JhbSkge1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModGhpcy5fcHJvZ3JhbSwgdGhpcy5fSml0TW9kZSxcbiAgICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcnKSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWhhc0Vycm9ycyhhbGxEaWFnbm9zdGljcykpIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZW1pdCcpO1xuICAgICAgICAgIGNvbnN0IGV4dHJhY3RJMThuID0gISF0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgICAgICAgY29uc3QgZW1pdEZsYWdzID0gZXh0cmFjdEkxOG4gPyBFbWl0RmxhZ3MuSTE4bkJ1bmRsZSA6IEVtaXRGbGFncy5EZWZhdWx0O1xuICAgICAgICAgIGVtaXRSZXN1bHQgPSBhbmd1bGFyUHJvZ3JhbS5lbWl0KHtcbiAgICAgICAgICAgIGVtaXRGbGFncywgY3VzdG9tVHJhbnNmb3JtZXJzOiB7XG4gICAgICAgICAgICAgIGJlZm9yZVRzOiB0aGlzLl90cmFuc2Zvcm1lcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgaWYgKGV4dHJhY3RJMThuKSB7XG4gICAgICAgICAgICB0aGlzLndyaXRlSTE4bk91dEZpbGUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgICAgLy8gVGhpcyBmdW5jdGlvbiBpcyBhdmFpbGFibGUgaW4gdGhlIGltcG9ydCBiZWxvdywgYnV0IHRoaXMgd2F5IHdlIGF2b2lkIHRoZSBkZXBlbmRlbmN5LlxuICAgICAgLy8gaW1wb3J0IHsgaXNTeW50YXhFcnJvciB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyJztcbiAgICAgIGZ1bmN0aW9uIGlzU3ludGF4RXJyb3IoZXJyb3I6IEVycm9yKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiAoZXJyb3IgYXMgYW55KVsnbmdTeW50YXhFcnJvciddOyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICAgIH1cblxuICAgICAgbGV0IGVyck1zZzogc3RyaW5nO1xuICAgICAgbGV0IGNvZGU6IG51bWJlcjtcbiAgICAgIGlmIChpc1N5bnRheEVycm9yKGUpKSB7XG4gICAgICAgIC8vIGRvbid0IHJlcG9ydCB0aGUgc3RhY2sgZm9yIHN5bnRheCBlcnJvcnMgYXMgdGhleSBhcmUgd2VsbCBrbm93biBlcnJvcnMuXG4gICAgICAgIGVyck1zZyA9IGUubWVzc2FnZTtcbiAgICAgICAgY29kZSA9IERFRkFVTFRfRVJST1JfQ09ERTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVyck1zZyA9IGUuc3RhY2s7XG4gICAgICAgIC8vIEl0IGlzIG5vdCBhIHN5bnRheCBlcnJvciB3ZSBtaWdodCBoYXZlIGEgcHJvZ3JhbSB3aXRoIHVua25vd24gc3RhdGUsIGRpc2NhcmQgaXQuXG4gICAgICAgIHRoaXMuX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICBjb2RlID0gVU5LTk9XTl9FUlJPUl9DT0RFO1xuICAgICAgfVxuICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaChcbiAgICAgICAgeyBjYXRlZ29yeTogdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yLCBtZXNzYWdlVGV4dDogZXJyTXNnLCBjb2RlLCBzb3VyY2U6IFNPVVJDRSB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcblxuICAgIHJldHVybiB7IHByb2dyYW0sIGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzOiBhbGxEaWFnbm9zdGljcyB9O1xuICB9XG5cbiAgcHJpdmF0ZSBfdmFsaWRhdGVMb2NhbGUobG9jYWxlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIHBhdGggb2YgdGhlIGNvbW1vbiBtb2R1bGUuXG4gICAgY29uc3QgY29tbW9uUGF0aCA9IHBhdGguZGlybmFtZShyZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvbW1vbi9wYWNrYWdlLmpzb24nKSk7XG4gICAgLy8gQ2hlY2sgaWYgdGhlIGxvY2FsZSBmaWxlIGV4aXN0c1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnLCBgJHtsb2NhbGV9LmpzYCkpKSB7XG4gICAgICAvLyBDaGVjayBmb3IgYW4gYWx0ZXJuYXRpdmUgbG9jYWxlIChpZiB0aGUgbG9jYWxlIGlkIHdhcyBiYWRseSBmb3JtYXR0ZWQpLlxuICAgICAgY29uc3QgbG9jYWxlcyA9IGZzLnJlYWRkaXJTeW5jKHBhdGgucmVzb2x2ZShjb21tb25QYXRoLCAnbG9jYWxlcycpKVxuICAgICAgICAuZmlsdGVyKGZpbGUgPT4gZmlsZS5lbmRzV2l0aCgnLmpzJykpXG4gICAgICAgIC5tYXAoZmlsZSA9PiBmaWxlLnJlcGxhY2UoJy5qcycsICcnKSk7XG5cbiAgICAgIGxldCBuZXdMb2NhbGU7XG4gICAgICBjb25zdCBub3JtYWxpemVkTG9jYWxlID0gbG9jYWxlLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnLScpO1xuICAgICAgZm9yIChjb25zdCBsIG9mIGxvY2FsZXMpIHtcbiAgICAgICAgaWYgKGwudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIG5ld0xvY2FsZSA9IGw7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG5ld0xvY2FsZSkge1xuICAgICAgICBsb2NhbGUgPSBuZXdMb2NhbGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDaGVjayBmb3IgYSBwYXJlbnQgbG9jYWxlXG4gICAgICAgIGNvbnN0IHBhcmVudExvY2FsZSA9IG5vcm1hbGl6ZWRMb2NhbGUuc3BsaXQoJy0nKVswXTtcbiAgICAgICAgaWYgKGxvY2FsZXMuaW5kZXhPZihwYXJlbnRMb2NhbGUpICE9PSAtMSkge1xuICAgICAgICAgIGxvY2FsZSA9IHBhcmVudExvY2FsZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKGBBbmd1bGFyQ29tcGlsZXJQbHVnaW46IFVuYWJsZSB0byBsb2FkIHRoZSBsb2NhbGUgZGF0YSBmaWxlIGAgK1xuICAgICAgICAgICAgYFwiQGFuZ3VsYXIvY29tbW9uL2xvY2FsZXMvJHtsb2NhbGV9XCIsIGAgK1xuICAgICAgICAgICAgYHBsZWFzZSBjaGVjayB0aGF0IFwiJHtsb2NhbGV9XCIgaXMgYSB2YWxpZCBsb2NhbGUgaWQuXG4gICAgICAgICAgICBJZiBuZWVkZWQsIHlvdSBjYW4gdXNlIFwicmVnaXN0ZXJMb2NhbGVEYXRhXCIgbWFudWFsbHkuYCk7XG5cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2NhbGU7XG4gIH1cbn1cbiJdfQ==