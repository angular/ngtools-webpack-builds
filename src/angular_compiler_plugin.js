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
const compiler_cli_1 = require("@angular/compiler-cli");
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const entry_resolver_1 = require("./entry_resolver");
const gather_diagnostics_1 = require("./gather_diagnostics");
const lazy_routes_1 = require("./lazy_routes");
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
        // Contains `moduleImportPath#exportName` => `fullModulePath`.
        this._lazyRoutes = Object.create(null);
        this._transformers = [];
        this._platformTransformers = null;
        this._JitMode = false;
        this._emitSkipped = true;
        this._changedFileExtensions = new Set(['ts', 'tsx', 'html', 'css']);
        // Webpack plugin.
        this._firstRun = true;
        this._warnings = [];
        this._errors = [];
        // TypeChecker process.
        this._forkTypeChecker = true;
        this._forkedTypeCheckerInitialized = false;
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
        return compiler_cli_1.VERSION && parseInt(compiler_cli_1.VERSION.major) >= 5;
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
        // Parse the tsconfig contents.
        const config = compiler_cli_1.readConfiguration(this._tsConfigPath);
        if (config.errors && config.errors.length) {
            throw new Error(compiler_cli_1.formatDiagnostics(config.errors));
        }
        this._rootNames = config.rootNames;
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
    async _createOrUpdateProgram() {
        // Get the root files from the ts config.
        // When a new root name (like a lazy route) is added, it won't be available from
        // following imports on the existing files, so we need to get the new list of root files.
        const config = compiler_cli_1.readConfiguration(this._tsConfigPath);
        this._rootNames = config.rootNames;
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
        }
        else {
            benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
            // Create the Angular program.
            this._program = compiler_cli_1.createProgram({
                rootNames: this._rootNames,
                options: this._compilerOptions,
                host: this._compilerHost,
                oldProgram: this._program,
            });
            benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
            benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync');
            await this._program.loadNgStructureAsync();
            benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync');
            const newFiles = this._program.getTsProgram()
                .getSourceFiles().filter(sf => !oldFiles.has(sf.fileName));
            for (const newFile of newFiles) {
                this._compilerHost.invalidate(newFile.fileName);
            }
        }
        // If there's still no entryModule try to resolve from mainPath.
        if (!this._entryModule && this._mainPath) {
            benchmark_1.time('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
            this._entryModule = entry_resolver_1.resolveEntryModuleFromMain(this._mainPath, this._compilerHost, this._getTsProgram());
            benchmark_1.timeEnd('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
        }
    }
    _getLazyRoutesFromNgtools() {
        try {
            benchmark_1.time('AngularCompilerPlugin._getLazyRoutesFromNgtools');
            const result = compiler_cli_1.__NGTOOLS_PRIVATE_API_2.listLazyRoutes({
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
            this._compilerHost = compiler_cli_1.createCompilerHost({
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
            cmf.hooks.afterResolve.tapPromise('angular-compiler', async (result) => {
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
            });
        });
        // Create and destroy forked type checker on watch mode.
        compiler.hooks.watchRun.tap('angular-compiler', () => {
            if (this._forkTypeChecker && !this._typeCheckerProcess) {
                this._createForkedTypeChecker();
            }
        });
        compiler.hooks.watchClose.tap('angular-compiler', () => this._killForkedTypeChecker());
        // Remake the plugin on each compilation.
        compiler.hooks.make.tapPromise('angular-compiler', compilation => this._donePromise = this._make(compilation));
        compiler.hooks.invalid.tap('angular-compiler', () => this._firstRun = false);
        compiler.hooks.afterEmit.tap('angular-compiler', compilation => {
            // tslint:disable-next-line:no-any
            compilation._ngToolsWebpackPluginInstance = null;
        });
        compiler.hooks.done.tap('angular-compiler', () => {
            this._donePromise = null;
        });
        compiler.hooks.afterResolvers.tap('angular-compiler', compiler => {
            // tslint:disable-next-line:no-any
            compiler.resolverFactory.hooks.resolver
                .for('normal')
                // tslint:disable-next-line:no-any
                .tap('angular-compiler', (resolver) => {
                new paths_plugin_1.TypeScriptPathsPlugin(this._compilerOptions).apply(resolver);
            });
            compiler.hooks.normalModuleFactory.tap('angular-compiler', nmf => {
                // Virtual file system.
                // TODO: consider if it's better to remove this plugin and instead make it wait on the
                // VirtualFileSystemDecorator.
                // Wait for the plugin to be done when requesting `.ts` files directly (entry points), or
                // when the issuer is a `.ts` or `.ngfactory.js` file.
                nmf.hooks.beforeResolve.tapPromise('angular-compiler', async (request) => {
                    if (this.done && request) {
                        const name = request.request;
                        const issuer = request.contextInfo.issuer;
                        if (name.endsWith('.ts') || name.endsWith('.tsx')
                            || (issuer && /\.ts|ngfactory\.js$/.test(issuer))) {
                            try {
                                await this.done;
                            }
                            catch (_a) { }
                        }
                    }
                    return request;
                });
            });
        });
    }
    async _make(compilation) {
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
        try {
            await this._update();
            this.pushCompilationErrors(compilation);
        }
        catch (err) {
            compilation.errors.push(err);
            this.pushCompilationErrors(compilation);
        }
        benchmark_1.timeEnd('AngularCompilerPlugin._make');
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
    async _update() {
        benchmark_1.time('AngularCompilerPlugin._update');
        // We only want to update on TS and template changes, but all kinds of files are on this
        // list, like package.json and .ngsummary.json files.
        const changedFiles = this._getChangedCompilationFiles();
        // If nothing we care about changed and it isn't the first run, don't do anything.
        if (changedFiles.length === 0 && !this._firstRun) {
            return Promise.resolve();
        }
        // Make a new program and load the Angular structure.
        await this._createOrUpdateProgram();
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
            const message = compiler_cli_1.formatDiagnostics(errors);
            this._errors.push(new Error(message));
        }
        if (warnings.length > 0) {
            const message = compiler_cli_1.formatDiagnostics(warnings);
            this._warnings.push(message);
        }
        this._emitSkipped = !emitResult || emitResult.emitSkipped;
        // Reset changed files on successful compilation.
        if (!this._emitSkipped && this._errors.length === 0) {
            this._compilerHost.resetChangedFileTracker();
        }
        benchmark_1.timeEnd('AngularCompilerPlugin._update');
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
                    const emitFlags = extractI18n ? compiler_cli_1.EmitFlags.I18nBundle : compiler_cli_1.EmitFlags.Default;
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
                code = compiler_cli_1.DEFAULT_ERROR_CODE;
            }
            else {
                errMsg = e.stack;
                // It is not a syntax error we might have a program with unknown state, discard it.
                this._program = null;
                code = compiler_cli_1.UNKNOWN_ERROR_CODE;
            }
            allDiagnostics.push({ category: ts.DiagnosticCategory.Error, messageText: errMsg, code, source: compiler_cli_1.SOURCE });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FBbUc7QUFDbkcsd0RBZStCO0FBQy9CLGlEQUFnRTtBQUNoRSx5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLGlDQUFpQztBQUVqQywyQ0FBNEM7QUFDNUMsbURBQXlFO0FBQ3pFLHFEQUE4RDtBQUM5RCw2REFBb0U7QUFDcEUsK0NBQTZEO0FBQzdELGlEQUF1RDtBQUN2RCx1REFBMEQ7QUFDMUQsaURBU3dCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFBNEU7QUFDNUUsbUZBR3lDO0FBTXpDLDZEQUF3RDtBQUV4RCxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7QUEyQ3RDLElBQVksUUFHWDtBQUhELFdBQVksUUFBUTtJQUNsQiw2Q0FBTyxDQUFBO0lBQ1AsMkNBQU0sQ0FBQTtBQUNSLENBQUMsRUFIVyxRQUFRLEdBQVIsZ0JBQVEsS0FBUixnQkFBUSxRQUduQjtBQUVELE1BQWEscUJBQXFCO0lBNENoQyxZQUFZLE9BQXFDO1FBbENqRCw4REFBOEQ7UUFDdEQsZ0JBQVcsR0FBaUIsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUtoRCxrQkFBYSxHQUEyQyxFQUFFLENBQUM7UUFDM0QsMEJBQXFCLEdBQWtELElBQUksQ0FBQztRQUU1RSxhQUFRLEdBQUcsS0FBSyxDQUFDO1FBQ2pCLGlCQUFZLEdBQUcsSUFBSSxDQUFDO1FBQ3BCLDJCQUFzQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUV2RSxrQkFBa0I7UUFDVixjQUFTLEdBQUcsSUFB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QUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBRXhDLElBQUksU0FBUyxDQUFDO1lBQ2QsTUFBTSxnQkFBZ0IsR0FBRyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNqRSxLQUFLLE1BQU0sQ0FBQyxJQUFJLE9BQU8sRUFBRTtnQkFDdkIsSUFBSSxDQUFDLENBQUMsV0FBVyxFQUFFLEtBQUssZ0JBQWdCLEVBQUU7b0JBQ3hDLFNBQVMsR0FBRyxDQUFDLENBQUM7b0JBQ2QsTUFBTTtpQkFDUDthQUNGO1lBRUQsSUFBSSxTQUFTLEVBQUU7Z0JBQ2IsTUFBTSxHQUFHLFNBQVMsQ0FBQzthQUNwQjtpQkFBTTtnQkFDTCw0QkFBNEI7Z0JBQzVCLE1BQU0sWUFBWSxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDcEQsSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFO29CQUN4QyxNQUFNLEdBQUcsWUFBWSxDQUFDO2lCQUN2QjtxQkFBTTtvQkFDTCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyw2REFBNkQ7d0JBQy9FLDRCQUE0QixNQUFNLEtBQUs7d0JBQ3ZDLHNCQUFzQixNQUFNO2tFQUMwQixDQUFDLENBQUM7b0JBRTFELE9BQU8sSUFBSSxDQUFDO2lCQUNiO2FBQ0Y7U0FDRjtRQUVELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7Q0FDRjtBQTVqQ0Qsc0RBNGpDQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCB7IFBhdGgsIGRpcm5hbWUsIGdldFN5c3RlbVBhdGgsIG5vcm1hbGl6ZSwgcmVzb2x2ZSwgdmlydHVhbEZzIH0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHtcbiAgQ29tcGlsZXJIb3N0LFxuICBDb21waWxlck9wdGlvbnMsXG4gIERFRkFVTFRfRVJST1JfQ09ERSxcbiAgRGlhZ25vc3RpYyxcbiAgRW1pdEZsYWdzLFxuICBQcm9ncmFtLFxuICBTT1VSQ0UsXG4gIFVOS05PV05fRVJST1JfQ09ERSxcbiAgVkVSU0lPTixcbiAgX19OR1RPT0xTX1BSSVZBVEVfQVBJXzIsXG4gIGNyZWF0ZUNvbXBpbGVySG9zdCxcbiAgY3JlYXRlUHJvZ3JhbSxcbiAgZm9ybWF0RGlhZ25vc3RpY3MsXG4gIHJlYWRDb25maWd1cmF0aW9uLFxufSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBGb3JrT3B0aW9ucywgZm9yayB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgQ29tcGlsZXIsIGNvbXBpbGF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCwgd29ya2Fyb3VuZFJlc29sdmUgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4gfSBmcm9tICcuL2VudHJ5X3Jlc29sdmVyJztcbmltcG9ydCB7IGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBMYXp5Um91dGVNYXAsIGZpbmRMYXp5Um91dGVzIH0gZnJvbSAnLi9sYXp5X3JvdXRlcyc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQge1xuICBleHBvcnRMYXp5TW9kdWxlTWFwLFxuICBleHBvcnROZ0ZhY3RvcnksXG4gIGZpbmRSZXNvdXJjZXMsXG4gIHJlZ2lzdGVyTG9jYWxlRGF0YSxcbiAgcmVtb3ZlRGVjb3JhdG9ycyxcbiAgcmVwbGFjZUJvb3RzdHJhcCxcbiAgcmVwbGFjZVJlc291cmNlcyxcbiAgcmVwbGFjZVNlcnZlckJvb3RzdHJhcCxcbn0gZnJvbSAnLi90cmFuc2Zvcm1lcnMnO1xuaW1wb3J0IHsgY29sbGVjdERlZXBOb2RlcyB9IGZyb20gJy4vdHJhbnNmb3JtZXJzL2FzdF9oZWxwZXJzJztcbmltcG9ydCB7IEFVVE9fU1RBUlRfQVJHLCBJbml0TWVzc2FnZSwgVXBkYXRlTWVzc2FnZSB9IGZyb20gJy4vdHlwZV9jaGVja2VyJztcbmltcG9ydCB7XG4gIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLFxuICBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yLFxufSBmcm9tICcuL3ZpcnR1YWxfZmlsZV9zeXN0ZW1fZGVjb3JhdG9yJztcbmltcG9ydCB7XG4gIENhbGxiYWNrLFxuICBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcbmltcG9ydCB7IFdlYnBhY2tJbnB1dEhvc3QgfSBmcm9tICcuL3dlYnBhY2staW5wdXQtaG9zdCc7XG5cbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHt9XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3Ige1xuICBuZXcobW9kdWxlUGF0aDogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3k7XG59XG5cbi8qKlxuICogT3B0aW9uIENvbnN0YW50c1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMge1xuICBzb3VyY2VNYXA/OiBib29sZWFuO1xuICB0c0NvbmZpZ1BhdGg6IHN0cmluZztcbiAgYmFzZVBhdGg/OiBzdHJpbmc7XG4gIGVudHJ5TW9kdWxlPzogc3RyaW5nO1xuICBtYWluUGF0aD86IHN0cmluZztcbiAgc2tpcENvZGVHZW5lcmF0aW9uPzogYm9vbGVhbjtcbiAgaG9zdFJlcGxhY2VtZW50UGF0aHM/OiB7IFtwYXRoOiBzdHJpbmddOiBzdHJpbmcgfSB8ICgocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcpO1xuICBmb3JrVHlwZUNoZWNrZXI/OiBib29sZWFuO1xuICBpMThuSW5GaWxlPzogc3RyaW5nO1xuICBpMThuSW5Gb3JtYXQ/OiBzdHJpbmc7XG4gIGkxOG5PdXRGaWxlPzogc3RyaW5nO1xuICBpMThuT3V0Rm9ybWF0Pzogc3RyaW5nO1xuICBsb2NhbGU/OiBzdHJpbmc7XG4gIG1pc3NpbmdUcmFuc2xhdGlvbj86IHN0cmluZztcbiAgcGxhdGZvcm0/OiBQTEFURk9STTtcbiAgbmFtZUxhenlGaWxlcz86IGJvb2xlYW47XG5cbiAgLy8gYWRkZWQgdG8gdGhlIGxpc3Qgb2YgbGF6eSByb3V0ZXNcbiAgYWRkaXRpb25hbExhenlNb2R1bGVzPzogeyBbbW9kdWxlOiBzdHJpbmddOiBzdHJpbmcgfTtcblxuICAvLyBUaGUgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IG9mIGNvcnJlY3QgV2VicGFjayBjb21waWxhdGlvbi5cbiAgLy8gVGhpcyBpcyBuZWVkZWQgd2hlbiB0aGVyZSBhcmUgbXVsdGlwbGUgV2VicGFjayBpbnN0YWxscy5cbiAgY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I/OiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjtcblxuICAvLyBVc2UgdHNjb25maWcgdG8gaW5jbHVkZSBwYXRoIGdsb2JzLlxuICBjb21waWxlck9wdGlvbnM/OiB0cy5Db21waWxlck9wdGlvbnM7XG5cbiAgaG9zdD86IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPjtcbiAgcGxhdGZvcm1UcmFuc2Zvcm1lcnM/OiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXTtcbn1cblxuZXhwb3J0IGVudW0gUExBVEZPUk0ge1xuICBCcm93c2VyLFxuICBTZXJ2ZXIsXG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyQ29tcGlsZXJQbHVnaW4ge1xuICBwcml2YXRlIF9vcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zO1xuXG4gIC8vIFRTIGNvbXBpbGF0aW9uLlxuICBwcml2YXRlIF9jb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSBfcHJvZ3JhbTogKHRzLlByb2dyYW0gfCBQcm9ncmFtKSB8IG51bGw7XG4gIHByaXZhdGUgX2NvbXBpbGVySG9zdDogV2VicGFja0NvbXBpbGVySG9zdCAmIENvbXBpbGVySG9zdDtcbiAgcHJpdmF0ZSBfbW9kdWxlUmVzb2x1dGlvbkNhY2hlOiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG4gIHByaXZhdGUgX3Jlc291cmNlTG9hZGVyOiBXZWJwYWNrUmVzb3VyY2VMb2FkZXI7XG4gIC8vIENvbnRhaW5zIGBtb2R1bGVJbXBvcnRQYXRoI2V4cG9ydE5hbWVgID0+IGBmdWxsTW9kdWxlUGF0aGAuXG4gIHByaXZhdGUgX2xhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHByaXZhdGUgX3RzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF9lbnRyeU1vZHVsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfbWFpblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBfYmFzZVBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfdHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSA9IFtdO1xuICBwcml2YXRlIF9wbGF0Zm9ybVRyYW5zZm9ybWVyczogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W10gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfcGxhdGZvcm06IFBMQVRGT1JNO1xuICBwcml2YXRlIF9KaXRNb2RlID0gZmFsc2U7XG4gIHByaXZhdGUgX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfY2hhbmdlZEZpbGVFeHRlbnNpb25zID0gbmV3IFNldChbJ3RzJywgJ3RzeCcsICdodG1sJywgJ2NzcyddKTtcblxuICAvLyBXZWJwYWNrIHBsdWdpbi5cbiAgcHJpdmF0ZSBfZmlyc3RSdW4gPSB0cnVlO1xuICBwcml2YXRlIF9kb25lUHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGw7XG4gIHByaXZhdGUgX25vcm1hbGl6ZWRMb2NhbGU6IHN0cmluZyB8IG51bGw7XG4gIHByaXZhdGUgX3dhcm5pbmdzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcbiAgcHJpdmF0ZSBfZXJyb3JzOiAoc3RyaW5nIHwgRXJyb3IpW10gPSBbXTtcbiAgcHJpdmF0ZSBfY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I6IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFR5cGVDaGVja2VyIHByb2Nlc3MuXG4gIHByaXZhdGUgX2ZvcmtUeXBlQ2hlY2tlciA9IHRydWU7XG4gIHByaXZhdGUgX3R5cGVDaGVja2VyUHJvY2VzczogQ2hpbGRQcm9jZXNzIHwgbnVsbDtcbiAgcHJpdmF0ZSBfZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IGZhbHNlO1xuXG4gIHByaXZhdGUgZ2V0IF9uZ0NvbXBpbGVyU3VwcG9ydHNOZXdBcGkoKSB7XG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuICEhKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkubGlzdExhenlSb3V0ZXM7XG4gICAgfVxuICB9XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIHRoaXMuX29wdGlvbnMgPSBPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zKTtcbiAgICB0aGlzLl9zZXR1cE9wdGlvbnModGhpcy5fb3B0aW9ucyk7XG4gIH1cblxuICBnZXQgb3B0aW9ucygpIHsgcmV0dXJuIHRoaXMuX29wdGlvbnM7IH1cbiAgZ2V0IGRvbmUoKSB7IHJldHVybiB0aGlzLl9kb25lUHJvbWlzZTsgfVxuICBnZXQgZW50cnlNb2R1bGUoKSB7XG4gICAgaWYgKCF0aGlzLl9lbnRyeU1vZHVsZSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGNvbnN0IHNwbGl0dGVkID0gdGhpcy5fZW50cnlNb2R1bGUuc3BsaXQoLygjW2EtekEtWl9dKFtcXHddKykpJC8pO1xuICAgIGNvbnN0IHBhdGggPSBzcGxpdHRlZFswXTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSAhIXNwbGl0dGVkWzFdID8gc3BsaXR0ZWRbMV0uc3Vic3RyaW5nKDEpIDogJ2RlZmF1bHQnO1xuXG4gICAgcmV0dXJuIHsgcGF0aCwgY2xhc3NOYW1lIH07XG4gIH1cblxuICBnZXQgdHlwZUNoZWNrZXIoKTogdHMuVHlwZUNoZWNrZXIgfCBudWxsIHtcbiAgICBjb25zdCB0c1Byb2dyYW0gPSB0aGlzLl9nZXRUc1Byb2dyYW0oKTtcblxuICAgIHJldHVybiB0c1Byb2dyYW0gPyB0c1Byb2dyYW0uZ2V0VHlwZUNoZWNrZXIoKSA6IG51bGw7XG4gIH1cblxuICBzdGF0aWMgaXNTdXBwb3J0ZWQoKSB7XG4gICAgcmV0dXJuIFZFUlNJT04gJiYgcGFyc2VJbnQoVkVSU0lPTi5tYWpvcikgPj0gNTtcbiAgfVxuXG4gIHByaXZhdGUgX3NldHVwT3B0aW9ucyhvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9zZXR1cE9wdGlvbnMnKTtcbiAgICAvLyBGaWxsIGluIHRoZSBtaXNzaW5nIG9wdGlvbnMuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCd0c0NvbmZpZ1BhdGgnKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNdXN0IHNwZWNpZnkgXCJ0c0NvbmZpZ1BhdGhcIiBpbiB0aGUgY29uZmlndXJhdGlvbiBvZiBAbmd0b29scy93ZWJwYWNrLicpO1xuICAgIH1cbiAgICAvLyBUUyByZXByZXNlbnRzIHBhdGhzIGludGVybmFsbHkgd2l0aCAnLycgYW5kIGV4cGVjdHMgdGhlIHRzY29uZmlnIHBhdGggdG8gYmUgaW4gdGhpcyBmb3JtYXRcbiAgICB0aGlzLl90c0NvbmZpZ1BhdGggPSBvcHRpb25zLnRzQ29uZmlnUGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG5cbiAgICAvLyBDaGVjayB0aGUgYmFzZSBwYXRoLlxuICAgIGNvbnN0IG1heWJlQmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgdGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICBsZXQgYmFzZVBhdGggPSBtYXliZUJhc2VQYXRoO1xuICAgIGlmIChmcy5zdGF0U3luYyhtYXliZUJhc2VQYXRoKS5pc0ZpbGUoKSkge1xuICAgICAgYmFzZVBhdGggPSBwYXRoLmRpcm5hbWUoYmFzZVBhdGgpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5iYXNlUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCBvcHRpb25zLmJhc2VQYXRoKTtcbiAgICB9XG5cbiAgICAvLyBQYXJzZSB0aGUgdHNjb25maWcgY29udGVudHMuXG4gICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICBpZiAoY29uZmlnLmVycm9ycyAmJiBjb25maWcuZXJyb3JzLmxlbmd0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGZvcm1hdERpYWdub3N0aWNzKGNvbmZpZy5lcnJvcnMpKTtcbiAgICB9XG5cbiAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyA9IHsgLi4uY29uZmlnLm9wdGlvbnMsIC4uLm9wdGlvbnMuY29tcGlsZXJPcHRpb25zIH07XG4gICAgdGhpcy5fYmFzZVBhdGggPSBjb25maWcub3B0aW9ucy5iYXNlUGF0aCB8fCBiYXNlUGF0aCB8fCAnJztcblxuICAgIC8vIE92ZXJ3cml0ZSBvdXREaXIgc28gd2UgY2FuIGZpbmQgZ2VuZXJhdGVkIGZpbGVzIG5leHQgdG8gdGhlaXIgLnRzIG9yaWdpbiBpbiBjb21waWxlckhvc3QuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm91dERpciA9ICcnO1xuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zdXBwcmVzc091dHB1dFBhdGhDaGVjayA9IHRydWU7XG5cbiAgICAvLyBEZWZhdWx0IHBsdWdpbiBzb3VyY2VNYXAgdG8gY29tcGlsZXIgb3B0aW9ucyBzZXR0aW5nLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc291cmNlTWFwJykpIHtcbiAgICAgIG9wdGlvbnMuc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCB8fCBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBGb3JjZSB0aGUgcmlnaHQgc291cmNlbWFwIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuc291cmNlTWFwKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdHJ1ZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgLy8gV2Ugd2lsbCBzZXQgdGhlIHNvdXJjZSB0byB0aGUgZnVsbCBwYXRoIG9mIHRoZSBmaWxlIGluIHRoZSBsb2FkZXIsIHNvIHdlIGRvbid0XG4gICAgICAvLyBuZWVkIHNvdXJjZVJvb3QgaGVyZS5cbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgLy8gV2Ugd2FudCB0byBhbGxvdyBlbWl0dGluZyB3aXRoIGVycm9ycyBzbyB0aGF0IGltcG9ydHMgY2FuIGJlIGFkZGVkXG4gICAgLy8gdG8gdGhlIHdlYnBhY2sgZGVwZW5kZW5jeSB0cmVlIGFuZCByZWJ1aWxkcyB0cmlnZ2VyZWQgYnkgZmlsZSBlZGl0cy5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubm9FbWl0T25FcnJvciA9IGZhbHNlO1xuXG4gICAgLy8gU2V0IEpJVCAobm8gY29kZSBnZW5lcmF0aW9uKSBvciBBT1QgbW9kZS5cbiAgICBpZiAob3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fSml0TW9kZSA9IG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgaTE4biBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZpbGUgPSBvcHRpb25zLmkxOG5JbkZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5JbkZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRm9ybWF0ID0gb3B0aW9ucy5pMThuSW5Gb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSA9IG9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmkxOG5PdXRGb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGb3JtYXQgPSBvcHRpb25zLmkxOG5PdXRGb3JtYXQ7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmxvY2FsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dExvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSA9IHRoaXMuX3ZhbGlkYXRlTG9jYWxlKG9wdGlvbnMubG9jYWxlKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5NaXNzaW5nVHJhbnNsYXRpb25zID1cbiAgICAgICAgb3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gYXMgJ2Vycm9yJyB8ICd3YXJuaW5nJyB8ICdpZ25vcmUnO1xuICAgIH1cblxuICAgIC8vIFByb2Nlc3MgZm9ya2VkIHR5cGUgY2hlY2tlciBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLmZvcmtUeXBlQ2hlY2tlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBvcHRpb25zLmZvcmtUeXBlQ2hlY2tlcjtcbiAgICB9XG5cbiAgICAvLyBBZGQgY3VzdG9tIHBsYXRmb3JtIHRyYW5zZm9ybWVycy5cbiAgICBpZiAob3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyA9IG9wdGlvbnMucGxhdGZvcm1UcmFuc2Zvcm1lcnM7XG4gICAgfVxuXG4gICAgLy8gRGVmYXVsdCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgdG8gdGhlIG9uZSB3ZSBjYW4gaW1wb3J0IGZyb20gaGVyZS5cbiAgICAvLyBGYWlsaW5nIHRvIHVzZSB0aGUgcmlnaHQgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHdpbGwgdGhyb3cgdGhlIGVycm9yIGJlbG93OlxuICAgIC8vIFwiTm8gbW9kdWxlIGZhY3RvcnkgYXZhaWxhYmxlIGZvciBkZXBlbmRlbmN5IHR5cGU6IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeVwiXG4gICAgLy8gSG9pc3RpbmcgdG9nZXRoZXIgd2l0aCBwZWVyIGRlcGVuZGVuY2llcyBjYW4gbWFrZSBpdCBzbyB0aGUgaW1wb3J0ZWRcbiAgICAvLyBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgZG9lcyBub3QgY29tZSBmcm9tIHRoZSBzYW1lIFdlYnBhY2sgaW5zdGFuY2UgdGhhdCBpcyB1c2VkXG4gICAgLy8gaW4gdGhlIGNvbXBpbGF0aW9uLiBJbiB0aGF0IGNhc2UsIHdlIGNhbiBwYXNzIHRoZSByaWdodCBvbmUgYXMgYW4gb3B0aW9uIHRvIHRoZSBwbHVnaW4uXG4gICAgdGhpcy5fY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3IgPSBvcHRpb25zLmNvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yXG4gICAgICB8fCByZXF1aXJlKCd3ZWJwYWNrL2xpYi9kZXBlbmRlbmNpZXMvQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Jyk7XG5cbiAgICAvLyBVc2UgZW50cnlNb2R1bGUgaWYgYXZhaWxhYmxlIGluIG9wdGlvbnMsIG90aGVyd2lzZSByZXNvbHZlIGl0IGZyb20gbWFpblBhdGggYWZ0ZXIgcHJvZ3JhbVxuICAgIC8vIGNyZWF0aW9uLlxuICAgIGlmICh0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGU7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuZW50cnlNb2R1bGUgYXMgc3RyaW5nKTsgLy8gdGVtcG9yYXJ5IGNhc3QgZm9yIHR5cGUgaXNzdWVcbiAgICB9XG5cbiAgICAvLyBTZXQgcGxhdGZvcm0uXG4gICAgdGhpcy5fcGxhdGZvcm0gPSBvcHRpb25zLnBsYXRmb3JtIHx8IFBMQVRGT1JNLkJyb3dzZXI7XG5cbiAgICAvLyBNYWtlIHRyYW5zZm9ybWVycy5cbiAgICB0aGlzLl9tYWtlVHJhbnNmb3JtZXJzKCk7XG5cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0VHNQcm9ncmFtKCkge1xuICAgIGlmICghdGhpcy5fcHJvZ3JhbSkge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fSml0TW9kZSA/IHRoaXMuX3Byb2dyYW0gYXMgdHMuUHJvZ3JhbSA6ICh0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0pLmdldFRzUHJvZ3JhbSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZFRzRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiAoay5lbmRzV2l0aCgnLnRzJykgfHwgay5lbmRzV2l0aCgnLnRzeCcpKSAmJiAhay5lbmRzV2l0aCgnLmQudHMnKSlcbiAgICAgIC5maWx0ZXIoayA9PiB0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhrKSk7XG4gIH1cblxuICB1cGRhdGVDaGFuZ2VkRmlsZUV4dGVuc2lvbnMoZXh0ZW5zaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMuYWRkKGV4dGVuc2lvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgZXh0IG9mIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucykge1xuICAgICAgICAgIGlmIChrLmVuZHNXaXRoKGV4dCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAvLyBmb2xsb3dpbmcgaW1wb3J0cyBvbiB0aGUgZXhpc3RpbmcgZmlsZXMsIHNvIHdlIG5lZWQgdG8gZ2V0IHRoZSBuZXcgbGlzdCBvZiByb290IGZpbGVzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgZm9ya2VkIHR5cGUgY2hlY2tlciB3aXRoIGFsbCBjaGFuZ2VkIGNvbXBpbGF0aW9uIGZpbGVzLlxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgdGhpcy5fdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIodGhpcy5fcm9vdE5hbWVzLCB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpKTtcbiAgICB9XG5cbiAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUodGhpcy5fYmFzZVBhdGgsIHggPT4geCk7XG5cbiAgICBjb25zdCB0c1Byb2dyYW0gPSB0aGlzLl9nZXRUc1Byb2dyYW0oKTtcbiAgICBjb25zdCBvbGRGaWxlcyA9IG5ldyBTZXQodHNQcm9ncmFtID9cbiAgICAgIHRzUHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLm1hcChzZiA9PiBzZi5maWxlTmFtZSlcbiAgICAgIDogW10sXG4gICAgKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIHRoaXMuX3Byb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICB0c1Byb2dyYW0sXG4gICAgICApO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICBjb25zdCBuZXdGaWxlcyA9IHRoaXMuX3Byb2dyYW0uZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgcHJvZ3JhbS5cbiAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgIGF3YWl0IHRoaXMuX3Byb2dyYW0ubG9hZE5nU3RydWN0dXJlQXN5bmMoKTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRUc1Byb2dyYW0oKVxuICAgICAgICAuZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHRoZXJlJ3Mgc3RpbGwgbm8gZW50cnlNb2R1bGUgdHJ5IHRvIHJlc29sdmUgZnJvbSBtYWluUGF0aC5cbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4oXG4gICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0TGF6eVJvdXRlc0Zyb21OZ3Rvb2xzKCkge1xuICAgIHRyeSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2dldExhenlSb3V0ZXNGcm9tTmd0b29scycpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gX19OR1RPT0xTX1BSSVZBVEVfQVBJXzIubGlzdExhenlSb3V0ZXMoe1xuICAgICAgICBwcm9ncmFtOiB0aGlzLl9nZXRUc1Byb2dyYW0oKSxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBhbmd1bGFyQ29tcGlsZXJPcHRpb25zOiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9jb21waWxlck9wdGlvbnMsIHtcbiAgICAgICAgICAvLyBnZW5EaXIgc2VlbXMgdG8gc3RpbGwgYmUgbmVlZGVkIGluIEBhbmd1bGFyXFxjb21waWxlci1jbGlcXHNyY1xcY29tcGlsZXJfaG9zdC5qczoyMjYuXG4gICAgICAgICAgZ2VuRGlyOiAnJyxcbiAgICAgICAgfSksXG4gICAgICAgIC8vIFRPRE86IGZpeCBjb21waWxlci1jbGkgdHlwaW5nczsgZW50cnlNb2R1bGUgc2hvdWxkIG5vdCBiZSBzdHJpbmcsIGJ1dCBhbHNvIG9wdGlvbmFsLlxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgICAgIGVudHJ5TW9kdWxlOiB0aGlzLl9lbnRyeU1vZHVsZSAhLFxuICAgICAgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2dldExhenlSb3V0ZXNGcm9tTmd0b29scycpO1xuXG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgLy8gV2Ugc2lsZW5jZSB0aGUgZXJyb3IgdGhhdCB0aGUgQGFuZ3VsYXIvcm91dGVyIGNvdWxkIG5vdCBiZSBmb3VuZC4gSW4gdGhhdCBjYXNlLCB0aGVyZSBpc1xuICAgICAgLy8gYmFzaWNhbGx5IG5vIHJvdXRlIHN1cHBvcnRlZCBieSB0aGUgYXBwIGl0c2VsZi5cbiAgICAgIGlmIChlcnIubWVzc2FnZS5zdGFydHNXaXRoKCdDb3VsZCBub3QgcmVzb2x2ZSBtb2R1bGUgQGFuZ3VsYXIvcm91dGVyJykpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2ZpbmRMYXp5Um91dGVzSW5Bc3QoY2hhbmdlZEZpbGVQYXRoczogc3RyaW5nW10pOiBMYXp5Um91dGVNYXAge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZmluZExhenlSb3V0ZXNJbkFzdCcpO1xuICAgIGNvbnN0IHJlc3VsdDogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIGNoYW5nZWRGaWxlUGF0aHMpIHtcbiAgICAgIGNvbnN0IGZpbGVMYXp5Um91dGVzID0gZmluZExhenlSb3V0ZXMoZmlsZVBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdW5kZWZpbmVkLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMpO1xuICAgICAgZm9yIChjb25zdCByb3V0ZUtleSBvZiBPYmplY3Qua2V5cyhmaWxlTGF6eVJvdXRlcykpIHtcbiAgICAgICAgY29uc3Qgcm91dGUgPSBmaWxlTGF6eVJvdXRlc1tyb3V0ZUtleV07XG4gICAgICAgIHJlc3VsdFtyb3V0ZUtleV0gPSByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGNvbnN0IG5nUHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbTtcbiAgICBpZiAoIW5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSB3YXMgY2FsbGVkIHdpdGggYW4gb2xkIHByb2dyYW0uJyk7XG4gICAgfVxuXG4gICAgY29uc3QgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcygpO1xuXG4gICAgcmV0dXJuIGxhenlSb3V0ZXMucmVkdWNlKFxuICAgICAgKGFjYywgY3VycikgPT4ge1xuICAgICAgICBjb25zdCByZWYgPSBjdXJyLnJvdXRlO1xuICAgICAgICBpZiAocmVmIGluIGFjYyAmJiBhY2NbcmVmXSAhPT0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgKyBgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZDogXCIke3JlZn1cIiBpcyB1c2VkIGluIDIgbG9hZENoaWxkcmVuLCBgXG4gICAgICAgICAgICArIGBidXQgdGhleSBwb2ludCB0byBkaWZmZXJlbnQgbW9kdWxlcyBcIigke2FjY1tyZWZdfSBhbmQgYFxuICAgICAgICAgICAgKyBgXCIke2N1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aH1cIikuIFdlYnBhY2sgY2Fubm90IGRpc3Rpbmd1aXNoIG9uIGNvbnRleHQgYW5kIGBcbiAgICAgICAgICAgICsgJ3dvdWxkIGZhaWwgdG8gbG9hZCB0aGUgcHJvcGVyIG9uZS4nLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgYWNjW3JlZl0gPSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGg7XG5cbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sXG4gICAgICB7fSBhcyBMYXp5Um91dGVNYXAsXG4gICAgKTtcbiAgfVxuXG4gIC8vIFByb2Nlc3MgdGhlIGxhenkgcm91dGVzIGRpc2NvdmVyZWQsIGFkZGluZyB0aGVuIHRvIF9sYXp5Um91dGVzLlxuICAvLyBUT0RPOiBmaW5kIGEgd2F5IHRvIHJlbW92ZSBsYXp5IHJvdXRlcyB0aGF0IGRvbid0IGV4aXN0IGFueW1vcmUuXG4gIC8vIFRoaXMgd2lsbCByZXF1aXJlIGEgcmVnaXN0cnkgb2Yga25vd24gcmVmZXJlbmNlcyB0byBhIGxhenkgcm91dGUsIHJlbW92aW5nIGl0IHdoZW4gbm9cbiAgLy8gbW9kdWxlIHJlZmVyZW5jZXMgaXQgYW55bW9yZS5cbiAgcHJpdmF0ZSBfcHJvY2Vzc0xhenlSb3V0ZXMoZGlzY292ZXJlZExhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCkge1xuICAgIE9iamVjdC5rZXlzKGRpc2NvdmVyZWRMYXp5Um91dGVzKVxuICAgICAgLmZvckVhY2gobGF6eVJvdXRlS2V5ID0+IHtcbiAgICAgICAgY29uc3QgW2xhenlSb3V0ZU1vZHVsZSwgbW9kdWxlTmFtZV0gPSBsYXp5Um91dGVLZXkuc3BsaXQoJyMnKTtcblxuICAgICAgICBpZiAoIWxhenlSb3V0ZU1vZHVsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxhenlSb3V0ZVRTRmlsZSA9IGRpc2NvdmVyZWRMYXp5Um91dGVzW2xhenlSb3V0ZUtleV0ucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICAgICAgICBsZXQgbW9kdWxlUGF0aDogc3RyaW5nLCBtb2R1bGVLZXk6IHN0cmluZztcblxuICAgICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGU7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfSR7bW9kdWxlTmFtZSA/ICcjJyArIG1vZHVsZU5hbWUgOiAnJ31gO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGUucmVwbGFjZSgvKFxcLmQpP1xcLnRzeD8kLywgJycpO1xuICAgICAgICAgIG1vZHVsZVBhdGggKz0gJy5uZ2ZhY3RvcnkuanMnO1xuICAgICAgICAgIGNvbnN0IGZhY3RvcnlNb2R1bGVOYW1lID0gbW9kdWxlTmFtZSA/IGAjJHttb2R1bGVOYW1lfU5nRmFjdG9yeWAgOiAnJztcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9Lm5nZmFjdG9yeSR7ZmFjdG9yeU1vZHVsZU5hbWV9YDtcbiAgICAgICAgfVxuXG4gICAgICAgIG1vZHVsZVBhdGggPSB3b3JrYXJvdW5kUmVzb2x2ZShtb2R1bGVQYXRoKTtcblxuICAgICAgICBpZiAobW9kdWxlS2V5IGluIHRoaXMuX2xhenlSb3V0ZXMpIHtcbiAgICAgICAgICBpZiAodGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldICE9PSBtb2R1bGVQYXRoKSB7XG4gICAgICAgICAgICAvLyBGb3VuZCBhIGR1cGxpY2F0ZSwgdGhpcyBpcyBhbiBlcnJvci5cbiAgICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2goXG4gICAgICAgICAgICAgIG5ldyBFcnJvcihgRHVwbGljYXRlZCBwYXRoIGluIGxvYWRDaGlsZHJlbiBkZXRlY3RlZCBkdXJpbmcgYSByZWJ1aWxkLiBgXG4gICAgICAgICAgICAgICAgKyBgV2Ugd2lsbCB0YWtlIHRoZSBsYXRlc3QgdmVyc2lvbiBkZXRlY3RlZCBhbmQgb3ZlcnJpZGUgaXQgdG8gc2F2ZSByZWJ1aWxkIHRpbWUuIGBcbiAgICAgICAgICAgICAgICArIGBZb3Ugc2hvdWxkIHBlcmZvcm0gYSBmdWxsIGJ1aWxkIHRvIHZhbGlkYXRlIHRoYXQgeW91ciByb3V0ZXMgZG9uJ3Qgb3ZlcmxhcC5gKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEZvdW5kIGEgbmV3IHJvdXRlLCBhZGQgaXQgdG8gdGhlIG1hcC5cbiAgICAgICAgICB0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gPSBtb2R1bGVQYXRoO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIC8vIEJvb3RzdHJhcCB0eXBlIGNoZWNrZXIgaXMgdXNpbmcgbG9jYWwgQ0xJLlxuICAgIGNvbnN0IGc6IGFueSA9IHR5cGVvZiBnbG9iYWwgIT09ICd1bmRlZmluZWQnID8gZ2xvYmFsIDoge307ICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgIGNvbnN0IHR5cGVDaGVja2VyRmlsZTogc3RyaW5nID0gZ1snX0RldktpdElzTG9jYWwnXVxuICAgICAgPyAnLi90eXBlX2NoZWNrZXJfYm9vdHN0cmFwLmpzJ1xuICAgICAgOiAnLi90eXBlX2NoZWNrZXJfd29ya2VyLmpzJztcblxuICAgIGNvbnN0IGRlYnVnQXJnUmVnZXggPSAvLS1pbnNwZWN0KD86LWJya3wtcG9ydCk/fC0tZGVidWcoPzotYnJrfC1wb3J0KS87XG5cbiAgICBjb25zdCBleGVjQXJndiA9IHByb2Nlc3MuZXhlY0FyZ3YuZmlsdGVyKChhcmcpID0+IHtcbiAgICAgIC8vIFJlbW92ZSBkZWJ1ZyBhcmdzLlxuICAgICAgLy8gV29ya2Fyb3VuZCBmb3IgaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy85NDM1XG4gICAgICByZXR1cm4gIWRlYnVnQXJnUmVnZXgudGVzdChhcmcpO1xuICAgIH0pO1xuICAgIC8vIFNpZ25hbCB0aGUgcHJvY2VzcyB0byBzdGFydCBsaXN0ZW5pbmcgZm9yIG1lc3NhZ2VzXG4gICAgLy8gU29sdmVzIGh0dHBzOi8vZ2l0aHViLmNvbS9hbmd1bGFyL2FuZ3VsYXItY2xpL2lzc3Vlcy85MDcxXG4gICAgY29uc3QgZm9ya0FyZ3MgPSBbQVVUT19TVEFSVF9BUkddO1xuICAgIGNvbnN0IGZvcmtPcHRpb25zOiBGb3JrT3B0aW9ucyA9IHsgZXhlY0FyZ3YgfTtcblxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IGZvcmsoXG4gICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCB0eXBlQ2hlY2tlckZpbGUpLFxuICAgICAgZm9ya0FyZ3MsXG4gICAgICBmb3JrT3B0aW9ucyk7XG5cbiAgICAvLyBIYW5kbGUgY2hpbGQgcHJvY2VzcyBleGl0LlxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5vbmNlKCdleGl0JywgKF8sIHNpZ25hbCkgPT4ge1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcblxuICAgICAgLy8gSWYgcHJvY2VzcyBleGl0ZWQgbm90IGJlY2F1c2Ugb2YgU0lHVEVSTSAoc2VlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIpLCB0aGFuIHNvbWV0aGluZ1xuICAgICAgLy8gd2VudCB3cm9uZyBhbmQgaXQgc2hvdWxkIGZhbGxiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gdGhlIG1haW4gdGhyZWFkLlxuICAgICAgaWYgKHNpZ25hbCAhPT0gJ1NJR1RFUk0nKSB7XG4gICAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IGZhbHNlO1xuICAgICAgICBjb25zdCBtc2cgPSAnQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBGb3JrZWQgVHlwZSBDaGVja2VyIGV4aXRlZCB1bmV4cGVjdGVkbHkuICcgK1xuICAgICAgICAgICdGYWxsaW5nIGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiBtYWluIHRocmVhZC4nO1xuICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1zZyk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkKSB7XG4gICAgICB0cmVlS2lsbCh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MucGlkLCAnU0lHVEVSTScpO1xuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcihyb290TmFtZXM6IHN0cmluZ1tdLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlczogc3RyaW5nW10pIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICBpZiAoIXRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IEluaXRNZXNzYWdlKHRoaXMuX2NvbXBpbGVyT3B0aW9ucywgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgICAgdGhpcy5fSml0TW9kZSwgdGhpcy5fcm9vdE5hbWVzKSk7XG4gICAgICAgIHRoaXMuX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSB0cnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IFVwZGF0ZU1lc3NhZ2Uocm9vdE5hbWVzLCBjaGFuZ2VkQ29tcGlsYXRpb25GaWxlcykpO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJlZ2lzdHJhdGlvbiBob29rIGZvciB3ZWJwYWNrIHBsdWdpbi5cbiAgYXBwbHkoY29tcGlsZXI6IENvbXBpbGVyKSB7XG4gICAgLy8gRGVjb3JhdGUgaW5wdXRGaWxlU3lzdGVtIHRvIHNlcnZlIGNvbnRlbnRzIG9mIENvbXBpbGVySG9zdC5cbiAgICAvLyBVc2UgZGVjb3JhdGVkIGlucHV0RmlsZVN5c3RlbSBpbiB3YXRjaEZpbGVTeXN0ZW0uXG4gICAgY29tcGlsZXIuaG9va3MuZW52aXJvbm1lbnQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgLy8gVGhlIHdlYnBhY2sgdHlwZXMgY3VycmVudGx5IGRvIG5vdCBpbmNsdWRlIHRoZXNlXG4gICAgICBjb25zdCBjb21waWxlcldpdGhGaWxlU3lzdGVtcyA9IGNvbXBpbGVyIGFzIENvbXBpbGVyICYge1xuICAgICAgICB3YXRjaEZpbGVTeXN0ZW06IE5vZGVXYXRjaEZpbGVTeXN0ZW1JbnRlcmZhY2UsXG4gICAgICB9O1xuXG4gICAgICBsZXQgaG9zdDogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+ID0gdGhpcy5fb3B0aW9ucy5ob3N0IHx8IG5ldyBXZWJwYWNrSW5wdXRIb3N0KFxuICAgICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0sXG4gICAgICApO1xuXG4gICAgICBsZXQgcmVwbGFjZW1lbnRzOiBNYXA8UGF0aCwgUGF0aD4gfCAoKHBhdGg6IFBhdGgpID0+IFBhdGgpIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zdCByZXBsYWNlbWVudFJlc29sdmVyID0gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocztcbiAgICAgICAgICByZXBsYWNlbWVudHMgPSBwYXRoID0+IG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICBob3N0ID0gbmV3IGNsYXNzIGV4dGVuZHMgdmlydHVhbEZzLlJlc29sdmVySG9zdDxmcy5TdGF0cz4ge1xuICAgICAgICAgICAgX3Jlc29sdmUocGF0aDogUGF0aCkge1xuICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplKHJlcGxhY2VtZW50UmVzb2x2ZXIoZ2V0U3lzdGVtUGF0aChwYXRoKSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0oaG9zdCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gbmV3IE1hcCgpO1xuICAgICAgICAgIGNvbnN0IGFsaWFzSG9zdCA9IG5ldyB2aXJ0dWFsRnMuQWxpYXNIb3N0KGhvc3QpO1xuICAgICAgICAgIGZvciAoY29uc3QgZnJvbSBpbiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkRnJvbSA9IHJlc29sdmUobm9ybWFsaXplKHRoaXMuX2Jhc2VQYXRoKSwgbm9ybWFsaXplKGZyb20pKTtcbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRXaXRoID0gcmVzb2x2ZShcbiAgICAgICAgICAgICAgbm9ybWFsaXplKHRoaXMuX2Jhc2VQYXRoKSxcbiAgICAgICAgICAgICAgbm9ybWFsaXplKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNbZnJvbV0pLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGFsaWFzSG9zdC5hbGlhc2VzLnNldChub3JtYWxpemVkRnJvbSwgbm9ybWFsaXplZFdpdGgpO1xuICAgICAgICAgICAgcmVwbGFjZW1lbnRzLnNldChub3JtYWxpemVkRnJvbSwgbm9ybWFsaXplZFdpdGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBob3N0ID0gYWxpYXNIb3N0O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSB0aGUgd2VicGFjayBjb21waWxlciBob3N0LlxuICAgICAgY29uc3Qgd2VicGFja0NvbXBpbGVySG9zdCA9IG5ldyBXZWJwYWNrQ29tcGlsZXJIb3N0KFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICBob3N0LFxuICAgICAgKTtcblxuICAgICAgLy8gQ3JlYXRlIGFuZCBzZXQgYSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyLlxuICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LnNldFJlc291cmNlTG9hZGVyKHRoaXMuX3Jlc291cmNlTG9hZGVyKTtcblxuICAgICAgLy8gVXNlIHRoZSBXZWJwYWNrQ29tcGlsZXJIb3N0IHdpdGggYSByZXNvdXJjZSBsb2FkZXIgdG8gY3JlYXRlIGFuIEFuZ3VsYXJDb21waWxlckhvc3QuXG4gICAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRzSG9zdDogd2VicGFja0NvbXBpbGVySG9zdCxcbiAgICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG5cbiAgICAgIC8vIFJlc29sdmUgbWFpblBhdGggaWYgcHJvdmlkZWQuXG4gICAgICBpZiAodGhpcy5fb3B0aW9ucy5tYWluUGF0aCkge1xuICAgICAgICB0aGlzLl9tYWluUGF0aCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKHRoaXMuX29wdGlvbnMubWFpblBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnB1dERlY29yYXRvciA9IG5ldyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICApO1xuICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtID0gaW5wdXREZWNvcmF0b3I7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy53YXRjaEZpbGVTeXN0ZW0gPSBuZXcgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgaW5wdXREZWNvcmF0b3IsXG4gICAgICAgIHJlcGxhY2VtZW50cyxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgbGF6eSBtb2R1bGVzIHRvIHRoZSBjb250ZXh0IG1vZHVsZSBmb3IgQGFuZ3VsYXIvY29yZVxuICAgIGNvbXBpbGVyLmhvb2tzLmNvbnRleHRNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNtZiA9PiB7XG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVBhY2thZ2VQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb3JlL3BhY2thZ2UuanNvbicpO1xuXG4gICAgICAvLyBBUEZ2NiBkb2VzIG5vdCBoYXZlIHNpbmdsZSBGRVNNIGFueW1vcmUuIEluc3RlYWQgb2YgdmVyaWZ5aW5nIGlmIHdlJ3JlIHBvaW50aW5nIHRvXG4gICAgICAvLyBGRVNNcywgd2UgcmVzb2x2ZSB0aGUgYEBhbmd1bGFyL2NvcmVgIHBhdGggYW5kIHZlcmlmeSB0aGF0IHRoZSBwYXRoIGZvciB0aGVcbiAgICAgIC8vIG1vZHVsZSBzdGFydHMgd2l0aCBpdC5cblxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVEaXJuYW1lID0gZnMucmVhbHBhdGhTeW5jKHBhdGguZGlybmFtZShhbmd1bGFyQ29yZVBhY2thZ2VQYXRoKSk7XG5cbiAgICAgIGNtZi5ob29rcy5hZnRlclJlc29sdmUudGFwUHJvbWlzZSgnYW5ndWxhci1jb21waWxlcicsIGFzeW5jIHJlc3VsdCA9PiB7XG4gICAgICAgIC8vIEFsdGVyIG9ubHkgcmVxdWVzdCBmcm9tIEFuZ3VsYXIuXG4gICAgICAgIGlmICghcmVzdWx0IHx8ICF0aGlzLmRvbmUgfHwgIXJlc3VsdC5yZXNvdXJjZS5zdGFydHNXaXRoKGFuZ3VsYXJDb3JlRGlybmFtZSkpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZG9uZS50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoaXMgZm9sZGVyIGRvZXMgbm90IGV4aXN0LCBidXQgd2UgbmVlZCB0byBnaXZlIHdlYnBhY2sgYSByZXNvdXJjZS5cbiAgICAgICAgICAgIC8vIFRPRE86IGNoZWNrIGlmIHdlIGNhbid0IGp1c3QgbGVhdmUgaXQgYXMgaXMgKGFuZ3VsYXJDb3JlTW9kdWxlRGlyKS5cbiAgICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICAgICAgIHJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZDogYW55KSA9PiBkLmNyaXRpY2FsID0gZmFsc2UpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LnJlc29sdmVEZXBlbmRlbmNpZXMgPSAoX2ZzOiBhbnksIG9wdGlvbnM6IGFueSwgY2FsbGJhY2s6IENhbGxiYWNrKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IE9iamVjdC5rZXlzKHRoaXMuX2xhenlSb3V0ZXMpXG4gICAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVQYXRoID0gdGhpcy5fbGF6eVJvdXRlc1trZXldO1xuICAgICAgICAgICAgICAgICAgY29uc3QgaW1wb3J0UGF0aCA9IGtleS5zcGxpdCgnIycpWzBdO1xuICAgICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGltcG9ydFBhdGgucmVwbGFjZSgvKFxcLm5nZmFjdG9yeSk/XFwuKGpzfHRzKSQvLCAnJyk7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcihtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcih4ID0+ICEheCk7XG5cbiAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubmFtZUxhenlGaWxlcykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuY2h1bmtOYW1lID0gJ1tyZXF1ZXN0XSc7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgICgpID0+IHVuZGVmaW5lZCxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGFuZCBkZXN0cm95IGZvcmtlZCB0eXBlIGNoZWNrZXIgb24gd2F0Y2ggbW9kZS5cbiAgICBjb21waWxlci5ob29rcy53YXRjaFJ1bi50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy53YXRjaENsb3NlLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpKTtcblxuICAgIC8vIFJlbWFrZSB0aGUgcGx1Z2luIG9uIGVhY2ggY29tcGlsYXRpb24uXG4gICAgY29tcGlsZXIuaG9va3MubWFrZS50YXBQcm9taXNlKFxuICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgY29tcGlsYXRpb24gPT4gdGhpcy5fZG9uZVByb21pc2UgPSB0aGlzLl9tYWtlKGNvbXBpbGF0aW9uKSxcbiAgICApO1xuICAgIGNvbXBpbGVyLmhvb2tzLmludmFsaWQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4gdGhpcy5fZmlyc3RSdW4gPSBmYWxzZSk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJFbWl0LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGF0aW9uID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gbnVsbDtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGVyID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxlciBhcyBhbnkpLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlclxuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVzb2x2ZXI6IGFueSkgPT4ge1xuICAgICAgICAgIG5ldyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4odGhpcy5fY29tcGlsZXJPcHRpb25zKS5hcHBseShyZXNvbHZlcik7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIG5tZiA9PiB7XG4gICAgICAgIC8vIFZpcnR1YWwgZmlsZSBzeXN0ZW0uXG4gICAgICAgIC8vIFRPRE86IGNvbnNpZGVyIGlmIGl0J3MgYmV0dGVyIHRvIHJlbW92ZSB0aGlzIHBsdWdpbiBhbmQgaW5zdGVhZCBtYWtlIGl0IHdhaXQgb24gdGhlXG4gICAgICAgIC8vIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLlxuICAgICAgICAvLyBXYWl0IGZvciB0aGUgcGx1Z2luIHRvIGJlIGRvbmUgd2hlbiByZXF1ZXN0aW5nIGAudHNgIGZpbGVzIGRpcmVjdGx5IChlbnRyeSBwb2ludHMpLCBvclxuICAgICAgICAvLyB3aGVuIHRoZSBpc3N1ZXIgaXMgYSBgLnRzYCBvciBgLm5nZmFjdG9yeS5qc2AgZmlsZS5cbiAgICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwUHJvbWlzZShcbiAgICAgICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAgICAgYXN5bmMgKHJlcXVlc3Q/OiBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuZG9uZSAmJiByZXF1ZXN0KSB7XG4gICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSByZXF1ZXN0LnJlcXVlc3Q7XG4gICAgICAgICAgICAgIGNvbnN0IGlzc3VlciA9IHJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyO1xuICAgICAgICAgICAgICBpZiAobmFtZS5lbmRzV2l0aCgnLnRzJykgfHwgbmFtZS5lbmRzV2l0aCgnLnRzeCcpXG4gICAgICAgICAgICAgICAgICB8fCAoaXNzdWVyICYmIC9cXC50c3xuZ2ZhY3RvcnlcXC5qcyQvLnRlc3QoaXNzdWVyKSkpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5kb25lO1xuICAgICAgICAgICAgICAgIH0gY2F0Y2gge31cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9tYWtlKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgaWYgKChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbik7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fdXBkYXRlKCk7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgIH1cblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBwdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSAoXG4gICAgICB0aGlzLl9tYWluUGF0aCA/IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuX21haW5QYXRoKSA6IHRoaXMuX21haW5QYXRoXG4gICAgKTtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGVcbiAgICAgID8geyBwYXRoOiB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpLCBjbGFzc05hbWU6IHRoaXMuZW50cnlNb2R1bGUuY2xhc3NOYW1lIH1cbiAgICAgIDogdGhpcy5lbnRyeU1vZHVsZTtcbiAgICBjb25zdCBnZXRMYXp5Um91dGVzID0gKCkgPT4gdGhpcy5fbGF6eVJvdXRlcztcbiAgICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+ICh0aGlzLl9nZXRUc1Byb2dyYW0oKSBhcyB0cy5Qcm9ncmFtKS5nZXRUeXBlQ2hlY2tlcigpO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIFJlcGxhY2UgcmVzb3VyY2VzIGluIEpJVC5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VSZXNvdXJjZXMoaXNBcHBQYXRoKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW92ZSB1bm5lZWRlZCBhbmd1bGFyIGRlY29yYXRvcnMuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZW1vdmVEZWNvcmF0b3JzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKC4uLnRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5Ccm93c2VyKSB7XG4gICAgICAgIC8vIElmIHdlIGhhdmUgYSBsb2NhbGUsIGF1dG8gaW1wb3J0IHRoZSBsb2NhbGUgZGF0YSBmaWxlLlxuICAgICAgICAvLyBUaGlzIHRyYW5zZm9ybSBtdXN0IGdvIGJlZm9yZSByZXBsYWNlQm9vdHN0cmFwIGJlY2F1c2UgaXQgbG9va3MgZm9yIHRoZSBlbnRyeSBtb2R1bGVcbiAgICAgICAgLy8gaW1wb3J0LCB3aGljaCB3aWxsIGJlIHJlcGxhY2VkLlxuICAgICAgICBpZiAodGhpcy5fbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlZ2lzdGVyTG9jYWxlRGF0YShpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgLy8gUmVwbGFjZSBib290c3RyYXAgaW4gYnJvd3NlciBBT1QuXG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZUJvb3RzdHJhcChpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5TZXJ2ZXIpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goZXhwb3J0TGF6eU1vZHVsZU1hcChpc01haW5QYXRoLCBnZXRMYXp5Um91dGVzKSk7XG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICAgICAgZXhwb3J0TmdGYWN0b3J5KGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlKSxcbiAgICAgICAgICAgIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF91cGRhdGUoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgICAvLyBXZSBvbmx5IHdhbnQgdG8gdXBkYXRlIG9uIFRTIGFuZCB0ZW1wbGF0ZSBjaGFuZ2VzLCBidXQgYWxsIGtpbmRzIG9mIGZpbGVzIGFyZSBvbiB0aGlzXG4gICAgLy8gbGlzdCwgbGlrZSBwYWNrYWdlLmpzb24gYW5kIC5uZ3N1bW1hcnkuanNvbiBmaWxlcy5cbiAgICBjb25zdCBjaGFuZ2VkRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpO1xuXG4gICAgLy8gSWYgbm90aGluZyB3ZSBjYXJlIGFib3V0IGNoYW5nZWQgYW5kIGl0IGlzbid0IHRoZSBmaXJzdCBydW4sIGRvbid0IGRvIGFueXRoaW5nLlxuICAgIGlmIChjaGFuZ2VkRmlsZXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgYXdhaXQgdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCk7XG5cbiAgICBpZiAodGhpcy5lbnRyeU1vZHVsZSkge1xuICAgICAgLy8gVHJ5IHRvIGZpbmQgbGF6eSByb3V0ZXMgaWYgd2UgaGF2ZSBhbiBlbnRyeSBtb2R1bGUuXG4gICAgICAvLyBXZSBuZWVkIHRvIHJ1biB0aGUgYGxpc3RMYXp5Um91dGVzYCB0aGUgZmlyc3QgdGltZSBiZWNhdXNlIGl0IGFsc28gbmF2aWdhdGVzIGxpYnJhcmllc1xuICAgICAgLy8gYW5kIG90aGVyIHRoaW5ncyB0aGF0IHdlIG1pZ2h0IG1pc3MgdXNpbmcgdGhlIChmYXN0ZXIpIGZpbmRMYXp5Um91dGVzSW5Bc3QuXG4gICAgICAvLyBMYXp5IHJvdXRlcyBtb2R1bGVzIHdpbGwgYmUgcmVhZCB3aXRoIGNvbXBpbGVySG9zdCBhbmQgYWRkZWQgdG8gdGhlIGNoYW5nZWQgZmlsZXMuXG4gICAgICBpZiAodGhpcy5fbmdDb21waWxlclN1cHBvcnRzTmV3QXBpKSB7XG4gICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0oKSk7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKHRoaXMuX2dldExhenlSb3V0ZXNGcm9tTmd0b29scygpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGNoYW5nZWRUc0ZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKTtcbiAgICAgICAgaWYgKGNoYW5nZWRUc0ZpbGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRUc0ZpbGVzKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcykge1xuICAgICAgICB0aGlzLl9wcm9jZXNzTGF6eVJvdXRlcyh0aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gRW1pdCBhbmQgcmVwb3J0IGVycm9ycy5cblxuICAgIC8vIFdlIG5vdyBoYXZlIHRoZSBmaW5hbCBsaXN0IG9mIGNoYW5nZWQgVFMgZmlsZXMuXG4gICAgLy8gR28gdGhyb3VnaCBlYWNoIGNoYW5nZWQgZmlsZSBhbmQgYWRkIHRyYW5zZm9ybXMgYXMgbmVlZGVkLlxuICAgIGNvbnN0IHNvdXJjZUZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKVxuICAgICAgLm1hcCgoZmlsZU5hbWUpID0+ICh0aGlzLl9nZXRUc1Byb2dyYW0oKSBhcyB0cy5Qcm9ncmFtKS5nZXRTb3VyY2VGaWxlKGZpbGVOYW1lKSlcbiAgICAgIC8vIEF0IHRoaXMgcG9pbnQgd2Ugc2hvdWxkbid0IG5lZWQgdG8gZmlsdGVyIG91dCB1bmRlZmluZWQgZmlsZXMsIGJlY2F1c2UgYW55IHRzIGZpbGVcbiAgICAgIC8vIHRoYXQgY2hhbmdlZCBzaG91bGQgYmUgZW1pdHRlZC5cbiAgICAgIC8vIEJ1dCBkdWUgdG8gaG9zdFJlcGxhY2VtZW50UGF0aHMgdGhlcmUgY2FuIGJlIGZpbGVzICh0aGUgZW52aXJvbm1lbnQgZmlsZXMpXG4gICAgICAvLyB0aGF0IGNoYW5nZWQgYnV0IGFyZW4ndCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvbiwgc3BlY2lhbGx5IG9uIGBuZyB0ZXN0YC5cbiAgICAgIC8vIFNvIHdlIGlnbm9yZSBtaXNzaW5nIHNvdXJjZSBmaWxlcyBmaWxlcyBoZXJlLlxuICAgICAgLy8gaG9zdFJlcGxhY2VtZW50UGF0aHMgbmVlZHMgdG8gYmUgZml4ZWQgYW55d2F5IHRvIHRha2UgY2FyZSBvZiB0aGUgZm9sbG93aW5nIGlzc3VlLlxuICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzczMDUjaXNzdWVjb21tZW50LTMzMjE1MDIzMFxuICAgICAgLmZpbHRlcigoeCkgPT4gISF4KSBhcyB0cy5Tb3VyY2VGaWxlW107XG5cbiAgICAvLyBFbWl0IGZpbGVzLlxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgY29uc3QgeyBlbWl0UmVzdWx0LCBkaWFnbm9zdGljcyB9ID0gdGhpcy5fZW1pdChzb3VyY2VGaWxlcyk7XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcblxuICAgIC8vIFJlcG9ydCBkaWFnbm9zdGljcy5cbiAgICBjb25zdCBlcnJvcnMgPSBkaWFnbm9zdGljc1xuICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yKTtcbiAgICBjb25zdCB3YXJuaW5ncyA9IGRpYWdub3N0aWNzXG4gICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuV2FybmluZyk7XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgdGhpcy5fZXJyb3JzLnB1c2gobmV3IEVycm9yKG1lc3NhZ2UpKTtcbiAgICB9XG5cbiAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKHdhcm5pbmdzKTtcbiAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSAhZW1pdFJlc3VsdCB8fCBlbWl0UmVzdWx0LmVtaXRTa2lwcGVkO1xuXG4gICAgLy8gUmVzZXQgY2hhbmdlZCBmaWxlcyBvbiBzdWNjZXNzZnVsIGNvbXBpbGF0aW9uLlxuICAgIGlmICghdGhpcy5fZW1pdFNraXBwZWQgJiYgdGhpcy5fZXJyb3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LnJlc2V0Q2hhbmdlZEZpbGVUcmFja2VyKCk7XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gIH1cblxuICB3cml0ZUkxOG5PdXRGaWxlKCkge1xuICAgIGZ1bmN0aW9uIF9yZWN1cnNpdmVNa0RpcihwOiBzdHJpbmcpIHtcbiAgICAgIGlmICghZnMuZXhpc3RzU3luYyhwKSkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKHApKTtcbiAgICAgICAgZnMubWtkaXJTeW5jKHApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdyaXRlIHRoZSBleHRyYWN0ZWQgbWVzc2FnZXMgdG8gZGlzay5cbiAgICBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKSB7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSk7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZUNvbnRlbnQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUoaTE4bk91dEZpbGVQYXRoKTtcbiAgICAgIGlmIChpMThuT3V0RmlsZUNvbnRlbnQpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShpMThuT3V0RmlsZVBhdGgpKTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhpMThuT3V0RmlsZVBhdGgsIGkxOG5PdXRGaWxlQ29udGVudCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0Q29tcGlsZWRGaWxlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvdXRwdXRGaWxlID0gZmlsZU5hbWUucmVwbGFjZSgvLnRzeD8kLywgJy5qcycpO1xuICAgIGxldCBvdXRwdXRUZXh0OiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZU1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGxldCBlcnJvckRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmICh0aGlzLl9lbWl0U2tpcHBlZCkge1xuICAgICAgY29uc3QgdGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIC8vIElmIHRoZSBjb21waWxhdGlvbiBkaWRuJ3QgZW1pdCBmaWxlcyB0aGlzIHRpbWUsIHRyeSB0byByZXR1cm4gdGhlIGNhY2hlZCBmaWxlcyBmcm9tIHRoZVxuICAgICAgICAvLyBsYXN0IGNvbXBpbGF0aW9uIGFuZCBsZXQgdGhlIGNvbXBpbGF0aW9uIGVycm9ycyBzaG93IHdoYXQncyB3cm9uZy5cbiAgICAgICAgb3V0cHV0VGV4dCA9IHRleHQ7XG4gICAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm90aGluZyB3ZSBjYW4gc2VydmUuIFJldHVybiBhbiBlbXB0eSBzdHJpbmcgdG8gcHJldmVudCBsZW5naHR5IHdlYnBhY2sgZXJyb3JzLFxuICAgICAgICAvLyBhZGQgdGhlIHJlYnVpbGQgd2FybmluZyBpZiBpdCdzIG5vdCB0aGVyZSB5ZXQuXG4gICAgICAgIC8vIFdlIGFsc28gbmVlZCB0byBhbGwgY2hhbmdlZCBmaWxlcyBhcyBkZXBlbmRlbmNpZXMgb2YgdGhpcyBmaWxlLCBzbyB0aGF0IGFsbCBvZiB0aGVtXG4gICAgICAgIC8vIHdpbGwgYmUgd2F0Y2hlZCBhbmQgdHJpZ2dlciBhIHJlYnVpbGQgbmV4dCB0aW1lLlxuICAgICAgICBvdXRwdXRUZXh0ID0gJyc7XG4gICAgICAgIGVycm9yRGVwZW5kZW5jaWVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKVxuICAgICAgICAgIC8vIFRoZXNlIHBhdGhzIGFyZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgICAgICAgIC5tYXAoKHApID0+IHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDaGVjayBpZiB0aGUgVFMgaW5wdXQgZmlsZSBhbmQgdGhlIEpTIG91dHB1dCBmaWxlIGV4aXN0LlxuICAgICAgaWYgKCgoZmlsZU5hbWUuZW5kc1dpdGgoJy50cycpIHx8IGZpbGVOYW1lLmVuZHNXaXRoKCcudHN4JykpXG4gICAgICAgICYmICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhmaWxlTmFtZSkpXG4gICAgICAgIHx8ICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhvdXRwdXRGaWxlLCBmYWxzZSkpIHtcbiAgICAgICAgbGV0IG1zZyA9IGAke2ZpbGVOYW1lfSBpcyBtaXNzaW5nIGZyb20gdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24uIGBcbiAgICAgICAgICArIGBQbGVhc2UgbWFrZSBzdXJlIGl0IGlzIGluIHlvdXIgdHNjb25maWcgdmlhIHRoZSAnZmlsZXMnIG9yICdpbmNsdWRlJyBwcm9wZXJ0eS5gO1xuXG4gICAgICAgIGlmICgvKFxcXFx8XFwvKW5vZGVfbW9kdWxlcyhcXFxcfFxcLykvLnRlc3QoZmlsZU5hbWUpKSB7XG4gICAgICAgICAgbXNnICs9ICdcXG5UaGUgbWlzc2luZyBmaWxlIHNlZW1zIHRvIGJlIHBhcnQgb2YgYSB0aGlyZCBwYXJ0eSBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdUUyBmaWxlcyBpbiBwdWJsaXNoZWQgbGlicmFyaWVzIGFyZSBvZnRlbiBhIHNpZ24gb2YgYSBiYWRseSBwYWNrYWdlZCBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdQbGVhc2Ugb3BlbiBhbiBpc3N1ZSBpbiB0aGUgbGlicmFyeSByZXBvc2l0b3J5IHRvIGFsZXJ0IGl0cyBhdXRob3IgYW5kIGFzayB0aGVtICdcbiAgICAgICAgICAgICsgJ3RvIHBhY2thZ2UgdGhlIGxpYnJhcnkgdXNpbmcgdGhlIEFuZ3VsYXIgUGFja2FnZSBGb3JtYXQgKGh0dHBzOi8vZ29vLmdsL2pCM0dWdikuJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgfVxuXG4gICAgICBvdXRwdXRUZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpIHx8ICcnO1xuICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgIH1cblxuICAgIHJldHVybiB7IG91dHB1dFRleHQsIHNvdXJjZU1hcCwgZXJyb3JEZXBlbmRlbmNpZXMgfTtcbiAgfVxuXG4gIGdldERlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHJlc29sdmVkRmlsZU5hbWUgPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZShmaWxlTmFtZSk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5nZXRTb3VyY2VGaWxlKHJlc29sdmVkRmlsZU5hbWUsIHRzLlNjcmlwdFRhcmdldC5MYXRlc3QpO1xuICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl9jb21waWxlck9wdGlvbnM7XG4gICAgY29uc3QgaG9zdCA9IHRoaXMuX2NvbXBpbGVySG9zdDtcbiAgICBjb25zdCBjYWNoZSA9IHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZTtcblxuICAgIGNvbnN0IGVzSW1wb3J0cyA9IGNvbGxlY3REZWVwTm9kZXM8dHMuSW1wb3J0RGVjbGFyYXRpb24+KHNvdXJjZUZpbGUsXG4gICAgICB0cy5TeW50YXhLaW5kLkltcG9ydERlY2xhcmF0aW9uKVxuICAgICAgLm1hcChkZWNsID0+IHtcbiAgICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKG1vZHVsZU5hbWUsIHJlc29sdmVkRmlsZU5hbWUsIG9wdGlvbnMsIGhvc3QsIGNhY2hlKTtcblxuICAgICAgICBpZiAocmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoeCA9PiB4KTtcblxuICAgIGNvbnN0IHJlc291cmNlSW1wb3J0cyA9IGZpbmRSZXNvdXJjZXMoc291cmNlRmlsZSlcbiAgICAgIC5tYXAoKHJlc291cmNlUmVwbGFjZW1lbnQpID0+IHJlc291cmNlUmVwbGFjZW1lbnQucmVzb3VyY2VQYXRocylcbiAgICAgIC5yZWR1Y2UoKHByZXYsIGN1cnIpID0+IHByZXYuY29uY2F0KGN1cnIpLCBbXSlcbiAgICAgIC5tYXAoKHJlc291cmNlUGF0aCkgPT4gcmVzb2x2ZShkaXJuYW1lKHJlc29sdmVkRmlsZU5hbWUpLCBub3JtYWxpemUocmVzb3VyY2VQYXRoKSkpO1xuXG4gICAgLy8gVGhlc2UgcGF0aHMgYXJlIG1lYW50IHRvIGJlIHVzZWQgYnkgdGhlIGxvYWRlciBzbyB3ZSBtdXN0IGRlbm9ybWFsaXplIHRoZW0uXG4gICAgY29uc3QgdW5pcXVlRGVwZW5kZW5jaWVzID0gbmV3IFNldChbXG4gICAgICAuLi5lc0ltcG9ydHMsXG4gICAgICAuLi5yZXNvdXJjZUltcG9ydHMsXG4gICAgICAuLi50aGlzLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocmVzb2x2ZWRGaWxlTmFtZSkpLFxuICAgIF0ubWFwKChwKSA9PiBwICYmIHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpKTtcblxuICAgIHJldHVybiBbLi4udW5pcXVlRGVwZW5kZW5jaWVzXVxuICAgICAgLmZpbHRlcih4ID0+ICEheCkgYXMgc3RyaW5nW107XG4gIH1cblxuICBnZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZSk7XG4gIH1cblxuICAvLyBUaGlzIGNvZGUgbW9zdGx5IGNvbWVzIGZyb20gYHBlcmZvcm1Db21waWxhdGlvbmAgaW4gYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAuXG4gIC8vIEl0IHNraXBzIHRoZSBwcm9ncmFtIGNyZWF0aW9uIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2UgYGxvYWROZ1N0cnVjdHVyZUFzeW5jKClgLFxuICAvLyBhbmQgdXNlcyBDdXN0b21UcmFuc2Zvcm1lcnMuXG4gIHByaXZhdGUgX2VtaXQoc291cmNlRmlsZXM6IHRzLlNvdXJjZUZpbGVbXSkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdCcpO1xuICAgIGNvbnN0IHByb2dyYW0gPSB0aGlzLl9wcm9ncmFtO1xuICAgIGNvbnN0IGFsbERpYWdub3N0aWNzOiBBcnJheTx0cy5EaWFnbm9zdGljIHwgRGlhZ25vc3RpYz4gPSBbXTtcblxuICAgIGxldCBlbWl0UmVzdWx0OiB0cy5FbWl0UmVzdWx0IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICBjb25zdCB0c1Byb2dyYW0gPSBwcm9ncmFtIGFzIHRzLlByb2dyYW07XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLnRzUHJvZ3JhbS5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCh0aGlzLl9maXJzdFJ1biB8fCAhdGhpcy5fZm9ya1R5cGVDaGVja2VyKSAmJiB0aGlzLl9wcm9ncmFtKSB7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyh0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIGlmICh0aGlzLl9maXJzdFJ1biB8fCBzb3VyY2VGaWxlcy5sZW5ndGggPiAyMCkge1xuICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHsgYmVmb3JlOiB0aGlzLl90cmFuc2Zvcm1lcnMgfSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzb3VyY2VGaWxlcy5mb3JFYWNoKChzZikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCB0aW1lTGFiZWwgPSBgQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzKyR7c2YuZmlsZU5hbWV9Ky5lbWl0YDtcbiAgICAgICAgICAgICAgdGltZSh0aW1lTGFiZWwpO1xuICAgICAgICAgICAgICBlbWl0UmVzdWx0ID0gdHNQcm9ncmFtLmVtaXQoc2YsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gcHJvZ3JhbSBhcyBQcm9ncmFtO1xuXG4gICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgc3RydWN0dXJhbCBkaWFnbm9zdGljcy5cbiAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIFR5cGVTY3JpcHQgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXRUc09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCh0aGlzLl9maXJzdFJ1biB8fCAhdGhpcy5fZm9ya1R5cGVDaGVja2VyKSAmJiB0aGlzLl9wcm9ncmFtKSB7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyh0aGlzLl9wcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZycpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgICAgY29uc3QgZXh0cmFjdEkxOG4gPSAhIXRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICAgICAgICBjb25zdCBlbWl0RmxhZ3MgPSBleHRyYWN0STE4biA/IEVtaXRGbGFncy5JMThuQnVuZGxlIDogRW1pdEZsYWdzLkRlZmF1bHQ7XG4gICAgICAgICAgZW1pdFJlc3VsdCA9IGFuZ3VsYXJQcm9ncmFtLmVtaXQoe1xuICAgICAgICAgICAgZW1pdEZsYWdzLCBjdXN0b21UcmFuc2Zvcm1lcnM6IHtcbiAgICAgICAgICAgICAgYmVmb3JlVHM6IHRoaXMuX3RyYW5zZm9ybWVycyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICBpZiAoZXh0cmFjdEkxOG4pIHtcbiAgICAgICAgICAgIHRoaXMud3JpdGVJMThuT3V0RmlsZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZW1pdCcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LmNhdGNoJyk7XG4gICAgICAvLyBUaGlzIGZ1bmN0aW9uIGlzIGF2YWlsYWJsZSBpbiB0aGUgaW1wb3J0IGJlbG93LCBidXQgdGhpcyB3YXkgd2UgYXZvaWQgdGhlIGRlcGVuZGVuY3kuXG4gICAgICAvLyBpbXBvcnQgeyBpc1N5bnRheEVycm9yIH0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXInO1xuICAgICAgZnVuY3Rpb24gaXNTeW50YXhFcnJvcihlcnJvcjogRXJyb3IpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChlcnJvciBhcyBhbnkpWyduZ1N5bnRheEVycm9yJ107ICAvLyB0c2xpbnQ6ZGlzYWJsZS1saW5lOm5vLWFueVxuICAgICAgfVxuXG4gICAgICBsZXQgZXJyTXNnOiBzdHJpbmc7XG4gICAgICBsZXQgY29kZTogbnVtYmVyO1xuICAgICAgaWYgKGlzU3ludGF4RXJyb3IoZSkpIHtcbiAgICAgICAgLy8gZG9uJ3QgcmVwb3J0IHRoZSBzdGFjayBmb3Igc3ludGF4IGVycm9ycyBhcyB0aGV5IGFyZSB3ZWxsIGtub3duIGVycm9ycy5cbiAgICAgICAgZXJyTXNnID0gZS5tZXNzYWdlO1xuICAgICAgICBjb2RlID0gREVGQVVMVF9FUlJPUl9DT0RFO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZXJyTXNnID0gZS5zdGFjaztcbiAgICAgICAgLy8gSXQgaXMgbm90IGEgc3ludGF4IGVycm9yIHdlIG1pZ2h0IGhhdmUgYSBwcm9ncmFtIHdpdGggdW5rbm93biBzdGF0ZSwgZGlzY2FyZCBpdC5cbiAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IG51bGw7XG4gICAgICAgIGNvZGUgPSBVTktOT1dOX0VSUk9SX0NPREU7XG4gICAgICB9XG4gICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKFxuICAgICAgICB7IGNhdGVnb3J5OiB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IsIG1lc3NhZ2VUZXh0OiBlcnJNc2csIGNvZGUsIHNvdXJjZTogU09VUkNFIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LmNhdGNoJyk7XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdCcpO1xuXG4gICAgcmV0dXJuIHsgcHJvZ3JhbSwgZW1pdFJlc3VsdCwgZGlhZ25vc3RpY3M6IGFsbERpYWdub3N0aWNzIH07XG4gIH1cblxuICBwcml2YXRlIF92YWxpZGF0ZUxvY2FsZShsb2NhbGU6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIEdldCB0aGUgcGF0aCBvZiB0aGUgY29tbW9uIG1vZHVsZS5cbiAgICBjb25zdCBjb21tb25QYXRoID0gcGF0aC5kaXJuYW1lKHJlcXVpcmUucmVzb2x2ZSgnQGFuZ3VsYXIvY29tbW9uL3BhY2thZ2UuanNvbicpKTtcbiAgICAvLyBDaGVjayBpZiB0aGUgbG9jYWxlIGZpbGUgZXhpc3RzXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHBhdGgucmVzb2x2ZShjb21tb25QYXRoLCAnbG9jYWxlcycsIGAke2xvY2FsZX0uanNgKSkpIHtcbiAgICAgIC8vIENoZWNrIGZvciBhbiBhbHRlcm5hdGl2ZSBsb2NhbGUgKGlmIHRoZSBsb2NhbGUgaWQgd2FzIGJhZGx5IGZvcm1hdHRlZCkuXG4gICAgICBjb25zdCBsb2NhbGVzID0gZnMucmVhZGRpclN5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJykpXG4gICAgICAgIC5maWx0ZXIoZmlsZSA9PiBmaWxlLmVuZHNXaXRoKCcuanMnKSlcbiAgICAgICAgLm1hcChmaWxlID0+IGZpbGUucmVwbGFjZSgnLmpzJywgJycpKTtcblxuICAgICAgbGV0IG5ld0xvY2FsZTtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRMb2NhbGUgPSBsb2NhbGUudG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9fL2csICctJyk7XG4gICAgICBmb3IgKGNvbnN0IGwgb2YgbG9jYWxlcykge1xuICAgICAgICBpZiAobC50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkTG9jYWxlKSB7XG4gICAgICAgICAgbmV3TG9jYWxlID0gbDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAobmV3TG9jYWxlKSB7XG4gICAgICAgIGxvY2FsZSA9IG5ld0xvY2FsZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENoZWNrIGZvciBhIHBhcmVudCBsb2NhbGVcbiAgICAgICAgY29uc3QgcGFyZW50TG9jYWxlID0gbm9ybWFsaXplZExvY2FsZS5zcGxpdCgnLScpWzBdO1xuICAgICAgICBpZiAobG9jYWxlcy5pbmRleE9mKHBhcmVudExvY2FsZSkgIT09IC0xKSB7XG4gICAgICAgICAgbG9jYWxlID0gcGFyZW50TG9jYWxlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2goYEFuZ3VsYXJDb21waWxlclBsdWdpbjogVW5hYmxlIHRvIGxvYWQgdGhlIGxvY2FsZSBkYXRhIGZpbGUgYCArXG4gICAgICAgICAgICBgXCJAYW5ndWxhci9jb21tb24vbG9jYWxlcy8ke2xvY2FsZX1cIiwgYCArXG4gICAgICAgICAgICBgcGxlYXNlIGNoZWNrIHRoYXQgXCIke2xvY2FsZX1cIiBpcyBhIHZhbGlkIGxvY2FsZSBpZC5cbiAgICAgICAgICAgIElmIG5lZWRlZCwgeW91IGNhbiB1c2UgXCJyZWdpc3RlckxvY2FsZURhdGFcIiBtYW51YWxseS5gKTtcblxuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGxvY2FsZTtcbiAgfVxufVxuIl19