"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
            .map((resourcePath) => path.resolve(path.dirname(resolvedFileName), resourcePath));
        // These paths are meant to be used by the loader so we must denormalize them.
        const uniqueDependencies = new Set([
            ...esImports,
            ...resourceImports,
            ...this.getResourceDependencies(resolvedFileName),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFXQSxpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFDakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9FO0FBQ3BFLCtDQUE2RDtBQUM3RCwrQ0FnQnVCO0FBQ3ZCLGlEQUFrRDtBQUNsRCx1REFBMEQ7QUFDMUQsaURBU3dCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFBNEU7QUFDNUUsbUZBR3lDO0FBR3pDLE1BQU0sd0JBQXdCLEdBQUcsT0FBTyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7QUFDOUYsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBb0N0QyxJQUFZLFFBR1g7QUFIRCxXQUFZLFFBQVE7SUFDbEIsNkNBQU8sQ0FBQTtJQUNQLDJDQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsUUFBUSxHQUFSLGdCQUFRLEtBQVIsZ0JBQVEsUUFHbkI7QUFFRDtJQTJDRSxZQUFZLE9BQXFDO1FBckN6Qyx3QkFBbUIsR0FBYSxFQUFFLENBQUM7UUFLM0MsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBRTNELGFBQVEsR0FBRyxLQUFLLENBQUM7UUFDakIsaUJBQVksR0FBRyxJQUFJLENBQUM7UUFDcEIsMkJBQXNCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFFaEUsa0JBQWtCO1FBQ1YsY0FBUyxHQUFHLElBQUksQ0FBQztRQUdqQixj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LEVBQUUsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7Z0JBQ2QsTUFBTSxHQUFHLFNBQVMsQ0FBQztZQUNyQixDQUFDO1lBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ04sNEJBQTRCO2dCQUM1QixNQUFNLFlBQVksR0FBRyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3BELEVBQUUsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUN6QyxNQUFNLEdBQUcsWUFBWSxDQUFDO2dCQUN4QixDQUFDO2dCQUFDLElBQUksQ0FBQyxDQUFDO29CQUNOLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLDZEQUE2RDt3QkFDL0UsNEJBQTRCLE1BQU0sS0FBSzt3QkFDdkMsc0JBQXNCLE1BQU07a0VBQzBCLENBQUMsQ0FBQztvQkFFMUQsTUFBTSxDQUFDLElBQUksQ0FBQztnQkFDZCxDQUFDO1lBQ0gsQ0FBQztRQUNILENBQUM7UUFFRCxNQUFNLENBQUMsTUFBTSxDQUFDO0lBQ2hCLENBQUM7Q0FDRjtBQTMvQkQsc0RBMi9CQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbi8vIFRPRE86IGZpeCB3ZWJwYWNrIHR5cGluZ3MuXG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tZ2xvYmFsLXRzbGludC1kaXNhYmxlXG4vLyB0c2xpbnQ6ZGlzYWJsZTpuby1hbnlcbmltcG9ydCB7IHZpcnR1YWxGcyB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IENoaWxkUHJvY2VzcywgRm9ya09wdGlvbnMsIGZvcmsgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgZ2F0aGVyRGlhZ25vc3RpY3MsIGhhc0Vycm9ycyB9IGZyb20gJy4vZ2F0aGVyX2RpYWdub3N0aWNzJztcbmltcG9ydCB7IExhenlSb3V0ZU1hcCwgZmluZExhenlSb3V0ZXMgfSBmcm9tICcuL2xhenlfcm91dGVzJztcbmltcG9ydCB7XG4gIENvbXBpbGVyQ2xpSXNTdXBwb3J0ZWQsXG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBERUZBVUxUX0VSUk9SX0NPREUsXG4gIERpYWdub3N0aWMsXG4gIEVtaXRGbGFncyxcbiAgUHJvZ3JhbSxcbiAgU09VUkNFLFxuICBVTktOT1dOX0VSUk9SX0NPREUsXG4gIFZFUlNJT04sXG4gIF9fTkdUT09MU19QUklWQVRFX0FQSV8yLFxuICBjcmVhdGVDb21waWxlckhvc3QsXG4gIGNyZWF0ZVByb2dyYW0sXG4gIGZvcm1hdERpYWdub3N0aWNzLFxuICByZWFkQ29uZmlndXJhdGlvbixcbn0gZnJvbSAnLi9uZ3Rvb2xzX2FwaSc7XG5pbXBvcnQgeyByZXNvbHZlV2l0aFBhdGhzIH0gZnJvbSAnLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi9yZXNvdXJjZV9sb2FkZXInO1xuaW1wb3J0IHtcbiAgZXhwb3J0TGF6eU1vZHVsZU1hcCxcbiAgZXhwb3J0TmdGYWN0b3J5LFxuICBmaW5kUmVzb3VyY2VzLFxuICByZWdpc3RlckxvY2FsZURhdGEsXG4gIHJlbW92ZURlY29yYXRvcnMsXG4gIHJlcGxhY2VCb290c3RyYXAsXG4gIHJlcGxhY2VSZXNvdXJjZXMsXG4gIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAsXG59IGZyb20gJy4vdHJhbnNmb3JtZXJzJztcbmltcG9ydCB7IGNvbGxlY3REZWVwTm9kZXMgfSBmcm9tICcuL3RyYW5zZm9ybWVycy9hc3RfaGVscGVycyc7XG5pbXBvcnQgeyBBVVRPX1NUQVJUX0FSRywgSW5pdE1lc3NhZ2UsIFVwZGF0ZU1lc3NhZ2UgfSBmcm9tICcuL3R5cGVfY2hlY2tlcic7XG5pbXBvcnQge1xuICBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcixcbiAgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcixcbn0gZnJvbSAnLi92aXJ0dWFsX2ZpbGVfc3lzdGVtX2RlY29yYXRvcic7XG5cblxuY29uc3QgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5ID0gcmVxdWlyZSgnd2VicGFjay9saWIvZGVwZW5kZW5jaWVzL0NvbnRleHRFbGVtZW50RGVwZW5kZW5jeScpO1xuY29uc3QgdHJlZUtpbGwgPSByZXF1aXJlKCd0cmVlLWtpbGwnKTtcblxuXG4vKipcbiAqIE9wdGlvbiBDb25zdGFudHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zIHtcbiAgc291cmNlTWFwPzogYm9vbGVhbjtcbiAgdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIGJhc2VQYXRoPzogc3RyaW5nO1xuICBlbnRyeU1vZHVsZT86IHN0cmluZztcbiAgbWFpblBhdGg/OiBzdHJpbmc7XG4gIHNraXBDb2RlR2VuZXJhdGlvbj86IGJvb2xlYW47XG4gIGhvc3RSZXBsYWNlbWVudFBhdGhzPzogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH07XG4gIGZvcmtUeXBlQ2hlY2tlcj86IGJvb2xlYW47XG4gIC8vIFRPRE86IHJlbW92ZSBzaW5nbGVGaWxlSW5jbHVkZXMgZm9yIDIuMCwgdGhpcyBpcyBqdXN0IHRvIHN1cHBvcnQgb2xkIHByb2plY3RzIHRoYXQgZGlkIG5vdFxuICAvLyBpbmNsdWRlICdwb2x5ZmlsbHMudHMnIGluIGB0c2NvbmZpZy5zcGVjLmpzb24nLlxuICBzaW5nbGVGaWxlSW5jbHVkZXM/OiBzdHJpbmdbXTtcbiAgaTE4bkluRmlsZT86IHN0cmluZztcbiAgaTE4bkluRm9ybWF0Pzogc3RyaW5nO1xuICBpMThuT3V0RmlsZT86IHN0cmluZztcbiAgaTE4bk91dEZvcm1hdD86IHN0cmluZztcbiAgbG9jYWxlPzogc3RyaW5nO1xuICBtaXNzaW5nVHJhbnNsYXRpb24/OiBzdHJpbmc7XG4gIHBsYXRmb3JtPzogUExBVEZPUk07XG4gIG5hbWVMYXp5RmlsZXM/OiBib29sZWFuO1xuXG4gIC8vIGFkZGVkIHRvIHRoZSBsaXN0IG9mIGxhenkgcm91dGVzXG4gIGFkZGl0aW9uYWxMYXp5TW9kdWxlcz86IHsgW21vZHVsZTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgLy8gVXNlIHRzY29uZmlnIHRvIGluY2x1ZGUgcGF0aCBnbG9icy5cbiAgY29tcGlsZXJPcHRpb25zPzogdHMuQ29tcGlsZXJPcHRpb25zO1xuXG4gIGhvc3Q6IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPjtcbn1cblxuZXhwb3J0IGVudW0gUExBVEZPUk0ge1xuICBCcm93c2VyLFxuICBTZXJ2ZXIsXG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyQ29tcGlsZXJQbHVnaW4ge1xuICBwcml2YXRlIF9vcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zO1xuXG4gIC8vIFRTIGNvbXBpbGF0aW9uLlxuICBwcml2YXRlIF9jb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSBfc2luZ2xlRmlsZUluY2x1ZGVzOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIF9wcm9ncmFtOiAodHMuUHJvZ3JhbSB8IFByb2dyYW0pIHwgbnVsbDtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuICBwcml2YXRlIF9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU6IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZTtcbiAgcHJpdmF0ZSBfcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgLy8gQ29udGFpbnMgYG1vZHVsZUltcG9ydFBhdGgjZXhwb3J0TmFtZWAgPT4gYGZ1bGxNb2R1bGVQYXRoYC5cbiAgcHJpdmF0ZSBfbGF6eVJvdXRlczogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgcHJpdmF0ZSBfdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX2VudHJ5TW9kdWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF9tYWluUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIF9iYXNlUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF90cmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdID0gW107XG4gIHByaXZhdGUgX3BsYXRmb3JtOiBQTEFURk9STTtcbiAgcHJpdmF0ZSBfSml0TW9kZSA9IGZhbHNlO1xuICBwcml2YXRlIF9lbWl0U2tpcHBlZCA9IHRydWU7XG4gIHByaXZhdGUgX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucyA9IG5ldyBTZXQoWyd0cycsICdodG1sJywgJ2NzcyddKTtcblxuICAvLyBXZWJwYWNrIHBsdWdpbi5cbiAgcHJpdmF0ZSBfZmlyc3RSdW4gPSB0cnVlO1xuICBwcml2YXRlIF9kb25lUHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGw7XG4gIHByaXZhdGUgX25vcm1hbGl6ZWRMb2NhbGU6IHN0cmluZyB8IG51bGw7XG4gIHByaXZhdGUgX3dhcm5pbmdzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcbiAgcHJpdmF0ZSBfZXJyb3JzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcblxuICAvLyBUeXBlQ2hlY2tlciBwcm9jZXNzLlxuICBwcml2YXRlIF9mb3JrVHlwZUNoZWNrZXIgPSB0cnVlO1xuICBwcml2YXRlIF90eXBlQ2hlY2tlclByb2Nlc3M6IENoaWxkUHJvY2VzcyB8IG51bGw7XG4gIHByaXZhdGUgX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICBwcml2YXRlIGdldCBfbmdDb21waWxlclN1cHBvcnRzTmV3QXBpKCkge1xuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAhISh0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0pLmxpc3RMYXp5Um91dGVzO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICBDb21waWxlckNsaUlzU3VwcG9ydGVkKCk7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIGlmIChvcHRpb25zLnNpbmdsZUZpbGVJbmNsdWRlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9zaW5nbGVGaWxlSW5jbHVkZXMucHVzaCguLi5vcHRpb25zLnNpbmdsZUZpbGVJbmNsdWRlcyk7XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgdGhlIHRzY29uZmlnIGNvbnRlbnRzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgaWYgKGNvbmZpZy5lcnJvcnMgJiYgY29uZmlnLmVycm9ycy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihmb3JtYXREaWFnbm9zdGljcyhjb25maWcuZXJyb3JzKSk7XG4gICAgfVxuXG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcy5jb25jYXQoLi4udGhpcy5fc2luZ2xlRmlsZUluY2x1ZGVzKTtcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMgPSB7IC4uLmNvbmZpZy5vcHRpb25zLCAuLi5vcHRpb25zLmNvbXBpbGVyT3B0aW9ucyB9O1xuICAgIHRoaXMuX2Jhc2VQYXRoID0gY29uZmlnLm9wdGlvbnMuYmFzZVBhdGggfHwgJyc7XG5cbiAgICAvLyBPdmVyd3JpdGUgb3V0RGlyIHNvIHdlIGNhbiBmaW5kIGdlbmVyYXRlZCBmaWxlcyBuZXh0IHRvIHRoZWlyIC50cyBvcmlnaW4gaW4gY29tcGlsZXJIb3N0LlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSAnJztcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuXG4gICAgLy8gRGVmYXVsdCBwbHVnaW4gc291cmNlTWFwIHRvIGNvbXBpbGVyIG9wdGlvbnMgc2V0dGluZy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3NvdXJjZU1hcCcpKSB7XG4gICAgICBvcHRpb25zLnNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgfHwgZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gRm9yY2UgdGhlIHJpZ2h0IHNvdXJjZW1hcCBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLnNvdXJjZU1hcCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIC8vIFdlIHdpbGwgc2V0IHRoZSBzb3VyY2UgdG8gdGhlIGZ1bGwgcGF0aCBvZiB0aGUgZmlsZSBpbiB0aGUgbG9hZGVyLCBzbyB3ZSBkb24ndFxuICAgICAgLy8gbmVlZCBzb3VyY2VSb290IGhlcmUuXG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIFdlIHdhbnQgdG8gYWxsb3cgZW1pdHRpbmcgd2l0aCBlcnJvcnMgc28gdGhhdCBpbXBvcnRzIGNhbiBiZSBhZGRlZFxuICAgIC8vIHRvIHRoZSB3ZWJwYWNrIGRlcGVuZGVuY3kgdHJlZSBhbmQgcmVidWlsZHMgdHJpZ2dlcmVkIGJ5IGZpbGUgZWRpdHMuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcblxuICAgIC8vIFNldCBKSVQgKG5vIGNvZGUgZ2VuZXJhdGlvbikgb3IgQU9UIG1vZGUuXG4gICAgaWYgKG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX0ppdE1vZGUgPSBvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbjtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGkxOG4gb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5pMThuSW5GaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5GaWxlID0gb3B0aW9ucy5pMThuSW5GaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuSW5Gb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZvcm1hdCA9IG9wdGlvbnMuaTE4bkluRm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0RmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUgPSBvcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0Rm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0Rm9ybWF0ID0gb3B0aW9ucy5pMThuT3V0Rm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5sb2NhbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkxvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRMb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUgPSB0aGlzLl92YWxpZGF0ZUxvY2FsZShvcHRpb25zLmxvY2FsZSk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTWlzc2luZ1RyYW5zbGF0aW9ucyA9XG4gICAgICAgIG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uIGFzICdlcnJvcicgfCAnd2FybmluZycgfCAnaWdub3JlJztcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGZvcmtlZCB0eXBlIGNoZWNrZXIgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5mb3JrVHlwZUNoZWNrZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gb3B0aW9ucy5mb3JrVHlwZUNoZWNrZXI7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHRoZSB3ZWJwYWNrIGNvbXBpbGVyIGhvc3QuXG4gICAgY29uc3Qgd2VicGFja0NvbXBpbGVySG9zdCA9IG5ldyBXZWJwYWNrQ29tcGlsZXJIb3N0KFxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgdGhpcy5fYmFzZVBhdGgsXG4gICAgICB0aGlzLl9vcHRpb25zLmhvc3QsXG4gICAgKTtcbiAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LmVuYWJsZUNhY2hpbmcoKTtcblxuICAgIC8vIENyZWF0ZSBhbmQgc2V0IGEgbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlci5cbiAgICB0aGlzLl9yZXNvdXJjZUxvYWRlciA9IG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIoKTtcbiAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LnNldFJlc291cmNlTG9hZGVyKHRoaXMuX3Jlc291cmNlTG9hZGVyKTtcblxuICAgIC8vIFVzZSB0aGUgV2VicGFja0NvbXBpbGVySG9zdCB3aXRoIGEgcmVzb3VyY2UgbG9hZGVyIHRvIGNyZWF0ZSBhbiBBbmd1bGFyQ29tcGlsZXJIb3N0LlxuICAgIHRoaXMuX2NvbXBpbGVySG9zdCA9IGNyZWF0ZUNvbXBpbGVySG9zdCh7XG4gICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICB0c0hvc3Q6IHdlYnBhY2tDb21waWxlckhvc3QsXG4gICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcblxuICAgIC8vIE92ZXJyaWRlIHNvbWUgZmlsZXMgaW4gdGhlIEZpbGVTeXN0ZW0gd2l0aCBwYXRocyBmcm9tIHRoZSBhY3R1YWwgZmlsZSBzeXN0ZW0uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgIGZvciAoY29uc3QgZmlsZVBhdGggb2YgT2JqZWN0LmtleXModGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykpIHtcbiAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRGaWxlUGF0aCA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNbZmlsZVBhdGhdO1xuICAgICAgICBjb25zdCBjb250ZW50ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKHJlcGxhY2VtZW50RmlsZVBhdGgpO1xuICAgICAgICBpZiAoY29udGVudCkge1xuICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC53cml0ZUZpbGUoZmlsZVBhdGgsIGNvbnRlbnQsIGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJlc29sdmUgbWFpblBhdGggaWYgcHJvdmlkZWQuXG4gICAgaWYgKG9wdGlvbnMubWFpblBhdGgpIHtcbiAgICAgIHRoaXMuX21haW5QYXRoID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUob3B0aW9ucy5tYWluUGF0aCk7XG4gICAgfVxuXG4gICAgLy8gVXNlIGVudHJ5TW9kdWxlIGlmIGF2YWlsYWJsZSBpbiBvcHRpb25zLCBvdGhlcndpc2UgcmVzb2x2ZSBpdCBmcm9tIG1haW5QYXRoIGFmdGVyIHByb2dyYW1cbiAgICAvLyBjcmVhdGlvbi5cbiAgICBpZiAodGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSB0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlO1xuICAgIH0gZWxzZSBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlIGFzIHN0cmluZyk7IC8vIHRlbXBvcmFyeSBjYXN0IGZvciB0eXBlIGlzc3VlXG4gICAgfVxuXG4gICAgLy8gU2V0IHBsYXRmb3JtLlxuICAgIHRoaXMuX3BsYXRmb3JtID0gb3B0aW9ucy5wbGF0Zm9ybSB8fCBQTEFURk9STS5Ccm93c2VyO1xuXG4gICAgLy8gTWFrZSB0cmFuc2Zvcm1lcnMuXG4gICAgdGhpcy5fbWFrZVRyYW5zZm9ybWVycygpO1xuXG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9zZXR1cE9wdGlvbnMnKTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldFRzUHJvZ3JhbSgpIHtcbiAgICByZXR1cm4gdGhpcy5fSml0TW9kZSA/IHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSA6ICh0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0pLmdldFRzUHJvZ3JhbSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZFRzRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiBrLmVuZHNXaXRoKCcudHMnKSAmJiAhay5lbmRzV2l0aCgnLmQudHMnKSlcbiAgICAgIC5maWx0ZXIoayA9PiB0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhrKSk7XG4gIH1cblxuICB1cGRhdGVDaGFuZ2VkRmlsZUV4dGVuc2lvbnMoZXh0ZW5zaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMuYWRkKGV4dGVuc2lvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgZXh0IG9mIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucykge1xuICAgICAgICAgIGlmIChrLmVuZHNXaXRoKGV4dCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBHZXQgdGhlIHJvb3QgZmlsZXMgZnJvbSB0aGUgdHMgY29uZmlnLlxuICAgICAgICAvLyBXaGVuIGEgbmV3IHJvb3QgbmFtZSAobGlrZSBhIGxhenkgcm91dGUpIGlzIGFkZGVkLCBpdCB3b24ndCBiZSBhdmFpbGFibGUgZnJvbVxuICAgICAgICAvLyBmb2xsb3dpbmcgaW1wb3J0cyBvbiB0aGUgZXhpc3RpbmcgZmlsZXMsIHNvIHdlIG5lZWQgdG8gZ2V0IHRoZSBuZXcgbGlzdCBvZiByb290IGZpbGVzLlxuICAgICAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgICAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzLmNvbmNhdCguLi50aGlzLl9zaW5nbGVGaWxlSW5jbHVkZXMpO1xuXG4gICAgICAgIC8vIFVwZGF0ZSB0aGUgZm9ya2VkIHR5cGUgY2hlY2tlciB3aXRoIGFsbCBjaGFuZ2VkIGNvbXBpbGF0aW9uIGZpbGVzLlxuICAgICAgICAvLyBUaGlzIGluY2x1ZGVzIHRlbXBsYXRlcywgdGhhdCBhbHNvIG5lZWQgdG8gYmUgcmVsb2FkZWQgb24gdGhlIHR5cGUgY2hlY2tlci5cbiAgICAgICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgIXRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgdGhpcy5fdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIodGhpcy5fcm9vdE5hbWVzLCB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpKTtcbiAgICAgICAgfVxuXG4gICAgICAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICAgICAgdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlID0gdHMuY3JlYXRlTW9kdWxlUmVzb2x1dGlvbkNhY2hlKHRoaXMuX2Jhc2VQYXRoLCB4ID0+IHgpO1xuXG4gICAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgLy8gQ3JlYXRlIHRoZSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgICAgIHRoaXMuX3Byb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICAgICAgdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtLFxuICAgICAgICAgICk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgICAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgcHJvZ3JhbS5cbiAgICAgICAgICB0aGlzLl9wcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgICAgICByb290TmFtZXM6IHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgICAgIG9sZFByb2dyYW06IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5sb2FkTmdTdHJ1Y3R1cmVBc3luYycpO1xuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3Byb2dyYW0ubG9hZE5nU3RydWN0dXJlQXN5bmMoKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5sb2FkTmdTdHJ1Y3R1cmVBc3luYycpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIElmIHRoZXJlJ3Mgc3RpbGwgbm8gZW50cnlNb2R1bGUgdHJ5IHRvIHJlc29sdmUgZnJvbSBtYWluUGF0aC5cbiAgICAgICAgaWYgKCF0aGlzLl9lbnRyeU1vZHVsZSAmJiB0aGlzLl9tYWluUGF0aCkge1xuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4oXG4gICAgICAgICAgICB0aGlzLl9tYWluUGF0aCwgdGhpcy5fY29tcGlsZXJIb3N0LCB0aGlzLl9nZXRUc1Byb2dyYW0oKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0TGF6eVJvdXRlc0Zyb21OZ3Rvb2xzKCkge1xuICAgIHRyeSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2dldExhenlSb3V0ZXNGcm9tTmd0b29scycpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gX19OR1RPT0xTX1BSSVZBVEVfQVBJXzIubGlzdExhenlSb3V0ZXMoe1xuICAgICAgICBwcm9ncmFtOiB0aGlzLl9nZXRUc1Byb2dyYW0oKSxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBhbmd1bGFyQ29tcGlsZXJPcHRpb25zOiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9jb21waWxlck9wdGlvbnMsIHtcbiAgICAgICAgICAvLyBnZW5EaXIgc2VlbXMgdG8gc3RpbGwgYmUgbmVlZGVkIGluIEBhbmd1bGFyXFxjb21waWxlci1jbGlcXHNyY1xcY29tcGlsZXJfaG9zdC5qczoyMjYuXG4gICAgICAgICAgZ2VuRGlyOiAnJyxcbiAgICAgICAgfSksXG4gICAgICAgIC8vIFRPRE86IGZpeCBjb21waWxlci1jbGkgdHlwaW5nczsgZW50cnlNb2R1bGUgc2hvdWxkIG5vdCBiZSBzdHJpbmcsIGJ1dCBhbHNvIG9wdGlvbmFsLlxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm9uLW51bGwtb3BlcmF0b3JcbiAgICAgICAgZW50cnlNb2R1bGU6IHRoaXMuX2VudHJ5TW9kdWxlICEsXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZ2V0TGF6eVJvdXRlc0Zyb21OZ3Rvb2xzJyk7XG5cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAvLyBXZSBzaWxlbmNlIHRoZSBlcnJvciB0aGF0IHRoZSBAYW5ndWxhci9yb3V0ZXIgY291bGQgbm90IGJlIGZvdW5kLiBJbiB0aGF0IGNhc2UsIHRoZXJlIGlzXG4gICAgICAvLyBiYXNpY2FsbHkgbm8gcm91dGUgc3VwcG9ydGVkIGJ5IHRoZSBhcHAgaXRzZWxmLlxuICAgICAgaWYgKGVyci5tZXNzYWdlLnN0YXJ0c1dpdGgoJ0NvdWxkIG5vdCByZXNvbHZlIG1vZHVsZSBAYW5ndWxhci9yb3V0ZXInKSkge1xuICAgICAgICByZXR1cm4ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZmluZExhenlSb3V0ZXNJbkFzdChjaGFuZ2VkRmlsZVBhdGhzOiBzdHJpbmdbXSk6IExhenlSb3V0ZU1hcCB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG4gICAgY29uc3QgcmVzdWx0OiBMYXp5Um91dGVNYXAgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIGZvciAoY29uc3QgZmlsZVBhdGggb2YgY2hhbmdlZEZpbGVQYXRocykge1xuICAgICAgY29uc3QgZmlsZUxhenlSb3V0ZXMgPSBmaW5kTGF6eVJvdXRlcyhmaWxlUGF0aCwgdGhpcy5fY29tcGlsZXJIb3N0LCB1bmRlZmluZWQsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyk7XG4gICAgICBmb3IgKGNvbnN0IHJvdXRlS2V5IG9mIE9iamVjdC5rZXlzKGZpbGVMYXp5Um91dGVzKSkge1xuICAgICAgICBjb25zdCByb3V0ZSA9IGZpbGVMYXp5Um91dGVzW3JvdXRlS2V5XTtcbiAgICAgICAgcmVzdWx0W3JvdXRlS2V5XSA9IHJvdXRlO1xuICAgICAgfVxuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2ZpbmRMYXp5Um91dGVzSW5Bc3QnKTtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIF9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCk6IExhenlSb3V0ZU1hcCB7XG4gICAgY29uc3QgbmdQcm9ncmFtID0gdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtO1xuICAgIGlmICghbmdQcm9ncmFtLmxpc3RMYXp5Um91dGVzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ19saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtIHdhcyBjYWxsZWQgd2l0aCBhbiBvbGQgcHJvZ3JhbS4nKTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXp5Um91dGVzID0gbmdQcm9ncmFtLmxpc3RMYXp5Um91dGVzKCk7XG5cbiAgICByZXR1cm4gbGF6eVJvdXRlcy5yZWR1Y2UoXG4gICAgICAoYWNjLCBjdXJyKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlZiA9IGN1cnIucm91dGU7XG4gICAgICAgIGlmIChyZWYgaW4gYWNjICYmIGFjY1tyZWZdICE9PSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICArIGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkOiBcIiR7cmVmfVwiIGlzIHVzZWQgaW4gMiBsb2FkQ2hpbGRyZW4sIGBcbiAgICAgICAgICAgICsgYGJ1dCB0aGV5IHBvaW50IHRvIGRpZmZlcmVudCBtb2R1bGVzIFwiKCR7YWNjW3JlZl19IGFuZCBgXG4gICAgICAgICAgICArIGBcIiR7Y3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRofVwiKS4gV2VicGFjayBjYW5ub3QgZGlzdGluZ3Vpc2ggb24gY29udGV4dCBhbmQgYFxuICAgICAgICAgICAgKyAnd291bGQgZmFpbCB0byBsb2FkIHRoZSBwcm9wZXIgb25lLicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBhY2NbcmVmXSA9IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aDtcblxuICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgfSxcbiAgICAgIHt9IGFzIExhenlSb3V0ZU1hcCxcbiAgICApO1xuICB9XG5cbiAgLy8gUHJvY2VzcyB0aGUgbGF6eSByb3V0ZXMgZGlzY292ZXJlZCwgYWRkaW5nIHRoZW4gdG8gX2xhenlSb3V0ZXMuXG4gIC8vIFRPRE86IGZpbmQgYSB3YXkgdG8gcmVtb3ZlIGxhenkgcm91dGVzIHRoYXQgZG9uJ3QgZXhpc3QgYW55bW9yZS5cbiAgLy8gVGhpcyB3aWxsIHJlcXVpcmUgYSByZWdpc3RyeSBvZiBrbm93biByZWZlcmVuY2VzIHRvIGEgbGF6eSByb3V0ZSwgcmVtb3ZpbmcgaXQgd2hlbiBub1xuICAvLyBtb2R1bGUgcmVmZXJlbmNlcyBpdCBhbnltb3JlLlxuICBwcml2YXRlIF9wcm9jZXNzTGF6eVJvdXRlcyhkaXNjb3ZlcmVkTGF6eVJvdXRlczogTGF6eVJvdXRlTWFwKSB7XG4gICAgT2JqZWN0LmtleXMoZGlzY292ZXJlZExhenlSb3V0ZXMpXG4gICAgICAuZm9yRWFjaChsYXp5Um91dGVLZXkgPT4ge1xuICAgICAgICBjb25zdCBbbGF6eVJvdXRlTW9kdWxlLCBtb2R1bGVOYW1lXSA9IGxhenlSb3V0ZUtleS5zcGxpdCgnIycpO1xuXG4gICAgICAgIGlmICghbGF6eVJvdXRlTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGF6eVJvdXRlVFNGaWxlID0gZGlzY292ZXJlZExhenlSb3V0ZXNbbGF6eVJvdXRlS2V5XS5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgICAgIGxldCBtb2R1bGVQYXRoOiBzdHJpbmcsIG1vZHVsZUtleTogc3RyaW5nO1xuXG4gICAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZTtcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9JHttb2R1bGVOYW1lID8gJyMnICsgbW9kdWxlTmFtZSA6ICcnfWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZS5yZXBsYWNlKC8oXFwuZCk/XFwudHMkLywgYC5uZ2ZhY3RvcnkuanNgKTtcbiAgICAgICAgICBjb25zdCBmYWN0b3J5TW9kdWxlTmFtZSA9IG1vZHVsZU5hbWUgPyBgIyR7bW9kdWxlTmFtZX1OZ0ZhY3RvcnlgIDogJyc7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfS5uZ2ZhY3Rvcnkke2ZhY3RvcnlNb2R1bGVOYW1lfWA7XG4gICAgICAgIH1cblxuICAgICAgICBtb2R1bGVQYXRoID0gd29ya2Fyb3VuZFJlc29sdmUobW9kdWxlUGF0aCk7XG5cbiAgICAgICAgaWYgKG1vZHVsZUtleSBpbiB0aGlzLl9sYXp5Um91dGVzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSAhPT0gbW9kdWxlUGF0aCkge1xuICAgICAgICAgICAgLy8gRm91bmQgYSBkdXBsaWNhdGUsIHRoaXMgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQgZHVyaW5nIGEgcmVidWlsZC4gYFxuICAgICAgICAgICAgICAgICsgYFdlIHdpbGwgdGFrZSB0aGUgbGF0ZXN0IHZlcnNpb24gZGV0ZWN0ZWQgYW5kIG92ZXJyaWRlIGl0IHRvIHNhdmUgcmVidWlsZCB0aW1lLiBgXG4gICAgICAgICAgICAgICAgKyBgWW91IHNob3VsZCBwZXJmb3JtIGEgZnVsbCBidWlsZCB0byB2YWxpZGF0ZSB0aGF0IHlvdXIgcm91dGVzIGRvbid0IG92ZXJsYXAuYCksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGb3VuZCBhIG5ldyByb3V0ZSwgYWRkIGl0IHRvIHRoZSBtYXAuXG4gICAgICAgICAgdGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldID0gbW9kdWxlUGF0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICAvLyBCb290c3RyYXAgdHlwZSBjaGVja2VyIGlzIHVzaW5nIGxvY2FsIENMSS5cbiAgICBjb25zdCBnOiBhbnkgPSB0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJyA/IGdsb2JhbCA6IHt9OyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICBjb25zdCB0eXBlQ2hlY2tlckZpbGU6IHN0cmluZyA9IGdbJ19EZXZLaXRJc0xvY2FsJ11cbiAgICAgID8gJy4vdHlwZV9jaGVja2VyX2Jvb3RzdHJhcC5qcydcbiAgICAgIDogJy4vdHlwZV9jaGVja2VyX3dvcmtlci5qcyc7XG5cbiAgICBjb25zdCBkZWJ1Z0FyZ1JlZ2V4ID0gLy0taW5zcGVjdCg/Oi1icmt8LXBvcnQpP3wtLWRlYnVnKD86LWJya3wtcG9ydCkvO1xuXG4gICAgY29uc3QgZXhlY0FyZ3YgPSBwcm9jZXNzLmV4ZWNBcmd2LmZpbHRlcigoYXJnKSA9PiB7XG4gICAgICAvLyBSZW1vdmUgZGVidWcgYXJncy5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvOTQzNVxuICAgICAgcmV0dXJuICFkZWJ1Z0FyZ1JlZ2V4LnRlc3QoYXJnKTtcbiAgICB9KTtcbiAgICAvLyBTaWduYWwgdGhlIHByb2Nlc3MgdG8gc3RhcnQgbGlzdGVuaW5nIGZvciBtZXNzYWdlc1xuICAgIC8vIFNvbHZlcyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvOTA3MVxuICAgIGNvbnN0IGZvcmtBcmdzID0gW0FVVE9fU1RBUlRfQVJHXTtcbiAgICBjb25zdCBmb3JrT3B0aW9uczogRm9ya09wdGlvbnMgPSB7IGV4ZWNBcmd2IH07XG5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBmb3JrKFxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgdHlwZUNoZWNrZXJGaWxlKSxcbiAgICAgIGZvcmtBcmdzLFxuICAgICAgZm9ya09wdGlvbnMpO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIHByb2Nlc3MgZXhpdC5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub25jZSgnZXhpdCcsIChfLCBzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG5cbiAgICAgIC8vIElmIHByb2Nlc3MgZXhpdGVkIG5vdCBiZWNhdXNlIG9mIFNJR1RFUk0gKHNlZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKSwgdGhhbiBzb21ldGhpbmdcbiAgICAgIC8vIHdlbnQgd3JvbmcgYW5kIGl0IHNob3VsZCBmYWxsYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIHRoZSBtYWluIHRocmVhZC5cbiAgICAgIGlmIChzaWduYWwgIT09ICdTSUdURVJNJykge1xuICAgICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbXNnID0gJ0FuZ3VsYXJDb21waWxlclBsdWdpbjogRm9ya2VkIFR5cGUgQ2hlY2tlciBleGl0ZWQgdW5leHBlY3RlZGx5LiAnICtcbiAgICAgICAgICAnRmFsbGluZyBiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gbWFpbiB0aHJlYWQuJztcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCkge1xuICAgICAgdHJlZUtpbGwodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCwgJ1NJR1RFUk0nKTtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgaWYgKCF0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkKSB7XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcykpO1xuICAgICAgICB0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBVcGRhdGVNZXNzYWdlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RyYXRpb24gaG9vayBmb3Igd2VicGFjayBwbHVnaW4uXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgYXBwbHkoY29tcGlsZXI6IGFueSkge1xuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSA9IG5ldyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtLCB0aGlzLl9jb21waWxlckhvc3QpO1xuICAgICAgY29tcGlsZXIud2F0Y2hGaWxlU3lzdGVtID0gbmV3IFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IoY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBsYXp5IG1vZHVsZXMgdG8gdGhlIGNvbnRleHQgbW9kdWxlIGZvciBAYW5ndWxhci9jb3JlXG4gICAgY29tcGlsZXIuaG9va3MuY29udGV4dE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKGNtZjogYW55KSA9PiB7XG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVBhY2thZ2VQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb3JlL3BhY2thZ2UuanNvbicpO1xuXG4gICAgICAvLyBBUEZ2NiBkb2VzIG5vdCBoYXZlIHNpbmdsZSBGRVNNIGFueW1vcmUuIEluc3RlYWQgb2YgdmVyaWZ5aW5nIGlmIHdlJ3JlIHBvaW50aW5nIHRvXG4gICAgICAvLyBGRVNNcywgd2UgcmVzb2x2ZSB0aGUgYEBhbmd1bGFyL2NvcmVgIHBhdGggYW5kIHZlcmlmeSB0aGF0IHRoZSBwYXRoIGZvciB0aGVcbiAgICAgIC8vIG1vZHVsZSBzdGFydHMgd2l0aCBpdC5cblxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVEaXJuYW1lID0gZnMucmVhbHBhdGhTeW5jKHBhdGguZGlybmFtZShhbmd1bGFyQ29yZVBhY2thZ2VQYXRoKSk7XG5cbiAgICAgIGNtZi5ob29rcy5hZnRlclJlc29sdmUudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgKHJlc3VsdDogYW55LCBjYWxsYmFjazogKGVycj86IEVycm9yLCByZXF1ZXN0PzogYW55KSA9PiB2b2lkKSA9PiB7XG4gICAgICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHRlciBvbmx5IHJlcXVlc3QgZnJvbSBBbmd1bGFyLlxuICAgICAgICBpZiAoIXJlc3VsdC5yZXNvdXJjZS5zdGFydHNXaXRoKGFuZ3VsYXJDb3JlRGlybmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5kb25lKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZG9uZS50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGlzIGZvbGRlciBkb2VzIG5vdCBleGlzdCwgYnV0IHdlIG5lZWQgdG8gZ2l2ZSB3ZWJwYWNrIGEgcmVzb3VyY2UuXG4gICAgICAgICAgLy8gVE9ETzogY2hlY2sgaWYgd2UgY2FuJ3QganVzdCBsZWF2ZSBpdCBhcyBpcyAoYW5ndWxhckNvcmVNb2R1bGVEaXIpLlxuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICByZXN1bHQuZGVwZW5kZW5jaWVzLmZvckVhY2goKGQ6IGFueSkgPT4gZC5jcml0aWNhbCA9IGZhbHNlKTtcbiAgICAgICAgICByZXN1bHQucmVzb2x2ZURlcGVuZGVuY2llcyA9IChfZnM6IGFueSwgcmVzb3VyY2VPck9wdGlvbnM6IGFueSwgcmVjdXJzaXZlT3JDYWxsYmFjazogYW55LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9yZWdFeHA6IFJlZ0V4cCwgY2I6IGFueSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gT2JqZWN0LmtleXModGhpcy5fbGF6eVJvdXRlcylcbiAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlUGF0aCA9IHRoaXMuX2xhenlSb3V0ZXNba2V5XTtcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRQYXRoID0ga2V5LnNwbGl0KCcjJylbMF07XG4gICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSBpbXBvcnRQYXRoLnJlcGxhY2UoLyhcXC5uZ2ZhY3RvcnkpP1xcLihqc3x0cykkLywgJycpO1xuXG4gICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeShtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAuZmlsdGVyKHggPT4gISF4KTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHJlY3Vyc2l2ZU9yQ2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgLy8gV2VicGFjayA0IG9ubHkgaGFzIDMgcGFyYW1ldGVyc1xuICAgICAgICAgICAgICBjYiA9IHJlY3Vyc2l2ZU9yQ2FsbGJhY2s7XG4gICAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLm5hbWVMYXp5RmlsZXMpIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZU9yT3B0aW9ucy5jaHVua05hbWUgPSAnW3JlcXVlc3RdJztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2IobnVsbCwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KTtcbiAgICAgICAgfSwgKCkgPT4gY2FsbGJhY2soKSlcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IGNhbGxiYWNrKGVycikpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYW5kIGRlc3Ryb3kgZm9ya2VkIHR5cGUgY2hlY2tlciBvbiB3YXRjaCBtb2RlLlxuICAgIGNvbXBpbGVyLmhvb2tzLndhdGNoUnVuLnRhcEFzeW5jKCdhbmd1bGFyLWNvbXBpbGVyJywgKF9jb21waWxlcjogYW55LCBjYWxsYmFjazogYW55KSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hDbG9zZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSk7XG5cbiAgICAvLyBSZW1ha2UgdGhlIHBsdWdpbiBvbiBlYWNoIGNvbXBpbGF0aW9uLlxuICAgIGNvbXBpbGVyLmhvb2tzLm1ha2UudGFwQXN5bmMoXG4gICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAoY29tcGlsYXRpb246IGFueSwgY2I6IGFueSkgPT4gdGhpcy5fbWFrZShjb21waWxhdGlvbiwgY2IpLFxuICAgICk7XG4gICAgY29tcGlsZXIuaG9va3MuaW52YWxpZC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9maXJzdFJ1biA9IGZhbHNlKTtcbiAgICBjb21waWxlci5ob29rcy5hZnRlckVtaXQudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAoY29tcGlsYXRpb246IGFueSwgY2I6IGFueSkgPT4ge1xuICAgICAgY29tcGlsYXRpb24uX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSBudWxsO1xuICAgICAgY2IoKTtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIChjb21waWxlcjogYW55KSA9PiB7XG4gICAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIChubWY6IGFueSkgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcEFzeW5jKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlcXVlc3Q6IGFueSwgY2FsbGJhY2s6IGFueSkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgKHJlcXVlc3QucmVxdWVzdC5lbmRzV2l0aCgnLnRzJylcbiAgICAgICAgICAgICAgfHwgKHJlcXVlc3QuY29udGV4dC5pc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChyZXF1ZXN0LmNvbnRleHQuaXNzdWVyKSkpKSB7XG4gICAgICAgICAgICB0aGlzLmRvbmUudGhlbigoKSA9PiBjYWxsYmFjayhudWxsLCByZXF1ZXN0KSwgKCkgPT4gY2FsbGJhY2sobnVsbCwgcmVxdWVzdCkpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIChubWY6IGFueSkgPT4ge1xuICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVxdWVzdDogYW55LCBjYWxsYmFjazogYW55KSA9PiB7XG4gICAgICAgIHJlc29sdmVXaXRoUGF0aHMoXG4gICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZShjb21waWxhdGlvbjogYW55LCBjYjogKGVycj86IGFueSwgcmVxdWVzdD86IGFueSkgPT4gdm9pZCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICBpZiAoY29tcGlsYXRpb24uX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UpIHtcbiAgICAgIHJldHVybiBjYihuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJykpO1xuICAgIH1cblxuICAgIC8vIFNldCBhIHByaXZhdGUgdmFyaWFibGUgZm9yIHRoaXMgcGx1Z2luIGluc3RhbmNlLlxuICAgIGNvbXBpbGF0aW9uLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbik7XG5cbiAgICB0aGlzLl9kb25lUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl91cGRhdGUoKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UnKTtcbiAgICAgICAgY2IoKTtcbiAgICAgIH0sIChlcnI6IGFueSkgPT4ge1xuICAgICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgICAgICBjYigpO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbjogYW55KSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSAoXG4gICAgICB0aGlzLl9tYWluUGF0aCA/IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuX21haW5QYXRoKSA6IHRoaXMuX21haW5QYXRoXG4gICAgKTtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGVcbiAgICAgID8geyBwYXRoOiB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpLCBjbGFzc05hbWU6IHRoaXMuZW50cnlNb2R1bGUuY2xhc3NOYW1lIH1cbiAgICAgIDogdGhpcy5lbnRyeU1vZHVsZTtcbiAgICBjb25zdCBnZXRMYXp5Um91dGVzID0gKCkgPT4gdGhpcy5fbGF6eVJvdXRlcztcbiAgICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+IHRoaXMuX2dldFRzUHJvZ3JhbSgpLmdldFR5cGVDaGVja2VyKCk7XG5cbiAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgLy8gUmVwbGFjZSByZXNvdXJjZXMgaW4gSklULlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZVJlc291cmNlcyhpc0FwcFBhdGgpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gUmVtb3ZlIHVubmVlZGVkIGFuZ3VsYXIgZGVjb3JhdG9ycy5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlbW92ZURlY29yYXRvcnMoaXNBcHBQYXRoLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uQnJvd3Nlcikge1xuICAgICAgLy8gSWYgd2UgaGF2ZSBhIGxvY2FsZSwgYXV0byBpbXBvcnQgdGhlIGxvY2FsZSBkYXRhIGZpbGUuXG4gICAgICAvLyBUaGlzIHRyYW5zZm9ybSBtdXN0IGdvIGJlZm9yZSByZXBsYWNlQm9vdHN0cmFwIGJlY2F1c2UgaXQgbG9va3MgZm9yIHRoZSBlbnRyeSBtb2R1bGVcbiAgICAgIC8vIGltcG9ydCwgd2hpY2ggd2lsbCBiZSByZXBsYWNlZC5cbiAgICAgIGlmICh0aGlzLl9ub3JtYWxpemVkTG9jYWxlKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlZ2lzdGVyTG9jYWxlRGF0YShpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIC8vIFJlcGxhY2UgYm9vdHN0cmFwIGluIGJyb3dzZXIgQU9ULlxuICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZXBsYWNlQm9vdHN0cmFwKGlzQXBwUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uU2VydmVyKSB7XG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChleHBvcnRMYXp5TW9kdWxlTWFwKGlzTWFpblBhdGgsIGdldExhenlSb3V0ZXMpKTtcbiAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChcbiAgICAgICAgICBleHBvcnROZ0ZhY3RvcnkoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUpLFxuICAgICAgICAgIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlKCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgLy8gV2Ugb25seSB3YW50IHRvIHVwZGF0ZSBvbiBUUyBhbmQgdGVtcGxhdGUgY2hhbmdlcywgYnV0IGFsbCBraW5kcyBvZiBmaWxlcyBhcmUgb24gdGhpc1xuICAgIC8vIGxpc3QsIGxpa2UgcGFja2FnZS5qc29uIGFuZCAubmdzdW1tYXJ5Lmpzb24gZmlsZXMuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKTtcblxuICAgIC8vIElmIG5vdGhpbmcgd2UgY2FyZSBhYm91dCBjaGFuZ2VkIGFuZCBpdCBpc24ndCB0aGUgZmlyc3QgcnVuLCBkb24ndCBkbyBhbnl0aGluZy5cbiAgICBpZiAoY2hhbmdlZEZpbGVzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgICAvLyBUcnkgdG8gZmluZCBsYXp5IHJvdXRlcyBpZiB3ZSBoYXZlIGFuIGVudHJ5IG1vZHVsZS5cbiAgICAgICAgICAvLyBXZSBuZWVkIHRvIHJ1biB0aGUgYGxpc3RMYXp5Um91dGVzYCB0aGUgZmlyc3QgdGltZSBiZWNhdXNlIGl0IGFsc28gbmF2aWdhdGVzIGxpYnJhcmllc1xuICAgICAgICAgIC8vIGFuZCBvdGhlciB0aGluZ3MgdGhhdCB3ZSBtaWdodCBtaXNzIHVzaW5nIHRoZSAoZmFzdGVyKSBmaW5kTGF6eVJvdXRlc0luQXN0LlxuICAgICAgICAgIC8vIExhenkgcm91dGVzIG1vZHVsZXMgd2lsbCBiZSByZWFkIHdpdGggY29tcGlsZXJIb3N0IGFuZCBhZGRlZCB0byB0aGUgY2hhbmdlZCBmaWxlcy5cbiAgICAgICAgICBjb25zdCBjaGFuZ2VkVHNGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRUc0ZpbGVzKCk7XG4gICAgICAgICAgaWYgKHRoaXMuX25nQ29tcGlsZXJTdXBwb3J0c05ld0FwaSkge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMoKSk7XG4gICAgICAgICAgfSBlbHNlIGlmIChjaGFuZ2VkVHNGaWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRUc0ZpbGVzKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcykge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gRW1pdCBhbmQgcmVwb3J0IGVycm9ycy5cblxuICAgICAgICAvLyBXZSBub3cgaGF2ZSB0aGUgZmluYWwgbGlzdCBvZiBjaGFuZ2VkIFRTIGZpbGVzLlxuICAgICAgICAvLyBHbyB0aHJvdWdoIGVhY2ggY2hhbmdlZCBmaWxlIGFuZCBhZGQgdHJhbnNmb3JtcyBhcyBuZWVkZWQuXG4gICAgICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKVxuICAgICAgICAgIC5tYXAoKGZpbGVOYW1lKSA9PiB0aGlzLl9nZXRUc1Byb2dyYW0oKS5nZXRTb3VyY2VGaWxlKGZpbGVOYW1lKSlcbiAgICAgICAgICAvLyBBdCB0aGlzIHBvaW50IHdlIHNob3VsZG4ndCBuZWVkIHRvIGZpbHRlciBvdXQgdW5kZWZpbmVkIGZpbGVzLCBiZWNhdXNlIGFueSB0cyBmaWxlXG4gICAgICAgICAgLy8gdGhhdCBjaGFuZ2VkIHNob3VsZCBiZSBlbWl0dGVkLlxuICAgICAgICAgIC8vIEJ1dCBkdWUgdG8gaG9zdFJlcGxhY2VtZW50UGF0aHMgdGhlcmUgY2FuIGJlIGZpbGVzICh0aGUgZW52aXJvbm1lbnQgZmlsZXMpXG4gICAgICAgICAgLy8gdGhhdCBjaGFuZ2VkIGJ1dCBhcmVuJ3QgcGFydCBvZiB0aGUgY29tcGlsYXRpb24sIHNwZWNpYWxseSBvbiBgbmcgdGVzdGAuXG4gICAgICAgICAgLy8gU28gd2UgaWdub3JlIG1pc3Npbmcgc291cmNlIGZpbGVzIGZpbGVzIGhlcmUuXG4gICAgICAgICAgLy8gaG9zdFJlcGxhY2VtZW50UGF0aHMgbmVlZHMgdG8gYmUgZml4ZWQgYW55d2F5IHRvIHRha2UgY2FyZSBvZiB0aGUgZm9sbG93aW5nIGlzc3VlLlxuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy83MzA1I2lzc3VlY29tbWVudC0zMzIxNTAyMzBcbiAgICAgICAgICAuZmlsdGVyKCh4KSA9PiAhIXgpIGFzIHRzLlNvdXJjZUZpbGVbXTtcblxuICAgICAgICAvLyBFbWl0IGZpbGVzLlxuICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZS5fZW1pdCcpO1xuICAgICAgICBjb25zdCB7IGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzIH0gPSB0aGlzLl9lbWl0KHNvdXJjZUZpbGVzKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcblxuICAgICAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgICAgIGNvbnN0IGVycm9ycyA9IGRpYWdub3N0aWNzXG4gICAgICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yKTtcbiAgICAgICAgY29uc3Qgd2FybmluZ3MgPSBkaWFnbm9zdGljc1xuICAgICAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgICAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3MoZXJyb3JzKTtcbiAgICAgICAgICB0aGlzLl9lcnJvcnMucHVzaChuZXcgRXJyb3IobWVzc2FnZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3Mod2FybmluZ3MpO1xuICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobWVzc2FnZSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9lbWl0U2tpcHBlZCA9ICFlbWl0UmVzdWx0IHx8IGVtaXRSZXN1bHQuZW1pdFNraXBwZWQ7XG5cbiAgICAgICAgLy8gUmVzZXQgY2hhbmdlZCBmaWxlcyBvbiBzdWNjZXNzZnVsIGNvbXBpbGF0aW9uLlxuICAgICAgICBpZiAoIXRoaXMuX2VtaXRTa2lwcGVkICYmIHRoaXMuX2Vycm9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3QucmVzZXRDaGFuZ2VkRmlsZVRyYWNrZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICAgICAgfSk7XG4gIH1cblxuICB3cml0ZUkxOG5PdXRGaWxlKCkge1xuICAgIGZ1bmN0aW9uIF9yZWN1cnNpdmVNa0RpcihwOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKHApKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKHApKVxuICAgICAgICAgIC50aGVuKCgpID0+IGZzLm1rZGlyU3luYyhwKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgdGhlIGV4dHJhY3RlZCBtZXNzYWdlcyB0byBkaXNrLlxuICAgIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpIHtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCwgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKTtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlQ29udGVudCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShpMThuT3V0RmlsZVBhdGgpO1xuICAgICAgaWYgKGkxOG5PdXRGaWxlQ29udGVudCkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKGkxOG5PdXRGaWxlUGF0aCkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gZnMud3JpdGVGaWxlU3luYyhpMThuT3V0RmlsZVBhdGgsIGkxOG5PdXRGaWxlQ29udGVudCkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldENvbXBpbGVkRmlsZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZSA9IGZpbGVOYW1lLnJlcGxhY2UoLy50cyQvLCAnLmpzJyk7XG4gICAgbGV0IG91dHB1dFRleHQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlTWFwOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGVycm9yRGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKHRoaXMuX2VtaXRTa2lwcGVkKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgLy8gSWYgdGhlIGNvbXBpbGF0aW9uIGRpZG4ndCBlbWl0IGZpbGVzIHRoaXMgdGltZSwgdHJ5IHRvIHJldHVybiB0aGUgY2FjaGVkIGZpbGVzIGZyb20gdGhlXG4gICAgICAgIC8vIGxhc3QgY29tcGlsYXRpb24gYW5kIGxldCB0aGUgY29tcGlsYXRpb24gZXJyb3JzIHNob3cgd2hhdCdzIHdyb25nLlxuICAgICAgICBvdXRwdXRUZXh0ID0gdGV4dDtcbiAgICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlcmUncyBub3RoaW5nIHdlIGNhbiBzZXJ2ZS4gUmV0dXJuIGFuIGVtcHR5IHN0cmluZyB0byBwcmV2ZW50IGxlbmdodHkgd2VicGFjayBlcnJvcnMsXG4gICAgICAgIC8vIGFkZCB0aGUgcmVidWlsZCB3YXJuaW5nIGlmIGl0J3Mgbm90IHRoZXJlIHlldC5cbiAgICAgICAgLy8gV2UgYWxzbyBuZWVkIHRvIGFsbCBjaGFuZ2VkIGZpbGVzIGFzIGRlcGVuZGVuY2llcyBvZiB0aGlzIGZpbGUsIHNvIHRoYXQgYWxsIG9mIHRoZW1cbiAgICAgICAgLy8gd2lsbCBiZSB3YXRjaGVkIGFuZCB0cmlnZ2VyIGEgcmVidWlsZCBuZXh0IHRpbWUuXG4gICAgICAgIG91dHB1dFRleHQgPSAnJztcbiAgICAgICAgZXJyb3JEZXBlbmRlbmNpZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpXG4gICAgICAgICAgLy8gVGhlc2UgcGF0aHMgYXJlIHVzZWQgYnkgdGhlIGxvYWRlciBzbyB3ZSBtdXN0IGRlbm9ybWFsaXplIHRoZW0uXG4gICAgICAgICAgLm1hcCgocCkgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBUUyBpbnB1dCBmaWxlIGFuZCB0aGUgSlMgb3V0cHV0IGZpbGUgZXhpc3QuXG4gICAgICBpZiAoKGZpbGVOYW1lLmVuZHNXaXRoKCcudHMnKSAmJiAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoZmlsZU5hbWUsIGZhbHNlKSlcbiAgICAgICAgfHwgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKG91dHB1dEZpbGUsIGZhbHNlKSkge1xuICAgICAgICBsZXQgbXNnID0gYCR7ZmlsZU5hbWV9IGlzIG1pc3NpbmcgZnJvbSB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbi4gYFxuICAgICAgICAgICsgYFBsZWFzZSBtYWtlIHN1cmUgaXQgaXMgaW4geW91ciB0c2NvbmZpZyB2aWEgdGhlICdmaWxlcycgb3IgJ2luY2x1ZGUnIHByb3BlcnR5LmA7XG5cbiAgICAgICAgaWYgKC8oXFxcXHxcXC8pbm9kZV9tb2R1bGVzKFxcXFx8XFwvKS8udGVzdChmaWxlTmFtZSkpIHtcbiAgICAgICAgICBtc2cgKz0gJ1xcblRoZSBtaXNzaW5nIGZpbGUgc2VlbXMgdG8gYmUgcGFydCBvZiBhIHRoaXJkIHBhcnR5IGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1RTIGZpbGVzIGluIHB1Ymxpc2hlZCBsaWJyYXJpZXMgYXJlIG9mdGVuIGEgc2lnbiBvZiBhIGJhZGx5IHBhY2thZ2VkIGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1BsZWFzZSBvcGVuIGFuIGlzc3VlIGluIHRoZSBsaWJyYXJ5IHJlcG9zaXRvcnkgdG8gYWxlcnQgaXRzIGF1dGhvciBhbmQgYXNrIHRoZW0gJ1xuICAgICAgICAgICAgKyAndG8gcGFja2FnZSB0aGUgbGlicmFyeSB1c2luZyB0aGUgQW5ndWxhciBQYWNrYWdlIEZvcm1hdCAoaHR0cHM6Ly9nb28uZ2wvakIzR1Z2KS4nO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9XG5cbiAgICAgIG91dHB1dFRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSkgfHwgJyc7XG4gICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgb3V0cHV0VGV4dCwgc291cmNlTWFwLCBlcnJvckRlcGVuZGVuY2llcyB9O1xuICB9XG5cbiAgZ2V0RGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVzb2x2ZWRGaWxlTmFtZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKGZpbGVOYW1lKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5fY29tcGlsZXJIb3N0LmdldFNvdXJjZUZpbGUocmVzb2x2ZWRGaWxlTmFtZSwgdHMuU2NyaXB0VGFyZ2V0LkxhdGVzdCk7XG4gICAgaWYgKCFzb3VyY2VGaWxlKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucztcbiAgICBjb25zdCBob3N0ID0gdGhpcy5fY29tcGlsZXJIb3N0O1xuICAgIGNvbnN0IGNhY2hlID0gdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuXG4gICAgY29uc3QgZXNJbXBvcnRzID0gY29sbGVjdERlZXBOb2Rlczx0cy5JbXBvcnREZWNsYXJhdGlvbj4oc291cmNlRmlsZSxcbiAgICAgIHRzLlN5bnRheEtpbmQuSW1wb3J0RGVjbGFyYXRpb24pXG4gICAgICAubWFwKGRlY2wgPT4ge1xuICAgICAgICBjb25zdCBtb2R1bGVOYW1lID0gKGRlY2wubW9kdWxlU3BlY2lmaWVyIGFzIHRzLlN0cmluZ0xpdGVyYWwpLnRleHQ7XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUobW9kdWxlTmFtZSwgcmVzb2x2ZWRGaWxlTmFtZSwgb3B0aW9ucywgaG9zdCwgY2FjaGUpO1xuXG4gICAgICAgIGlmIChyZXNvbHZlZC5yZXNvbHZlZE1vZHVsZSkge1xuICAgICAgICAgIHJldHVybiByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmZpbHRlcih4ID0+IHgpO1xuXG4gICAgY29uc3QgcmVzb3VyY2VJbXBvcnRzID0gZmluZFJlc291cmNlcyhzb3VyY2VGaWxlKVxuICAgICAgLm1hcCgocmVzb3VyY2VSZXBsYWNlbWVudCkgPT4gcmVzb3VyY2VSZXBsYWNlbWVudC5yZXNvdXJjZVBhdGhzKVxuICAgICAgLnJlZHVjZSgocHJldiwgY3VycikgPT4gcHJldi5jb25jYXQoY3VyciksIFtdKVxuICAgICAgLm1hcCgocmVzb3VyY2VQYXRoKSA9PiBwYXRoLnJlc29sdmUocGF0aC5kaXJuYW1lKHJlc29sdmVkRmlsZU5hbWUpLCByZXNvdXJjZVBhdGgpKTtcblxuICAgIC8vIFRoZXNlIHBhdGhzIGFyZSBtZWFudCB0byBiZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgIGNvbnN0IHVuaXF1ZURlcGVuZGVuY2llcyA9ICBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMocmVzb2x2ZWRGaWxlTmFtZSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8vIFRoaXMgY29kZSBtb3N0bHkgY29tZXMgZnJvbSBgcGVyZm9ybUNvbXBpbGF0aW9uYCBpbiBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYC5cbiAgLy8gSXQgc2tpcHMgdGhlIHByb2dyYW0gY3JlYXRpb24gYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZSBgbG9hZE5nU3RydWN0dXJlQXN5bmMoKWAsXG4gIC8vIGFuZCB1c2VzIEN1c3RvbVRyYW5zZm9ybWVycy5cbiAgcHJpdmF0ZSBfZW1pdChzb3VyY2VGaWxlczogdHMuU291cmNlRmlsZVtdKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG4gICAgY29uc3QgcHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW07XG4gICAgY29uc3QgYWxsRGlhZ25vc3RpY3M6IEFycmF5PHRzLkRpYWdub3N0aWMgfCBEaWFnbm9zdGljPiA9IFtdO1xuXG4gICAgbGV0IGVtaXRSZXN1bHQ6IHRzLkVtaXRSZXN1bHQgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHByb2dyYW0gYXMgdHMuUHJvZ3JhbTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4udHNQcm9ncmFtLmdldE9wdGlvbnNEaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgc291cmNlRmlsZXMuZm9yRWFjaCgoc2YpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzZi5maWxlTmFtZX0rLmVtaXRgO1xuICAgICAgICAgICAgdGltZSh0aW1lTGFiZWwpO1xuICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KHNmLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICAgIHRpbWVFbmQodGltZUxhYmVsKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBwcm9ncmFtIGFzIFByb2dyYW07XG5cbiAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBzdHJ1Y3R1cmFsIGRpYWdub3N0aWNzLlxuICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcygpKTtcbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgVHlwZVNjcmlwdCBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldFRzT3B0aW9uRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXROZ09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpICYmIHRoaXMuX3Byb2dyYW0pIHtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmdhdGhlckRpYWdub3N0aWNzKHRoaXMuX3Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nJykpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=