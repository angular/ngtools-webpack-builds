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
                            if (modulePath !== null) {
                                const name = key.split('#')[0];
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
        // Find lazy routes
        const lazyRouteMap = Object.assign({}, this._listLazyRoutesFromProgram(), this._options.additionalLazyModules);
        this._processLazyRoutes(lazyRouteMap);
        // Emit files.
        benchmark_1.time('AngularCompilerPlugin._update._emit');
        const { emitResult, diagnostics } = this._emit();
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
    _emit() {
        benchmark_1.time('AngularCompilerPlugin._emit');
        const program = this._program;
        const allDiagnostics = [];
        const diagMode = (this._firstRun || !this._forkTypeChecker) ?
            gather_diagnostics_1.DiagnosticMode.All : gather_diagnostics_1.DiagnosticMode.Syntactic;
        let emitResult;
        try {
            if (this._JitMode) {
                const tsProgram = program;
                const changedTsFiles = new Set();
                if (this._firstRun) {
                    // Check parameter diagnostics.
                    benchmark_1.time('AngularCompilerPlugin._emit.ts.getOptionsDiagnostics');
                    allDiagnostics.push(...tsProgram.getOptionsDiagnostics());
                    benchmark_1.timeEnd('AngularCompilerPlugin._emit.ts.getOptionsDiagnostics');
                }
                else {
                    // generate a list of changed files for emit
                    // not needed on first run since a full program emit is required
                    for (const changedFile of this._compilerHost.getChangedFilePaths()) {
                        if (!changedFile.endsWith('.ts') && !changedFile.endsWith('.tsx')) {
                            continue;
                        }
                        // existing type definitions are not emitted
                        if (changedFile.endsWith('.d.ts')) {
                            continue;
                        }
                        changedTsFiles.add(changedFile);
                    }
                }
                allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(tsProgram, this._JitMode, 'AngularCompilerPlugin._emit.ts', diagMode));
                if (!gather_diagnostics_1.hasErrors(allDiagnostics)) {
                    if (this._firstRun || changedTsFiles.size > 20) {
                        emitResult = tsProgram.emit(undefined, undefined, undefined, undefined, { before: this._transformers });
                        allDiagnostics.push(...emitResult.diagnostics);
                    }
                    else {
                        for (const changedFile of changedTsFiles) {
                            const sourceFile = tsProgram.getSourceFile(changedFile);
                            if (!sourceFile) {
                                continue;
                            }
                            const timeLabel = `AngularCompilerPlugin._emit.ts+${sourceFile.fileName}+.emit`;
                            benchmark_1.time(timeLabel);
                            emitResult = tsProgram.emit(sourceFile, undefined, undefined, undefined, { before: this._transformers });
                            allDiagnostics.push(...emitResult.diagnostics);
                            benchmark_1.timeEnd(timeLabel);
                        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FROEI7QUFDOUIsb0RBQWdFO0FBQ2hFLHdEQWUrQjtBQUMvQixpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9GO0FBQ3BGLGlEQUF1RDtBQUN2RCx1REFBMEQ7QUFDMUQsaURBVXdCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFFd0I7QUFDeEIsbUVBS2lDO0FBQ2pDLG1GQUd5QztBQU16Qyw2REFBd0Q7QUFFeEQsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBNkN0QyxJQUFZLFFBR1g7QUFIRCxXQUFZLFFBQVE7SUFDbEIsNkNBQU8sQ0FBQTtJQUNQLDJDQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsUUFBUSxHQUFSLGdCQUFRLEtBQVIsZ0JBQVEsUUFHbkI7QUFFRCxNQUFhLHFCQUFxQjtJQXVDaEMsWUFBWSxPQUFxQztRQTdCakQsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFFdkUsa0JBQWtCO1FBQ1Ys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dGlDRCxzREFzaUNDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHtcbiAgUGF0aCxcbiAgZGlybmFtZSxcbiAgZ2V0U3lzdGVtUGF0aCxcbiAgbG9nZ2luZyxcbiAgbm9ybWFsaXplLFxuICByZXNvbHZlLFxuICB2aXJ0dWFsRnMsXG59IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBERUZBVUxUX0VSUk9SX0NPREUsXG4gIERpYWdub3N0aWMsXG4gIEVtaXRGbGFncyxcbiAgTGF6eVJvdXRlLFxuICBQcm9ncmFtLFxuICBTT1VSQ0UsXG4gIFVOS05PV05fRVJST1JfQ09ERSxcbiAgVkVSU0lPTixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBDb21waWxlciwgY29tcGlsYXRpb24gfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgRGlhZ25vc3RpY01vZGUsIGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQge1xuICBMYXp5Um91dGVNYXAsXG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHtcbiAgQVVUT19TVEFSVF9BUkcsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyJztcbmltcG9ydCB7XG4gIEluaXRNZXNzYWdlLFxuICBMb2dNZXNzYWdlLFxuICBNRVNTQUdFX0tJTkQsXG4gIFVwZGF0ZU1lc3NhZ2UsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyX21lc3NhZ2VzJztcbmltcG9ydCB7XG4gIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLFxuICBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yLFxufSBmcm9tICcuL3ZpcnR1YWxfZmlsZV9zeXN0ZW1fZGVjb3JhdG9yJztcbmltcG9ydCB7XG4gIENhbGxiYWNrLFxuICBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcbmltcG9ydCB7IFdlYnBhY2tJbnB1dEhvc3QgfSBmcm9tICcuL3dlYnBhY2staW5wdXQtaG9zdCc7XG5cbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHsgfVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yIHtcbiAgbmV3KG1vZHVsZVBhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nKTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5O1xufVxuXG4vKipcbiAqIE9wdGlvbiBDb25zdGFudHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zIHtcbiAgc291cmNlTWFwPzogYm9vbGVhbjtcbiAgdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIGJhc2VQYXRoPzogc3RyaW5nO1xuICBlbnRyeU1vZHVsZT86IHN0cmluZztcbiAgbWFpblBhdGg/OiBzdHJpbmc7XG4gIHNraXBDb2RlR2VuZXJhdGlvbj86IGJvb2xlYW47XG4gIGhvc3RSZXBsYWNlbWVudFBhdGhzPzogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0gfCAoKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nKTtcbiAgZm9ya1R5cGVDaGVja2VyPzogYm9vbGVhbjtcbiAgaTE4bkluRmlsZT86IHN0cmluZztcbiAgaTE4bkluRm9ybWF0Pzogc3RyaW5nO1xuICBpMThuT3V0RmlsZT86IHN0cmluZztcbiAgaTE4bk91dEZvcm1hdD86IHN0cmluZztcbiAgbG9jYWxlPzogc3RyaW5nO1xuICBtaXNzaW5nVHJhbnNsYXRpb24/OiBzdHJpbmc7XG4gIHBsYXRmb3JtPzogUExBVEZPUk07XG4gIG5hbWVMYXp5RmlsZXM/OiBib29sZWFuO1xuICBsb2dnZXI/OiBsb2dnaW5nLkxvZ2dlcjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcz86IHN0cmluZ1tdO1xuXG4gIC8vIFRoZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgb2YgY29ycmVjdCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAvLyBUaGlzIGlzIG5lZWRlZCB3aGVuIHRoZXJlIGFyZSBtdWx0aXBsZSBXZWJwYWNrIGluc3RhbGxzLlxuICBjb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcj86IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0PzogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+O1xuICBwbGF0Zm9ybVRyYW5zZm9ybWVycz86IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdO1xufVxuXG5leHBvcnQgZW51bSBQTEFURk9STSB7XG4gIEJyb3dzZXIsXG4gIFNlcnZlcixcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJDb21waWxlclBsdWdpbiB7XG4gIHByaXZhdGUgX29wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnM7XG5cbiAgLy8gVFMgY29tcGlsYXRpb24uXG4gIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zO1xuICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdO1xuICBwcml2YXRlIF9wcm9ncmFtOiAodHMuUHJvZ3JhbSB8IFByb2dyYW0pIHwgbnVsbDtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuICBwcml2YXRlIF9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU6IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZTtcbiAgcHJpdmF0ZSBfcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgLy8gQ29udGFpbnMgYG1vZHVsZUltcG9ydFBhdGgjZXhwb3J0TmFtZWAgPT4gYGZ1bGxNb2R1bGVQYXRoYC5cbiAgcHJpdmF0ZSBfbGF6eVJvdXRlczogTGF6eVJvdXRlTWFwID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgcHJpdmF0ZSBfdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX2VudHJ5TW9kdWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF9tYWluUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIF9iYXNlUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF90cmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdID0gW107XG4gIHByaXZhdGUgX3BsYXRmb3JtVHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9wbGF0Zm9ybTogUExBVEZPUk07XG4gIHByaXZhdGUgX0ppdE1vZGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBfZW1pdFNraXBwZWQgPSB0cnVlO1xuICBwcml2YXRlIF9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsndHMnLCAndHN4JywgJ2h0bWwnLCAnY3NzJ10pO1xuXG4gIC8vIFdlYnBhY2sgcGx1Z2luLlxuICBwcml2YXRlIF9maXJzdFJ1biA9IHRydWU7XG4gIHByaXZhdGUgX2RvbmVQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgcHJpdmF0ZSBfbm9ybWFsaXplZExvY2FsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfd2FybmluZ3M6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9lcnJvcnM6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I7XG5cbiAgLy8gVHlwZUNoZWNrZXIgcHJvY2Vzcy5cbiAgcHJpdmF0ZSBfZm9ya1R5cGVDaGVja2VyID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfdHlwZUNoZWNrZXJQcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsO1xuICBwcml2YXRlIF9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgLy8gTG9nZ2luZy5cbiAgcHJpdmF0ZSBfbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcjtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIGdldCB0eXBlQ2hlY2tlcigpOiB0cy5UeXBlQ2hlY2tlciB8IG51bGwge1xuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuXG4gICAgcmV0dXJuIHRzUHJvZ3JhbSA/IHRzUHJvZ3JhbS5nZXRUeXBlQ2hlY2tlcigpIDogbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIHRoaXMuX2xvZ2dlciA9IG9wdGlvbnMubG9nZ2VyIHx8IGNyZWF0ZUNvbnNvbGVMb2dnZXIoKTtcblxuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHRoZSB0c2NvbmZpZyBjb250ZW50cy5cbiAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGlmIChjb25maWcuZXJyb3JzICYmIGNvbmZpZy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZm9ybWF0RGlhZ25vc3RpY3MoY29uZmlnLmVycm9ycykpO1xuICAgIH1cblxuICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXM7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zID0geyAuLi5jb25maWcub3B0aW9ucywgLi4ub3B0aW9ucy5jb21waWxlck9wdGlvbnMgfTtcbiAgICB0aGlzLl9iYXNlUGF0aCA9IGNvbmZpZy5vcHRpb25zLmJhc2VQYXRoIHx8IGJhc2VQYXRoIHx8ICcnO1xuXG4gICAgLy8gT3ZlcndyaXRlIG91dERpciBzbyB3ZSBjYW4gZmluZCBnZW5lcmF0ZWQgZmlsZXMgbmV4dCB0byB0aGVpciAudHMgb3JpZ2luIGluIGNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMub3V0RGlyID0gJyc7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcblxuICAgIC8vIERlZmF1bHQgcGx1Z2luIHNvdXJjZU1hcCB0byBjb21waWxlciBvcHRpb25zIHNldHRpbmcuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdzb3VyY2VNYXAnKSkge1xuICAgICAgb3B0aW9ucy5zb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEZvcmNlIHRoZSByaWdodCBzb3VyY2VtYXAgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5zb3VyY2VNYXApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICAvLyBXZSB3aWxsIHNldCB0aGUgc291cmNlIHRvIHRoZSBmdWxsIHBhdGggb2YgdGhlIGZpbGUgaW4gdGhlIGxvYWRlciwgc28gd2UgZG9uJ3RcbiAgICAgIC8vIG5lZWQgc291cmNlUm9vdCBoZXJlLlxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBXZSB3YW50IHRvIGFsbG93IGVtaXR0aW5nIHdpdGggZXJyb3JzIHNvIHRoYXQgaW1wb3J0cyBjYW4gYmUgYWRkZWRcbiAgICAvLyB0byB0aGUgd2VicGFjayBkZXBlbmRlbmN5IHRyZWUgYW5kIHJlYnVpbGRzIHRyaWdnZXJlZCBieSBmaWxlIGVkaXRzLlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG5cbiAgICAvLyBTZXQgSklUIChubyBjb2RlIGdlbmVyYXRpb24pIG9yIEFPVCBtb2RlLlxuICAgIGlmIChvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9KaXRNb2RlID0gb3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb247XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBpMThuIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRmlsZSA9IG9wdGlvbnMuaTE4bkluRmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Gb3JtYXQgPSBvcHRpb25zLmkxOG5JbkZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlID0gb3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZvcm1hdCA9IG9wdGlvbnMuaTE4bk91dEZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubG9jYWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Mb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0TG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlID0gdGhpcy5fdmFsaWRhdGVMb2NhbGUob3B0aW9ucy5sb2NhbGUpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5Jbk1pc3NpbmdUcmFuc2xhdGlvbnMgPVxuICAgICAgICBvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiBhcyAnZXJyb3InIHwgJ3dhcm5pbmcnIHwgJ2lnbm9yZSc7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JrZWQgdHlwZSBjaGVja2VyIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyO1xuICAgIH1cbiAgICAvLyB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcblxuICAgIC8vIEFkZCBjdXN0b20gcGxhdGZvcm0gdHJhbnNmb3JtZXJzLlxuICAgIGlmIChvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzID0gb3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycztcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB0byB0aGUgb25lIHdlIGNhbiBpbXBvcnQgZnJvbSBoZXJlLlxuICAgIC8vIEZhaWxpbmcgdG8gdXNlIHRoZSByaWdodCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgd2lsbCB0aHJvdyB0aGUgZXJyb3IgYmVsb3c6XG4gICAgLy8gXCJObyBtb2R1bGUgZmFjdG9yeSBhdmFpbGFibGUgZm9yIGRlcGVuZGVuY3kgdHlwZTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5XCJcbiAgICAvLyBIb2lzdGluZyB0b2dldGhlciB3aXRoIHBlZXIgZGVwZW5kZW5jaWVzIGNhbiBtYWtlIGl0IHNvIHRoZSBpbXBvcnRlZFxuICAgIC8vIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSBkb2VzIG5vdCBjb21lIGZyb20gdGhlIHNhbWUgV2VicGFjayBpbnN0YW5jZSB0aGF0IGlzIHVzZWRcbiAgICAvLyBpbiB0aGUgY29tcGlsYXRpb24uIEluIHRoYXQgY2FzZSwgd2UgY2FuIHBhc3MgdGhlIHJpZ2h0IG9uZSBhcyBhbiBvcHRpb24gdG8gdGhlIHBsdWdpbi5cbiAgICB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvciA9IG9wdGlvbnMuY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3JcbiAgICAgIHx8IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcblxuICAgIC8vIFVzZSBlbnRyeU1vZHVsZSBpZiBhdmFpbGFibGUgaW4gb3B0aW9ucywgb3RoZXJ3aXNlIHJlc29sdmUgaXQgZnJvbSBtYWluUGF0aCBhZnRlciBwcm9ncmFtXG4gICAgLy8gY3JlYXRpb24uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gdGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSBhcyBzdHJpbmcpOyAvLyB0ZW1wb3JhcnkgY2FzdCBmb3IgdHlwZSBpc3N1ZVxuICAgIH1cblxuICAgIC8vIFNldCBwbGF0Zm9ybS5cbiAgICB0aGlzLl9wbGF0Zm9ybSA9IG9wdGlvbnMucGxhdGZvcm0gfHwgUExBVEZPUk0uQnJvd3NlcjtcblxuICAgIC8vIE1ha2UgdHJhbnNmb3JtZXJzLlxuICAgIHRoaXMuX21ha2VUcmFuc2Zvcm1lcnMoKTtcblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRUc1Byb2dyYW0oKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9ncmFtKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICB1cGRhdGVDaGFuZ2VkRmlsZUV4dGVuc2lvbnMoZXh0ZW5zaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMuYWRkKGV4dGVuc2lvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgZXh0IG9mIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucykge1xuICAgICAgICAgIGlmIChrLmVuZHNXaXRoKGV4dCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAvLyBmb2xsb3dpbmcgaW1wb3J0cyBvbiB0aGUgZXhpc3RpbmcgZmlsZXMsIHNvIHdlIG5lZWQgdG8gZ2V0IHRoZSBuZXcgbGlzdCBvZiByb290IGZpbGVzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgZm9ya2VkIHR5cGUgY2hlY2tlciB3aXRoIGFsbCBjaGFuZ2VkIGNvbXBpbGF0aW9uIGZpbGVzLlxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgdGhpcy5fdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIodGhpcy5fcm9vdE5hbWVzLCB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpKTtcbiAgICB9XG5cbiAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUodGhpcy5fYmFzZVBhdGgsIHggPT4geCk7XG5cbiAgICBjb25zdCB0c1Byb2dyYW0gPSB0aGlzLl9nZXRUc1Byb2dyYW0oKTtcbiAgICBjb25zdCBvbGRGaWxlcyA9IG5ldyBTZXQodHNQcm9ncmFtID9cbiAgICAgIHRzUHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLm1hcChzZiA9PiBzZi5maWxlTmFtZSlcbiAgICAgIDogW10sXG4gICAgKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIHRoaXMuX3Byb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICB0c1Byb2dyYW0sXG4gICAgICApO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICBjb25zdCBuZXdGaWxlcyA9IHRoaXMuX3Byb2dyYW0uZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgcHJvZ3JhbS5cbiAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgIGF3YWl0IHRoaXMuX3Byb2dyYW0ubG9hZE5nU3RydWN0dXJlQXN5bmMoKTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRUc1Byb2dyYW0oKVxuICAgICAgICAuZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHRoZXJlJ3Mgc3RpbGwgbm8gZW50cnlNb2R1bGUgdHJ5IHRvIHJlc29sdmUgZnJvbSBtYWluUGF0aC5cbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoICYmICF0aGlzLl9jb21waWxlck9wdGlvbnMuZW5hYmxlSXZ5KSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4oXG4gICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pO1xuXG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaCgnTGF6eSByb3V0ZXMgZGlzY292ZXJ5IGlzIG5vdCBlbmFibGVkLiAnXG4gICAgICAgICAgKyAnQmVjYXVzZSB0aGVyZSBpcyBuZWl0aGVyIGFuIGVudHJ5TW9kdWxlIG5vciBhICdcbiAgICAgICAgICArICdzdGF0aWNhbGx5IGFuYWx5emFibGUgYm9vdHN0cmFwIGNvZGUgaW4gdGhlIG1haW4gZmlsZS4nLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGxldCBsYXp5Um91dGVzOiBMYXp5Um91dGVbXTtcbiAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgaWYgKCF0aGlzLmVudHJ5TW9kdWxlKSB7XG4gICAgICAgIHJldHVybiB7fTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbmdQcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICBvcHRpb25zOiB7IC4uLnRoaXMuX2NvbXBpbGVyT3B0aW9ucywgZ2VuRGlyOiAnJywgY29sbGVjdEFsbEVycm9yczogdHJ1ZSB9LFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICB9KTtcblxuICAgICAgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcyhcbiAgICAgICAgdGhpcy5lbnRyeU1vZHVsZS5wYXRoICsgJyMnICsgdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWUsXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICBsYXp5Um91dGVzID0gKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkubGlzdExhenlSb3V0ZXMoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbGF6eVJvdXRlcy5yZWR1Y2UoXG4gICAgICAoYWNjLCBjdXJyKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlZiA9IGN1cnIucm91dGU7XG4gICAgICAgIGlmIChyZWYgaW4gYWNjICYmIGFjY1tyZWZdICE9PSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICArIGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkOiBcIiR7cmVmfVwiIGlzIHVzZWQgaW4gMiBsb2FkQ2hpbGRyZW4sIGBcbiAgICAgICAgICAgICsgYGJ1dCB0aGV5IHBvaW50IHRvIGRpZmZlcmVudCBtb2R1bGVzIFwiKCR7YWNjW3JlZl19IGFuZCBgXG4gICAgICAgICAgICArIGBcIiR7Y3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRofVwiKS4gV2VicGFjayBjYW5ub3QgZGlzdGluZ3Vpc2ggb24gY29udGV4dCBhbmQgYFxuICAgICAgICAgICAgKyAnd291bGQgZmFpbCB0byBsb2FkIHRoZSBwcm9wZXIgb25lLicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBhY2NbcmVmXSA9IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aDtcblxuICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgfSxcbiAgICAgIHt9IGFzIExhenlSb3V0ZU1hcCxcbiAgICApO1xuICB9XG5cbiAgLy8gUHJvY2VzcyB0aGUgbGF6eSByb3V0ZXMgZGlzY292ZXJlZCwgYWRkaW5nIHRoZW4gdG8gX2xhenlSb3V0ZXMuXG4gIC8vIFRPRE86IGZpbmQgYSB3YXkgdG8gcmVtb3ZlIGxhenkgcm91dGVzIHRoYXQgZG9uJ3QgZXhpc3QgYW55bW9yZS5cbiAgLy8gVGhpcyB3aWxsIHJlcXVpcmUgYSByZWdpc3RyeSBvZiBrbm93biByZWZlcmVuY2VzIHRvIGEgbGF6eSByb3V0ZSwgcmVtb3ZpbmcgaXQgd2hlbiBub1xuICAvLyBtb2R1bGUgcmVmZXJlbmNlcyBpdCBhbnltb3JlLlxuICBwcml2YXRlIF9wcm9jZXNzTGF6eVJvdXRlcyhkaXNjb3ZlcmVkTGF6eVJvdXRlczogTGF6eVJvdXRlTWFwKSB7XG4gICAgT2JqZWN0LmtleXMoZGlzY292ZXJlZExhenlSb3V0ZXMpXG4gICAgICAuZm9yRWFjaChsYXp5Um91dGVLZXkgPT4ge1xuICAgICAgICBjb25zdCBbbGF6eVJvdXRlTW9kdWxlLCBtb2R1bGVOYW1lXSA9IGxhenlSb3V0ZUtleS5zcGxpdCgnIycpO1xuXG4gICAgICAgIGlmICghbGF6eVJvdXRlTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGF6eVJvdXRlVFNGaWxlID0gZGlzY292ZXJlZExhenlSb3V0ZXNbbGF6eVJvdXRlS2V5XS5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgICAgIGxldCBtb2R1bGVQYXRoOiBzdHJpbmcsIG1vZHVsZUtleTogc3RyaW5nO1xuXG4gICAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZTtcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9JHttb2R1bGVOYW1lID8gJyMnICsgbW9kdWxlTmFtZSA6ICcnfWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZS5yZXBsYWNlKC8oXFwuZCk/XFwudHN4PyQvLCAnJyk7XG4gICAgICAgICAgbW9kdWxlUGF0aCArPSAnLm5nZmFjdG9yeS5qcyc7XG4gICAgICAgICAgY29uc3QgZmFjdG9yeU1vZHVsZU5hbWUgPSBtb2R1bGVOYW1lID8gYCMke21vZHVsZU5hbWV9TmdGYWN0b3J5YCA6ICcnO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ubmdmYWN0b3J5JHtmYWN0b3J5TW9kdWxlTmFtZX1gO1xuICAgICAgICB9XG5cbiAgICAgICAgbW9kdWxlUGF0aCA9IHdvcmthcm91bmRSZXNvbHZlKG1vZHVsZVBhdGgpO1xuXG4gICAgICAgIGlmIChtb2R1bGVLZXkgaW4gdGhpcy5fbGF6eVJvdXRlcykge1xuICAgICAgICAgIGlmICh0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gIT09IG1vZHVsZVBhdGgpIHtcbiAgICAgICAgICAgIC8vIEZvdW5kIGEgZHVwbGljYXRlLCB0aGlzIGlzIGFuIGVycm9yLlxuICAgICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkIGR1cmluZyBhIHJlYnVpbGQuIGBcbiAgICAgICAgICAgICAgICArIGBXZSB3aWxsIHRha2UgdGhlIGxhdGVzdCB2ZXJzaW9uIGRldGVjdGVkIGFuZCBvdmVycmlkZSBpdCB0byBzYXZlIHJlYnVpbGQgdGltZS4gYFxuICAgICAgICAgICAgICAgICsgYFlvdSBzaG91bGQgcGVyZm9ybSBhIGZ1bGwgYnVpbGQgdG8gdmFsaWRhdGUgdGhhdCB5b3VyIHJvdXRlcyBkb24ndCBvdmVybGFwLmApLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRm91bmQgYSBuZXcgcm91dGUsIGFkZCBpdCB0byB0aGUgbWFwLlxuICAgICAgICAgIHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSA9IG1vZHVsZVBhdGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgLy8gQm9vdHN0cmFwIHR5cGUgY2hlY2tlciBpcyB1c2luZyBsb2NhbCBDTEkuXG4gICAgY29uc3QgZzogYW55ID0gdHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgPyBnbG9iYWwgOiB7fTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgY29uc3QgdHlwZUNoZWNrZXJGaWxlOiBzdHJpbmcgPSBnWydfRGV2S2l0SXNMb2NhbCddXG4gICAgICA/ICcuL3R5cGVfY2hlY2tlcl9ib290c3RyYXAuanMnXG4gICAgICA6ICcuL3R5cGVfY2hlY2tlcl93b3JrZXIuanMnO1xuXG4gICAgY29uc3QgZGVidWdBcmdSZWdleCA9IC8tLWluc3BlY3QoPzotYnJrfC1wb3J0KT98LS1kZWJ1Zyg/Oi1icmt8LXBvcnQpLztcblxuICAgIGNvbnN0IGV4ZWNBcmd2ID0gcHJvY2Vzcy5leGVjQXJndi5maWx0ZXIoKGFyZykgPT4ge1xuICAgICAgLy8gUmVtb3ZlIGRlYnVnIGFyZ3MuXG4gICAgICAvLyBXb3JrYXJvdW5kIGZvciBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvaXNzdWVzLzk0MzVcbiAgICAgIHJldHVybiAhZGVidWdBcmdSZWdleC50ZXN0KGFyZyk7XG4gICAgfSk7XG4gICAgLy8gU2lnbmFsIHRoZSBwcm9jZXNzIHRvIHN0YXJ0IGxpc3RlbmluZyBmb3IgbWVzc2FnZXNcbiAgICAvLyBTb2x2ZXMgaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzkwNzFcbiAgICBjb25zdCBmb3JrQXJncyA9IFtBVVRPX1NUQVJUX0FSR107XG4gICAgY29uc3QgZm9ya09wdGlvbnM6IEZvcmtPcHRpb25zID0geyBleGVjQXJndiB9O1xuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gZm9yayhcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIHR5cGVDaGVja2VyRmlsZSksXG4gICAgICBmb3JrQXJncyxcbiAgICAgIGZvcmtPcHRpb25zKTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBtZXNzYWdlcy5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub24oJ21lc3NhZ2UnLCBtZXNzYWdlID0+IHtcbiAgICAgIHN3aXRjaCAobWVzc2FnZS5raW5kKSB7XG4gICAgICAgIGNhc2UgTUVTU0FHRV9LSU5ELkxvZzpcbiAgICAgICAgICBjb25zdCBsb2dNZXNzYWdlID0gbWVzc2FnZSBhcyBMb2dNZXNzYWdlO1xuICAgICAgICAgIHRoaXMuX2xvZ2dlci5sb2cobG9nTWVzc2FnZS5sZXZlbCwgYFxcbiR7bG9nTWVzc2FnZS5tZXNzYWdlfWApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHlwZUNoZWNrZXI6IFVuZXhwZWN0ZWQgbWVzc2FnZSByZWNlaXZlZDogJHttZXNzYWdlfS5gKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBwcm9jZXNzIGV4aXQuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLm9uY2UoJ2V4aXQnLCAoXywgc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuXG4gICAgICAvLyBJZiBwcm9jZXNzIGV4aXRlZCBub3QgYmVjYXVzZSBvZiBTSUdURVJNIChzZWUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlciksIHRoYW4gc29tZXRoaW5nXG4gICAgICAvLyB3ZW50IHdyb25nIGFuZCBpdCBzaG91bGQgZmFsbGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiB0aGUgbWFpbiB0aHJlYWQuXG4gICAgICBpZiAoc2lnbmFsICE9PSAnU0lHVEVSTScpIHtcbiAgICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1zZyA9ICdBbmd1bGFyQ29tcGlsZXJQbHVnaW46IEZvcmtlZCBUeXBlIENoZWNrZXIgZXhpdGVkIHVuZXhwZWN0ZWRseS4gJyArXG4gICAgICAgICAgJ0ZhbGxpbmcgYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIG1haW4gdGhyZWFkLic7XG4gICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobXNnKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQpIHtcbiAgICAgIHRyZWVLaWxsKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQsICdTSUdURVJNJyk7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZUZvcmtlZFR5cGVDaGVja2VyKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgIGlmICghdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCkge1xuICAgICAgICBsZXQgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB7fTtcbiAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNcbiAgICAgICAgICAmJiB0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyAhPSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcywgaG9zdFJlcGxhY2VtZW50UGF0aHMpKTtcbiAgICAgICAgdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICB9XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Muc2VuZChuZXcgVXBkYXRlTWVzc2FnZShyb290TmFtZXMsIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzKSk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVnaXN0cmF0aW9uIGhvb2sgZm9yIHdlYnBhY2sgcGx1Z2luLlxuICBhcHBseShjb21waWxlcjogQ29tcGlsZXIgJiB7IHdhdGNoTW9kZT86IGJvb2xlYW4gfSkge1xuICAgIC8vIG9ubHkgcHJlc2VudCBmb3Igd2VicGFjayA0LjIzLjArLCBhc3N1bWUgdHJ1ZSBvdGhlcndpc2VcbiAgICBjb25zdCB3YXRjaE1vZGUgPSBjb21waWxlci53YXRjaE1vZGUgPT09IHVuZGVmaW5lZCA/IHRydWUgOiBjb21waWxlci53YXRjaE1vZGU7XG5cbiAgICAvLyBEZWNvcmF0ZSBpbnB1dEZpbGVTeXN0ZW0gdG8gc2VydmUgY29udGVudHMgb2YgQ29tcGlsZXJIb3N0LlxuICAgIC8vIFVzZSBkZWNvcmF0ZWQgaW5wdXRGaWxlU3lzdGVtIGluIHdhdGNoRmlsZVN5c3RlbS5cbiAgICBjb21waWxlci5ob29rcy5lbnZpcm9ubWVudC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICAvLyBUaGUgd2VicGFjayB0eXBlcyBjdXJyZW50bHkgZG8gbm90IGluY2x1ZGUgdGhlc2VcbiAgICAgIGNvbnN0IGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zID0gY29tcGlsZXIgYXMgQ29tcGlsZXIgJiB7XG4gICAgICAgIHdhdGNoRmlsZVN5c3RlbTogTm9kZVdhdGNoRmlsZVN5c3RlbUludGVyZmFjZSxcbiAgICAgIH07XG5cbiAgICAgIGxldCBob3N0OiB2aXJ0dWFsRnMuSG9zdDxmcy5TdGF0cz4gPSB0aGlzLl9vcHRpb25zLmhvc3QgfHwgbmV3IFdlYnBhY2tJbnB1dEhvc3QoXG4gICAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSxcbiAgICAgICk7XG5cbiAgICAgIGxldCByZXBsYWNlbWVudHM6IE1hcDxQYXRoLCBQYXRoPiB8ICgocGF0aDogUGF0aCkgPT4gUGF0aCkgfCB1bmRlZmluZWQ7XG4gICAgICBpZiAodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGNvbnN0IHJlcGxhY2VtZW50UmVzb2x2ZXIgPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzO1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IHBhdGggPT4gbm9ybWFsaXplKHJlcGxhY2VtZW50UmVzb2x2ZXIoZ2V0U3lzdGVtUGF0aChwYXRoKSkpO1xuICAgICAgICAgIGhvc3QgPSBuZXcgY2xhc3MgZXh0ZW5kcyB2aXJ0dWFsRnMuUmVzb2x2ZXJIb3N0PGZzLlN0YXRzPiB7XG4gICAgICAgICAgICBfcmVzb2x2ZShwYXRoOiBQYXRoKSB7XG4gICAgICAgICAgICAgIHJldHVybiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfShob3N0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXBsYWNlbWVudHMgPSBuZXcgTWFwKCk7XG4gICAgICAgICAgY29uc3QgYWxpYXNIb3N0ID0gbmV3IHZpcnR1YWxGcy5BbGlhc0hvc3QoaG9zdCk7XG4gICAgICAgICAgZm9yIChjb25zdCBmcm9tIGluIHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRGcm9tID0gcmVzb2x2ZShub3JtYWxpemUodGhpcy5fYmFzZVBhdGgpLCBub3JtYWxpemUoZnJvbSkpO1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFdpdGggPSByZXNvbHZlKFxuICAgICAgICAgICAgICBub3JtYWxpemUodGhpcy5fYmFzZVBhdGgpLFxuICAgICAgICAgICAgICBub3JtYWxpemUodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRoc1tmcm9tXSksXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxpYXNIb3N0LmFsaWFzZXMuc2V0KG5vcm1hbGl6ZWRGcm9tLCBub3JtYWxpemVkV2l0aCk7XG4gICAgICAgICAgICByZXBsYWNlbWVudHMuc2V0KG5vcm1hbGl6ZWRGcm9tLCBub3JtYWxpemVkV2l0aCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGhvc3QgPSBhbGlhc0hvc3Q7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ3JlYXRlIHRoZSB3ZWJwYWNrIGNvbXBpbGVyIGhvc3QuXG4gICAgICBjb25zdCB3ZWJwYWNrQ29tcGlsZXJIb3N0ID0gbmV3IFdlYnBhY2tDb21waWxlckhvc3QoXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHdhdGNoTW9kZSxcbiAgICAgICk7XG5cbiAgICAgIC8vIENyZWF0ZSBhbmQgc2V0IGEgbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlci5cbiAgICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyID0gbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlcigpO1xuICAgICAgd2VicGFja0NvbXBpbGVySG9zdC5zZXRSZXNvdXJjZUxvYWRlcih0aGlzLl9yZXNvdXJjZUxvYWRlcik7XG5cbiAgICAgIC8vIFVzZSB0aGUgV2VicGFja0NvbXBpbGVySG9zdCB3aXRoIGEgcmVzb3VyY2UgbG9hZGVyIHRvIGNyZWF0ZSBhbiBBbmd1bGFyQ29tcGlsZXJIb3N0LlxuICAgICAgdGhpcy5fY29tcGlsZXJIb3N0ID0gY3JlYXRlQ29tcGlsZXJIb3N0KHtcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0c0hvc3Q6IHdlYnBhY2tDb21waWxlckhvc3QsXG4gICAgICB9KSBhcyBDb21waWxlckhvc3QgJiBXZWJwYWNrQ29tcGlsZXJIb3N0O1xuXG4gICAgICAvLyBSZXNvbHZlIG1haW5QYXRoIGlmIHByb3ZpZGVkLlxuICAgICAgaWYgKHRoaXMuX29wdGlvbnMubWFpblBhdGgpIHtcbiAgICAgICAgdGhpcy5fbWFpblBhdGggPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZSh0aGlzLl9vcHRpb25zLm1haW5QYXRoKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5wdXREZWNvcmF0b3IgPSBuZXcgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IoXG4gICAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgKTtcbiAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSA9IGlucHV0RGVjb3JhdG9yO1xuICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMud2F0Y2hGaWxlU3lzdGVtID0gbmV3IFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IoXG4gICAgICAgIGlucHV0RGVjb3JhdG9yLFxuICAgICAgICByZXBsYWNlbWVudHMsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIGxhenkgbW9kdWxlcyB0byB0aGUgY29udGV4dCBtb2R1bGUgZm9yIEBhbmd1bGFyL2NvcmVcbiAgICBjb21waWxlci5ob29rcy5jb250ZXh0TW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjbWYgPT4ge1xuICAgICAgY29uc3QgYW5ndWxhckNvcmVQYWNrYWdlUGF0aCA9IHJlcXVpcmUucmVzb2x2ZSgnQGFuZ3VsYXIvY29yZS9wYWNrYWdlLmpzb24nKTtcblxuICAgICAgLy8gQVBGdjYgZG9lcyBub3QgaGF2ZSBzaW5nbGUgRkVTTSBhbnltb3JlLiBJbnN0ZWFkIG9mIHZlcmlmeWluZyBpZiB3ZSdyZSBwb2ludGluZyB0b1xuICAgICAgLy8gRkVTTXMsIHdlIHJlc29sdmUgdGhlIGBAYW5ndWxhci9jb3JlYCBwYXRoIGFuZCB2ZXJpZnkgdGhhdCB0aGUgcGF0aCBmb3IgdGhlXG4gICAgICAvLyBtb2R1bGUgc3RhcnRzIHdpdGggaXQuXG4gICAgICAvLyBUaGlzIG1heSBiZSBzbG93ZXIgYnV0IGl0IHdpbGwgYmUgY29tcGF0aWJsZSB3aXRoIGJvdGggQVBGNSwgNiBhbmQgcG90ZW50aWFsIGZ1dHVyZVxuICAgICAgLy8gdmVyc2lvbnMgKHVudGlsIHRoZSBkeW5hbWljIGltcG9ydCBhcHBlYXJzIG91dHNpZGUgb2YgY29yZSBJIHN1cHBvc2UpLlxuICAgICAgLy8gV2UgcmVzb2x2ZSBhbnkgc3ltYm9saWMgbGlua3MgaW4gb3JkZXIgdG8gZ2V0IHRoZSByZWFsIHBhdGggdGhhdCB3b3VsZCBiZSB1c2VkIGluIHdlYnBhY2suXG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVJlc291cmNlUm9vdCA9IGZzLnJlYWxwYXRoU3luYyhwYXRoLmRpcm5hbWUoYW5ndWxhckNvcmVQYWNrYWdlUGF0aCkpO1xuXG4gICAgICBjbWYuaG9va3MuYWZ0ZXJSZXNvbHZlLnRhcFByb21pc2UoJ2FuZ3VsYXItY29tcGlsZXInLCBhc3luYyByZXN1bHQgPT4ge1xuICAgICAgICAvLyBBbHRlciBvbmx5IGV4aXN0aW5nIHJlcXVlc3QgZnJvbSBBbmd1bGFyIG9yIG9uZSBvZiB0aGUgYWRkaXRpb25hbCBsYXp5IG1vZHVsZSByZXNvdXJjZXMuXG4gICAgICAgIGNvbnN0IGlzTGF6eU1vZHVsZVJlc291cmNlID0gKHJlc291cmNlOiBzdHJpbmcpID0+XG4gICAgICAgICAgcmVzb3VyY2Uuc3RhcnRzV2l0aChhbmd1bGFyQ29yZVJlc291cmNlUm9vdCkgfHxcbiAgICAgICAgICAoIHRoaXMub3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcyAmJlxuICAgICAgICAgICAgdGhpcy5vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlUmVzb3VyY2VzLmluY2x1ZGVzKHJlc291cmNlKSk7XG5cbiAgICAgICAgaWYgKCFyZXN1bHQgfHwgIXRoaXMuZG9uZSB8fCAhaXNMYXp5TW9kdWxlUmVzb3VyY2UocmVzdWx0LnJlc291cmNlKSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5kb25lLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gVGhpcyBmb2xkZXIgZG9lcyBub3QgZXhpc3QsIGJ1dCB3ZSBuZWVkIHRvIGdpdmUgd2VicGFjayBhIHJlc291cmNlLlxuICAgICAgICAgICAgLy8gVE9ETzogY2hlY2sgaWYgd2UgY2FuJ3QganVzdCBsZWF2ZSBpdCBhcyBpcyAoYW5ndWxhckNvcmVNb2R1bGVEaXIpLlxuICAgICAgICAgICAgcmVzdWx0LnJlc291cmNlID0gcGF0aC5qb2luKHRoaXMuX2Jhc2VQYXRoLCAnJCRfbGF6eV9yb3V0ZV9yZXNvdXJjZScpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LmRlcGVuZGVuY2llcy5mb3JFYWNoKChkOiBhbnkpID0+IGQuY3JpdGljYWwgPSBmYWxzZSk7XG4gICAgICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgICAgICByZXN1bHQucmVzb2x2ZURlcGVuZGVuY2llcyA9IChfZnM6IGFueSwgb3B0aW9uczogYW55LCBjYWxsYmFjazogQ2FsbGJhY2spID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gT2JqZWN0LmtleXModGhpcy5fbGF6eVJvdXRlcylcbiAgICAgICAgICAgICAgICAubWFwKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZVBhdGggPSB0aGlzLl9sYXp5Um91dGVzW2tleV07XG4gICAgICAgICAgICAgICAgICBpZiAobW9kdWxlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuYW1lID0ga2V5LnNwbGl0KCcjJylbMF07XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcihtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcih4ID0+ICEheCk7XG5cbiAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubmFtZUxhenlGaWxlcykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuY2h1bmtOYW1lID0gJ1tyZXF1ZXN0XSc7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgICgpID0+IHVuZGVmaW5lZCxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGFuZCBkZXN0cm95IGZvcmtlZCB0eXBlIGNoZWNrZXIgb24gd2F0Y2ggbW9kZS5cbiAgICBjb21waWxlci5ob29rcy53YXRjaFJ1bi50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy53YXRjaENsb3NlLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpKTtcblxuICAgIC8vIFJlbWFrZSB0aGUgcGx1Z2luIG9uIGVhY2ggY29tcGlsYXRpb24uXG4gICAgY29tcGlsZXIuaG9va3MubWFrZS50YXBQcm9taXNlKFxuICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgY29tcGlsYXRpb24gPT4gdGhpcy5fZG9uZVByb21pc2UgPSB0aGlzLl9tYWtlKGNvbXBpbGF0aW9uKSxcbiAgICApO1xuICAgIGNvbXBpbGVyLmhvb2tzLmludmFsaWQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4gdGhpcy5fZmlyc3RSdW4gPSBmYWxzZSk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJFbWl0LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGF0aW9uID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gbnVsbDtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGVyID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxlciBhcyBhbnkpLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlclxuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVzb2x2ZXI6IGFueSkgPT4ge1xuICAgICAgICAgIG5ldyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4odGhpcy5fY29tcGlsZXJPcHRpb25zKS5hcHBseShyZXNvbHZlcik7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIG5tZiA9PiB7XG4gICAgICAgIC8vIFZpcnR1YWwgZmlsZSBzeXN0ZW0uXG4gICAgICAgIC8vIFRPRE86IGNvbnNpZGVyIGlmIGl0J3MgYmV0dGVyIHRvIHJlbW92ZSB0aGlzIHBsdWdpbiBhbmQgaW5zdGVhZCBtYWtlIGl0IHdhaXQgb24gdGhlXG4gICAgICAgIC8vIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLlxuICAgICAgICAvLyBXYWl0IGZvciB0aGUgcGx1Z2luIHRvIGJlIGRvbmUgd2hlbiByZXF1ZXN0aW5nIGAudHNgIGZpbGVzIGRpcmVjdGx5IChlbnRyeSBwb2ludHMpLCBvclxuICAgICAgICAvLyB3aGVuIHRoZSBpc3N1ZXIgaXMgYSBgLnRzYCBvciBgLm5nZmFjdG9yeS5qc2AgZmlsZS5cbiAgICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwUHJvbWlzZShcbiAgICAgICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAgICAgYXN5bmMgKHJlcXVlc3Q/OiBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuZG9uZSAmJiByZXF1ZXN0KSB7XG4gICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSByZXF1ZXN0LnJlcXVlc3Q7XG4gICAgICAgICAgICAgIGNvbnN0IGlzc3VlciA9IHJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyO1xuICAgICAgICAgICAgICBpZiAobmFtZS5lbmRzV2l0aCgnLnRzJykgfHwgbmFtZS5lbmRzV2l0aCgnLnRzeCcpXG4gICAgICAgICAgICAgICAgfHwgKGlzc3VlciAmJiAvXFwudHN8bmdmYWN0b3J5XFwuanMkLy50ZXN0KGlzc3VlcikpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuZG9uZTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHsgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgX21ha2UoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSB0cnVlO1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICBpZiAoKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQW4gQG5ndG9vbHMvd2VicGFjayBwbHVnaW4gYWxyZWFkeSBleGlzdCBmb3IgdGhpcyBjb21waWxhdGlvbi4nKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgYSBwcml2YXRlIHZhcmlhYmxlIGZvciB0aGlzIHBsdWdpbiBpbnN0YW5jZS5cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSB0aGlzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSByZXNvdXJjZSBsb2FkZXIgd2l0aCB0aGUgbmV3IHdlYnBhY2sgY29tcGlsYXRpb24uXG4gICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uKTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl91cGRhdGUoKTtcbiAgICAgIHRoaXMucHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKGVycik7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfVxuXG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gIH1cblxuICBwcml2YXRlIHB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbjogY29tcGlsYXRpb24uQ29tcGlsYXRpb24pIHtcbiAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaCguLi50aGlzLl9lcnJvcnMpO1xuICAgIGNvbXBpbGF0aW9uLndhcm5pbmdzLnB1c2goLi4udGhpcy5fd2FybmluZ3MpO1xuICAgIHRoaXMuX2Vycm9ycyA9IFtdO1xuICAgIHRoaXMuX3dhcm5pbmdzID0gW107XG4gIH1cblxuICBwcml2YXRlIF9tYWtlVHJhbnNmb3JtZXJzKCkge1xuICAgIGNvbnN0IGlzQXBwUGF0aCA9IChmaWxlTmFtZTogc3RyaW5nKSA9PlxuICAgICAgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdmYWN0b3J5LnRzJykgJiYgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdzdHlsZS50cycpO1xuICAgIGNvbnN0IGlzTWFpblBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT4gZmlsZU5hbWUgPT09IChcbiAgICAgIHRoaXMuX21haW5QYXRoID8gd29ya2Fyb3VuZFJlc29sdmUodGhpcy5fbWFpblBhdGgpIDogdGhpcy5fbWFpblBhdGhcbiAgICApO1xuICAgIGNvbnN0IGdldEVudHJ5TW9kdWxlID0gKCkgPT4gdGhpcy5lbnRyeU1vZHVsZVxuICAgICAgPyB7IHBhdGg6IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuZW50cnlNb2R1bGUucGF0aCksIGNsYXNzTmFtZTogdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWUgfVxuICAgICAgOiB0aGlzLmVudHJ5TW9kdWxlO1xuICAgIGNvbnN0IGdldExhenlSb3V0ZXMgPSAoKSA9PiB0aGlzLl9sYXp5Um91dGVzO1xuICAgIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gKHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pLmdldFR5cGVDaGVja2VyKCk7XG5cbiAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgLy8gUmVwbGFjZSByZXNvdXJjZXMgaW4gSklULlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZVJlc291cmNlcyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW92ZSB1bm5lZWRlZCBhbmd1bGFyIGRlY29yYXRvcnMuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZW1vdmVEZWNvcmF0b3JzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKC4uLnRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5Ccm93c2VyKSB7XG4gICAgICAgIC8vIElmIHdlIGhhdmUgYSBsb2NhbGUsIGF1dG8gaW1wb3J0IHRoZSBsb2NhbGUgZGF0YSBmaWxlLlxuICAgICAgICAvLyBUaGlzIHRyYW5zZm9ybSBtdXN0IGdvIGJlZm9yZSByZXBsYWNlQm9vdHN0cmFwIGJlY2F1c2UgaXQgbG9va3MgZm9yIHRoZSBlbnRyeSBtb2R1bGVcbiAgICAgICAgLy8gaW1wb3J0LCB3aGljaCB3aWxsIGJlIHJlcGxhY2VkLlxuICAgICAgICBpZiAodGhpcy5fbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlZ2lzdGVyTG9jYWxlRGF0YShpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgLy8gUmVwbGFjZSBib290c3RyYXAgaW4gYnJvd3NlciBBT1QuXG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZUJvb3RzdHJhcChpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5TZXJ2ZXIpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goZXhwb3J0TGF6eU1vZHVsZU1hcChpc01haW5QYXRoLCBnZXRMYXp5Um91dGVzKSk7XG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICAgICAgZXhwb3J0TmdGYWN0b3J5KGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlKSxcbiAgICAgICAgICAgIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF91cGRhdGUoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgICAvLyBXZSBvbmx5IHdhbnQgdG8gdXBkYXRlIG9uIFRTIGFuZCB0ZW1wbGF0ZSBjaGFuZ2VzLCBidXQgYWxsIGtpbmRzIG9mIGZpbGVzIGFyZSBvbiB0aGlzXG4gICAgLy8gbGlzdCwgbGlrZSBwYWNrYWdlLmpzb24gYW5kIC5uZ3N1bW1hcnkuanNvbiBmaWxlcy5cbiAgICBjb25zdCBjaGFuZ2VkRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpO1xuXG4gICAgLy8gSWYgbm90aGluZyB3ZSBjYXJlIGFib3V0IGNoYW5nZWQgYW5kIGl0IGlzbid0IHRoZSBmaXJzdCBydW4sIGRvbid0IGRvIGFueXRoaW5nLlxuICAgIGlmIChjaGFuZ2VkRmlsZXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgYXdhaXQgdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCk7XG5cbiAgICAvLyBGaW5kIGxhenkgcm91dGVzXG4gICAgY29uc3QgbGF6eVJvdXRlTWFwOiBMYXp5Um91dGVNYXAgPSB7XG4gICAgICAuLi50aGlzLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCksXG4gICAgICAuLi50aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcyxcbiAgICB9O1xuICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKGxhenlSb3V0ZU1hcCk7XG5cbiAgICAvLyBFbWl0IGZpbGVzLlxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgY29uc3QgeyBlbWl0UmVzdWx0LCBkaWFnbm9zdGljcyB9ID0gdGhpcy5fZW1pdCgpO1xuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG5cbiAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgY29uc3QgZXJyb3JzID0gZGlhZ25vc3RpY3NcbiAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvcik7XG4gICAgY29uc3Qgd2FybmluZ3MgPSBkaWFnbm9zdGljc1xuICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3MoZXJyb3JzKTtcbiAgICAgIHRoaXMuX2Vycm9ycy5wdXNoKG5ldyBFcnJvcihtZXNzYWdlKSk7XG4gICAgfVxuXG4gICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gIWVtaXRSZXN1bHQgfHwgZW1pdFJlc3VsdC5lbWl0U2tpcHBlZDtcblxuICAgIC8vIFJlc2V0IGNoYW5nZWQgZmlsZXMgb24gc3VjY2Vzc2Z1bCBjb21waWxhdGlvbi5cbiAgICBpZiAoIXRoaXMuX2VtaXRTa2lwcGVkICYmIHRoaXMuX2Vycm9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICB9XG5cbiAgd3JpdGVJMThuT3V0RmlsZSgpIHtcbiAgICBmdW5jdGlvbiBfcmVjdXJzaXZlTWtEaXIocDogc3RyaW5nKSB7XG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMocCkpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShwKSk7XG4gICAgICAgIGZzLm1rZGlyU3luYyhwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXcml0ZSB0aGUgZXh0cmFjdGVkIG1lc3NhZ2VzIHRvIGRpc2suXG4gICAgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSkge1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLCB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpO1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVDb250ZW50ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKGkxOG5PdXRGaWxlUGF0aCk7XG4gICAgICBpZiAoaTE4bk91dEZpbGVDb250ZW50KSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUoaTE4bk91dEZpbGVQYXRoKSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoaTE4bk91dEZpbGVQYXRoLCBpMThuT3V0RmlsZUNvbnRlbnQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldENvbXBpbGVkRmlsZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZSA9IGZpbGVOYW1lLnJlcGxhY2UoLy50c3g/JC8sICcuanMnKTtcbiAgICBsZXQgb3V0cHV0VGV4dDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2VNYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZXJyb3JEZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAodGhpcy5fZW1pdFNraXBwZWQpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICAvLyBJZiB0aGUgY29tcGlsYXRpb24gZGlkbid0IGVtaXQgZmlsZXMgdGhpcyB0aW1lLCB0cnkgdG8gcmV0dXJuIHRoZSBjYWNoZWQgZmlsZXMgZnJvbSB0aGVcbiAgICAgICAgLy8gbGFzdCBjb21waWxhdGlvbiBhbmQgbGV0IHRoZSBjb21waWxhdGlvbiBlcnJvcnMgc2hvdyB3aGF0J3Mgd3JvbmcuXG4gICAgICAgIG91dHB1dFRleHQgPSB0ZXh0O1xuICAgICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUaGVyZSdzIG5vdGhpbmcgd2UgY2FuIHNlcnZlLiBSZXR1cm4gYW4gZW1wdHkgc3RyaW5nIHRvIHByZXZlbnQgbGVuZ2h0eSB3ZWJwYWNrIGVycm9ycyxcbiAgICAgICAgLy8gYWRkIHRoZSByZWJ1aWxkIHdhcm5pbmcgaWYgaXQncyBub3QgdGhlcmUgeWV0LlxuICAgICAgICAvLyBXZSBhbHNvIG5lZWQgdG8gYWxsIGNoYW5nZWQgZmlsZXMgYXMgZGVwZW5kZW5jaWVzIG9mIHRoaXMgZmlsZSwgc28gdGhhdCBhbGwgb2YgdGhlbVxuICAgICAgICAvLyB3aWxsIGJlIHdhdGNoZWQgYW5kIHRyaWdnZXIgYSByZWJ1aWxkIG5leHQgdGltZS5cbiAgICAgICAgb3V0cHV0VGV4dCA9ICcnO1xuICAgICAgICBlcnJvckRlcGVuZGVuY2llcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKClcbiAgICAgICAgICAvLyBUaGVzZSBwYXRocyBhcmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICAgICAgICAubWFwKChwKSA9PiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2hlY2sgaWYgdGhlIFRTIGlucHV0IGZpbGUgYW5kIHRoZSBKUyBvdXRwdXQgZmlsZSBleGlzdC5cbiAgICAgIGlmICgoKGZpbGVOYW1lLmVuZHNXaXRoKCcudHMnKSB8fCBmaWxlTmFtZS5lbmRzV2l0aCgnLnRzeCcpKVxuICAgICAgICAmJiAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoZmlsZU5hbWUpKVxuICAgICAgICB8fCAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMob3V0cHV0RmlsZSwgZmFsc2UpKSB7XG4gICAgICAgIGxldCBtc2cgPSBgJHtmaWxlTmFtZX0gaXMgbWlzc2luZyBmcm9tIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uLiBgXG4gICAgICAgICAgKyBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcblxuICAgICAgICBpZiAoLyhcXFxcfFxcLylub2RlX21vZHVsZXMoXFxcXHxcXC8pLy50ZXN0KGZpbGVOYW1lKSkge1xuICAgICAgICAgIG1zZyArPSAnXFxuVGhlIG1pc3NpbmcgZmlsZSBzZWVtcyB0byBiZSBwYXJ0IG9mIGEgdGhpcmQgcGFydHkgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnVFMgZmlsZXMgaW4gcHVibGlzaGVkIGxpYnJhcmllcyBhcmUgb2Z0ZW4gYSBzaWduIG9mIGEgYmFkbHkgcGFja2FnZWQgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnUGxlYXNlIG9wZW4gYW4gaXNzdWUgaW4gdGhlIGxpYnJhcnkgcmVwb3NpdG9yeSB0byBhbGVydCBpdHMgYXV0aG9yIGFuZCBhc2sgdGhlbSAnXG4gICAgICAgICAgICArICd0byBwYWNrYWdlIHRoZSBsaWJyYXJ5IHVzaW5nIHRoZSBBbmd1bGFyIFBhY2thZ2UgRm9ybWF0IChodHRwczovL2dvby5nbC9qQjNHVnYpLic7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICAgIH1cblxuICAgICAgb3V0cHV0VGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKSB8fCAnJztcbiAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBvdXRwdXRUZXh0LCBzb3VyY2VNYXAsIGVycm9yRGVwZW5kZW5jaWVzIH07XG4gIH1cblxuICBnZXREZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUoZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLl9jb21waWxlckhvc3QuZ2V0U291cmNlRmlsZShyZXNvbHZlZEZpbGVOYW1lLCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0KTtcbiAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fY29tcGlsZXJPcHRpb25zO1xuICAgIGNvbnN0IGhvc3QgPSB0aGlzLl9jb21waWxlckhvc3Q7XG4gICAgY29uc3QgY2FjaGUgPSB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG5cbiAgICBjb25zdCBlc0ltcG9ydHMgPSBjb2xsZWN0RGVlcE5vZGVzPHRzLkltcG9ydERlY2xhcmF0aW9uPihzb3VyY2VGaWxlLFxuICAgICAgdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgIC5tYXAoZGVjbCA9PiB7XG4gICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSAoZGVjbC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dDtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShtb2R1bGVOYW1lLCByZXNvbHZlZEZpbGVOYW1lLCBvcHRpb25zLCBob3N0LCBjYWNoZSk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkLnJlc29sdmVkTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKHggPT4geCk7XG5cbiAgICBjb25zdCByZXNvdXJjZUltcG9ydHMgPSBmaW5kUmVzb3VyY2VzKHNvdXJjZUZpbGUpXG4gICAgICAubWFwKHJlc291cmNlUGF0aCA9PiByZXNvbHZlKGRpcm5hbWUocmVzb2x2ZWRGaWxlTmFtZSksIG5vcm1hbGl6ZShyZXNvdXJjZVBhdGgpKSk7XG5cbiAgICAvLyBUaGVzZSBwYXRocyBhcmUgbWVhbnQgdG8gYmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICBjb25zdCB1bmlxdWVEZXBlbmRlbmNpZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXModGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChyZXNvbHZlZEZpbGVOYW1lKSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8vIFRoaXMgY29kZSBtb3N0bHkgY29tZXMgZnJvbSBgcGVyZm9ybUNvbXBpbGF0aW9uYCBpbiBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYC5cbiAgLy8gSXQgc2tpcHMgdGhlIHByb2dyYW0gY3JlYXRpb24gYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZSBgbG9hZE5nU3RydWN0dXJlQXN5bmMoKWAsXG4gIC8vIGFuZCB1c2VzIEN1c3RvbVRyYW5zZm9ybWVycy5cbiAgcHJpdmF0ZSBfZW1pdCgpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcbiAgICBjb25zdCBwcm9ncmFtID0gdGhpcy5fcHJvZ3JhbTtcbiAgICBjb25zdCBhbGxEaWFnbm9zdGljczogQXJyYXk8dHMuRGlhZ25vc3RpYyB8IERpYWdub3N0aWM+ID0gW107XG4gICAgY29uc3QgZGlhZ01vZGUgPSAodGhpcy5fZmlyc3RSdW4gfHwgIXRoaXMuX2ZvcmtUeXBlQ2hlY2tlcikgP1xuICAgICAgRGlhZ25vc3RpY01vZGUuQWxsIDogRGlhZ25vc3RpY01vZGUuU3ludGFjdGljO1xuXG4gICAgbGV0IGVtaXRSZXN1bHQ6IHRzLkVtaXRSZXN1bHQgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHByb2dyYW0gYXMgdHMuUHJvZ3JhbTtcbiAgICAgICAgY29uc3QgY2hhbmdlZFRzRmlsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4udHNQcm9ncmFtLmdldE9wdGlvbnNEaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gZ2VuZXJhdGUgYSBsaXN0IG9mIGNoYW5nZWQgZmlsZXMgZm9yIGVtaXRcbiAgICAgICAgICAvLyBub3QgbmVlZGVkIG9uIGZpcnN0IHJ1biBzaW5jZSBhIGZ1bGwgcHJvZ3JhbSBlbWl0IGlzIHJlcXVpcmVkXG4gICAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpKSB7XG4gICAgICAgICAgICBpZiAoIWNoYW5nZWRGaWxlLmVuZHNXaXRoKCcudHMnKSAmJiAhY2hhbmdlZEZpbGUuZW5kc1dpdGgoJy50c3gnKSkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGV4aXN0aW5nIHR5cGUgZGVmaW5pdGlvbnMgYXJlIG5vdCBlbWl0dGVkXG4gICAgICAgICAgICBpZiAoY2hhbmdlZEZpbGUuZW5kc1dpdGgoJy5kLnRzJykpIHtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGFuZ2VkVHNGaWxlcy5hZGQoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModHNQcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMnLCBkaWFnTW9kZSkpO1xuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIGlmICh0aGlzLl9maXJzdFJ1biB8fCBjaGFuZ2VkVHNGaWxlcy5zaXplID4gMjApIHtcbiAgICAgICAgICAgIGVtaXRSZXN1bHQgPSB0c1Byb2dyYW0uZW1pdChcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiBjaGFuZ2VkVHNGaWxlcykge1xuICAgICAgICAgICAgICBjb25zdCBzb3VyY2VGaWxlID0gdHNQcm9ncmFtLmdldFNvdXJjZUZpbGUoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgICAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzb3VyY2VGaWxlLmZpbGVOYW1lfSsuZW1pdGA7XG4gICAgICAgICAgICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KHNvdXJjZUZpbGUsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IHByb2dyYW0gYXMgUHJvZ3JhbTtcblxuICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHN0cnVjdHVyYWwgZGlhZ25vc3RpY3MuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzKCkpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBUeXBlU2NyaXB0IHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0VHNPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuXG4gICAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3MoYW5ndWxhclByb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZycsIGRpYWdNb2RlKSk7XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=