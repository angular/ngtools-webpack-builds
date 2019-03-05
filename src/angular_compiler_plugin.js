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
const lazy_routes_1 = require("./lazy_routes");
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
        this._lazyRoutes = {};
        this._transformers = [];
        this._platformTransformers = null;
        this._JitMode = false;
        this._emitSkipped = true;
        this._changedFileExtensions = new Set(['ts', 'tsx', 'html', 'css', 'js', 'json']);
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
        if (!this._entryModule && this._mainPath) {
            benchmark_1.time('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
            this._entryModule = entry_resolver_1.resolveEntryModuleFromMain(this._mainPath, this._compilerHost, this._getTsProgram());
            if (!this.entryModule && !this._compilerOptions.enableIvy) {
                this._warnings.push('Lazy routes discovery is not enabled. '
                    + 'Because there is neither an entryModule nor a '
                    + 'statically analyzable bootstrap code in the main file.');
            }
            benchmark_1.timeEnd('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
        }
    }
    _findLazyRoutesInAst(changedFilePaths) {
        benchmark_1.time('AngularCompilerPlugin._findLazyRoutesInAst');
        const result = {};
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
        let entryRoute;
        let ngProgram;
        if (this._JitMode) {
            if (!this.entryModule) {
                return {};
            }
            benchmark_1.time('AngularCompilerPlugin._listLazyRoutesFromProgram.createProgram');
            ngProgram = compiler_cli_1.createProgram({
                rootNames: this._rootNames,
                options: Object.assign({}, this._compilerOptions, { genDir: '', collectAllErrors: true }),
                host: this._compilerHost,
            });
            benchmark_1.timeEnd('AngularCompilerPlugin._listLazyRoutesFromProgram.createProgram');
            entryRoute = compiler_host_1.workaroundResolve(this.entryModule.path) + '#' + this.entryModule.className;
        }
        else {
            ngProgram = this._program;
        }
        benchmark_1.time('AngularCompilerPlugin._listLazyRoutesFromProgram.listLazyRoutes');
        // entryRoute will only be defined in JIT.
        // In AOT all routes within the program are returned.
        const lazyRoutes = ngProgram.listLazyRoutes(entryRoute);
        benchmark_1.timeEnd('AngularCompilerPlugin._listLazyRoutesFromProgram.listLazyRoutes');
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
            if (this._JitMode ||
                // When using Ivy and not using allowEmptyCodegenFiles, factories are not generated.
                (this._compilerOptions.enableIvy && !this._compilerOptions.allowEmptyCodegenFiles)) {
                modulePath = lazyRouteTSFile;
                moduleKey = `${lazyRouteModule}${moduleName ? '#' + moduleName : ''}`;
            }
            else {
                // NgFactories are only used with AOT on ngc (legacy) mode.
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
    // tslint:disable-next-line:no-big-function
    apply(compiler) {
        // cleanup if not watching
        compiler.hooks.thisCompilation.tap('angular-compiler', compilation => {
            compilation.hooks.finishModules.tap('angular-compiler', () => {
                // only present for webpack 4.23.0+, assume true otherwise
                const watchMode = compiler.watchMode === undefined ? true : compiler.watchMode;
                if (!watchMode) {
                    this._program = null;
                    this._transformers = [];
                    this._resourceLoader = undefined;
                }
            });
        });
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
            const webpackCompilerHost = new compiler_host_1.WebpackCompilerHost(this._compilerOptions, this._basePath, host, true, this._options.directTemplateLoading);
            // Create and set a new WebpackResourceLoader in AOT
            if (!this._JitMode) {
                this._resourceLoader = new resource_loader_1.WebpackResourceLoader();
                webpackCompilerHost.setResourceLoader(this._resourceLoader);
            }
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
        if (this._resourceLoader) {
            this._resourceLoader.update(compilation);
        }
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
            this._transformers.push(transformers_1.replaceResources(isAppPath, getTypeChecker, this._options.directTemplateLoading));
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
                    this._transformers.push(transformers_1.replaceBootstrap(isAppPath, getEntryModule, getTypeChecker, !!this._compilerOptions.enableIvy));
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
    _getChangedTsFiles() {
        return this._getChangedCompilationFiles()
            .filter(k => (k.endsWith('.ts') || k.endsWith('.tsx')) && !k.endsWith('.d.ts'))
            .filter(k => this._compilerHost.fileExists(k));
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
        let lazyRouteMap = {};
        if (!this._JitMode || this._firstRun) {
            lazyRouteMap = this._listLazyRoutesFromProgram();
        }
        else {
            const changedTsFiles = this._getChangedTsFiles();
            if (changedTsFiles.length > 0) {
                lazyRouteMap = this._findLazyRoutesInAst(changedTsFiles);
            }
        }
        // Find lazy routes
        lazyRouteMap = Object.assign({}, lazyRouteMap, this._options.additionalLazyModules);
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
        if (!this._resourceLoader) {
            return [];
        }
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
                        if (!/.(tsx|ts|json|js)$/.test(changedFile)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FROEI7QUFDOUIsb0RBQWdFO0FBQ2hFLHdEQWMrQjtBQUMvQixpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9GO0FBQ3BGLCtDQUE2RDtBQUM3RCxpREFBdUQ7QUFDdkQsdURBQTBEO0FBQzFELGlEQVN3QjtBQUN4Qiw0REFBOEQ7QUFDOUQsaURBRXdCO0FBQ3hCLG1FQUtpQztBQUNqQyxtRkFHeUM7QUFNekMsNkRBQXdEO0FBRXhELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQThDdEMsSUFBWSxRQUdYO0FBSEQsV0FBWSxRQUFRO0lBQ2xCLDZDQUFPLENBQUE7SUFDUCwyQ0FBTSxDQUFBO0FBQ1IsQ0FBQyxFQUhXLFFBQVEsR0FBUixnQkFBUSxLQUFSLGdCQUFRLFFBR25CO0FBRUQsTUFBYSxxQkFBcUI7SUF1Q2hDLFlBQVksT0FBcUM7UUE3QmpELDhEQUE4RDtRQUN0RCxnQkFBVyxHQUFpQixFQUFFLENBQUM7UUFLL0Isa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUVyRixrQkFB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QUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsNkRBQTZEO3dCQUMvRSw0QkFBNEIsTUFBTSxLQUFLO3dCQUN2QyxzQkFBc0IsTUFBTTtrRUFDMEIsQ0FBQyxDQUFDO29CQUUxRCxPQUFPLElBQUksQ0FBQztpQkFDYjthQUNGO1NBQ0Y7UUFFRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0NBQ0Y7QUFqbkNELHNEQWluQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQge1xuICBQYXRoLFxuICBkaXJuYW1lLFxuICBnZXRTeXN0ZW1QYXRoLFxuICBsb2dnaW5nLFxuICBub3JtYWxpemUsXG4gIHJlc29sdmUsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHtcbiAgQ29tcGlsZXJIb3N0LFxuICBDb21waWxlck9wdGlvbnMsXG4gIERFRkFVTFRfRVJST1JfQ09ERSxcbiAgRGlhZ25vc3RpYyxcbiAgRW1pdEZsYWdzLFxuICBQcm9ncmFtLFxuICBTT1VSQ0UsXG4gIFVOS05PV05fRVJST1JfQ09ERSxcbiAgVkVSU0lPTixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBDb21waWxlciwgY29tcGlsYXRpb24gfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgRGlhZ25vc3RpY01vZGUsIGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBMYXp5Um91dGVNYXAsIGZpbmRMYXp5Um91dGVzIH0gZnJvbSAnLi9sYXp5X3JvdXRlcyc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQge1xuICBleHBvcnRMYXp5TW9kdWxlTWFwLFxuICBleHBvcnROZ0ZhY3RvcnksXG4gIGZpbmRSZXNvdXJjZXMsXG4gIHJlZ2lzdGVyTG9jYWxlRGF0YSxcbiAgcmVtb3ZlRGVjb3JhdG9ycyxcbiAgcmVwbGFjZUJvb3RzdHJhcCxcbiAgcmVwbGFjZVJlc291cmNlcyxcbiAgcmVwbGFjZVNlcnZlckJvb3RzdHJhcCxcbn0gZnJvbSAnLi90cmFuc2Zvcm1lcnMnO1xuaW1wb3J0IHsgY29sbGVjdERlZXBOb2RlcyB9IGZyb20gJy4vdHJhbnNmb3JtZXJzL2FzdF9oZWxwZXJzJztcbmltcG9ydCB7XG4gIEFVVE9fU1RBUlRfQVJHLFxufSBmcm9tICcuL3R5cGVfY2hlY2tlcic7XG5pbXBvcnQge1xuICBJbml0TWVzc2FnZSxcbiAgTG9nTWVzc2FnZSxcbiAgTUVTU0FHRV9LSU5ELFxuICBVcGRhdGVNZXNzYWdlLFxufSBmcm9tICcuL3R5cGVfY2hlY2tlcl9tZXNzYWdlcyc7XG5pbXBvcnQge1xuICBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvcixcbiAgVmlydHVhbFdhdGNoRmlsZVN5c3RlbURlY29yYXRvcixcbn0gZnJvbSAnLi92aXJ0dWFsX2ZpbGVfc3lzdGVtX2RlY29yYXRvcic7XG5pbXBvcnQge1xuICBDYWxsYmFjayxcbiAgTm9kZVdhdGNoRmlsZVN5c3RlbUludGVyZmFjZSxcbiAgTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QsXG59IGZyb20gJy4vd2VicGFjayc7XG5pbXBvcnQgeyBXZWJwYWNrSW5wdXRIb3N0IH0gZnJvbSAnLi93ZWJwYWNrLWlucHV0LWhvc3QnO1xuXG5jb25zdCB0cmVlS2lsbCA9IHJlcXVpcmUoJ3RyZWUta2lsbCcpO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB7IH1cblxuZXhwb3J0IGludGVyZmFjZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvciB7XG4gIG5ldyhtb2R1bGVQYXRoOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeTtcbn1cblxuLyoqXG4gKiBPcHRpb24gQ29uc3RhbnRzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucyB7XG4gIHNvdXJjZU1hcD86IGJvb2xlYW47XG4gIHRzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBiYXNlUGF0aD86IHN0cmluZztcbiAgZW50cnlNb2R1bGU/OiBzdHJpbmc7XG4gIG1haW5QYXRoPzogc3RyaW5nO1xuICBza2lwQ29kZUdlbmVyYXRpb24/OiBib29sZWFuO1xuICBob3N0UmVwbGFjZW1lbnRQYXRocz86IHsgW3BhdGg6IHN0cmluZ106IHN0cmluZyB9IHwgKChwYXRoOiBzdHJpbmcpID0+IHN0cmluZyk7XG4gIGZvcmtUeXBlQ2hlY2tlcj86IGJvb2xlYW47XG4gIGkxOG5JbkZpbGU/OiBzdHJpbmc7XG4gIGkxOG5JbkZvcm1hdD86IHN0cmluZztcbiAgaTE4bk91dEZpbGU/OiBzdHJpbmc7XG4gIGkxOG5PdXRGb3JtYXQ/OiBzdHJpbmc7XG4gIGxvY2FsZT86IHN0cmluZztcbiAgbWlzc2luZ1RyYW5zbGF0aW9uPzogc3RyaW5nO1xuICBwbGF0Zm9ybT86IFBMQVRGT1JNO1xuICBuYW1lTGF6eUZpbGVzPzogYm9vbGVhbjtcbiAgbG9nZ2VyPzogbG9nZ2luZy5Mb2dnZXI7XG4gIGRpcmVjdFRlbXBsYXRlTG9hZGluZz86IGJvb2xlYW47XG5cbiAgLy8gYWRkZWQgdG8gdGhlIGxpc3Qgb2YgbGF6eSByb3V0ZXNcbiAgYWRkaXRpb25hbExhenlNb2R1bGVzPzogeyBbbW9kdWxlOiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgYWRkaXRpb25hbExhenlNb2R1bGVSZXNvdXJjZXM/OiBzdHJpbmdbXTtcblxuICAvLyBUaGUgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IG9mIGNvcnJlY3QgV2VicGFjayBjb21waWxhdGlvbi5cbiAgLy8gVGhpcyBpcyBuZWVkZWQgd2hlbiB0aGVyZSBhcmUgbXVsdGlwbGUgV2VicGFjayBpbnN0YWxscy5cbiAgY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I/OiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjtcblxuICAvLyBVc2UgdHNjb25maWcgdG8gaW5jbHVkZSBwYXRoIGdsb2JzLlxuICBjb21waWxlck9wdGlvbnM/OiB0cy5Db21waWxlck9wdGlvbnM7XG5cbiAgaG9zdD86IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPjtcbiAgcGxhdGZvcm1UcmFuc2Zvcm1lcnM/OiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXTtcbn1cblxuZXhwb3J0IGVudW0gUExBVEZPUk0ge1xuICBCcm93c2VyLFxuICBTZXJ2ZXIsXG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyQ29tcGlsZXJQbHVnaW4ge1xuICBwcml2YXRlIF9vcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zO1xuXG4gIC8vIFRTIGNvbXBpbGF0aW9uLlxuICBwcml2YXRlIF9jb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucztcbiAgcHJpdmF0ZSBfcm9vdE5hbWVzOiBzdHJpbmdbXTtcbiAgcHJpdmF0ZSBfcHJvZ3JhbTogKHRzLlByb2dyYW0gfCBQcm9ncmFtKSB8IG51bGw7XG4gIHByaXZhdGUgX2NvbXBpbGVySG9zdDogV2VicGFja0NvbXBpbGVySG9zdCAmIENvbXBpbGVySG9zdDtcbiAgcHJpdmF0ZSBfbW9kdWxlUmVzb2x1dGlvbkNhY2hlOiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG4gIHByaXZhdGUgX3Jlc291cmNlTG9hZGVyPzogV2VicGFja1Jlc291cmNlTG9hZGVyO1xuICAvLyBDb250YWlucyBgbW9kdWxlSW1wb3J0UGF0aCNleHBvcnROYW1lYCA9PiBgZnVsbE1vZHVsZVBhdGhgLlxuICBwcml2YXRlIF9sYXp5Um91dGVzOiBMYXp5Um91dGVNYXAgPSB7fTtcbiAgcHJpdmF0ZSBfdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgX2VudHJ5TW9kdWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF9tYWluUGF0aDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIF9iYXNlUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF90cmFuc2Zvcm1lcnM6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdID0gW107XG4gIHByaXZhdGUgX3BsYXRmb3JtVHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIF9wbGF0Zm9ybTogUExBVEZPUk07XG4gIHByaXZhdGUgX0ppdE1vZGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBfZW1pdFNraXBwZWQgPSB0cnVlO1xuICBwcml2YXRlIF9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMgPSBuZXcgU2V0KFsndHMnLCAndHN4JywgJ2h0bWwnLCAnY3NzJywgJ2pzJywgJ2pzb24nXSk7XG5cbiAgLy8gV2VicGFjayBwbHVnaW4uXG4gIHByaXZhdGUgX2ZpcnN0UnVuID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfZG9uZVByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsO1xuICBwcml2YXRlIF9ub3JtYWxpemVkTG9jYWxlOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIF93YXJuaW5nczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG4gIHByaXZhdGUgX2Vycm9yczogKHN0cmluZyB8IEVycm9yKVtdID0gW107XG4gIHByaXZhdGUgX2NvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjtcblxuICAvLyBUeXBlQ2hlY2tlciBwcm9jZXNzLlxuICBwcml2YXRlIF9mb3JrVHlwZUNoZWNrZXIgPSB0cnVlO1xuICBwcml2YXRlIF90eXBlQ2hlY2tlclByb2Nlc3M6IENoaWxkUHJvY2VzcyB8IG51bGw7XG4gIHByaXZhdGUgX2ZvcmtlZFR5cGVDaGVja2VySW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICAvLyBMb2dnaW5nLlxuICBwcml2YXRlIF9sb2dnZXI6IGxvZ2dpbmcuTG9nZ2VyO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aGlzLl9vcHRpb25zID0gT2JqZWN0LmFzc2lnbih7fSwgb3B0aW9ucyk7XG4gICAgdGhpcy5fc2V0dXBPcHRpb25zKHRoaXMuX29wdGlvbnMpO1xuICB9XG5cbiAgZ2V0IG9wdGlvbnMoKSB7IHJldHVybiB0aGlzLl9vcHRpb25zOyB9XG4gIGdldCBkb25lKCkgeyByZXR1cm4gdGhpcy5fZG9uZVByb21pc2U7IH1cbiAgZ2V0IGVudHJ5TW9kdWxlKCkge1xuICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBjb25zdCBzcGxpdHRlZCA9IHRoaXMuX2VudHJ5TW9kdWxlLnNwbGl0KC8oI1thLXpBLVpfXShbXFx3XSspKSQvKTtcbiAgICBjb25zdCBwYXRoID0gc3BsaXR0ZWRbMF07XG4gICAgY29uc3QgY2xhc3NOYW1lID0gISFzcGxpdHRlZFsxXSA/IHNwbGl0dGVkWzFdLnN1YnN0cmluZygxKSA6ICdkZWZhdWx0JztcblxuICAgIHJldHVybiB7IHBhdGgsIGNsYXNzTmFtZSB9O1xuICB9XG5cbiAgZ2V0IHR5cGVDaGVja2VyKCk6IHRzLlR5cGVDaGVja2VyIHwgbnVsbCB7XG4gICAgY29uc3QgdHNQcm9ncmFtID0gdGhpcy5fZ2V0VHNQcm9ncmFtKCk7XG5cbiAgICByZXR1cm4gdHNQcm9ncmFtID8gdHNQcm9ncmFtLmdldFR5cGVDaGVja2VyKCkgOiBudWxsO1xuICB9XG5cbiAgc3RhdGljIGlzU3VwcG9ydGVkKCkge1xuICAgIHJldHVybiBWRVJTSU9OICYmIHBhcnNlSW50KFZFUlNJT04ubWFqb3IpID49IDU7XG4gIH1cblxuICBwcml2YXRlIF9zZXR1cE9wdGlvbnMob3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucykge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gICAgdGhpcy5fbG9nZ2VyID0gb3B0aW9ucy5sb2dnZXIgfHwgY3JlYXRlQ29uc29sZUxvZ2dlcigpO1xuXG4gICAgLy8gRmlsbCBpbiB0aGUgbWlzc2luZyBvcHRpb25zLlxuICAgIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgndHNDb25maWdQYXRoJykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTXVzdCBzcGVjaWZ5IFwidHNDb25maWdQYXRoXCIgaW4gdGhlIGNvbmZpZ3VyYXRpb24gb2YgQG5ndG9vbHMvd2VicGFjay4nKTtcbiAgICB9XG4gICAgLy8gVFMgcmVwcmVzZW50cyBwYXRocyBpbnRlcm5hbGx5IHdpdGggJy8nIGFuZCBleHBlY3RzIHRoZSB0c2NvbmZpZyBwYXRoIHRvIGJlIGluIHRoaXMgZm9ybWF0XG4gICAgdGhpcy5fdHNDb25maWdQYXRoID0gb3B0aW9ucy50c0NvbmZpZ1BhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuXG4gICAgLy8gQ2hlY2sgdGhlIGJhc2UgcGF0aC5cbiAgICBjb25zdCBtYXliZUJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgbGV0IGJhc2VQYXRoID0gbWF5YmVCYXNlUGF0aDtcbiAgICBpZiAoZnMuc3RhdFN5bmMobWF5YmVCYXNlUGF0aCkuaXNGaWxlKCkpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5kaXJuYW1lKGJhc2VQYXRoKTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuYmFzZVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgYmFzZVBhdGggPSBwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgb3B0aW9ucy5iYXNlUGF0aCk7XG4gICAgfVxuXG4gICAgLy8gUGFyc2UgdGhlIHRzY29uZmlnIGNvbnRlbnRzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgaWYgKGNvbmZpZy5lcnJvcnMgJiYgY29uZmlnLmVycm9ycy5sZW5ndGgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihmb3JtYXREaWFnbm9zdGljcyhjb25maWcuZXJyb3JzKSk7XG4gICAgfVxuXG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcztcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMgPSB7IC4uLmNvbmZpZy5vcHRpb25zLCAuLi5vcHRpb25zLmNvbXBpbGVyT3B0aW9ucyB9O1xuICAgIHRoaXMuX2Jhc2VQYXRoID0gY29uZmlnLm9wdGlvbnMuYmFzZVBhdGggfHwgYmFzZVBhdGggfHwgJyc7XG5cbiAgICAvLyBPdmVyd3JpdGUgb3V0RGlyIHNvIHdlIGNhbiBmaW5kIGdlbmVyYXRlZCBmaWxlcyBuZXh0IHRvIHRoZWlyIC50cyBvcmlnaW4gaW4gY29tcGlsZXJIb3N0LlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSAnJztcbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuXG4gICAgLy8gRGVmYXVsdCBwbHVnaW4gc291cmNlTWFwIHRvIGNvbXBpbGVyIG9wdGlvbnMgc2V0dGluZy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3NvdXJjZU1hcCcpKSB7XG4gICAgICBvcHRpb25zLnNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgfHwgZmFsc2U7XG4gICAgfVxuXG4gICAgLy8gRm9yY2UgdGhlIHJpZ2h0IHNvdXJjZW1hcCBvcHRpb25zLlxuICAgIGlmIChvcHRpb25zLnNvdXJjZU1hcCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHRydWU7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gZmFsc2U7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIC8vIFdlIHdpbGwgc2V0IHRoZSBzb3VyY2UgdG8gdGhlIGZ1bGwgcGF0aCBvZiB0aGUgZmlsZSBpbiB0aGUgbG9hZGVyLCBzbyB3ZSBkb24ndFxuICAgICAgLy8gbmVlZCBzb3VyY2VSb290IGhlcmUuXG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIC8vIFdlIHdhbnQgdG8gYWxsb3cgZW1pdHRpbmcgd2l0aCBlcnJvcnMgc28gdGhhdCBpbXBvcnRzIGNhbiBiZSBhZGRlZFxuICAgIC8vIHRvIHRoZSB3ZWJwYWNrIGRlcGVuZGVuY3kgdHJlZSBhbmQgcmVidWlsZHMgdHJpZ2dlcmVkIGJ5IGZpbGUgZWRpdHMuXG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcblxuICAgIC8vIFNldCBKSVQgKG5vIGNvZGUgZ2VuZXJhdGlvbikgb3IgQU9UIG1vZGUuXG4gICAgaWYgKG9wdGlvbnMuc2tpcENvZGVHZW5lcmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX0ppdE1vZGUgPSBvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbjtcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGkxOG4gb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5pMThuSW5GaWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5GaWxlID0gb3B0aW9ucy5pMThuSW5GaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuSW5Gb3JtYXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkZvcm1hdCA9IG9wdGlvbnMuaTE4bkluRm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0RmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUgPSBvcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5pMThuT3V0Rm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0Rm9ybWF0ID0gb3B0aW9ucy5pMThuT3V0Rm9ybWF0O1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5sb2NhbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5JbkxvY2FsZSA9IG9wdGlvbnMubG9jYWxlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRMb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUgPSB0aGlzLl92YWxpZGF0ZUxvY2FsZShvcHRpb25zLmxvY2FsZSk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluTWlzc2luZ1RyYW5zbGF0aW9ucyA9XG4gICAgICAgIG9wdGlvbnMubWlzc2luZ1RyYW5zbGF0aW9uIGFzICdlcnJvcicgfCAnd2FybmluZycgfCAnaWdub3JlJztcbiAgICB9XG5cbiAgICAvLyBQcm9jZXNzIGZvcmtlZCB0eXBlIGNoZWNrZXIgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5mb3JrVHlwZUNoZWNrZXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gb3B0aW9ucy5mb3JrVHlwZUNoZWNrZXI7XG4gICAgfVxuICAgIC8vIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IGZhbHNlO1xuXG4gICAgLy8gQWRkIGN1c3RvbSBwbGF0Zm9ybSB0cmFuc2Zvcm1lcnMuXG4gICAgaWYgKG9wdGlvbnMucGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgPSBvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzO1xuICAgIH1cblxuICAgIC8vIERlZmF1bHQgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHRvIHRoZSBvbmUgd2UgY2FuIGltcG9ydCBmcm9tIGhlcmUuXG4gICAgLy8gRmFpbGluZyB0byB1c2UgdGhlIHJpZ2h0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB3aWxsIHRocm93IHRoZSBlcnJvciBiZWxvdzpcbiAgICAvLyBcIk5vIG1vZHVsZSBmYWN0b3J5IGF2YWlsYWJsZSBmb3IgZGVwZW5kZW5jeSB0eXBlOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3lcIlxuICAgIC8vIEhvaXN0aW5nIHRvZ2V0aGVyIHdpdGggcGVlciBkZXBlbmRlbmNpZXMgY2FuIG1ha2UgaXQgc28gdGhlIGltcG9ydGVkXG4gICAgLy8gQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IGRvZXMgbm90IGNvbWUgZnJvbSB0aGUgc2FtZSBXZWJwYWNrIGluc3RhbmNlIHRoYXQgaXMgdXNlZFxuICAgIC8vIGluIHRoZSBjb21waWxhdGlvbi4gSW4gdGhhdCBjYXNlLCB3ZSBjYW4gcGFzcyB0aGUgcmlnaHQgb25lIGFzIGFuIG9wdGlvbiB0byB0aGUgcGx1Z2luLlxuICAgIHRoaXMuX2NvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yID0gb3B0aW9ucy5jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvclxuICAgICAgfHwgcmVxdWlyZSgnd2VicGFjay9saWIvZGVwZW5kZW5jaWVzL0NvbnRleHRFbGVtZW50RGVwZW5kZW5jeScpO1xuXG4gICAgLy8gVXNlIGVudHJ5TW9kdWxlIGlmIGF2YWlsYWJsZSBpbiBvcHRpb25zLCBvdGhlcndpc2UgcmVzb2x2ZSBpdCBmcm9tIG1haW5QYXRoIGFmdGVyIHByb2dyYW1cbiAgICAvLyBjcmVhdGlvbi5cbiAgICBpZiAodGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSB0aGlzLl9vcHRpb25zLmVudHJ5TW9kdWxlO1xuICAgIH0gZWxzZSBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlKSB7XG4gICAgICB0aGlzLl9lbnRyeU1vZHVsZSA9IHBhdGgucmVzb2x2ZSh0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmVudHJ5TW9kdWxlIGFzIHN0cmluZyk7IC8vIHRlbXBvcmFyeSBjYXN0IGZvciB0eXBlIGlzc3VlXG4gICAgfVxuXG4gICAgLy8gU2V0IHBsYXRmb3JtLlxuICAgIHRoaXMuX3BsYXRmb3JtID0gb3B0aW9ucy5wbGF0Zm9ybSB8fCBQTEFURk9STS5Ccm93c2VyO1xuXG4gICAgLy8gTWFrZSB0cmFuc2Zvcm1lcnMuXG4gICAgdGhpcy5fbWFrZVRyYW5zZm9ybWVycygpO1xuXG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9zZXR1cE9wdGlvbnMnKTtcbiAgfVxuXG4gIHByaXZhdGUgX2dldFRzUHJvZ3JhbSgpIHtcbiAgICBpZiAoIXRoaXMuX3Byb2dyYW0pIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX0ppdE1vZGUgPyB0aGlzLl9wcm9ncmFtIGFzIHRzLlByb2dyYW0gOiAodGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtKS5nZXRUc1Byb2dyYW0oKTtcbiAgfVxuXG4gIHVwZGF0ZUNoYW5nZWRGaWxlRXh0ZW5zaW9ucyhleHRlbnNpb246IHN0cmluZykge1xuICAgIGlmIChleHRlbnNpb24pIHtcbiAgICAgIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucy5hZGQoZXh0ZW5zaW9uKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKVxuICAgICAgLmZpbHRlcihrID0+IHtcbiAgICAgICAgZm9yIChjb25zdCBleHQgb2YgdGhpcy5fY2hhbmdlZEZpbGVFeHRlbnNpb25zKSB7XG4gICAgICAgICAgaWYgKGsuZW5kc1dpdGgoZXh0KSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKSB7XG4gICAgLy8gR2V0IHRoZSByb290IGZpbGVzIGZyb20gdGhlIHRzIGNvbmZpZy5cbiAgICAvLyBXaGVuIGEgbmV3IHJvb3QgbmFtZSAobGlrZSBhIGxhenkgcm91dGUpIGlzIGFkZGVkLCBpdCB3b24ndCBiZSBhdmFpbGFibGUgZnJvbVxuICAgIC8vIGZvbGxvd2luZyBpbXBvcnRzIG9uIHRoZSBleGlzdGluZyBmaWxlcywgc28gd2UgbmVlZCB0byBnZXQgdGhlIG5ldyBsaXN0IG9mIHJvb3QgZmlsZXMuXG4gICAgY29uc3QgY29uZmlnID0gcmVhZENvbmZpZ3VyYXRpb24odGhpcy5fdHNDb25maWdQYXRoKTtcbiAgICB0aGlzLl9yb290TmFtZXMgPSBjb25maWcucm9vdE5hbWVzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSBmb3JrZWQgdHlwZSBjaGVja2VyIHdpdGggYWxsIGNoYW5nZWQgY29tcGlsYXRpb24gZmlsZXMuXG4gICAgLy8gVGhpcyBpbmNsdWRlcyB0ZW1wbGF0ZXMsIHRoYXQgYWxzbyBuZWVkIHRvIGJlIHJlbG9hZGVkIG9uIHRoZSB0eXBlIGNoZWNrZXIuXG4gICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgIXRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICB0aGlzLl91cGRhdGVGb3JrZWRUeXBlQ2hlY2tlcih0aGlzLl9yb290TmFtZXMsIHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCkpO1xuICAgIH1cblxuICAgIC8vIFVzZSBhbiBpZGVudGl0eSBmdW5jdGlvbiBhcyBhbGwgb3VyIHBhdGhzIGFyZSBhYnNvbHV0ZSBhbHJlYWR5LlxuICAgIHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZSA9IHRzLmNyZWF0ZU1vZHVsZVJlc29sdXRpb25DYWNoZSh0aGlzLl9iYXNlUGF0aCwgeCA9PiB4KTtcblxuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuICAgIGNvbnN0IG9sZEZpbGVzID0gbmV3IFNldCh0c1Byb2dyYW0gP1xuICAgICAgdHNQcm9ncmFtLmdldFNvdXJjZUZpbGVzKCkubWFwKHNmID0+IHNmLmZpbGVOYW1lKVxuICAgICAgOiBbXSxcbiAgICApO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIENyZWF0ZSB0aGUgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgdGhpcy5fcHJvZ3JhbSA9IHRzLmNyZWF0ZVByb2dyYW0oXG4gICAgICAgIHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIHRzUHJvZ3JhbSxcbiAgICAgICk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS50cy5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICBmb3IgKGNvbnN0IG5ld0ZpbGUgb2YgbmV3RmlsZXMpIHtcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LmludmFsaWRhdGUobmV3RmlsZS5maWxlTmFtZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBwcm9ncmFtLlxuICAgICAgdGhpcy5fcHJvZ3JhbSA9IGNyZWF0ZVByb2dyYW0oe1xuICAgICAgICByb290TmFtZXM6IHRoaXMuX3Jvb3ROYW1lcyxcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICAgIG9sZFByb2dyYW06IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSxcbiAgICAgIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5sb2FkTmdTdHJ1Y3R1cmVBc3luYycpO1xuICAgICAgYXdhaXQgdGhpcy5fcHJvZ3JhbS5sb2FkTmdTdHJ1Y3R1cmVBc3luYygpO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcblxuICAgICAgY29uc3QgbmV3RmlsZXMgPSB0aGlzLl9wcm9ncmFtLmdldFRzUHJvZ3JhbSgpXG4gICAgICAgIC5nZXRTb3VyY2VGaWxlcygpLmZpbHRlcihzZiA9PiAhb2xkRmlsZXMuaGFzKHNmLmZpbGVOYW1lKSk7XG4gICAgICBmb3IgKGNvbnN0IG5ld0ZpbGUgb2YgbmV3RmlsZXMpIHtcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LmludmFsaWRhdGUobmV3RmlsZS5maWxlTmFtZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgdGhlcmUncyBzdGlsbCBubyBlbnRyeU1vZHVsZSB0cnkgdG8gcmVzb2x2ZSBmcm9tIG1haW5QYXRoLlxuICAgIGlmICghdGhpcy5fZW50cnlNb2R1bGUgJiYgdGhpcy5fbWFpblBhdGgpIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZS5yZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbicpO1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbihcbiAgICAgICAgdGhpcy5fbWFpblBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdGhpcy5fZ2V0VHNQcm9ncmFtKCkgYXMgdHMuUHJvZ3JhbSk7XG5cbiAgICAgIGlmICghdGhpcy5lbnRyeU1vZHVsZSAmJiAhdGhpcy5fY29tcGlsZXJPcHRpb25zLmVuYWJsZUl2eSkge1xuICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKCdMYXp5IHJvdXRlcyBkaXNjb3ZlcnkgaXMgbm90IGVuYWJsZWQuICdcbiAgICAgICAgICArICdCZWNhdXNlIHRoZXJlIGlzIG5laXRoZXIgYW4gZW50cnlNb2R1bGUgbm9yIGEgJ1xuICAgICAgICAgICsgJ3N0YXRpY2FsbHkgYW5hbHl6YWJsZSBib290c3RyYXAgY29kZSBpbiB0aGUgbWFpbiBmaWxlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRGaWxlUGF0aHM6IHN0cmluZ1tdKTogTGF6eVJvdXRlTWFwIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2ZpbmRMYXp5Um91dGVzSW5Bc3QnKTtcbiAgICBjb25zdCByZXN1bHQ6IExhenlSb3V0ZU1hcCA9IHt9O1xuICAgIGZvciAoY29uc3QgZmlsZVBhdGggb2YgY2hhbmdlZEZpbGVQYXRocykge1xuICAgICAgY29uc3QgZmlsZUxhenlSb3V0ZXMgPSBmaW5kTGF6eVJvdXRlcyhmaWxlUGF0aCwgdGhpcy5fY29tcGlsZXJIb3N0LCB1bmRlZmluZWQsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyk7XG4gICAgICBmb3IgKGNvbnN0IHJvdXRlS2V5IG9mIE9iamVjdC5rZXlzKGZpbGVMYXp5Um91dGVzKSkge1xuICAgICAgICBjb25zdCByb3V0ZSA9IGZpbGVMYXp5Um91dGVzW3JvdXRlS2V5XTtcbiAgICAgICAgcmVzdWx0W3JvdXRlS2V5XSA9IHJvdXRlO1xuICAgICAgfVxuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2ZpbmRMYXp5Um91dGVzSW5Bc3QnKTtcblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwcml2YXRlIF9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCk6IExhenlSb3V0ZU1hcCB7XG4gICAgbGV0IGVudHJ5Um91dGU6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgbmdQcm9ncmFtOiBQcm9ncmFtO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyeU1vZHVsZSkge1xuICAgICAgICByZXR1cm4ge307XG4gICAgICB9XG5cbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbS5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICBuZ1Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHsgLi4udGhpcy5fY29tcGlsZXJPcHRpb25zLCBnZW5EaXI6ICcnLCBjb2xsZWN0QWxsRXJyb3JzOiB0cnVlIH0sXG4gICAgICAgIGhvc3Q6IHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgIH0pO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgZW50cnlSb3V0ZSA9IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuZW50cnlNb2R1bGUucGF0aCkgKyAnIycgKyB0aGlzLmVudHJ5TW9kdWxlLmNsYXNzTmFtZTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmdQcm9ncmFtID0gdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtO1xuICAgIH1cblxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbS5saXN0TGF6eVJvdXRlcycpO1xuICAgIC8vIGVudHJ5Um91dGUgd2lsbCBvbmx5IGJlIGRlZmluZWQgaW4gSklULlxuICAgIC8vIEluIEFPVCBhbGwgcm91dGVzIHdpdGhpbiB0aGUgcHJvZ3JhbSBhcmUgcmV0dXJuZWQuXG4gICAgY29uc3QgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcyhlbnRyeVJvdXRlKTtcbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0ubGlzdExhenlSb3V0ZXMnKTtcblxuICAgIHJldHVybiBsYXp5Um91dGVzLnJlZHVjZShcbiAgICAgIChhY2MsIGN1cnIpID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gY3Vyci5yb3V0ZTtcbiAgICAgICAgaWYgKHJlZiBpbiBhY2MgJiYgYWNjW3JlZl0gIT09IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICsgYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQ6IFwiJHtyZWZ9XCIgaXMgdXNlZCBpbiAyIGxvYWRDaGlsZHJlbiwgYFxuICAgICAgICAgICAgKyBgYnV0IHRoZXkgcG9pbnQgdG8gZGlmZmVyZW50IG1vZHVsZXMgXCIoJHthY2NbcmVmXX0gYW5kIGBcbiAgICAgICAgICAgICsgYFwiJHtjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGh9XCIpLiBXZWJwYWNrIGNhbm5vdCBkaXN0aW5ndWlzaCBvbiBjb250ZXh0IGFuZCBgXG4gICAgICAgICAgICArICd3b3VsZCBmYWlsIHRvIGxvYWQgdGhlIHByb3BlciBvbmUuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFjY1tyZWZdID0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAge30gYXMgTGF6eVJvdXRlTWFwLFxuICAgICk7XG4gIH1cblxuICAvLyBQcm9jZXNzIHRoZSBsYXp5IHJvdXRlcyBkaXNjb3ZlcmVkLCBhZGRpbmcgdGhlbiB0byBfbGF6eVJvdXRlcy5cbiAgLy8gVE9ETzogZmluZCBhIHdheSB0byByZW1vdmUgbGF6eSByb3V0ZXMgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuICAvLyBUaGlzIHdpbGwgcmVxdWlyZSBhIHJlZ2lzdHJ5IG9mIGtub3duIHJlZmVyZW5jZXMgdG8gYSBsYXp5IHJvdXRlLCByZW1vdmluZyBpdCB3aGVuIG5vXG4gIC8vIG1vZHVsZSByZWZlcmVuY2VzIGl0IGFueW1vcmUuXG4gIHByaXZhdGUgX3Byb2Nlc3NMYXp5Um91dGVzKGRpc2NvdmVyZWRMYXp5Um91dGVzOiBMYXp5Um91dGVNYXApIHtcbiAgICBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkTGF6eVJvdXRlcylcbiAgICAgIC5mb3JFYWNoKGxhenlSb3V0ZUtleSA9PiB7XG4gICAgICAgIGNvbnN0IFtsYXp5Um91dGVNb2R1bGUsIG1vZHVsZU5hbWVdID0gbGF6eVJvdXRlS2V5LnNwbGl0KCcjJyk7XG5cbiAgICAgICAgaWYgKCFsYXp5Um91dGVNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXp5Um91dGVUU0ZpbGUgPSBkaXNjb3ZlcmVkTGF6eVJvdXRlc1tsYXp5Um91dGVLZXldLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgbGV0IG1vZHVsZVBhdGg6IHN0cmluZywgbW9kdWxlS2V5OiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUgfHxcbiAgICAgICAgICAvLyBXaGVuIHVzaW5nIEl2eSBhbmQgbm90IHVzaW5nIGFsbG93RW1wdHlDb2RlZ2VuRmlsZXMsIGZhY3RvcmllcyBhcmUgbm90IGdlbmVyYXRlZC5cbiAgICAgICAgICAodGhpcy5fY29tcGlsZXJPcHRpb25zLmVuYWJsZUl2eSAmJiAhdGhpcy5fY29tcGlsZXJPcHRpb25zLmFsbG93RW1wdHlDb2RlZ2VuRmlsZXMpXG4gICAgICAgICkge1xuICAgICAgICAgIG1vZHVsZVBhdGggPSBsYXp5Um91dGVUU0ZpbGU7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfSR7bW9kdWxlTmFtZSA/ICcjJyArIG1vZHVsZU5hbWUgOiAnJ31gO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIE5nRmFjdG9yaWVzIGFyZSBvbmx5IHVzZWQgd2l0aCBBT1Qgb24gbmdjIChsZWdhY3kpIG1vZGUuXG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZS5yZXBsYWNlKC8oXFwuZCk/XFwudHN4PyQvLCAnJyk7XG4gICAgICAgICAgbW9kdWxlUGF0aCArPSAnLm5nZmFjdG9yeS5qcyc7XG4gICAgICAgICAgY29uc3QgZmFjdG9yeU1vZHVsZU5hbWUgPSBtb2R1bGVOYW1lID8gYCMke21vZHVsZU5hbWV9TmdGYWN0b3J5YCA6ICcnO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ubmdmYWN0b3J5JHtmYWN0b3J5TW9kdWxlTmFtZX1gO1xuICAgICAgICB9XG5cbiAgICAgICAgbW9kdWxlUGF0aCA9IHdvcmthcm91bmRSZXNvbHZlKG1vZHVsZVBhdGgpO1xuXG4gICAgICAgIGlmIChtb2R1bGVLZXkgaW4gdGhpcy5fbGF6eVJvdXRlcykge1xuICAgICAgICAgIGlmICh0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gIT09IG1vZHVsZVBhdGgpIHtcbiAgICAgICAgICAgIC8vIEZvdW5kIGEgZHVwbGljYXRlLCB0aGlzIGlzIGFuIGVycm9yLlxuICAgICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkIGR1cmluZyBhIHJlYnVpbGQuIGBcbiAgICAgICAgICAgICAgICArIGBXZSB3aWxsIHRha2UgdGhlIGxhdGVzdCB2ZXJzaW9uIGRldGVjdGVkIGFuZCBvdmVycmlkZSBpdCB0byBzYXZlIHJlYnVpbGQgdGltZS4gYFxuICAgICAgICAgICAgICAgICsgYFlvdSBzaG91bGQgcGVyZm9ybSBhIGZ1bGwgYnVpbGQgdG8gdmFsaWRhdGUgdGhhdCB5b3VyIHJvdXRlcyBkb24ndCBvdmVybGFwLmApLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRm91bmQgYSBuZXcgcm91dGUsIGFkZCBpdCB0byB0aGUgbWFwLlxuICAgICAgICAgIHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSA9IG1vZHVsZVBhdGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgLy8gQm9vdHN0cmFwIHR5cGUgY2hlY2tlciBpcyB1c2luZyBsb2NhbCBDTEkuXG4gICAgY29uc3QgZzogYW55ID0gdHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgPyBnbG9iYWwgOiB7fTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgY29uc3QgdHlwZUNoZWNrZXJGaWxlOiBzdHJpbmcgPSBnWydfRGV2S2l0SXNMb2NhbCddXG4gICAgICA/ICcuL3R5cGVfY2hlY2tlcl9ib290c3RyYXAuanMnXG4gICAgICA6ICcuL3R5cGVfY2hlY2tlcl93b3JrZXIuanMnO1xuXG4gICAgY29uc3QgZGVidWdBcmdSZWdleCA9IC8tLWluc3BlY3QoPzotYnJrfC1wb3J0KT98LS1kZWJ1Zyg/Oi1icmt8LXBvcnQpLztcblxuICAgIGNvbnN0IGV4ZWNBcmd2ID0gcHJvY2Vzcy5leGVjQXJndi5maWx0ZXIoKGFyZykgPT4ge1xuICAgICAgLy8gUmVtb3ZlIGRlYnVnIGFyZ3MuXG4gICAgICAvLyBXb3JrYXJvdW5kIGZvciBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvaXNzdWVzLzk0MzVcbiAgICAgIHJldHVybiAhZGVidWdBcmdSZWdleC50ZXN0KGFyZyk7XG4gICAgfSk7XG4gICAgLy8gU2lnbmFsIHRoZSBwcm9jZXNzIHRvIHN0YXJ0IGxpc3RlbmluZyBmb3IgbWVzc2FnZXNcbiAgICAvLyBTb2x2ZXMgaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzkwNzFcbiAgICBjb25zdCBmb3JrQXJncyA9IFtBVVRPX1NUQVJUX0FSR107XG4gICAgY29uc3QgZm9ya09wdGlvbnM6IEZvcmtPcHRpb25zID0geyBleGVjQXJndiB9O1xuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gZm9yayhcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIHR5cGVDaGVja2VyRmlsZSksXG4gICAgICBmb3JrQXJncyxcbiAgICAgIGZvcmtPcHRpb25zKTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBtZXNzYWdlcy5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub24oJ21lc3NhZ2UnLCBtZXNzYWdlID0+IHtcbiAgICAgIHN3aXRjaCAobWVzc2FnZS5raW5kKSB7XG4gICAgICAgIGNhc2UgTUVTU0FHRV9LSU5ELkxvZzpcbiAgICAgICAgICBjb25zdCBsb2dNZXNzYWdlID0gbWVzc2FnZSBhcyBMb2dNZXNzYWdlO1xuICAgICAgICAgIHRoaXMuX2xvZ2dlci5sb2cobG9nTWVzc2FnZS5sZXZlbCwgYFxcbiR7bG9nTWVzc2FnZS5tZXNzYWdlfWApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHlwZUNoZWNrZXI6IFVuZXhwZWN0ZWQgbWVzc2FnZSByZWNlaXZlZDogJHttZXNzYWdlfS5gKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBwcm9jZXNzIGV4aXQuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLm9uY2UoJ2V4aXQnLCAoXywgc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuXG4gICAgICAvLyBJZiBwcm9jZXNzIGV4aXRlZCBub3QgYmVjYXVzZSBvZiBTSUdURVJNIChzZWUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlciksIHRoYW4gc29tZXRoaW5nXG4gICAgICAvLyB3ZW50IHdyb25nIGFuZCBpdCBzaG91bGQgZmFsbGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiB0aGUgbWFpbiB0aHJlYWQuXG4gICAgICBpZiAoc2lnbmFsICE9PSAnU0lHVEVSTScpIHtcbiAgICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1zZyA9ICdBbmd1bGFyQ29tcGlsZXJQbHVnaW46IEZvcmtlZCBUeXBlIENoZWNrZXIgZXhpdGVkIHVuZXhwZWN0ZWRseS4gJyArXG4gICAgICAgICAgJ0ZhbGxpbmcgYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIG1haW4gdGhyZWFkLic7XG4gICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobXNnKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQpIHtcbiAgICAgIHRyZWVLaWxsKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQsICdTSUdURVJNJyk7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZUZvcmtlZFR5cGVDaGVja2VyKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgIGlmICghdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCkge1xuICAgICAgICBsZXQgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB7fTtcbiAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNcbiAgICAgICAgICAmJiB0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyAhPSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcywgaG9zdFJlcGxhY2VtZW50UGF0aHMpKTtcbiAgICAgICAgdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICB9XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Muc2VuZChuZXcgVXBkYXRlTWVzc2FnZShyb290TmFtZXMsIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzKSk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVnaXN0cmF0aW9uIGhvb2sgZm9yIHdlYnBhY2sgcGx1Z2luLlxuICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYmlnLWZ1bmN0aW9uXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlciAmIHsgd2F0Y2hNb2RlPzogYm9vbGVhbiB9KSB7XG4gICAgLy8gY2xlYW51cCBpZiBub3Qgd2F0Y2hpbmdcbiAgICBjb21waWxlci5ob29rcy50aGlzQ29tcGlsYXRpb24udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY29tcGlsYXRpb24gPT4ge1xuICAgICAgY29tcGlsYXRpb24uaG9va3MuZmluaXNoTW9kdWxlcy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICAgIC8vIG9ubHkgcHJlc2VudCBmb3Igd2VicGFjayA0LjIzLjArLCBhc3N1bWUgdHJ1ZSBvdGhlcndpc2VcbiAgICAgICAgY29uc3Qgd2F0Y2hNb2RlID0gY29tcGlsZXIud2F0Y2hNb2RlID09PSB1bmRlZmluZWQgPyB0cnVlIDogY29tcGlsZXIud2F0Y2hNb2RlO1xuICAgICAgICBpZiAoIXdhdGNoTW9kZSkge1xuICAgICAgICAgIHRoaXMuX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycyA9IFtdO1xuICAgICAgICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIC8vIFRoZSB3ZWJwYWNrIHR5cGVzIGN1cnJlbnRseSBkbyBub3QgaW5jbHVkZSB0aGVzZVxuICAgICAgY29uc3QgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMgPSBjb21waWxlciBhcyBDb21waWxlciAmIHtcbiAgICAgICAgd2F0Y2hGaWxlU3lzdGVtOiBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICAgICAgfTtcblxuICAgICAgbGV0IGhvc3Q6IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPiA9IHRoaXMuX29wdGlvbnMuaG9zdCB8fCBuZXcgV2VicGFja0lucHV0SG9zdChcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgKTtcblxuICAgICAgbGV0IHJlcGxhY2VtZW50czogTWFwPFBhdGgsIFBhdGg+IHwgKChwYXRoOiBQYXRoKSA9PiBQYXRoKSB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRSZXNvbHZlciA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gcGF0aCA9PiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgaG9zdCA9IG5ldyBjbGFzcyBleHRlbmRzIHZpcnR1YWxGcy5SZXNvbHZlckhvc3Q8ZnMuU3RhdHM+IHtcbiAgICAgICAgICAgIF9yZXNvbHZlKHBhdGg6IFBhdGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KGhvc3QpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgICBjb25zdCBhbGlhc0hvc3QgPSBuZXcgdmlydHVhbEZzLkFsaWFzSG9zdChob3N0KTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGZyb20gaW4gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSByZXNvbHZlKG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksIG5vcm1hbGl6ZShmcm9tKSk7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkV2l0aCA9IHJlc29sdmUoXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzW2Zyb21dKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGlhc0hvc3QuYWxpYXNlcy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50cy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaG9zdCA9IGFsaWFzSG9zdDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDcmVhdGUgdGhlIHdlYnBhY2sgY29tcGlsZXIgaG9zdC5cbiAgICAgIGNvbnN0IHdlYnBhY2tDb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdHJ1ZSxcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5kaXJlY3RUZW1wbGF0ZUxvYWRpbmcsXG4gICAgICApO1xuXG4gICAgICAvLyBDcmVhdGUgYW5kIHNldCBhIG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgaW4gQU9UXG4gICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgICAgIHdlYnBhY2tDb21waWxlckhvc3Quc2V0UmVzb3VyY2VMb2FkZXIodGhpcy5fcmVzb3VyY2VMb2FkZXIpO1xuICAgICAgfVxuXG4gICAgICAvLyBVc2UgdGhlIFdlYnBhY2tDb21waWxlckhvc3Qgd2l0aCBhIHJlc291cmNlIGxvYWRlciB0byBjcmVhdGUgYW4gQW5ndWxhckNvbXBpbGVySG9zdC5cbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCA9IGNyZWF0ZUNvbXBpbGVySG9zdCh7XG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdHNIb3N0OiB3ZWJwYWNrQ29tcGlsZXJIb3N0LFxuICAgICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcblxuICAgICAgLy8gUmVzb2x2ZSBtYWluUGF0aCBpZiBwcm92aWRlZC5cbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLm1haW5QYXRoKSB7XG4gICAgICAgIHRoaXMuX21haW5QYXRoID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUodGhpcy5fb3B0aW9ucy5tYWluUGF0aCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlucHV0RGVjb3JhdG9yID0gbmV3IFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0sXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICk7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0gPSBpbnB1dERlY29yYXRvcjtcbiAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLndhdGNoRmlsZVN5c3RlbSA9IG5ldyBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBpbnB1dERlY29yYXRvcixcbiAgICAgICAgcmVwbGFjZW1lbnRzLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBsYXp5IG1vZHVsZXMgdG8gdGhlIGNvbnRleHQgbW9kdWxlIGZvciBAYW5ndWxhci9jb3JlXG4gICAgY29tcGlsZXIuaG9va3MuY29udGV4dE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY21mID0+IHtcbiAgICAgIGNvbnN0IGFuZ3VsYXJDb3JlUGFja2FnZVBhdGggPSByZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvcmUvcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIC8vIEFQRnY2IGRvZXMgbm90IGhhdmUgc2luZ2xlIEZFU00gYW55bW9yZS4gSW5zdGVhZCBvZiB2ZXJpZnlpbmcgaWYgd2UncmUgcG9pbnRpbmcgdG9cbiAgICAgIC8vIEZFU01zLCB3ZSByZXNvbHZlIHRoZSBgQGFuZ3VsYXIvY29yZWAgcGF0aCBhbmQgdmVyaWZ5IHRoYXQgdGhlIHBhdGggZm9yIHRoZVxuICAgICAgLy8gbW9kdWxlIHN0YXJ0cyB3aXRoIGl0LlxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVSZXNvdXJjZVJvb3QgPSBmcy5yZWFscGF0aFN5bmMocGF0aC5kaXJuYW1lKGFuZ3VsYXJDb3JlUGFja2FnZVBhdGgpKTtcblxuICAgICAgY21mLmhvb2tzLmFmdGVyUmVzb2x2ZS50YXBQcm9taXNlKCdhbmd1bGFyLWNvbXBpbGVyJywgYXN5bmMgcmVzdWx0ID0+IHtcbiAgICAgICAgLy8gQWx0ZXIgb25seSBleGlzdGluZyByZXF1ZXN0IGZyb20gQW5ndWxhciBvciBvbmUgb2YgdGhlIGFkZGl0aW9uYWwgbGF6eSBtb2R1bGUgcmVzb3VyY2VzLlxuICAgICAgICBjb25zdCBpc0xhenlNb2R1bGVSZXNvdXJjZSA9IChyZXNvdXJjZTogc3RyaW5nKSA9PlxuICAgICAgICAgIHJlc291cmNlLnN0YXJ0c1dpdGgoYW5ndWxhckNvcmVSZXNvdXJjZVJvb3QpIHx8XG4gICAgICAgICAgKCB0aGlzLm9wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVSZXNvdXJjZXMgJiZcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcy5pbmNsdWRlcyhyZXNvdXJjZSkpO1xuXG4gICAgICAgIGlmICghcmVzdWx0IHx8ICF0aGlzLmRvbmUgfHwgIWlzTGF6eU1vZHVsZVJlc291cmNlKHJlc3VsdC5yZXNvdXJjZSkpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZG9uZS50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoaXMgZm9sZGVyIGRvZXMgbm90IGV4aXN0LCBidXQgd2UgbmVlZCB0byBnaXZlIHdlYnBhY2sgYSByZXNvdXJjZS5cbiAgICAgICAgICAgIC8vIFRPRE86IGNoZWNrIGlmIHdlIGNhbid0IGp1c3QgbGVhdmUgaXQgYXMgaXMgKGFuZ3VsYXJDb3JlTW9kdWxlRGlyKS5cbiAgICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICAgICAgIHJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZDogYW55KSA9PiBkLmNyaXRpY2FsID0gZmFsc2UpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LnJlc29sdmVEZXBlbmRlbmNpZXMgPSAoX2ZzOiBhbnksIG9wdGlvbnM6IGFueSwgY2FsbGJhY2s6IENhbGxiYWNrKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IE9iamVjdC5rZXlzKHRoaXMuX2xhenlSb3V0ZXMpXG4gICAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVQYXRoID0gdGhpcy5fbGF6eVJvdXRlc1trZXldO1xuICAgICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGtleS5zcGxpdCgnIycpWzBdO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3IobW9kdWxlUGF0aCwgbmFtZSk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoeCA9PiAhIXgpO1xuXG4gICAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLm5hbWVMYXp5RmlsZXMpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLmNodW5rTmFtZSA9ICdbcmVxdWVzdF0nO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoKSA9PiB1bmRlZmluZWQsXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhbmQgZGVzdHJveSBmb3JrZWQgdHlwZSBjaGVja2VyIG9uIHdhdGNoIG1vZGUuXG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hSdW4udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiAhdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICAgIHRoaXMuX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hDbG9zZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSk7XG5cbiAgICAvLyBSZW1ha2UgdGhlIHBsdWdpbiBvbiBlYWNoIGNvbXBpbGF0aW9uLlxuICAgIGNvbXBpbGVyLmhvb2tzLm1ha2UudGFwUHJvbWlzZShcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgIGNvbXBpbGF0aW9uID0+IHRoaXMuX2RvbmVQcm9taXNlID0gdGhpcy5fbWFrZShjb21waWxhdGlvbiksXG4gICAgKTtcbiAgICBjb21waWxlci5ob29rcy5pbnZhbGlkLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2ZpcnN0UnVuID0gZmFsc2UpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyRW1pdC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxhdGlvbiA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsYXRpb24gYXMgYW55KS5fbmdUb29sc1dlYnBhY2tQbHVnaW5JbnN0YW5jZSA9IG51bGw7XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3MuZG9uZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICB0aGlzLl9kb25lUHJvbWlzZSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5ob29rcy5hZnRlclJlc29sdmVycy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxlciA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsZXIgYXMgYW55KS5yZXNvbHZlckZhY3RvcnkuaG9va3MucmVzb2x2ZXJcbiAgICAgICAgLmZvcignbm9ybWFsJylcbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlc29sdmVyOiBhbnkpID0+IHtcbiAgICAgICAgICBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKHRoaXMuX2NvbXBpbGVyT3B0aW9ucykuYXBwbHkocmVzb2x2ZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgY29tcGlsZXIuaG9va3Mubm9ybWFsTW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBubWYgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcFByb21pc2UoXG4gICAgICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgICAgIGFzeW5jIChyZXF1ZXN0PzogTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgcmVxdWVzdCkge1xuICAgICAgICAgICAgICBjb25zdCBuYW1lID0gcmVxdWVzdC5yZXF1ZXN0O1xuICAgICAgICAgICAgICBjb25zdCBpc3N1ZXIgPSByZXF1ZXN0LmNvbnRleHRJbmZvLmlzc3VlcjtcbiAgICAgICAgICAgICAgaWYgKG5hbWUuZW5kc1dpdGgoJy50cycpIHx8IG5hbWUuZW5kc1dpdGgoJy50c3gnKVxuICAgICAgICAgICAgICAgIHx8IChpc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChpc3N1ZXIpKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmRvbmU7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7IH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9tYWtlKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgaWYgKChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIGlmICh0aGlzLl9yZXNvdXJjZUxvYWRlcikge1xuICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fdXBkYXRlKCk7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgIH1cblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBwdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSAoXG4gICAgICB0aGlzLl9tYWluUGF0aCA/IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuX21haW5QYXRoKSA6IHRoaXMuX21haW5QYXRoXG4gICAgKTtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGVcbiAgICAgID8geyBwYXRoOiB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpLCBjbGFzc05hbWU6IHRoaXMuZW50cnlNb2R1bGUuY2xhc3NOYW1lIH1cbiAgICAgIDogdGhpcy5lbnRyeU1vZHVsZTtcbiAgICBjb25zdCBnZXRMYXp5Um91dGVzID0gKCkgPT4gdGhpcy5fbGF6eVJvdXRlcztcbiAgICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+ICh0aGlzLl9nZXRUc1Byb2dyYW0oKSBhcyB0cy5Qcm9ncmFtKS5nZXRUeXBlQ2hlY2tlcigpO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIFJlcGxhY2UgcmVzb3VyY2VzIGluIEpJVC5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICByZXBsYWNlUmVzb3VyY2VzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIsIHRoaXMuX29wdGlvbnMuZGlyZWN0VGVtcGxhdGVMb2FkaW5nKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW92ZSB1bm5lZWRlZCBhbmd1bGFyIGRlY29yYXRvcnMuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZW1vdmVEZWNvcmF0b3JzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKC4uLnRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5Ccm93c2VyKSB7XG4gICAgICAgIC8vIElmIHdlIGhhdmUgYSBsb2NhbGUsIGF1dG8gaW1wb3J0IHRoZSBsb2NhbGUgZGF0YSBmaWxlLlxuICAgICAgICAvLyBUaGlzIHRyYW5zZm9ybSBtdXN0IGdvIGJlZm9yZSByZXBsYWNlQm9vdHN0cmFwIGJlY2F1c2UgaXQgbG9va3MgZm9yIHRoZSBlbnRyeSBtb2R1bGVcbiAgICAgICAgLy8gaW1wb3J0LCB3aGljaCB3aWxsIGJlIHJlcGxhY2VkLlxuICAgICAgICBpZiAodGhpcy5fbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlZ2lzdGVyTG9jYWxlRGF0YShpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgLy8gUmVwbGFjZSBib290c3RyYXAgaW4gYnJvd3NlciBBT1QuXG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZUJvb3RzdHJhcChcbiAgICAgICAgICAgIGlzQXBwUGF0aCxcbiAgICAgICAgICAgIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgICAgZ2V0VHlwZUNoZWNrZXIsXG4gICAgICAgICAgICAhIXRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbmFibGVJdnksXG4gICAgICAgICAgKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fcGxhdGZvcm0gPT09IFBMQVRGT1JNLlNlcnZlcikge1xuICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChleHBvcnRMYXp5TW9kdWxlTWFwKGlzTWFpblBhdGgsIGdldExhenlSb3V0ZXMpKTtcbiAgICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goXG4gICAgICAgICAgICBleHBvcnROZ0ZhY3RvcnkoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUpLFxuICAgICAgICAgICAgcmVwbGFjZVNlcnZlckJvb3RzdHJhcChpc01haW5QYXRoLCBnZXRFbnRyeU1vZHVsZSwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX2dldENoYW5nZWRUc0ZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpXG4gICAgICAuZmlsdGVyKGsgPT4gKGsuZW5kc1dpdGgoJy50cycpIHx8IGsuZW5kc1dpdGgoJy50c3gnKSkgJiYgIWsuZW5kc1dpdGgoJy5kLnRzJykpXG4gICAgICAuZmlsdGVyKGsgPT4gdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoaykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfdXBkYXRlKCkge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gICAgLy8gV2Ugb25seSB3YW50IHRvIHVwZGF0ZSBvbiBUUyBhbmQgdGVtcGxhdGUgY2hhbmdlcywgYnV0IGFsbCBraW5kcyBvZiBmaWxlcyBhcmUgb24gdGhpc1xuICAgIC8vIGxpc3QsIGxpa2UgcGFja2FnZS5qc29uIGFuZCAubmdzdW1tYXJ5Lmpzb24gZmlsZXMuXG4gICAgY29uc3QgY2hhbmdlZEZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKTtcblxuICAgIC8vIElmIG5vdGhpbmcgd2UgY2FyZSBhYm91dCBjaGFuZ2VkIGFuZCBpdCBpc24ndCB0aGUgZmlyc3QgcnVuLCBkb24ndCBkbyBhbnl0aGluZy5cbiAgICBpZiAoY2hhbmdlZEZpbGVzLmxlbmd0aCA9PT0gMCAmJiAhdGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBNYWtlIGEgbmV3IHByb2dyYW0gYW5kIGxvYWQgdGhlIEFuZ3VsYXIgc3RydWN0dXJlLlxuICAgIGF3YWl0IHRoaXMuX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbSgpO1xuXG4gICAgLy8gVHJ5IHRvIGZpbmQgbGF6eSByb3V0ZXMgaWYgd2UgaGF2ZSBhbiBlbnRyeSBtb2R1bGUuXG4gICAgLy8gV2UgbmVlZCB0byBydW4gdGhlIGBsaXN0TGF6eVJvdXRlc2AgdGhlIGZpcnN0IHRpbWUgYmVjYXVzZSBpdCBhbHNvIG5hdmlnYXRlcyBsaWJyYXJpZXNcbiAgICAvLyBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgd2UgbWlnaHQgbWlzcyB1c2luZyB0aGUgKGZhc3RlcikgZmluZExhenlSb3V0ZXNJbkFzdC5cbiAgICAvLyBMYXp5IHJvdXRlcyBtb2R1bGVzIHdpbGwgYmUgcmVhZCB3aXRoIGNvbXBpbGVySG9zdCBhbmQgYWRkZWQgdG8gdGhlIGNoYW5nZWQgZmlsZXMuXG4gICAgbGV0IGxhenlSb3V0ZU1hcDogTGF6eVJvdXRlTWFwID0ge307XG4gICAgaWYgKCF0aGlzLl9KaXRNb2RlIHx8IHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICBsYXp5Um91dGVNYXAgPSB0aGlzLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGNoYW5nZWRUc0ZpbGVzID0gdGhpcy5fZ2V0Q2hhbmdlZFRzRmlsZXMoKTtcbiAgICAgIGlmIChjaGFuZ2VkVHNGaWxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGxhenlSb3V0ZU1hcCA9IHRoaXMuX2ZpbmRMYXp5Um91dGVzSW5Bc3QoY2hhbmdlZFRzRmlsZXMpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEZpbmQgbGF6eSByb3V0ZXNcbiAgICBsYXp5Um91dGVNYXAgPSB7XG4gICAgICAuLi5sYXp5Um91dGVNYXAsXG4gICAgICAuLi50aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcyxcbiAgICB9O1xuXG4gICAgdGhpcy5fcHJvY2Vzc0xhenlSb3V0ZXMobGF6eVJvdXRlTWFwKTtcblxuICAgIC8vIEVtaXQgZmlsZXMuXG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcbiAgICBjb25zdCB7IGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzIH0gPSB0aGlzLl9lbWl0KCk7XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUuX2VtaXQnKTtcblxuICAgIC8vIFJlcG9ydCBkaWFnbm9zdGljcy5cbiAgICBjb25zdCBlcnJvcnMgPSBkaWFnbm9zdGljc1xuICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yKTtcbiAgICBjb25zdCB3YXJuaW5ncyA9IGRpYWdub3N0aWNzXG4gICAgICAuZmlsdGVyKChkaWFnKSA9PiBkaWFnLmNhdGVnb3J5ID09PSB0cy5EaWFnbm9zdGljQ2F0ZWdvcnkuV2FybmluZyk7XG5cbiAgICBpZiAoZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyhlcnJvcnMpO1xuICAgICAgdGhpcy5fZXJyb3JzLnB1c2gobmV3IEVycm9yKG1lc3NhZ2UpKTtcbiAgICB9XG5cbiAgICBpZiAod2FybmluZ3MubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGZvcm1hdERpYWdub3N0aWNzKHdhcm5pbmdzKTtcbiAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobWVzc2FnZSk7XG4gICAgfVxuXG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSAhZW1pdFJlc3VsdCB8fCBlbWl0UmVzdWx0LmVtaXRTa2lwcGVkO1xuXG4gICAgLy8gUmVzZXQgY2hhbmdlZCBmaWxlcyBvbiBzdWNjZXNzZnVsIGNvbXBpbGF0aW9uLlxuICAgIGlmICghdGhpcy5fZW1pdFNraXBwZWQgJiYgdGhpcy5fZXJyb3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LnJlc2V0Q2hhbmdlZEZpbGVUcmFja2VyKCk7XG4gICAgfVxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlJyk7XG4gIH1cblxuICB3cml0ZUkxOG5PdXRGaWxlKCkge1xuICAgIGZ1bmN0aW9uIF9yZWN1cnNpdmVNa0RpcihwOiBzdHJpbmcpIHtcbiAgICAgIGlmICghZnMuZXhpc3RzU3luYyhwKSkge1xuICAgICAgICBfcmVjdXJzaXZlTWtEaXIocGF0aC5kaXJuYW1lKHApKTtcbiAgICAgICAgZnMubWtkaXJTeW5jKHApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFdyaXRlIHRoZSBleHRyYWN0ZWQgbWVzc2FnZXMgdG8gZGlzay5cbiAgICBpZiAodGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlKSB7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZVBhdGggPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSk7XG4gICAgICBjb25zdCBpMThuT3V0RmlsZUNvbnRlbnQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUoaTE4bk91dEZpbGVQYXRoKTtcbiAgICAgIGlmIChpMThuT3V0RmlsZUNvbnRlbnQpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShpMThuT3V0RmlsZVBhdGgpKTtcbiAgICAgICAgZnMud3JpdGVGaWxlU3luYyhpMThuT3V0RmlsZVBhdGgsIGkxOG5PdXRGaWxlQ29udGVudCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0Q29tcGlsZWRGaWxlKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBvdXRwdXRGaWxlID0gZmlsZU5hbWUucmVwbGFjZSgvLnRzeD8kLywgJy5qcycpO1xuICAgIGxldCBvdXRwdXRUZXh0OiBzdHJpbmc7XG4gICAgbGV0IHNvdXJjZU1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGxldCBlcnJvckRlcGVuZGVuY2llczogc3RyaW5nW10gPSBbXTtcblxuICAgIGlmICh0aGlzLl9lbWl0U2tpcHBlZCkge1xuICAgICAgY29uc3QgdGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKTtcbiAgICAgIGlmICh0ZXh0KSB7XG4gICAgICAgIC8vIElmIHRoZSBjb21waWxhdGlvbiBkaWRuJ3QgZW1pdCBmaWxlcyB0aGlzIHRpbWUsIHRyeSB0byByZXR1cm4gdGhlIGNhY2hlZCBmaWxlcyBmcm9tIHRoZVxuICAgICAgICAvLyBsYXN0IGNvbXBpbGF0aW9uIGFuZCBsZXQgdGhlIGNvbXBpbGF0aW9uIGVycm9ycyBzaG93IHdoYXQncyB3cm9uZy5cbiAgICAgICAgb3V0cHV0VGV4dCA9IHRleHQ7XG4gICAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFRoZXJlJ3Mgbm90aGluZyB3ZSBjYW4gc2VydmUuIFJldHVybiBhbiBlbXB0eSBzdHJpbmcgdG8gcHJldmVudCBsZW5naHR5IHdlYnBhY2sgZXJyb3JzLFxuICAgICAgICAvLyBhZGQgdGhlIHJlYnVpbGQgd2FybmluZyBpZiBpdCdzIG5vdCB0aGVyZSB5ZXQuXG4gICAgICAgIC8vIFdlIGFsc28gbmVlZCB0byBhbGwgY2hhbmdlZCBmaWxlcyBhcyBkZXBlbmRlbmNpZXMgb2YgdGhpcyBmaWxlLCBzbyB0aGF0IGFsbCBvZiB0aGVtXG4gICAgICAgIC8vIHdpbGwgYmUgd2F0Y2hlZCBhbmQgdHJpZ2dlciBhIHJlYnVpbGQgbmV4dCB0aW1lLlxuICAgICAgICBvdXRwdXRUZXh0ID0gJyc7XG4gICAgICAgIGVycm9yRGVwZW5kZW5jaWVzID0gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKVxuICAgICAgICAgIC8vIFRoZXNlIHBhdGhzIGFyZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgICAgICAgIC5tYXAoKHApID0+IHRoaXMuX2NvbXBpbGVySG9zdC5kZW5vcm1hbGl6ZVBhdGgocCkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDaGVjayBpZiB0aGUgVFMgaW5wdXQgZmlsZSBhbmQgdGhlIEpTIG91dHB1dCBmaWxlIGV4aXN0LlxuICAgICAgaWYgKCgoZmlsZU5hbWUuZW5kc1dpdGgoJy50cycpIHx8IGZpbGVOYW1lLmVuZHNXaXRoKCcudHN4JykpXG4gICAgICAgICYmICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhmaWxlTmFtZSkpXG4gICAgICAgIHx8ICF0aGlzLl9jb21waWxlckhvc3QuZmlsZUV4aXN0cyhvdXRwdXRGaWxlLCBmYWxzZSkpIHtcbiAgICAgICAgbGV0IG1zZyA9IGAke2ZpbGVOYW1lfSBpcyBtaXNzaW5nIGZyb20gdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24uIGBcbiAgICAgICAgICArIGBQbGVhc2UgbWFrZSBzdXJlIGl0IGlzIGluIHlvdXIgdHNjb25maWcgdmlhIHRoZSAnZmlsZXMnIG9yICdpbmNsdWRlJyBwcm9wZXJ0eS5gO1xuXG4gICAgICAgIGlmICgvKFxcXFx8XFwvKW5vZGVfbW9kdWxlcyhcXFxcfFxcLykvLnRlc3QoZmlsZU5hbWUpKSB7XG4gICAgICAgICAgbXNnICs9ICdcXG5UaGUgbWlzc2luZyBmaWxlIHNlZW1zIHRvIGJlIHBhcnQgb2YgYSB0aGlyZCBwYXJ0eSBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdUUyBmaWxlcyBpbiBwdWJsaXNoZWQgbGlicmFyaWVzIGFyZSBvZnRlbiBhIHNpZ24gb2YgYSBiYWRseSBwYWNrYWdlZCBsaWJyYXJ5LiAnXG4gICAgICAgICAgICArICdQbGVhc2Ugb3BlbiBhbiBpc3N1ZSBpbiB0aGUgbGlicmFyeSByZXBvc2l0b3J5IHRvIGFsZXJ0IGl0cyBhdXRob3IgYW5kIGFzayB0aGVtICdcbiAgICAgICAgICAgICsgJ3RvIHBhY2thZ2UgdGhlIGxpYnJhcnkgdXNpbmcgdGhlIEFuZ3VsYXIgUGFja2FnZSBGb3JtYXQgKGh0dHBzOi8vZ29vLmdsL2pCM0dWdikuJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgfVxuXG4gICAgICBvdXRwdXRUZXh0ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUpIHx8ICcnO1xuICAgICAgc291cmNlTWFwID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKG91dHB1dEZpbGUgKyAnLm1hcCcpO1xuICAgIH1cblxuICAgIHJldHVybiB7IG91dHB1dFRleHQsIHNvdXJjZU1hcCwgZXJyb3JEZXBlbmRlbmNpZXMgfTtcbiAgfVxuXG4gIGdldERlcGVuZGVuY2llcyhmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IHJlc29sdmVkRmlsZU5hbWUgPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZShmaWxlTmFtZSk7XG4gICAgY29uc3Qgc291cmNlRmlsZSA9IHRoaXMuX2NvbXBpbGVySG9zdC5nZXRTb3VyY2VGaWxlKHJlc29sdmVkRmlsZU5hbWUsIHRzLlNjcmlwdFRhcmdldC5MYXRlc3QpO1xuICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLl9jb21waWxlck9wdGlvbnM7XG4gICAgY29uc3QgaG9zdCA9IHRoaXMuX2NvbXBpbGVySG9zdDtcbiAgICBjb25zdCBjYWNoZSA9IHRoaXMuX21vZHVsZVJlc29sdXRpb25DYWNoZTtcblxuICAgIGNvbnN0IGVzSW1wb3J0cyA9IGNvbGxlY3REZWVwTm9kZXM8dHMuSW1wb3J0RGVjbGFyYXRpb24+KHNvdXJjZUZpbGUsXG4gICAgICB0cy5TeW50YXhLaW5kLkltcG9ydERlY2xhcmF0aW9uKVxuICAgICAgLm1hcChkZWNsID0+IHtcbiAgICAgICAgY29uc3QgbW9kdWxlTmFtZSA9IChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgICAgICBjb25zdCByZXNvbHZlZCA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKG1vZHVsZU5hbWUsIHJlc29sdmVkRmlsZU5hbWUsIG9wdGlvbnMsIGhvc3QsIGNhY2hlKTtcblxuICAgICAgICBpZiAocmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm4gcmVzb2x2ZWQucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoeCA9PiB4KTtcblxuICAgIGNvbnN0IHJlc291cmNlSW1wb3J0cyA9IGZpbmRSZXNvdXJjZXMoc291cmNlRmlsZSlcbiAgICAgIC5tYXAocmVzb3VyY2VQYXRoID0+IHJlc29sdmUoZGlybmFtZShyZXNvbHZlZEZpbGVOYW1lKSwgbm9ybWFsaXplKHJlc291cmNlUGF0aCkpKTtcblxuICAgIC8vIFRoZXNlIHBhdGhzIGFyZSBtZWFudCB0byBiZSB1c2VkIGJ5IHRoZSBsb2FkZXIgc28gd2UgbXVzdCBkZW5vcm1hbGl6ZSB0aGVtLlxuICAgIGNvbnN0IHVuaXF1ZURlcGVuZGVuY2llcyA9IG5ldyBTZXQoW1xuICAgICAgLi4uZXNJbXBvcnRzLFxuICAgICAgLi4ucmVzb3VyY2VJbXBvcnRzLFxuICAgICAgLi4udGhpcy5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyh0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHJlc29sdmVkRmlsZU5hbWUpKSxcbiAgICBdLm1hcCgocCkgPT4gcCAmJiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKSk7XG5cbiAgICByZXR1cm4gWy4uLnVuaXF1ZURlcGVuZGVuY2llc11cbiAgICAgIC5maWx0ZXIoeCA9PiAhIXgpIGFzIHN0cmluZ1tdO1xuICB9XG5cbiAgZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBpZiAoIXRoaXMuX3Jlc291cmNlTG9hZGVyKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lKTtcbiAgfVxuXG4gIC8vIFRoaXMgY29kZSBtb3N0bHkgY29tZXMgZnJvbSBgcGVyZm9ybUNvbXBpbGF0aW9uYCBpbiBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYC5cbiAgLy8gSXQgc2tpcHMgdGhlIHByb2dyYW0gY3JlYXRpb24gYmVjYXVzZSB3ZSBuZWVkIHRvIHVzZSBgbG9hZE5nU3RydWN0dXJlQXN5bmMoKWAsXG4gIC8vIGFuZCB1c2VzIEN1c3RvbVRyYW5zZm9ybWVycy5cbiAgcHJpdmF0ZSBfZW1pdCgpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcbiAgICBjb25zdCBwcm9ncmFtID0gdGhpcy5fcHJvZ3JhbTtcbiAgICBjb25zdCBhbGxEaWFnbm9zdGljczogQXJyYXk8dHMuRGlhZ25vc3RpYyB8IERpYWdub3N0aWM+ID0gW107XG4gICAgY29uc3QgZGlhZ01vZGUgPSAodGhpcy5fZmlyc3RSdW4gfHwgIXRoaXMuX2ZvcmtUeXBlQ2hlY2tlcikgP1xuICAgICAgRGlhZ25vc3RpY01vZGUuQWxsIDogRGlhZ25vc3RpY01vZGUuU3ludGFjdGljO1xuXG4gICAgbGV0IGVtaXRSZXN1bHQ6IHRzLkVtaXRSZXN1bHQgfCB1bmRlZmluZWQ7XG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHByb2dyYW0gYXMgdHMuUHJvZ3JhbTtcbiAgICAgICAgY29uc3QgY2hhbmdlZFRzRmlsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4udHNQcm9ncmFtLmdldE9wdGlvbnNEaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMuZ2V0T3B0aW9uc0RpYWdub3N0aWNzJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gZ2VuZXJhdGUgYSBsaXN0IG9mIGNoYW5nZWQgZmlsZXMgZm9yIGVtaXRcbiAgICAgICAgICAvLyBub3QgbmVlZGVkIG9uIGZpcnN0IHJ1biBzaW5jZSBhIGZ1bGwgcHJvZ3JhbSBlbWl0IGlzIHJlcXVpcmVkXG4gICAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiB0aGlzLl9jb21waWxlckhvc3QuZ2V0Q2hhbmdlZEZpbGVQYXRocygpKSB7XG4gICAgICAgICAgICBpZiAoIS8uKHRzeHx0c3xqc29ufGpzKSQvLnRlc3QoY2hhbmdlZEZpbGUpKSB7XG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gZXhpc3RpbmcgdHlwZSBkZWZpbml0aW9ucyBhcmUgbm90IGVtaXR0ZWRcbiAgICAgICAgICAgIGlmIChjaGFuZ2VkRmlsZS5lbmRzV2l0aCgnLmQudHMnKSkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNoYW5nZWRUc0ZpbGVzLmFkZChjaGFuZ2VkRmlsZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyh0c1Byb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cycsIGRpYWdNb2RlKSk7XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuIHx8IGNoYW5nZWRUc0ZpbGVzLnNpemUgPiAyMCkge1xuICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHsgYmVmb3JlOiB0aGlzLl90cmFuc2Zvcm1lcnMgfSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIGNoYW5nZWRUc0ZpbGVzKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0c1Byb2dyYW0uZ2V0U291cmNlRmlsZShjaGFuZ2VkRmlsZSk7XG4gICAgICAgICAgICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY29uc3QgdGltZUxhYmVsID0gYEFuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cyske3NvdXJjZUZpbGUuZmlsZU5hbWV9Ky5lbWl0YDtcbiAgICAgICAgICAgICAgdGltZSh0aW1lTGFiZWwpO1xuICAgICAgICAgICAgICBlbWl0UmVzdWx0ID0gdHNQcm9ncmFtLmVtaXQoc291cmNlRmlsZSwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgICAgIHRpbWVFbmQodGltZUxhYmVsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gcHJvZ3JhbSBhcyBQcm9ncmFtO1xuXG4gICAgICAgIC8vIENoZWNrIEFuZ3VsYXIgc3RydWN0dXJhbCBkaWFnbm9zdGljcy5cbiAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzJyk7XG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuXG4gICAgICAgIGlmICh0aGlzLl9maXJzdFJ1bikge1xuICAgICAgICAgIC8vIENoZWNrIFR5cGVTY3JpcHQgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG4gICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5hbmd1bGFyUHJvZ3JhbS5nZXRUc09wdGlvbkRpYWdub3N0aWNzKCkpO1xuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXRUc09wdGlvbkRpYWdub3N0aWNzJyk7XG5cbiAgICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0TmdPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICB9XG5cbiAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5nYXRoZXJEaWFnbm9zdGljcyhhbmd1bGFyUHJvZ3JhbSwgdGhpcy5fSml0TW9kZSxcbiAgICAgICAgICAnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nJywgZGlhZ01vZGUpKTtcblxuICAgICAgICBpZiAoIWhhc0Vycm9ycyhhbGxEaWFnbm9zdGljcykpIHtcbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZW1pdCcpO1xuICAgICAgICAgIGNvbnN0IGV4dHJhY3RJMThuID0gISF0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGU7XG4gICAgICAgICAgY29uc3QgZW1pdEZsYWdzID0gZXh0cmFjdEkxOG4gPyBFbWl0RmxhZ3MuSTE4bkJ1bmRsZSA6IEVtaXRGbGFncy5EZWZhdWx0O1xuICAgICAgICAgIGVtaXRSZXN1bHQgPSBhbmd1bGFyUHJvZ3JhbS5lbWl0KHtcbiAgICAgICAgICAgIGVtaXRGbGFncywgY3VzdG9tVHJhbnNmb3JtZXJzOiB7XG4gICAgICAgICAgICAgIGJlZm9yZVRzOiB0aGlzLl90cmFuc2Zvcm1lcnMsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZW1pdFJlc3VsdC5kaWFnbm9zdGljcyk7XG4gICAgICAgICAgaWYgKGV4dHJhY3RJMThuKSB7XG4gICAgICAgICAgICB0aGlzLndyaXRlSTE4bk91dEZpbGUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgICAgLy8gVGhpcyBmdW5jdGlvbiBpcyBhdmFpbGFibGUgaW4gdGhlIGltcG9ydCBiZWxvdywgYnV0IHRoaXMgd2F5IHdlIGF2b2lkIHRoZSBkZXBlbmRlbmN5LlxuICAgICAgLy8gaW1wb3J0IHsgaXNTeW50YXhFcnJvciB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyJztcbiAgICAgIGZ1bmN0aW9uIGlzU3ludGF4RXJyb3IoZXJyb3I6IEVycm9yKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiAoZXJyb3IgYXMgYW55KVsnbmdTeW50YXhFcnJvciddOyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICAgIH1cblxuICAgICAgbGV0IGVyck1zZzogc3RyaW5nO1xuICAgICAgbGV0IGNvZGU6IG51bWJlcjtcbiAgICAgIGlmIChpc1N5bnRheEVycm9yKGUpKSB7XG4gICAgICAgIC8vIGRvbid0IHJlcG9ydCB0aGUgc3RhY2sgZm9yIHN5bnRheCBlcnJvcnMgYXMgdGhleSBhcmUgd2VsbCBrbm93biBlcnJvcnMuXG4gICAgICAgIGVyck1zZyA9IGUubWVzc2FnZTtcbiAgICAgICAgY29kZSA9IERFRkFVTFRfRVJST1JfQ09ERTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVyck1zZyA9IGUuc3RhY2s7XG4gICAgICAgIC8vIEl0IGlzIG5vdCBhIHN5bnRheCBlcnJvciB3ZSBtaWdodCBoYXZlIGEgcHJvZ3JhbSB3aXRoIHVua25vd24gc3RhdGUsIGRpc2NhcmQgaXQuXG4gICAgICAgIHRoaXMuX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICBjb2RlID0gVU5LTk9XTl9FUlJPUl9DT0RFO1xuICAgICAgfVxuICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaChcbiAgICAgICAgeyBjYXRlZ29yeTogdHMuRGlhZ25vc3RpY0NhdGVnb3J5LkVycm9yLCBtZXNzYWdlVGV4dDogZXJyTXNnLCBjb2RlLCBzb3VyY2U6IFNPVVJDRSB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5jYXRjaCcpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQnKTtcblxuICAgIHJldHVybiB7IHByb2dyYW0sIGVtaXRSZXN1bHQsIGRpYWdub3N0aWNzOiBhbGxEaWFnbm9zdGljcyB9O1xuICB9XG5cbiAgcHJpdmF0ZSBfdmFsaWRhdGVMb2NhbGUobG9jYWxlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIHBhdGggb2YgdGhlIGNvbW1vbiBtb2R1bGUuXG4gICAgY29uc3QgY29tbW9uUGF0aCA9IHBhdGguZGlybmFtZShyZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvbW1vbi9wYWNrYWdlLmpzb24nKSk7XG4gICAgLy8gQ2hlY2sgaWYgdGhlIGxvY2FsZSBmaWxlIGV4aXN0c1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnLCBgJHtsb2NhbGV9LmpzYCkpKSB7XG4gICAgICAvLyBDaGVjayBmb3IgYW4gYWx0ZXJuYXRpdmUgbG9jYWxlIChpZiB0aGUgbG9jYWxlIGlkIHdhcyBiYWRseSBmb3JtYXR0ZWQpLlxuICAgICAgY29uc3QgbG9jYWxlcyA9IGZzLnJlYWRkaXJTeW5jKHBhdGgucmVzb2x2ZShjb21tb25QYXRoLCAnbG9jYWxlcycpKVxuICAgICAgICAuZmlsdGVyKGZpbGUgPT4gZmlsZS5lbmRzV2l0aCgnLmpzJykpXG4gICAgICAgIC5tYXAoZmlsZSA9PiBmaWxlLnJlcGxhY2UoJy5qcycsICcnKSk7XG5cbiAgICAgIGxldCBuZXdMb2NhbGU7XG4gICAgICBjb25zdCBub3JtYWxpemVkTG9jYWxlID0gbG9jYWxlLnRvTG93ZXJDYXNlKCkucmVwbGFjZSgvXy9nLCAnLScpO1xuICAgICAgZm9yIChjb25zdCBsIG9mIGxvY2FsZXMpIHtcbiAgICAgICAgaWYgKGwudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIG5ld0xvY2FsZSA9IGw7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG5ld0xvY2FsZSkge1xuICAgICAgICBsb2NhbGUgPSBuZXdMb2NhbGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDaGVjayBmb3IgYSBwYXJlbnQgbG9jYWxlXG4gICAgICAgIGNvbnN0IHBhcmVudExvY2FsZSA9IG5vcm1hbGl6ZWRMb2NhbGUuc3BsaXQoJy0nKVswXTtcbiAgICAgICAgaWYgKGxvY2FsZXMuaW5kZXhPZihwYXJlbnRMb2NhbGUpICE9PSAtMSkge1xuICAgICAgICAgIGxvY2FsZSA9IHBhcmVudExvY2FsZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKGBBbmd1bGFyQ29tcGlsZXJQbHVnaW46IFVuYWJsZSB0byBsb2FkIHRoZSBsb2NhbGUgZGF0YSBmaWxlIGAgK1xuICAgICAgICAgICAgYFwiQGFuZ3VsYXIvY29tbW9uL2xvY2FsZXMvJHtsb2NhbGV9XCIsIGAgK1xuICAgICAgICAgICAgYHBsZWFzZSBjaGVjayB0aGF0IFwiJHtsb2NhbGV9XCIgaXMgYSB2YWxpZCBsb2NhbGUgaWQuXG4gICAgICAgICAgICBJZiBuZWVkZWQsIHlvdSBjYW4gdXNlIFwicmVnaXN0ZXJMb2NhbGVEYXRhXCIgbWFudWFsbHkuYCk7XG5cbiAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBsb2NhbGU7XG4gIH1cbn1cbiJdfQ==