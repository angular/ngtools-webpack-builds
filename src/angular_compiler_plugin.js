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
const node_1 = require("@angular-devkit/core/node");
const compiler_cli_1 = require("@angular/compiler-cli");
const child_process_1 = require("child_process");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const benchmark_1 = require("./benchmark");
const compiler_host_1 = require("./compiler_host");
const entry_resolver_1 = require("./entry_resolver");
const gather_diagnostics_1 = require("./gather_diagnostics");
const paths_plugin_1 = require("./paths-plugin");
const resource_loader_1 = require("./resource_loader");
const transformers_1 = require("./transformers");
const ast_helpers_1 = require("./transformers/ast_helpers");
const type_checker_1 = require("./type_checker");
const type_checker_messages_1 = require("./type_checker_messages");
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
        this._logger = options.logger || node_1.createConsoleLogger();
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
        // this._forkTypeChecker = false;
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
        if (!this._entryModule && this._mainPath && !this._compilerOptions.enableIvy) {
            benchmark_1.time('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
            this._entryModule = entry_resolver_1.resolveEntryModuleFromMain(this._mainPath, this._compilerHost, this._getTsProgram());
            if (!this.entryModule) {
                this._warnings.push('Lazy routes discovery is not enabled. '
                    + 'Because there is neither an entryModule nor a '
                    + 'statically analyzable bootstrap code in the main file.');
            }
            benchmark_1.timeEnd('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
        }
    }
    _listLazyRoutesFromProgram() {
        let lazyRoutes;
        if (this._JitMode) {
            if (!this.entryModule) {
                return {};
            }
            const ngProgram = compiler_cli_1.createProgram({
                rootNames: this._rootNames,
                options: Object.assign({}, this._compilerOptions, { genDir: '', collectAllErrors: true }),
                host: this._compilerHost,
            });
            lazyRoutes = ngProgram.listLazyRoutes(this.entryModule.path + '#' + this.entryModule.className);
        }
        else {
            lazyRoutes = this._program.listLazyRoutes();
        }
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
        // Handle child messages.
        this._typeCheckerProcess.on('message', message => {
            switch (message.kind) {
                case type_checker_messages_1.MESSAGE_KIND.Log:
                    const logMessage = message;
                    this._logger.log(logMessage.level, `\n${logMessage.message}`);
                    break;
                default:
                    throw new Error(`TypeChecker: Unexpected message received: ${message}.`);
            }
        });
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
                let hostReplacementPaths = {};
                if (this._options.hostReplacementPaths
                    && typeof this._options.hostReplacementPaths != 'function') {
                    hostReplacementPaths = this._options.hostReplacementPaths;
                }
                this._typeCheckerProcess.send(new type_checker_messages_1.InitMessage(this._compilerOptions, this._basePath, this._JitMode, this._rootNames, hostReplacementPaths));
                this._forkedTypeCheckerInitialized = true;
            }
            this._typeCheckerProcess.send(new type_checker_messages_1.UpdateMessage(rootNames, changedCompilationFiles));
        }
    }
    // Registration hook for webpack plugin.
    apply(compiler) {
        // only present for webpack 4.23.0+, assume true otherwise
        const watchMode = compiler.watchMode === undefined ? true : compiler.watchMode;
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
            const webpackCompilerHost = new compiler_host_1.WebpackCompilerHost(this._compilerOptions, this._basePath, host, watchMode);
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
            const angularCoreResourceRoot = fs.realpathSync(path.dirname(angularCorePackagePath));
            cmf.hooks.afterResolve.tapPromise('angular-compiler', async (result) => {
                // Alter only existing request from Angular or one of the additional lazy module resources.
                const isLazyModuleResource = (resource) => resource.startsWith(angularCoreResourceRoot) ||
                    (this.options.additionalLazyModuleResources &&
                        this.options.additionalLazyModuleResources.includes(resource));
                if (!result || !this.done || !isLazyModuleResource(result.resource)) {
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
                                const name = importPath.replace(/(\.ngfactory)?(\.(js|ts))?$/, '');
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
            this._transformers.push(transformers_1.replaceResources(isAppPath, getTypeChecker));
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
            return;
        }
        // Make a new program and load the Angular structure.
        await this._createOrUpdateProgram();
        // Try to find lazy routes if we have an entry module.
        // We need to run the `listLazyRoutes` the first time because it also navigates libraries
        // and other things that we might miss using the (faster) findLazyRoutesInAst.
        // Lazy routes modules will be read with compilerHost and added to the changed files.
        const lazyRouteMap = Object.assign({}, (this._entryModule || !this._JitMode ? this._listLazyRoutesFromProgram() : {}), this._options.additionalLazyModules);
        this._processLazyRoutes(lazyRouteMap);
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
            .map(resourcePath => core_1.resolve(core_1.dirname(resolvedFileName), core_1.normalize(resourcePath)));
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
        const diagMode = (this._firstRun || !this._forkTypeChecker) ?
            gather_diagnostics_1.DiagnosticMode.All : gather_diagnostics_1.DiagnosticMode.Syntactic;
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
                allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(tsProgram, this._JitMode, 'AngularCompilerPlugin._emit.ts', diagMode));
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
                allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(angularProgram, this._JitMode, 'AngularCompilerPlugin._emit.ng', diagMode));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FROEI7QUFDOUIsb0RBQWdFO0FBQ2hFLHdEQWUrQjtBQUMvQixpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9GO0FBQ3BGLGlEQUF1RDtBQUN2RCx1REFBMEQ7QUFDMUQsaURBVXdCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFFd0I7QUFDeEIsbUVBS2lDO0FBQ2pDLG1GQUd5QztBQU16Qyw2REFBd0Q7QUFFeEQsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBNkN0QyxJQUFZLFFBR1g7QUFIRCxXQUFZLFFBQVE7SUFDbEIsNkNBQU8sQ0FBQTtJQUNQLDJDQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsUUFBUSxHQUFSLGdCQUFRLEtBQVIsZ0JBQVEsUUFHbkI7QUFFRCxNQUFhLHFCQUFxQjtJQXVDaEMsWUFBWSxPQUFxQztRQTdCakQsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFFdkUsa0JBQWtCO1FBQ1Ys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QUFNLEdBQUcsU0FBUyxDQUFDO2FBQ3BCO2lCQUFNO2dCQUNMLDRCQUE0QjtnQkFDNUIsTUFBTSxZQUFZLEdBQUcsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNwRCxJQUFJLE9BQU8sQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUU7b0JBQ3hDLE1BQU0sR0FBRyxZQUFZLENBQUM7aUJBQ3ZCO3FCQUFNO29CQUNMLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLDZEQUE2RDt3QkFDL0UsNEJBQTRCLE1BQU0sS0FBSzt3QkFDdkMsc0JBQXNCLE1BQU07a0VBQzBCLENBQUMsQ0FBQztvQkFFMUQsT0FBTyxJQUFJLENBQUM7aUJBQ2I7YUFDRjtTQUNGO1FBRUQsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBN2lDRCxzREE2aUNDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHtcbiAgUGF0aCxcbiAgZGlybmFtZSxcbiAgZ2V0U3lzdGVtUGF0aCxcbiAgbG9nZ2luZyxcbiAgbm9ybWFsaXplLFxuICByZXNvbHZlLFxuICB2aXJ0dWFsRnMsXG59IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBERUZBVUxUX0VSUk9SX0NPREUsXG4gIERpYWdub3N0aWMsXG4gIEVtaXRGbGFncyxcbiAgTGF6eVJvdXRlLFxuICBQcm9ncmFtLFxuICBTT1VSQ0UsXG4gIFVOS05PV05fRVJST1JfQ09ERSxcbiAgVkVSU0lPTixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBDb21waWxlciwgY29tcGlsYXRpb24gfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgRGlhZ25vc3RpY01vZGUsIGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQge1xuICBMYXp5Um91dGVNYXAsXG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHtcbiAgQVVUT19TVEFSVF9BUkcsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyJztcbmltcG9ydCB7XG4gIEluaXRNZXNzYWdlLFxuICBMb2dNZXNzYWdlLFxuICBNRVNTQUdFX0tJTkQsXG4gIFVwZGF0ZU1lc3NhZ2UsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyX21lc3NhZ2VzJztcbmltcG9ydCB7XG4gIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLFxuICBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yLFxufSBmcm9tICcuL3ZpcnR1YWxfZmlsZV9zeXN0ZW1fZGVjb3JhdG9yJztcbmltcG9ydCB7XG4gIENhbGxiYWNrLFxuICBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcbmltcG9ydCB7IFdlYnBhY2tJbnB1dEhvc3QgfSBmcm9tICcuL3dlYnBhY2staW5wdXQtaG9zdCc7XG5cbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHsgfVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yIHtcbiAgbmV3KG1vZHVsZVBhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nKTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5O1xufVxuXG4vKipcbiAqIE9wdGlvbiBDb25zdGFudHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zIHtcbiAgc291cmNlTWFwPzogYm9vbGVhbjtcbiAgdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIGJhc2VQYXRoPzogc3RyaW5nO1xuICBlbnRyeU1vZHVsZT86IHN0cmluZztcbiAgbWFpblBhdGg/OiBzdHJpbmc7XG4gIHNraXBDb2RlR2VuZXJhdGlvbj86IGJvb2xlYW47XG4gIGhvc3RSZXBsYWNlbWVudFBhdGhzPzogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0gfCAoKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nKTtcbiAgZm9ya1R5cGVDaGVja2VyPzogYm9vbGVhbjtcbiAgaTE4bkluRmlsZT86IHN0cmluZztcbiAgaTE4bkluRm9ybWF0Pzogc3RyaW5nO1xuICBpMThuT3V0RmlsZT86IHN0cmluZztcbiAgaTE4bk91dEZvcm1hdD86IHN0cmluZztcbiAgbG9jYWxlPzogc3RyaW5nO1xuICBtaXNzaW5nVHJhbnNsYXRpb24/OiBzdHJpbmc7XG4gIHBsYXRmb3JtPzogUExBVEZPUk07XG4gIG5hbWVMYXp5RmlsZXM/OiBib29sZWFuO1xuICBsb2dnZXI/OiBsb2dnaW5nLkxvZ2dlcjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcz86IHN0cmluZ1tdO1xuXG4gIC8vIFRoZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgb2YgY29ycmVjdCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAvLyBUaGlzIGlzIG5lZWRlZCB3aGVuIHRoZXJlIGFyZSBtdWx0aXBsZSBXZWJwYWNrIGluc3RhbGxzLlxuICBjb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcj86IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0PzogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+O1xuICBwbGF0Zm9ybVRyYW5zZm9ybWVycz86IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdO1xufVxuXG5leHBvcnQgZW51bSBQTEFURk9STSB7XG4gIEJyb3dzZXIsXG4gIFNlcnZlcixcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJDb21waWxlclBsdWdpbiB7XG4gIHByaXZhdGUgX29wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnM7XG5cbiAgLy8gVFMgY29tcGlsYXRpb24uXG4gIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zO1xuICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdO1xuICBwcml2YXRlIF9wcm9ncmFtOiAodHMuUHJvZ3JhbSB8IFByb2dyYW0pIHwgbnVsbDtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuICBwcml2YXRlIF9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU6IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZTtcbiAgcHJpdmF0ZSBfcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgLy8gQ29udGFpbnMgYG1vZHVsZUltcG9ydFBhdGgjZXhwb3J0TmFtZWAgPT4gYGZ1bGxNb2R1bGVQYXRoYC5cbiAgcHJpdmF0ZSBfbGF6eVJvdXRlczogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgcHJpdmF0ZSBfdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX2VudHJ5TW9kdWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF9tYWluUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIF9iYXNlUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF90cmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdID0gW107XG4gIHByaXZhdGUgX3BsYXRmb3JtVHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9wbGF0Zm9ybTogUExBVEZPUk07XG4gIHByaXZhdGUgX0ppdE1vZGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBfZW1pdFNraXBwZWQgPSB0cnVlO1xuICBwcml2YXRlIF9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsndHMnLCAndHN4JywgJ2h0bWwnLCAnY3NzJ10pO1xuXG4gIC8vIFdlYnBhY2sgcGx1Z2luLlxuICBwcml2YXRlIF9maXJzdFJ1biA9IHRydWU7XG4gIHByaXZhdGUgX2RvbmVQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgcHJpdmF0ZSBfbm9ybWFsaXplZExvY2FsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfd2FybmluZ3M6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9lcnJvcnM6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I7XG5cbiAgLy8gVHlwZUNoZWNrZXIgcHJvY2Vzcy5cbiAgcHJpdmF0ZSBfZm9ya1R5cGVDaGVja2VyID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfdHlwZUNoZWNrZXJQcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsO1xuICBwcml2YXRlIF9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgLy8gTG9nZ2luZy5cbiAgcHJpdmF0ZSBfbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcjtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIGdldCB0eXBlQ2hlY2tlcigpOiB0cy5UeXBlQ2hlY2tlciB8IG51bGwge1xuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuXG4gICAgcmV0dXJuIHRzUHJvZ3JhbSA/IHRzUHJvZ3JhbS5nZXRUeXBlQ2hlY2tlcigpIDogbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIHRoaXMuX2xvZ2dlciA9IG9wdGlvbnMubG9nZ2VyIHx8IGNyZWF0ZUNvbnNvbGVMb2dnZXIoKTtcblxuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHRoZSB0c2NvbmZpZyBjb250ZW50cy5cbiAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGlmIChjb25maWcuZXJyb3JzICYmIGNvbmZpZy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZm9ybWF0RGlhZ25vc3RpY3MoY29uZmlnLmVycm9ycykpO1xuICAgIH1cblxuICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXM7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zID0geyAuLi5jb25maWcub3B0aW9ucywgLi4ub3B0aW9ucy5jb21waWxlck9wdGlvbnMgfTtcbiAgICB0aGlzLl9iYXNlUGF0aCA9IGNvbmZpZy5vcHRpb25zLmJhc2VQYXRoIHx8IGJhc2VQYXRoIHx8ICcnO1xuXG4gICAgLy8gT3ZlcndyaXRlIG91dERpciBzbyB3ZSBjYW4gZmluZCBnZW5lcmF0ZWQgZmlsZXMgbmV4dCB0byB0aGVpciAudHMgb3JpZ2luIGluIGNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMub3V0RGlyID0gJyc7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcblxuICAgIC8vIERlZmF1bHQgcGx1Z2luIHNvdXJjZU1hcCB0byBjb21waWxlciBvcHRpb25zIHNldHRpbmcuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdzb3VyY2VNYXAnKSkge1xuICAgICAgb3B0aW9ucy5zb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEZvcmNlIHRoZSByaWdodCBzb3VyY2VtYXAgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5zb3VyY2VNYXApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICAvLyBXZSB3aWxsIHNldCB0aGUgc291cmNlIHRvIHRoZSBmdWxsIHBhdGggb2YgdGhlIGZpbGUgaW4gdGhlIGxvYWRlciwgc28gd2UgZG9uJ3RcbiAgICAgIC8vIG5lZWQgc291cmNlUm9vdCBoZXJlLlxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBXZSB3YW50IHRvIGFsbG93IGVtaXR0aW5nIHdpdGggZXJyb3JzIHNvIHRoYXQgaW1wb3J0cyBjYW4gYmUgYWRkZWRcbiAgICAvLyB0byB0aGUgd2VicGFjayBkZXBlbmRlbmN5IHRyZWUgYW5kIHJlYnVpbGRzIHRyaWdnZXJlZCBieSBmaWxlIGVkaXRzLlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG5cbiAgICAvLyBTZXQgSklUIChubyBjb2RlIGdlbmVyYXRpb24pIG9yIEFPVCBtb2RlLlxuICAgIGlmIChvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9KaXRNb2RlID0gb3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb247XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBpMThuIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRmlsZSA9IG9wdGlvbnMuaTE4bkluRmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Gb3JtYXQgPSBvcHRpb25zLmkxOG5JbkZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlID0gb3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZvcm1hdCA9IG9wdGlvbnMuaTE4bk91dEZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubG9jYWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Mb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0TG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlID0gdGhpcy5fdmFsaWRhdGVMb2NhbGUob3B0aW9ucy5sb2NhbGUpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5Jbk1pc3NpbmdUcmFuc2xhdGlvbnMgPVxuICAgICAgICBvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiBhcyAnZXJyb3InIHwgJ3dhcm5pbmcnIHwgJ2lnbm9yZSc7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JrZWQgdHlwZSBjaGVja2VyIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyO1xuICAgIH1cbiAgICAvLyB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcblxuICAgIC8vIEFkZCBjdXN0b20gcGxhdGZvcm0gdHJhbnNmb3JtZXJzLlxuICAgIGlmIChvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzID0gb3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycztcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB0byB0aGUgb25lIHdlIGNhbiBpbXBvcnQgZnJvbSBoZXJlLlxuICAgIC8vIEZhaWxpbmcgdG8gdXNlIHRoZSByaWdodCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgd2lsbCB0aHJvdyB0aGUgZXJyb3IgYmVsb3c6XG4gICAgLy8gXCJObyBtb2R1bGUgZmFjdG9yeSBhdmFpbGFibGUgZm9yIGRlcGVuZGVuY3kgdHlwZTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5XCJcbiAgICAvLyBIb2lzdGluZyB0b2dldGhlciB3aXRoIHBlZXIgZGVwZW5kZW5jaWVzIGNhbiBtYWtlIGl0IHNvIHRoZSBpbXBvcnRlZFxuICAgIC8vIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSBkb2VzIG5vdCBjb21lIGZyb20gdGhlIHNhbWUgV2VicGFjayBpbnN0YW5jZSB0aGF0IGlzIHVzZWRcbiAgICAvLyBpbiB0aGUgY29tcGlsYXRpb24uIEluIHRoYXQgY2FzZSwgd2UgY2FuIHBhc3MgdGhlIHJpZ2h0IG9uZSBhcyBhbiBvcHRpb24gdG8gdGhlIHBsdWdpbi5cbiAgICB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvciA9IG9wdGlvbnMuY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3JcbiAgICAgIHx8IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcblxuICAgIC8vIFVzZSBlbnRyeU1vZHVsZSBpZiBhdmFpbGFibGUgaW4gb3B0aW9ucywgb3RoZXJ3aXNlIHJlc29sdmUgaXQgZnJvbSBtYWluUGF0aCBhZnRlciBwcm9ncmFtXG4gICAgLy8gY3JlYXRpb24uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gdGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSBhcyBzdHJpbmcpOyAvLyB0ZW1wb3JhcnkgY2FzdCBmb3IgdHlwZSBpc3N1ZVxuICAgIH1cblxuICAgIC8vIFNldCBwbGF0Zm9ybS5cbiAgICB0aGlzLl9wbGF0Zm9ybSA9IG9wdGlvbnMucGxhdGZvcm0gfHwgUExBVEZPUk0uQnJvd3NlcjtcblxuICAgIC8vIE1ha2UgdHJhbnNmb3JtZXJzLlxuICAgIHRoaXMuX21ha2VUcmFuc2Zvcm1lcnMoKTtcblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRUc1Byb2dyYW0oKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9ncmFtKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkVHNGaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IChrLmVuZHNXaXRoKCcudHMnKSB8fCBrLmVuZHNXaXRoKCcudHN4JykpICYmICFrLmVuZHNXaXRoKCcuZC50cycpKVxuICAgICAgLmZpbHRlcihrID0+IHRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGspKTtcbiAgfVxuXG4gIHVwZGF0ZUNoYW5nZWRGaWxlRXh0ZW5zaW9ucyhleHRlbnNpb246IHN0cmluZykge1xuICAgIGlmIChleHRlbnNpb24pIHtcbiAgICAgIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucy5hZGQoZXh0ZW5zaW9uKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBleHQgb2YgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zKSB7XG4gICAgICAgICAgaWYgKGsuZW5kc1dpdGgoZXh0KSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgLy8gR2V0IHRoZSByb290IGZpbGVzIGZyb20gdGhlIHRzIGNvbmZpZy5cbiAgICAvLyBXaGVuIGEgbmV3IHJvb3QgbmFtZSAobGlrZSBhIGxhenkgcm91dGUpIGlzIGFkZGVkLCBpdCB3b24ndCBiZSBhdmFpbGFibGUgZnJvbVxuICAgIC8vIGZvbGxvd2luZyBpbXBvcnRzIG9uIHRoZSBleGlzdGluZyBmaWxlcywgc28gd2UgbmVlZCB0byBnZXQgdGhlIG5ldyBsaXN0IG9mIHJvb3QgZmlsZXMuXG4gICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSBmb3JrZWQgdHlwZSBjaGVja2VyIHdpdGggYWxsIGNoYW5nZWQgY29tcGlsYXRpb24gZmlsZXMuXG4gICAgLy8gVGhpcyBpbmNsdWRlcyB0ZW1wbGF0ZXMsIHRoYXQgYWxzbyBuZWVkIHRvIGJlIHJlbG9hZGVkIG9uIHRoZSB0eXBlIGNoZWNrZXIuXG4gICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgIXRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICB0aGlzLl91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcih0aGlzLl9yb290TmFtZXMsIHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkpO1xuICAgIH1cblxuICAgIC8vIFVzZSBhbiBpZGVudGl0eSBmdW5jdGlvbiBhcyBhbGwgb3VyIHBhdGhzIGFyZSBhYnNvbHV0ZSBhbHJlYWR5LlxuICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSA9IHRzLmNyZWF0ZU1vZHVsZVJlc29sdXRpb25DYWNoZSh0aGlzLl9iYXNlUGF0aCwgeCA9PiB4KTtcblxuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuICAgIGNvbnN0IG9sZEZpbGVzID0gbmV3IFNldCh0c1Byb2dyYW0gP1xuICAgICAgdHNQcm9ncmFtLmdldFNvdXJjZUZpbGVzKCkubWFwKHNmID0+IHNmLmZpbGVOYW1lKVxuICAgICAgOiBbXSxcbiAgICApO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgdGhpcy5fcHJvZ3JhbSA9IHRzLmNyZWF0ZVByb2dyYW0oXG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIHRzUHJvZ3JhbSxcbiAgICAgICk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICBmb3IgKGNvbnN0IG5ld0ZpbGUgb2YgbmV3RmlsZXMpIHtcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LmludmFsaWRhdGUobmV3RmlsZS5maWxlTmFtZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICByb290TmFtZXM6IHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIG9sZFByb2dyYW06IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSxcbiAgICAgIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5sb2FkTmdTdHJ1Y3R1cmVBc3luYycpO1xuICAgICAgYXdhaXQgdGhpcy5fcHJvZ3JhbS5sb2FkTmdTdHJ1Y3R1cmVBc3luYygpO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcblxuICAgICAgY29uc3QgbmV3RmlsZXMgPSB0aGlzLl9wcm9ncmFtLmdldFRzUHJvZ3JhbSgpXG4gICAgICAgIC5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICBmb3IgKGNvbnN0IG5ld0ZpbGUgb2YgbmV3RmlsZXMpIHtcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LmludmFsaWRhdGUobmV3RmlsZS5maWxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlcmUncyBzdGlsbCBubyBlbnRyeU1vZHVsZSB0cnkgdG8gcmVzb2x2ZSBmcm9tIG1haW5QYXRoLlxuICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUgJiYgdGhpcy5fbWFpblBhdGggJiYgIXRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbmFibGVJdnkpIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbihcbiAgICAgICAgdGhpcy5fbWFpblBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdGhpcy5fZ2V0VHNQcm9ncmFtKCkgYXMgdHMuUHJvZ3JhbSk7XG5cbiAgICAgIGlmICghdGhpcy5lbnRyeU1vZHVsZSkge1xuICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKCdMYXp5IHJvdXRlcyBkaXNjb3ZlcnkgaXMgbm90IGVuYWJsZWQuICdcbiAgICAgICAgICArICdCZWNhdXNlIHRoZXJlIGlzIG5laXRoZXIgYW4gZW50cnlNb2R1bGUgbm9yIGEgJ1xuICAgICAgICAgICsgJ3N0YXRpY2FsbHkgYW5hbHl6YWJsZSBib290c3RyYXAgY29kZSBpbiB0aGUgbWFpbiBmaWxlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCk6IExhenlSb3V0ZU1hcCB7XG4gICAgbGV0IGxhenlSb3V0ZXM6IExhenlSb3V0ZVtdO1xuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfVxuXG4gICAgICBjb25zdCBuZ1Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHsgLi4udGhpcy5fY29tcGlsZXJPcHRpb25zLCBnZW5EaXI6ICcnLCBjb2xsZWN0QWxsRXJyb3JzOiB0cnVlIH0sXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgIH0pO1xuXG4gICAgICBsYXp5Um91dGVzID0gbmdQcm9ncmFtLmxpc3RMYXp5Um91dGVzKFxuICAgICAgICB0aGlzLmVudHJ5TW9kdWxlLnBhdGggKyAnIycgKyB0aGlzLmVudHJ5TW9kdWxlLmNsYXNzTmFtZSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxhenlSb3V0ZXMgPSAodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5saXN0TGF6eVJvdXRlcygpO1xuICAgIH1cblxuICAgIHJldHVybiBsYXp5Um91dGVzLnJlZHVjZShcbiAgICAgIChhY2MsIGN1cnIpID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gY3Vyci5yb3V0ZTtcbiAgICAgICAgaWYgKHJlZiBpbiBhY2MgJiYgYWNjW3JlZl0gIT09IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICsgYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQ6IFwiJHtyZWZ9XCIgaXMgdXNlZCBpbiAyIGxvYWRDaGlsZHJlbiwgYFxuICAgICAgICAgICAgKyBgYnV0IHRoZXkgcG9pbnQgdG8gZGlmZmVyZW50IG1vZHVsZXMgXCIoJHthY2NbcmVmXX0gYW5kIGBcbiAgICAgICAgICAgICsgYFwiJHtjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGh9XCIpLiBXZWJwYWNrIGNhbm5vdCBkaXN0aW5ndWlzaCBvbiBjb250ZXh0IGFuZCBgXG4gICAgICAgICAgICArICd3b3VsZCBmYWlsIHRvIGxvYWQgdGhlIHByb3BlciBvbmUuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFjY1tyZWZdID0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAge30gYXMgTGF6eVJvdXRlTWFwLFxuICAgICk7XG4gIH1cblxuICAvLyBQcm9jZXNzIHRoZSBsYXp5IHJvdXRlcyBkaXNjb3ZlcmVkLCBhZGRpbmcgdGhlbiB0byBfbGF6eVJvdXRlcy5cbiAgLy8gVE9ETzogZmluZCBhIHdheSB0byByZW1vdmUgbGF6eSByb3V0ZXMgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuICAvLyBUaGlzIHdpbGwgcmVxdWlyZSBhIHJlZ2lzdHJ5IG9mIGtub3duIHJlZmVyZW5jZXMgdG8gYSBsYXp5IHJvdXRlLCByZW1vdmluZyBpdCB3aGVuIG5vXG4gIC8vIG1vZHVsZSByZWZlcmVuY2VzIGl0IGFueW1vcmUuXG4gIHByaXZhdGUgX3Byb2Nlc3NMYXp5Um91dGVzKGRpc2NvdmVyZWRMYXp5Um91dGVzOiBMYXp5Um91dGVNYXApIHtcbiAgICBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkTGF6eVJvdXRlcylcbiAgICAgIC5mb3JFYWNoKGxhenlSb3V0ZUtleSA9PiB7XG4gICAgICAgIGNvbnN0IFtsYXp5Um91dGVNb2R1bGUsIG1vZHVsZU5hbWVdID0gbGF6eVJvdXRlS2V5LnNwbGl0KCcjJyk7XG5cbiAgICAgICAgaWYgKCFsYXp5Um91dGVNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXp5Um91dGVUU0ZpbGUgPSBkaXNjb3ZlcmVkTGF6eVJvdXRlc1tsYXp5Um91dGVLZXldLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgbGV0IG1vZHVsZVBhdGg6IHN0cmluZywgbW9kdWxlS2V5OiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ke21vZHVsZU5hbWUgPyAnIycgKyBtb2R1bGVOYW1lIDogJyd9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlLnJlcGxhY2UoLyhcXC5kKT9cXC50c3g/JC8sICcnKTtcbiAgICAgICAgICBtb2R1bGVQYXRoICs9ICcubmdmYWN0b3J5LmpzJztcbiAgICAgICAgICBjb25zdCBmYWN0b3J5TW9kdWxlTmFtZSA9IG1vZHVsZU5hbWUgPyBgIyR7bW9kdWxlTmFtZX1OZ0ZhY3RvcnlgIDogJyc7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfS5uZ2ZhY3Rvcnkke2ZhY3RvcnlNb2R1bGVOYW1lfWA7XG4gICAgICAgIH1cblxuICAgICAgICBtb2R1bGVQYXRoID0gd29ya2Fyb3VuZFJlc29sdmUobW9kdWxlUGF0aCk7XG5cbiAgICAgICAgaWYgKG1vZHVsZUtleSBpbiB0aGlzLl9sYXp5Um91dGVzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSAhPT0gbW9kdWxlUGF0aCkge1xuICAgICAgICAgICAgLy8gRm91bmQgYSBkdXBsaWNhdGUsIHRoaXMgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQgZHVyaW5nIGEgcmVidWlsZC4gYFxuICAgICAgICAgICAgICAgICsgYFdlIHdpbGwgdGFrZSB0aGUgbGF0ZXN0IHZlcnNpb24gZGV0ZWN0ZWQgYW5kIG92ZXJyaWRlIGl0IHRvIHNhdmUgcmVidWlsZCB0aW1lLiBgXG4gICAgICAgICAgICAgICAgKyBgWW91IHNob3VsZCBwZXJmb3JtIGEgZnVsbCBidWlsZCB0byB2YWxpZGF0ZSB0aGF0IHlvdXIgcm91dGVzIGRvbid0IG92ZXJsYXAuYCksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGb3VuZCBhIG5ldyByb3V0ZSwgYWRkIGl0IHRvIHRoZSBtYXAuXG4gICAgICAgICAgdGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldID0gbW9kdWxlUGF0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICAvLyBCb290c3RyYXAgdHlwZSBjaGVja2VyIGlzIHVzaW5nIGxvY2FsIENMSS5cbiAgICBjb25zdCBnOiBhbnkgPSB0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJyA/IGdsb2JhbCA6IHt9OyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICBjb25zdCB0eXBlQ2hlY2tlckZpbGU6IHN0cmluZyA9IGdbJ19EZXZLaXRJc0xvY2FsJ11cbiAgICAgID8gJy4vdHlwZV9jaGVja2VyX2Jvb3RzdHJhcC5qcydcbiAgICAgIDogJy4vdHlwZV9jaGVja2VyX3dvcmtlci5qcyc7XG5cbiAgICBjb25zdCBkZWJ1Z0FyZ1JlZ2V4ID0gLy0taW5zcGVjdCg/Oi1icmt8LXBvcnQpP3wtLWRlYnVnKD86LWJya3wtcG9ydCkvO1xuXG4gICAgY29uc3QgZXhlY0FyZ3YgPSBwcm9jZXNzLmV4ZWNBcmd2LmZpbHRlcigoYXJnKSA9PiB7XG4gICAgICAvLyBSZW1vdmUgZGVidWcgYXJncy5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvOTQzNVxuICAgICAgcmV0dXJuICFkZWJ1Z0FyZ1JlZ2V4LnRlc3QoYXJnKTtcbiAgICB9KTtcbiAgICAvLyBTaWduYWwgdGhlIHByb2Nlc3MgdG8gc3RhcnQgbGlzdGVuaW5nIGZvciBtZXNzYWdlc1xuICAgIC8vIFNvbHZlcyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvOTA3MVxuICAgIGNvbnN0IGZvcmtBcmdzID0gW0FVVE9fU1RBUlRfQVJHXTtcbiAgICBjb25zdCBmb3JrT3B0aW9uczogRm9ya09wdGlvbnMgPSB7IGV4ZWNBcmd2IH07XG5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBmb3JrKFxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgdHlwZUNoZWNrZXJGaWxlKSxcbiAgICAgIGZvcmtBcmdzLFxuICAgICAgZm9ya09wdGlvbnMpO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIG1lc3NhZ2VzLlxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5vbignbWVzc2FnZScsIG1lc3NhZ2UgPT4ge1xuICAgICAgc3dpdGNoIChtZXNzYWdlLmtpbmQpIHtcbiAgICAgICAgY2FzZSBNRVNTQUdFX0tJTkQuTG9nOlxuICAgICAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBtZXNzYWdlIGFzIExvZ01lc3NhZ2U7XG4gICAgICAgICAgdGhpcy5fbG9nZ2VyLmxvZyhsb2dNZXNzYWdlLmxldmVsLCBgXFxuJHtsb2dNZXNzYWdlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUeXBlQ2hlY2tlcjogVW5leHBlY3RlZCBtZXNzYWdlIHJlY2VpdmVkOiAke21lc3NhZ2V9LmApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIHByb2Nlc3MgZXhpdC5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub25jZSgnZXhpdCcsIChfLCBzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG5cbiAgICAgIC8vIElmIHByb2Nlc3MgZXhpdGVkIG5vdCBiZWNhdXNlIG9mIFNJR1RFUk0gKHNlZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKSwgdGhhbiBzb21ldGhpbmdcbiAgICAgIC8vIHdlbnQgd3JvbmcgYW5kIGl0IHNob3VsZCBmYWxsYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIHRoZSBtYWluIHRocmVhZC5cbiAgICAgIGlmIChzaWduYWwgIT09ICdTSUdURVJNJykge1xuICAgICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbXNnID0gJ0FuZ3VsYXJDb21waWxlclBsdWdpbjogRm9ya2VkIFR5cGUgQ2hlY2tlciBleGl0ZWQgdW5leHBlY3RlZGx5LiAnICtcbiAgICAgICAgICAnRmFsbGluZyBiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gbWFpbiB0aHJlYWQuJztcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCkge1xuICAgICAgdHJlZUtpbGwodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCwgJ1NJR1RFUk0nKTtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgaWYgKCF0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkKSB7XG4gICAgICAgIGxldCBob3N0UmVwbGFjZW1lbnRQYXRocyA9IHt9O1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRoc1xuICAgICAgICAgICYmIHR5cGVvZiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzICE9ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBob3N0UmVwbGFjZW1lbnRQYXRocyA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IEluaXRNZXNzYWdlKHRoaXMuX2NvbXBpbGVyT3B0aW9ucywgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgICAgdGhpcy5fSml0TW9kZSwgdGhpcy5fcm9vdE5hbWVzLCBob3N0UmVwbGFjZW1lbnRQYXRocykpO1xuICAgICAgICB0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBVcGRhdGVNZXNzYWdlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RyYXRpb24gaG9vayBmb3Igd2VicGFjayBwbHVnaW4uXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlciAmIHsgd2F0Y2hNb2RlPzogYm9vbGVhbiB9KSB7XG4gICAgLy8gb25seSBwcmVzZW50IGZvciB3ZWJwYWNrIDQuMjMuMCssIGFzc3VtZSB0cnVlIG90aGVyd2lzZVxuICAgIGNvbnN0IHdhdGNoTW9kZSA9IGNvbXBpbGVyLndhdGNoTW9kZSA9PT0gdW5kZWZpbmVkID8gdHJ1ZSA6IGNvbXBpbGVyLndhdGNoTW9kZTtcblxuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIC8vIFRoZSB3ZWJwYWNrIHR5cGVzIGN1cnJlbnRseSBkbyBub3QgaW5jbHVkZSB0aGVzZVxuICAgICAgY29uc3QgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMgPSBjb21waWxlciBhcyBDb21waWxlciAmIHtcbiAgICAgICAgd2F0Y2hGaWxlU3lzdGVtOiBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICAgICAgfTtcblxuICAgICAgbGV0IGhvc3Q6IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPiA9IHRoaXMuX29wdGlvbnMuaG9zdCB8fCBuZXcgV2VicGFja0lucHV0SG9zdChcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgKTtcblxuICAgICAgbGV0IHJlcGxhY2VtZW50czogTWFwPFBhdGgsIFBhdGg+IHwgKChwYXRoOiBQYXRoKSA9PiBQYXRoKSB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRSZXNvbHZlciA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gcGF0aCA9PiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgaG9zdCA9IG5ldyBjbGFzcyBleHRlbmRzIHZpcnR1YWxGcy5SZXNvbHZlckhvc3Q8ZnMuU3RhdHM+IHtcbiAgICAgICAgICAgIF9yZXNvbHZlKHBhdGg6IFBhdGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KGhvc3QpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgICBjb25zdCBhbGlhc0hvc3QgPSBuZXcgdmlydHVhbEZzLkFsaWFzSG9zdChob3N0KTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGZyb20gaW4gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSByZXNvbHZlKG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksIG5vcm1hbGl6ZShmcm9tKSk7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkV2l0aCA9IHJlc29sdmUoXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzW2Zyb21dKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGlhc0hvc3QuYWxpYXNlcy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50cy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaG9zdCA9IGFsaWFzSG9zdDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDcmVhdGUgdGhlIHdlYnBhY2sgY29tcGlsZXIgaG9zdC5cbiAgICAgIGNvbnN0IHdlYnBhY2tDb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgd2F0Y2hNb2RlLFxuICAgICAgKTtcblxuICAgICAgLy8gQ3JlYXRlIGFuZCBzZXQgYSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyLlxuICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgICB3ZWJwYWNrQ29tcGlsZXJIb3N0LnNldFJlc291cmNlTG9hZGVyKHRoaXMuX3Jlc291cmNlTG9hZGVyKTtcblxuICAgICAgLy8gVXNlIHRoZSBXZWJwYWNrQ29tcGlsZXJIb3N0IHdpdGggYSByZXNvdXJjZSBsb2FkZXIgdG8gY3JlYXRlIGFuIEFuZ3VsYXJDb21waWxlckhvc3QuXG4gICAgICB0aGlzLl9jb21waWxlckhvc3QgPSBjcmVhdGVDb21waWxlckhvc3Qoe1xuICAgICAgICBvcHRpb25zOiB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRzSG9zdDogd2VicGFja0NvbXBpbGVySG9zdCxcbiAgICAgIH0pIGFzIENvbXBpbGVySG9zdCAmIFdlYnBhY2tDb21waWxlckhvc3Q7XG5cbiAgICAgIC8vIFJlc29sdmUgbWFpblBhdGggaWYgcHJvdmlkZWQuXG4gICAgICBpZiAodGhpcy5fb3B0aW9ucy5tYWluUGF0aCkge1xuICAgICAgICB0aGlzLl9tYWluUGF0aCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKHRoaXMuX29wdGlvbnMubWFpblBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnB1dERlY29yYXRvciA9IG5ldyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICApO1xuICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtID0gaW5wdXREZWNvcmF0b3I7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy53YXRjaEZpbGVTeXN0ZW0gPSBuZXcgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcihcbiAgICAgICAgaW5wdXREZWNvcmF0b3IsXG4gICAgICAgIHJlcGxhY2VtZW50cyxcbiAgICAgICk7XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgbGF6eSBtb2R1bGVzIHRvIHRoZSBjb250ZXh0IG1vZHVsZSBmb3IgQGFuZ3VsYXIvY29yZVxuICAgIGNvbXBpbGVyLmhvb2tzLmNvbnRleHRNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNtZiA9PiB7XG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVBhY2thZ2VQYXRoID0gcmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb3JlL3BhY2thZ2UuanNvbicpO1xuXG4gICAgICAvLyBBUEZ2NiBkb2VzIG5vdCBoYXZlIHNpbmdsZSBGRVNNIGFueW1vcmUuIEluc3RlYWQgb2YgdmVyaWZ5aW5nIGlmIHdlJ3JlIHBvaW50aW5nIHRvXG4gICAgICAvLyBGRVNNcywgd2UgcmVzb2x2ZSB0aGUgYEBhbmd1bGFyL2NvcmVgIHBhdGggYW5kIHZlcmlmeSB0aGF0IHRoZSBwYXRoIGZvciB0aGVcbiAgICAgIC8vIG1vZHVsZSBzdGFydHMgd2l0aCBpdC5cbiAgICAgIC8vIFRoaXMgbWF5IGJlIHNsb3dlciBidXQgaXQgd2lsbCBiZSBjb21wYXRpYmxlIHdpdGggYm90aCBBUEY1LCA2IGFuZCBwb3RlbnRpYWwgZnV0dXJlXG4gICAgICAvLyB2ZXJzaW9ucyAodW50aWwgdGhlIGR5bmFtaWMgaW1wb3J0IGFwcGVhcnMgb3V0c2lkZSBvZiBjb3JlIEkgc3VwcG9zZSkuXG4gICAgICAvLyBXZSByZXNvbHZlIGFueSBzeW1ib2xpYyBsaW5rcyBpbiBvcmRlciB0byBnZXQgdGhlIHJlYWwgcGF0aCB0aGF0IHdvdWxkIGJlIHVzZWQgaW4gd2VicGFjay5cbiAgICAgIGNvbnN0IGFuZ3VsYXJDb3JlUmVzb3VyY2VSb290ID0gZnMucmVhbHBhdGhTeW5jKHBhdGguZGlybmFtZShhbmd1bGFyQ29yZVBhY2thZ2VQYXRoKSk7XG5cbiAgICAgIGNtZi5ob29rcy5hZnRlclJlc29sdmUudGFwUHJvbWlzZSgnYW5ndWxhci1jb21waWxlcicsIGFzeW5jIHJlc3VsdCA9PiB7XG4gICAgICAgIC8vIEFsdGVyIG9ubHkgZXhpc3RpbmcgcmVxdWVzdCBmcm9tIEFuZ3VsYXIgb3Igb25lIG9mIHRoZSBhZGRpdGlvbmFsIGxhenkgbW9kdWxlIHJlc291cmNlcy5cbiAgICAgICAgY29uc3QgaXNMYXp5TW9kdWxlUmVzb3VyY2UgPSAocmVzb3VyY2U6IHN0cmluZykgPT5cbiAgICAgICAgICByZXNvdXJjZS5zdGFydHNXaXRoKGFuZ3VsYXJDb3JlUmVzb3VyY2VSb290KSB8fFxuICAgICAgICAgICggdGhpcy5vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlUmVzb3VyY2VzICYmXG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVSZXNvdXJjZXMuaW5jbHVkZXMocmVzb3VyY2UpKTtcblxuICAgICAgICBpZiAoIXJlc3VsdCB8fCAhdGhpcy5kb25lIHx8ICFpc0xhenlNb2R1bGVSZXNvdXJjZShyZXN1bHQucmVzb3VyY2UpKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB0aGlzLmRvbmUudGhlbihcbiAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICAvLyBUaGlzIGZvbGRlciBkb2VzIG5vdCBleGlzdCwgYnV0IHdlIG5lZWQgdG8gZ2l2ZSB3ZWJwYWNrIGEgcmVzb3VyY2UuXG4gICAgICAgICAgICAvLyBUT0RPOiBjaGVjayBpZiB3ZSBjYW4ndCBqdXN0IGxlYXZlIGl0IGFzIGlzIChhbmd1bGFyQ29yZU1vZHVsZURpcikuXG4gICAgICAgICAgICByZXN1bHQucmVzb3VyY2UgPSBwYXRoLmpvaW4odGhpcy5fYmFzZVBhdGgsICckJF9sYXp5X3JvdXRlX3Jlc291cmNlJyk7XG4gICAgICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgICAgICByZXN1bHQuZGVwZW5kZW5jaWVzLmZvckVhY2goKGQ6IGFueSkgPT4gZC5jcml0aWNhbCA9IGZhbHNlKTtcbiAgICAgICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICAgICAgIHJlc3VsdC5yZXNvbHZlRGVwZW5kZW5jaWVzID0gKF9mczogYW55LCBvcHRpb25zOiBhbnksIGNhbGxiYWNrOiBDYWxsYmFjaykgPT4ge1xuICAgICAgICAgICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBPYmplY3Qua2V5cyh0aGlzLl9sYXp5Um91dGVzKVxuICAgICAgICAgICAgICAgIC5tYXAoKGtleSkgPT4ge1xuICAgICAgICAgICAgICAgICAgY29uc3QgbW9kdWxlUGF0aCA9IHRoaXMuX2xhenlSb3V0ZXNba2V5XTtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IGltcG9ydFBhdGggPSBrZXkuc3BsaXQoJyMnKVswXTtcbiAgICAgICAgICAgICAgICAgIGlmIChtb2R1bGVQYXRoICE9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSBpbXBvcnRQYXRoLnJlcGxhY2UoLyhcXC5uZ2ZhY3RvcnkpPyhcXC4oanN8dHMpKT8kLywgJycpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3IobW9kdWxlUGF0aCwgbmFtZSk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoeCA9PiAhIXgpO1xuXG4gICAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLm5hbWVMYXp5RmlsZXMpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLmNodW5rTmFtZSA9ICdbcmVxdWVzdF0nO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoKSA9PiB1bmRlZmluZWQsXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhbmQgZGVzdHJveSBmb3JrZWQgdHlwZSBjaGVja2VyIG9uIHdhdGNoIG1vZGUuXG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hSdW4udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiAhdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICAgIHRoaXMuX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hDbG9zZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSk7XG5cbiAgICAvLyBSZW1ha2UgdGhlIHBsdWdpbiBvbiBlYWNoIGNvbXBpbGF0aW9uLlxuICAgIGNvbXBpbGVyLmhvb2tzLm1ha2UudGFwUHJvbWlzZShcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgIGNvbXBpbGF0aW9uID0+IHRoaXMuX2RvbmVQcm9taXNlID0gdGhpcy5fbWFrZShjb21waWxhdGlvbiksXG4gICAgKTtcbiAgICBjb21waWxlci5ob29rcy5pbnZhbGlkLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2ZpcnN0UnVuID0gZmFsc2UpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyRW1pdC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxhdGlvbiA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsYXRpb24gYXMgYW55KS5fbmdUb29sc1dlYnBhY2tQbHVnaW5JbnN0YW5jZSA9IG51bGw7XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3MuZG9uZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICB0aGlzLl9kb25lUHJvbWlzZSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5ob29rcy5hZnRlclJlc29sdmVycy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxlciA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsZXIgYXMgYW55KS5yZXNvbHZlckZhY3RvcnkuaG9va3MucmVzb2x2ZXJcbiAgICAgICAgLmZvcignbm9ybWFsJylcbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlc29sdmVyOiBhbnkpID0+IHtcbiAgICAgICAgICBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKHRoaXMuX2NvbXBpbGVyT3B0aW9ucykuYXBwbHkocmVzb2x2ZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgY29tcGlsZXIuaG9va3Mubm9ybWFsTW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBubWYgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcFByb21pc2UoXG4gICAgICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgICAgIGFzeW5jIChyZXF1ZXN0PzogTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgcmVxdWVzdCkge1xuICAgICAgICAgICAgICBjb25zdCBuYW1lID0gcmVxdWVzdC5yZXF1ZXN0O1xuICAgICAgICAgICAgICBjb25zdCBpc3N1ZXIgPSByZXF1ZXN0LmNvbnRleHRJbmZvLmlzc3VlcjtcbiAgICAgICAgICAgICAgaWYgKG5hbWUuZW5kc1dpdGgoJy50cycpIHx8IG5hbWUuZW5kc1dpdGgoJy50c3gnKVxuICAgICAgICAgICAgICAgIHx8IChpc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChpc3N1ZXIpKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmRvbmU7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7IH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9tYWtlKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgaWYgKChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbik7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fdXBkYXRlKCk7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgIH1cblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBwdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSAoXG4gICAgICB0aGlzLl9tYWluUGF0aCA/IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuX21haW5QYXRoKSA6IHRoaXMuX21haW5QYXRoXG4gICAgKTtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGVcbiAgICAgID8geyBwYXRoOiB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpLCBjbGFzc05hbWU6IHRoaXMuZW50cnlNb2R1bGUuY2xhc3NOYW1lIH1cbiAgICAgIDogdGhpcy5lbnRyeU1vZHVsZTtcbiAgICBjb25zdCBnZXRMYXp5Um91dGVzID0gKCkgPT4gdGhpcy5fbGF6eVJvdXRlcztcbiAgICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+ICh0aGlzLl9nZXRUc1Byb2dyYW0oKSBhcyB0cy5Qcm9ncmFtKS5nZXRUeXBlQ2hlY2tlcigpO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIFJlcGxhY2UgcmVzb3VyY2VzIGluIEpJVC5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VSZXNvdXJjZXMoaXNBcHBQYXRoLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdmUgdW5uZWVkZWQgYW5ndWxhciBkZWNvcmF0b3JzLlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVtb3ZlRGVjb3JhdG9ycyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSBudWxsKSB7XG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaCguLi50aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uQnJvd3Nlcikge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgbG9jYWxlLCBhdXRvIGltcG9ydCB0aGUgbG9jYWxlIGRhdGEgZmlsZS5cbiAgICAgICAgLy8gVGhpcyB0cmFuc2Zvcm0gbXVzdCBnbyBiZWZvcmUgcmVwbGFjZUJvb3RzdHJhcCBiZWNhdXNlIGl0IGxvb2tzIGZvciB0aGUgZW50cnkgbW9kdWxlXG4gICAgICAgIC8vIGltcG9ydCwgd2hpY2ggd2lsbCBiZSByZXBsYWNlZC5cbiAgICAgICAgaWYgKHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZWdpc3RlckxvY2FsZURhdGEoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgYm9vdHN0cmFwIGluIGJyb3dzZXIgQU9ULlxuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VCb290c3RyYXAoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uU2VydmVyKSB7XG4gICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKGV4cG9ydExhenlNb2R1bGVNYXAoaXNNYWluUGF0aCwgZ2V0TGF6eVJvdXRlcykpO1xuICAgICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChcbiAgICAgICAgICAgIGV4cG9ydE5nRmFjdG9yeShpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSksXG4gICAgICAgICAgICByZXBsYWNlU2VydmVyQm9vdHN0cmFwKGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfdXBkYXRlKCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgLy8gV2Ugb25seSB3YW50IHRvIHVwZGF0ZSBvbiBUUyBhbmQgdGVtcGxhdGUgY2hhbmdlcywgYnV0IGFsbCBraW5kcyBvZiBmaWxlcyBhcmUgb24gdGhpc1xuICAgIC8vIGxpc3QsIGxpa2UgcGFja2FnZS5qc29uIGFuZCAubmdzdW1tYXJ5Lmpzb24gZmlsZXMuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKTtcblxuICAgIC8vIElmIG5vdGhpbmcgd2UgY2FyZSBhYm91dCBjaGFuZ2VkIGFuZCBpdCBpc24ndCB0aGUgZmlyc3QgcnVuLCBkb24ndCBkbyBhbnl0aGluZy5cbiAgICBpZiAoY2hhbmdlZEZpbGVzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBNYWtlIGEgbmV3IHByb2dyYW0gYW5kIGxvYWQgdGhlIEFuZ3VsYXIgc3RydWN0dXJlLlxuICAgIGF3YWl0IHRoaXMuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpO1xuXG4gICAgLy8gVHJ5IHRvIGZpbmQgbGF6eSByb3V0ZXMgaWYgd2UgaGF2ZSBhbiBlbnRyeSBtb2R1bGUuXG4gICAgLy8gV2UgbmVlZCB0byBydW4gdGhlIGBsaXN0TGF6eVJvdXRlc2AgdGhlIGZpcnN0IHRpbWUgYmVjYXVzZSBpdCBhbHNvIG5hdmlnYXRlcyBsaWJyYXJpZXNcbiAgICAvLyBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgd2UgbWlnaHQgbWlzcyB1c2luZyB0aGUgKGZhc3RlcikgZmluZExhenlSb3V0ZXNJbkFzdC5cbiAgICAvLyBMYXp5IHJvdXRlcyBtb2R1bGVzIHdpbGwgYmUgcmVhZCB3aXRoIGNvbXBpbGVySG9zdCBhbmQgYWRkZWQgdG8gdGhlIGNoYW5nZWQgZmlsZXMuXG4gICAgY29uc3QgbGF6eVJvdXRlTWFwOiBMYXp5Um91dGVNYXAgPSB7XG4gICAgICAuLi4gKHRoaXMuX2VudHJ5TW9kdWxlIHx8ICF0aGlzLl9KaXRNb2RlID8gdGhpcy5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpIDoge30pLFxuICAgICAgLi4udGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMsXG4gICAgfTtcblxuICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKGxhenlSb3V0ZU1hcCk7XG5cbiAgICAvLyBFbWl0IGFuZCByZXBvcnQgZXJyb3JzLlxuXG4gICAgLy8gV2Ugbm93IGhhdmUgdGhlIGZpbmFsIGxpc3Qgb2YgY2hhbmdlZCBUUyBmaWxlcy5cbiAgICAvLyBHbyB0aHJvdWdoIGVhY2ggY2hhbmdlZCBmaWxlIGFuZCBhZGQgdHJhbnNmb3JtcyBhcyBuZWVkZWQuXG4gICAgY29uc3Qgc291cmNlRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkVHNGaWxlcygpXG4gICAgICAubWFwKChmaWxlTmFtZSkgPT4gKHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pLmdldFNvdXJjZUZpbGUoZmlsZU5hbWUpKVxuICAgICAgLy8gQXQgdGhpcyBwb2ludCB3ZSBzaG91bGRuJ3QgbmVlZCB0byBmaWx0ZXIgb3V0IHVuZGVmaW5lZCBmaWxlcywgYmVjYXVzZSBhbnkgdHMgZmlsZVxuICAgICAgLy8gdGhhdCBjaGFuZ2VkIHNob3VsZCBiZSBlbWl0dGVkLlxuICAgICAgLy8gQnV0IGR1ZSB0byBob3N0UmVwbGFjZW1lbnRQYXRocyB0aGVyZSBjYW4gYmUgZmlsZXMgKHRoZSBlbnZpcm9ubWVudCBmaWxlcylcbiAgICAgIC8vIHRoYXQgY2hhbmdlZCBidXQgYXJlbid0IHBhcnQgb2YgdGhlIGNvbXBpbGF0aW9uLCBzcGVjaWFsbHkgb24gYG5nIHRlc3RgLlxuICAgICAgLy8gU28gd2UgaWdub3JlIG1pc3Npbmcgc291cmNlIGZpbGVzIGZpbGVzIGhlcmUuXG4gICAgICAvLyBob3N0UmVwbGFjZW1lbnRQYXRocyBuZWVkcyB0byBiZSBmaXhlZCBhbnl3YXkgdG8gdGFrZSBjYXJlIG9mIHRoZSBmb2xsb3dpbmcgaXNzdWUuXG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvNzMwNSNpc3N1ZWNvbW1lbnQtMzMyMTUwMjMwXG4gICAgICAuZmlsdGVyKCh4KSA9PiAhIXgpIGFzIHRzLlNvdXJjZUZpbGVbXTtcblxuICAgIC8vIEVtaXQgZmlsZXMuXG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcbiAgICBjb25zdCB7IGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzIH0gPSB0aGlzLl9lbWl0KHNvdXJjZUZpbGVzKTtcbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZS5fZW1pdCcpO1xuXG4gICAgLy8gUmVwb3J0IGRpYWdub3N0aWNzLlxuICAgIGNvbnN0IGVycm9ycyA9IGRpYWdub3N0aWNzXG4gICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuRXJyb3IpO1xuICAgIGNvbnN0IHdhcm5pbmdzID0gZGlhZ25vc3RpY3NcbiAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5XYXJuaW5nKTtcblxuICAgIGlmIChlcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKGVycm9ycyk7XG4gICAgICB0aGlzLl9lcnJvcnMucHVzaChuZXcgRXJyb3IobWVzc2FnZSkpO1xuICAgIH1cblxuICAgIGlmICh3YXJuaW5ncy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3Mod2FybmluZ3MpO1xuICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtZXNzYWdlKTtcbiAgICB9XG5cbiAgICB0aGlzLl9lbWl0U2tpcHBlZCA9ICFlbWl0UmVzdWx0IHx8IGVtaXRSZXN1bHQuZW1pdFNraXBwZWQ7XG5cbiAgICAvLyBSZXNldCBjaGFuZ2VkIGZpbGVzIG9uIHN1Y2Nlc3NmdWwgY29tcGlsYXRpb24uXG4gICAgaWYgKCF0aGlzLl9lbWl0U2tpcHBlZCAmJiB0aGlzLl9lcnJvcnMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLl9jb21waWxlckhvc3QucmVzZXRDaGFuZ2VkRmlsZVRyYWNrZXIoKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgfVxuXG4gIHdyaXRlSTE4bk91dEZpbGUoKSB7XG4gICAgZnVuY3Rpb24gX3JlY3Vyc2l2ZU1rRGlyKHA6IHN0cmluZykge1xuICAgICAgaWYgKCFmcy5leGlzdHNTeW5jKHApKSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUocCkpO1xuICAgICAgICBmcy5ta2RpclN5bmMocCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gV3JpdGUgdGhlIGV4dHJhY3RlZCBtZXNzYWdlcyB0byBkaXNrLlxuICAgIGlmICh0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpIHtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlUGF0aCA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCwgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKTtcbiAgICAgIGNvbnN0IGkxOG5PdXRGaWxlQ29udGVudCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShpMThuT3V0RmlsZVBhdGgpO1xuICAgICAgaWYgKGkxOG5PdXRGaWxlQ29udGVudCkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKGkxOG5PdXRGaWxlUGF0aCkpO1xuICAgICAgICBmcy53cml0ZUZpbGVTeW5jKGkxOG5PdXRGaWxlUGF0aCwgaTE4bk91dEZpbGVDb250ZW50KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBnZXRDb21waWxlZEZpbGUoZmlsZU5hbWU6IHN0cmluZykge1xuICAgIGNvbnN0IG91dHB1dEZpbGUgPSBmaWxlTmFtZS5yZXBsYWNlKC8udHN4PyQvLCAnLmpzJyk7XG4gICAgbGV0IG91dHB1dFRleHQ6IHN0cmluZztcbiAgICBsZXQgc291cmNlTWFwOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGVycm9yRGVwZW5kZW5jaWVzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgaWYgKHRoaXMuX2VtaXRTa2lwcGVkKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpO1xuICAgICAgaWYgKHRleHQpIHtcbiAgICAgICAgLy8gSWYgdGhlIGNvbXBpbGF0aW9uIGRpZG4ndCBlbWl0IGZpbGVzIHRoaXMgdGltZSwgdHJ5IHRvIHJldHVybiB0aGUgY2FjaGVkIGZpbGVzIGZyb20gdGhlXG4gICAgICAgIC8vIGxhc3QgY29tcGlsYXRpb24gYW5kIGxldCB0aGUgY29tcGlsYXRpb24gZXJyb3JzIHNob3cgd2hhdCdzIHdyb25nLlxuICAgICAgICBvdXRwdXRUZXh0ID0gdGV4dDtcbiAgICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gVGhlcmUncyBub3RoaW5nIHdlIGNhbiBzZXJ2ZS4gUmV0dXJuIGFuIGVtcHR5IHN0cmluZyB0byBwcmV2ZW50IGxlbmdodHkgd2VicGFjayBlcnJvcnMsXG4gICAgICAgIC8vIGFkZCB0aGUgcmVidWlsZCB3YXJuaW5nIGlmIGl0J3Mgbm90IHRoZXJlIHlldC5cbiAgICAgICAgLy8gV2UgYWxzbyBuZWVkIHRvIGFsbCBjaGFuZ2VkIGZpbGVzIGFzIGRlcGVuZGVuY2llcyBvZiB0aGlzIGZpbGUsIHNvIHRoYXQgYWxsIG9mIHRoZW1cbiAgICAgICAgLy8gd2lsbCBiZSB3YXRjaGVkIGFuZCB0cmlnZ2VyIGEgcmVidWlsZCBuZXh0IHRpbWUuXG4gICAgICAgIG91dHB1dFRleHQgPSAnJztcbiAgICAgICAgZXJyb3JEZXBlbmRlbmNpZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpXG4gICAgICAgICAgLy8gVGhlc2UgcGF0aHMgYXJlIHVzZWQgYnkgdGhlIGxvYWRlciBzbyB3ZSBtdXN0IGRlbm9ybWFsaXplIHRoZW0uXG4gICAgICAgICAgLm1hcCgocCkgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIENoZWNrIGlmIHRoZSBUUyBpbnB1dCBmaWxlIGFuZCB0aGUgSlMgb3V0cHV0IGZpbGUgZXhpc3QuXG4gICAgICBpZiAoKChmaWxlTmFtZS5lbmRzV2l0aCgnLnRzJykgfHwgZmlsZU5hbWUuZW5kc1dpdGgoJy50c3gnKSlcbiAgICAgICAgJiYgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGZpbGVOYW1lKSlcbiAgICAgICAgfHwgIXRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKG91dHB1dEZpbGUsIGZhbHNlKSkge1xuICAgICAgICBsZXQgbXNnID0gYCR7ZmlsZU5hbWV9IGlzIG1pc3NpbmcgZnJvbSB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbi4gYFxuICAgICAgICAgICsgYFBsZWFzZSBtYWtlIHN1cmUgaXQgaXMgaW4geW91ciB0c2NvbmZpZyB2aWEgdGhlICdmaWxlcycgb3IgJ2luY2x1ZGUnIHByb3BlcnR5LmA7XG5cbiAgICAgICAgaWYgKC8oXFxcXHxcXC8pbm9kZV9tb2R1bGVzKFxcXFx8XFwvKS8udGVzdChmaWxlTmFtZSkpIHtcbiAgICAgICAgICBtc2cgKz0gJ1xcblRoZSBtaXNzaW5nIGZpbGUgc2VlbXMgdG8gYmUgcGFydCBvZiBhIHRoaXJkIHBhcnR5IGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1RTIGZpbGVzIGluIHB1Ymxpc2hlZCBsaWJyYXJpZXMgYXJlIG9mdGVuIGEgc2lnbiBvZiBhIGJhZGx5IHBhY2thZ2VkIGxpYnJhcnkuICdcbiAgICAgICAgICAgICsgJ1BsZWFzZSBvcGVuIGFuIGlzc3VlIGluIHRoZSBsaWJyYXJ5IHJlcG9zaXRvcnkgdG8gYWxlcnQgaXRzIGF1dGhvciBhbmQgYXNrIHRoZW0gJ1xuICAgICAgICAgICAgKyAndG8gcGFja2FnZSB0aGUgbGlicmFyeSB1c2luZyB0aGUgQW5ndWxhciBQYWNrYWdlIEZvcm1hdCAoaHR0cHM6Ly9nb28uZ2wvakIzR1Z2KS4nO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICB9XG5cbiAgICAgIG91dHB1dFRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSkgfHwgJyc7XG4gICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgb3V0cHV0VGV4dCwgc291cmNlTWFwLCBlcnJvckRlcGVuZGVuY2llcyB9O1xuICB9XG5cbiAgZ2V0RGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgcmVzb2x2ZWRGaWxlTmFtZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZXNvbHZlKGZpbGVOYW1lKTtcbiAgICBjb25zdCBzb3VyY2VGaWxlID0gdGhpcy5fY29tcGlsZXJIb3N0LmdldFNvdXJjZUZpbGUocmVzb2x2ZWRGaWxlTmFtZSwgdHMuU2NyaXB0VGFyZ2V0LkxhdGVzdCk7XG4gICAgaWYgKCFzb3VyY2VGaWxlKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucztcbiAgICBjb25zdCBob3N0ID0gdGhpcy5fY29tcGlsZXJIb3N0O1xuICAgIGNvbnN0IGNhY2hlID0gdGhpcy5fbW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuXG4gICAgY29uc3QgZXNJbXBvcnRzID0gY29sbGVjdERlZXBOb2Rlczx0cy5JbXBvcnREZWNsYXJhdGlvbj4oc291cmNlRmlsZSxcbiAgICAgIHRzLlN5bnRheEtpbmQuSW1wb3J0RGVjbGFyYXRpb24pXG4gICAgICAubWFwKGRlY2wgPT4ge1xuICAgICAgICBjb25zdCBtb2R1bGVOYW1lID0gKGRlY2wubW9kdWxlU3BlY2lmaWVyIGFzIHRzLlN0cmluZ0xpdGVyYWwpLnRleHQ7XG4gICAgICAgIGNvbnN0IHJlc29sdmVkID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUobW9kdWxlTmFtZSwgcmVzb2x2ZWRGaWxlTmFtZSwgb3B0aW9ucywgaG9zdCwgY2FjaGUpO1xuXG4gICAgICAgIGlmIChyZXNvbHZlZC5yZXNvbHZlZE1vZHVsZSkge1xuICAgICAgICAgIHJldHVybiByZXNvbHZlZC5yZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLmZpbHRlcih4ID0+IHgpO1xuXG4gICAgY29uc3QgcmVzb3VyY2VJbXBvcnRzID0gZmluZFJlc291cmNlcyhzb3VyY2VGaWxlKVxuICAgICAgLm1hcChyZXNvdXJjZVBhdGggPT4gcmVzb2x2ZShkaXJuYW1lKHJlc29sdmVkRmlsZU5hbWUpLCBub3JtYWxpemUocmVzb3VyY2VQYXRoKSkpO1xuXG4gICAgLy8gVGhlc2UgcGF0aHMgYXJlIG1lYW50IHRvIGJlIHVzZWQgYnkgdGhlIGxvYWRlciBzbyB3ZSBtdXN0IGRlbm9ybWFsaXplIHRoZW0uXG4gICAgY29uc3QgdW5pcXVlRGVwZW5kZW5jaWVzID0gbmV3IFNldChbXG4gICAgICAuLi5lc0ltcG9ydHMsXG4gICAgICAuLi5yZXNvdXJjZUltcG9ydHMsXG4gICAgICAuLi50aGlzLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocmVzb2x2ZWRGaWxlTmFtZSkpLFxuICAgIF0ubWFwKChwKSA9PiBwICYmIHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpKTtcblxuICAgIHJldHVybiBbLi4udW5pcXVlRGVwZW5kZW5jaWVzXVxuICAgICAgLmZpbHRlcih4ID0+ICEheCkgYXMgc3RyaW5nW107XG4gIH1cblxuICBnZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZSk7XG4gIH1cblxuICAvLyBUaGlzIGNvZGUgbW9zdGx5IGNvbWVzIGZyb20gYHBlcmZvcm1Db21waWxhdGlvbmAgaW4gYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAuXG4gIC8vIEl0IHNraXBzIHRoZSBwcm9ncmFtIGNyZWF0aW9uIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2UgYGxvYWROZ1N0cnVjdHVyZUFzeW5jKClgLFxuICAvLyBhbmQgdXNlcyBDdXN0b21UcmFuc2Zvcm1lcnMuXG4gIHByaXZhdGUgX2VtaXQoc291cmNlRmlsZXM6IHRzLlNvdXJjZUZpbGVbXSkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdCcpO1xuICAgIGNvbnN0IHByb2dyYW0gPSB0aGlzLl9wcm9ncmFtO1xuICAgIGNvbnN0IGFsbERpYWdub3N0aWNzOiBBcnJheTx0cy5EaWFnbm9zdGljIHwgRGlhZ25vc3RpYz4gPSBbXTtcbiAgICBjb25zdCBkaWFnTW9kZSA9ICh0aGlzLl9maXJzdFJ1biB8fCAhdGhpcy5fZm9ya1R5cGVDaGVja2VyKSA/XG4gICAgICBEaWFnbm9zdGljTW9kZS5BbGwgOiBEaWFnbm9zdGljTW9kZS5TeW50YWN0aWM7XG5cbiAgICBsZXQgZW1pdFJlc3VsdDogdHMuRW1pdFJlc3VsdCB8IHVuZGVmaW5lZDtcbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgY29uc3QgdHNQcm9ncmFtID0gcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi50c1Byb2dyYW0uZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModHNQcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMnLCBkaWFnTW9kZSkpO1xuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIGlmICh0aGlzLl9maXJzdFJ1biB8fCBzb3VyY2VGaWxlcy5sZW5ndGggPiAyMCkge1xuICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHsgYmVmb3JlOiB0aGlzLl90cmFuc2Zvcm1lcnMgfSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzb3VyY2VGaWxlcy5mb3JFYWNoKChzZikgPT4ge1xuICAgICAgICAgICAgICBjb25zdCB0aW1lTGFiZWwgPSBgQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzKyR7c2YuZmlsZU5hbWV9Ky5lbWl0YDtcbiAgICAgICAgICAgICAgdGltZSh0aW1lTGFiZWwpO1xuICAgICAgICAgICAgICBlbWl0UmVzdWx0ID0gdHNQcm9ncmFtLmVtaXQoc2YsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gcHJvZ3JhbSBhcyBQcm9ncmFtO1xuXG4gICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgc3RydWN0dXJhbCBkaWFnbm9zdGljcy5cbiAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIFR5cGVTY3JpcHQgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXRUc09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyhhbmd1bGFyUHJvZ3JhbSwgdGhpcy5fSml0TW9kZSxcbiAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nJywgZGlhZ01vZGUpKTtcblxuICAgICAgICBpZiAoIWhhc0Vycm9ycyhhbGxEaWFnbm9zdGljcykpIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZW1pdCcpO1xuICAgICAgICAgIGNvbnN0IGV4dHJhY3RJMThuID0gISF0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgICAgICAgY29uc3QgZW1pdEZsYWdzID0gZXh0cmFjdEkxOG4gPyBFbWl0RmxhZ3MuSTE4bkJ1bmRsZSA6IEVtaXRGbGFncy5EZWZhdWx0O1xuICAgICAgICAgIGVtaXRSZXN1bHQgPSBhbmd1bGFyUHJvZ3JhbS5lbWl0KHtcbiAgICAgICAgICAgIGVtaXRGbGFncywgY3VzdG9tVHJhbnNmb3JtZXJzOiB7XG4gICAgICAgICAgICAgIGJlZm9yZVRzOiB0aGlzLl90cmFuc2Zvcm1lcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgaWYgKGV4dHJhY3RJMThuKSB7XG4gICAgICAgICAgICB0aGlzLndyaXRlSTE4bk91dEZpbGUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgICAgLy8gVGhpcyBmdW5jdGlvbiBpcyBhdmFpbGFibGUgaW4gdGhlIGltcG9ydCBiZWxvdywgYnV0IHRoaXMgd2F5IHdlIGF2b2lkIHRoZSBkZXBlbmRlbmN5LlxuICAgICAgLy8gaW1wb3J0IHsgaXNTeW50YXhFcnJvciB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyJztcbiAgICAgIGZ1bmN0aW9uIGlzU3ludGF4RXJyb3IoZXJyb3I6IEVycm9yKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiAoZXJyb3IgYXMgYW55KVsnbmdTeW50YXhFcnJvciddOyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICAgIH1cblxuICAgICAgbGV0IGVyck1zZzogc3RyaW5nO1xuICAgICAgbGV0IGNvZGU6IG51bWJlcjtcbiAgICAgIGlmIChpc1N5bnRheEVycm9yKGUpKSB7XG4gICAgICAgIC8vIGRvbid0IHJlcG9ydCB0aGUgc3RhY2sgZm9yIHN5bnRheCBlcnJvcnMgYXMgdGhleSBhcmUgd2VsbCBrbm93biBlcnJvcnMuXG4gICAgICAgIGVyck1zZyA9IGUubWVzc2FnZTtcbiAgICAgICAgY29kZSA9IERFRkFVTFRfRVJST1JfQ09ERTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVyck1zZyA9IGUuc3RhY2s7XG4gICAgICAgIC8vIEl0IGlzIG5vdCBhIHN5bnRheCBlcnJvciB3ZSBtaWdodCBoYXZlIGEgcHJvZ3JhbSB3aXRoIHVua25vd24gc3RhdGUsIGRpc2NhcmQgaXQuXG4gICAgICAgIHRoaXMuX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICBjb2RlID0gVU5LTk9XTl9FUlJPUl9DT0RFO1xuICAgICAgfVxuICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaChcbiAgICAgICAgeyBjYXRlZ29yeTogdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yLCBtZXNzYWdlVGV4dDogZXJyTXNnLCBjb2RlLCBzb3VyY2U6IFNPVVJDRSB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcblxuICAgIHJldHVybiB7IHByb2dyYW0sIGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzOiBhbGxEaWFnbm9zdGljcyB9O1xuICB9XG5cbiAgcHJpdmF0ZSBfdmFsaWRhdGVMb2NhbGUobG9jYWxlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIHBhdGggb2YgdGhlIGNvbW1vbiBtb2R1bGUuXG4gICAgY29uc3QgY29tbW9uUGF0aCA9IHBhdGguZGlybmFtZShyZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvbW1vbi9wYWNrYWdlLmpzb24nKSk7XG4gICAgLy8gQ2hlY2sgaWYgdGhlIGxvY2FsZSBmaWxlIGV4aXN0c1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnLCBgJHtsb2NhbGV9LmpzYCkpKSB7XG4gICAgICAvLyBDaGVjayBmb3IgYW4gYWx0ZXJuYXRpdmUgbG9jYWxlIChpZiB0aGUgbG9jYWxlIGlkIHdhcyBiYWRseSBmb3JtYXR0ZWQpLlxuICAgICAgY29uc3QgbG9jYWxlcyA9IGZzLnJlYWRkaXJTeW5jKHBhdGgucmVzb2x2ZShjb21tb25QYXRoLCAnbG9jYWxlcycpKVxuICAgICAgICAuZmlsdGVyKGZpbGUgPT4gZmlsZS5lbmRzV2l0aCgnLmpzJykpXG4gICAgICAgIC5tYXAoZmlsZSA9PiBmaWxlLnJlcGxhY2UoJy5qcycsICcnKSk7XG5cbiAgICAgIGxldCBuZXdMb2NhbGU7XG4gICAgICBjb25zdCBub3JtYWxpemVkTG9jYWxlID0gbG9jYWxlLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnLScpO1xuICAgICAgZm9yIChjb25zdCBsIG9mIGxvY2FsZXMpIHtcbiAgICAgICAgaWYgKGwudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIG5ld0xvY2FsZSA9IGw7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG5ld0xvY2FsZSkge1xuICAgICAgICBsb2NhbGUgPSBuZXdMb2NhbGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDaGVjayBmb3IgYSBwYXJlbnQgbG9jYWxlXG4gICAgICAgIGNvbnN0IHBhcmVudExvY2FsZSA9IG5vcm1hbGl6ZWRMb2NhbGUuc3BsaXQoJy0nKVswXTtcbiAgICAgICAgaWYgKGxvY2FsZXMuaW5kZXhPZihwYXJlbnRMb2NhbGUpICE9PSAtMSkge1xuICAgICAgICAgIGxvY2FsZSA9IHBhcmVudExvY2FsZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKGBBbmd1bGFyQ29tcGlsZXJQbHVnaW46IFVuYWJsZSB0byBsb2FkIHRoZSBsb2NhbGUgZGF0YSBmaWxlIGAgK1xuICAgICAgICAgICAgYFwiQGFuZ3VsYXIvY29tbW9uL2xvY2FsZXMvJHtsb2NhbGV9XCIsIGAgK1xuICAgICAgICAgICAgYHBsZWFzZSBjaGVjayB0aGF0IFwiJHtsb2NhbGV9XCIgaXMgYSB2YWxpZCBsb2NhbGUgaWQuXG4gICAgICAgICAgICBJZiBuZWVkZWQsIHlvdSBjYW4gdXNlIFwicmVnaXN0ZXJMb2NhbGVEYXRhXCIgbWFudWFsbHkuYCk7XG5cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2NhbGU7XG4gIH1cbn1cbiJdfQ==