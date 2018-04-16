"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
// TODO: fix webpack typings.
// tslint:disable-next-line:no-global-tslint-disable
// tslint:disable:no-any
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
const ContextElementDependency = require('webpack/lib/dependencies/ContextElementDependency');
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
        this._basePath = config.options.basePath || '';
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
        // Create the webpack compiler host.
        const webpackCompilerHost = new compiler_host_1.WebpackCompilerHost(this._compilerOptions, this._basePath, this._options.host);
        webpackCompilerHost.enableCaching();
        // Create and set a new WebpackResourceLoader.
        this._resourceLoader = new resource_loader_1.WebpackResourceLoader();
        webpackCompilerHost.setResourceLoader(this._resourceLoader);
        // Use the WebpackCompilerHost with a resource loader to create an AngularCompilerHost.
        this._compilerHost = ngtools_api_1.createCompilerHost({
            options: this._compilerOptions,
            tsHost: webpackCompilerHost,
        });
        // Override some files in the FileSystem with paths from the actual file system.
        if (this._options.hostReplacementPaths) {
            for (const filePath of Object.keys(this._options.hostReplacementPaths)) {
                const replacementFilePath = this._options.hostReplacementPaths[filePath];
                const content = this._compilerHost.readFile(replacementFilePath);
                if (content) {
                    this._compilerHost.writeFile(filePath, content, false);
                }
            }
        }
        // Resolve mainPath if provided.
        if (options.mainPath) {
            this._mainPath = this._compilerHost.resolve(options.mainPath);
        }
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
            .filter(k => k.endsWith('.ts') && !k.endsWith('.d.ts'))
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
                modulePath = lazyRouteTSFile.replace(/(\.d)?\.ts$/, `.ngfactory.js`);
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
    // tslint:disable-next-line:no-any
    apply(compiler) {
        // Decorate inputFileSystem to serve contents of CompilerHost.
        // Use decorated inputFileSystem in watchFileSystem.
        compiler.hooks.environment.tap('angular-compiler', () => {
            compiler.inputFileSystem = new virtual_file_system_decorator_1.VirtualFileSystemDecorator(compiler.inputFileSystem, this._compilerHost);
            compiler.watchFileSystem = new virtual_file_system_decorator_1.VirtualWatchFileSystemDecorator(compiler.inputFileSystem);
        });
        // Add lazy modules to the context module for @angular/core
        compiler.hooks.contextModuleFactory.tap('angular-compiler', (cmf) => {
            const angularCorePackagePath = require.resolve('@angular/core/package.json');
            // APFv6 does not have single FESM anymore. Instead of verifying if we're pointing to
            // FESMs, we resolve the `@angular/core` path and verify that the path for the
            // module starts with it.
            // This may be slower but it will be compatible with both APF5, 6 and potential future
            // versions (until the dynamic import appears outside of core I suppose).
            // We resolve any symbolic links in order to get the real path that would be used in webpack.
            const angularCoreDirname = fs.realpathSync(path.dirname(angularCorePackagePath));
            cmf.hooks.afterResolve.tapAsync('angular-compiler', 
            // tslint:disable-next-line:no-any
            (result, callback) => {
                if (!result) {
                    return callback();
                }
                // Alter only request from Angular.
                if (!result.resource.startsWith(angularCoreDirname)) {
                    return callback(undefined, result);
                }
                if (!this.done) {
                    return callback(undefined, result);
                }
                this.done.then(() => {
                    // This folder does not exist, but we need to give webpack a resource.
                    // TODO: check if we can't just leave it as is (angularCoreModuleDir).
                    result.resource = path.join(this._basePath, '$$_lazy_route_resource');
                    result.dependencies.forEach((d) => d.critical = false);
                    result.resolveDependencies = (_fs, resourceOrOptions, recursiveOrCallback, _regExp, cb) => {
                        const dependencies = Object.keys(this._lazyRoutes)
                            .map((key) => {
                            const modulePath = this._lazyRoutes[key];
                            const importPath = key.split('#')[0];
                            if (modulePath !== null) {
                                const name = importPath.replace(/(\.ngfactory)?\.(js|ts)$/, '');
                                return new ContextElementDependency(modulePath, name);
                            }
                            else {
                                return null;
                            }
                        })
                            .filter(x => !!x);
                        if (typeof cb !== 'function' && typeof recursiveOrCallback === 'function') {
                            // Webpack 4 only has 3 parameters
                            cb = recursiveOrCallback;
                            if (this._options.nameLazyFiles) {
                                resourceOrOptions.chunkName = '[request]';
                            }
                        }
                        cb(null, dependencies);
                    };
                    return callback(undefined, result);
                }, () => callback())
                    .catch(err => callback(err));
            });
        });
        // Create and destroy forked type checker on watch mode.
        compiler.hooks.watchRun.tapAsync('angular-compiler', (_compiler, callback) => {
            if (this._forkTypeChecker && !this._typeCheckerProcess) {
                this._createForkedTypeChecker();
            }
            callback();
        });
        compiler.hooks.watchClose.tap('angular-compiler', () => this._killForkedTypeChecker());
        // Remake the plugin on each compilation.
        compiler.hooks.make.tapAsync('angular-compiler', (compilation, cb) => this._make(compilation, cb));
        compiler.hooks.invalid.tap('angular-compiler', () => this._firstRun = false);
        compiler.hooks.afterEmit.tapAsync('angular-compiler', (compilation, cb) => {
            compilation._ngToolsWebpackPluginInstance = null;
            cb();
        });
        compiler.hooks.done.tap('angular-compiler', () => {
            this._donePromise = null;
        });
        compiler.hooks.afterResolvers.tap('angular-compiler', (compiler) => {
            compiler.hooks.normalModuleFactory.tap('angular-compiler', (nmf) => {
                // Virtual file system.
                // TODO: consider if it's better to remove this plugin and instead make it wait on the
                // VirtualFileSystemDecorator.
                // Wait for the plugin to be done when requesting `.ts` files directly (entry points), or
                // when the issuer is a `.ts` or `.ngfactory.js` file.
                nmf.hooks.beforeResolve.tapAsync('angular-compiler', (request, callback) => {
                    if (this.done && (request.request.endsWith('.ts')
                        || (request.context.issuer && /\.ts|ngfactory\.js$/.test(request.context.issuer)))) {
                        this.done.then(() => callback(null, request), () => callback(null, request));
                    }
                    else {
                        callback(null, request);
                    }
                });
            });
        });
        compiler.hooks.normalModuleFactory.tap('angular-compiler', (nmf) => {
            nmf.hooks.beforeResolve.tapAsync('angular-compiler', (request, callback) => {
                paths_plugin_1.resolveWithPaths(request, callback, this._compilerOptions, this._compilerHost, this._moduleResolutionCache);
            });
        });
    }
    _make(compilation, cb) {
        benchmark_1.time('AngularCompilerPlugin._make');
        this._emitSkipped = true;
        if (compilation._ngToolsWebpackPluginInstance) {
            return cb(new Error('An @ngtools/webpack plugin already exist for this compilation.'));
        }
        // Set a private variable for this plugin instance.
        compilation._ngToolsWebpackPluginInstance = this;
        // Update the resource loader with the new webpack compilation.
        this._resourceLoader.update(compilation);
        this._donePromise = Promise.resolve()
            .then(() => this._update())
            .then(() => {
            this.pushCompilationErrors(compilation);
            benchmark_1.timeEnd('AngularCompilerPlugin._make');
            cb();
        }, (err) => {
            compilation.errors.push(err);
            this.pushCompilationErrors(compilation);
            benchmark_1.timeEnd('AngularCompilerPlugin._make');
            cb();
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
            if (fs.existsSync(p)) {
                return Promise.resolve();
            }
            else {
                return _recursiveMkDir(path.dirname(p))
                    .then(() => fs.mkdirSync(p));
            }
        }
        // Write the extracted messages to disk.
        if (this._compilerOptions.i18nOutFile) {
            const i18nOutFilePath = path.resolve(this._basePath, this._compilerOptions.i18nOutFile);
            const i18nOutFileContent = this._compilerHost.readFile(i18nOutFilePath);
            if (i18nOutFileContent) {
                _recursiveMkDir(path.dirname(i18nOutFilePath))
                    .then(() => fs.writeFileSync(i18nOutFilePath, i18nOutFileContent));
            }
        }
    }
    getCompiledFile(fileName) {
        const outputFile = fileName.replace(/.ts$/, '.js');
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
                    .map((p) => this._compilerHost.denormalizePath(p));
            }
        }
        else {
            // Check if the TS input file and the JS output file exist.
            if ((fileName.endsWith('.ts') && !this._compilerHost.fileExists(fileName, false))
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCw2QkFBNkI7QUFDN0Isb0RBQW9EO0FBQ3BELHdCQUF3QjtBQUN4QiwrQ0FBOEU7QUFDOUUsaURBQWdFO0FBQ2hFLHlCQUF5QjtBQUN6Qiw2QkFBNkI7QUFDN0IsaUNBQWlDO0FBQ2pDLDJDQUE0QztBQUM1QyxtREFBeUU7QUFDekUscURBQThEO0FBQzlELDZEQUFvRTtBQUNwRSwrQ0FBNkQ7QUFDN0QsK0NBZ0J1QjtBQUN2QixpREFBa0Q7QUFDbEQsdURBQTBEO0FBQzFELGlEQVN3QjtBQUN4Qiw0REFBOEQ7QUFDOUQsaURBQTRFO0FBQzVFLG1GQUd5QztBQUd6QyxNQUFNLHdCQUF3QixHQUFHLE9BQU8sQ0FBQyxtREFBbUQsQ0FBQyxDQUFDO0FBQzlGLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQW9DdEMsSUFBWSxRQUdYO0FBSEQsV0FBWSxRQUFRO0lBQ2xCLDZDQUFPLENBQUE7SUFDUCwyQ0FBTSxDQUFBO0FBQ1IsQ0FBQyxFQUhXLFFBQVEsR0FBUixnQkFBUSxLQUFSLGdCQUFRLFFBR25CO0FBRUQ7SUEyQ0UsWUFBWSxPQUFxQztRQXJDekMsd0JBQW1CLEdBQWEsRUFBRSxDQUFDO1FBSzNDLDhEQUE4RDtRQUN0RCxnQkFBVyxHQUFpQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBS2hELGtCQUFhLEdBQTJDLEVBQUUsQ0FBQztRQUUzRCxhQUFRLEdBQUcsS0FBSyxDQUFDO1FBQ2pCLGlCQUFZLEdBQUcsSUFBSSxDQUFDO1FBQ3BCLDJCQUFzQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFB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QUUsS0FBSyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7b0JBQ3pDLFNBQVMsR0FBRyxDQUFDLENBQUM7b0JBQ2QsS0FBSyxDQUFDO2dCQUNSLENBQUM7WUFDSCxDQUFDO1lBRUQsRUFBRSxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztnQkFDZCxNQUFNLEdBQUcsU0FBUyxDQUFDO1lBQ3JCLENBQUM7WUFBQyxJQUFJLENBQUMsQ0FBQztnQkFDTiw0QkFBNEI7Z0JBQzVCLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEQsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3pDLE1BQU0sR0FBRyxZQUFZLENBQUM7Z0JBQ3hCLENBQUM7Z0JBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ04sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsNkRBQTZEO3dCQUMvRSw0QkFBNEIsTUFBTSxLQUFLO3dCQUN2QyxzQkFBc0IsTUFBTTtrRUFDMEIsQ0FBQyxDQUFDO29CQUUxRCxNQUFNLENBQUMsSUFBSSxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBMy9CRCxzREEyL0JDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuLy8gVE9ETzogZml4IHdlYnBhY2sgdHlwaW5ncy5cbi8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1nbG9iYWwtdHNsaW50LWRpc2FibGVcbi8vIHRzbGludDpkaXNhYmxlOm5vLWFueVxuaW1wb3J0IHsgZGlybmFtZSwgbm9ybWFsaXplLCByZXNvbHZlLCB2aXJ0dWFsRnMgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCwgd29ya2Fyb3VuZFJlc29sdmUgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4gfSBmcm9tICcuL2VudHJ5X3Jlc29sdmVyJztcbmltcG9ydCB7IGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBMYXp5Um91dGVNYXAsIGZpbmRMYXp5Um91dGVzIH0gZnJvbSAnLi9sYXp5X3JvdXRlcyc7XG5pbXBvcnQge1xuICBDb21waWxlckNsaUlzU3VwcG9ydGVkLFxuICBDb21waWxlckhvc3QsXG4gIENvbXBpbGVyT3B0aW9ucyxcbiAgREVGQVVMVF9FUlJPUl9DT0RFLFxuICBEaWFnbm9zdGljLFxuICBFbWl0RmxhZ3MsXG4gIFByb2dyYW0sXG4gIFNPVVJDRSxcbiAgVU5LTk9XTl9FUlJPUl9DT0RFLFxuICBWRVJTSU9OLFxuICBfX05HVE9PTFNfUFJJVkFURV9BUElfMixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJy4vbmd0b29sc19hcGknO1xuaW1wb3J0IHsgcmVzb2x2ZVdpdGhQYXRocyB9IGZyb20gJy4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7XG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHsgQVVUT19TVEFSVF9BUkcsIEluaXRNZXNzYWdlLCBVcGRhdGVNZXNzYWdlIH0gZnJvbSAnLi90eXBlX2NoZWNrZXInO1xuaW1wb3J0IHtcbiAgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG4gIFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG59IGZyb20gJy4vdmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3InO1xuXG5cbmNvbnN0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSA9IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cblxuLyoqXG4gKiBPcHRpb24gQ29uc3RhbnRzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucyB7XG4gIHNvdXJjZU1hcD86IGJvb2xlYW47XG4gIHRzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBiYXNlUGF0aD86IHN0cmluZztcbiAgZW50cnlNb2R1bGU/OiBzdHJpbmc7XG4gIG1haW5QYXRoPzogc3RyaW5nO1xuICBza2lwQ29kZUdlbmVyYXRpb24/OiBib29sZWFuO1xuICBob3N0UmVwbGFjZW1lbnRQYXRocz86IHsgW3BhdGg6IHN0cmluZ106IHN0cmluZyB9O1xuICBmb3JrVHlwZUNoZWNrZXI/OiBib29sZWFuO1xuICAvLyBUT0RPOiByZW1vdmUgc2luZ2xlRmlsZUluY2x1ZGVzIGZvciAyLjAsIHRoaXMgaXMganVzdCB0byBzdXBwb3J0IG9sZCBwcm9qZWN0cyB0aGF0IGRpZCBub3RcbiAgLy8gaW5jbHVkZSAncG9seWZpbGxzLnRzJyBpbiBgdHNjb25maWcuc3BlYy5qc29uJy5cbiAgc2luZ2xlRmlsZUluY2x1ZGVzPzogc3RyaW5nW107XG4gIGkxOG5JbkZpbGU/OiBzdHJpbmc7XG4gIGkxOG5JbkZvcm1hdD86IHN0cmluZztcbiAgaTE4bk91dEZpbGU/OiBzdHJpbmc7XG4gIGkxOG5PdXRGb3JtYXQ/OiBzdHJpbmc7XG4gIGxvY2FsZT86IHN0cmluZztcbiAgbWlzc2luZ1RyYW5zbGF0aW9uPzogc3RyaW5nO1xuICBwbGF0Zm9ybT86IFBMQVRGT1JNO1xuICBuYW1lTGF6eUZpbGVzPzogYm9vbGVhbjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0PzogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+O1xufVxuXG5leHBvcnQgZW51bSBQTEFURk9STSB7XG4gIEJyb3dzZXIsXG4gIFNlcnZlcixcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJDb21waWxlclBsdWdpbiB7XG4gIHByaXZhdGUgX29wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnM7XG5cbiAgLy8gVFMgY29tcGlsYXRpb24uXG4gIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zO1xuICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdO1xuICBwcml2YXRlIF9zaW5nbGVGaWxlSW5jbHVkZXM6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgX3Byb2dyYW06ICh0cy5Qcm9ncmFtIHwgUHJvZ3JhbSkgfCBudWxsO1xuICBwcml2YXRlIF9jb21waWxlckhvc3Q6IFdlYnBhY2tDb21waWxlckhvc3QgJiBDb21waWxlckhvc3Q7XG4gIHByaXZhdGUgX21vZHVsZVJlc29sdXRpb25DYWNoZTogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuICBwcml2YXRlIF9yZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyO1xuICAvLyBDb250YWlucyBgbW9kdWxlSW1wb3J0UGF0aCNleHBvcnROYW1lYCA9PiBgZnVsbE1vZHVsZVBhdGhgLlxuICBwcml2YXRlIF9sYXp5Um91dGVzOiBMYXp5Um91dGVNYXAgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICBwcml2YXRlIF90c0NvbmZpZ1BhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfZW50cnlNb2R1bGU6IHN0cmluZyB8IG51bGw7XG4gIHByaXZhdGUgX21haW5QYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgX2Jhc2VQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX3RyYW5zZm9ybWVyczogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W10gPSBbXTtcbiAgcHJpdmF0ZSBfcGxhdGZvcm06IFBMQVRGT1JNO1xuICBwcml2YXRlIF9KaXRNb2RlID0gZmFsc2U7XG4gIHByaXZhdGUgX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfY2hhbmdlZEZpbGVFeHRlbnNpb25zID0gbmV3IFNldChbJ3RzJywgJ2h0bWwnLCAnY3NzJ10pO1xuXG4gIC8vIFdlYnBhY2sgcGx1Z2luLlxuICBwcml2YXRlIF9maXJzdFJ1biA9IHRydWU7XG4gIHByaXZhdGUgX2RvbmVQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgcHJpdmF0ZSBfbm9ybWFsaXplZExvY2FsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfd2FybmluZ3M6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9lcnJvcnM6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuXG4gIC8vIFR5cGVDaGVja2VyIHByb2Nlc3MuXG4gIHByaXZhdGUgX2ZvcmtUeXBlQ2hlY2tlciA9IHRydWU7XG4gIHByaXZhdGUgX3R5cGVDaGVja2VyUHJvY2VzczogQ2hpbGRQcm9jZXNzIHwgbnVsbDtcbiAgcHJpdmF0ZSBfZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IGZhbHNlO1xuXG4gIHByaXZhdGUgZ2V0IF9uZ0NvbXBpbGVyU3VwcG9ydHNOZXdBcGkoKSB7XG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuICEhKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkubGlzdExhenlSb3V0ZXM7XG4gICAgfVxuICB9XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIENvbXBpbGVyQ2xpSXNTdXBwb3J0ZWQoKTtcbiAgICB0aGlzLl9vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgb3B0aW9ucyk7XG4gICAgdGhpcy5fc2V0dXBPcHRpb25zKHRoaXMuX29wdGlvbnMpO1xuICB9XG5cbiAgZ2V0IG9wdGlvbnMoKSB7IHJldHVybiB0aGlzLl9vcHRpb25zOyB9XG4gIGdldCBkb25lKCkgeyByZXR1cm4gdGhpcy5fZG9uZVByb21pc2U7IH1cbiAgZ2V0IGVudHJ5TW9kdWxlKCkge1xuICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBzcGxpdHRlZCA9IHRoaXMuX2VudHJ5TW9kdWxlLnNwbGl0KC8oI1thLXpBLVpfXShbXFx3XSspKSQvKTtcbiAgICBjb25zdCBwYXRoID0gc3BsaXR0ZWRbMF07XG4gICAgY29uc3QgY2xhc3NOYW1lID0gISFzcGxpdHRlZFsxXSA/IHNwbGl0dGVkWzFdLnN1YnN0cmluZygxKSA6ICdkZWZhdWx0JztcblxuICAgIHJldHVybiB7IHBhdGgsIGNsYXNzTmFtZSB9O1xuICB9XG5cbiAgc3RhdGljIGlzU3VwcG9ydGVkKCkge1xuICAgIHJldHVybiBWRVJTSU9OICYmIHBhcnNlSW50KFZFUlNJT04ubWFqb3IpID49IDU7XG4gIH1cblxuICBwcml2YXRlIF9zZXR1cE9wdGlvbnMob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gICAgLy8gRmlsbCBpbiB0aGUgbWlzc2luZyBvcHRpb25zLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgndHNDb25maWdQYXRoJykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTXVzdCBzcGVjaWZ5IFwidHNDb25maWdQYXRoXCIgaW4gdGhlIGNvbmZpZ3VyYXRpb24gb2YgQG5ndG9vbHMvd2VicGFjay4nKTtcbiAgICB9XG4gICAgLy8gVFMgcmVwcmVzZW50cyBwYXRocyBpbnRlcm5hbGx5IHdpdGggJy8nIGFuZCBleHBlY3RzIHRoZSB0c2NvbmZpZyBwYXRoIHRvIGJlIGluIHRoaXMgZm9ybWF0XG4gICAgdGhpcy5fdHNDb25maWdQYXRoID0gb3B0aW9ucy50c0NvbmZpZ1BhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgLy8gQ2hlY2sgdGhlIGJhc2UgcGF0aC5cbiAgICBjb25zdCBtYXliZUJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgbGV0IGJhc2VQYXRoID0gbWF5YmVCYXNlUGF0aDtcbiAgICBpZiAoZnMuc3RhdFN5bmMobWF5YmVCYXNlUGF0aCkuaXNGaWxlKCkpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKGJhc2VQYXRoKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuYmFzZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgYmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgb3B0aW9ucy5iYXNlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuc2luZ2xlRmlsZUluY2x1ZGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3NpbmdsZUZpbGVJbmNsdWRlcy5wdXNoKC4uLm9wdGlvbnMuc2luZ2xlRmlsZUluY2x1ZGVzKTtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSB0aGUgdHNjb25maWcgY29udGVudHMuXG4gICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICBpZiAoY29uZmlnLmVycm9ycyAmJiBjb25maWcuZXJyb3JzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGZvcm1hdERpYWdub3N0aWNzKGNvbmZpZy5lcnJvcnMpKTtcbiAgICB9XG5cbiAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzLmNvbmNhdCguLi50aGlzLl9zaW5nbGVGaWxlSW5jbHVkZXMpO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyA9IHsgLi4uY29uZmlnLm9wdGlvbnMsIC4uLm9wdGlvbnMuY29tcGlsZXJPcHRpb25zIH07XG4gICAgdGhpcy5fYmFzZVBhdGggPSBjb25maWcub3B0aW9ucy5iYXNlUGF0aCB8fCAnJztcblxuICAgIC8vIE92ZXJ3cml0ZSBvdXREaXIgc28gd2UgY2FuIGZpbmQgZ2VuZXJhdGVkIGZpbGVzIG5leHQgdG8gdGhlaXIgLnRzIG9yaWdpbiBpbiBjb21waWxlckhvc3QuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm91dERpciA9ICcnO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zdXBwcmVzc091dHB1dFBhdGhDaGVjayA9IHRydWU7XG5cbiAgICAvLyBEZWZhdWx0IHBsdWdpbiBzb3VyY2VNYXAgdG8gY29tcGlsZXIgb3B0aW9ucyBzZXR0aW5nLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc291cmNlTWFwJykpIHtcbiAgICAgIG9wdGlvbnMuc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCB8fCBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBGb3JjZSB0aGUgcmlnaHQgc291cmNlbWFwIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuc291cmNlTWFwKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgLy8gV2Ugd2lsbCBzZXQgdGhlIHNvdXJjZSB0byB0aGUgZnVsbCBwYXRoIG9mIHRoZSBmaWxlIGluIHRoZSBsb2FkZXIsIHNvIHdlIGRvbid0XG4gICAgICAvLyBuZWVkIHNvdXJjZVJvb3QgaGVyZS5cbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gV2Ugd2FudCB0byBhbGxvdyBlbWl0dGluZyB3aXRoIGVycm9ycyBzbyB0aGF0IGltcG9ydHMgY2FuIGJlIGFkZGVkXG4gICAgLy8gdG8gdGhlIHdlYnBhY2sgZGVwZW5kZW5jeSB0cmVlIGFuZCByZWJ1aWxkcyB0cmlnZ2VyZWQgYnkgZmlsZSBlZGl0cy5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubm9FbWl0T25FcnJvciA9IGZhbHNlO1xuXG4gICAgLy8gU2V0IEpJVCAobm8gY29kZSBnZW5lcmF0aW9uKSBvciBBT1QgbW9kZS5cbiAgICBpZiAob3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fSml0TW9kZSA9IG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgaTE4biBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZpbGUgPSBvcHRpb25zLmkxOG5JbkZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRm9ybWF0ID0gb3B0aW9ucy5pMThuSW5Gb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSA9IG9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGb3JtYXQgPSBvcHRpb25zLmkxOG5PdXRGb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmxvY2FsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dExvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSA9IHRoaXMuX3ZhbGlkYXRlTG9jYWxlKG9wdGlvbnMubG9jYWxlKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5NaXNzaW5nVHJhbnNsYXRpb25zID1cbiAgICAgICAgb3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gYXMgJ2Vycm9yJyB8ICd3YXJuaW5nJyB8ICdpZ25vcmUnO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgZm9ya2VkIHR5cGUgY2hlY2tlciBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmZvcmtUeXBlQ2hlY2tlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBvcHRpb25zLmZvcmtUeXBlQ2hlY2tlcjtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgdGhlIHdlYnBhY2sgY29tcGlsZXIgaG9zdC5cbiAgICBjb25zdCB3ZWJwYWNrQ29tcGlsZXJIb3N0ID0gbmV3IFdlYnBhY2tDb21waWxlckhvc3QoXG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICB0aGlzLl9iYXNlUGF0aCxcbiAgICAgIHRoaXMuX29wdGlvbnMuaG9zdCxcbiAgICApO1xuICAgIHdlYnBhY2tDb21waWxlckhvc3QuZW5hYmxlQ2FjaGluZygpO1xuXG4gICAgLy8gQ3JlYXRlIGFuZCBzZXQgYSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyID0gbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlcigpO1xuICAgIHdlYnBhY2tDb21waWxlckhvc3Quc2V0UmVzb3VyY2VMb2FkZXIodGhpcy5fcmVzb3VyY2VMb2FkZXIpO1xuXG4gICAgLy8gVXNlIHRoZSBXZWJwYWNrQ29tcGlsZXJIb3N0IHdpdGggYSByZXNvdXJjZSBsb2FkZXIgdG8gY3JlYXRlIGFuIEFuZ3VsYXJDb21waWxlckhvc3QuXG4gICAgdGhpcy5fY29tcGlsZXJIb3N0ID0gY3JlYXRlQ29tcGlsZXJIb3N0KHtcbiAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHRzSG9zdDogd2VicGFja0NvbXBpbGVySG9zdCxcbiAgICB9KSBhcyBDb21waWxlckhvc3QgJiBXZWJwYWNrQ29tcGlsZXJIb3N0O1xuXG4gICAgLy8gT3ZlcnJpZGUgc29tZSBmaWxlcyBpbiB0aGUgRmlsZVN5c3RlbSB3aXRoIHBhdGhzIGZyb20gdGhlIGFjdHVhbCBmaWxlIHN5c3RlbS5cbiAgICBpZiAodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBPYmplY3Qua2V5cyh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSkge1xuICAgICAgICBjb25zdCByZXBsYWNlbWVudEZpbGVQYXRoID0gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRoc1tmaWxlUGF0aF07XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUocmVwbGFjZW1lbnRGaWxlUGF0aCk7XG4gICAgICAgIGlmIChjb250ZW50KSB7XG4gICAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LndyaXRlRmlsZShmaWxlUGF0aCwgY29udGVudCwgZmFsc2UpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVzb2x2ZSBtYWluUGF0aCBpZiBwcm92aWRlZC5cbiAgICBpZiAob3B0aW9ucy5tYWluUGF0aCkge1xuICAgICAgdGhpcy5fbWFpblBhdGggPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZShvcHRpb25zLm1haW5QYXRoKTtcbiAgICB9XG5cbiAgICAvLyBVc2UgZW50cnlNb2R1bGUgaWYgYXZhaWxhYmxlIGluIG9wdGlvbnMsIG90aGVyd2lzZSByZXNvbHZlIGl0IGZyb20gbWFpblBhdGggYWZ0ZXIgcHJvZ3JhbVxuICAgIC8vIGNyZWF0aW9uLlxuICAgIGlmICh0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGU7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUgYXMgc3RyaW5nKTsgLy8gdGVtcG9yYXJ5IGNhc3QgZm9yIHR5cGUgaXNzdWVcbiAgICB9XG5cbiAgICAvLyBTZXQgcGxhdGZvcm0uXG4gICAgdGhpcy5fcGxhdGZvcm0gPSBvcHRpb25zLnBsYXRmb3JtIHx8IFBMQVRGT1JNLkJyb3dzZXI7XG5cbiAgICAvLyBNYWtlIHRyYW5zZm9ybWVycy5cbiAgICB0aGlzLl9tYWtlVHJhbnNmb3JtZXJzKCk7XG5cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0VHNQcm9ncmFtKCkge1xuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkVHNGaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IGsuZW5kc1dpdGgoJy50cycpICYmICFrLmVuZHNXaXRoKCcuZC50cycpKVxuICAgICAgLmZpbHRlcihrID0+IHRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGspKTtcbiAgfVxuXG4gIHVwZGF0ZUNoYW5nZWRGaWxlRXh0ZW5zaW9ucyhleHRlbnNpb246IHN0cmluZykge1xuICAgIGlmIChleHRlbnNpb24pIHtcbiAgICAgIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucy5hZGQoZXh0ZW5zaW9uKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBleHQgb2YgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zKSB7XG4gICAgICAgICAgaWYgKGsuZW5kc1dpdGgoZXh0KSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgICAgIC8vIFdoZW4gYSBuZXcgcm9vdCBuYW1lIChsaWtlIGEgbGF6eSByb3V0ZSkgaXMgYWRkZWQsIGl0IHdvbid0IGJlIGF2YWlsYWJsZSBmcm9tXG4gICAgICAgIC8vIGZvbGxvd2luZyBpbXBvcnRzIG9uIHRoZSBleGlzdGluZyBmaWxlcywgc28gd2UgbmVlZCB0byBnZXQgdGhlIG5ldyBsaXN0IG9mIHJvb3QgZmlsZXMuXG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXMuY29uY2F0KC4uLnRoaXMuX3NpbmdsZUZpbGVJbmNsdWRlcyk7XG5cbiAgICAgICAgLy8gVXBkYXRlIHRoZSBmb3JrZWQgdHlwZSBjaGVja2VyIHdpdGggYWxsIGNoYW5nZWQgY29tcGlsYXRpb24gZmlsZXMuXG4gICAgICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICB0aGlzLl91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcih0aGlzLl9yb290TmFtZXMsIHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkpO1xuICAgICAgICB9XG5cbiAgICAgICAgIC8vIFVzZSBhbiBpZGVudGl0eSBmdW5jdGlvbiBhcyBhbGwgb3VyIHBhdGhzIGFyZSBhYnNvbHV0ZSBhbHJlYWR5LlxuICAgICAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUodGhpcy5fYmFzZVBhdGgsIHggPT4geCk7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IHRzLmNyZWF0ZVByb2dyYW0oXG4gICAgICAgICAgICB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgICAgICB0aGlzLl9wcm9ncmFtIGFzIHRzLlByb2dyYW0sXG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgb2xkUHJvZ3JhbTogdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5fcHJvZ3JhbS5sb2FkTmdTdHJ1Y3R1cmVBc3luYygpXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gSWYgdGhlcmUncyBzdGlsbCBubyBlbnRyeU1vZHVsZSB0cnkgdG8gcmVzb2x2ZSBmcm9tIG1haW5QYXRoLlxuICAgICAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbihcbiAgICAgICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZ2V0TGF6eVJvdXRlc0Zyb21OZ3Rvb2xzJyk7XG4gICAgICBjb25zdCByZXN1bHQgPSBfX05HVE9PTFNfUFJJVkFURV9BUElfMi5saXN0TGF6eVJvdXRlcyh7XG4gICAgICAgIHByb2dyYW06IHRoaXMuX2dldFRzUHJvZ3JhbSgpLFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIGFuZ3VsYXJDb21waWxlck9wdGlvbnM6IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2NvbXBpbGVyT3B0aW9ucywge1xuICAgICAgICAgIC8vIGdlbkRpciBzZWVtcyB0byBzdGlsbCBiZSBuZWVkZWQgaW4gQGFuZ3VsYXJcXGNvbXBpbGVyLWNsaVxcc3JjXFxjb21waWxlcl9ob3N0LmpzOjIyNi5cbiAgICAgICAgICBnZW5EaXI6ICcnLFxuICAgICAgICB9KSxcbiAgICAgICAgLy8gVE9ETzogZml4IGNvbXBpbGVyLWNsaSB0eXBpbmdzOyBlbnRyeU1vZHVsZSBzaG91bGQgbm90IGJlIHN0cmluZywgYnV0IGFsc28gb3B0aW9uYWwuXG4gICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpub24tbnVsbC1vcGVyYXRvclxuICAgICAgICBlbnRyeU1vZHVsZTogdGhpcy5fZW50cnlNb2R1bGUgISxcbiAgICAgIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMnKTtcblxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIFdlIHNpbGVuY2UgdGhlIGVycm9yIHRoYXQgdGhlIEBhbmd1bGFyL3JvdXRlciBjb3VsZCBub3QgYmUgZm91bmQuIEluIHRoYXQgY2FzZSwgdGhlcmUgaXNcbiAgICAgIC8vIGJhc2ljYWxseSBubyByb3V0ZSBzdXBwb3J0ZWQgYnkgdGhlIGFwcCBpdHNlbGYuXG4gICAgICBpZiAoZXJyLm1lc3NhZ2Uuc3RhcnRzV2l0aCgnQ291bGQgbm90IHJlc29sdmUgbW9kdWxlIEBhbmd1bGFyL3JvdXRlcicpKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRGaWxlUGF0aHM6IHN0cmluZ1tdKTogTGF6eVJvdXRlTWFwIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2ZpbmRMYXp5Um91dGVzSW5Bc3QnKTtcbiAgICBjb25zdCByZXN1bHQ6IExhenlSb3V0ZU1hcCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gICAgZm9yIChjb25zdCBmaWxlUGF0aCBvZiBjaGFuZ2VkRmlsZVBhdGhzKSB7XG4gICAgICBjb25zdCBmaWxlTGF6eVJvdXRlcyA9IGZpbmRMYXp5Um91dGVzKGZpbGVQYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHVuZGVmaW5lZCxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zKTtcbiAgICAgIGZvciAoY29uc3Qgcm91dGVLZXkgb2YgT2JqZWN0LmtleXMoZmlsZUxhenlSb3V0ZXMpKSB7XG4gICAgICAgIGNvbnN0IHJvdXRlID0gZmlsZUxhenlSb3V0ZXNbcm91dGVLZXldO1xuICAgICAgICByZXN1bHRbcm91dGVLZXldID0gcm91dGU7XG4gICAgICB9XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZmluZExhenlSb3V0ZXNJbkFzdCcpO1xuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHByaXZhdGUgX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0oKTogTGF6eVJvdXRlTWFwIHtcbiAgICBjb25zdCBuZ1Byb2dyYW0gPSB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW07XG4gICAgaWYgKCFuZ1Byb2dyYW0ubGlzdExhenlSb3V0ZXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0gd2FzIGNhbGxlZCB3aXRoIGFuIG9sZCBwcm9ncmFtLicpO1xuICAgIH1cblxuICAgIGNvbnN0IGxhenlSb3V0ZXMgPSBuZ1Byb2dyYW0ubGlzdExhenlSb3V0ZXMoKTtcblxuICAgIHJldHVybiBsYXp5Um91dGVzLnJlZHVjZShcbiAgICAgIChhY2MsIGN1cnIpID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gY3Vyci5yb3V0ZTtcbiAgICAgICAgaWYgKHJlZiBpbiBhY2MgJiYgYWNjW3JlZl0gIT09IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICsgYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQ6IFwiJHtyZWZ9XCIgaXMgdXNlZCBpbiAyIGxvYWRDaGlsZHJlbiwgYFxuICAgICAgICAgICAgKyBgYnV0IHRoZXkgcG9pbnQgdG8gZGlmZmVyZW50IG1vZHVsZXMgXCIoJHthY2NbcmVmXX0gYW5kIGBcbiAgICAgICAgICAgICsgYFwiJHtjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGh9XCIpLiBXZWJwYWNrIGNhbm5vdCBkaXN0aW5ndWlzaCBvbiBjb250ZXh0IGFuZCBgXG4gICAgICAgICAgICArICd3b3VsZCBmYWlsIHRvIGxvYWQgdGhlIHByb3BlciBvbmUuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFjY1tyZWZdID0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAge30gYXMgTGF6eVJvdXRlTWFwLFxuICAgICk7XG4gIH1cblxuICAvLyBQcm9jZXNzIHRoZSBsYXp5IHJvdXRlcyBkaXNjb3ZlcmVkLCBhZGRpbmcgdGhlbiB0byBfbGF6eVJvdXRlcy5cbiAgLy8gVE9ETzogZmluZCBhIHdheSB0byByZW1vdmUgbGF6eSByb3V0ZXMgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuICAvLyBUaGlzIHdpbGwgcmVxdWlyZSBhIHJlZ2lzdHJ5IG9mIGtub3duIHJlZmVyZW5jZXMgdG8gYSBsYXp5IHJvdXRlLCByZW1vdmluZyBpdCB3aGVuIG5vXG4gIC8vIG1vZHVsZSByZWZlcmVuY2VzIGl0IGFueW1vcmUuXG4gIHByaXZhdGUgX3Byb2Nlc3NMYXp5Um91dGVzKGRpc2NvdmVyZWRMYXp5Um91dGVzOiBMYXp5Um91dGVNYXApIHtcbiAgICBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkTGF6eVJvdXRlcylcbiAgICAgIC5mb3JFYWNoKGxhenlSb3V0ZUtleSA9PiB7XG4gICAgICAgIGNvbnN0IFtsYXp5Um91dGVNb2R1bGUsIG1vZHVsZU5hbWVdID0gbGF6eVJvdXRlS2V5LnNwbGl0KCcjJyk7XG5cbiAgICAgICAgaWYgKCFsYXp5Um91dGVNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXp5Um91dGVUU0ZpbGUgPSBkaXNjb3ZlcmVkTGF6eVJvdXRlc1tsYXp5Um91dGVLZXldLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgbGV0IG1vZHVsZVBhdGg6IHN0cmluZywgbW9kdWxlS2V5OiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ke21vZHVsZU5hbWUgPyAnIycgKyBtb2R1bGVOYW1lIDogJyd9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlLnJlcGxhY2UoLyhcXC5kKT9cXC50cyQvLCBgLm5nZmFjdG9yeS5qc2ApO1xuICAgICAgICAgIGNvbnN0IGZhY3RvcnlNb2R1bGVOYW1lID0gbW9kdWxlTmFtZSA/IGAjJHttb2R1bGVOYW1lfU5nRmFjdG9yeWAgOiAnJztcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9Lm5nZmFjdG9yeSR7ZmFjdG9yeU1vZHVsZU5hbWV9YDtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZHVsZVBhdGggPSB3b3JrYXJvdW5kUmVzb2x2ZShtb2R1bGVQYXRoKTtcblxuICAgICAgICBpZiAobW9kdWxlS2V5IGluIHRoaXMuX2xhenlSb3V0ZXMpIHtcbiAgICAgICAgICBpZiAodGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldICE9PSBtb2R1bGVQYXRoKSB7XG4gICAgICAgICAgICAvLyBGb3VuZCBhIGR1cGxpY2F0ZSwgdGhpcyBpcyBhbiBlcnJvci5cbiAgICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2goXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZCBkdXJpbmcgYSByZWJ1aWxkLiBgXG4gICAgICAgICAgICAgICAgKyBgV2Ugd2lsbCB0YWtlIHRoZSBsYXRlc3QgdmVyc2lvbiBkZXRlY3RlZCBhbmQgb3ZlcnJpZGUgaXQgdG8gc2F2ZSByZWJ1aWxkIHRpbWUuIGBcbiAgICAgICAgICAgICAgICArIGBZb3Ugc2hvdWxkIHBlcmZvcm0gYSBmdWxsIGJ1aWxkIHRvIHZhbGlkYXRlIHRoYXQgeW91ciByb3V0ZXMgZG9uJ3Qgb3ZlcmxhcC5gKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEZvdW5kIGEgbmV3IHJvdXRlLCBhZGQgaXQgdG8gdGhlIG1hcC5cbiAgICAgICAgICB0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gPSBtb2R1bGVQYXRoO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIC8vIEJvb3RzdHJhcCB0eXBlIGNoZWNrZXIgaXMgdXNpbmcgbG9jYWwgQ0xJLlxuICAgIGNvbnN0IGc6IGFueSA9IHR5cGVvZiBnbG9iYWwgIT09ICd1bmRlZmluZWQnID8gZ2xvYmFsIDoge307ICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgIGNvbnN0IHR5cGVDaGVja2VyRmlsZTogc3RyaW5nID0gZ1snX0RldktpdElzTG9jYWwnXVxuICAgICAgPyAnLi90eXBlX2NoZWNrZXJfYm9vdHN0cmFwLmpzJ1xuICAgICAgOiAnLi90eXBlX2NoZWNrZXJfd29ya2VyLmpzJztcblxuICAgIGNvbnN0IGRlYnVnQXJnUmVnZXggPSAvLS1pbnNwZWN0KD86LWJya3wtcG9ydCk/fC0tZGVidWcoPzotYnJrfC1wb3J0KS87XG5cbiAgICBjb25zdCBleGVjQXJndiA9IHByb2Nlc3MuZXhlY0FyZ3YuZmlsdGVyKChhcmcpID0+IHtcbiAgICAgIC8vIFJlbW92ZSBkZWJ1ZyBhcmdzLlxuICAgICAgLy8gV29ya2Fyb3VuZCBmb3IgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy85NDM1XG4gICAgICByZXR1cm4gIWRlYnVnQXJnUmVnZXgudGVzdChhcmcpO1xuICAgIH0pO1xuICAgIC8vIFNpZ25hbCB0aGUgcHJvY2VzcyB0byBzdGFydCBsaXN0ZW5pbmcgZm9yIG1lc3NhZ2VzXG4gICAgLy8gU29sdmVzIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy85MDcxXG4gICAgY29uc3QgZm9ya0FyZ3MgPSBbQVVUT19TVEFSVF9BUkddO1xuICAgIGNvbnN0IGZvcmtPcHRpb25zOiBGb3JrT3B0aW9ucyA9IHsgZXhlY0FyZ3YgfTtcblxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IGZvcmsoXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCB0eXBlQ2hlY2tlckZpbGUpLFxuICAgICAgZm9ya0FyZ3MsXG4gICAgICBmb3JrT3B0aW9ucyk7XG5cbiAgICAvLyBIYW5kbGUgY2hpbGQgcHJvY2VzcyBleGl0LlxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5vbmNlKCdleGl0JywgKF8sIHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcblxuICAgICAgLy8gSWYgcHJvY2VzcyBleGl0ZWQgbm90IGJlY2F1c2Ugb2YgU0lHVEVSTSAoc2VlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIpLCB0aGFuIHNvbWV0aGluZ1xuICAgICAgLy8gd2VudCB3cm9uZyBhbmQgaXQgc2hvdWxkIGZhbGxiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gdGhlIG1haW4gdGhyZWFkLlxuICAgICAgaWYgKHNpZ25hbCAhPT0gJ1NJR1RFUk0nKSB7XG4gICAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtc2cgPSAnQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBGb3JrZWQgVHlwZSBDaGVja2VyIGV4aXRlZCB1bmV4cGVjdGVkbHkuICcgK1xuICAgICAgICAgICdGYWxsaW5nIGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiBtYWluIHRocmVhZC4nO1xuICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1zZyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkKSB7XG4gICAgICB0cmVlS2lsbCh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkLCAnU0lHVEVSTScpO1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcihyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICBpZiAoIXRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IEluaXRNZXNzYWdlKHRoaXMuX2NvbXBpbGVyT3B0aW9ucywgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgICAgdGhpcy5fSml0TW9kZSwgdGhpcy5fcm9vdE5hbWVzKSk7XG4gICAgICAgIHRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IFVwZGF0ZU1lc3NhZ2Uocm9vdE5hbWVzLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlcykpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlZ2lzdHJhdGlvbiBob29rIGZvciB3ZWJwYWNrIHBsdWdpbi5cbiAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICBhcHBseShjb21waWxlcjogYW55KSB7XG4gICAgLy8gRGVjb3JhdGUgaW5wdXRGaWxlU3lzdGVtIHRvIHNlcnZlIGNvbnRlbnRzIG9mIENvbXBpbGVySG9zdC5cbiAgICAvLyBVc2UgZGVjb3JhdGVkIGlucHV0RmlsZVN5c3RlbSBpbiB3YXRjaEZpbGVTeXN0ZW0uXG4gICAgY29tcGlsZXIuaG9va3MuZW52aXJvbm1lbnQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtID0gbmV3IFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBjb21waWxlci5pbnB1dEZpbGVTeXN0ZW0sIHRoaXMuX2NvbXBpbGVySG9zdCk7XG4gICAgICBjb21waWxlci53YXRjaEZpbGVTeXN0ZW0gPSBuZXcgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcihjb21waWxlci5pbnB1dEZpbGVTeXN0ZW0pO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIGxhenkgbW9kdWxlcyB0byB0aGUgY29udGV4dCBtb2R1bGUgZm9yIEBhbmd1bGFyL2NvcmVcbiAgICBjb21waWxlci5ob29rcy5jb250ZXh0TW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoY21mOiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IGFuZ3VsYXJDb3JlUGFja2FnZVBhdGggPSByZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvcmUvcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIC8vIEFQRnY2IGRvZXMgbm90IGhhdmUgc2luZ2xlIEZFU00gYW55bW9yZS4gSW5zdGVhZCBvZiB2ZXJpZnlpbmcgaWYgd2UncmUgcG9pbnRpbmcgdG9cbiAgICAgIC8vIEZFU01zLCB3ZSByZXNvbHZlIHRoZSBgQGFuZ3VsYXIvY29yZWAgcGF0aCBhbmQgdmVyaWZ5IHRoYXQgdGhlIHBhdGggZm9yIHRoZVxuICAgICAgLy8gbW9kdWxlIHN0YXJ0cyB3aXRoIGl0LlxuXG4gICAgICAvLyBUaGlzIG1heSBiZSBzbG93ZXIgYnV0IGl0IHdpbGwgYmUgY29tcGF0aWJsZSB3aXRoIGJvdGggQVBGNSwgNiBhbmQgcG90ZW50aWFsIGZ1dHVyZVxuICAgICAgLy8gdmVyc2lvbnMgKHVudGlsIHRoZSBkeW5hbWljIGltcG9ydCBhcHBlYXJzIG91dHNpZGUgb2YgY29yZSBJIHN1cHBvc2UpLlxuICAgICAgLy8gV2UgcmVzb2x2ZSBhbnkgc3ltYm9saWMgbGlua3MgaW4gb3JkZXIgdG8gZ2V0IHRoZSByZWFsIHBhdGggdGhhdCB3b3VsZCBiZSB1c2VkIGluIHdlYnBhY2suXG4gICAgICBjb25zdCBhbmd1bGFyQ29yZURpcm5hbWUgPSBmcy5yZWFscGF0aFN5bmMocGF0aC5kaXJuYW1lKGFuZ3VsYXJDb3JlUGFja2FnZVBhdGgpKTtcblxuICAgICAgY21mLmhvb2tzLmFmdGVyUmVzb2x2ZS50YXBBc3luYygnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAocmVzdWx0OiBhbnksIGNhbGxiYWNrOiAoZXJyPzogRXJyb3IsIHJlcXVlc3Q/OiBhbnkpID0+IHZvaWQpID0+IHtcbiAgICAgICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEFsdGVyIG9ubHkgcmVxdWVzdCBmcm9tIEFuZ3VsYXIuXG4gICAgICAgIGlmICghcmVzdWx0LnJlc291cmNlLnN0YXJ0c1dpdGgoYW5ndWxhckNvcmVEaXJuYW1lKSkge1xuICAgICAgICAgIHJldHVybiBjYWxsYmFjayh1bmRlZmluZWQsIHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLmRvbmUpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5kb25lLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIC8vIFRoaXMgZm9sZGVyIGRvZXMgbm90IGV4aXN0LCBidXQgd2UgbmVlZCB0byBnaXZlIHdlYnBhY2sgYSByZXNvdXJjZS5cbiAgICAgICAgICAvLyBUT0RPOiBjaGVjayBpZiB3ZSBjYW4ndCBqdXN0IGxlYXZlIGl0IGFzIGlzIChhbmd1bGFyQ29yZU1vZHVsZURpcikuXG4gICAgICAgICAgcmVzdWx0LnJlc291cmNlID0gcGF0aC5qb2luKHRoaXMuX2Jhc2VQYXRoLCAnJCRfbGF6eV9yb3V0ZV9yZXNvdXJjZScpO1xuICAgICAgICAgIHJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZDogYW55KSA9PiBkLmNyaXRpY2FsID0gZmFsc2UpO1xuICAgICAgICAgIHJlc3VsdC5yZXNvbHZlRGVwZW5kZW5jaWVzID0gKF9mczogYW55LCByZXNvdXJjZU9yT3B0aW9uczogYW55LCByZWN1cnNpdmVPckNhbGxiYWNrOiBhbnksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgX3JlZ0V4cDogUmVnRXhwLCBjYjogYW55KSA9PiB7XG4gICAgICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBPYmplY3Qua2V5cyh0aGlzLl9sYXp5Um91dGVzKVxuICAgICAgICAgICAgICAubWFwKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVQYXRoID0gdGhpcy5fbGF6eVJvdXRlc1trZXldO1xuICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydFBhdGggPSBrZXkuc3BsaXQoJyMnKVswXTtcbiAgICAgICAgICAgICAgICBpZiAobW9kdWxlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGltcG9ydFBhdGgucmVwbGFjZSgvKFxcLm5nZmFjdG9yeSk/XFwuKGpzfHRzKSQvLCAnJyk7XG5cbiAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5KG1vZHVsZVBhdGgsIG5hbWUpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC5maWx0ZXIoeCA9PiAhIXgpO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYiAhPT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgcmVjdXJzaXZlT3JDYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAvLyBXZWJwYWNrIDQgb25seSBoYXMgMyBwYXJhbWV0ZXJzXG4gICAgICAgICAgICAgIGNiID0gcmVjdXJzaXZlT3JDYWxsYmFjaztcbiAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubmFtZUxhenlGaWxlcykge1xuICAgICAgICAgICAgICAgIHJlc291cmNlT3JPcHRpb25zLmNodW5rTmFtZSA9ICdbcmVxdWVzdF0nO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYihudWxsLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICAgIH07XG5cbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHQpO1xuICAgICAgICB9LCAoKSA9PiBjYWxsYmFjaygpKVxuICAgICAgICAgIC5jYXRjaChlcnIgPT4gY2FsbGJhY2soZXJyKSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhbmQgZGVzdHJveSBmb3JrZWQgdHlwZSBjaGVja2VyIG9uIHdhdGNoIG1vZGUuXG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hSdW4udGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAoX2NvbXBpbGVyOiBhbnksIGNhbGxiYWNrOiBhbnkpID0+IHtcbiAgICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgIXRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgICB0aGlzLl9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpO1xuICAgICAgfVxuICAgICAgY2FsbGJhY2soKTtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy53YXRjaENsb3NlLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpKTtcblxuICAgIC8vIFJlbWFrZSB0aGUgcGx1Z2luIG9uIGVhY2ggY29tcGlsYXRpb24uXG4gICAgY29tcGlsZXIuaG9va3MubWFrZS50YXBBc3luYyhcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgIChjb21waWxhdGlvbjogYW55LCBjYjogYW55KSA9PiB0aGlzLl9tYWtlKGNvbXBpbGF0aW9uLCBjYiksXG4gICAgKTtcbiAgICBjb21waWxlci5ob29rcy5pbnZhbGlkLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2ZpcnN0UnVuID0gZmFsc2UpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyRW1pdC50YXBBc3luYygnYW5ndWxhci1jb21waWxlcicsIChjb21waWxhdGlvbjogYW55LCBjYjogYW55KSA9PiB7XG4gICAgICBjb21waWxhdGlvbi5fbmdUb29sc1dlYnBhY2tQbHVnaW5JbnN0YW5jZSA9IG51bGw7XG4gICAgICBjYigpO1xuICAgIH0pO1xuICAgIGNvbXBpbGVyLmhvb2tzLmRvbmUudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgdGhpcy5fZG9uZVByb21pc2UgPSBudWxsO1xuICAgIH0pO1xuXG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKGNvbXBpbGVyOiBhbnkpID0+IHtcbiAgICAgIGNvbXBpbGVyLmhvb2tzLm5vcm1hbE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKG5tZjogYW55KSA9PiB7XG4gICAgICAgIC8vIFZpcnR1YWwgZmlsZSBzeXN0ZW0uXG4gICAgICAgIC8vIFRPRE86IGNvbnNpZGVyIGlmIGl0J3MgYmV0dGVyIHRvIHJlbW92ZSB0aGlzIHBsdWdpbiBhbmQgaW5zdGVhZCBtYWtlIGl0IHdhaXQgb24gdGhlXG4gICAgICAgIC8vIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLlxuICAgICAgICAvLyBXYWl0IGZvciB0aGUgcGx1Z2luIHRvIGJlIGRvbmUgd2hlbiByZXF1ZXN0aW5nIGAudHNgIGZpbGVzIGRpcmVjdGx5IChlbnRyeSBwb2ludHMpLCBvclxuICAgICAgICAvLyB3aGVuIHRoZSBpc3N1ZXIgaXMgYSBgLnRzYCBvciBgLm5nZmFjdG9yeS5qc2AgZmlsZS5cbiAgICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVxdWVzdDogYW55LCBjYWxsYmFjazogYW55KSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuZG9uZSAmJiAocmVxdWVzdC5yZXF1ZXN0LmVuZHNXaXRoKCcudHMnKVxuICAgICAgICAgICAgICB8fCAocmVxdWVzdC5jb250ZXh0Lmlzc3VlciAmJiAvXFwudHN8bmdmYWN0b3J5XFwuanMkLy50ZXN0KHJlcXVlc3QuY29udGV4dC5pc3N1ZXIpKSkpIHtcbiAgICAgICAgICAgIHRoaXMuZG9uZS50aGVuKCgpID0+IGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpLCAoKSA9PiBjYWxsYmFjayhudWxsLCByZXF1ZXN0KSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKG51bGwsIHJlcXVlc3QpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLm5vcm1hbE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKG5tZjogYW55KSA9PiB7XG4gICAgICBubWYuaG9va3MuYmVmb3JlUmVzb2x2ZS50YXBBc3luYygnYW5ndWxhci1jb21waWxlcicsIChyZXF1ZXN0OiBhbnksIGNhbGxiYWNrOiBhbnkpID0+IHtcbiAgICAgICAgcmVzb2x2ZVdpdGhQYXRocyhcbiAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgICAgdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9tYWtlKGNvbXBpbGF0aW9uOiBhbnksIGNiOiAoZXJyPzogYW55LCByZXF1ZXN0PzogYW55KSA9PiB2b2lkKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSB0cnVlO1xuICAgIGlmIChjb21waWxhdGlvbi5fbmdUb29sc1dlYnBhY2tQbHVnaW5JbnN0YW5jZSkge1xuICAgICAgcmV0dXJuIGNiKG5ldyBFcnJvcignQW4gQG5ndG9vbHMvd2VicGFjayBwbHVnaW4gYWxyZWFkeSBleGlzdCBmb3IgdGhpcyBjb21waWxhdGlvbi4nKSk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgY29tcGlsYXRpb24uX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSB0aGlzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSByZXNvdXJjZSBsb2FkZXIgd2l0aCB0aGUgbmV3IHdlYnBhY2sgY29tcGlsYXRpb24uXG4gICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uKTtcblxuICAgIHRoaXMuX2RvbmVQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3VwZGF0ZSgpKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgICAgICBjYigpO1xuICAgICAgfSwgKGVycjogYW55KSA9PiB7XG4gICAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKGVycik7XG4gICAgICAgIHRoaXMucHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgICAgIGNiKCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uOiBhbnkpIHtcbiAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaCguLi50aGlzLl9lcnJvcnMpO1xuICAgIGNvbXBpbGF0aW9uLndhcm5pbmdzLnB1c2goLi4udGhpcy5fd2FybmluZ3MpO1xuICAgIHRoaXMuX2Vycm9ycyA9IFtdO1xuICAgIHRoaXMuX3dhcm5pbmdzID0gW107XG4gIH1cblxuICBwcml2YXRlIF9tYWtlVHJhbnNmb3JtZXJzKCkge1xuICAgIGNvbnN0IGlzQXBwUGF0aCA9IChmaWxlTmFtZTogc3RyaW5nKSA9PlxuICAgICAgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdmYWN0b3J5LnRzJykgJiYgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdzdHlsZS50cycpO1xuICAgIGNvbnN0IGlzTWFpblBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT4gZmlsZU5hbWUgPT09IChcbiAgICAgIHRoaXMuX21haW5QYXRoID8gd29ya2Fyb3VuZFJlc29sdmUodGhpcy5fbWFpblBhdGgpIDogdGhpcy5fbWFpblBhdGhcbiAgICApO1xuICAgIGNvbnN0IGdldEVudHJ5TW9kdWxlID0gKCkgPT4gdGhpcy5lbnRyeU1vZHVsZVxuICAgICAgPyB7IHBhdGg6IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuZW50cnlNb2R1bGUucGF0aCksIGNsYXNzTmFtZTogdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWUgfVxuICAgICAgOiB0aGlzLmVudHJ5TW9kdWxlO1xuICAgIGNvbnN0IGdldExhenlSb3V0ZXMgPSAoKSA9PiB0aGlzLl9sYXp5Um91dGVzO1xuICAgIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gdGhpcy5fZ2V0VHNQcm9ncmFtKCkuZ2V0VHlwZUNoZWNrZXIoKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBSZXBsYWNlIHJlc291cmNlcyBpbiBKSVQuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZXBsYWNlUmVzb3VyY2VzKGlzQXBwUGF0aCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdmUgdW5uZWVkZWQgYW5ndWxhciBkZWNvcmF0b3JzLlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVtb3ZlRGVjb3JhdG9ycyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5Ccm93c2VyKSB7XG4gICAgICAvLyBJZiB3ZSBoYXZlIGEgbG9jYWxlLCBhdXRvIGltcG9ydCB0aGUgbG9jYWxlIGRhdGEgZmlsZS5cbiAgICAgIC8vIFRoaXMgdHJhbnNmb3JtIG11c3QgZ28gYmVmb3JlIHJlcGxhY2VCb290c3RyYXAgYmVjYXVzZSBpdCBsb29rcyBmb3IgdGhlIGVudHJ5IG1vZHVsZVxuICAgICAgLy8gaW1wb3J0LCB3aGljaCB3aWxsIGJlIHJlcGxhY2VkLlxuICAgICAgaWYgKHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVnaXN0ZXJMb2NhbGVEYXRhKGlzQXBwUGF0aCwgZ2V0RW50cnlNb2R1bGUsXG4gICAgICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSkpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgLy8gUmVwbGFjZSBib290c3RyYXAgaW4gYnJvd3NlciBBT1QuXG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VCb290c3RyYXAoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5TZXJ2ZXIpIHtcbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKGV4cG9ydExhenlNb2R1bGVNYXAoaXNNYWluUGF0aCwgZ2V0TGF6eVJvdXRlcykpO1xuICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICAgIGV4cG9ydE5nRmFjdG9yeShpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSksXG4gICAgICAgICAgcmVwbGFjZVNlcnZlckJvb3RzdHJhcChpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF91cGRhdGUoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgICAvLyBXZSBvbmx5IHdhbnQgdG8gdXBkYXRlIG9uIFRTIGFuZCB0ZW1wbGF0ZSBjaGFuZ2VzLCBidXQgYWxsIGtpbmRzIG9mIGZpbGVzIGFyZSBvbiB0aGlzXG4gICAgLy8gbGlzdCwgbGlrZSBwYWNrYWdlLmpzb24gYW5kIC5uZ3N1bW1hcnkuanNvbiBmaWxlcy5cbiAgICBjb25zdCBjaGFuZ2VkRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpO1xuXG4gICAgLy8gSWYgbm90aGluZyB3ZSBjYXJlIGFib3V0IGNoYW5nZWQgYW5kIGl0IGlzbid0IHRoZSBmaXJzdCBydW4sIGRvbid0IGRvIGFueXRoaW5nLlxuICAgIGlmIChjaGFuZ2VkRmlsZXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgLy8gTWFrZSBhIG5ldyBwcm9ncmFtIGFuZCBsb2FkIHRoZSBBbmd1bGFyIHN0cnVjdHVyZS5cbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5lbnRyeU1vZHVsZSkge1xuICAgICAgICAgIC8vIFRyeSB0byBmaW5kIGxhenkgcm91dGVzIGlmIHdlIGhhdmUgYW4gZW50cnkgbW9kdWxlLlxuICAgICAgICAgIC8vIFdlIG5lZWQgdG8gcnVuIHRoZSBgbGlzdExhenlSb3V0ZXNgIHRoZSBmaXJzdCB0aW1lIGJlY2F1c2UgaXQgYWxzbyBuYXZpZ2F0ZXMgbGlicmFyaWVzXG4gICAgICAgICAgLy8gYW5kIG90aGVyIHRoaW5ncyB0aGF0IHdlIG1pZ2h0IG1pc3MgdXNpbmcgdGhlIChmYXN0ZXIpIGZpbmRMYXp5Um91dGVzSW5Bc3QuXG4gICAgICAgICAgLy8gTGF6eSByb3V0ZXMgbW9kdWxlcyB3aWxsIGJlIHJlYWQgd2l0aCBjb21waWxlckhvc3QgYW5kIGFkZGVkIHRvIHRoZSBjaGFuZ2VkIGZpbGVzLlxuICAgICAgICAgIGNvbnN0IGNoYW5nZWRUc0ZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKTtcbiAgICAgICAgICBpZiAodGhpcy5fbmdDb21waWxlclN1cHBvcnRzTmV3QXBpKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCkpO1xuICAgICAgICAgIH0gZWxzZSBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGNoYW5nZWRUc0ZpbGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2ZpbmRMYXp5Um91dGVzSW5Bc3QoY2hhbmdlZFRzRmlsZXMpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVzKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBFbWl0IGFuZCByZXBvcnQgZXJyb3JzLlxuXG4gICAgICAgIC8vIFdlIG5vdyBoYXZlIHRoZSBmaW5hbCBsaXN0IG9mIGNoYW5nZWQgVFMgZmlsZXMuXG4gICAgICAgIC8vIEdvIHRocm91Z2ggZWFjaCBjaGFuZ2VkIGZpbGUgYW5kIGFkZCB0cmFuc2Zvcm1zIGFzIG5lZWRlZC5cbiAgICAgICAgY29uc3Qgc291cmNlRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkVHNGaWxlcygpXG4gICAgICAgICAgLm1hcCgoZmlsZU5hbWUpID0+IHRoaXMuX2dldFRzUHJvZ3JhbSgpLmdldFNvdXJjZUZpbGUoZmlsZU5hbWUpKVxuICAgICAgICAgIC8vIEF0IHRoaXMgcG9pbnQgd2Ugc2hvdWxkbid0IG5lZWQgdG8gZmlsdGVyIG91dCB1bmRlZmluZWQgZmlsZXMsIGJlY2F1c2UgYW55IHRzIGZpbGVcbiAgICAgICAgICAvLyB0aGF0IGNoYW5nZWQgc2hvdWxkIGJlIGVtaXR0ZWQuXG4gICAgICAgICAgLy8gQnV0IGR1ZSB0byBob3N0UmVwbGFjZW1lbnRQYXRocyB0aGVyZSBjYW4gYmUgZmlsZXMgKHRoZSBlbnZpcm9ubWVudCBmaWxlcylcbiAgICAgICAgICAvLyB0aGF0IGNoYW5nZWQgYnV0IGFyZW4ndCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvbiwgc3BlY2lhbGx5IG9uIGBuZyB0ZXN0YC5cbiAgICAgICAgICAvLyBTbyB3ZSBpZ25vcmUgbWlzc2luZyBzb3VyY2UgZmlsZXMgZmlsZXMgaGVyZS5cbiAgICAgICAgICAvLyBob3N0UmVwbGFjZW1lbnRQYXRocyBuZWVkcyB0byBiZSBmaXhlZCBhbnl3YXkgdG8gdGFrZSBjYXJlIG9mIHRoZSBmb2xsb3dpbmcgaXNzdWUuXG4gICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzczMDUjaXNzdWVjb21tZW50LTMzMjE1MDIzMFxuICAgICAgICAgIC5maWx0ZXIoKHgpID0+ICEheCkgYXMgdHMuU291cmNlRmlsZVtdO1xuXG4gICAgICAgIC8vIEVtaXQgZmlsZXMuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgICAgIGNvbnN0IHsgZW1pdFJlc3VsdCwgZGlhZ25vc3RpY3MgfSA9IHRoaXMuX2VtaXQoc291cmNlRmlsZXMpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZS5fZW1pdCcpO1xuXG4gICAgICAgIC8vIFJlcG9ydCBkaWFnbm9zdGljcy5cbiAgICAgICAgY29uc3QgZXJyb3JzID0gZGlhZ25vc3RpY3NcbiAgICAgICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgICAgICBjb25zdCB3YXJuaW5ncyA9IGRpYWdub3N0aWNzXG4gICAgICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgICAgIHRoaXMuX2Vycm9ycy5wdXNoKG5ldyBFcnJvcihtZXNzYWdlKSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtZXNzYWdlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gIWVtaXRSZXN1bHQgfHwgZW1pdFJlc3VsdC5lbWl0U2tpcHBlZDtcblxuICAgICAgICAvLyBSZXNldCBjaGFuZ2VkIGZpbGVzIG9uIHN1Y2Nlc3NmdWwgY29tcGlsYXRpb24uXG4gICAgICAgIGlmICghdGhpcy5fZW1pdFNraXBwZWQgJiYgdGhpcy5fZXJyb3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgICB9KTtcbiAgfVxuXG4gIHdyaXRlSTE4bk91dEZpbGUoKSB7XG4gICAgZnVuY3Rpb24gX3JlY3Vyc2l2ZU1rRGlyKHA6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgaWYgKGZzLmV4aXN0c1N5bmMocCkpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUocCkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gZnMubWtkaXJTeW5jKHApKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXcml0ZSB0aGUgZXh0cmFjdGVkIG1lc3NhZ2VzIHRvIGRpc2suXG4gICAgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSkge1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLCB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpO1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVDb250ZW50ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKGkxOG5PdXRGaWxlUGF0aCk7XG4gICAgICBpZiAoaTE4bk91dEZpbGVDb250ZW50KSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUoaTE4bk91dEZpbGVQYXRoKSlcbiAgICAgICAgICAudGhlbigoKSA9PiBmcy53cml0ZUZpbGVTeW5jKGkxOG5PdXRGaWxlUGF0aCwgaTE4bk91dEZpbGVDb250ZW50KSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0Q29tcGlsZWRGaWxlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvdXRwdXRGaWxlID0gZmlsZU5hbWUucmVwbGFjZSgvLnRzJC8sICcuanMnKTtcbiAgICBsZXQgb3V0cHV0VGV4dDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2VNYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZXJyb3JEZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAodGhpcy5fZW1pdFNraXBwZWQpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICAvLyBJZiB0aGUgY29tcGlsYXRpb24gZGlkbid0IGVtaXQgZmlsZXMgdGhpcyB0aW1lLCB0cnkgdG8gcmV0dXJuIHRoZSBjYWNoZWQgZmlsZXMgZnJvbSB0aGVcbiAgICAgICAgLy8gbGFzdCBjb21waWxhdGlvbiBhbmQgbGV0IHRoZSBjb21waWxhdGlvbiBlcnJvcnMgc2hvdyB3aGF0J3Mgd3JvbmcuXG4gICAgICAgIG91dHB1dFRleHQgPSB0ZXh0O1xuICAgICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUaGVyZSdzIG5vdGhpbmcgd2UgY2FuIHNlcnZlLiBSZXR1cm4gYW4gZW1wdHkgc3RyaW5nIHRvIHByZXZlbnQgbGVuZ2h0eSB3ZWJwYWNrIGVycm9ycyxcbiAgICAgICAgLy8gYWRkIHRoZSByZWJ1aWxkIHdhcm5pbmcgaWYgaXQncyBub3QgdGhlcmUgeWV0LlxuICAgICAgICAvLyBXZSBhbHNvIG5lZWQgdG8gYWxsIGNoYW5nZWQgZmlsZXMgYXMgZGVwZW5kZW5jaWVzIG9mIHRoaXMgZmlsZSwgc28gdGhhdCBhbGwgb2YgdGhlbVxuICAgICAgICAvLyB3aWxsIGJlIHdhdGNoZWQgYW5kIHRyaWdnZXIgYSByZWJ1aWxkIG5leHQgdGltZS5cbiAgICAgICAgb3V0cHV0VGV4dCA9ICcnO1xuICAgICAgICBlcnJvckRlcGVuZGVuY2llcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKClcbiAgICAgICAgICAvLyBUaGVzZSBwYXRocyBhcmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICAgICAgICAubWFwKChwKSA9PiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2hlY2sgaWYgdGhlIFRTIGlucHV0IGZpbGUgYW5kIHRoZSBKUyBvdXRwdXQgZmlsZSBleGlzdC5cbiAgICAgIGlmICgoZmlsZU5hbWUuZW5kc1dpdGgoJy50cycpICYmICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhmaWxlTmFtZSwgZmFsc2UpKVxuICAgICAgICB8fCAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMob3V0cHV0RmlsZSwgZmFsc2UpKSB7XG4gICAgICAgIGxldCBtc2cgPSBgJHtmaWxlTmFtZX0gaXMgbWlzc2luZyBmcm9tIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uLiBgXG4gICAgICAgICAgKyBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcblxuICAgICAgICBpZiAoLyhcXFxcfFxcLylub2RlX21vZHVsZXMoXFxcXHxcXC8pLy50ZXN0KGZpbGVOYW1lKSkge1xuICAgICAgICAgIG1zZyArPSAnXFxuVGhlIG1pc3NpbmcgZmlsZSBzZWVtcyB0byBiZSBwYXJ0IG9mIGEgdGhpcmQgcGFydHkgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnVFMgZmlsZXMgaW4gcHVibGlzaGVkIGxpYnJhcmllcyBhcmUgb2Z0ZW4gYSBzaWduIG9mIGEgYmFkbHkgcGFja2FnZWQgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnUGxlYXNlIG9wZW4gYW4gaXNzdWUgaW4gdGhlIGxpYnJhcnkgcmVwb3NpdG9yeSB0byBhbGVydCBpdHMgYXV0aG9yIGFuZCBhc2sgdGhlbSAnXG4gICAgICAgICAgICArICd0byBwYWNrYWdlIHRoZSBsaWJyYXJ5IHVzaW5nIHRoZSBBbmd1bGFyIFBhY2thZ2UgRm9ybWF0IChodHRwczovL2dvby5nbC9qQjNHVnYpLic7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICAgIH1cblxuICAgICAgb3V0cHV0VGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKSB8fCAnJztcbiAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBvdXRwdXRUZXh0LCBzb3VyY2VNYXAsIGVycm9yRGVwZW5kZW5jaWVzIH07XG4gIH1cblxuICBnZXREZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUoZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLl9jb21waWxlckhvc3QuZ2V0U291cmNlRmlsZShyZXNvbHZlZEZpbGVOYW1lLCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0KTtcbiAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fY29tcGlsZXJPcHRpb25zO1xuICAgIGNvbnN0IGhvc3QgPSB0aGlzLl9jb21waWxlckhvc3Q7XG4gICAgY29uc3QgY2FjaGUgPSB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG5cbiAgICBjb25zdCBlc0ltcG9ydHMgPSBjb2xsZWN0RGVlcE5vZGVzPHRzLkltcG9ydERlY2xhcmF0aW9uPihzb3VyY2VGaWxlLFxuICAgICAgdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgIC5tYXAoZGVjbCA9PiB7XG4gICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSAoZGVjbC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dDtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShtb2R1bGVOYW1lLCByZXNvbHZlZEZpbGVOYW1lLCBvcHRpb25zLCBob3N0LCBjYWNoZSk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkLnJlc29sdmVkTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKHggPT4geCk7XG5cbiAgICBjb25zdCByZXNvdXJjZUltcG9ydHMgPSBmaW5kUmVzb3VyY2VzKHNvdXJjZUZpbGUpXG4gICAgICAubWFwKChyZXNvdXJjZVJlcGxhY2VtZW50KSA9PiByZXNvdXJjZVJlcGxhY2VtZW50LnJlc291cmNlUGF0aHMpXG4gICAgICAucmVkdWNlKChwcmV2LCBjdXJyKSA9PiBwcmV2LmNvbmNhdChjdXJyKSwgW10pXG4gICAgICAubWFwKChyZXNvdXJjZVBhdGgpID0+IHJlc29sdmUoZGlybmFtZShyZXNvbHZlZEZpbGVOYW1lKSwgbm9ybWFsaXplKHJlc291cmNlUGF0aCkpKTtcblxuICAgIC8vIFRoZXNlIHBhdGhzIGFyZSBtZWFudCB0byBiZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgIGNvbnN0IHVuaXF1ZURlcGVuZGVuY2llcyA9ICBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXModGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChyZXNvbHZlZEZpbGVOYW1lKSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8vIFRoaXMgY29kZSBtb3N0bHkgY29tZXMgZnJvbSBgcGVyZm9ybUNvbXBpbGF0aW9uYCBpbiBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYC5cbiAgLy8gSXQgc2tpcHMgdGhlIHByb2dyYW0gY3JlYXRpb24gYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZSBgbG9hZE5nU3RydWN0dXJlQXN5bmMoKWAsXG4gIC8vIGFuZCB1c2VzIEN1c3RvbVRyYW5zZm9ybWVycy5cbiAgcHJpdmF0ZSBfZW1pdChzb3VyY2VGaWxlczogdHMuU291cmNlRmlsZVtdKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG4gICAgY29uc3QgcHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW07XG4gICAgY29uc3QgYWxsRGlhZ25vc3RpY3M6IEFycmF5PHRzLkRpYWdub3N0aWMgfCBEaWFnbm9zdGljPiA9IFtdO1xuXG4gICAgbGV0IGVtaXRSZXN1bHQ6IHRzLkVtaXRSZXN1bHQgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHByb2dyYW0gYXMgdHMuUHJvZ3JhbTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4udHNQcm9ncmFtLmdldE9wdGlvbnNEaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgc291cmNlRmlsZXMuZm9yRWFjaCgoc2YpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzZi5maWxlTmFtZX0rLmVtaXRgO1xuICAgICAgICAgICAgdGltZSh0aW1lTGFiZWwpO1xuICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KHNmLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICAgIHRpbWVFbmQodGltZUxhYmVsKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBwcm9ncmFtIGFzIFByb2dyYW07XG5cbiAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBzdHJ1Y3R1cmFsIGRpYWdub3N0aWNzLlxuICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcygpKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgVHlwZVNjcmlwdCBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=