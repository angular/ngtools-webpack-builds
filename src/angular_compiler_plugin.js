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
            entryRoute = this.entryModule.path + '#' + this.entryModule.className;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW5ndWxhcl9jb21waWxlcl9wbHVnaW4uanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvYW5ndWxhcl9jb21waWxlcl9wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCwrQ0FROEI7QUFDOUIsb0RBQWdFO0FBQ2hFLHdEQWMrQjtBQUMvQixpREFBZ0U7QUFDaEUseUJBQXlCO0FBQ3pCLDZCQUE2QjtBQUM3QixpQ0FBaUM7QUFFakMsMkNBQTRDO0FBQzVDLG1EQUF5RTtBQUN6RSxxREFBOEQ7QUFDOUQsNkRBQW9GO0FBQ3BGLGlEQUF1RDtBQUN2RCx1REFBMEQ7QUFDMUQsaURBVXdCO0FBQ3hCLDREQUE4RDtBQUM5RCxpREFFd0I7QUFDeEIsbUVBS2lDO0FBQ2pDLG1GQUd5QztBQU16Qyw2REFBd0Q7QUFFeEQsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBOEN0QyxJQUFZLFFBR1g7QUFIRCxXQUFZLFFBQVE7SUFDbEIsNkNBQU8sQ0FBQTtJQUNQLDJDQUFNLENBQUE7QUFDUixDQUFDLEVBSFcsUUFBUSxHQUFSLGdCQUFRLEtBQVIsZ0JBQVEsUUFHbkI7QUFFRCxNQUFhLHFCQUFxQjtJQXVDaEMsWUFBWSxPQUFxQztRQTdCakQsOERBQThEO1FBQ3RELGdCQUFXLEdBQWlCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7UUFLaEQsa0JBQWEsR0FBMkMsRUFBRSxDQUFDO1FBQzNELDBCQUFxQixHQUFrRCxJQUFJLENBQUM7UUFFNUUsYUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixpQkFBWSxHQUFHLElBQUksQ0FBQztRQUNwQiwyQkFBc0IsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FB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QU8sQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUV4QyxJQUFJLFNBQVMsQ0FBQztZQUNkLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDakUsS0FBSyxNQUFNLENBQUMsSUFBSSxPQUFPLEVBQUU7Z0JBQ3ZCLElBQUksQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLGdCQUFnQixFQUFFO29CQUN4QyxTQUFTLEdBQUcsQ0FBQyxDQUFDO29CQUNkLE1BQU07aUJBQ1A7YUFDRjtZQUVELElBQUksU0FBUyxFQUFFO2dCQUNiLE1BQU0sR0FBRyxTQUFTLENBQUM7YUFDcEI7aUJBQU07Z0JBQ0wsNEJBQTRCO2dCQUM1QixNQUFNLFlBQVksR0FBRyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3BELElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRTtvQkFDeEMsTUFBTSxHQUFHLFlBQVksQ0FBQztpQkFDdkI7cUJBQU07b0JBQ0wsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsNkRBQTZEO3dCQUMvRSw0QkFBNEIsTUFBTSxLQUFLO3dCQUN2QyxzQkFBc0IsTUFBTTtrRUFDMEIsQ0FBQyxDQUFDO29CQUUxRCxPQUFPLElBQUksQ0FBQztpQkFDYjthQUNGO1NBQ0Y7UUFFRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0NBQ0Y7QUFsa0NELHNEQWtrQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQge1xuICBQYXRoLFxuICBkaXJuYW1lLFxuICBnZXRTeXN0ZW1QYXRoLFxuICBsb2dnaW5nLFxuICBub3JtYWxpemUsXG4gIHJlc29sdmUsXG4gIHZpcnR1YWxGcyxcbn0gZnJvbSAnQGFuZ3VsYXItZGV2a2l0L2NvcmUnO1xuaW1wb3J0IHsgY3JlYXRlQ29uc29sZUxvZ2dlciB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlL25vZGUnO1xuaW1wb3J0IHtcbiAgQ29tcGlsZXJIb3N0LFxuICBDb21waWxlck9wdGlvbnMsXG4gIERFRkFVTFRfRVJST1JfQ09ERSxcbiAgRGlhZ25vc3RpYyxcbiAgRW1pdEZsYWdzLFxuICBQcm9ncmFtLFxuICBTT1VSQ0UsXG4gIFVOS05PV05fRVJST1JfQ09ERSxcbiAgVkVSU0lPTixcbiAgY3JlYXRlQ29tcGlsZXJIb3N0LFxuICBjcmVhdGVQcm9ncmFtLFxuICBmb3JtYXREaWFnbm9zdGljcyxcbiAgcmVhZENvbmZpZ3VyYXRpb24sXG59IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBDaGlsZFByb2Nlc3MsIEZvcmtPcHRpb25zLCBmb3JrIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBDb21waWxlciwgY29tcGlsYXRpb24gfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IHRpbWUsIHRpbWVFbmQgfSBmcm9tICcuL2JlbmNobWFyayc7XG5pbXBvcnQgeyBXZWJwYWNrQ29tcGlsZXJIb3N0LCB3b3JrYXJvdW5kUmVzb2x2ZSB9IGZyb20gJy4vY29tcGlsZXJfaG9zdCc7XG5pbXBvcnQgeyByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbiB9IGZyb20gJy4vZW50cnlfcmVzb2x2ZXInO1xuaW1wb3J0IHsgRGlhZ25vc3RpY01vZGUsIGdhdGhlckRpYWdub3N0aWNzLCBoYXNFcnJvcnMgfSBmcm9tICcuL2dhdGhlcl9kaWFnbm9zdGljcyc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQge1xuICBMYXp5Um91dGVNYXAsXG4gIGV4cG9ydExhenlNb2R1bGVNYXAsXG4gIGV4cG9ydE5nRmFjdG9yeSxcbiAgZmluZFJlc291cmNlcyxcbiAgcmVnaXN0ZXJMb2NhbGVEYXRhLFxuICByZW1vdmVEZWNvcmF0b3JzLFxuICByZXBsYWNlQm9vdHN0cmFwLFxuICByZXBsYWNlUmVzb3VyY2VzLFxuICByZXBsYWNlU2VydmVyQm9vdHN0cmFwLFxufSBmcm9tICcuL3RyYW5zZm9ybWVycyc7XG5pbXBvcnQgeyBjb2xsZWN0RGVlcE5vZGVzIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvYXN0X2hlbHBlcnMnO1xuaW1wb3J0IHtcbiAgQVVUT19TVEFSVF9BUkcsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyJztcbmltcG9ydCB7XG4gIEluaXRNZXNzYWdlLFxuICBMb2dNZXNzYWdlLFxuICBNRVNTQUdFX0tJTkQsXG4gIFVwZGF0ZU1lc3NhZ2UsXG59IGZyb20gJy4vdHlwZV9jaGVja2VyX21lc3NhZ2VzJztcbmltcG9ydCB7XG4gIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLFxuICBWaXJ0dWFsV2F0Y2hGaWxlU3lzdGVtRGVjb3JhdG9yLFxufSBmcm9tICcuL3ZpcnR1YWxfZmlsZV9zeXN0ZW1fZGVjb3JhdG9yJztcbmltcG9ydCB7XG4gIENhbGxiYWNrLFxuICBOb2RlV2F0Y2hGaWxlU3lzdGVtSW50ZXJmYWNlLFxuICBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCxcbn0gZnJvbSAnLi93ZWJwYWNrJztcbmltcG9ydCB7IFdlYnBhY2tJbnB1dEhvc3QgfSBmcm9tICcuL3dlYnBhY2staW5wdXQtaG9zdCc7XG5cbmNvbnN0IHRyZWVLaWxsID0gcmVxdWlyZSgndHJlZS1raWxsJyk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5IHsgfVxuXG5leHBvcnQgaW50ZXJmYWNlIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yIHtcbiAgbmV3KG1vZHVsZVBhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nKTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5O1xufVxuXG4vKipcbiAqIE9wdGlvbiBDb25zdGFudHNcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zIHtcbiAgc291cmNlTWFwPzogYm9vbGVhbjtcbiAgdHNDb25maWdQYXRoOiBzdHJpbmc7XG4gIGJhc2VQYXRoPzogc3RyaW5nO1xuICBlbnRyeU1vZHVsZT86IHN0cmluZztcbiAgbWFpblBhdGg/OiBzdHJpbmc7XG4gIHNraXBDb2RlR2VuZXJhdGlvbj86IGJvb2xlYW47XG4gIGhvc3RSZXBsYWNlbWVudFBhdGhzPzogeyBbcGF0aDogc3RyaW5nXTogc3RyaW5nIH0gfCAoKHBhdGg6IHN0cmluZykgPT4gc3RyaW5nKTtcbiAgZm9ya1R5cGVDaGVja2VyPzogYm9vbGVhbjtcbiAgaTE4bkluRmlsZT86IHN0cmluZztcbiAgaTE4bkluRm9ybWF0Pzogc3RyaW5nO1xuICBpMThuT3V0RmlsZT86IHN0cmluZztcbiAgaTE4bk91dEZvcm1hdD86IHN0cmluZztcbiAgbG9jYWxlPzogc3RyaW5nO1xuICBtaXNzaW5nVHJhbnNsYXRpb24/OiBzdHJpbmc7XG4gIHBsYXRmb3JtPzogUExBVEZPUk07XG4gIG5hbWVMYXp5RmlsZXM/OiBib29sZWFuO1xuICBsb2dnZXI/OiBsb2dnaW5nLkxvZ2dlcjtcbiAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nPzogYm9vbGVhbjtcblxuICAvLyBhZGRlZCB0byB0aGUgbGlzdCBvZiBsYXp5IHJvdXRlc1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZXM/OiB7IFttb2R1bGU6IHN0cmluZ106IHN0cmluZyB9O1xuICBhZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcz86IHN0cmluZ1tdO1xuXG4gIC8vIFRoZSBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgb2YgY29ycmVjdCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICAvLyBUaGlzIGlzIG5lZWRlZCB3aGVuIHRoZXJlIGFyZSBtdWx0aXBsZSBXZWJwYWNrIGluc3RhbGxzLlxuICBjb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcj86IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeUNvbnN0cnVjdG9yO1xuXG4gIC8vIFVzZSB0c2NvbmZpZyB0byBpbmNsdWRlIHBhdGggZ2xvYnMuXG4gIGNvbXBpbGVyT3B0aW9ucz86IHRzLkNvbXBpbGVyT3B0aW9ucztcblxuICBob3N0PzogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+O1xuICBwbGF0Zm9ybVRyYW5zZm9ybWVycz86IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPltdO1xufVxuXG5leHBvcnQgZW51bSBQTEFURk9STSB7XG4gIEJyb3dzZXIsXG4gIFNlcnZlcixcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJDb21waWxlclBsdWdpbiB7XG4gIHByaXZhdGUgX29wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnM7XG5cbiAgLy8gVFMgY29tcGlsYXRpb24uXG4gIHByaXZhdGUgX2NvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zO1xuICBwcml2YXRlIF9yb290TmFtZXM6IHN0cmluZ1tdO1xuICBwcml2YXRlIF9wcm9ncmFtOiAodHMuUHJvZ3JhbSB8IFByb2dyYW0pIHwgbnVsbDtcbiAgcHJpdmF0ZSBfY29tcGlsZXJIb3N0OiBXZWJwYWNrQ29tcGlsZXJIb3N0ICYgQ29tcGlsZXJIb3N0O1xuICBwcml2YXRlIF9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU6IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZTtcbiAgcHJpdmF0ZSBfcmVzb3VyY2VMb2FkZXI/OiBXZWJwYWNrUmVzb3VyY2VMb2FkZXI7XG4gIC8vIENvbnRhaW5zIGBtb2R1bGVJbXBvcnRQYXRoI2V4cG9ydE5hbWVgID0+IGBmdWxsTW9kdWxlUGF0aGAuXG4gIHByaXZhdGUgX2xhenlSb3V0ZXM6IExhenlSb3V0ZU1hcCA9IE9iamVjdC5jcmVhdGUobnVsbCk7XG4gIHByaXZhdGUgX3RzQ29uZmlnUGF0aDogc3RyaW5nO1xuICBwcml2YXRlIF9lbnRyeU1vZHVsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfbWFpblBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBfYmFzZVBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBfdHJhbnNmb3JtZXJzOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT5bXSA9IFtdO1xuICBwcml2YXRlIF9wbGF0Zm9ybVRyYW5zZm9ybWVyczogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+W10gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBfcGxhdGZvcm06IFBMQVRGT1JNO1xuICBwcml2YXRlIF9KaXRNb2RlID0gZmFsc2U7XG4gIHByaXZhdGUgX2VtaXRTa2lwcGVkID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfY2hhbmdlZEZpbGVFeHRlbnNpb25zID0gbmV3IFNldChbJ3RzJywgJ3RzeCcsICdodG1sJywgJ2NzcycsICdqcycsICdqc29uJ10pO1xuXG4gIC8vIFdlYnBhY2sgcGx1Z2luLlxuICBwcml2YXRlIF9maXJzdFJ1biA9IHRydWU7XG4gIHByaXZhdGUgX2RvbmVQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbDtcbiAgcHJpdmF0ZSBfbm9ybWFsaXplZExvY2FsZTogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBfd2FybmluZ3M6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9lcnJvcnM6IChzdHJpbmcgfCBFcnJvcilbXSA9IFtdO1xuICBwcml2YXRlIF9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvcjogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3I7XG5cbiAgLy8gVHlwZUNoZWNrZXIgcHJvY2Vzcy5cbiAgcHJpdmF0ZSBfZm9ya1R5cGVDaGVja2VyID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfdHlwZUNoZWNrZXJQcm9jZXNzOiBDaGlsZFByb2Nlc3MgfCBudWxsO1xuICBwcml2YXRlIF9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gZmFsc2U7XG5cbiAgLy8gTG9nZ2luZy5cbiAgcHJpdmF0ZSBfbG9nZ2VyOiBsb2dnaW5nLkxvZ2dlcjtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBBbmd1bGFyQ29tcGlsZXJQbHVnaW5PcHRpb25zKSB7XG4gICAgdGhpcy5fb3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe30sIG9wdGlvbnMpO1xuICAgIHRoaXMuX3NldHVwT3B0aW9ucyh0aGlzLl9vcHRpb25zKTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCkgeyByZXR1cm4gdGhpcy5fb3B0aW9uczsgfVxuICBnZXQgZG9uZSgpIHsgcmV0dXJuIHRoaXMuX2RvbmVQcm9taXNlOyB9XG4gIGdldCBlbnRyeU1vZHVsZSgpIHtcbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgY29uc3Qgc3BsaXR0ZWQgPSB0aGlzLl9lbnRyeU1vZHVsZS5zcGxpdCgvKCNbYS16QS1aX10oW1xcd10rKSkkLyk7XG4gICAgY29uc3QgcGF0aCA9IHNwbGl0dGVkWzBdO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9ICEhc3BsaXR0ZWRbMV0gPyBzcGxpdHRlZFsxXS5zdWJzdHJpbmcoMSkgOiAnZGVmYXVsdCc7XG5cbiAgICByZXR1cm4geyBwYXRoLCBjbGFzc05hbWUgfTtcbiAgfVxuXG4gIGdldCB0eXBlQ2hlY2tlcigpOiB0cy5UeXBlQ2hlY2tlciB8IG51bGwge1xuICAgIGNvbnN0IHRzUHJvZ3JhbSA9IHRoaXMuX2dldFRzUHJvZ3JhbSgpO1xuXG4gICAgcmV0dXJuIHRzUHJvZ3JhbSA/IHRzUHJvZ3JhbS5nZXRUeXBlQ2hlY2tlcigpIDogbnVsbDtcbiAgfVxuXG4gIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHtcbiAgICByZXR1cm4gVkVSU0lPTiAmJiBwYXJzZUludChWRVJTSU9OLm1ham9yKSA+PSA1O1xuICB9XG5cbiAgcHJpdmF0ZSBfc2V0dXBPcHRpb25zKG9wdGlvbnM6IEFuZ3VsYXJDb21waWxlclBsdWdpbk9wdGlvbnMpIHtcbiAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3NldHVwT3B0aW9ucycpO1xuICAgIHRoaXMuX2xvZ2dlciA9IG9wdGlvbnMubG9nZ2VyIHx8IGNyZWF0ZUNvbnNvbGVMb2dnZXIoKTtcblxuICAgIC8vIEZpbGwgaW4gdGhlIG1pc3Npbmcgb3B0aW9ucy5cbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ3RzQ29uZmlnUGF0aCcpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ011c3Qgc3BlY2lmeSBcInRzQ29uZmlnUGF0aFwiIGluIHRoZSBjb25maWd1cmF0aW9uIG9mIEBuZ3Rvb2xzL3dlYnBhY2suJyk7XG4gICAgfVxuICAgIC8vIFRTIHJlcHJlc2VudHMgcGF0aHMgaW50ZXJuYWxseSB3aXRoICcvJyBhbmQgZXhwZWN0cyB0aGUgdHNjb25maWcgcGF0aCB0byBiZSBpbiB0aGlzIGZvcm1hdFxuICAgIHRoaXMuX3RzQ29uZmlnUGF0aCA9IG9wdGlvbnMudHNDb25maWdQYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcblxuICAgIC8vIENoZWNrIHRoZSBiYXNlIHBhdGguXG4gICAgY29uc3QgbWF5YmVCYXNlUGF0aCA9IHBhdGgucmVzb2x2ZShwcm9jZXNzLmN3ZCgpLCB0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGxldCBiYXNlUGF0aCA9IG1heWJlQmFzZVBhdGg7XG4gICAgaWYgKGZzLnN0YXRTeW5jKG1heWJlQmFzZVBhdGgpLmlzRmlsZSgpKSB7XG4gICAgICBiYXNlUGF0aCA9IHBhdGguZGlybmFtZShiYXNlUGF0aCk7XG4gICAgfVxuICAgIGlmIChvcHRpb25zLmJhc2VQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGJhc2VQYXRoID0gcGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMuYmFzZVBhdGgpO1xuICAgIH1cblxuICAgIC8vIFBhcnNlIHRoZSB0c2NvbmZpZyBjb250ZW50cy5cbiAgICBjb25zdCBjb25maWcgPSByZWFkQ29uZmlndXJhdGlvbih0aGlzLl90c0NvbmZpZ1BhdGgpO1xuICAgIGlmIChjb25maWcuZXJyb3JzICYmIGNvbmZpZy5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZm9ybWF0RGlhZ25vc3RpY3MoY29uZmlnLmVycm9ycykpO1xuICAgIH1cblxuICAgIHRoaXMuX3Jvb3ROYW1lcyA9IGNvbmZpZy5yb290TmFtZXM7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zID0geyAuLi5jb25maWcub3B0aW9ucywgLi4ub3B0aW9ucy5jb21waWxlck9wdGlvbnMgfTtcbiAgICB0aGlzLl9iYXNlUGF0aCA9IGNvbmZpZy5vcHRpb25zLmJhc2VQYXRoIHx8IGJhc2VQYXRoIHx8ICcnO1xuXG4gICAgLy8gT3ZlcndyaXRlIG91dERpciBzbyB3ZSBjYW4gZmluZCBnZW5lcmF0ZWQgZmlsZXMgbmV4dCB0byB0aGVpciAudHMgb3JpZ2luIGluIGNvbXBpbGVySG9zdC5cbiAgICB0aGlzLl9jb21waWxlck9wdGlvbnMub3V0RGlyID0gJyc7XG4gICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcblxuICAgIC8vIERlZmF1bHQgcGx1Z2luIHNvdXJjZU1hcCB0byBjb21waWxlciBvcHRpb25zIHNldHRpbmcuXG4gICAgaWYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdzb3VyY2VNYXAnKSkge1xuICAgICAgb3B0aW9ucy5zb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlTWFwIHx8IGZhbHNlO1xuICAgIH1cblxuICAgIC8vIEZvcmNlIHRoZSByaWdodCBzb3VyY2VtYXAgb3B0aW9ucy5cbiAgICBpZiAob3B0aW9ucy5zb3VyY2VNYXApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB0cnVlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICAvLyBXZSB3aWxsIHNldCB0aGUgc291cmNlIHRvIHRoZSBmdWxsIHBhdGggb2YgdGhlIGZpbGUgaW4gdGhlIGxvYWRlciwgc28gd2UgZG9uJ3RcbiAgICAgIC8vIG5lZWQgc291cmNlUm9vdCBoZXJlLlxuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXAgPSBmYWxzZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gdW5kZWZpbmVkO1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICAvLyBXZSB3YW50IHRvIGFsbG93IGVtaXR0aW5nIHdpdGggZXJyb3JzIHNvIHRoYXQgaW1wb3J0cyBjYW4gYmUgYWRkZWRcbiAgICAvLyB0byB0aGUgd2VicGFjayBkZXBlbmRlbmN5IHRyZWUgYW5kIHJlYnVpbGRzIHRyaWdnZXJlZCBieSBmaWxlIGVkaXRzLlxuICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG5cbiAgICAvLyBTZXQgSklUIChubyBjb2RlIGdlbmVyYXRpb24pIG9yIEFPVCBtb2RlLlxuICAgIGlmIChvcHRpb25zLnNraXBDb2RlR2VuZXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9KaXRNb2RlID0gb3B0aW9ucy5za2lwQ29kZUdlbmVyYXRpb247XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBpMThuIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRmlsZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bkluRmlsZSA9IG9wdGlvbnMuaTE4bkluRmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bkluRm9ybWF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Gb3JtYXQgPSBvcHRpb25zLmkxOG5JbkZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZpbGUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlID0gb3B0aW9ucy5pMThuT3V0RmlsZTtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMuaTE4bk91dEZvcm1hdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZvcm1hdCA9IG9wdGlvbnMuaTE4bk91dEZvcm1hdDtcbiAgICB9XG4gICAgaWYgKG9wdGlvbnMubG9jYWxlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuSW5Mb2NhbGUgPSBvcHRpb25zLmxvY2FsZTtcbiAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0TG9jYWxlID0gb3B0aW9ucy5sb2NhbGU7XG4gICAgICB0aGlzLl9ub3JtYWxpemVkTG9jYWxlID0gdGhpcy5fdmFsaWRhdGVMb2NhbGUob3B0aW9ucy5sb2NhbGUpO1xuICAgIH1cbiAgICBpZiAob3B0aW9ucy5taXNzaW5nVHJhbnNsYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5Jbk1pc3NpbmdUcmFuc2xhdGlvbnMgPVxuICAgICAgICBvcHRpb25zLm1pc3NpbmdUcmFuc2xhdGlvbiBhcyAnZXJyb3InIHwgJ3dhcm5pbmcnIHwgJ2lnbm9yZSc7XG4gICAgfVxuXG4gICAgLy8gUHJvY2VzcyBmb3JrZWQgdHlwZSBjaGVja2VyIG9wdGlvbnMuXG4gICAgaWYgKG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX2ZvcmtUeXBlQ2hlY2tlciA9IG9wdGlvbnMuZm9ya1R5cGVDaGVja2VyO1xuICAgIH1cbiAgICAvLyB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcblxuICAgIC8vIEFkZCBjdXN0b20gcGxhdGZvcm0gdHJhbnNmb3JtZXJzLlxuICAgIGlmIChvcHRpb25zLnBsYXRmb3JtVHJhbnNmb3JtZXJzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzID0gb3B0aW9ucy5wbGF0Zm9ybVRyYW5zZm9ybWVycztcbiAgICB9XG5cbiAgICAvLyBEZWZhdWx0IENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSB0byB0aGUgb25lIHdlIGNhbiBpbXBvcnQgZnJvbSBoZXJlLlxuICAgIC8vIEZhaWxpbmcgdG8gdXNlIHRoZSByaWdodCBDb250ZXh0RWxlbWVudERlcGVuZGVuY3kgd2lsbCB0aHJvdyB0aGUgZXJyb3IgYmVsb3c6XG4gICAgLy8gXCJObyBtb2R1bGUgZmFjdG9yeSBhdmFpbGFibGUgZm9yIGRlcGVuZGVuY3kgdHlwZTogQ29udGV4dEVsZW1lbnREZXBlbmRlbmN5XCJcbiAgICAvLyBIb2lzdGluZyB0b2dldGhlciB3aXRoIHBlZXIgZGVwZW5kZW5jaWVzIGNhbiBtYWtlIGl0IHNvIHRoZSBpbXBvcnRlZFxuICAgIC8vIENvbnRleHRFbGVtZW50RGVwZW5kZW5jeSBkb2VzIG5vdCBjb21lIGZyb20gdGhlIHNhbWUgV2VicGFjayBpbnN0YW5jZSB0aGF0IGlzIHVzZWRcbiAgICAvLyBpbiB0aGUgY29tcGlsYXRpb24uIEluIHRoYXQgY2FzZSwgd2UgY2FuIHBhc3MgdGhlIHJpZ2h0IG9uZSBhcyBhbiBvcHRpb24gdG8gdGhlIHBsdWdpbi5cbiAgICB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3RvciA9IG9wdGlvbnMuY29udGV4dEVsZW1lbnREZXBlbmRlbmN5Q29uc3RydWN0b3JcbiAgICAgIHx8IHJlcXVpcmUoJ3dlYnBhY2svbGliL2RlcGVuZGVuY2llcy9Db250ZXh0RWxlbWVudERlcGVuZGVuY3knKTtcblxuICAgIC8vIFVzZSBlbnRyeU1vZHVsZSBpZiBhdmFpbGFibGUgaW4gb3B0aW9ucywgb3RoZXJ3aXNlIHJlc29sdmUgaXQgZnJvbSBtYWluUGF0aCBhZnRlciBwcm9ncmFtXG4gICAgLy8gY3JlYXRpb24uXG4gICAgaWYgKHRoaXMuX29wdGlvbnMuZW50cnlNb2R1bGUpIHtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gdGhpcy5fb3B0aW9ucy5lbnRyeU1vZHVsZTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSkge1xuICAgICAgdGhpcy5fZW50cnlNb2R1bGUgPSBwYXRoLnJlc29sdmUodGhpcy5fYmFzZVBhdGgsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5lbnRyeU1vZHVsZSBhcyBzdHJpbmcpOyAvLyB0ZW1wb3JhcnkgY2FzdCBmb3IgdHlwZSBpc3N1ZVxuICAgIH1cblxuICAgIC8vIFNldCBwbGF0Zm9ybS5cbiAgICB0aGlzLl9wbGF0Zm9ybSA9IG9wdGlvbnMucGxhdGZvcm0gfHwgUExBVEZPUk0uQnJvd3NlcjtcblxuICAgIC8vIE1ha2UgdHJhbnNmb3JtZXJzLlxuICAgIHRoaXMuX21ha2VUcmFuc2Zvcm1lcnMoKTtcblxuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fc2V0dXBPcHRpb25zJyk7XG4gIH1cblxuICBwcml2YXRlIF9nZXRUc1Byb2dyYW0oKSB7XG4gICAgaWYgKCF0aGlzLl9wcm9ncmFtKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9KaXRNb2RlID8gdGhpcy5fcHJvZ3JhbSBhcyB0cy5Qcm9ncmFtIDogKHRoaXMuX3Byb2dyYW0gYXMgUHJvZ3JhbSkuZ2V0VHNQcm9ncmFtKCk7XG4gIH1cblxuICB1cGRhdGVDaGFuZ2VkRmlsZUV4dGVuc2lvbnMoZXh0ZW5zaW9uOiBzdHJpbmcpIHtcbiAgICBpZiAoZXh0ZW5zaW9uKSB7XG4gICAgICB0aGlzLl9jaGFuZ2VkRmlsZUV4dGVuc2lvbnMuYWRkKGV4dGVuc2lvbik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfZ2V0Q2hhbmdlZENvbXBpbGF0aW9uRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGVySG9zdC5nZXRDaGFuZ2VkRmlsZVBhdGhzKClcbiAgICAgIC5maWx0ZXIoayA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgZXh0IG9mIHRoaXMuX2NoYW5nZWRGaWxlRXh0ZW5zaW9ucykge1xuICAgICAgICAgIGlmIChrLmVuZHNXaXRoKGV4dCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCkge1xuICAgIC8vIEdldCB0aGUgcm9vdCBmaWxlcyBmcm9tIHRoZSB0cyBjb25maWcuXG4gICAgLy8gV2hlbiBhIG5ldyByb290IG5hbWUgKGxpa2UgYSBsYXp5IHJvdXRlKSBpcyBhZGRlZCwgaXQgd29uJ3QgYmUgYXZhaWxhYmxlIGZyb21cbiAgICAvLyBmb2xsb3dpbmcgaW1wb3J0cyBvbiB0aGUgZXhpc3RpbmcgZmlsZXMsIHNvIHdlIG5lZWQgdG8gZ2V0IHRoZSBuZXcgbGlzdCBvZiByb290IGZpbGVzLlxuICAgIGNvbnN0IGNvbmZpZyA9IHJlYWRDb25maWd1cmF0aW9uKHRoaXMuX3RzQ29uZmlnUGF0aCk7XG4gICAgdGhpcy5fcm9vdE5hbWVzID0gY29uZmlnLnJvb3ROYW1lcztcblxuICAgIC8vIFVwZGF0ZSB0aGUgZm9ya2VkIHR5cGUgY2hlY2tlciB3aXRoIGFsbCBjaGFuZ2VkIGNvbXBpbGF0aW9uIGZpbGVzLlxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGVtcGxhdGVzLCB0aGF0IGFsc28gbmVlZCB0byBiZSByZWxvYWRlZCBvbiB0aGUgdHlwZSBjaGVja2VyLlxuICAgIGlmICh0aGlzLl9mb3JrVHlwZUNoZWNrZXIgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgdGhpcy5fdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIodGhpcy5fcm9vdE5hbWVzLCB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpKTtcbiAgICB9XG5cbiAgICAvLyBVc2UgYW4gaWRlbnRpdHkgZnVuY3Rpb24gYXMgYWxsIG91ciBwYXRocyBhcmUgYWJzb2x1dGUgYWxyZWFkeS5cbiAgICB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUodGhpcy5fYmFzZVBhdGgsIHggPT4geCk7XG5cbiAgICBjb25zdCB0c1Byb2dyYW0gPSB0aGlzLl9nZXRUc1Byb2dyYW0oKTtcbiAgICBjb25zdCBvbGRGaWxlcyA9IG5ldyBTZXQodHNQcm9ncmFtID9cbiAgICAgIHRzUHJvZ3JhbS5nZXRTb3VyY2VGaWxlcygpLm1hcChzZiA9PiBzZi5maWxlTmFtZSlcbiAgICAgIDogW10sXG4gICAgKTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAvLyBDcmVhdGUgdGhlIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLnRzLmNyZWF0ZVByb2dyYW0nKTtcbiAgICAgIHRoaXMuX3Byb2dyYW0gPSB0cy5jcmVhdGVQcm9ncmFtKFxuICAgICAgICB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICB0c1Byb2dyYW0sXG4gICAgICApO1xuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0udHMuY3JlYXRlUHJvZ3JhbScpO1xuXG4gICAgICBjb25zdCBuZXdGaWxlcyA9IHRoaXMuX3Byb2dyYW0uZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2NyZWF0ZU9yVXBkYXRlUHJvZ3JhbS5uZy5jcmVhdGVQcm9ncmFtJyk7XG4gICAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgcHJvZ3JhbS5cbiAgICAgIHRoaXMuX3Byb2dyYW0gPSBjcmVhdGVQcm9ncmFtKHtcbiAgICAgICAgcm9vdE5hbWVzOiB0aGlzLl9yb290TmFtZXMsXG4gICAgICAgIG9wdGlvbnM6IHRoaXMuX2NvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdDogdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgICBvbGRQcm9ncmFtOiB0aGlzLl9wcm9ncmFtIGFzIFByb2dyYW0sXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmNyZWF0ZVByb2dyYW0nKTtcblxuICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9jcmVhdGVPclVwZGF0ZVByb2dyYW0ubmcubG9hZE5nU3RydWN0dXJlQXN5bmMnKTtcbiAgICAgIGF3YWl0IHRoaXMuX3Byb2dyYW0ubG9hZE5nU3RydWN0dXJlQXN5bmMoKTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtLm5nLmxvYWROZ1N0cnVjdHVyZUFzeW5jJyk7XG5cbiAgICAgIGNvbnN0IG5ld0ZpbGVzID0gdGhpcy5fcHJvZ3JhbS5nZXRUc1Byb2dyYW0oKVxuICAgICAgICAuZ2V0U291cmNlRmlsZXMoKS5maWx0ZXIoc2YgPT4gIW9sZEZpbGVzLmhhcyhzZi5maWxlTmFtZSkpO1xuICAgICAgZm9yIChjb25zdCBuZXdGaWxlIG9mIG5ld0ZpbGVzKSB7XG4gICAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5pbnZhbGlkYXRlKG5ld0ZpbGUuZmlsZU5hbWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHRoZXJlJ3Mgc3RpbGwgbm8gZW50cnlNb2R1bGUgdHJ5IHRvIHJlc29sdmUgZnJvbSBtYWluUGF0aC5cbiAgICBpZiAoIXRoaXMuX2VudHJ5TW9kdWxlICYmIHRoaXMuX21haW5QYXRoICYmICF0aGlzLl9jb21waWxlck9wdGlvbnMuZW5hYmxlSXZ5KSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX21ha2UucmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4nKTtcbiAgICAgIHRoaXMuX2VudHJ5TW9kdWxlID0gcmVzb2x2ZUVudHJ5TW9kdWxlRnJvbU1haW4oXG4gICAgICAgIHRoaXMuX21haW5QYXRoLCB0aGlzLl9jb21waWxlckhvc3QsIHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pO1xuXG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaCgnTGF6eSByb3V0ZXMgZGlzY292ZXJ5IGlzIG5vdCBlbmFibGVkLiAnXG4gICAgICAgICAgKyAnQmVjYXVzZSB0aGVyZSBpcyBuZWl0aGVyIGFuIGVudHJ5TW9kdWxlIG5vciBhICdcbiAgICAgICAgICArICdzdGF0aWNhbGx5IGFuYWx5emFibGUgYm9vdHN0cmFwIGNvZGUgaW4gdGhlIG1haW4gZmlsZS4nLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlLnJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluJyk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbSgpOiBMYXp5Um91dGVNYXAge1xuICAgIGxldCBlbnRyeVJvdXRlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IG5nUHJvZ3JhbTogUHJvZ3JhbTtcblxuICAgIGlmICh0aGlzLl9KaXRNb2RlKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cnlNb2R1bGUpIHtcbiAgICAgICAgcmV0dXJuIHt9O1xuICAgICAgfVxuXG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0uY3JlYXRlUHJvZ3JhbScpO1xuICAgICAgbmdQcm9ncmFtID0gY3JlYXRlUHJvZ3JhbSh7XG4gICAgICAgIHJvb3ROYW1lczogdGhpcy5fcm9vdE5hbWVzLFxuICAgICAgICBvcHRpb25zOiB7IC4uLnRoaXMuX2NvbXBpbGVyT3B0aW9ucywgZ2VuRGlyOiAnJywgY29sbGVjdEFsbEVycm9yczogdHJ1ZSB9LFxuICAgICAgICBob3N0OiB0aGlzLl9jb21waWxlckhvc3QsXG4gICAgICB9KTtcbiAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbS5jcmVhdGVQcm9ncmFtJyk7XG5cbiAgICAgIGVudHJ5Um91dGUgPSB0aGlzLmVudHJ5TW9kdWxlLnBhdGggKyAnIycgKyB0aGlzLmVudHJ5TW9kdWxlLmNsYXNzTmFtZTtcbiAgICB9IGVsc2Uge1xuICAgICAgbmdQcm9ncmFtID0gdGhpcy5fcHJvZ3JhbSBhcyBQcm9ncmFtO1xuICAgIH1cblxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fbGlzdExhenlSb3V0ZXNGcm9tUHJvZ3JhbS5saXN0TGF6eVJvdXRlcycpO1xuICAgIC8vIGVudHJ5Um91dGUgd2lsbCBvbmx5IGJlIGRlZmluZWQgaW4gSklULlxuICAgIC8vIEluIEFPVCBhbGwgcm91dGVzIHdpdGhpbiB0aGUgcHJvZ3JhbSBhcmUgcmV0dXJuZWQuXG4gICAgY29uc3QgbGF6eVJvdXRlcyA9IG5nUHJvZ3JhbS5saXN0TGF6eVJvdXRlcyhlbnRyeVJvdXRlKTtcbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2xpc3RMYXp5Um91dGVzRnJvbVByb2dyYW0ubGlzdExhenlSb3V0ZXMnKTtcblxuICAgIHJldHVybiBsYXp5Um91dGVzLnJlZHVjZShcbiAgICAgIChhY2MsIGN1cnIpID0+IHtcbiAgICAgICAgY29uc3QgcmVmID0gY3Vyci5yb3V0ZTtcbiAgICAgICAgaWYgKHJlZiBpbiBhY2MgJiYgYWNjW3JlZl0gIT09IGN1cnIucmVmZXJlbmNlZE1vZHVsZS5maWxlUGF0aCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICsgYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQ6IFwiJHtyZWZ9XCIgaXMgdXNlZCBpbiAyIGxvYWRDaGlsZHJlbiwgYFxuICAgICAgICAgICAgKyBgYnV0IHRoZXkgcG9pbnQgdG8gZGlmZmVyZW50IG1vZHVsZXMgXCIoJHthY2NbcmVmXX0gYW5kIGBcbiAgICAgICAgICAgICsgYFwiJHtjdXJyLnJlZmVyZW5jZWRNb2R1bGUuZmlsZVBhdGh9XCIpLiBXZWJwYWNrIGNhbm5vdCBkaXN0aW5ndWlzaCBvbiBjb250ZXh0IGFuZCBgXG4gICAgICAgICAgICArICd3b3VsZCBmYWlsIHRvIGxvYWQgdGhlIHByb3BlciBvbmUuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGFjY1tyZWZdID0gY3Vyci5yZWZlcmVuY2VkTW9kdWxlLmZpbGVQYXRoO1xuXG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LFxuICAgICAge30gYXMgTGF6eVJvdXRlTWFwLFxuICAgICk7XG4gIH1cblxuICAvLyBQcm9jZXNzIHRoZSBsYXp5IHJvdXRlcyBkaXNjb3ZlcmVkLCBhZGRpbmcgdGhlbiB0byBfbGF6eVJvdXRlcy5cbiAgLy8gVE9ETzogZmluZCBhIHdheSB0byByZW1vdmUgbGF6eSByb3V0ZXMgdGhhdCBkb24ndCBleGlzdCBhbnltb3JlLlxuICAvLyBUaGlzIHdpbGwgcmVxdWlyZSBhIHJlZ2lzdHJ5IG9mIGtub3duIHJlZmVyZW5jZXMgdG8gYSBsYXp5IHJvdXRlLCByZW1vdmluZyBpdCB3aGVuIG5vXG4gIC8vIG1vZHVsZSByZWZlcmVuY2VzIGl0IGFueW1vcmUuXG4gIHByaXZhdGUgX3Byb2Nlc3NMYXp5Um91dGVzKGRpc2NvdmVyZWRMYXp5Um91dGVzOiBMYXp5Um91dGVNYXApIHtcbiAgICBPYmplY3Qua2V5cyhkaXNjb3ZlcmVkTGF6eVJvdXRlcylcbiAgICAgIC5mb3JFYWNoKGxhenlSb3V0ZUtleSA9PiB7XG4gICAgICAgIGNvbnN0IFtsYXp5Um91dGVNb2R1bGUsIG1vZHVsZU5hbWVdID0gbGF6eVJvdXRlS2V5LnNwbGl0KCcjJyk7XG5cbiAgICAgICAgaWYgKCFsYXp5Um91dGVNb2R1bGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsYXp5Um91dGVUU0ZpbGUgPSBkaXNjb3ZlcmVkTGF6eVJvdXRlc1tsYXp5Um91dGVLZXldLnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICAgICAgbGV0IG1vZHVsZVBhdGg6IHN0cmluZywgbW9kdWxlS2V5OiBzdHJpbmc7XG5cbiAgICAgICAgaWYgKHRoaXMuX0ppdE1vZGUpIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlO1xuICAgICAgICAgIG1vZHVsZUtleSA9IGAke2xhenlSb3V0ZU1vZHVsZX0ke21vZHVsZU5hbWUgPyAnIycgKyBtb2R1bGVOYW1lIDogJyd9YDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtb2R1bGVQYXRoID0gbGF6eVJvdXRlVFNGaWxlLnJlcGxhY2UoLyhcXC5kKT9cXC50c3g/JC8sICcnKTtcbiAgICAgICAgICBtb2R1bGVQYXRoICs9ICcubmdmYWN0b3J5LmpzJztcbiAgICAgICAgICBjb25zdCBmYWN0b3J5TW9kdWxlTmFtZSA9IG1vZHVsZU5hbWUgPyBgIyR7bW9kdWxlTmFtZX1OZ0ZhY3RvcnlgIDogJyc7XG4gICAgICAgICAgbW9kdWxlS2V5ID0gYCR7bGF6eVJvdXRlTW9kdWxlfS5uZ2ZhY3Rvcnkke2ZhY3RvcnlNb2R1bGVOYW1lfWA7XG4gICAgICAgIH1cblxuICAgICAgICBtb2R1bGVQYXRoID0gd29ya2Fyb3VuZFJlc29sdmUobW9kdWxlUGF0aCk7XG5cbiAgICAgICAgaWYgKG1vZHVsZUtleSBpbiB0aGlzLl9sYXp5Um91dGVzKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2xhenlSb3V0ZXNbbW9kdWxlS2V5XSAhPT0gbW9kdWxlUGF0aCkge1xuICAgICAgICAgICAgLy8gRm91bmQgYSBkdXBsaWNhdGUsIHRoaXMgaXMgYW4gZXJyb3IuXG4gICAgICAgICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKFxuICAgICAgICAgICAgICBuZXcgRXJyb3IoYER1cGxpY2F0ZWQgcGF0aCBpbiBsb2FkQ2hpbGRyZW4gZGV0ZWN0ZWQgZHVyaW5nIGEgcmVidWlsZC4gYFxuICAgICAgICAgICAgICAgICsgYFdlIHdpbGwgdGFrZSB0aGUgbGF0ZXN0IHZlcnNpb24gZGV0ZWN0ZWQgYW5kIG92ZXJyaWRlIGl0IHRvIHNhdmUgcmVidWlsZCB0aW1lLiBgXG4gICAgICAgICAgICAgICAgKyBgWW91IHNob3VsZCBwZXJmb3JtIGEgZnVsbCBidWlsZCB0byB2YWxpZGF0ZSB0aGF0IHlvdXIgcm91dGVzIGRvbid0IG92ZXJsYXAuYCksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGb3VuZCBhIG5ldyByb3V0ZSwgYWRkIGl0IHRvIHRoZSBtYXAuXG4gICAgICAgICAgdGhpcy5fbGF6eVJvdXRlc1ttb2R1bGVLZXldID0gbW9kdWxlUGF0aDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9jcmVhdGVGb3JrZWRUeXBlQ2hlY2tlcigpIHtcbiAgICAvLyBCb290c3RyYXAgdHlwZSBjaGVja2VyIGlzIHVzaW5nIGxvY2FsIENMSS5cbiAgICBjb25zdCBnOiBhbnkgPSB0eXBlb2YgZ2xvYmFsICE9PSAndW5kZWZpbmVkJyA/IGdsb2JhbCA6IHt9OyAgLy8gdHNsaW50OmRpc2FibGUtbGluZTpuby1hbnlcbiAgICBjb25zdCB0eXBlQ2hlY2tlckZpbGU6IHN0cmluZyA9IGdbJ19EZXZLaXRJc0xvY2FsJ11cbiAgICAgID8gJy4vdHlwZV9jaGVja2VyX2Jvb3RzdHJhcC5qcydcbiAgICAgIDogJy4vdHlwZV9jaGVja2VyX3dvcmtlci5qcyc7XG5cbiAgICBjb25zdCBkZWJ1Z0FyZ1JlZ2V4ID0gLy0taW5zcGVjdCg/Oi1icmt8LXBvcnQpP3wtLWRlYnVnKD86LWJya3wtcG9ydCkvO1xuXG4gICAgY29uc3QgZXhlY0FyZ3YgPSBwcm9jZXNzLmV4ZWNBcmd2LmZpbHRlcigoYXJnKSA9PiB7XG4gICAgICAvLyBSZW1vdmUgZGVidWcgYXJncy5cbiAgICAgIC8vIFdvcmthcm91bmQgZm9yIGh0dHBzOi8vZ2l0aHViLmNvbS9ub2RlanMvbm9kZS9pc3N1ZXMvOTQzNVxuICAgICAgcmV0dXJuICFkZWJ1Z0FyZ1JlZ2V4LnRlc3QoYXJnKTtcbiAgICB9KTtcbiAgICAvLyBTaWduYWwgdGhlIHByb2Nlc3MgdG8gc3RhcnQgbGlzdGVuaW5nIGZvciBtZXNzYWdlc1xuICAgIC8vIFNvbHZlcyBodHRwczovL2dpdGh1Yi5jb20vYW5ndWxhci9hbmd1bGFyLWNsaS9pc3N1ZXMvOTA3MVxuICAgIGNvbnN0IGZvcmtBcmdzID0gW0FVVE9fU1RBUlRfQVJHXTtcbiAgICBjb25zdCBmb3JrT3B0aW9uczogRm9ya09wdGlvbnMgPSB7IGV4ZWNBcmd2IH07XG5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgPSBmb3JrKFxuICAgICAgcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgdHlwZUNoZWNrZXJGaWxlKSxcbiAgICAgIGZvcmtBcmdzLFxuICAgICAgZm9ya09wdGlvbnMpO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIG1lc3NhZ2VzLlxuICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5vbignbWVzc2FnZScsIG1lc3NhZ2UgPT4ge1xuICAgICAgc3dpdGNoIChtZXNzYWdlLmtpbmQpIHtcbiAgICAgICAgY2FzZSBNRVNTQUdFX0tJTkQuTG9nOlxuICAgICAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBtZXNzYWdlIGFzIExvZ01lc3NhZ2U7XG4gICAgICAgICAgdGhpcy5fbG9nZ2VyLmxvZyhsb2dNZXNzYWdlLmxldmVsLCBgXFxuJHtsb2dNZXNzYWdlLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUeXBlQ2hlY2tlcjogVW5leHBlY3RlZCBtZXNzYWdlIHJlY2VpdmVkOiAke21lc3NhZ2V9LmApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGNoaWxkIHByb2Nlc3MgZXhpdC5cbiAgICB0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3Mub25jZSgnZXhpdCcsIChfLCBzaWduYWwpID0+IHtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG5cbiAgICAgIC8vIElmIHByb2Nlc3MgZXhpdGVkIG5vdCBiZWNhdXNlIG9mIFNJR1RFUk0gKHNlZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKSwgdGhhbiBzb21ldGhpbmdcbiAgICAgIC8vIHdlbnQgd3JvbmcgYW5kIGl0IHNob3VsZCBmYWxsYmFjayB0byB0eXBlIGNoZWNraW5nIG9uIHRoZSBtYWluIHRocmVhZC5cbiAgICAgIGlmIChzaWduYWwgIT09ICdTSUdURVJNJykge1xuICAgICAgICB0aGlzLl9mb3JrVHlwZUNoZWNrZXIgPSBmYWxzZTtcbiAgICAgICAgY29uc3QgbXNnID0gJ0FuZ3VsYXJDb21waWxlclBsdWdpbjogRm9ya2VkIFR5cGUgQ2hlY2tlciBleGl0ZWQgdW5leHBlY3RlZGx5LiAnICtcbiAgICAgICAgICAnRmFsbGluZyBiYWNrIHRvIHR5cGUgY2hlY2tpbmcgb24gbWFpbiB0aHJlYWQuJztcbiAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChtc2cpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfa2lsbEZvcmtlZFR5cGVDaGVja2VyKCkge1xuICAgIGlmICh0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MgJiYgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCkge1xuICAgICAgdHJlZUtpbGwodGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnBpZCwgJ1NJR1RFUk0nKTtcbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2VzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBfdXBkYXRlRm9ya2VkVHlwZUNoZWNrZXIocm9vdE5hbWVzOiBzdHJpbmdbXSwgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcykge1xuICAgICAgaWYgKCF0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkKSB7XG4gICAgICAgIGxldCBob3N0UmVwbGFjZW1lbnRQYXRocyA9IHt9O1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRoc1xuICAgICAgICAgICYmIHR5cGVvZiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzICE9ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBob3N0UmVwbGFjZW1lbnRQYXRocyA9IHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHM7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdHlwZUNoZWNrZXJQcm9jZXNzLnNlbmQobmV3IEluaXRNZXNzYWdlKHRoaXMuX2NvbXBpbGVyT3B0aW9ucywgdGhpcy5fYmFzZVBhdGgsXG4gICAgICAgICAgdGhpcy5fSml0TW9kZSwgdGhpcy5fcm9vdE5hbWVzLCBob3N0UmVwbGFjZW1lbnRQYXRocykpO1xuICAgICAgICB0aGlzLl9mb3JrZWRUeXBlQ2hlY2tlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3R5cGVDaGVja2VyUHJvY2Vzcy5zZW5kKG5ldyBVcGRhdGVNZXNzYWdlKHJvb3ROYW1lcywgY2hhbmdlZENvbXBpbGF0aW9uRmlsZXMpKTtcbiAgICB9XG4gIH1cblxuICAvLyBSZWdpc3RyYXRpb24gaG9vayBmb3Igd2VicGFjayBwbHVnaW4uXG4gIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1iaWctZnVuY3Rpb25cbiAgYXBwbHkoY29tcGlsZXI6IENvbXBpbGVyICYgeyB3YXRjaE1vZGU/OiBib29sZWFuIH0pIHtcbiAgICAvLyBjbGVhbnVwIGlmIG5vdCB3YXRjaGluZ1xuICAgIGNvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjb21waWxhdGlvbiA9PiB7XG4gICAgICBjb21waWxhdGlvbi5ob29rcy5maW5pc2hNb2R1bGVzLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgICAgLy8gb25seSBwcmVzZW50IGZvciB3ZWJwYWNrIDQuMjMuMCssIGFzc3VtZSB0cnVlIG90aGVyd2lzZVxuICAgICAgICBjb25zdCB3YXRjaE1vZGUgPSBjb21waWxlci53YXRjaE1vZGUgPT09IHVuZGVmaW5lZCA/IHRydWUgOiBjb21waWxlci53YXRjaE1vZGU7XG4gICAgICAgIGlmICghd2F0Y2hNb2RlKSB7XG4gICAgICAgICAgdGhpcy5fcHJvZ3JhbSA9IG51bGw7XG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzID0gW107XG4gICAgICAgICAgdGhpcy5fcmVzb3VyY2VMb2FkZXIgPSB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gRGVjb3JhdGUgaW5wdXRGaWxlU3lzdGVtIHRvIHNlcnZlIGNvbnRlbnRzIG9mIENvbXBpbGVySG9zdC5cbiAgICAvLyBVc2UgZGVjb3JhdGVkIGlucHV0RmlsZVN5c3RlbSBpbiB3YXRjaEZpbGVTeXN0ZW0uXG4gICAgY29tcGlsZXIuaG9va3MuZW52aXJvbm1lbnQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4ge1xuICAgICAgLy8gVGhlIHdlYnBhY2sgdHlwZXMgY3VycmVudGx5IGRvIG5vdCBpbmNsdWRlIHRoZXNlXG4gICAgICBjb25zdCBjb21waWxlcldpdGhGaWxlU3lzdGVtcyA9IGNvbXBpbGVyIGFzIENvbXBpbGVyICYge1xuICAgICAgICB3YXRjaEZpbGVTeXN0ZW06IE5vZGVXYXRjaEZpbGVTeXN0ZW1JbnRlcmZhY2UsXG4gICAgICB9O1xuXG4gICAgICBsZXQgaG9zdDogdmlydHVhbEZzLkhvc3Q8ZnMuU3RhdHM+ID0gdGhpcy5fb3B0aW9ucy5ob3N0IHx8IG5ldyBXZWJwYWNrSW5wdXRIb3N0KFxuICAgICAgICBjb21waWxlcldpdGhGaWxlU3lzdGVtcy5pbnB1dEZpbGVTeXN0ZW0sXG4gICAgICApO1xuXG4gICAgICBsZXQgcmVwbGFjZW1lbnRzOiBNYXA8UGF0aCwgUGF0aD4gfCAoKHBhdGg6IFBhdGgpID0+IFBhdGgpIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzID09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICBjb25zdCByZXBsYWNlbWVudFJlc29sdmVyID0gdGhpcy5fb3B0aW9ucy5ob3N0UmVwbGFjZW1lbnRQYXRocztcbiAgICAgICAgICByZXBsYWNlbWVudHMgPSBwYXRoID0+IG5vcm1hbGl6ZShyZXBsYWNlbWVudFJlc29sdmVyKGdldFN5c3RlbVBhdGgocGF0aCkpKTtcbiAgICAgICAgICBob3N0ID0gbmV3IGNsYXNzIGV4dGVuZHMgdmlydHVhbEZzLlJlc29sdmVySG9zdDxmcy5TdGF0cz4ge1xuICAgICAgICAgICAgX3Jlc29sdmUocGF0aDogUGF0aCkge1xuICAgICAgICAgICAgICByZXR1cm4gbm9ybWFsaXplKHJlcGxhY2VtZW50UmVzb2x2ZXIoZ2V0U3lzdGVtUGF0aChwYXRoKSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0oaG9zdCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVwbGFjZW1lbnRzID0gbmV3IE1hcCgpO1xuICAgICAgICAgIGNvbnN0IGFsaWFzSG9zdCA9IG5ldyB2aXJ0dWFsRnMuQWxpYXNIb3N0KGhvc3QpO1xuICAgICAgICAgIGZvciAoY29uc3QgZnJvbSBpbiB0aGlzLl9vcHRpb25zLmhvc3RSZXBsYWNlbWVudFBhdGhzKSB7XG4gICAgICAgICAgICBjb25zdCBub3JtYWxpemVkRnJvbSA9IHJlc29sdmUobm9ybWFsaXplKHRoaXMuX2Jhc2VQYXRoKSwgbm9ybWFsaXplKGZyb20pKTtcbiAgICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRXaXRoID0gcmVzb2x2ZShcbiAgICAgICAgICAgICAgbm9ybWFsaXplKHRoaXMuX2Jhc2VQYXRoKSxcbiAgICAgICAgICAgICAgbm9ybWFsaXplKHRoaXMuX29wdGlvbnMuaG9zdFJlcGxhY2VtZW50UGF0aHNbZnJvbV0pLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGFsaWFzSG9zdC5hbGlhc2VzLnNldChub3JtYWxpemVkRnJvbSwgbm9ybWFsaXplZFdpdGgpO1xuICAgICAgICAgICAgcmVwbGFjZW1lbnRzLnNldChub3JtYWxpemVkRnJvbSwgbm9ybWFsaXplZFdpdGgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBob3N0ID0gYWxpYXNIb3N0O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSB0aGUgd2VicGFjayBjb21waWxlciBob3N0LlxuICAgICAgY29uc3Qgd2VicGFja0NvbXBpbGVySG9zdCA9IG5ldyBXZWJwYWNrQ29tcGlsZXJIb3N0KFxuICAgICAgICB0aGlzLl9jb21waWxlck9wdGlvbnMsXG4gICAgICAgIHRoaXMuX2Jhc2VQYXRoLFxuICAgICAgICBob3N0LFxuICAgICAgICB0cnVlLFxuICAgICAgICB0aGlzLl9vcHRpb25zLmRpcmVjdFRlbXBsYXRlTG9hZGluZyxcbiAgICAgICk7XG5cbiAgICAgIC8vIENyZWF0ZSBhbmQgc2V0IGEgbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlciBpbiBBT1RcbiAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICB0aGlzLl9yZXNvdXJjZUxvYWRlciA9IG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIoKTtcbiAgICAgICAgd2VicGFja0NvbXBpbGVySG9zdC5zZXRSZXNvdXJjZUxvYWRlcih0aGlzLl9yZXNvdXJjZUxvYWRlcik7XG4gICAgICB9XG5cbiAgICAgIC8vIFVzZSB0aGUgV2VicGFja0NvbXBpbGVySG9zdCB3aXRoIGEgcmVzb3VyY2UgbG9hZGVyIHRvIGNyZWF0ZSBhbiBBbmd1bGFyQ29tcGlsZXJIb3N0LlxuICAgICAgdGhpcy5fY29tcGlsZXJIb3N0ID0gY3JlYXRlQ29tcGlsZXJIb3N0KHtcbiAgICAgICAgb3B0aW9uczogdGhpcy5fY29tcGlsZXJPcHRpb25zLFxuICAgICAgICB0c0hvc3Q6IHdlYnBhY2tDb21waWxlckhvc3QsXG4gICAgICB9KSBhcyBDb21waWxlckhvc3QgJiBXZWJwYWNrQ29tcGlsZXJIb3N0O1xuXG4gICAgICAvLyBSZXNvbHZlIG1haW5QYXRoIGlmIHByb3ZpZGVkLlxuICAgICAgaWYgKHRoaXMuX29wdGlvbnMubWFpblBhdGgpIHtcbiAgICAgICAgdGhpcy5fbWFpblBhdGggPSB0aGlzLl9jb21waWxlckhvc3QucmVzb2x2ZSh0aGlzLl9vcHRpb25zLm1haW5QYXRoKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5wdXREZWNvcmF0b3IgPSBuZXcgVmlydHVhbEZpbGVTeXN0ZW1EZWNvcmF0b3IoXG4gICAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSxcbiAgICAgICAgdGhpcy5fY29tcGlsZXJIb3N0LFxuICAgICAgKTtcbiAgICAgIGNvbXBpbGVyV2l0aEZpbGVTeXN0ZW1zLmlucHV0RmlsZVN5c3RlbSA9IGlucHV0RGVjb3JhdG9yO1xuICAgICAgY29tcGlsZXJXaXRoRmlsZVN5c3RlbXMud2F0Y2hGaWxlU3lzdGVtID0gbmV3IFZpcnR1YWxXYXRjaEZpbGVTeXN0ZW1EZWNvcmF0b3IoXG4gICAgICAgIGlucHV0RGVjb3JhdG9yLFxuICAgICAgICByZXBsYWNlbWVudHMsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgLy8gQWRkIGxhenkgbW9kdWxlcyB0byB0aGUgY29udGV4dCBtb2R1bGUgZm9yIEBhbmd1bGFyL2NvcmVcbiAgICBjb21waWxlci5ob29rcy5jb250ZXh0TW9kdWxlRmFjdG9yeS50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCBjbWYgPT4ge1xuICAgICAgY29uc3QgYW5ndWxhckNvcmVQYWNrYWdlUGF0aCA9IHJlcXVpcmUucmVzb2x2ZSgnQGFuZ3VsYXIvY29yZS9wYWNrYWdlLmpzb24nKTtcblxuICAgICAgLy8gQVBGdjYgZG9lcyBub3QgaGF2ZSBzaW5nbGUgRkVTTSBhbnltb3JlLiBJbnN0ZWFkIG9mIHZlcmlmeWluZyBpZiB3ZSdyZSBwb2ludGluZyB0b1xuICAgICAgLy8gRkVTTXMsIHdlIHJlc29sdmUgdGhlIGBAYW5ndWxhci9jb3JlYCBwYXRoIGFuZCB2ZXJpZnkgdGhhdCB0aGUgcGF0aCBmb3IgdGhlXG4gICAgICAvLyBtb2R1bGUgc3RhcnRzIHdpdGggaXQuXG4gICAgICAvLyBUaGlzIG1heSBiZSBzbG93ZXIgYnV0IGl0IHdpbGwgYmUgY29tcGF0aWJsZSB3aXRoIGJvdGggQVBGNSwgNiBhbmQgcG90ZW50aWFsIGZ1dHVyZVxuICAgICAgLy8gdmVyc2lvbnMgKHVudGlsIHRoZSBkeW5hbWljIGltcG9ydCBhcHBlYXJzIG91dHNpZGUgb2YgY29yZSBJIHN1cHBvc2UpLlxuICAgICAgLy8gV2UgcmVzb2x2ZSBhbnkgc3ltYm9saWMgbGlua3MgaW4gb3JkZXIgdG8gZ2V0IHRoZSByZWFsIHBhdGggdGhhdCB3b3VsZCBiZSB1c2VkIGluIHdlYnBhY2suXG4gICAgICBjb25zdCBhbmd1bGFyQ29yZVJlc291cmNlUm9vdCA9IGZzLnJlYWxwYXRoU3luYyhwYXRoLmRpcm5hbWUoYW5ndWxhckNvcmVQYWNrYWdlUGF0aCkpO1xuXG4gICAgICBjbWYuaG9va3MuYWZ0ZXJSZXNvbHZlLnRhcFByb21pc2UoJ2FuZ3VsYXItY29tcGlsZXInLCBhc3luYyByZXN1bHQgPT4ge1xuICAgICAgICAvLyBBbHRlciBvbmx5IGV4aXN0aW5nIHJlcXVlc3QgZnJvbSBBbmd1bGFyIG9yIG9uZSBvZiB0aGUgYWRkaXRpb25hbCBsYXp5IG1vZHVsZSByZXNvdXJjZXMuXG4gICAgICAgIGNvbnN0IGlzTGF6eU1vZHVsZVJlc291cmNlID0gKHJlc291cmNlOiBzdHJpbmcpID0+XG4gICAgICAgICAgcmVzb3VyY2Uuc3RhcnRzV2l0aChhbmd1bGFyQ29yZVJlc291cmNlUm9vdCkgfHxcbiAgICAgICAgICAoIHRoaXMub3B0aW9ucy5hZGRpdGlvbmFsTGF6eU1vZHVsZVJlc291cmNlcyAmJlxuICAgICAgICAgICAgdGhpcy5vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlUmVzb3VyY2VzLmluY2x1ZGVzKHJlc291cmNlKSk7XG5cbiAgICAgICAgaWYgKCFyZXN1bHQgfHwgIXRoaXMuZG9uZSB8fCAhaXNMYXp5TW9kdWxlUmVzb3VyY2UocmVzdWx0LnJlc291cmNlKSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdGhpcy5kb25lLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgLy8gVGhpcyBmb2xkZXIgZG9lcyBub3QgZXhpc3QsIGJ1dCB3ZSBuZWVkIHRvIGdpdmUgd2VicGFjayBhIHJlc291cmNlLlxuICAgICAgICAgICAgLy8gVE9ETzogY2hlY2sgaWYgd2UgY2FuJ3QganVzdCBsZWF2ZSBpdCBhcyBpcyAoYW5ndWxhckNvcmVNb2R1bGVEaXIpLlxuICAgICAgICAgICAgcmVzdWx0LnJlc291cmNlID0gcGF0aC5qb2luKHRoaXMuX2Jhc2VQYXRoLCAnJCRfbGF6eV9yb3V0ZV9yZXNvdXJjZScpO1xuICAgICAgICAgICAgLy8gdHNsaW50OmRpc2FibGUtbmV4dC1saW5lOm5vLWFueVxuICAgICAgICAgICAgcmVzdWx0LmRlcGVuZGVuY2llcy5mb3JFYWNoKChkOiBhbnkpID0+IGQuY3JpdGljYWwgPSBmYWxzZSk7XG4gICAgICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgICAgICByZXN1bHQucmVzb2x2ZURlcGVuZGVuY2llcyA9IChfZnM6IGFueSwgb3B0aW9uczogYW55LCBjYWxsYmFjazogQ2FsbGJhY2spID0+IHtcbiAgICAgICAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gT2JqZWN0LmtleXModGhpcy5fbGF6eVJvdXRlcylcbiAgICAgICAgICAgICAgICAubWFwKChrZXkpID0+IHtcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1vZHVsZVBhdGggPSB0aGlzLl9sYXp5Um91dGVzW2tleV07XG4gICAgICAgICAgICAgICAgICBpZiAobW9kdWxlUGF0aCAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuYW1lID0ga2V5LnNwbGl0KCcjJylbMF07XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyB0aGlzLl9jb250ZXh0RWxlbWVudERlcGVuZGVuY3lDb25zdHJ1Y3Rvcihtb2R1bGVQYXRoLCBuYW1lKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmZpbHRlcih4ID0+ICEheCk7XG5cbiAgICAgICAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMubmFtZUxhenlGaWxlcykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuY2h1bmtOYW1lID0gJ1tyZXF1ZXN0XSc7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBjYWxsYmFjayhudWxsLCBkZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgICgpID0+IHVuZGVmaW5lZCxcbiAgICAgICAgKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIGFuZCBkZXN0cm95IGZvcmtlZCB0eXBlIGNoZWNrZXIgb24gd2F0Y2ggbW9kZS5cbiAgICBjb21waWxlci5ob29rcy53YXRjaFJ1bi50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5fZm9ya1R5cGVDaGVja2VyICYmICF0aGlzLl90eXBlQ2hlY2tlclByb2Nlc3MpIHtcbiAgICAgICAgdGhpcy5fY3JlYXRlRm9ya2VkVHlwZUNoZWNrZXIoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy53YXRjaENsb3NlLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHRoaXMuX2tpbGxGb3JrZWRUeXBlQ2hlY2tlcigpKTtcblxuICAgIC8vIFJlbWFrZSB0aGUgcGx1Z2luIG9uIGVhY2ggY29tcGlsYXRpb24uXG4gICAgY29tcGlsZXIuaG9va3MubWFrZS50YXBQcm9taXNlKFxuICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgY29tcGlsYXRpb24gPT4gdGhpcy5fZG9uZVByb21pc2UgPSB0aGlzLl9tYWtlKGNvbXBpbGF0aW9uKSxcbiAgICApO1xuICAgIGNvbXBpbGVyLmhvb2tzLmludmFsaWQudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKCkgPT4gdGhpcy5fZmlyc3RSdW4gPSBmYWxzZSk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJFbWl0LnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGF0aW9uID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxhdGlvbiBhcyBhbnkpLl9uZ1Rvb2xzV2VicGFja1BsdWdpbkluc3RhbmNlID0gbnVsbDtcbiAgICB9KTtcbiAgICBjb21waWxlci5ob29rcy5kb25lLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgIHRoaXMuX2RvbmVQcm9taXNlID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcCgnYW5ndWxhci1jb21waWxlcicsIGNvbXBpbGVyID0+IHtcbiAgICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICAgIChjb21waWxlciBhcyBhbnkpLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlclxuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVzb2x2ZXI6IGFueSkgPT4ge1xuICAgICAgICAgIG5ldyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4odGhpcy5fY29tcGlsZXJPcHRpb25zKS5hcHBseShyZXNvbHZlcik7XG4gICAgICAgIH0pO1xuXG4gICAgICBjb21waWxlci5ob29rcy5ub3JtYWxNb2R1bGVGYWN0b3J5LnRhcCgnYW5ndWxhci1jb21waWxlcicsIG5tZiA9PiB7XG4gICAgICAgIC8vIFZpcnR1YWwgZmlsZSBzeXN0ZW0uXG4gICAgICAgIC8vIFRPRE86IGNvbnNpZGVyIGlmIGl0J3MgYmV0dGVyIHRvIHJlbW92ZSB0aGlzIHBsdWdpbiBhbmQgaW5zdGVhZCBtYWtlIGl0IHdhaXQgb24gdGhlXG4gICAgICAgIC8vIFZpcnR1YWxGaWxlU3lzdGVtRGVjb3JhdG9yLlxuICAgICAgICAvLyBXYWl0IGZvciB0aGUgcGx1Z2luIHRvIGJlIGRvbmUgd2hlbiByZXF1ZXN0aW5nIGAudHNgIGZpbGVzIGRpcmVjdGx5IChlbnRyeSBwb2ludHMpLCBvclxuICAgICAgICAvLyB3aGVuIHRoZSBpc3N1ZXIgaXMgYSBgLnRzYCBvciBgLm5nZmFjdG9yeS5qc2AgZmlsZS5cbiAgICAgICAgbm1mLmhvb2tzLmJlZm9yZVJlc29sdmUudGFwUHJvbWlzZShcbiAgICAgICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAgICAgYXN5bmMgKHJlcXVlc3Q/OiBOb3JtYWxNb2R1bGVGYWN0b3J5UmVxdWVzdCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMuZG9uZSAmJiByZXF1ZXN0KSB7XG4gICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSByZXF1ZXN0LnJlcXVlc3Q7XG4gICAgICAgICAgICAgIGNvbnN0IGlzc3VlciA9IHJlcXVlc3QuY29udGV4dEluZm8uaXNzdWVyO1xuICAgICAgICAgICAgICBpZiAobmFtZS5lbmRzV2l0aCgnLnRzJykgfHwgbmFtZS5lbmRzV2l0aCgnLnRzeCcpXG4gICAgICAgICAgICAgICAgfHwgKGlzc3VlciAmJiAvXFwudHN8bmdmYWN0b3J5XFwuanMkLy50ZXN0KGlzc3VlcikpKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuZG9uZTtcbiAgICAgICAgICAgICAgICB9IGNhdGNoIHsgfVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiByZXF1ZXN0O1xuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgX21ha2UoY29tcGlsYXRpb246IGNvbXBpbGF0aW9uLkNvbXBpbGF0aW9uKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gICAgdGhpcy5fZW1pdFNraXBwZWQgPSB0cnVlO1xuICAgIC8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1hbnlcbiAgICBpZiAoKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQW4gQG5ndG9vbHMvd2VicGFjayBwbHVnaW4gYWxyZWFkeSBleGlzdCBmb3IgdGhpcyBjb21waWxhdGlvbi4nKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgYSBwcml2YXRlIHZhcmlhYmxlIGZvciB0aGlzIHBsdWdpbiBpbnN0YW5jZS5cbiAgICAvLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tYW55XG4gICAgKGNvbXBpbGF0aW9uIGFzIGFueSkuX25nVG9vbHNXZWJwYWNrUGx1Z2luSW5zdGFuY2UgPSB0aGlzO1xuXG4gICAgLy8gVXBkYXRlIHRoZSByZXNvdXJjZSBsb2FkZXIgd2l0aCB0aGUgbmV3IHdlYnBhY2sgY29tcGlsYXRpb24uXG4gICAgaWYgKHRoaXMuX3Jlc291cmNlTG9hZGVyKSB7XG4gICAgICB0aGlzLl9yZXNvdXJjZUxvYWRlci51cGRhdGUoY29tcGlsYXRpb24pO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLl91cGRhdGUoKTtcbiAgICAgIHRoaXMucHVzaENvbXBpbGF0aW9uRXJyb3JzKGNvbXBpbGF0aW9uKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKGVycik7XG4gICAgICB0aGlzLnB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbik7XG4gICAgfVxuXG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9tYWtlJyk7XG4gIH1cblxuICBwcml2YXRlIHB1c2hDb21waWxhdGlvbkVycm9ycyhjb21waWxhdGlvbjogY29tcGlsYXRpb24uQ29tcGlsYXRpb24pIHtcbiAgICBjb21waWxhdGlvbi5lcnJvcnMucHVzaCguLi50aGlzLl9lcnJvcnMpO1xuICAgIGNvbXBpbGF0aW9uLndhcm5pbmdzLnB1c2goLi4udGhpcy5fd2FybmluZ3MpO1xuICAgIHRoaXMuX2Vycm9ycyA9IFtdO1xuICAgIHRoaXMuX3dhcm5pbmdzID0gW107XG4gIH1cblxuICBwcml2YXRlIF9tYWtlVHJhbnNmb3JtZXJzKCkge1xuICAgIGNvbnN0IGlzQXBwUGF0aCA9IChmaWxlTmFtZTogc3RyaW5nKSA9PlxuICAgICAgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdmYWN0b3J5LnRzJykgJiYgIWZpbGVOYW1lLmVuZHNXaXRoKCcubmdzdHlsZS50cycpO1xuICAgIGNvbnN0IGlzTWFpblBhdGggPSAoZmlsZU5hbWU6IHN0cmluZykgPT4gZmlsZU5hbWUgPT09IChcbiAgICAgIHRoaXMuX21haW5QYXRoID8gd29ya2Fyb3VuZFJlc29sdmUodGhpcy5fbWFpblBhdGgpIDogdGhpcy5fbWFpblBhdGhcbiAgICApO1xuICAgIGNvbnN0IGdldEVudHJ5TW9kdWxlID0gKCkgPT4gdGhpcy5lbnRyeU1vZHVsZVxuICAgICAgPyB7IHBhdGg6IHdvcmthcm91bmRSZXNvbHZlKHRoaXMuZW50cnlNb2R1bGUucGF0aCksIGNsYXNzTmFtZTogdGhpcy5lbnRyeU1vZHVsZS5jbGFzc05hbWUgfVxuICAgICAgOiB0aGlzLmVudHJ5TW9kdWxlO1xuICAgIGNvbnN0IGdldExhenlSb3V0ZXMgPSAoKSA9PiB0aGlzLl9sYXp5Um91dGVzO1xuICAgIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gKHRoaXMuX2dldFRzUHJvZ3JhbSgpIGFzIHRzLlByb2dyYW0pLmdldFR5cGVDaGVja2VyKCk7XG5cbiAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgLy8gUmVwbGFjZSByZXNvdXJjZXMgaW4gSklULlxuICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZVJlc291cmNlcyhpc0FwcFBhdGgsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW92ZSB1bm5lZWRlZCBhbmd1bGFyIGRlY29yYXRvcnMuXG4gICAgICB0aGlzLl90cmFuc2Zvcm1lcnMucHVzaChyZW1vdmVEZWNvcmF0b3JzKGlzQXBwUGF0aCwgZ2V0VHlwZUNoZWNrZXIpKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fcGxhdGZvcm1UcmFuc2Zvcm1lcnMgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKC4uLnRoaXMuX3BsYXRmb3JtVHJhbnNmb3JtZXJzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5Ccm93c2VyKSB7XG4gICAgICAgIC8vIElmIHdlIGhhdmUgYSBsb2NhbGUsIGF1dG8gaW1wb3J0IHRoZSBsb2NhbGUgZGF0YSBmaWxlLlxuICAgICAgICAvLyBUaGlzIHRyYW5zZm9ybSBtdXN0IGdvIGJlZm9yZSByZXBsYWNlQm9vdHN0cmFwIGJlY2F1c2UgaXQgbG9va3MgZm9yIHRoZSBlbnRyeSBtb2R1bGVcbiAgICAgICAgLy8gaW1wb3J0LCB3aGljaCB3aWxsIGJlIHJlcGxhY2VkLlxuICAgICAgICBpZiAodGhpcy5fbm9ybWFsaXplZExvY2FsZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKHJlZ2lzdGVyTG9jYWxlRGF0YShpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLFxuICAgICAgICAgICAgdGhpcy5fbm9ybWFsaXplZExvY2FsZSkpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLl9KaXRNb2RlKSB7XG4gICAgICAgICAgLy8gUmVwbGFjZSBib290c3RyYXAgaW4gYnJvd3NlciBBT1QuXG4gICAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2gocmVwbGFjZUJvb3RzdHJhcChpc0FwcFBhdGgsIGdldEVudHJ5TW9kdWxlLCBnZXRUeXBlQ2hlY2tlcikpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX3BsYXRmb3JtID09PSBQTEFURk9STS5TZXJ2ZXIpIHtcbiAgICAgICAgdGhpcy5fdHJhbnNmb3JtZXJzLnB1c2goZXhwb3J0TGF6eU1vZHVsZU1hcChpc01haW5QYXRoLCBnZXRMYXp5Um91dGVzKSk7XG4gICAgICAgIGlmICghdGhpcy5fSml0TW9kZSkge1xuICAgICAgICAgIHRoaXMuX3RyYW5zZm9ybWVycy5wdXNoKFxuICAgICAgICAgICAgZXhwb3J0TmdGYWN0b3J5KGlzTWFpblBhdGgsIGdldEVudHJ5TW9kdWxlKSxcbiAgICAgICAgICAgIHJlcGxhY2VTZXJ2ZXJCb290c3RyYXAoaXNNYWluUGF0aCwgZ2V0RW50cnlNb2R1bGUsIGdldFR5cGVDaGVja2VyKSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIF91cGRhdGUoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl91cGRhdGUnKTtcbiAgICAvLyBXZSBvbmx5IHdhbnQgdG8gdXBkYXRlIG9uIFRTIGFuZCB0ZW1wbGF0ZSBjaGFuZ2VzLCBidXQgYWxsIGtpbmRzIG9mIGZpbGVzIGFyZSBvbiB0aGlzXG4gICAgLy8gbGlzdCwgbGlrZSBwYWNrYWdlLmpzb24gYW5kIC5uZ3N1bW1hcnkuanNvbiBmaWxlcy5cbiAgICBjb25zdCBjaGFuZ2VkRmlsZXMgPSB0aGlzLl9nZXRDaGFuZ2VkQ29tcGlsYXRpb25GaWxlcygpO1xuXG4gICAgLy8gSWYgbm90aGluZyB3ZSBjYXJlIGFib3V0IGNoYW5nZWQgYW5kIGl0IGlzbid0IHRoZSBmaXJzdCBydW4sIGRvbid0IGRvIGFueXRoaW5nLlxuICAgIGlmIChjaGFuZ2VkRmlsZXMubGVuZ3RoID09PSAwICYmICF0aGlzLl9maXJzdFJ1bikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIE1ha2UgYSBuZXcgcHJvZ3JhbSBhbmQgbG9hZCB0aGUgQW5ndWxhciBzdHJ1Y3R1cmUuXG4gICAgYXdhaXQgdGhpcy5fY3JlYXRlT3JVcGRhdGVQcm9ncmFtKCk7XG5cbiAgICAvLyBGaW5kIGxhenkgcm91dGVzXG4gICAgY29uc3QgbGF6eVJvdXRlTWFwOiBMYXp5Um91dGVNYXAgPSB7XG4gICAgICAuLi50aGlzLl9saXN0TGF6eVJvdXRlc0Zyb21Qcm9ncmFtKCksXG4gICAgICAuLi50aGlzLl9vcHRpb25zLmFkZGl0aW9uYWxMYXp5TW9kdWxlcyxcbiAgICB9O1xuICAgIHRoaXMuX3Byb2Nlc3NMYXp5Um91dGVzKGxhenlSb3V0ZU1hcCk7XG5cbiAgICAvLyBFbWl0IGZpbGVzLlxuICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG4gICAgY29uc3QgeyBlbWl0UmVzdWx0LCBkaWFnbm9zdGljcyB9ID0gdGhpcy5fZW1pdCgpO1xuICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fdXBkYXRlLl9lbWl0Jyk7XG5cbiAgICAvLyBSZXBvcnQgZGlhZ25vc3RpY3MuXG4gICAgY29uc3QgZXJyb3JzID0gZGlhZ25vc3RpY3NcbiAgICAgIC5maWx0ZXIoKGRpYWcpID0+IGRpYWcuY2F0ZWdvcnkgPT09IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvcik7XG4gICAgY29uc3Qgd2FybmluZ3MgPSBkaWFnbm9zdGljc1xuICAgICAgLmZpbHRlcigoZGlhZykgPT4gZGlhZy5jYXRlZ29yeSA9PT0gdHMuRGlhZ25vc3RpY0NhdGVnb3J5Lldhcm5pbmcpO1xuXG4gICAgaWYgKGVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZm9ybWF0RGlhZ25vc3RpY3MoZXJyb3JzKTtcbiAgICAgIHRoaXMuX2Vycm9ycy5wdXNoKG5ldyBFcnJvcihtZXNzYWdlKSk7XG4gICAgfVxuXG4gICAgaWYgKHdhcm5pbmdzLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBmb3JtYXREaWFnbm9zdGljcyh3YXJuaW5ncyk7XG4gICAgICB0aGlzLl93YXJuaW5ncy5wdXNoKG1lc3NhZ2UpO1xuICAgIH1cblxuICAgIHRoaXMuX2VtaXRTa2lwcGVkID0gIWVtaXRSZXN1bHQgfHwgZW1pdFJlc3VsdC5lbWl0U2tpcHBlZDtcblxuICAgIC8vIFJlc2V0IGNoYW5nZWQgZmlsZXMgb24gc3VjY2Vzc2Z1bCBjb21waWxhdGlvbi5cbiAgICBpZiAoIXRoaXMuX2VtaXRTa2lwcGVkICYmIHRoaXMuX2Vycm9ycy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuX2NvbXBpbGVySG9zdC5yZXNldENoYW5nZWRGaWxlVHJhY2tlcigpO1xuICAgIH1cbiAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX3VwZGF0ZScpO1xuICB9XG5cbiAgd3JpdGVJMThuT3V0RmlsZSgpIHtcbiAgICBmdW5jdGlvbiBfcmVjdXJzaXZlTWtEaXIocDogc3RyaW5nKSB7XG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMocCkpIHtcbiAgICAgICAgX3JlY3Vyc2l2ZU1rRGlyKHBhdGguZGlybmFtZShwKSk7XG4gICAgICAgIGZzLm1rZGlyU3luYyhwKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBXcml0ZSB0aGUgZXh0cmFjdGVkIG1lc3NhZ2VzIHRvIGRpc2suXG4gICAgaWYgKHRoaXMuX2NvbXBpbGVyT3B0aW9ucy5pMThuT3V0RmlsZSkge1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVQYXRoID0gcGF0aC5yZXNvbHZlKHRoaXMuX2Jhc2VQYXRoLCB0aGlzLl9jb21waWxlck9wdGlvbnMuaTE4bk91dEZpbGUpO1xuICAgICAgY29uc3QgaTE4bk91dEZpbGVDb250ZW50ID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlYWRGaWxlKGkxOG5PdXRGaWxlUGF0aCk7XG4gICAgICBpZiAoaTE4bk91dEZpbGVDb250ZW50KSB7XG4gICAgICAgIF9yZWN1cnNpdmVNa0RpcihwYXRoLmRpcm5hbWUoaTE4bk91dEZpbGVQYXRoKSk7XG4gICAgICAgIGZzLndyaXRlRmlsZVN5bmMoaTE4bk91dEZpbGVQYXRoLCBpMThuT3V0RmlsZUNvbnRlbnQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGdldENvbXBpbGVkRmlsZShmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgb3V0cHV0RmlsZSA9IGZpbGVOYW1lLnJlcGxhY2UoLy50c3g/JC8sICcuanMnKTtcbiAgICBsZXQgb3V0cHV0VGV4dDogc3RyaW5nO1xuICAgIGxldCBzb3VyY2VNYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBsZXQgZXJyb3JEZXBlbmRlbmNpZXM6IHN0cmluZ1tdID0gW107XG5cbiAgICBpZiAodGhpcy5fZW1pdFNraXBwZWQpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSk7XG4gICAgICBpZiAodGV4dCkge1xuICAgICAgICAvLyBJZiB0aGUgY29tcGlsYXRpb24gZGlkbid0IGVtaXQgZmlsZXMgdGhpcyB0aW1lLCB0cnkgdG8gcmV0dXJuIHRoZSBjYWNoZWQgZmlsZXMgZnJvbSB0aGVcbiAgICAgICAgLy8gbGFzdCBjb21waWxhdGlvbiBhbmQgbGV0IHRoZSBjb21waWxhdGlvbiBlcnJvcnMgc2hvdyB3aGF0J3Mgd3JvbmcuXG4gICAgICAgIG91dHB1dFRleHQgPSB0ZXh0O1xuICAgICAgICBzb3VyY2VNYXAgPSB0aGlzLl9jb21waWxlckhvc3QucmVhZEZpbGUob3V0cHV0RmlsZSArICcubWFwJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUaGVyZSdzIG5vdGhpbmcgd2UgY2FuIHNlcnZlLiBSZXR1cm4gYW4gZW1wdHkgc3RyaW5nIHRvIHByZXZlbnQgbGVuZ2h0eSB3ZWJwYWNrIGVycm9ycyxcbiAgICAgICAgLy8gYWRkIHRoZSByZWJ1aWxkIHdhcm5pbmcgaWYgaXQncyBub3QgdGhlcmUgeWV0LlxuICAgICAgICAvLyBXZSBhbHNvIG5lZWQgdG8gYWxsIGNoYW5nZWQgZmlsZXMgYXMgZGVwZW5kZW5jaWVzIG9mIHRoaXMgZmlsZSwgc28gdGhhdCBhbGwgb2YgdGhlbVxuICAgICAgICAvLyB3aWxsIGJlIHdhdGNoZWQgYW5kIHRyaWdnZXIgYSByZWJ1aWxkIG5leHQgdGltZS5cbiAgICAgICAgb3V0cHV0VGV4dCA9ICcnO1xuICAgICAgICBlcnJvckRlcGVuZGVuY2llcyA9IHRoaXMuX2dldENoYW5nZWRDb21waWxhdGlvbkZpbGVzKClcbiAgICAgICAgICAvLyBUaGVzZSBwYXRocyBhcmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICAgICAgICAubWFwKChwKSA9PiB0aGlzLl9jb21waWxlckhvc3QuZGVub3JtYWxpemVQYXRoKHApKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2hlY2sgaWYgdGhlIFRTIGlucHV0IGZpbGUgYW5kIHRoZSBKUyBvdXRwdXQgZmlsZSBleGlzdC5cbiAgICAgIGlmICgoKGZpbGVOYW1lLmVuZHNXaXRoKCcudHMnKSB8fCBmaWxlTmFtZS5lbmRzV2l0aCgnLnRzeCcpKVxuICAgICAgICAmJiAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMoZmlsZU5hbWUpKVxuICAgICAgICB8fCAhdGhpcy5fY29tcGlsZXJIb3N0LmZpbGVFeGlzdHMob3V0cHV0RmlsZSwgZmFsc2UpKSB7XG4gICAgICAgIGxldCBtc2cgPSBgJHtmaWxlTmFtZX0gaXMgbWlzc2luZyBmcm9tIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uLiBgXG4gICAgICAgICAgKyBgUGxlYXNlIG1ha2Ugc3VyZSBpdCBpcyBpbiB5b3VyIHRzY29uZmlnIHZpYSB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydHkuYDtcblxuICAgICAgICBpZiAoLyhcXFxcfFxcLylub2RlX21vZHVsZXMoXFxcXHxcXC8pLy50ZXN0KGZpbGVOYW1lKSkge1xuICAgICAgICAgIG1zZyArPSAnXFxuVGhlIG1pc3NpbmcgZmlsZSBzZWVtcyB0byBiZSBwYXJ0IG9mIGEgdGhpcmQgcGFydHkgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnVFMgZmlsZXMgaW4gcHVibGlzaGVkIGxpYnJhcmllcyBhcmUgb2Z0ZW4gYSBzaWduIG9mIGEgYmFkbHkgcGFja2FnZWQgbGlicmFyeS4gJ1xuICAgICAgICAgICAgKyAnUGxlYXNlIG9wZW4gYW4gaXNzdWUgaW4gdGhlIGxpYnJhcnkgcmVwb3NpdG9yeSB0byBhbGVydCBpdHMgYXV0aG9yIGFuZCBhc2sgdGhlbSAnXG4gICAgICAgICAgICArICd0byBwYWNrYWdlIHRoZSBsaWJyYXJ5IHVzaW5nIHRoZSBBbmd1bGFyIFBhY2thZ2UgRm9ybWF0IChodHRwczovL2dvby5nbC9qQjNHVnYpLic7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICAgIH1cblxuICAgICAgb3V0cHV0VGV4dCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlKSB8fCAnJztcbiAgICAgIHNvdXJjZU1hcCA9IHRoaXMuX2NvbXBpbGVySG9zdC5yZWFkRmlsZShvdXRwdXRGaWxlICsgJy5tYXAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBvdXRwdXRUZXh0LCBzb3VyY2VNYXAsIGVycm9yRGVwZW5kZW5jaWVzIH07XG4gIH1cblxuICBnZXREZXBlbmRlbmNpZXMoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCByZXNvbHZlZEZpbGVOYW1lID0gdGhpcy5fY29tcGlsZXJIb3N0LnJlc29sdmUoZmlsZU5hbWUpO1xuICAgIGNvbnN0IHNvdXJjZUZpbGUgPSB0aGlzLl9jb21waWxlckhvc3QuZ2V0U291cmNlRmlsZShyZXNvbHZlZEZpbGVOYW1lLCB0cy5TY3JpcHRUYXJnZXQuTGF0ZXN0KTtcbiAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5fY29tcGlsZXJPcHRpb25zO1xuICAgIGNvbnN0IGhvc3QgPSB0aGlzLl9jb21waWxlckhvc3Q7XG4gICAgY29uc3QgY2FjaGUgPSB0aGlzLl9tb2R1bGVSZXNvbHV0aW9uQ2FjaGU7XG5cbiAgICBjb25zdCBlc0ltcG9ydHMgPSBjb2xsZWN0RGVlcE5vZGVzPHRzLkltcG9ydERlY2xhcmF0aW9uPihzb3VyY2VGaWxlLFxuICAgICAgdHMuU3ludGF4S2luZC5JbXBvcnREZWNsYXJhdGlvbilcbiAgICAgIC5tYXAoZGVjbCA9PiB7XG4gICAgICAgIGNvbnN0IG1vZHVsZU5hbWUgPSAoZGVjbC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuU3RyaW5nTGl0ZXJhbCkudGV4dDtcbiAgICAgICAgY29uc3QgcmVzb2x2ZWQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShtb2R1bGVOYW1lLCByZXNvbHZlZEZpbGVOYW1lLCBvcHRpb25zLCBob3N0LCBjYWNoZSk7XG5cbiAgICAgICAgaWYgKHJlc29sdmVkLnJlc29sdmVkTW9kdWxlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVkLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgICAuZmlsdGVyKHggPT4geCk7XG5cbiAgICBjb25zdCByZXNvdXJjZUltcG9ydHMgPSBmaW5kUmVzb3VyY2VzKHNvdXJjZUZpbGUpXG4gICAgICAubWFwKHJlc291cmNlUGF0aCA9PiByZXNvbHZlKGRpcm5hbWUocmVzb2x2ZWRGaWxlTmFtZSksIG5vcm1hbGl6ZShyZXNvdXJjZVBhdGgpKSk7XG5cbiAgICAvLyBUaGVzZSBwYXRocyBhcmUgbWVhbnQgdG8gYmUgdXNlZCBieSB0aGUgbG9hZGVyIHNvIHdlIG11c3QgZGVub3JtYWxpemUgdGhlbS5cbiAgICBjb25zdCB1bmlxdWVEZXBlbmRlbmNpZXMgPSBuZXcgU2V0KFtcbiAgICAgIC4uLmVzSW1wb3J0cyxcbiAgICAgIC4uLnJlc291cmNlSW1wb3J0cyxcbiAgICAgIC4uLnRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXModGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChyZXNvbHZlZEZpbGVOYW1lKSksXG4gICAgXS5tYXAoKHApID0+IHAgJiYgdGhpcy5fY29tcGlsZXJIb3N0LmRlbm9ybWFsaXplUGF0aChwKSkpO1xuXG4gICAgcmV0dXJuIFsuLi51bmlxdWVEZXBlbmRlbmNpZXNdXG4gICAgICAuZmlsdGVyKHggPT4gISF4KSBhcyBzdHJpbmdbXTtcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gICAgaWYgKCF0aGlzLl9yZXNvdXJjZUxvYWRlcikge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlTmFtZSk7XG4gIH1cblxuICAvLyBUaGlzIGNvZGUgbW9zdGx5IGNvbWVzIGZyb20gYHBlcmZvcm1Db21waWxhdGlvbmAgaW4gYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAuXG4gIC8vIEl0IHNraXBzIHRoZSBwcm9ncmFtIGNyZWF0aW9uIGJlY2F1c2Ugd2UgbmVlZCB0byB1c2UgYGxvYWROZ1N0cnVjdHVyZUFzeW5jKClgLFxuICAvLyBhbmQgdXNlcyBDdXN0b21UcmFuc2Zvcm1lcnMuXG4gIHByaXZhdGUgX2VtaXQoKSB7XG4gICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG4gICAgY29uc3QgcHJvZ3JhbSA9IHRoaXMuX3Byb2dyYW07XG4gICAgY29uc3QgYWxsRGlhZ25vc3RpY3M6IEFycmF5PHRzLkRpYWdub3N0aWMgfCBEaWFnbm9zdGljPiA9IFtdO1xuICAgIGNvbnN0IGRpYWdNb2RlID0gKHRoaXMuX2ZpcnN0UnVuIHx8ICF0aGlzLl9mb3JrVHlwZUNoZWNrZXIpID9cbiAgICAgIERpYWdub3N0aWNNb2RlLkFsbCA6IERpYWdub3N0aWNNb2RlLlN5bnRhY3RpYztcblxuICAgIGxldCBlbWl0UmVzdWx0OiB0cy5FbWl0UmVzdWx0IHwgdW5kZWZpbmVkO1xuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5fSml0TW9kZSkge1xuICAgICAgICBjb25zdCB0c1Byb2dyYW0gPSBwcm9ncmFtIGFzIHRzLlByb2dyYW07XG4gICAgICAgIGNvbnN0IGNoYW5nZWRUc0ZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgICAgaWYgKHRoaXMuX2ZpcnN0UnVuKSB7XG4gICAgICAgICAgLy8gQ2hlY2sgcGFyYW1ldGVyIGRpYWdub3N0aWNzLlxuICAgICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC50cy5nZXRPcHRpb25zRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLnRzUHJvZ3JhbS5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0LnRzLmdldE9wdGlvbnNEaWFnbm9zdGljcycpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGdlbmVyYXRlIGEgbGlzdCBvZiBjaGFuZ2VkIGZpbGVzIGZvciBlbWl0XG4gICAgICAgICAgLy8gbm90IG5lZWRlZCBvbiBmaXJzdCBydW4gc2luY2UgYSBmdWxsIHByb2dyYW0gZW1pdCBpcyByZXF1aXJlZFxuICAgICAgICAgIGZvciAoY29uc3QgY2hhbmdlZEZpbGUgb2YgdGhpcy5fY29tcGlsZXJIb3N0LmdldENoYW5nZWRGaWxlUGF0aHMoKSkge1xuICAgICAgICAgICAgaWYgKCEvLih0c3h8dHN8anNvbnxqcykkLy50ZXN0KGNoYW5nZWRGaWxlKSkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGV4aXN0aW5nIHR5cGUgZGVmaW5pdGlvbnMgYXJlIG5vdCBlbWl0dGVkXG4gICAgICAgICAgICBpZiAoY2hhbmdlZEZpbGUuZW5kc1dpdGgoJy5kLnRzJykpIHtcbiAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjaGFuZ2VkVHNGaWxlcy5hZGQoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3ModHNQcm9ncmFtLCB0aGlzLl9KaXRNb2RlLFxuICAgICAgICAgICdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMnLCBkaWFnTW9kZSkpO1xuXG4gICAgICAgIGlmICghaGFzRXJyb3JzKGFsbERpYWdub3N0aWNzKSkge1xuICAgICAgICAgIGlmICh0aGlzLl9maXJzdFJ1biB8fCBjaGFuZ2VkVHNGaWxlcy5zaXplID4gMjApIHtcbiAgICAgICAgICAgIGVtaXRSZXN1bHQgPSB0c1Byb2dyYW0uZW1pdChcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB7IGJlZm9yZTogdGhpcy5fdHJhbnNmb3JtZXJzIH0sXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgYWxsRGlhZ25vc3RpY3MucHVzaCguLi5lbWl0UmVzdWx0LmRpYWdub3N0aWNzKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiBjaGFuZ2VkVHNGaWxlcykge1xuICAgICAgICAgICAgICBjb25zdCBzb3VyY2VGaWxlID0gdHNQcm9ncmFtLmdldFNvdXJjZUZpbGUoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgICAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGNvbnN0IHRpbWVMYWJlbCA9IGBBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQudHMrJHtzb3VyY2VGaWxlLmZpbGVOYW1lfSsuZW1pdGA7XG4gICAgICAgICAgICAgIHRpbWUodGltZUxhYmVsKTtcbiAgICAgICAgICAgICAgZW1pdFJlc3VsdCA9IHRzUHJvZ3JhbS5lbWl0KHNvdXJjZUZpbGUsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgeyBiZWZvcmU6IHRoaXMuX3RyYW5zZm9ybWVycyB9LFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgICB0aW1lRW5kKHRpbWVMYWJlbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IHByb2dyYW0gYXMgUHJvZ3JhbTtcblxuICAgICAgICAvLyBDaGVjayBBbmd1bGFyIHN0cnVjdHVyYWwgZGlhZ25vc3RpY3MuXG4gICAgICAgIHRpbWUoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5nZXROZ1N0cnVjdHVyYWxEaWFnbm9zdGljcycpO1xuICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nU3RydWN0dXJhbERpYWdub3N0aWNzKCkpO1xuICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0TmdTdHJ1Y3R1cmFsRGlhZ25vc3RpY3MnKTtcblxuICAgICAgICBpZiAodGhpcy5fZmlyc3RSdW4pIHtcbiAgICAgICAgICAvLyBDaGVjayBUeXBlU2NyaXB0IHBhcmFtZXRlciBkaWFnbm9zdGljcy5cbiAgICAgICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuICAgICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uYW5ndWxhclByb2dyYW0uZ2V0VHNPcHRpb25EaWFnbm9zdGljcygpKTtcbiAgICAgICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQubmcuZ2V0VHNPcHRpb25EaWFnbm9zdGljcycpO1xuXG4gICAgICAgICAgLy8gQ2hlY2sgQW5ndWxhciBwYXJhbWV0ZXIgZGlhZ25vc3RpY3MuXG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmFuZ3VsYXJQcm9ncmFtLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MoKSk7XG4gICAgICAgICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmdldE5nT3B0aW9uRGlhZ25vc3RpY3MnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goLi4uZ2F0aGVyRGlhZ25vc3RpY3MoYW5ndWxhclByb2dyYW0sIHRoaXMuX0ppdE1vZGUsXG4gICAgICAgICAgJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZycsIGRpYWdNb2RlKSk7XG5cbiAgICAgICAgaWYgKCFoYXNFcnJvcnMoYWxsRGlhZ25vc3RpY3MpKSB7XG4gICAgICAgICAgdGltZSgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Lm5nLmVtaXQnKTtcbiAgICAgICAgICBjb25zdCBleHRyYWN0STE4biA9ICEhdGhpcy5fY29tcGlsZXJPcHRpb25zLmkxOG5PdXRGaWxlO1xuICAgICAgICAgIGNvbnN0IGVtaXRGbGFncyA9IGV4dHJhY3RJMThuID8gRW1pdEZsYWdzLkkxOG5CdW5kbGUgOiBFbWl0RmxhZ3MuRGVmYXVsdDtcbiAgICAgICAgICBlbWl0UmVzdWx0ID0gYW5ndWxhclByb2dyYW0uZW1pdCh7XG4gICAgICAgICAgICBlbWl0RmxhZ3MsIGN1c3RvbVRyYW5zZm9ybWVyczoge1xuICAgICAgICAgICAgICBiZWZvcmVUczogdGhpcy5fdHJhbnNmb3JtZXJzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhbGxEaWFnbm9zdGljcy5wdXNoKC4uLmVtaXRSZXN1bHQuZGlhZ25vc3RpY3MpO1xuICAgICAgICAgIGlmIChleHRyYWN0STE4bikge1xuICAgICAgICAgICAgdGhpcy53cml0ZUkxOG5PdXRGaWxlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRpbWVFbmQoJ0FuZ3VsYXJDb21waWxlclBsdWdpbi5fZW1pdC5uZy5lbWl0Jyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB0aW1lKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICAgIC8vIFRoaXMgZnVuY3Rpb24gaXMgYXZhaWxhYmxlIGluIHRoZSBpbXBvcnQgYmVsb3csIGJ1dCB0aGlzIHdheSB3ZSBhdm9pZCB0aGUgZGVwZW5kZW5jeS5cbiAgICAgIC8vIGltcG9ydCB7IGlzU3ludGF4RXJyb3IgfSBmcm9tICdAYW5ndWxhci9jb21waWxlcic7XG4gICAgICBmdW5jdGlvbiBpc1N5bnRheEVycm9yKGVycm9yOiBFcnJvcik6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gKGVycm9yIGFzIGFueSlbJ25nU3ludGF4RXJyb3InXTsgIC8vIHRzbGludDpkaXNhYmxlLWxpbmU6bm8tYW55XG4gICAgICB9XG5cbiAgICAgIGxldCBlcnJNc2c6IHN0cmluZztcbiAgICAgIGxldCBjb2RlOiBudW1iZXI7XG4gICAgICBpZiAoaXNTeW50YXhFcnJvcihlKSkge1xuICAgICAgICAvLyBkb24ndCByZXBvcnQgdGhlIHN0YWNrIGZvciBzeW50YXggZXJyb3JzIGFzIHRoZXkgYXJlIHdlbGwga25vd24gZXJyb3JzLlxuICAgICAgICBlcnJNc2cgPSBlLm1lc3NhZ2U7XG4gICAgICAgIGNvZGUgPSBERUZBVUxUX0VSUk9SX0NPREU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlcnJNc2cgPSBlLnN0YWNrO1xuICAgICAgICAvLyBJdCBpcyBub3QgYSBzeW50YXggZXJyb3Igd2UgbWlnaHQgaGF2ZSBhIHByb2dyYW0gd2l0aCB1bmtub3duIHN0YXRlLCBkaXNjYXJkIGl0LlxuICAgICAgICB0aGlzLl9wcm9ncmFtID0gbnVsbDtcbiAgICAgICAgY29kZSA9IFVOS05PV05fRVJST1JfQ09ERTtcbiAgICAgIH1cbiAgICAgIGFsbERpYWdub3N0aWNzLnB1c2goXG4gICAgICAgIHsgY2F0ZWdvcnk6IHRzLkRpYWdub3N0aWNDYXRlZ29yeS5FcnJvciwgbWVzc2FnZVRleHQ6IGVyck1zZywgY29kZSwgc291cmNlOiBTT1VSQ0UgfSk7XG4gICAgICB0aW1lRW5kKCdBbmd1bGFyQ29tcGlsZXJQbHVnaW4uX2VtaXQuY2F0Y2gnKTtcbiAgICB9XG4gICAgdGltZUVuZCgnQW5ndWxhckNvbXBpbGVyUGx1Z2luLl9lbWl0Jyk7XG5cbiAgICByZXR1cm4geyBwcm9ncmFtLCBlbWl0UmVzdWx0LCBkaWFnbm9zdGljczogYWxsRGlhZ25vc3RpY3MgfTtcbiAgfVxuXG4gIHByaXZhdGUgX3ZhbGlkYXRlTG9jYWxlKGxvY2FsZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gR2V0IHRoZSBwYXRoIG9mIHRoZSBjb21tb24gbW9kdWxlLlxuICAgIGNvbnN0IGNvbW1vblBhdGggPSBwYXRoLmRpcm5hbWUocmVxdWlyZS5yZXNvbHZlKCdAYW5ndWxhci9jb21tb24vcGFja2FnZS5qc29uJykpO1xuICAgIC8vIENoZWNrIGlmIHRoZSBsb2NhbGUgZmlsZSBleGlzdHNcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMocGF0aC5yZXNvbHZlKGNvbW1vblBhdGgsICdsb2NhbGVzJywgYCR7bG9jYWxlfS5qc2ApKSkge1xuICAgICAgLy8gQ2hlY2sgZm9yIGFuIGFsdGVybmF0aXZlIGxvY2FsZSAoaWYgdGhlIGxvY2FsZSBpZCB3YXMgYmFkbHkgZm9ybWF0dGVkKS5cbiAgICAgIGNvbnN0IGxvY2FsZXMgPSBmcy5yZWFkZGlyU3luYyhwYXRoLnJlc29sdmUoY29tbW9uUGF0aCwgJ2xvY2FsZXMnKSlcbiAgICAgICAgLmZpbHRlcihmaWxlID0+IGZpbGUuZW5kc1dpdGgoJy5qcycpKVxuICAgICAgICAubWFwKGZpbGUgPT4gZmlsZS5yZXBsYWNlKCcuanMnLCAnJykpO1xuXG4gICAgICBsZXQgbmV3TG9jYWxlO1xuICAgICAgY29uc3Qgbm9ybWFsaXplZExvY2FsZSA9IGxvY2FsZS50b0xvd2VyQ2FzZSgpLnJlcGxhY2UoL18vZywgJy0nKTtcbiAgICAgIGZvciAoY29uc3QgbCBvZiBsb2NhbGVzKSB7XG4gICAgICAgIGlmIChsLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWRMb2NhbGUpIHtcbiAgICAgICAgICBuZXdMb2NhbGUgPSBsO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChuZXdMb2NhbGUpIHtcbiAgICAgICAgbG9jYWxlID0gbmV3TG9jYWxlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ2hlY2sgZm9yIGEgcGFyZW50IGxvY2FsZVxuICAgICAgICBjb25zdCBwYXJlbnRMb2NhbGUgPSBub3JtYWxpemVkTG9jYWxlLnNwbGl0KCctJylbMF07XG4gICAgICAgIGlmIChsb2NhbGVzLmluZGV4T2YocGFyZW50TG9jYWxlKSAhPT0gLTEpIHtcbiAgICAgICAgICBsb2NhbGUgPSBwYXJlbnRMb2NhbGU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5fd2FybmluZ3MucHVzaChgQW5ndWxhckNvbXBpbGVyUGx1Z2luOiBVbmFibGUgdG8gbG9hZCB0aGUgbG9jYWxlIGRhdGEgZmlsZSBgICtcbiAgICAgICAgICAgIGBcIkBhbmd1bGFyL2NvbW1vbi9sb2NhbGVzLyR7bG9jYWxlfVwiLCBgICtcbiAgICAgICAgICAgIGBwbGVhc2UgY2hlY2sgdGhhdCBcIiR7bG9jYWxlfVwiIGlzIGEgdmFsaWQgbG9jYWxlIGlkLlxuICAgICAgICAgICAgSWYgbmVlZGVkLCB5b3UgY2FuIHVzZSBcInJlZ2lzdGVyTG9jYWxlRGF0YVwiIG1hbnVhbGx5LmApO1xuXG4gICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbG9jYWxlO1xuICB9XG59XG4iXX0=