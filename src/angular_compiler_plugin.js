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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FROEI7QUFDOUIsb0RBQWdFO0FBQ2hFLHdEQWMrQjtBQUMvQixpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9GO0FBQ3BGLCtDQUE2RDtBQUM3RCxpREFBdUQ7QUFDdkQsdURBQTBEO0FBQzFELGlEQVN3QjtBQUN4Qiw0REFBOEQ7QUFDOUQsaURBRXdCO0FBQ3hCLG1FQUtpQztBQUNqQyxtRkFHeUM7QUFNekMsNkRBQXdEO0FBRXhELE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztBQThDdEMsSUFBWSxRQUdYO0FBSEQsV0FBWSxRQUFRO0lBQ2xCLDZDQUFPLENBQUE7SUFDUCwyQ0FBTSxDQUFBO0FBQ1IsQ0FBQyxFQUhXLFFBQVEsR0FBUixnQkFBUSxLQUFSLGdCQUFRLFFBR25CO0FBRUQsTUFBYSxxQkFBcUI7SUF1Q2hDLFlBQVksT0FBcUM7UUE3QmpELDhEQUE4RDtRQUN0RCxnQkFBVyxHQUFpQixFQUFFLENBQUM7UUFLL0Isa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUVyRixrQkFB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LENBQUM7SUFDaEIsQ0FBQztDQUNGO0FBNW1DRCxzREE0bUNDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuaW1wb3J0IHtcbiAgUGF0aCxcbiAgZGlybmFtZSxcbiAgZ2V0U3lzdGVtUGF0aCxcbiAgbG9nZ2luZyxcbiAgbm9ybWFsaXplLFxuICByZXNvbHZlLFxuICB2aXJ0dWFsRnMsXG59IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCB7IGNyZWF0ZUNvbnNvbGVMb2dnZXIgfSBmcm9tICdAYW5ndWxhci1kZXZraXQvY29yZS9ub2RlJztcbmltcG9ydCB7XG4gIENvbXBpbGVySG9zdCxcbiAgQ29tcGlsZXJPcHRpb25zLFxuICBERUZBVUxUX0VSUk9SX0NPREUsXG4gIERpYWdub3N0aWMsXG4gIEVtaXRGbGFncyxcbiAgUHJvZ3JhbSxcbiAgU09VUkNFLFxuICBVTktOT1dOX0VSUk9SX0NPREUsXG4gIFZFUlNJT04sXG4gIGNyZWF0ZUNvbXBpbGVySG9zdCxcbiAgY3JlYXRlUHJvZ3JhbSxcbiAgZm9ybWF0RGlhZ25vc3RpY3MsXG4gIHJlYWRDb25maWd1cmF0aW9uLFxufSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBGb3JrT3B0aW9ucywgZm9yayB9IGZyb20gJ2NoaWxkX3Byb2Nlc3MnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgQ29tcGlsZXIsIGNvbXBpbGF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyB0aW1lLCB0aW1lRW5kIH0gZnJvbSAnLi9iZW5jaG1hcmsnO1xuaW1wb3J0IHsgV2VicGFja0NvbXBpbGVySG9zdCwgd29ya2Fyb3VuZFJlc29sdmUgfSBmcm9tICcuL2NvbXBpbGVyX2hvc3QnO1xuaW1wb3J0IHsgcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4gfSBmcm9tICcuL2VudHJ5X3Jlc29sdmVyJztcbmltcG9ydCB7IERpYWdub3N0aWNNb2RlLCBnYXRoZXJEaWFnbm9zdGljcywgaGFzRXJyb3JzIH0gZnJvbSAnLi9nYXRoZXJfZGlhZ25vc3RpY3MnO1xuaW1wb3J0IHsgTGF6eVJvdXRlTWFwLCBmaW5kTGF6eVJvdXRlcyB9IGZyb20gJy4vbGF6eV9yb3V0ZXMnO1xuaW1wb3J0IHsgVHlwZVNjcmlwdFBhdGhzUGx1Z2luIH0gZnJvbSAnLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi9yZXNvdXJjZV9sb2FkZXInO1xuaW1wb3J0IHtcbiAgZXhwb3J0TGF6eU1vZHVsZU1hcCxcbiAgZXhwb3J0TmdGYWN0b3J5LFxuICBmaW5kUmVzb3VyY2VzLFxuICByZWdpc3RlckxvY2FsZURhdGEsXG4gIHJlbW92ZURlY29yYXRvcnMsXG4gIHJlcGxhY2VCb290c3RyYXAsXG4gIHJlcGxhY2VSZXNvdXJjZXMsXG4gIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAsXG59IGZyb20gJy4vdHJhbnNmb3JtZXJzJztcbmltcG9ydCB7IGNvbGxlY3REZWVwTm9kZXMgfSBmcm9tICcuL3RyYW5zZm9ybWVycy9hc3RfaGVscGVycyc7XG5pbXBvcnQge1xuICBBVVRPX1NUQVJUX0FSRyxcbn0gZnJvbSAnLi90eXBlX2NoZWNrZXInO1xuaW1wb3J0IHtcbiAgSW5pdE1lc3NhZ2UsXG4gIExvZ01lc3NhZ2UsXG4gIE1FU1NBR0VfS0lORCxcbiAgVXBkYXRlTWVzc2FnZSxcbn0gZnJvbSAnLi90eXBlX2NoZWNrZXJfbWVzc2FnZXMnO1xuaW1wb3J0IHtcbiAgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG4gIFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IsXG59IGZyb20gJy4vdmlydHVhbF9maWxlX3N5c3RlbV9kZWNvcmF0b3InO1xuaW1wb3J0IHtcbiAgQ2FsbGJhY2ssXG4gIE5vZGVXYXRjaEZpbGVTeXN0ZW1JbnRlcmZhY2UsXG4gIE5vcm1hbE1vZHVsZUZhY3RvcnlSZXF1ZXN0LFxufSBmcm9tICcuL3dlYnBhY2snO1xuaW1wb3J0IHsgV2VicGFja0lucHV0SG9zdCB9IGZyb20gJy4vd2VicGFjay1pbnB1dC1ob3N0JztcblxuY29uc3QgdHJlZUtpbGwgPSByZXF1aXJlKCd0cmVlLWtpbGwnKTtcblxuZXhwb3J0IGludGVyZmFjZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgeyB9XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3Ige1xuICBuZXcobW9kdWxlUGF0aDogc3RyaW5nLCBuYW1lOiBzdHJpbmcpOiBDb250ZXh0RWxlbWVudERlcGVuZGVuY3k7XG59XG5cbi8qKlxuICogT3B0aW9uIENvbnN0YW50c1xuICovXG5leHBvcnQgaW50ZXJmYWNlIEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMge1xuICBzb3VyY2VNYXA/OiBib29sZWFuO1xuICB0c0NvbmZpZ1BhdGg6IHN0cmluZztcbiAgYmFzZVBhdGg/OiBzdHJpbmc7XG4gIGVudHJ5TW9kdWxlPzogc3RyaW5nO1xuICBtYWluUGF0aD86IHN0cmluZztcbiAgc2tpcENvZGVHZW5lcmF0aW9uPzogYm9vbGVhbjtcbiAgaG9zdFJlcGxhY2VtZW50UGF0aHM/OiB7IFtwYXRoOiBzdHJpbmddOiBzdHJpbmcgfSB8ICgocGF0aDogc3RyaW5nKSA9PiBzdHJpbmcpO1xuICBmb3JrVHlwZUNoZWNrZXI/OiBib29sZWFuO1xuICBpMThuSW5GaWxlPzogc3RyaW5nO1xuICBpMThuSW5Gb3JtYXQ/OiBzdHJpbmc7XG4gIGkxOG5PdXRGaWxlPzogc3RyaW5nO1xuICBpMThuT3V0Rm9ybWF0Pzogc3RyaW5nO1xuICBsb2NhbGU/OiBzdHJpbmc7XG4gIG1pc3NpbmdUcmFuc2xhdGlvbj86IHN0cmluZztcbiAgcGxhdGZvcm0/OiBQTEFURk9STTtcbiAgbmFtZUxhenlGaWxlcz86IGJvb2xlYW47XG4gIGxvZ2dlcj86IGxvZ2dpbmcuTG9nZ2VyO1xuICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc/OiBib29sZWFuO1xuXG4gIC8vIGFkZGVkIHRvIHRoZSBsaXN0IG9mIGxhenkgcm91dGVzXG4gIGFkZGl0aW9uYWxMYXp5TW9kdWxlcz86IHsgW21vZHVsZTogc3RyaW5nXTogc3RyaW5nIH07XG4gIGFkZGl0aW9uYWxMYXp5TW9kdWxlUmVzb3VyY2VzPzogc3RyaW5nW107XG5cbiAgLy8gVGhlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSBvZiBjb3JyZWN0IFdlYnBhY2sgY29tcGlsYXRpb24uXG4gIC8vIFRoaXMgaXMgbmVlZGVkIHdoZW4gdGhlcmUgYXJlIG11bHRpcGxlIFdlYnBhY2sgaW5zdGFsbHMuXG4gIGNvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yPzogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I7XG5cbiAgLy8gVXNlIHRzY29uZmlnIHRvIGluY2x1ZGUgcGF0aCBnbG9icy5cbiAgY29tcGlsZXJPcHRpb25zPzogdHMuQ29tcGlsZXJPcHRpb25zO1xuXG4gIGhvc3Q/OiB2aXJ0dWFsRnMuSG9zdDxmcy5TdGF0cz47XG4gIHBsYXRmb3JtVHJhbnNmb3JtZXJzPzogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W107XG59XG5cbmV4cG9ydCBlbnVtIFBMQVRGT1JNIHtcbiAgQnJvd3NlcixcbiAgU2VydmVyLFxufVxuXG5leHBvcnQgY2xhc3MgQW5ndWxhckNvbXBpbGVyUGx1Z2luIHtcbiAgcHJpdmF0ZSBfb3B0aW9uczogQW5ndWxhckNvbXBpbGVyUGx1Z2luT3B0aW9ucztcblxuICAvLyBUUyBjb21waWxhdGlvbi5cbiAgcHJpdmF0ZSBfY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnM7XG4gIHByaXZhdGUgX3Jvb3ROYW1lczogc3RyaW5nW107XG4gIHByaXZhdGUgX3Byb2dyYW06ICh0cy5Qcm9ncmFtIHwgUHJvZ3JhbSkgfCBudWxsO1xuICBwcml2YXRlIF9jb21waWxlckhvc3Q6IFdlYnBhY2tDb21waWxlckhvc3QgJiBDb21waWxlckhvc3Q7XG4gIHByaXZhdGUgX21vZHVsZVJlc29sdXRpb25DYWNoZTogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlO1xuICBwcml2YXRlIF9yZXNvdXJjZUxvYWRlcj86IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgLy8gQ29udGFpbnMgYG1vZHVsZUltcG9ydFBhdGgjZXhwb3J0TmFtZWAgPT4gYGZ1bGxNb2R1bGVQYXRoYC5cbiAgcHJpdmF0ZSBfbGF6eVJvdXRlczogTGF6eVJvdXRlTWFwID0ge307XG4gIHByaXZhdGUgX3RzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF9lbnRyeU1vZHVsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfbWFpblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBfYmFzZVBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfdHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSA9IFtdO1xuICBwcml2YXRlIF9wbGF0Zm9ybVRyYW5zZm9ybWVyczogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W10gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfcGxhdGZvcm06IFBMQVRGT1JNO1xuICBwcml2YXRlIF9KaXRNb2RlID0gZmFsc2U7XG4gIHByaXZhdGUgX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfY2hhbmdlZEZpbGVFeHRlbnNpb25zID0gbmV3IFNldChbJ3RzJywgJ3RzeCcsICdodG1sJywgJ2NzcycsICdqcycsICdqc29uJ10pO1xuXG4gIC8vIFdlYnBhY2sgcGx1Z2luLlxuICBwcml2YXRlIF9maXJzdFJ1biA9IHRydWU7XG4gIHByaXZhdGUgX2RvbmVQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgcHJpdmF0ZSBfbm9ybWFsaXplZExvY2FsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfd2FybmluZ3M6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9lcnJvcnM6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I7XG5cbiAgLy8gVHlwZUNoZWNrZXIgcHJvY2Vzcy5cbiAgcHJpdmF0ZSBfZm9ya1R5cGVDaGVja2VyID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfdHlwZUNoZWNrZXJQcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsO1xuICBwcml2YXRlIF9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgLy8gTG9nZ2luZy5cbiAgcHJpdmF0ZSBfbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcjtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIGdldCB0eXBlQ2hlY2tlcigpOiB0cy5UeXBlQ2hlY2tlciB8IG51bGwge1xuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuXG4gICAgcmV0dXJuIHRzUHJvZ3JhbSA/IHRzUHJvZ3JhbS5nZXRUeXBlQ2hlY2tlcigpIDogbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIHRoaXMuX2xvZ2dlciA9IG9wdGlvbnMubG9nZ2VyIHx8IGNyZWF0ZUNvbnNvbGVMb2dnZXIoKTtcblxuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHRoZSB0c2NvbmZpZyBjb250ZW50cy5cbiAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGlmIChjb25maWcuZXJyb3JzICYmIGNvbmZpZy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZm9ybWF0RGlhZ25vc3RpY3MoY29uZmlnLmVycm9ycykpO1xuICAgIH1cblxuICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXM7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zID0geyAuLi5jb25maWcub3B0aW9ucywgLi4ub3B0aW9ucy5jb21waWxlck9wdGlvbnMgfTtcbiAgICB0aGlzLl9iYXNlUGF0aCA9IGNvbmZpZy5vcHRpb25zLmJhc2VQYXRoIHx8IGJhc2VQYXRoIHx8ICcnO1xuXG4gICAgLy8gT3ZlcndyaXRlIG91dERpciBzbyB3ZSBjYW4gZmluZCBnZW5lcmF0ZWQgZmlsZXMgbmV4dCB0byB0aGVpciAudHMgb3JpZ2luIGluIGNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMub3V0RGlyID0gJyc7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcblxuICAgIC8vIERlZmF1bHQgcGx1Z2luIHNvdXJjZU1hcCB0byBjb21waWxlciBvcHRpb25zIHNldHRpbmcuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdzb3VyY2VNYXAnKSkge1xuICAgICAgb3B0aW9ucy5zb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEZvcmNlIHRoZSByaWdodCBzb3VyY2VtYXAgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5zb3VyY2VNYXApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICAvLyBXZSB3aWxsIHNldCB0aGUgc291cmNlIHRvIHRoZSBmdWxsIHBhdGggb2YgdGhlIGZpbGUgaW4gdGhlIGxvYWRlciwgc28gd2UgZG9uJ3RcbiAgICAgIC8vIG5lZWQgc291cmNlUm9vdCBoZXJlLlxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBXZSB3YW50IHRvIGFsbG93IGVtaXR0aW5nIHdpdGggZXJyb3JzIHNvIHRoYXQgaW1wb3J0cyBjYW4gYmUgYWRkZWRcbiAgICAvLyB0byB0aGUgd2VicGFjayBkZXBlbmRlbmN5IHRyZWUgYW5kIHJlYnVpbGRzIHRyaWdnZXJlZCBieSBmaWxlIGVkaXRzLlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG5cbiAgICAvLyBTZXQgSklUIChubyBjb2RlIGdlbmVyYXRpb24pIG9yIEFPVCBtb2RlLlxuICAgIGlmIChvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9KaXRNb2RlID0gb3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb247XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBpMThuIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRmlsZSA9IG9wdGlvbnMuaTE4bkluRmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Gb3JtYXQgPSBvcHRpb25zLmkxOG5JbkZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlID0gb3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZvcm1hdCA9IG9wdGlvbnMuaTE4bk91dEZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubG9jYWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Mb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0TG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlID0gdGhpcy5fdmFsaWRhdGVMb2NhbGUob3B0aW9ucy5sb2NhbGUpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5Jbk1pc3NpbmdUcmFuc2xhdGlvbnMgPVxuICAgICAgICBvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiBhcyAnZXJyb3InIHwgJ3dhcm5pbmcnIHwgJ2lnbm9yZSc7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JrZWQgdHlwZSBjaGVja2VyIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyO1xuICAgIH1cbiAgICAvLyB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcblxuICAgIC8vIEFkZCBjdXN0b20gcGxhdGZvcm0gdHJhbnNmb3JtZXJzLlxuICAgIGlmIChvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzID0gb3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycztcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB0byB0aGUgb25lIHdlIGNhbiBpbXBvcnQgZnJvbSBoZXJlLlxuICAgIC8vIEZhaWxpbmcgdG8gdXNlIHRoZSByaWdodCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgd2lsbCB0aHJvdyB0aGUgZXJyb3IgYmVsb3c6XG4gICAgLy8gXCJObyBtb2R1bGUgZmFjdG9yeSBhdmFpbGFibGUgZm9yIGRlcGVuZGVuY3kgdHlwZTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5XCJcbiAgICAvLyBIb2lzdGluZyB0b2dldGhlciB3aXRoIHBlZXIgZGVwZW5kZW5jaWVzIGNhbiBtYWtlIGl0IHNvIHRoZSBpbXBvcnRlZFxuICAgIC8vIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSBkb2VzIG5vdCBjb21lIGZyb20gdGhlIHNhbWUgV2VicGFjayBpbnN0YW5jZSB0aGF0IGlzIHVzZWRcbiAgICAvLyBpbiB0aGUgY29tcGlsYXRpb24uIEluIHRoYXQgY2FzZSwgd2UgY2FuIHBhc3MgdGhlIHJpZ2h0IG9uZSBhcyBhbiBvcHRpb24gdG8gdGhlIHBsdWdpbi5cbiAgICB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvciA9IG9wdGlvbnMuY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3JcbiAgICAgIHx8IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcblxuICAgIC8vIFVzZSBlbnRyeU1vZHVsZSBpZiBhdmFpbGFibGUgaW4gb3B0aW9ucywgb3RoZXJ3aXNlIHJlc29sdmUgaXQgZnJvbSBtYWluUGF0aCBhZnRlciBwcm9ncmFtXG4gICAgLy8gY3JlYXRpb24uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gdGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSBhcyBzdHJpbmcpOyAvLyB0ZW1wb3JhcnkgY2FzdCBmb3IgdHlwZSBpc3N1ZVxuICAgIH1cblxuICAgIC8vIFNldCBwbGF0Zm9ybS5cbiAgICB0aGlzLl9wbGF0Zm9ybSA9IG9wdGlvbnMucGxhdGZvcm0gfHwgUExBVEZPUk0uQnJvd3NlcjtcblxuICAgIC8vIE1ha2UgdHJhbnNmb3JtZXJzLlxuICAgIHRoaXMuX21ha2VUcmFuc2Zvcm1lcnMoKTtcblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRUc1Byb2dyYW0oKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9ncmFtKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICB1cGRhdGVDaGFuZ2VkRmlsZUV4dGVuc2lvbnMoZXh0ZW5zaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMuYWRkKGV4dGVuc2lvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgZXh0IG9mIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucykge1xuICAgICAgICAgIGlmIChrLmVuZHNXaXRoKGV4dCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAvLyBmb2xsb3dpbmcgaW1wb3J0cyBvbiB0aGUgZXhpc3RpbmcgZmlsZXMsIHNvIHdlIG5lZWQgdG8gZ2V0IHRoZSBuZXcgbGlzdCBvZiByb290IGZpbGVzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgZm9ya2VkIHR5cGUgY2hlY2tlciB3aXRoIGFsbCBjaGFuZ2VkIGNvbXBpbGF0aW9uIGZpbGVzLlxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgdGhpcy5fdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIodGhpcy5fcm9vdE5hbWVzLCB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpKTtcbiAgICB9XG5cbiAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUodGhpcy5fYmFzZVBhdGgsIHggPT4geCk7XG5cbiAgICBjb25zdCB0c1Byb2dyYW0gPSB0aGlzLl9nZXRUc1Byb2dyYW0oKTtcbiAgICBjb25zdCBvbGRGaWxlcyA9IG5ldyBTZXQodHNQcm9ncmFtID9cbiAgICAgIHRzUHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLm1hcChzZiA9PiBzZi5maWxlTmFtZSlcbiAgICAgIDogW10sXG4gICAgKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIHRoaXMuX3Byb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICB0c1Byb2dyYW0sXG4gICAgICApO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICBjb25zdCBuZXdGaWxlcyA9IHRoaXMuX3Byb2dyYW0uZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgcHJvZ3JhbS5cbiAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgIGF3YWl0IHRoaXMuX3Byb2dyYW0ubG9hZE5nU3RydWN0dXJlQXN5bmMoKTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRUc1Byb2dyYW0oKVxuICAgICAgICAuZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHRoZXJlJ3Mgc3RpbGwgbm8gZW50cnlNb2R1bGUgdHJ5IHRvIHJlc29sdmUgZnJvbSBtYWluUGF0aC5cbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4oXG4gICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pO1xuXG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUgJiYgIXRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbmFibGVJdnkpIHtcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaCgnTGF6eSByb3V0ZXMgZGlzY292ZXJ5IGlzIG5vdCBlbmFibGVkLiAnXG4gICAgICAgICAgKyAnQmVjYXVzZSB0aGVyZSBpcyBuZWl0aGVyIGFuIGVudHJ5TW9kdWxlIG5vciBhICdcbiAgICAgICAgICArICdzdGF0aWNhbGx5IGFuYWx5emFibGUgYm9vdHN0cmFwIGNvZGUgaW4gdGhlIG1haW4gZmlsZS4nLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZmluZExhenlSb3V0ZXNJbkFzdChjaGFuZ2VkRmlsZVBhdGhzOiBzdHJpbmdbXSk6IExhenlSb3V0ZU1hcCB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG4gICAgY29uc3QgcmVzdWx0OiBMYXp5Um91dGVNYXAgPSB7fTtcbiAgICBmb3IgKGNvbnN0IGZpbGVQYXRoIG9mIGNoYW5nZWRGaWxlUGF0aHMpIHtcbiAgICAgIGNvbnN0IGZpbGVMYXp5Um91dGVzID0gZmluZExhenlSb3V0ZXMoZmlsZVBhdGgsIHRoaXMuX2NvbXBpbGVySG9zdCwgdW5kZWZpbmVkLFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMpO1xuICAgICAgZm9yIChjb25zdCByb3V0ZUtleSBvZiBPYmplY3Qua2V5cyhmaWxlTGF6eVJvdXRlcykpIHtcbiAgICAgICAgY29uc3Qgcm91dGUgPSBmaWxlTGF6eVJvdXRlc1tyb3V0ZUtleV07XG4gICAgICAgIHJlc3VsdFtyb3V0ZUtleV0gPSByb3V0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9maW5kTGF6eVJvdXRlc0luQXN0Jyk7XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGxldCBlbnRyeVJvdXRlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IG5nUHJvZ3JhbTogUHJvZ3JhbTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfVxuXG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0uY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgbmdQcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICBvcHRpb25zOiB7IC4uLnRoaXMuX2NvbXBpbGVyT3B0aW9ucywgZ2VuRGlyOiAnJywgY29sbGVjdEFsbEVycm9yczogdHJ1ZSB9LFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbS5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgIGVudHJ5Um91dGUgPSB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpICsgJyMnICsgdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIG5nUHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbTtcbiAgICB9XG5cbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0ubGlzdExhenlSb3V0ZXMnKTtcbiAgICAvLyBlbnRyeVJvdXRlIHdpbGwgb25seSBiZSBkZWZpbmVkIGluIEpJVC5cbiAgICAvLyBJbiBBT1QgYWxsIHJvdXRlcyB3aXRoaW4gdGhlIHByb2dyYW0gYXJlIHJldHVybmVkLlxuICAgIGNvbnN0IGxhenlSb3V0ZXMgPSBuZ1Byb2dyYW0ubGlzdExhenlSb3V0ZXMoZW50cnlSb3V0ZSk7XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtLmxpc3RMYXp5Um91dGVzJyk7XG5cbiAgICByZXR1cm4gbGF6eVJvdXRlcy5yZWR1Y2UoXG4gICAgICAoYWNjLCBjdXJyKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlZiA9IGN1cnIucm91dGU7XG4gICAgICAgIGlmIChyZWYgaW4gYWNjICYmIGFjY1tyZWZdICE9PSBjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGgpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICArIGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkOiBcIiR7cmVmfVwiIGlzIHVzZWQgaW4gMiBsb2FkQ2hpbGRyZW4sIGBcbiAgICAgICAgICAgICsgYGJ1dCB0aGV5IHBvaW50IHRvIGRpZmZlcmVudCBtb2R1bGVzIFwiKCR7YWNjW3JlZl19IGFuZCBgXG4gICAgICAgICAgICArIGBcIiR7Y3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRofVwiKS4gV2VicGFjayBjYW5ub3QgZGlzdGluZ3Vpc2ggb24gY29udGV4dCBhbmQgYFxuICAgICAgICAgICAgKyAnd291bGQgZmFpbCB0byBsb2FkIHRoZSBwcm9wZXIgb25lLicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBhY2NbcmVmXSA9IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aDtcblxuICAgICAgICByZXR1cm4gYWNjO1xuICAgICAgfSxcbiAgICAgIHt9IGFzIExhenlSb3V0ZU1hcCxcbiAgICApO1xuICB9XG5cbiAgLy8gUHJvY2VzcyB0aGUgbGF6eSByb3V0ZXMgZGlzY292ZXJlZCwgYWRkaW5nIHRoZW4gdG8gX2xhenlSb3V0ZXMuXG4gIC8vIFRPRE86IGZpbmQgYSB3YXkgdG8gcmVtb3ZlIGxhenkgcm91dGVzIHRoYXQgZG9uJ3QgZXhpc3QgYW55bW9yZS5cbiAgLy8gVGhpcyB3aWxsIHJlcXVpcmUgYSByZWdpc3RyeSBvZiBrbm93biByZWZlcmVuY2VzIHRvIGEgbGF6eSByb3V0ZSwgcmVtb3ZpbmcgaXQgd2hlbiBub1xuICAvLyBtb2R1bGUgcmVmZXJlbmNlcyBpdCBhbnltb3JlLlxuICBwcml2YXRlIF9wcm9jZXNzTGF6eVJvdXRlcyhkaXNjb3ZlcmVkTGF6eVJvdXRlczogTGF6eVJvdXRlTWFwKSB7XG4gICAgT2JqZWN0LmtleXMoZGlzY292ZXJlZExhenlSb3V0ZXMpXG4gICAgICAuZm9yRWFjaChsYXp5Um91dGVLZXkgPT4ge1xuICAgICAgICBjb25zdCBbbGF6eVJvdXRlTW9kdWxlLCBtb2R1bGVOYW1lXSA9IGxhenlSb3V0ZUtleS5zcGxpdCgnIycpO1xuXG4gICAgICAgIGlmICghbGF6eVJvdXRlTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbGF6eVJvdXRlVFNGaWxlID0gZGlzY292ZXJlZExhenlSb3V0ZXNbbGF6eVJvdXRlS2V5XS5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgICAgIGxldCBtb2R1bGVQYXRoOiBzdHJpbmcsIG1vZHVsZUtleTogc3RyaW5nO1xuXG4gICAgICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZTtcbiAgICAgICAgICBtb2R1bGVLZXkgPSBgJHtsYXp5Um91dGVNb2R1bGV9JHttb2R1bGVOYW1lID8gJyMnICsgbW9kdWxlTmFtZSA6ICcnfWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbW9kdWxlUGF0aCA9IGxhenlSb3V0ZVRTRmlsZS5yZXBsYWNlKC8oXFwuZCk/XFwudHN4PyQvLCAnJyk7XG4gICAgICAgICAgbW9kdWxlUGF0aCArPSAnLm5nZmFjdG9yeS5qcyc7XG4gICAgICAgICAgY29uc3QgZmFjdG9yeU1vZHVsZU5hbWUgPSBtb2R1bGVOYW1lID8gYCMke21vZHVsZU5hbWV9TmdGYWN0b3J5YCA6ICcnO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ubmdmYWN0b3J5JHtmYWN0b3J5TW9kdWxlTmFtZX1gO1xuICAgICAgICB9XG5cbiAgICAgICAgbW9kdWxlUGF0aCA9IHdvcmthcm91bmRSZXNvbHZlKG1vZHVsZVBhdGgpO1xuXG4gICAgICAgIGlmIChtb2R1bGVLZXkgaW4gdGhpcy5fbGF6eVJvdXRlcykge1xuICAgICAgICAgIGlmICh0aGlzLl9sYXp5Um91dGVzW21vZHVsZUtleV0gIT09IG1vZHVsZVBhdGgpIHtcbiAgICAgICAgICAgIC8vIEZvdW5kIGEgZHVwbGljYXRlLCB0aGlzIGlzIGFuIGVycm9yLlxuICAgICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChcbiAgICAgICAgICAgICAgbmV3IEVycm9yKGBEdXBsaWNhdGVkIHBhdGggaW4gbG9hZENoaWxkcmVuIGRldGVjdGVkIGR1cmluZyBhIHJlYnVpbGQuIGBcbiAgICAgICAgICAgICAgICArIGBXZSB3aWxsIHRha2UgdGhlIGxhdGVzdCB2ZXJzaW9uIGRldGVjdGVkIGFuZCBvdmVycmlkZSBpdCB0byBzYXZlIHJlYnVpbGQgdGltZS4gYFxuICAgICAgICAgICAgICAgICsgYFlvdSBzaG91bGQgcGVyZm9ybSBhIGZ1bGwgYnVpbGQgdG8gdmFsaWRhdGUgdGhhdCB5b3VyIHJvdXRlcyBkb24ndCBvdmVybGFwLmApLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRm91bmQgYSBuZXcgcm91dGUsIGFkZCBpdCB0byB0aGUgbWFwLlxuICAgICAgICAgIHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSA9IG1vZHVsZVBhdGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKSB7XG4gICAgLy8gQm9vdHN0cmFwIHR5cGUgY2hlY2tlciBpcyB1c2luZyBsb2NhbCBDTEkuXG4gICAgY29uc3QgZzogYW55ID0gdHlwZW9mIGdsb2JhbCAhPT0gJ3VuZGVmaW5lZCcgPyBnbG9iYWwgOiB7fTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgY29uc3QgdHlwZUNoZWNrZXJGaWxlOiBzdHJpbmcgPSBnWydfRGV2S2l0SXNMb2NhbCddXG4gICAgICA/ICcuL3R5cGVfY2hlY2tlcl9ib290c3RyYXAuanMnXG4gICAgICA6ICcuL3R5cGVfY2hlY2tlcl93b3JrZXIuanMnO1xuXG4gICAgY29uc3QgZGVidWdBcmdSZWdleCA9IC8tLWluc3BlY3QoPzotYnJrfC1wb3J0KT98LS1kZWJ1Zyg/Oi1icmt8LXBvcnQpLztcblxuICAgIGNvbnN0IGV4ZWNBcmd2ID0gcHJvY2Vzcy5leGVjQXJndi5maWx0ZXIoKGFyZykgPT4ge1xuICAgICAgLy8gUmVtb3ZlIGRlYnVnIGFyZ3MuXG4gICAgICAvLyBXb3JrYXJvdW5kIGZvciBodHRwczovL2dpdGh1Yi5jb20vbm9kZWpzL25vZGUvaXNzdWVzLzk0MzVcbiAgICAgIHJldHVybiAhZGVidWdBcmdSZWdleC50ZXN0KGFyZyk7XG4gICAgfSk7XG4gICAgLy8gU2lnbmFsIHRoZSBwcm9jZXNzIHRvIHN0YXJ0IGxpc3RlbmluZyBmb3IgbWVzc2FnZXNcbiAgICAvLyBTb2x2ZXMgaHR0cHM6Ly9naXRodWIuY29tL2FuZ3VsYXIvYW5ndWxhci1jbGkvaXNzdWVzLzkwNzFcbiAgICBjb25zdCBmb3JrQXJncyA9IFtBVVRPX1NUQVJUX0FSR107XG4gICAgY29uc3QgZm9ya09wdGlvbnM6IEZvcmtPcHRpb25zID0geyBleGVjQXJndiB9O1xuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzID0gZm9yayhcbiAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIHR5cGVDaGVja2VyRmlsZSksXG4gICAgICBmb3JrQXJncyxcbiAgICAgIGZvcmtPcHRpb25zKTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBtZXNzYWdlcy5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub24oJ21lc3NhZ2UnLCBtZXNzYWdlID0+IHtcbiAgICAgIHN3aXRjaCAobWVzc2FnZS5raW5kKSB7XG4gICAgICAgIGNhc2UgTUVTU0FHRV9LSU5ELkxvZzpcbiAgICAgICAgICBjb25zdCBsb2dNZXNzYWdlID0gbWVzc2FnZSBhcyBMb2dNZXNzYWdlO1xuICAgICAgICAgIHRoaXMuX2xvZ2dlci5sb2cobG9nTWVzc2FnZS5sZXZlbCwgYFxcbiR7bG9nTWVzc2FnZS5tZXNzYWdlfWApO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVHlwZUNoZWNrZXI6IFVuZXhwZWN0ZWQgbWVzc2FnZSByZWNlaXZlZDogJHttZXNzYWdlfS5gKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEhhbmRsZSBjaGlsZCBwcm9jZXNzIGV4aXQuXG4gICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLm9uY2UoJ2V4aXQnLCAoXywgc2lnbmFsKSA9PiB7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuXG4gICAgICAvLyBJZiBwcm9jZXNzIGV4aXRlZCBub3QgYmVjYXVzZSBvZiBTSUdURVJNIChzZWUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlciksIHRoYW4gc29tZXRoaW5nXG4gICAgICAvLyB3ZW50IHdyb25nIGFuZCBpdCBzaG91bGQgZmFsbGJhY2sgdG8gdHlwZSBjaGVja2luZyBvbiB0aGUgbWFpbiB0aHJlYWQuXG4gICAgICBpZiAoc2lnbmFsICE9PSAnU0lHVEVSTScpIHtcbiAgICAgICAgdGhpcy5fZm9ya1R5cGVDaGVja2VyID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG1zZyA9ICdBbmd1bGFyQ29tcGlsZXJQbHVnaW46IEZvcmtlZCBUeXBlIENoZWNrZXIgZXhpdGVkIHVuZXhwZWN0ZWRseS4gJyArXG4gICAgICAgICAgJ0ZhbGxpbmcgYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIG1haW4gdGhyZWFkLic7XG4gICAgICAgIHRoaXMuX3dhcm5pbmdzLnB1c2gobXNnKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICBpZiAodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQpIHtcbiAgICAgIHRyZWVLaWxsKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5waWQsICdTSUdURVJNJyk7XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgX3VwZGF0ZUZvcmtlZFR5cGVDaGVja2VyKHJvb3ROYW1lczogc3RyaW5nW10sIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzOiBzdHJpbmdbXSkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgIGlmICghdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCkge1xuICAgICAgICBsZXQgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB7fTtcbiAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNcbiAgICAgICAgICAmJiB0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyAhPSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgaG9zdFJlcGxhY2VtZW50UGF0aHMgPSB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBJbml0TWVzc2FnZSh0aGlzLl9jb21waWxlck9wdGlvbnMsIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICAgIHRoaXMuX0ppdE1vZGUsIHRoaXMuX3Jvb3ROYW1lcywgaG9zdFJlcGxhY2VtZW50UGF0aHMpKTtcbiAgICAgICAgdGhpcy5fZm9ya2VkVHlwZUNoZWNrZXJJbml0aWFsaXplZCA9IHRydWU7XG4gICAgICB9XG4gICAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Muc2VuZChuZXcgVXBkYXRlTWVzc2FnZShyb290TmFtZXMsIGNoYW5nZWRDb21waWxhdGlvbkZpbGVzKSk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVnaXN0cmF0aW9uIGhvb2sgZm9yIHdlYnBhY2sgcGx1Z2luLlxuICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYmlnLWZ1bmN0aW9uXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlciAmIHsgd2F0Y2hNb2RlPzogYm9vbGVhbiB9KSB7XG4gICAgLy8gY2xlYW51cCBpZiBub3Qgd2F0Y2hpbmdcbiAgICBjb21waWxlci5ob29rcy50aGlzQ29tcGlsYXRpb24udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY29tcGlsYXRpb24gPT4ge1xuICAgICAgY29tcGlsYXRpb24uaG9va3MuZmluaXNoTW9kdWxlcy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICAgIC8vIG9ubHkgcHJlc2VudCBmb3Igd2VicGFjayA0LjIzLjArLCBhc3N1bWUgdHJ1ZSBvdGhlcndpc2VcbiAgICAgICAgY29uc3Qgd2F0Y2hNb2RlID0gY29tcGlsZXIud2F0Y2hNb2RlID09PSB1bmRlZmluZWQgPyB0cnVlIDogY29tcGlsZXIud2F0Y2hNb2RlO1xuICAgICAgICBpZiAoIXdhdGNoTW9kZSkge1xuICAgICAgICAgIHRoaXMuX3Byb2dyYW0gPSBudWxsO1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycyA9IFtdO1xuICAgICAgICAgIHRoaXMuX3Jlc291cmNlTG9hZGVyID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIERlY29yYXRlIGlucHV0RmlsZVN5c3RlbSB0byBzZXJ2ZSBjb250ZW50cyBvZiBDb21waWxlckhvc3QuXG4gICAgLy8gVXNlIGRlY29yYXRlZCBpbnB1dEZpbGVTeXN0ZW0gaW4gd2F0Y2hGaWxlU3lzdGVtLlxuICAgIGNvbXBpbGVyLmhvb2tzLmVudmlyb25tZW50LnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIC8vIFRoZSB3ZWJwYWNrIHR5cGVzIGN1cnJlbnRseSBkbyBub3QgaW5jbHVkZSB0aGVzZVxuICAgICAgY29uc3QgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMgPSBjb21waWxlciBhcyBDb21waWxlciAmIHtcbiAgICAgICAgd2F0Y2hGaWxlU3lzdGVtOiBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICAgICAgfTtcblxuICAgICAgbGV0IGhvc3Q6IHZpcnR1YWxGcy5Ib3N0PGZzLlN0YXRzPiA9IHRoaXMuX29wdGlvbnMuaG9zdCB8fCBuZXcgV2VicGFja0lucHV0SG9zdChcbiAgICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMuaW5wdXRGaWxlU3lzdGVtLFxuICAgICAgKTtcblxuICAgICAgbGV0IHJlcGxhY2VtZW50czogTWFwPFBhdGgsIFBhdGg+IHwgKChwYXRoOiBQYXRoKSA9PiBQYXRoKSB8IHVuZGVmaW5lZDtcbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocyA9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRSZXNvbHZlciA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gcGF0aCA9PiBub3JtYWxpemUocmVwbGFjZW1lbnRSZXNvbHZlcihnZXRTeXN0ZW1QYXRoKHBhdGgpKSk7XG4gICAgICAgICAgaG9zdCA9IG5ldyBjbGFzcyBleHRlbmRzIHZpcnR1YWxGcy5SZXNvbHZlckhvc3Q8ZnMuU3RhdHM+IHtcbiAgICAgICAgICAgIF9yZXNvbHZlKHBhdGg6IFBhdGgpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KGhvc3QpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlcGxhY2VtZW50cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgICBjb25zdCBhbGlhc0hvc3QgPSBuZXcgdmlydHVhbEZzLkFsaWFzSG9zdChob3N0KTtcbiAgICAgICAgICBmb3IgKGNvbnN0IGZyb20gaW4gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocykge1xuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZEZyb20gPSByZXNvbHZlKG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksIG5vcm1hbGl6ZShmcm9tKSk7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkV2l0aCA9IHJlc29sdmUoXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9iYXNlUGF0aCksXG4gICAgICAgICAgICAgIG5vcm1hbGl6ZSh0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzW2Zyb21dKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBhbGlhc0hvc3QuYWxpYXNlcy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICAgIHJlcGxhY2VtZW50cy5zZXQobm9ybWFsaXplZEZyb20sIG5vcm1hbGl6ZWRXaXRoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaG9zdCA9IGFsaWFzSG9zdDtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDcmVhdGUgdGhlIHdlYnBhY2sgY29tcGlsZXIgaG9zdC5cbiAgICAgIGNvbnN0IHdlYnBhY2tDb21waWxlckhvc3QgPSBuZXcgV2VicGFja0NvbXBpbGVySG9zdChcbiAgICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0aGlzLl9iYXNlUGF0aCxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdHJ1ZSxcbiAgICAgICAgdGhpcy5fb3B0aW9ucy5kaXJlY3RUZW1wbGF0ZUxvYWRpbmcsXG4gICAgICApO1xuXG4gICAgICAvLyBDcmVhdGUgYW5kIHNldCBhIG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgaW4gQU9UXG4gICAgICBpZiAoIXRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKCk7XG4gICAgICAgIHdlYnBhY2tDb21waWxlckhvc3Quc2V0UmVzb3VyY2VMb2FkZXIodGhpcy5fcmVzb3VyY2VMb2FkZXIpO1xuICAgICAgfVxuXG4gICAgICAvLyBVc2UgdGhlIFdlYnBhY2tDb21waWxlckhvc3Qgd2l0aCBhIHJlc291cmNlIGxvYWRlciB0byBjcmVhdGUgYW4gQW5ndWxhckNvbXBpbGVySG9zdC5cbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCA9IGNyZWF0ZUNvbXBpbGVySG9zdCh7XG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdHNIb3N0OiB3ZWJwYWNrQ29tcGlsZXJIb3N0LFxuICAgICAgfSkgYXMgQ29tcGlsZXJIb3N0ICYgV2VicGFja0NvbXBpbGVySG9zdDtcblxuICAgICAgLy8gUmVzb2x2ZSBtYWluUGF0aCBpZiBwcm92aWRlZC5cbiAgICAgIGlmICh0aGlzLl9vcHRpb25zLm1haW5QYXRoKSB7XG4gICAgICAgIHRoaXMuX21haW5QYXRoID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUodGhpcy5fb3B0aW9ucy5tYWluUGF0aCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlucHV0RGVjb3JhdG9yID0gbmV3IFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0sXG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdCxcbiAgICAgICk7XG4gICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0gPSBpbnB1dERlY29yYXRvcjtcbiAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLndhdGNoRmlsZVN5c3RlbSA9IG5ldyBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yKFxuICAgICAgICBpbnB1dERlY29yYXRvcixcbiAgICAgICAgcmVwbGFjZW1lbnRzLFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIC8vIEFkZCBsYXp5IG1vZHVsZXMgdG8gdGhlIGNvbnRleHQgbW9kdWxlIGZvciBAYW5ndWxhci9jb3JlXG4gICAgY29tcGlsZXIuaG9va3MuY29udGV4dE1vZHVsZUZhY3RvcnkudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgY21mID0+IHtcbiAgICAgIGNvbnN0IGFuZ3VsYXJDb3JlUGFja2FnZVBhdGggPSByZXF1aXJlLnJlc29sdmUoJ0Bhbmd1bGFyL2NvcmUvcGFja2FnZS5qc29uJyk7XG5cbiAgICAgIC8vIEFQRnY2IGRvZXMgbm90IGhhdmUgc2luZ2xlIEZFU00gYW55bW9yZS4gSW5zdGVhZCBvZiB2ZXJpZnlpbmcgaWYgd2UncmUgcG9pbnRpbmcgdG9cbiAgICAgIC8vIEZFU01zLCB3ZSByZXNvbHZlIHRoZSBgQGFuZ3VsYXIvY29yZWAgcGF0aCBhbmQgdmVyaWZ5IHRoYXQgdGhlIHBhdGggZm9yIHRoZVxuICAgICAgLy8gbW9kdWxlIHN0YXJ0cyB3aXRoIGl0LlxuICAgICAgLy8gVGhpcyBtYXkgYmUgc2xvd2VyIGJ1dCBpdCB3aWxsIGJlIGNvbXBhdGlibGUgd2l0aCBib3RoIEFQRjUsIDYgYW5kIHBvdGVudGlhbCBmdXR1cmVcbiAgICAgIC8vIHZlcnNpb25zICh1bnRpbCB0aGUgZHluYW1pYyBpbXBvcnQgYXBwZWFycyBvdXRzaWRlIG9mIGNvcmUgSSBzdXBwb3NlKS5cbiAgICAgIC8vIFdlIHJlc29sdmUgYW55IHN5bWJvbGljIGxpbmtzIGluIG9yZGVyIHRvIGdldCB0aGUgcmVhbCBwYXRoIHRoYXQgd291bGQgYmUgdXNlZCBpbiB3ZWJwYWNrLlxuICAgICAgY29uc3QgYW5ndWxhckNvcmVSZXNvdXJjZVJvb3QgPSBmcy5yZWFscGF0aFN5bmMocGF0aC5kaXJuYW1lKGFuZ3VsYXJDb3JlUGFja2FnZVBhdGgpKTtcblxuICAgICAgY21mLmhvb2tzLmFmdGVyUmVzb2x2ZS50YXBQcm9taXNlKCdhbmd1bGFyLWNvbXBpbGVyJywgYXN5bmMgcmVzdWx0ID0+IHtcbiAgICAgICAgLy8gQWx0ZXIgb25seSBleGlzdGluZyByZXF1ZXN0IGZyb20gQW5ndWxhciBvciBvbmUgb2YgdGhlIGFkZGl0aW9uYWwgbGF6eSBtb2R1bGUgcmVzb3VyY2VzLlxuICAgICAgICBjb25zdCBpc0xhenlNb2R1bGVSZXNvdXJjZSA9IChyZXNvdXJjZTogc3RyaW5nKSA9PlxuICAgICAgICAgIHJlc291cmNlLnN0YXJ0c1dpdGgoYW5ndWxhckNvcmVSZXNvdXJjZVJvb3QpIHx8XG4gICAgICAgICAgKCB0aGlzLm9wdGlvbnMuYWRkaXRpb25hbExhenlNb2R1bGVSZXNvdXJjZXMgJiZcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcy5pbmNsdWRlcyhyZXNvdXJjZSkpO1xuXG4gICAgICAgIGlmICghcmVzdWx0IHx8ICF0aGlzLmRvbmUgfHwgIWlzTGF6eU1vZHVsZVJlc291cmNlKHJlc3VsdC5yZXNvdXJjZSkpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHRoaXMuZG9uZS50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIC8vIFRoaXMgZm9sZGVyIGRvZXMgbm90IGV4aXN0LCBidXQgd2UgbmVlZCB0byBnaXZlIHdlYnBhY2sgYSByZXNvdXJjZS5cbiAgICAgICAgICAgIC8vIFRPRE86IGNoZWNrIGlmIHdlIGNhbid0IGp1c3QgbGVhdmUgaXQgYXMgaXMgKGFuZ3VsYXJDb3JlTW9kdWxlRGlyKS5cbiAgICAgICAgICAgIHJlc3VsdC5yZXNvdXJjZSA9IHBhdGguam9pbih0aGlzLl9iYXNlUGF0aCwgJyQkX2xhenlfcm91dGVfcmVzb3VyY2UnKTtcbiAgICAgICAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgICAgICAgIHJlc3VsdC5kZXBlbmRlbmNpZXMuZm9yRWFjaCgoZDogYW55KSA9PiBkLmNyaXRpY2FsID0gZmFsc2UpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LnJlc29sdmVEZXBlbmRlbmNpZXMgPSAoX2ZzOiBhbnksIG9wdGlvbnM6IGFueSwgY2FsbGJhY2s6IENhbGxiYWNrKSA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IE9iamVjdC5rZXlzKHRoaXMuX2xhenlSb3V0ZXMpXG4gICAgICAgICAgICAgICAgLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgICAgICAgICAgICBjb25zdCBtb2R1bGVQYXRoID0gdGhpcy5fbGF6eVJvdXRlc1trZXldO1xuICAgICAgICAgICAgICAgICAgaWYgKG1vZHVsZVBhdGggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IGtleS5zcGxpdCgnIycpWzBdO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBuZXcgdGhpcy5fY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3IobW9kdWxlUGF0aCwgbmFtZSk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5maWx0ZXIoeCA9PiAhIXgpO1xuXG4gICAgICAgICAgICAgIGlmICh0aGlzLl9vcHRpb25zLm5hbWVMYXp5RmlsZXMpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLmNodW5rTmFtZSA9ICdbcmVxdWVzdF0nO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgY2FsbGJhY2sobnVsbCwgZGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoKSA9PiB1bmRlZmluZWQsXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBhbmQgZGVzdHJveSBmb3JrZWQgdHlwZSBjaGVja2VyIG9uIHdhdGNoIG1vZGUuXG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hSdW4udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciAmJiAhdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzKSB7XG4gICAgICAgIHRoaXMuX2NyZWF0ZUZvcmtlZFR5cGVDaGVja2VyKCk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3Mud2F0Y2hDbG9zZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB0aGlzLl9raWxsRm9ya2VkVHlwZUNoZWNrZXIoKSk7XG5cbiAgICAvLyBSZW1ha2UgdGhlIHBsdWdpbiBvbiBlYWNoIGNvbXBpbGF0aW9uLlxuICAgIGNvbXBpbGVyLmhvb2tzLm1ha2UudGFwUHJvbWlzZShcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyJyxcbiAgICAgIGNvbXBpbGF0aW9uID0+IHRoaXMuX2RvbmVQcm9taXNlID0gdGhpcy5fbWFrZShjb21waWxhdGlvbiksXG4gICAgKTtcbiAgICBjb21waWxlci5ob29rcy5pbnZhbGlkLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2ZpcnN0UnVuID0gZmFsc2UpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyRW1pdC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxhdGlvbiA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsYXRpb24gYXMgYW55KS5fbmdUb29sc1dlYnBhY2tQbHVnaW5JbnN0YW5jZSA9IG51bGw7XG4gICAgfSk7XG4gICAgY29tcGlsZXIuaG9va3MuZG9uZS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICB0aGlzLl9kb25lUHJvbWlzZSA9IG51bGw7XG4gICAgfSk7XG5cbiAgICBjb21waWxlci5ob29rcy5hZnRlclJlc29sdmVycy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxlciA9PiB7XG4gICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAoY29tcGlsZXIgYXMgYW55KS5yZXNvbHZlckZhY3RvcnkuaG9va3MucmVzb2x2ZXJcbiAgICAgICAgLmZvcignbm9ybWFsJylcbiAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlc29sdmVyOiBhbnkpID0+IHtcbiAgICAgICAgICBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKHRoaXMuX2NvbXBpbGVyT3B0aW9ucykuYXBwbHkocmVzb2x2ZXIpO1xuICAgICAgICB9KTtcblxuICAgICAgY29tcGlsZXIuaG9va3Mubm9ybWFsTW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBubWYgPT4ge1xuICAgICAgICAvLyBWaXJ0dWFsIGZpbGUgc3lzdGVtLlxuICAgICAgICAvLyBUT0RPOiBjb25zaWRlciBpZiBpdCdzIGJldHRlciB0byByZW1vdmUgdGhpcyBwbHVnaW4gYW5kIGluc3RlYWQgbWFrZSBpdCB3YWl0IG9uIHRoZVxuICAgICAgICAvLyBWaXJ0dWFsRmlsZVN5c3RlbURlY29yYXRvci5cbiAgICAgICAgLy8gV2FpdCBmb3IgdGhlIHBsdWdpbiB0byBiZSBkb25lIHdoZW4gcmVxdWVzdGluZyBgLnRzYCBmaWxlcyBkaXJlY3RseSAoZW50cnkgcG9pbnRzKSwgb3JcbiAgICAgICAgLy8gd2hlbiB0aGUgaXNzdWVyIGlzIGEgYC50c2Agb3IgYC5uZ2ZhY3RvcnkuanNgIGZpbGUuXG4gICAgICAgIG5tZi5ob29rcy5iZWZvcmVSZXNvbHZlLnRhcFByb21pc2UoXG4gICAgICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgICAgIGFzeW5jIChyZXF1ZXN0PzogTm9ybWFsTW9kdWxlRmFjdG9yeVJlcXVlc3QpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzLmRvbmUgJiYgcmVxdWVzdCkge1xuICAgICAgICAgICAgICBjb25zdCBuYW1lID0gcmVxdWVzdC5yZXF1ZXN0O1xuICAgICAgICAgICAgICBjb25zdCBpc3N1ZXIgPSByZXF1ZXN0LmNvbnRleHRJbmZvLmlzc3VlcjtcbiAgICAgICAgICAgICAgaWYgKG5hbWUuZW5kc1dpdGgoJy50cycpIHx8IG5hbWUuZW5kc1dpdGgoJy50c3gnKVxuICAgICAgICAgICAgICAgIHx8IChpc3N1ZXIgJiYgL1xcLnRzfG5nZmFjdG9yeVxcLmpzJC8udGVzdChpc3N1ZXIpKSkge1xuICAgICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmRvbmU7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7IH1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gcmVxdWVzdDtcbiAgICAgICAgICB9LFxuICAgICAgICApO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF9tYWtlKGNvbXBpbGF0aW9uOiBjb21waWxhdGlvbi5Db21waWxhdGlvbikge1xuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgaWYgKChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FuIEBuZ3Rvb2xzL3dlYnBhY2sgcGx1Z2luIGFscmVhZHkgZXhpc3QgZm9yIHRoaXMgY29tcGlsYXRpb24uJyk7XG4gICAgfVxuXG4gICAgLy8gU2V0IGEgcHJpdmF0ZSB2YXJpYWJsZSBmb3IgdGhpcyBwbHVnaW4gaW5zdGFuY2UuXG4gICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gdGhpcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIHdpdGggdGhlIG5ldyB3ZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAgIGlmICh0aGlzLl9yZXNvdXJjZUxvYWRlcikge1xuICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5fdXBkYXRlKCk7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaChlcnIpO1xuICAgICAgdGhpcy5wdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb24pO1xuICAgIH1cblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbWFrZScpO1xuICB9XG5cbiAgcHJpdmF0ZSBwdXNoQ29tcGlsYXRpb25FcnJvcnMoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2goLi4udGhpcy5fZXJyb3JzKTtcbiAgICBjb21waWxhdGlvbi53YXJuaW5ncy5wdXNoKC4uLnRoaXMuX3dhcm5pbmdzKTtcbiAgICB0aGlzLl9lcnJvcnMgPSBbXTtcbiAgICB0aGlzLl93YXJuaW5ncyA9IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfbWFrZVRyYW5zZm9ybWVycygpIHtcbiAgICBjb25zdCBpc0FwcFBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT5cbiAgICAgICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nZmFjdG9yeS50cycpICYmICFmaWxlTmFtZS5lbmRzV2l0aCgnLm5nc3R5bGUudHMnKTtcbiAgICBjb25zdCBpc01haW5QYXRoID0gKGZpbGVOYW1lOiBzdHJpbmcpID0+IGZpbGVOYW1lID09PSAoXG4gICAgICB0aGlzLl9tYWluUGF0aCA/IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuX21haW5QYXRoKSA6IHRoaXMuX21haW5QYXRoXG4gICAgKTtcbiAgICBjb25zdCBnZXRFbnRyeU1vZHVsZSA9ICgpID0+IHRoaXMuZW50cnlNb2R1bGVcbiAgICAgID8geyBwYXRoOiB3b3JrYXJvdW5kUmVzb2x2ZSh0aGlzLmVudHJ5TW9kdWxlLnBhdGgpLCBjbGFzc05hbWU6IHRoaXMuZW50cnlNb2R1bGUuY2xhc3NOYW1lIH1cbiAgICAgIDogdGhpcy5lbnRyeU1vZHVsZTtcbiAgICBjb25zdCBnZXRMYXp5Um91dGVzID0gKCkgPT4gdGhpcy5fbGF6eVJvdXRlcztcbiAgICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+ICh0aGlzLl9nZXRUc1Byb2dyYW0oKSBhcyB0cy5Qcm9ncmFtKS5nZXRUeXBlQ2hlY2tlcigpO1xuXG4gICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgIC8vIFJlcGxhY2UgcmVzb3VyY2VzIGluIEpJVC5cbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VSZXNvdXJjZXMoaXNBcHBQYXRoLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdmUgdW5uZWVkZWQgYW5ndWxhciBkZWNvcmF0b3JzLlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVtb3ZlRGVjb3JhdG9ycyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSBudWxsKSB7XG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaCguLi50aGlzLl9wbGF0Zm9ybVRyYW5zZm9ybWVycyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICh0aGlzLl9wbGF0Zm9ybSA9PT0gUExBVEZPUk0uQnJvd3Nlcikge1xuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgbG9jYWxlLCBhdXRvIGltcG9ydCB0aGUgbG9jYWxlIGRhdGEgZmlsZS5cbiAgICAgICAgLy8gVGhpcyB0cmFuc2Zvcm0gbXVzdCBnbyBiZWZvcmUgcmVwbGFjZUJvb3RzdHJhcCBiZWNhdXNlIGl0IGxvb2tzIGZvciB0aGUgZW50cnkgbW9kdWxlXG4gICAgICAgIC8vIGltcG9ydCwgd2hpY2ggd2lsbCBiZSByZXBsYWNlZC5cbiAgICAgICAgaWYgKHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZWdpc3RlckxvY2FsZURhdGEoaXNBcHBQYXRoLCBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICAgIHRoaXMuX25vcm1hbGl6ZWRMb2NhbGUpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIC8vIFJlcGxhY2UgYm9vdHN0cmFwIGluIGJyb3dzZXIgQU9ULlxuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlcGxhY2VCb290c3RyYXAoXG4gICAgICAgICAgICBpc0FwcFBhdGgsXG4gICAgICAgICAgICBnZXRFbnRyeU1vZHVsZSxcbiAgICAgICAgICAgIGdldFR5cGVDaGVja2VyLFxuICAgICAgICAgICAgISF0aGlzLl9jb21waWxlck9wdGlvbnMuZW5hYmxlSXZ5LFxuICAgICAgICAgICkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5TZXJ2ZXIpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goZXhwb3J0TGF6eU1vZHVsZU1hcChpc01haW5QYXRoLCBnZXRMYXp5Um91dGVzKSk7XG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICAgICAgZXhwb3J0TmdGYWN0b3J5KGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlKSxcbiAgICAgICAgICAgIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIF9nZXRDaGFuZ2VkVHNGaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5fZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKVxuICAgICAgLmZpbHRlcihrID0+IChrLmVuZHNXaXRoKCcudHMnKSB8fCBrLmVuZHNXaXRoKCcudHN4JykpICYmICFrLmVuZHNXaXRoKCcuZC50cycpKVxuICAgICAgLmZpbHRlcihrID0+IHRoaXMuX2NvbXBpbGVySG9zdC5maWxlRXhpc3RzKGspKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgX3VwZGF0ZSgpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICAgIC8vIFdlIG9ubHkgd2FudCB0byB1cGRhdGUgb24gVFMgYW5kIHRlbXBsYXRlIGNoYW5nZXMsIGJ1dCBhbGwga2luZHMgb2YgZmlsZXMgYXJlIG9uIHRoaXNcbiAgICAvLyBsaXN0LCBsaWtlIHBhY2thZ2UuanNvbiBhbmQgLm5nc3VtbWFyeS5qc29uIGZpbGVzLlxuICAgIGNvbnN0IGNoYW5nZWRGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKCk7XG5cbiAgICAvLyBJZiBub3RoaW5nIHdlIGNhcmUgYWJvdXQgY2hhbmdlZCBhbmQgaXQgaXNuJ3QgdGhlIGZpcnN0IHJ1biwgZG9uJ3QgZG8gYW55dGhpbmcuXG4gICAgaWYgKGNoYW5nZWRGaWxlcy5sZW5ndGggPT09IDAgJiYgIXRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTWFrZSBhIG5ldyBwcm9ncmFtIGFuZCBsb2FkIHRoZSBBbmd1bGFyIHN0cnVjdHVyZS5cbiAgICBhd2FpdCB0aGlzLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0oKTtcblxuICAgIC8vIFRyeSB0byBmaW5kIGxhenkgcm91dGVzIGlmIHdlIGhhdmUgYW4gZW50cnkgbW9kdWxlLlxuICAgIC8vIFdlIG5lZWQgdG8gcnVuIHRoZSBgbGlzdExhenlSb3V0ZXNgIHRoZSBmaXJzdCB0aW1lIGJlY2F1c2UgaXQgYWxzbyBuYXZpZ2F0ZXMgbGlicmFyaWVzXG4gICAgLy8gYW5kIG90aGVyIHRoaW5ncyB0aGF0IHdlIG1pZ2h0IG1pc3MgdXNpbmcgdGhlIChmYXN0ZXIpIGZpbmRMYXp5Um91dGVzSW5Bc3QuXG4gICAgLy8gTGF6eSByb3V0ZXMgbW9kdWxlcyB3aWxsIGJlIHJlYWQgd2l0aCBjb21waWxlckhvc3QgYW5kIGFkZGVkIHRvIHRoZSBjaGFuZ2VkIGZpbGVzLlxuICAgIGxldCBsYXp5Um91dGVNYXA6IExhenlSb3V0ZU1hcCA9IHt9O1xuICAgIGlmICghdGhpcy5fSml0TW9kZSB8fCB0aGlzLl9maXJzdFJ1bikge1xuICAgICAgbGF6eVJvdXRlTWFwID0gdGhpcy5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBjaGFuZ2VkVHNGaWxlcyA9IHRoaXMuX2dldENoYW5nZWRUc0ZpbGVzKCk7XG4gICAgICBpZiAoY2hhbmdlZFRzRmlsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICBsYXp5Um91dGVNYXAgPSB0aGlzLl9maW5kTGF6eVJvdXRlc0luQXN0KGNoYW5nZWRUc0ZpbGVzKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBGaW5kIGxhenkgcm91dGVzXG4gICAgbGF6eVJvdXRlTWFwID0ge1xuICAgICAgLi4ubGF6eVJvdXRlTWFwLFxuICAgICAgLi4udGhpcy5fb3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZXMsXG4gICAgfTtcblxuICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKGxhenlSb3V0ZU1hcCk7XG5cbiAgICAvLyBFbWl0IGZpbGVzLlxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgY29uc3QgeyBlbWl0UmVzdWx0LCBkaWFnbm9zdGljcyB9ID0gdGhpcy5fZW1pdCgpO1xuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG5cbiAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgY29uc3QgZXJyb3JzID0gZGlhZ25vc3RpY3NcbiAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvcik7XG4gICAgY29uc3Qgd2FybmluZ3MgPSBkaWFnbm9zdGljc1xuICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3MoZXJyb3JzKTtcbiAgICAgIHRoaXMuX2Vycm9ycy5wdXNoKG5ldyBFcnJvcihtZXNzYWdlKSk7XG4gICAgfVxuXG4gICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gIWVtaXRSZXN1bHQgfHwgZW1pdFJlc3VsdC5lbWl0U2tpcHBlZDtcblxuICAgIC8vIFJlc2V0IGNoYW5nZWQgZmlsZXMgb24gc3VjY2Vzc2Z1bCBjb21waWxhdGlvbi5cbiAgICBpZiAoIXRoaXMuX2VtaXRTa2lwcGVkICYmIHRoaXMuX2Vycm9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICB9XG5cbiAgd3JpdGVJMThuT3V0RmlsZSgpIHtcbiAgICBmdW5jdGlvbiBfcmVjdXJzaXZlTWtEaXIocDogc3RyaW5nKSB7XG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMocCkpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShwKSk7XG4gICAgICAgIGZzLm1rZGlyU3luYyhwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXcml0ZSB0aGUgZXh0cmFjdGVkIG1lc3NhZ2VzIHRvIGRpc2suXG4gICAgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSkge1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLCB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpO1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVDb250ZW50ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKGkxOG5PdXRGaWxlUGF0aCk7XG4gICAgICBpZiAoaTE4bk91dEZpbGVDb250ZW50KSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUoaTE4bk91dEZpbGVQYXRoKSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoaTE4bk91dEZpbGVQYXRoLCBpMThuT3V0RmlsZUNvbnRlbnQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldENvbXBpbGVkRmlsZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZSA9IGZpbGVOYW1lLnJlcGxhY2UoLy50c3g/JC8sICcuanMnKTtcbiAgICBsZXQgb3V0cHV0VGV4dDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2VNYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZXJyb3JEZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAodGhpcy5fZW1pdFNraXBwZWQpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICAvLyBJZiB0aGUgY29tcGlsYXRpb24gZGlkbid0IGVtaXQgZmlsZXMgdGhpcyB0aW1lLCB0cnkgdG8gcmV0dXJuIHRoZSBjYWNoZWQgZmlsZXMgZnJvbSB0aGVcbiAgICAgICAgLy8gbGFzdCBjb21waWxhdGlvbiBhbmQgbGV0IHRoZSBjb21waWxhdGlvbiBlcnJvcnMgc2hvdyB3aGF0J3Mgd3JvbmcuXG4gICAgICAgIG91dHB1dFRleHQgPSB0ZXh0O1xuICAgICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUaGVyZSdzIG5vdGhpbmcgd2UgY2FuIHNlcnZlLiBSZXR1cm4gYW4gZW1wdHkgc3RyaW5nIHRvIHByZXZlbnQgbGVuZ2h0eSB3ZWJwYWNrIGVycm9ycyxcbiAgICAgICAgLy8gYWRkIHRoZSByZWJ1aWxkIHdhcm5pbmcgaWYgaXQncyBub3QgdGhlcmUgeWV0LlxuICAgICAgICAvLyBXZSBhbHNvIG5lZWQgdG8gYWxsIGNoYW5nZWQgZmlsZXMgYXMgZGVwZW5kZW5jaWVzIG9mIHRoaXMgZmlsZSwgc28gdGhhdCBhbGwgb2YgdGhlbVxuICAgICAgICAvLyB3aWxsIGJlIHdhdGNoZWQgYW5kIHRyaWdnZXIgYSByZWJ1aWxkIG5leHQgdGltZS5cbiAgICAgICAgb3V0cHV0VGV4dCA9ICcnO1xuICAgICAgICBlcnJvckRlcGVuZGVuY2llcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKClcbiAgICAgICAgICAvLyBUaGVzZSBwYXRocyBhcmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICAgICAgICAubWFwKChwKSA9PiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2hlY2sgaWYgdGhlIFRTIGlucHV0IGZpbGUgYW5kIHRoZSBKUyBvdXRwdXQgZmlsZSBleGlzdC5cbiAgICAgIGlmICgoKGZpbGVOYW1lLmVuZHNXaXRoKCcudHMnKSB8fCBmaWxlTmFtZS5lbmRzV2l0aCgnLnRzeCcpKVxuICAgICAgICAmJiAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoZmlsZU5hbWUpKVxuICAgICAgICB8fCAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMob3V0cHV0RmlsZSwgZmFsc2UpKSB7XG4gICAgICAgIGxldCBtc2cgPSBgJHtmaWxlTmFtZX0gaXMgbWlzc2luZyBmcm9tIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uLiBgXG4gICAgICAgICAgKyBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcblxuICAgICAgICBpZiAoLyhcXFxcfFxcLylub2RlX21vZHVsZXMoXFxcXHxcXC8pLy50ZXN0KGZpbGVOYW1lKSkge1xuICAgICAgICAgIG1zZyArPSAnXFxuVGhlIG1pc3NpbmcgZmlsZSBzZWVtcyB0byBiZSBwYXJ0IG9mIGEgdGhpcmQgcGFydHkgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnVFMgZmlsZXMgaW4gcHVibGlzaGVkIGxpYnJhcmllcyBhcmUgb2Z0ZW4gYSBzaWduIG9mIGEgYmFkbHkgcGFja2FnZWQgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnUGxlYXNlIG9wZW4gYW4gaXNzdWUgaW4gdGhlIGxpYnJhcnkgcmVwb3NpdG9yeSB0byBhbGVydCBpdHMgYXV0aG9yIGFuZCBhc2sgdGhlbSAnXG4gICAgICAgICAgICArICd0byBwYWNrYWdlIHRoZSBsaWJyYXJ5IHVzaW5nIHRoZSBBbmd1bGFyIFBhY2thZ2UgRm9ybWF0IChodHRwczovL2dvby5nbC9qQjNHVnYpLic7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICAgIH1cblxuICAgICAgb3V0cHV0VGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKSB8fCAnJztcbiAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBvdXRwdXRUZXh0LCBzb3VyY2VNYXAsIGVycm9yRGVwZW5kZW5jaWVzIH07XG4gIH1cblxuICBnZXREZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUoZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLl9jb21waWxlckhvc3QuZ2V0U291cmNlRmlsZShyZXNvbHZlZEZpbGVOYW1lLCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0KTtcbiAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fY29tcGlsZXJPcHRpb25zO1xuICAgIGNvbnN0IGhvc3QgPSB0aGlzLl9jb21waWxlckhvc3Q7XG4gICAgY29uc3QgY2FjaGUgPSB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG5cbiAgICBjb25zdCBlc0ltcG9ydHMgPSBjb2xsZWN0RGVlcE5vZGVzPHRzLkltcG9ydERlY2xhcmF0aW9uPihzb3VyY2VGaWxlLFxuICAgICAgdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgIC5tYXAoZGVjbCA9PiB7XG4gICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSAoZGVjbC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dDtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShtb2R1bGVOYW1lLCByZXNvbHZlZEZpbGVOYW1lLCBvcHRpb25zLCBob3N0LCBjYWNoZSk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkLnJlc29sdmVkTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKHggPT4geCk7XG5cbiAgICBjb25zdCByZXNvdXJjZUltcG9ydHMgPSBmaW5kUmVzb3VyY2VzKHNvdXJjZUZpbGUpXG4gICAgICAubWFwKHJlc291cmNlUGF0aCA9PiByZXNvbHZlKGRpcm5hbWUocmVzb2x2ZWRGaWxlTmFtZSksIG5vcm1hbGl6ZShyZXNvdXJjZVBhdGgpKSk7XG5cbiAgICAvLyBUaGVzZSBwYXRocyBhcmUgbWVhbnQgdG8gYmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICBjb25zdCB1bmlxdWVEZXBlbmRlbmNpZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXModGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChyZXNvbHZlZEZpbGVOYW1lKSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgaWYgKCF0aGlzLl9yZXNvdXJjZUxvYWRlcikge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZSk7XG4gIH1cblxuICAvLyBUaGlzIGNvZGUgbW9zdGx5IGNvbWVzIGZyb20gYHBlcmZvcm1Db21waWxhdGlvbmAgaW4gYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAuXG4gIC8vIEl0IHNraXBzIHRoZSBwcm9ncmFtIGNyZWF0aW9uIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2UgYGxvYWROZ1N0cnVjdHVyZUFzeW5jKClgLFxuICAvLyBhbmQgdXNlcyBDdXN0b21UcmFuc2Zvcm1lcnMuXG4gIHByaXZhdGUgX2VtaXQoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG4gICAgY29uc3QgcHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW07XG4gICAgY29uc3QgYWxsRGlhZ25vc3RpY3M6IEFycmF5PHRzLkRpYWdub3N0aWMgfCBEaWFnbm9zdGljPiA9IFtdO1xuICAgIGNvbnN0IGRpYWdNb2RlID0gKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpID9cbiAgICAgIERpYWdub3N0aWNNb2RlLkFsbCA6IERpYWdub3N0aWNNb2RlLlN5bnRhY3RpYztcblxuICAgIGxldCBlbWl0UmVzdWx0OiB0cy5FbWl0UmVzdWx0IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICBjb25zdCB0c1Byb2dyYW0gPSBwcm9ncmFtIGFzIHRzLlByb2dyYW07XG4gICAgICAgIGNvbnN0IGNoYW5nZWRUc0ZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLnRzUHJvZ3JhbS5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGdlbmVyYXRlIGEgbGlzdCBvZiBjaGFuZ2VkIGZpbGVzIGZvciBlbWl0XG4gICAgICAgICAgLy8gbm90IG5lZWRlZCBvbiBmaXJzdCBydW4gc2luY2UgYSBmdWxsIHByb2dyYW0gZW1pdCBpcyByZXF1aXJlZFxuICAgICAgICAgIGZvciAoY29uc3QgY2hhbmdlZEZpbGUgb2YgdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKSkge1xuICAgICAgICAgICAgaWYgKCEvLih0c3h8dHN8anNvbnxqcykkLy50ZXN0KGNoYW5nZWRGaWxlKSkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGV4aXN0aW5nIHR5cGUgZGVmaW5pdGlvbnMgYXJlIG5vdCBlbWl0dGVkXG4gICAgICAgICAgICBpZiAoY2hhbmdlZEZpbGUuZW5kc1dpdGgoJy5kLnRzJykpIHtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGFuZ2VkVHNGaWxlcy5hZGQoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModHNQcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMnLCBkaWFnTW9kZSkpO1xuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIGlmICh0aGlzLl9maXJzdFJ1biB8fCBjaGFuZ2VkVHNGaWxlcy5zaXplID4gMjApIHtcbiAgICAgICAgICAgIGVtaXRSZXN1bHQgPSB0c1Byb2dyYW0uZW1pdChcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiBjaGFuZ2VkVHNGaWxlcykge1xuICAgICAgICAgICAgICBjb25zdCBzb3VyY2VGaWxlID0gdHNQcm9ncmFtLmdldFNvdXJjZUZpbGUoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgICAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzb3VyY2VGaWxlLmZpbGVOYW1lfSsuZW1pdGA7XG4gICAgICAgICAgICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KHNvdXJjZUZpbGUsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IHByb2dyYW0gYXMgUHJvZ3JhbTtcblxuICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHN0cnVjdHVyYWwgZGlhZ25vc3RpY3MuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzKCkpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBUeXBlU2NyaXB0IHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0VHNPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuXG4gICAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3MoYW5ndWxhclByb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZycsIGRpYWdNb2RlKSk7XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=