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
        const isMainPath = (fileName) => fileName === this._mainPath;
        const getEntryModule = () => this.entryModule;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFXQSxpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFDakMsMkNBQTRDO0FBQzVDLG1EQUFzRDtBQUN0RCxxREFBOEQ7QUFDOUQsNkRBQW9FO0FBQ3BFLCtDQUE2RDtBQUM3RCwrQ0FnQnVCO0FBQ3ZCLGlEQUFrRDtBQUNsRCx1REFBMEQ7QUFDMUQsaURBU3dCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFBNEU7QUFDNUUsbUZBR3lDO0FBR3pDLE1BQU0sd0JBQXdCLEdBQUcsT0FBTyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7QUFDOUYsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBb0N0QyxJQUFZLFFBR1g7QUFIRCxXQUFZLFFBQVE7SUFDbEIsNkNBQU8sQ0FBQTtJQUNQLDJDQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsUUFBUSxHQUFSLGdCQUFRLEtBQVIsZ0JBQVEsUUFHbkI7QUFFRDtJQTJDRSxZQUFZLE9BQXFDO1FBckN6Qyx3QkFBbUIsR0FBYSxFQUFFLENBQUM7UUFLM0MsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBRTNELGFBQVEsR0FBRyxLQUFLLENBQUM7UUFDakIsaUJBQVksR0FBRyxJQUFJLENBQUM7UUFDcEIsMkJBQXNCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFFaEUsa0JBQWtCO1FBQ1YsY0FBUyxHQUFHLElBQUksQ0FBQztRQUdqQixj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QUFZLENBQUM7Z0JBQ3hCLENBQUM7Z0JBQUMsSUFBSSxDQUFDLENBQUM7b0JBQ04sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsNkRBQTZEO3dCQUMvRSw0QkFBNEIsTUFBTSxLQUFLO3dCQUN2QyxzQkFBc0IsTUFBTTtrRUFDMEIsQ0FBQyxDQUFDO29CQUUxRCxNQUFNLENBQUMsSUFBSSxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQztRQUVELE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBci9CRCxzREFxL0JDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuLy8gVE9ETzogZml4IHdlYnBhY2sgdHlwaW5ncy5cbi8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1nbG9iYWwtdHNsaW50LWRpc2FibGVcbi8vIHRzbGludDpkaXNhYmxlOm5vLWFueVxuaW1wb3J0IHsgdmlydHVhbEZzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBGb3JrT3B0aW9ucywgZm9yayB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgdGltZSwgdGltZUVuZCB9IGZyb20gJy4vYmVuY2htYXJrJztcbmltcG9ydCB7IFdlYnBhY2tDb21waWxlckhvc3QgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4gfSBmcm9tICcuL2VudHJ5X3Jlc29sdmVyJztcbmltcG9ydCB7IGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBMYXp5Um91dGVNYXAsIGZpbmRMYXp5Um91dGVzIH0gZnJvbSAnLi9sYXp5X3JvdXRlcyc7XG5pbXBvcnQge1xuICBDb21waWxlckNsaUlzU3VwcG9ydGVkLFxuICBDb21waWxlckhvc3QsXG4gIENvbXBpbGVyT3B0aW9ucyxcbiAgREVGQVVMVF9FUlJPUl9DT0RFLFxuICBEaWFnbm9zdGljLFxuICBFbWl0RmxhZ3MsXG4gIFByb2dyYW0sXG4gIFNPVVJDRSxcbiAgVU5LTk9XTl9FUlJPUl9DT0RFLFxuICBWRVJTSU9OLFxuICBfX05HVE9PTFNfUFJJVkFURV9BUElfMixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJy4vbmd0b29sc19hcGknO1xuaW1wb3J0IHsgcmVzb2x2ZVdpdGhQYXRocyB9IGZyb20gJy4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7XG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHsgQVVUT19TVEFSVF9BUkcsIEluaXRNZXNzYWdlLCBVcGRhdGVNZXNzYWdlIH0gZnJvbSAnLi90eXBlX2NoZWNrZXInO1xuaW1wb3J0IHtcbiAgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG4gIFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG59IGZyb20gJy4vdmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3InO1xuXG5cbmNvbnN0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSA9IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cblxuLyoqXG4gKiBPcHRpb24gQ29uc3RhbnRzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucyB7XG4gIHNvdXJjZU1hcD86IGJvb2xlYW47XG4gIHRzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBiYXNlUGF0aD86IHN0cmluZztcbiAgZW50cnlNb2R1bGU/OiBzdHJpbmc7XG4gIG1haW5QYXRoPzogc3RyaW5nO1xuICBza2lwQ29kZUdlbmVyYXRpb24/OiBib29sZWFuO1xuICBob3N0UmVwbGFjZW1lbnRQYXRocz86IHsgW3BhdGg6IHN0cmluZ106IHN0cmluZyB9O1xuICBmb3JrVHlwZUNoZWNrZXI/OiBib29sZWFuO1xuICAvLyBUT0RPOiByZW1vdmUgc2luZ2xlRmlsZUluY2x1ZGVzIGZvciAyLjAsIHRoaXMgaXMganVzdCB0byBzdXBwb3J0IG9sZCBwcm9qZWN0cyB0aGF0IGRpZCBub3RcbiAgLy8gaW5jbHVkZSAncG9seWZpbGxzLnRzJyBpbiBgdHNjb25maWcuc3BlYy5qc29uJy5cbiAgc2luZ2xlRmlsZUluY2x1ZGVzPzogc3RyaW5nW107XG4gIGkxOG5JbkZpbGU/OiBzdHJpbmc7XG4gIGkxOG5JbkZvcm1hdD86IHN0cmluZztcbiAgaTE4bk91dEZpbGU/OiBzdHJpbmc7XG4gIGkxOG5PdXRGb3JtYXQ/OiBzdHJpbmc7XG4gIGxvY2FsZT86IHN0cmluZztcbiAgbWlzc2luZ1RyYW5zbGF0aW9uPzogc3RyaW5nO1xuICBwbGF0Zm9ybT86IFBMQVRGT1JNO1xuICBuYW1lTGF6eUZpbGVzPzogYm9vbGVhbjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0OiB2aXJ0dWFsRnMuSG9zdDxmcy5TdGF0cz47XG59XG5cbmV4cG9ydCBlbnVtIFBMQVRGT1JNIHtcbiAgQnJvd3NlcixcbiAgU2VydmVyLFxufVxuXG5leHBvcnQgY2xhc3MgQW5ndWxhckNvbXBpbGVyUGx1Z2luIHtcbiAgcHJpdmF0ZSBfb3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucztcblxuICAvLyBUUyBjb21waWxhdGlvbi5cbiAgcHJpdmF0ZSBfY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnM7XG4gIHByaXZhdGUgX3Jvb3ROYW1lczogc3RyaW5nW107XG4gIHByaXZhdGUgX3NpbmdsZUZpbGVJbmNsdWRlczogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBfcHJvZ3JhbTogKHRzLlByb2dyYW0gfCBQcm9ncmFtKSB8IG51bGw7XG4gIHByaXZhdGUgX2NvbXBpbGVySG9zdDogV2VicGFja0NvbXBpbGVySG9zdCAmIENvbXBpbGVySG9zdDtcbiAgcHJpdmF0ZSBfbW9kdWxlUmVzb2x1dGlvbkNhY2hlOiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG4gIHByaXZhdGUgX3Jlc291cmNlTG9hZGVyOiBXZWJwYWNrUmVzb3VyY2VMb2FkZXI7XG4gIC8vIENvbnRhaW5zIGBtb2R1bGVJbXBvcnRQYXRoI2V4cG9ydE5hbWVgID0+IGBmdWxsTW9kdWxlUGF0aGAuXG4gIHByaXZhdGUgX2xhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHByaXZhdGUgX3RzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF9lbnRyeU1vZHVsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfbWFpblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBfYmFzZVBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfdHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSA9IFtdO1xuICBwcml2YXRlIF9wbGF0Zm9ybTogUExBVEZPUk07XG4gIHByaXZhdGUgX0ppdE1vZGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBfZW1pdFNraXBwZWQgPSB0cnVlO1xuICBwcml2YXRlIF9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsndHMnLCAnaHRtbCcsICdjc3MnXSk7XG5cbiAgLy8gV2VicGFjayBwbHVnaW4uXG4gIHByaXZhdGUgX2ZpcnN0UnVuID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfZG9uZVByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsO1xuICBwcml2YXRlIF9ub3JtYWxpemVkTG9jYWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF93YXJuaW5nczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG4gIHByaXZhdGUgX2Vycm9yczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG5cbiAgLy8gVHlwZUNoZWNrZXIgcHJvY2Vzcy5cbiAgcHJpdmF0ZSBfZm9ya1R5cGVDaGVja2VyID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfdHlwZUNoZWNrZXJQcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsO1xuICBwcml2YXRlIF9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgcHJpdmF0ZSBnZXQgX25nQ29tcGlsZXJTdXBwb3J0c05ld0FwaSgpIHtcbiAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gISEodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5saXN0TGF6eVJvdXRlcztcbiAgICB9XG4gIH1cblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgQ29tcGlsZXJDbGlJc1N1cHBvcnRlZCgpO1xuICAgIHRoaXMuX29wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zKTtcbiAgICB0aGlzLl9zZXR1cE9wdGlvbnModGhpcy5fb3B0aW9ucyk7XG4gIH1cblxuICBnZXQgb3B0aW9ucygpIHsgcmV0dXJuIHRoaXMuX29wdGlvbnM7IH1cbiAgZ2V0IGRvbmUoKSB7IHJldHVybiB0aGlzLl9kb25lUHJvbWlzZTsgfVxuICBnZXQgZW50cnlNb2R1bGUoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnRyeU1vZHVsZSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnN0IHNwbGl0dGVkID0gdGhpcy5fZW50cnlNb2R1bGUuc3BsaXQoLygjW2EtekEtWl9dKFtcXHddKykpJC8pO1xuICAgIGNvbnN0IHBhdGggPSBzcGxpdHRlZFswXTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSAhIXNwbGl0dGVkWzFdID8gc3BsaXR0ZWRbMV0uc3Vic3RyaW5nKDEpIDogJ2RlZmF1bHQnO1xuXG4gICAgcmV0dXJuIHsgcGF0aCwgY2xhc3NOYW1lIH07XG4gIH1cblxuICBzdGF0aWMgaXNTdXBwb3J0ZWQoKSB7XG4gICAgcmV0dXJuIFZFUlNJT04gJiYgcGFyc2VJbnQoVkVSU0lPTi5tYWpvcikgPj0gNTtcbiAgfVxuXG4gIHByaXZhdGUgX3NldHVwT3B0aW9ucyhvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9zZXR1cE9wdGlvbnMnKTtcbiAgICAvLyBGaWxsIGluIHRoZSBtaXNzaW5nIG9wdGlvbnMuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCd0c0NvbmZpZ1BhdGgnKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNdXN0IHNwZWNpZnkgXCJ0c0NvbmZpZ1BhdGhcIiBpbiB0aGUgY29uZmlndXJhdGlvbiBvZiBAbmd0b29scy93ZWJwYWNrLicpO1xuICAgIH1cbiAgICAvLyBUUyByZXByZXNlbnRzIHBhdGhzIGludGVybmFsbHkgd2l0aCAnLycgYW5kIGV4cGVjdHMgdGhlIHRzY29uZmlnIHBhdGggdG8gYmUgaW4gdGhpcyBmb3JtYXRcbiAgICB0aGlzLl90c0NvbmZpZ1BhdGggPSBvcHRpb25zLnRzQ29uZmlnUGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG5cbiAgICAvLyBDaGVjayB0aGUgYmFzZSBwYXRoLlxuICAgIGNvbnN0IG1heWJlQmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgdGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICBsZXQgYmFzZVBhdGggPSBtYXliZUJhc2VQYXRoO1xuICAgIGlmIChmcy5zdGF0U3luYyhtYXliZUJhc2VQYXRoKS5pc0ZpbGUoKSkge1xuICAgICAgYmFzZVBhdGggPSBwYXRoLmRpcm5hbWUoYmFzZVBhdGgpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5iYXNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLmJhc2VQYXRoKTtcbiAgICB9XG5cbiAgICBpZiAob3B0aW9ucy5zaW5nbGVGaWxlSW5jbHVkZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fc2luZ2xlRmlsZUluY2x1ZGVzLnB1c2goLi4ub3B0aW9ucy5zaW5nbGVGaWxlSW5jbHVkZXMpO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHRoZSB0c2NvbmZpZyBjb250ZW50cy5cbiAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGlmIChjb25maWcuZXJyb3JzICYmIGNvbmZpZy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZm9ybWF0RGlhZ25vc3RpY3MoY29uZmlnLmVycm9ycykpO1xuICAgIH1cblxuICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXMuY29uY2F0KC4uLnRoaXMuX3NpbmdsZUZpbGVJbmNsdWRlcyk7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zID0geyAuLi5jb25maWcub3B0aW9ucywgLi4ub3B0aW9ucy5jb21waWxlck9wdGlvbnMgfTtcbiAgICB0aGlzLl9iYXNlUGF0aCA9IGNvbmZpZy5vcHRpb25zLmJhc2VQYXRoIHx8ICcnO1xuXG4gICAgLy8gT3ZlcndyaXRlIG91dERpciBzbyB3ZSBjYW4gZmluZCBnZW5lcmF0ZWQgZmlsZXMgbmV4dCB0byB0aGVpciAudHMgb3JpZ2luIGluIGNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMub3V0RGlyID0gJyc7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcblxuICAgIC8vIERlZmF1bHQgcGx1Z2luIHNvdXJjZU1hcCB0byBjb21waWxlciBvcHRpb25zIHNldHRpbmcuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdzb3VyY2VNYXAnKSkge1xuICAgICAgb3B0aW9ucy5zb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEZvcmNlIHRoZSByaWdodCBzb3VyY2VtYXAgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5zb3VyY2VNYXApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICAvLyBXZSB3aWxsIHNldCB0aGUgc291cmNlIHRvIHRoZSBmdWxsIHBhdGggb2YgdGhlIGZpbGUgaW4gdGhlIGxvYWRlciwgc28gd2UgZG9uJ3RcbiAgICAgIC8vIG5lZWQgc291cmNlUm9vdCBoZXJlLlxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBXZSB3YW50IHRvIGFsbG93IGVtaXR0aW5nIHdpdGggZXJyb3JzIHNvIHRoYXQgaW1wb3J0cyBjYW4gYmUgYWRkZWRcbiAgICAvLyB0byB0aGUgd2VicGFjayBkZXBlbmRlbmN5IHRyZWUgYW5kIHJlYnVpbGRzIHRyaWdnZXJlZCBieSBmaWxlIGVkaXRzLlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG5cbiAgICAvLyBTZXQgSklUIChubyBjb2RlIGdlbmVyYXRpb24pIG9yIEFPVCBtb2RlLlxuICAgIGlmIChvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9KaXRNb2RlID0gb3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb247XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBpMThuIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRmlsZSA9IG9wdGlvbnMuaTE4bkluRmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Gb3JtYXQgPSBvcHRpb25zLmkxOG5JbkZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlID0gb3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZvcm1hdCA9IG9wdGlvbnMuaTE4bk91dEZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubG9jYWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Mb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0TG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlID0gdGhpcy5fdmFsaWRhdGVMb2NhbGUob3B0aW9ucy5sb2NhbGUpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5Jbk1pc3NpbmdUcmFuc2xhdGlvbnMgPVxuICAgICAgICBvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiBhcyAnZXJyb3InIHwgJ3dhcm5pbmcnIHwgJ2lnbm9yZSc7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JrZWQgdHlwZSBjaGVja2VyIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSB0aGUgd2VicGFjayBjb21waWxlciBob3N0LlxuICAgIGNvbnN0IHdlYnBhY2tDb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgdGhpcy5fb3B0aW9ucy5ob3N0LFxuICAgICk7XG4gICAgd2VicGFja0NvbXBpbGVySG9zdC5lbmFibGVDYWNoaW5nKCk7XG5cbiAgICAvLyBDcmVhdGUgYW5kIHNldCBhIG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIuXG4gICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgd2VicGFja0NvbXBpbGVySG9zdC5zZXRSZXNvdXJjZUxvYWRlcih0aGlzLl9yZXNvdXJjZUxvYWRlcik7XG5cbiAgICAvLyBVc2UgdGhlIFdlYnBhY2tDb21waWxlckhvc3Qgd2l0aCBhIHJlc291cmNlIGxvYWRlciB0byBjcmVhdGUgYW4gQW5ndWxhckNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgdHNIb3N0OiB3ZWJwYWNrQ29tcGlsZXJIb3N0LFxuICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG5cbiAgICAvLyBPdmVycmlkZSBzb21lIGZpbGVzIGluIHRoZSBGaWxlU3lzdGVtIHdpdGggcGF0aHMgZnJvbSB0aGUgYWN0dWFsIGZpbGUgc3lzdGVtLlxuICAgIGlmICh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIE9iamVjdC5rZXlzKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpKSB7XG4gICAgICAgIGNvbnN0IHJlcGxhY2VtZW50RmlsZVBhdGggPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzW2ZpbGVQYXRoXTtcbiAgICAgICAgY29uc3QgY29udGVudCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShyZXBsYWNlbWVudEZpbGVQYXRoKTtcbiAgICAgICAgaWYgKGNvbnRlbnQpIHtcbiAgICAgICAgICB0aGlzLl9jb21waWxlckhvc3Qud3JpdGVGaWxlKGZpbGVQYXRoLCBjb250ZW50LCBmYWxzZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXNvbHZlIG1haW5QYXRoIGlmIHByb3ZpZGVkLlxuICAgIGlmIChvcHRpb25zLm1haW5QYXRoKSB7XG4gICAgICB0aGlzLl9tYWluUGF0aCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKG9wdGlvbnMubWFpblBhdGgpO1xuICAgIH1cblxuICAgIC8vIFVzZSBlbnRyeU1vZHVsZSBpZiBhdmFpbGFibGUgaW4gb3B0aW9ucywgb3RoZXJ3aXNlIHJlc29sdmUgaXQgZnJvbSBtYWluUGF0aCBhZnRlciBwcm9ncmFtXG4gICAgLy8gY3JlYXRpb24uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gdGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSBhcyBzdHJpbmcpOyAvLyB0ZW1wb3JhcnkgY2FzdCBmb3IgdHlwZSBpc3N1ZVxuICAgIH1cblxuICAgIC8vIFNldCBwbGF0Zm9ybS5cbiAgICB0aGlzLl9wbGF0Zm9ybSA9IG9wdGlvbnMucGxhdGZvcm0gfHwgUExBVEZPUk0uQnJvd3NlcjtcblxuICAgIC8vIE1ha2UgdHJhbnNmb3JtZXJzLlxuICAgIHRoaXMuX21ha2VUcmFuc2Zvcm1lcnMoKTtcblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRUc1Byb2dyYW0oKSB7XG4gICAgcmV0dXJuIHRoaXMuX0ppdE1vZGUgPyB0aGlzLl9wcm9ncmFtIGFzIHRzLlByb2dyYW0gOiAodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5nZXRUc1Byb2dyYW0oKTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldENoYW5nZWRUc0ZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpXG4gICAgICAuZmlsdGVyKGsgPT4gay5lbmRzV2l0aCgnLnRzJykgJiYgIWsuZW5kc1dpdGgoJy5kLnRzJykpXG4gICAgICAuZmlsdGVyKGsgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoaykpO1xuICB9XG5cbiAgdXBkYXRlQ2hhbmdlZEZpbGVFeHRlbnNpb25zKGV4dGVuc2lvbjogc3RyaW5nKSB7XG4gICAgaWYgKGV4dGVuc2lvbikge1xuICAgICAgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zLmFkZChleHRlbnNpb24pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpXG4gICAgICAuZmlsdGVyKGsgPT4ge1xuICAgICAgICBmb3IgKGNvbnN0IGV4dCBvZiB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMpIHtcbiAgICAgICAgICBpZiAoay5lbmRzV2l0aChleHQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgLy8gR2V0IHRoZSByb290IGZpbGVzIGZyb20gdGhlIHRzIGNvbmZpZy5cbiAgICAgICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAgICAgLy8gZm9sbG93aW5nIGltcG9ydHMgb24gdGhlIGV4aXN0aW5nIGZpbGVzLCBzbyB3ZSBuZWVkIHRvIGdldCB0aGUgbmV3IGxpc3Qgb2Ygcm9vdCBmaWxlcy5cbiAgICAgICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICAgICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcy5jb25jYXQoLi4udGhpcy5fc2luZ2xlRmlsZUluY2x1ZGVzKTtcblxuICAgICAgICAvLyBVcGRhdGUgdGhlIGZvcmtlZCB0eXBlIGNoZWNrZXIgd2l0aCBhbGwgY2hhbmdlZCBjb21waWxhdGlvbiBmaWxlcy5cbiAgICAgICAgLy8gVGhpcyBpbmNsdWRlcyB0ZW1wbGF0ZXMsIHRoYXQgYWxzbyBuZWVkIHRvIGJlIHJlbG9hZGVkIG9uIHRoZSB0eXBlIGNoZWNrZXIuXG4gICAgICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIHRoaXMuX3VwZGF0ZUZvcmtlZFR5cGVDaGVja2VyKHRoaXMuX3Jvb3ROYW1lcywgdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSk7XG4gICAgICAgIH1cblxuICAgICAgICAgLy8gVXNlIGFuIGlkZW50aXR5IGZ1bmN0aW9uIGFzIGFsbCBvdXIgcGF0aHMgYXJlIGFic29sdXRlIGFscmVhZHkuXG4gICAgICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSA9IHRzLmNyZWF0ZU1vZHVsZVJlc29sdXRpb25DYWNoZSh0aGlzLl9iYXNlUGF0aCwgeCA9PiB4KTtcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgICAgICB0aGlzLl9wcm9ncmFtID0gdHMuY3JlYXRlUHJvZ3JhbShcbiAgICAgICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgICAgIHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSxcbiAgICAgICAgICApO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAgICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHByb2dyYW0uXG4gICAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9wcm9ncmFtLmxvYWROZ1N0cnVjdHVyZUFzeW5jKClcbiAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAvLyBJZiB0aGVyZSdzIHN0aWxsIG5vIGVudHJ5TW9kdWxlIHRyeSB0byByZXNvbHZlIGZyb20gbWFpblBhdGguXG4gICAgICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUgJiYgdGhpcy5fbWFpblBhdGgpIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluKFxuICAgICAgICAgICAgdGhpcy5fbWFpblBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdGhpcy5fZ2V0VHNQcm9ncmFtKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpIHtcbiAgICB0cnkge1xuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9nZXRMYXp5Um91dGVzRnJvbU5ndG9vbHMnKTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IF9fTkdUT09MU19QUklWQVRFX0FQSV8yLmxpc3RMYXp5Um91dGVzKHtcbiAgICAgICAgcHJvZ3JhbTogdGhpcy5fZ2V0VHNQcm9ncmFtKCksXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICAgYW5ndWxhckNvbXBpbGVyT3B0aW9uczogT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fY29tcGlsZXJPcHRpb25zLCB7XG4gICAgICAgICAgLy8gZ2VuRGlyIHNlZW1zIHRvIHN0aWxsIGJlIG5lZWRlZCBpbiBAYW5ndWxhclxcY29tcGlsZXItY2xpXFxzcmNcXGNvbXBpbGVyX2hvc3QuanM6MjI2LlxuICAgICAgICAgIGdlbkRpcjogJycsXG4gICAgICAgIH0pLFxuICAgICAgICAvLyBUT0RPOiBmaXggY29tcGlsZXItY2xpIHR5cGluZ3M7IGVudHJ5TW9kdWxlIHNob3VsZCBub3QgYmUgc3RyaW5nLCBidXQgYWxzbyBvcHRpb25hbC5cbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vbi1udWxsLW9wZXJhdG9yXG4gICAgICAgIGVudHJ5TW9kdWxlOiB0aGlzLl9lbnRyeU1vZHVsZSAhLFxuICAgICAgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2dldExhenlSb3V0ZXNGcm9tTmd0b29scycpO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gV2Ugc2lsZW5jZSB0aGUgZXJyb3IgdGhhdCB0aGUgQGFuZ3VsYXIvcm91dGVyIGNvdWxkIG5vdCBiZSBmb3VuZC4gSW4gdGhhdCBjYXNlLCB0aGVyZSBpc1xuICAgICAgLy8gYmFzaWNhbGx5IG5vIHJvdXRlIHN1cHBvcnRlZCBieSB0aGUgYXBwIGl0c2VsZi5cbiAgICAgIGlmIChlcnIubWVzc2FnZS5zdGFydHNXaXRoKCdDb3VsZCBub3QgcmVzb2x2ZSBtb2R1bGUgQGFuZ3VsYXIvcm91dGVyJykpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2ZpbmRMYXp5Um91dGVzSW5Bc3QoY2hhbmdlZEZpbGVQYXRoczogc3RyaW5nW10pOiBMYXp5Um91dGVNYXAge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZmluZExhenlSb3V0ZXNJbkFzdCcpO1xuICAgIGNvbnN0IHJlc3VsdDogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIGNoYW5nZWRGaWxlUGF0aHMpIHtcbiAgICAgIGNvbnN0IGZpbGVMYXp5Um91dGVzID0gZmluZExhenlSb3V0ZXMoZmlsZVBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdW5kZWZpbmVkLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMpO1xuICAgICAgZm9yIChjb25zdCByb3V0ZUtleSBvZiBPYmplY3Qua2V5cyhmaWxlTGF6eVJvdXRlcykpIHtcbiAgICAgICAgY29uc3Qgcm91dGUgPSBmaWxlTGF6eVJvdXRlc1tyb3V0ZUtleV07XG4gICAgICAgIHJlc3VsdFtyb3V0ZUtleV0gPSByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGNvbnN0IG5nUHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbTtcbiAgICBpZiAoIW5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSB3YXMgY2FsbGVkIHdpdGggYW4gb2xkIHByb2dyYW0uJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcygpO1xuXG4gICAgcmV0dXJuIGxhenlSb3V0ZXMucmVkdWNlKFxuICAgICAgKGFjYywgY3VycikgPT4ge1xuICAgICAgICBjb25zdCByZWYgPSBjdXJyLnJvdXRlO1xuICAgICAgICBpZiAocmVmIGluIGFjYyAmJiBhY2NbcmVmXSAhPT0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgKyBgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZDogXCIke3JlZn1cIiBpcyB1c2VkIGluIDIgbG9hZENoaWxkcmVuLCBgXG4gICAgICAgICAgICArIGBidXQgdGhleSBwb2ludCB0byBkaWZmZXJlbnQgbW9kdWxlcyBcIigke2FjY1tyZWZdfSBhbmQgYFxuICAgICAgICAgICAgKyBgXCIke2N1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aH1cIikuIFdlYnBhY2sgY2Fubm90IGRpc3Rpbmd1aXNoIG9uIGNvbnRleHQgYW5kIGBcbiAgICAgICAgICAgICsgJ3dvdWxkIGZhaWwgdG8gbG9hZCB0aGUgcHJvcGVyIG9uZS4nLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgYWNjW3JlZl0gPSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGg7XG5cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sXG4gICAgICB7fSBhcyBMYXp5Um91dGVNYXAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFByb2Nlc3MgdGhlIGxhenkgcm91dGVzIGRpc2NvdmVyZWQsIGFkZGluZyB0aGVuIHRvIF9sYXp5Um91dGVzLlxuICAvLyBUT0RPOiBmaW5kIGEgd2F5IHRvIHJlbW92ZSBsYXp5IHJvdXRlcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG4gIC8vIFRoaXMgd2lsbCByZXF1aXJlIGEgcmVnaXN0cnkgb2Yga25vd24gcmVmZXJlbmNlcyB0byBhIGxhenkgcm91dGUsIHJlbW92aW5nIGl0IHdoZW4gbm9cbiAgLy8gbW9kdWxlIHJlZmVyZW5jZXMgaXQgYW55bW9yZS5cbiAgcHJpdmF0ZSBfcHJvY2Vzc0xhenlSb3V0ZXMoZGlzY292ZXJlZExhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCkge1xuICAgIE9iamVjdC5rZXlzKGRpc2NvdmVyZWRMYXp5Um91dGVzKVxuICAgICAgLmZvckVhY2gobGF6eVJvdXRlS2V5ID0+IHtcbiAgICAgICAgY29uc3QgW2xhenlSb3V0ZU1vZHVsZSwgbW9kdWxlTmFtZV0gPSBsYXp5Um91dGVLZXkuc3BsaXQoJyMnKTtcblxuICAgICAgICBpZiAoIWxhenlSb3V0ZU1vZHVsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxhenlSb3V0ZVRTRmlsZSA9IGRpc2NvdmVyZWRMYXp5Um91dGVzW2xhenlSb3V0ZUtleV0ucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICAgICAgICBsZXQgbW9kdWxlUGF0aDogc3RyaW5nLCBtb2R1bGVLZXk6IHN0cmluZztcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGU7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfSR7bW9kdWxlTmFtZSA/ICcjJyArIG1vZHVsZU5hbWUgOiAnJ31gO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGUucmVwbGFjZSgvKFxcLmQpP1xcLnRzJC8sIGAubmdmYWN0b3J5LmpzYCk7XG4gICAgICAgICAgY29uc3QgZmFjdG9yeU1vZHVsZU5hbWUgPSBtb2R1bGVOYW1lID8gYCMke21vZHVsZU5hbWV9TmdGYWN0b3J5YCA6ICcnO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ubmdmYWN0b3J5JHtmYWN0b3J5TW9kdWxlTmFtZX1gO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1vZHVsZUtleSBpbiB0aGlzLl9sYXp5Um91dGVzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSAhPT0gbW9kdWxlUGF0aCkge1xuICAgICAgICAgICAgLy8gRm91bmQgYSBkdXBsaWNhdGUsIHRoaXMgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQgZHVyaW5nIGEgcmVidWlsZC4gYFxuICAgICAgICAgICAgICAgICsgYFdlIHdpbGwgdGFrZSB0aGUgbGF0ZXN0IHZlcnNpb24gZGV0ZWN0ZWQgYW5kIG92ZXJyaWRlIGl0IHRvIHNhdmUgcmVidWlsZCB0aW1lLiBgXG4gICAgICAgICAgICAgICAgKyBgWW91IHNob3VsZCBwZXJmb3JtIGEgZnVsbCBidWlsZCB0byB2YWxpZGF0ZSB0aGF0IHlvdXIgcm91dGVzIGRvbid0IG92ZXJsYXAuYCksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGb3VuZCBhIG5ldyByb3V0ZSwgYWRkIGl0IHRvIHRoZSBtYXAuXG4gICAgICAgICAgdGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldID0gbW9kdWxlUGF0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICAvLyBCb290c3RyYXAgdHlwZSBjaGVja2VyIGlzIHVzaW5nIGxvY2FsIENMSS5cbiAgICBjb25zdCBnOiBhbnkgPSB0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJyA/IGdsb2JhbCA6IHt9OyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICBjb25zdCB0eXBlQ2hlY2tlckZpbGU6IHN0cmluZyA9IGdbJ19EZXZLaXRJc0xvY2FsJ11cbiAgICAgID8gJy4vdHlwZV9jaGVja2VyX2Jvb3RzdHJhcC5qcydcbiAgICAgIDogJy4vdHlwZV9jaGVja2VyX3dvcmtlci5qcyc7XG5cbiAgICBjb25zdCBkZWJ1Z0FyZ1JlZ2V4ID0gLy0taW5zcGVjdCg/Oi1icmt8LXBvcnQpP3wtLWRlYnVnKD86LWJya3wtcG9ydCkvO1xuXG4gICAgY29uc3QgZXhlY0FyZ3YgPSBwcm9jZXNzLmV4ZWNBcmd2LmZpbHRlcigoYXJnKSA9PiB7XG4gICAgICAvLyBSZW1vdmUgZGVidWcgYXJncy5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvOTQzNVxuICAgICAgcmV0dXJuICFkZWJ1Z0FyZ1JlZ2V4LnRlc3QoYXJnKTtcbiAgICB9KTtcbiAgICAvLyBTaWduYWwgdGhlIHByb2Nlc3MgdG8gc3RhcnQgbGlzdGVuaW5nIGZvciBtZXNzYWdlc1xuICAgIC8vIFNvbHZlcyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvOTA3MVxuICAgIGNvbnN0IGZvcmtBcmdzID0gW0FVVE9fU1RBUlRfQVJHXTtcbiAgICBjb25zdCBmb3JrT3B0aW9uczogRm9ya09wdGlvbnMgPSB7IGV4ZWNBcmd2IH07XG5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBmb3JrKFxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgdHlwZUNoZWNrZXJGaWxlKSxcbiAgICAgIGZvcmtBcmdzLFxuICAgICAgZm9ya09wdGlvbnMpO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIHByb2Nlc3MgZXhpdC5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub25jZSgnZXhpdCcsIChfLCBzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG5cbiAgICAgIC8vIElmIHByb2Nlc3MgZXhpdGVkIG5vdCBiZWNhdXNlIG9mIFNJR1RFUk0gKHNlZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKSwgdGhhbiBzb21ldGhpbmdcbiAgICAgIC8vIHdlbnQgd3JvbmcgYW5kIGl0IHNob3VsZCBmYWxsYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIHRoZSBtYWluIHRocmVhZC5cbiAgICAgIGlmIChzaWduYWwgIT09ICdTSUdURVJNJykge1xuICAgICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbXNnID0gJ0FuZ3VsYXJDb21waWxlclBsdWdpbjogRm9ya2VkIFR5cGUgQ2hlY2tlciBleGl0ZWQgdW5leHBlY3RlZGx5LiAnICtcbiAgICAgICAgICAnRmFsbGluZyBiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gbWFpbiB0aHJlYWQuJztcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCkge1xuICAgICAgdHJlZUtpbGwodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCwgJ1NJR1RFUk0nKTtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgaWYgKCF0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkKSB7XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcykpO1xuICAgICAgICB0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBVcGRhdGVNZXNzYWdlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RyYXRpb24gaG9vayBmb3Igd2VicGFjayBwbHVnaW4uXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgYXBwbHkoY29tcGlsZXI6IGFueSkge1xuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSA9IG5ldyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtLCB0aGlzLl9jb21waWxlckhvc3QpO1xuICAgICAgY29tcGlsZXIud2F0Y2hGaWxlU3lzdGVtID0gbmV3IFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IoY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBsYXp5IG1vZHVsZXMgdG8gdGhlIGNvbnRleHQgbW9kdWxlIGZvciBAYW5ndWxhci9jb3JlXG4gICAgY29tcGlsZXIuaG9va3MuY29udGV4dE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKGNtZjogYW55KSA9PiB7XG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVBhY2thZ2VQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb3JlL3BhY2thZ2UuanNvbicpO1xuXG4gICAgICAvLyBBUEZ2NiBkb2VzIG5vdCBoYXZlIHNpbmdsZSBGRVNNIGFueW1vcmUuIEluc3RlYWQgb2YgdmVyaWZ5aW5nIGlmIHdlJ3JlIHBvaW50aW5nIHRvXG4gICAgICAvLyBGRVNNcywgd2UgcmVzb2x2ZSB0aGUgYEBhbmd1bGFyL2NvcmVgIHBhdGggYW5kIHZlcmlmeSB0aGF0IHRoZSBwYXRoIGZvciB0aGVcbiAgICAgIC8vIG1vZHVsZSBzdGFydHMgd2l0aCBpdC5cblxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVEaXJuYW1lID0gZnMucmVhbHBhdGhTeW5jKHBhdGguZGlybmFtZShhbmd1bGFyQ29yZVBhY2thZ2VQYXRoKSk7XG5cbiAgICAgIGNtZi5ob29rcy5hZnRlclJlc29sdmUudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgKHJlc3VsdDogYW55LCBjYWxsYmFjazogKGVycj86IEVycm9yLCByZXF1ZXN0PzogYW55KSA9PiB2b2lkKSA9PiB7XG4gICAgICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBbHRlciBvbmx5IHJlcXVlc3QgZnJvbSBBbmd1bGFyLlxuICAgICAgICBpZiAoIXJlc3VsdC5yZXNvdXJjZS5zdGFydHNXaXRoKGFuZ3VsYXJDb3JlRGlybmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sodW5kZWZpbmVkLCByZXN1bHQpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5kb25lKSB7XG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMuZG9uZS50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBUaGlzIGZvbGRlciBkb2VzIG5vdCBleGlzdCwgYnV0IHdlIG5lZWQgdG8gZ2l2ZSB3ZWJwYWNrIGEgcmVzb3VyY2UuXG4gICAgICAgICAgLy8gVE9ETzogY2hlY2sgaWYgd2UgY2FuJ3QganVzdCBsZWF2ZSBpdCBhcyBpcyAoYW5ndWxhckNvcmVNb2R1bGVEaXIpLlxuICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICByZXN1bHQuZGVwZW5kZW5jaWVzLmZvckVhY2goKGQ6IGFueSkgPT4gZC5jcml0aWNhbCA9IGZhbHNlKTtcbiAgICAgICAgICByZXN1bHQucmVzb2x2ZURlcGVuZGVuY2llcyA9IChfZnM6IGFueSwgcmVzb3VyY2VPck9wdGlvbnM6IGFueSwgcmVjdXJzaXZlT3JDYWxsYmFjazogYW55LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIF9yZWdFeHA6IFJlZ0V4cCwgY2I6IGFueSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gT2JqZWN0LmtleXModGhpcy5fbGF6eVJvdXRlcylcbiAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlUGF0aCA9IHRoaXMuX2xhenlSb3V0ZXNba2V5XTtcbiAgICAgICAgICAgICAgICBjb25zdCBpbXBvcnRQYXRoID0ga2V5LnNwbGl0KCcjJylbMF07XG4gICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSBpbXBvcnRQYXRoLnJlcGxhY2UoLyhcXC5uZ2ZhY3RvcnkpP1xcLihqc3x0cykkLywgJycpO1xuXG4gICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeShtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAuZmlsdGVyKHggPT4gISF4KTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2IgIT09ICdmdW5jdGlvbicgJiYgdHlwZW9mIHJlY3Vyc2l2ZU9yQ2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgLy8gV2VicGFjayA0IG9ubHkgaGFzIDMgcGFyYW1ldGVyc1xuICAgICAgICAgICAgICBjYiA9IHJlY3Vyc2l2ZU9yQ2FsbGJhY2s7XG4gICAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLm5hbWVMYXp5RmlsZXMpIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZU9yT3B0aW9ucy5jaHVua05hbWUgPSAnW3JlcXVlc3RdJztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2IobnVsbCwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KTtcbiAgICAgICAgfSwgKCkgPT4gY2FsbGJhY2soKSlcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IGNhbGxiYWNrKGVycikpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgYW5kIGRlc3Ryb3kgZm9ya2VkIHR5cGUgY2hlY2tlciBvbiB3YXRjaCBtb2RlLlxuICAgIGNvbXBpbGVyLmhvb2tzLndhdGNoUnVuLnRhcEFzeW5jKCdhbmd1bGFyLWNvbXBpbGVyJywgKF9jb21waWxlcjogYW55LCBjYWxsYmFjazogYW55KSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICAgIGNhbGxiYWNrKCk7XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hDbG9zZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSk7XG5cbiAgICAvLyBSZW1ha2UgdGhlIHBsdWdpbiBvbiBlYWNoIGNvbXBpbGF0aW9uLlxuICAgIGNvbXBpbGVyLmhvb2tzLm1ha2UudGFwQXN5bmMoXG4gICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAoY29tcGlsYXRpb246IGFueSwgY2I6IGFueSkgPT4gdGhpcy5fbWFrZShjb21waWxhdGlvbiwgY2IpLFxuICAgICk7XG4gICAgY29tcGlsZXIuaG9va3MuaW52YWxpZC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9maXJzdFJ1biA9IGZhbHNlKTtcbiAgICBjb21waWxlci5ob29rcy5hZnRlckVtaXQudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAoY29tcGlsYXRpb246IGFueSwgY2I6IGFueSkgPT4ge1xuICAgICAgY29tcGlsYXRpb24uX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSBudWxsO1xuICAgICAgY2IoKTtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIChjb21waWxlcjogYW55KSA9PiB7XG4gICAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIChubWY6IGFueSkgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcEFzeW5jKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlcXVlc3Q6IGFueSwgY2FsbGJhY2s6IGFueSkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgKHJlcXVlc3QucmVxdWVzdC5lbmRzV2l0aCgnLnRzJylcbiAgICAgICAgICAgICAgfHwgKHJlcXVlc3QuY29udGV4dC5pc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChyZXF1ZXN0LmNvbnRleHQuaXNzdWVyKSkpKSB7XG4gICAgICAgICAgICB0aGlzLmRvbmUudGhlbigoKSA9PiBjYWxsYmFjayhudWxsLCByZXF1ZXN0KSwgKCkgPT4gY2FsbGJhY2sobnVsbCwgcmVxdWVzdCkpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWxsYmFjayhudWxsLCByZXF1ZXN0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIChubWY6IGFueSkgPT4ge1xuICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwQXN5bmMoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVxdWVzdDogYW55LCBjYWxsYmFjazogYW55KSA9PiB7XG4gICAgICAgIHJlc29sdmVXaXRoUGF0aHMoXG4gICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZShjb21waWxhdGlvbjogYW55LCBjYjogKGVycj86IGFueSwgcmVxdWVzdD86IGFueSkgPT4gdm9pZCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICBpZiAoY29tcGlsYXRpb24uX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UpIHtcbiAgICAgIHJldHVybiBjYihuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJykpO1xuICAgIH1cblxuICAgIC8vIFNldCBhIHByaXZhdGUgdmFyaWFibGUgZm9yIHRoaXMgcGx1Z2luIGluc3RhbmNlLlxuICAgIGNvbXBpbGF0aW9uLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbik7XG5cbiAgICB0aGlzLl9kb25lUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl91cGRhdGUoKSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UnKTtcbiAgICAgICAgY2IoKTtcbiAgICAgIH0sIChlcnI6IGFueSkgPT4ge1xuICAgICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgICAgICBjYigpO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbjogYW55KSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSB0aGlzLl9tYWluUGF0aDtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGU7XG4gICAgY29uc3QgZ2V0TGF6eVJvdXRlcyA9ICgpID0+IHRoaXMuX2xhenlSb3V0ZXM7XG4gICAgY29uc3QgZ2V0VHlwZUNoZWNrZXIgPSAoKSA9PiB0aGlzLl9nZXRUc1Byb2dyYW0oKS5nZXRUeXBlQ2hlY2tlcigpO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIFJlcGxhY2UgcmVzb3VyY2VzIGluIEpJVC5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VSZXNvdXJjZXMoaXNBcHBQYXRoKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW92ZSB1bm5lZWRlZCBhbmd1bGFyIGRlY29yYXRvcnMuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZW1vdmVEZWNvcmF0b3JzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcGxhdGZvcm0gPT09IFBMQVRGT1JNLkJyb3dzZXIpIHtcbiAgICAgIC8vIElmIHdlIGhhdmUgYSBsb2NhbGUsIGF1dG8gaW1wb3J0IHRoZSBsb2NhbGUgZGF0YSBmaWxlLlxuICAgICAgLy8gVGhpcyB0cmFuc2Zvcm0gbXVzdCBnbyBiZWZvcmUgcmVwbGFjZUJvb3RzdHJhcCBiZWNhdXNlIGl0IGxvb2tzIGZvciB0aGUgZW50cnkgbW9kdWxlXG4gICAgICAvLyBpbXBvcnQsIHdoaWNoIHdpbGwgYmUgcmVwbGFjZWQuXG4gICAgICBpZiAodGhpcy5fbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZWdpc3RlckxvY2FsZURhdGEoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlKSk7XG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAvLyBSZXBsYWNlIGJvb3RzdHJhcCBpbiBicm93c2VyIEFPVC5cbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZUJvb3RzdHJhcChpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy5fcGxhdGZvcm0gPT09IFBMQVRGT1JNLlNlcnZlcikge1xuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goZXhwb3J0TGF6eU1vZHVsZU1hcChpc01haW5QYXRoLCBnZXRMYXp5Um91dGVzKSk7XG4gICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goXG4gICAgICAgICAgZXhwb3J0TmdGYWN0b3J5KGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlKSxcbiAgICAgICAgICByZXBsYWNlU2VydmVyQm9vdHN0cmFwKGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZSgpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICAgIC8vIFdlIG9ubHkgd2FudCB0byB1cGRhdGUgb24gVFMgYW5kIHRlbXBsYXRlIGNoYW5nZXMsIGJ1dCBhbGwga2luZHMgb2YgZmlsZXMgYXJlIG9uIHRoaXNcbiAgICAvLyBsaXN0LCBsaWtlIHBhY2thZ2UuanNvbiBhbmQgLm5nc3VtbWFyeS5qc29uIGZpbGVzLlxuICAgIGNvbnN0IGNoYW5nZWRGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCk7XG5cbiAgICAvLyBJZiBub3RoaW5nIHdlIGNhcmUgYWJvdXQgY2hhbmdlZCBhbmQgaXQgaXNuJ3QgdGhlIGZpcnN0IHJ1biwgZG9uJ3QgZG8gYW55dGhpbmcuXG4gICAgaWYgKGNoYW5nZWRGaWxlcy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpXG4gICAgICAvLyBNYWtlIGEgbmV3IHByb2dyYW0gYW5kIGxvYWQgdGhlIEFuZ3VsYXIgc3RydWN0dXJlLlxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLmVudHJ5TW9kdWxlKSB7XG4gICAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbGF6eSByb3V0ZXMgaWYgd2UgaGF2ZSBhbiBlbnRyeSBtb2R1bGUuXG4gICAgICAgICAgLy8gV2UgbmVlZCB0byBydW4gdGhlIGBsaXN0TGF6eVJvdXRlc2AgdGhlIGZpcnN0IHRpbWUgYmVjYXVzZSBpdCBhbHNvIG5hdmlnYXRlcyBsaWJyYXJpZXNcbiAgICAgICAgICAvLyBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgd2UgbWlnaHQgbWlzcyB1c2luZyB0aGUgKGZhc3RlcikgZmluZExhenlSb3V0ZXNJbkFzdC5cbiAgICAgICAgICAvLyBMYXp5IHJvdXRlcyBtb2R1bGVzIHdpbGwgYmUgcmVhZCB3aXRoIGNvbXBpbGVySG9zdCBhbmQgYWRkZWQgdG8gdGhlIGNoYW5nZWQgZmlsZXMuXG4gICAgICAgICAgY29uc3QgY2hhbmdlZFRzRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkVHNGaWxlcygpO1xuICAgICAgICAgIGlmICh0aGlzLl9uZ0NvbXBpbGVyU3VwcG9ydHNOZXdBcGkpIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0oKSk7XG4gICAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fZ2V0TGF6eVJvdXRlc0Zyb21OZ3Rvb2xzKCkpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoY2hhbmdlZFRzRmlsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXModGhpcy5fZmluZExhenlSb3V0ZXNJbkFzdChjaGFuZ2VkVHNGaWxlcykpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMpIHtcbiAgICAgICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX29wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVzKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIC8vIEVtaXQgYW5kIHJlcG9ydCBlcnJvcnMuXG5cbiAgICAgICAgLy8gV2Ugbm93IGhhdmUgdGhlIGZpbmFsIGxpc3Qgb2YgY2hhbmdlZCBUUyBmaWxlcy5cbiAgICAgICAgLy8gR28gdGhyb3VnaCBlYWNoIGNoYW5nZWQgZmlsZSBhbmQgYWRkIHRyYW5zZm9ybXMgYXMgbmVlZGVkLlxuICAgICAgICBjb25zdCBzb3VyY2VGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRUc0ZpbGVzKClcbiAgICAgICAgICAubWFwKChmaWxlTmFtZSkgPT4gdGhpcy5fZ2V0VHNQcm9ncmFtKCkuZ2V0U291cmNlRmlsZShmaWxlTmFtZSkpXG4gICAgICAgICAgLy8gQXQgdGhpcyBwb2ludCB3ZSBzaG91bGRuJ3QgbmVlZCB0byBmaWx0ZXIgb3V0IHVuZGVmaW5lZCBmaWxlcywgYmVjYXVzZSBhbnkgdHMgZmlsZVxuICAgICAgICAgIC8vIHRoYXQgY2hhbmdlZCBzaG91bGQgYmUgZW1pdHRlZC5cbiAgICAgICAgICAvLyBCdXQgZHVlIHRvIGhvc3RSZXBsYWNlbWVudFBhdGhzIHRoZXJlIGNhbiBiZSBmaWxlcyAodGhlIGVudmlyb25tZW50IGZpbGVzKVxuICAgICAgICAgIC8vIHRoYXQgY2hhbmdlZCBidXQgYXJlbid0IHBhcnQgb2YgdGhlIGNvbXBpbGF0aW9uLCBzcGVjaWFsbHkgb24gYG5nIHRlc3RgLlxuICAgICAgICAgIC8vIFNvIHdlIGlnbm9yZSBtaXNzaW5nIHNvdXJjZSBmaWxlcyBmaWxlcyBoZXJlLlxuICAgICAgICAgIC8vIGhvc3RSZXBsYWNlbWVudFBhdGhzIG5lZWRzIHRvIGJlIGZpeGVkIGFueXdheSB0byB0YWtlIGNhcmUgb2YgdGhlIGZvbGxvd2luZyBpc3N1ZS5cbiAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvNzMwNSNpc3N1ZWNvbW1lbnQtMzMyMTUwMjMwXG4gICAgICAgICAgLmZpbHRlcigoeCkgPT4gISF4KSBhcyB0cy5Tb3VyY2VGaWxlW107XG5cbiAgICAgICAgLy8gRW1pdCBmaWxlcy5cbiAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcbiAgICAgICAgY29uc3QgeyBlbWl0UmVzdWx0LCBkaWFnbm9zdGljcyB9ID0gdGhpcy5fZW1pdChzb3VyY2VGaWxlcyk7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG5cbiAgICAgICAgLy8gUmVwb3J0IGRpYWdub3N0aWNzLlxuICAgICAgICBjb25zdCBlcnJvcnMgPSBkaWFnbm9zdGljc1xuICAgICAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvcik7XG4gICAgICAgIGNvbnN0IHdhcm5pbmdzID0gZGlhZ25vc3RpY3NcbiAgICAgICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuV2FybmluZyk7XG5cbiAgICAgICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKGVycm9ycyk7XG4gICAgICAgICAgdGhpcy5fZXJyb3JzLnB1c2gobmV3IEVycm9yKG1lc3NhZ2UpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKHdhcm5pbmdzKTtcbiAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1lc3NhZ2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5fZW1pdFNraXBwZWQgPSAhZW1pdFJlc3VsdCB8fCBlbWl0UmVzdWx0LmVtaXRTa2lwcGVkO1xuXG4gICAgICAgIC8vIFJlc2V0IGNoYW5nZWQgZmlsZXMgb24gc3VjY2Vzc2Z1bCBjb21waWxhdGlvbi5cbiAgICAgICAgaWYgKCF0aGlzLl9lbWl0U2tpcHBlZCAmJiB0aGlzLl9lcnJvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LnJlc2V0Q2hhbmdlZEZpbGVUcmFja2VyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgICAgIH0pO1xuICB9XG5cbiAgd3JpdGVJMThuT3V0RmlsZSgpIHtcbiAgICBmdW5jdGlvbiBfcmVjdXJzaXZlTWtEaXIocDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhwKSkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShwKSlcbiAgICAgICAgICAudGhlbigoKSA9PiBmcy5ta2RpclN5bmMocCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdyaXRlIHRoZSBleHRyYWN0ZWQgbWVzc2FnZXMgdG8gZGlzay5cbiAgICBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKSB7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSk7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZUNvbnRlbnQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUoaTE4bk91dEZpbGVQYXRoKTtcbiAgICAgIGlmIChpMThuT3V0RmlsZUNvbnRlbnQpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShpMThuT3V0RmlsZVBhdGgpKVxuICAgICAgICAgIC50aGVuKCgpID0+IGZzLndyaXRlRmlsZVN5bmMoaTE4bk91dEZpbGVQYXRoLCBpMThuT3V0RmlsZUNvbnRlbnQpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXRDb21waWxlZEZpbGUoZmlsZU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IG91dHB1dEZpbGUgPSBmaWxlTmFtZS5yZXBsYWNlKC8udHMkLywgJy5qcycpO1xuICAgIGxldCBvdXRwdXRUZXh0OiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZU1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGxldCBlcnJvckRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmICh0aGlzLl9lbWl0U2tpcHBlZCkge1xuICAgICAgY29uc3QgdGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIC8vIElmIHRoZSBjb21waWxhdGlvbiBkaWRuJ3QgZW1pdCBmaWxlcyB0aGlzIHRpbWUsIHRyeSB0byByZXR1cm4gdGhlIGNhY2hlZCBmaWxlcyBmcm9tIHRoZVxuICAgICAgICAvLyBsYXN0IGNvbXBpbGF0aW9uIGFuZCBsZXQgdGhlIGNvbXBpbGF0aW9uIGVycm9ycyBzaG93IHdoYXQncyB3cm9uZy5cbiAgICAgICAgb3V0cHV0VGV4dCA9IHRleHQ7XG4gICAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm90aGluZyB3ZSBjYW4gc2VydmUuIFJldHVybiBhbiBlbXB0eSBzdHJpbmcgdG8gcHJldmVudCBsZW5naHR5IHdlYnBhY2sgZXJyb3JzLFxuICAgICAgICAvLyBhZGQgdGhlIHJlYnVpbGQgd2FybmluZyBpZiBpdCdzIG5vdCB0aGVyZSB5ZXQuXG4gICAgICAgIC8vIFdlIGFsc28gbmVlZCB0byBhbGwgY2hhbmdlZCBmaWxlcyBhcyBkZXBlbmRlbmNpZXMgb2YgdGhpcyBmaWxlLCBzbyB0aGF0IGFsbCBvZiB0aGVtXG4gICAgICAgIC8vIHdpbGwgYmUgd2F0Y2hlZCBhbmQgdHJpZ2dlciBhIHJlYnVpbGQgbmV4dCB0aW1lLlxuICAgICAgICBvdXRwdXRUZXh0ID0gJyc7XG4gICAgICAgIGVycm9yRGVwZW5kZW5jaWVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKVxuICAgICAgICAgIC8vIFRoZXNlIHBhdGhzIGFyZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgICAgICAgIC5tYXAoKHApID0+IHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDaGVjayBpZiB0aGUgVFMgaW5wdXQgZmlsZSBhbmQgdGhlIEpTIG91dHB1dCBmaWxlIGV4aXN0LlxuICAgICAgaWYgKChmaWxlTmFtZS5lbmRzV2l0aCgnLnRzJykgJiYgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGZpbGVOYW1lLCBmYWxzZSkpXG4gICAgICAgIHx8ICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhvdXRwdXRGaWxlLCBmYWxzZSkpIHtcbiAgICAgICAgbGV0IG1zZyA9IGAke2ZpbGVOYW1lfSBpcyBtaXNzaW5nIGZyb20gdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24uIGBcbiAgICAgICAgICArIGBQbGVhc2UgbWFrZSBzdXJlIGl0IGlzIGluIHlvdXIgdHNjb25maWcgdmlhIHRoZSAnZmlsZXMnIG9yICdpbmNsdWRlJyBwcm9wZXJ0eS5gO1xuXG4gICAgICAgIGlmICgvKFxcXFx8XFwvKW5vZGVfbW9kdWxlcyhcXFxcfFxcLykvLnRlc3QoZmlsZU5hbWUpKSB7XG4gICAgICAgICAgbXNnICs9ICdcXG5UaGUgbWlzc2luZyBmaWxlIHNlZW1zIHRvIGJlIHBhcnQgb2YgYSB0aGlyZCBwYXJ0eSBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdUUyBmaWxlcyBpbiBwdWJsaXNoZWQgbGlicmFyaWVzIGFyZSBvZnRlbiBhIHNpZ24gb2YgYSBiYWRseSBwYWNrYWdlZCBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdQbGVhc2Ugb3BlbiBhbiBpc3N1ZSBpbiB0aGUgbGlicmFyeSByZXBvc2l0b3J5IHRvIGFsZXJ0IGl0cyBhdXRob3IgYW5kIGFzayB0aGVtICdcbiAgICAgICAgICAgICsgJ3RvIHBhY2thZ2UgdGhlIGxpYnJhcnkgdXNpbmcgdGhlIEFuZ3VsYXIgUGFja2FnZSBGb3JtYXQgKGh0dHBzOi8vZ29vLmdsL2pCM0dWdikuJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgfVxuXG4gICAgICBvdXRwdXRUZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpIHx8ICcnO1xuICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgIH1cblxuICAgIHJldHVybiB7IG91dHB1dFRleHQsIHNvdXJjZU1hcCwgZXJyb3JEZXBlbmRlbmNpZXMgfTtcbiAgfVxuXG4gIGdldERlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHJlc29sdmVkRmlsZU5hbWUgPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZShmaWxlTmFtZSk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5nZXRTb3VyY2VGaWxlKHJlc29sdmVkRmlsZU5hbWUsIHRzLlNjcmlwdFRhcmdldC5MYXRlc3QpO1xuICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl9jb21waWxlck9wdGlvbnM7XG4gICAgY29uc3QgaG9zdCA9IHRoaXMuX2NvbXBpbGVySG9zdDtcbiAgICBjb25zdCBjYWNoZSA9IHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZTtcblxuICAgIGNvbnN0IGVzSW1wb3J0cyA9IGNvbGxlY3REZWVwTm9kZXM8dHMuSW1wb3J0RGVjbGFyYXRpb24+KHNvdXJjZUZpbGUsXG4gICAgICB0cy5TeW50YXhLaW5kLkltcG9ydERlY2xhcmF0aW9uKVxuICAgICAgLm1hcChkZWNsID0+IHtcbiAgICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKG1vZHVsZU5hbWUsIHJlc29sdmVkRmlsZU5hbWUsIG9wdGlvbnMsIGhvc3QsIGNhY2hlKTtcblxuICAgICAgICBpZiAocmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoeCA9PiB4KTtcblxuICAgIGNvbnN0IHJlc291cmNlSW1wb3J0cyA9IGZpbmRSZXNvdXJjZXMoc291cmNlRmlsZSlcbiAgICAgIC5tYXAoKHJlc291cmNlUmVwbGFjZW1lbnQpID0+IHJlc291cmNlUmVwbGFjZW1lbnQucmVzb3VyY2VQYXRocylcbiAgICAgIC5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuY29uY2F0KGN1cnIpLCBbXSlcbiAgICAgIC5tYXAoKHJlc291cmNlUGF0aCkgPT4gcGF0aC5yZXNvbHZlKHBhdGguZGlybmFtZShyZXNvbHZlZEZpbGVOYW1lKSwgcmVzb3VyY2VQYXRoKSk7XG5cbiAgICAvLyBUaGVzZSBwYXRocyBhcmUgbWVhbnQgdG8gYmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICBjb25zdCB1bmlxdWVEZXBlbmRlbmNpZXMgPSAgbmV3IFNldChbXG4gICAgICAuLi5lc0ltcG9ydHMsXG4gICAgICAuLi5yZXNvdXJjZUltcG9ydHMsXG4gICAgICAuLi50aGlzLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHJlc29sdmVkRmlsZU5hbWUpLFxuICAgIF0ubWFwKChwKSA9PiBwICYmIHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpKTtcblxuICAgIHJldHVybiBbLi4udW5pcXVlRGVwZW5kZW5jaWVzXVxuICAgICAgLmZpbHRlcih4ID0+ICEheCkgYXMgc3RyaW5nW107XG4gIH1cblxuICBnZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZSk7XG4gIH1cblxuICAvLyBUaGlzIGNvZGUgbW9zdGx5IGNvbWVzIGZyb20gYHBlcmZvcm1Db21waWxhdGlvbmAgaW4gYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAuXG4gIC8vIEl0IHNraXBzIHRoZSBwcm9ncmFtIGNyZWF0aW9uIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2UgYGxvYWROZ1N0cnVjdHVyZUFzeW5jKClgLFxuICAvLyBhbmQgdXNlcyBDdXN0b21UcmFuc2Zvcm1lcnMuXG4gIHByaXZhdGUgX2VtaXQoc291cmNlRmlsZXM6IHRzLlNvdXJjZUZpbGVbXSkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdCcpO1xuICAgIGNvbnN0IHByb2dyYW0gPSB0aGlzLl9wcm9ncmFtO1xuICAgIGNvbnN0IGFsbERpYWdub3N0aWNzOiBBcnJheTx0cy5EaWFnbm9zdGljIHwgRGlhZ25vc3RpYz4gPSBbXTtcblxuICAgIGxldCBlbWl0UmVzdWx0OiB0cy5FbWl0UmVzdWx0IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICBjb25zdCB0c1Byb2dyYW0gPSBwcm9ncmFtIGFzIHRzLlByb2dyYW07XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLnRzUHJvZ3JhbS5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCh0aGlzLl9maXJzdFJ1biB8fCAhdGhpcy5fZm9ya1R5cGVDaGVja2VyKSAmJiB0aGlzLl9wcm9ncmFtKSB7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyh0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIHNvdXJjZUZpbGVzLmZvckVhY2goKHNmKSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0aW1lTGFiZWwgPSBgQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzKyR7c2YuZmlsZU5hbWV9Ky5lbWl0YDtcbiAgICAgICAgICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICAgICAgICAgIGVtaXRSZXN1bHQgPSB0c1Byb2dyYW0uZW1pdChzZiwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gcHJvZ3JhbSBhcyBQcm9ncmFtO1xuXG4gICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgc3RydWN0dXJhbCBkaWFnbm9zdGljcy5cbiAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIFR5cGVTY3JpcHQgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXRUc09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCh0aGlzLl9maXJzdFJ1biB8fCAhdGhpcy5fZm9ya1R5cGVDaGVja2VyKSAmJiB0aGlzLl9wcm9ncmFtKSB7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyh0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgICAgY29uc3QgZXh0cmFjdEkxOG4gPSAhIXRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICAgICAgICBjb25zdCBlbWl0RmxhZ3MgPSBleHRyYWN0STE4biA/IEVtaXRGbGFncy5JMThuQnVuZGxlIDogRW1pdEZsYWdzLkRlZmF1bHQ7XG4gICAgICAgICAgZW1pdFJlc3VsdCA9IGFuZ3VsYXJQcm9ncmFtLmVtaXQoe1xuICAgICAgICAgICAgZW1pdEZsYWdzLCBjdXN0b21UcmFuc2Zvcm1lcnM6IHtcbiAgICAgICAgICAgICAgYmVmb3JlVHM6IHRoaXMuX3RyYW5zZm9ybWVycyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICBpZiAoZXh0cmFjdEkxOG4pIHtcbiAgICAgICAgICAgIHRoaXMud3JpdGVJMThuT3V0RmlsZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZW1pdCcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LmNhdGNoJyk7XG4gICAgICAvLyBUaGlzIGZ1bmN0aW9uIGlzIGF2YWlsYWJsZSBpbiB0aGUgaW1wb3J0IGJlbG93LCBidXQgdGhpcyB3YXkgd2UgYXZvaWQgdGhlIGRlcGVuZGVuY3kuXG4gICAgICAvLyBpbXBvcnQgeyBpc1N5bnRheEVycm9yIH0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXInO1xuICAgICAgZnVuY3Rpb24gaXNTeW50YXhFcnJvcihlcnJvcjogRXJyb3IpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChlcnJvciBhcyBhbnkpWyduZ1N5bnRheEVycm9yJ107ICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgICAgfVxuXG4gICAgICBsZXQgZXJyTXNnOiBzdHJpbmc7XG4gICAgICBsZXQgY29kZTogbnVtYmVyO1xuICAgICAgaWYgKGlzU3ludGF4RXJyb3IoZSkpIHtcbiAgICAgICAgLy8gZG9uJ3QgcmVwb3J0IHRoZSBzdGFjayBmb3Igc3ludGF4IGVycm9ycyBhcyB0aGV5IGFyZSB3ZWxsIGtub3duIGVycm9ycy5cbiAgICAgICAgZXJyTXNnID0gZS5tZXNzYWdlO1xuICAgICAgICBjb2RlID0gREVGQVVMVF9FUlJPUl9DT0RFO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXJyTXNnID0gZS5zdGFjaztcbiAgICAgICAgLy8gSXQgaXMgbm90IGEgc3ludGF4IGVycm9yIHdlIG1pZ2h0IGhhdmUgYSBwcm9ncmFtIHdpdGggdW5rbm93biBzdGF0ZSwgZGlzY2FyZCBpdC5cbiAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IG51bGw7XG4gICAgICAgIGNvZGUgPSBVTktOT1dOX0VSUk9SX0NPREU7XG4gICAgICB9XG4gICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKFxuICAgICAgICB7IGNhdGVnb3J5OiB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IsIG1lc3NhZ2VUZXh0OiBlcnJNc2csIGNvZGUsIHNvdXJjZTogU09VUkNFIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LmNhdGNoJyk7XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdCcpO1xuXG4gICAgcmV0dXJuIHsgcHJvZ3JhbSwgZW1pdFJlc3VsdCwgZGlhZ25vc3RpY3M6IGFsbERpYWdub3N0aWNzIH07XG4gIH1cblxuICBwcml2YXRlIF92YWxpZGF0ZUxvY2FsZShsb2NhbGU6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIEdldCB0aGUgcGF0aCBvZiB0aGUgY29tbW9uIG1vZHVsZS5cbiAgICBjb25zdCBjb21tb25QYXRoID0gcGF0aC5kaXJuYW1lKHJlcXVpcmUucmVzb2x2ZSgnQGFuZ3VsYXIvY29tbW9uL3BhY2thZ2UuanNvbicpKTtcbiAgICAvLyBDaGVjayBpZiB0aGUgbG9jYWxlIGZpbGUgZXhpc3RzXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHBhdGgucmVzb2x2ZShjb21tb25QYXRoLCAnbG9jYWxlcycsIGAke2xvY2FsZX0uanNgKSkpIHtcbiAgICAgIC8vIENoZWNrIGZvciBhbiBhbHRlcm5hdGl2ZSBsb2NhbGUgKGlmIHRoZSBsb2NhbGUgaWQgd2FzIGJhZGx5IGZvcm1hdHRlZCkuXG4gICAgICBjb25zdCBsb2NhbGVzID0gZnMucmVhZGRpclN5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJykpXG4gICAgICAgIC5maWx0ZXIoZmlsZSA9PiBmaWxlLmVuZHNXaXRoKCcuanMnKSlcbiAgICAgICAgLm1hcChmaWxlID0+IGZpbGUucmVwbGFjZSgnLmpzJywgJycpKTtcblxuICAgICAgbGV0IG5ld0xvY2FsZTtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRMb2NhbGUgPSBsb2NhbGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICctJyk7XG4gICAgICBmb3IgKGNvbnN0IGwgb2YgbG9jYWxlcykge1xuICAgICAgICBpZiAobC50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkTG9jYWxlKSB7XG4gICAgICAgICAgbmV3TG9jYWxlID0gbDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAobmV3TG9jYWxlKSB7XG4gICAgICAgIGxvY2FsZSA9IG5ld0xvY2FsZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENoZWNrIGZvciBhIHBhcmVudCBsb2NhbGVcbiAgICAgICAgY29uc3QgcGFyZW50TG9jYWxlID0gbm9ybWFsaXplZExvY2FsZS5zcGxpdCgnLScpWzBdO1xuICAgICAgICBpZiAobG9jYWxlcy5pbmRleE9mKHBhcmVudExvY2FsZSkgIT09IC0xKSB7XG4gICAgICAgICAgbG9jYWxlID0gcGFyZW50TG9jYWxlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2goYEFuZ3VsYXJDb21waWxlclBsdWdpbjogVW5hYmxlIHRvIGxvYWQgdGhlIGxvY2FsZSBkYXRhIGZpbGUgYCArXG4gICAgICAgICAgICBgXCJAYW5ndWxhci9jb21tb24vbG9jYWxlcy8ke2xvY2FsZX1cIiwgYCArXG4gICAgICAgICAgICBgcGxlYXNlIGNoZWNrIHRoYXQgXCIke2xvY2FsZX1cIiBpcyBhIHZhbGlkIGxvY2FsZSBpZC5cbiAgICAgICAgICAgIElmIG5lZWRlZCwgeW91IGNhbiB1c2UgXCJyZWdpc3RlckxvY2FsZURhdGFcIiBtYW51YWxseS5gKTtcblxuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGxvY2FsZTtcbiAgfVxufVxuIl19