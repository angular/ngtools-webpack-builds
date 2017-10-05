"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const child_process_1 = require("child_process");
const path = require("path");
const ts = require("typescript");
const ContextElementDependency = require('webpack/lib/dependencies/ContextElementDependency');
const NodeWatchFileSystem = require('webpack/lib/node/NodeWatchFileSystem');
const treeKill = require('tree-kill');
const resource_loader_1 = require("./resource_loader");
const compiler_host_1 = require("./compiler_host");
const paths_plugin_1 = require("./paths-plugin");
const lazy_routes_1 = require("./lazy_routes");
const virtual_file_system_decorator_1 = require("./virtual_file_system_decorator");
const entry_resolver_1 = require("./entry_resolver");
const transformers_1 = require("./transformers");
const benchmark_1 = require("./benchmark");
const type_checker_1 = require("./type_checker");
const gather_diagnostics_1 = require("./gather_diagnostics");
const ngtools_api_1 = require("./ngtools_api");
var PLATFORM;
(function (PLATFORM) {
    PLATFORM[PLATFORM["Browser"] = 0] = "Browser";
    PLATFORM[PLATFORM["Server"] = 1] = "Server";
})(PLATFORM = exports.PLATFORM || (exports.PLATFORM = {}));
class AngularCompilerPlugin {
    constructor(options) {
        // Contains `moduleImportPath#exportName` => `fullModulePath`.
        this._lazyRoutes = Object.create(null);
        this._transformMap = new Map();
        this._JitMode = false;
        // Webpack plugin.
        this._firstRun = true;
        this._compiler = null;
        this._compilation = null;
        this._failedCompilation = false;
        // TypeChecker process.
        this._forkTypeChecker = true;
        ngtools_api_1.CompilerCliIsSupported();
        this._options = Object.assign({}, options);
        this._setupOptions(this._options);
    }
    get options() { return this._options; }
    get done() { return this._donePromise; }
    get failedCompilation() { return this._failedCompilation; }
    get entryModule() {
        const splitted = this._entryModule.split('#');
        const path = splitted[0];
        const className = splitted[1] || 'default';
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
        if (options.hasOwnProperty('basePath')) {
            basePath = path.resolve(process.cwd(), options.basePath);
        }
        this._basePath = basePath;
        // Read the tsconfig.
        const configResult = ts.readConfigFile(this._tsConfigPath, ts.sys.readFile);
        if (configResult.error) {
            const diagnostic = configResult.error;
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            if (diagnostic.file) {
                const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
                throw new Error(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message})`);
            }
            else {
                throw new Error(message);
            }
        }
        const tsConfigJson = configResult.config;
        // Extend compilerOptions.
        if (options.hasOwnProperty('compilerOptions')) {
            tsConfigJson.compilerOptions = Object.assign({}, tsConfigJson.compilerOptions, options.compilerOptions);
        }
        // Default exclude to **/*.spec.ts files.
        if (!options.hasOwnProperty('exclude')) {
            options['exclude'] = ['**/*.spec.ts'];
        }
        // Add custom excludes to default TypeScript excludes.
        if (options.hasOwnProperty('exclude')) {
            // If the tsconfig doesn't contain any excludes, we must add the default ones before adding
            // any extra ones (otherwise we'd include all of these which can cause unexpected errors).
            // This is the same logic as present in TypeScript.
            if (!tsConfigJson.exclude) {
                tsConfigJson['exclude'] = ['node_modules', 'bower_components', 'jspm_packages'];
                if (tsConfigJson.compilerOptions && tsConfigJson.compilerOptions.outDir) {
                    tsConfigJson.exclude.push(tsConfigJson.compilerOptions.outDir);
                }
            }
            // Join our custom excludes with the existing ones.
            tsConfigJson.exclude = tsConfigJson.exclude.concat(options.exclude);
        }
        // Parse the tsconfig contents.
        const tsConfig = ts.parseJsonConfigFileContent(tsConfigJson, ts.sys, basePath, undefined, this._tsConfigPath);
        this._tsFilenames = tsConfig.fileNames;
        this._compilerOptions = tsConfig.options;
        // Overwrite outDir so we can find generated files next to their .ts origin in compilerHost.
        this._compilerOptions.outDir = '';
        // Default plugin sourceMap to compiler options setting.
        if (!options.hasOwnProperty('sourceMap')) {
            options.sourceMap = this._compilerOptions.sourceMap || false;
        }
        // Force the right sourcemap options.
        if (options.sourceMap) {
            this._compilerOptions.sourceMap = true;
            this._compilerOptions.inlineSources = true;
            this._compilerOptions.inlineSourceMap = false;
            this._compilerOptions.sourceRoot = basePath;
        }
        else {
            this._compilerOptions.sourceMap = false;
            this._compilerOptions.sourceRoot = undefined;
            this._compilerOptions.inlineSources = undefined;
            this._compilerOptions.inlineSourceMap = undefined;
            this._compilerOptions.mapRoot = undefined;
        }
        // Compose Angular Compiler Options.
        this._angularCompilerOptions = Object.assign(this._compilerOptions, tsConfig.raw['angularCompilerOptions'], { basePath });
        // Set JIT (no code generation) or AOT mode.
        if (options.skipCodeGeneration !== undefined) {
            this._JitMode = options.skipCodeGeneration;
        }
        // Process i18n options.
        if (options.hasOwnProperty('i18nInFile')) {
            this._angularCompilerOptions.i18nInFile = options.i18nInFile;
        }
        if (options.hasOwnProperty('i18nInFormat')) {
            this._angularCompilerOptions.i18nInFormat = options.i18nInFormat;
        }
        if (options.hasOwnProperty('i18nOutFile')) {
            this._angularCompilerOptions.i18nOutFile = options.i18nOutFile;
        }
        if (options.hasOwnProperty('i18nOutFormat')) {
            this._angularCompilerOptions.i18nOutFormat = options.i18nOutFormat;
        }
        if (options.hasOwnProperty('locale') && options.locale) {
            this._angularCompilerOptions.i18nInLocale = this._validateLocale(options.locale);
        }
        if (options.hasOwnProperty('missingTranslation')) {
            this._angularCompilerOptions.i18nInMissingTranslations =
                options.missingTranslation;
        }
        // Use entryModule if available in options, otherwise resolve it from mainPath after program
        // creation.
        if (this._options.entryModule) {
            this._entryModule = this._options.entryModule;
        }
        else if (this._angularCompilerOptions.entryModule) {
            this._entryModule = path.resolve(this._basePath, this._angularCompilerOptions.entryModule);
        }
        // Create the webpack compiler host.
        this._compilerHost = new compiler_host_1.WebpackCompilerHost(this._compilerOptions, this._basePath);
        this._compilerHost.enableCaching();
        // Create and set a new WebpackResourceLoader.
        this._resourceLoader = new resource_loader_1.WebpackResourceLoader();
        this._compilerHost.setResourceLoader(this._resourceLoader);
        // Override some files in the FileSystem.
        if (this._options.hostOverrideFileSystem) {
            for (const filePath of Object.keys(this._options.hostOverrideFileSystem)) {
                this._compilerHost.writeFile(filePath, this._options.hostOverrideFileSystem[filePath], false);
            }
        }
        // Override some files in the FileSystem with paths from the actual file system.
        if (this._options.hostReplacementPaths) {
            for (const filePath of Object.keys(this._options.hostReplacementPaths)) {
                const replacementFilePath = this._options.hostReplacementPaths[filePath];
                const content = this._compilerHost.readFile(replacementFilePath);
                this._compilerHost.writeFile(filePath, content, false);
            }
        }
        // Set platform.
        this._platform = options.platform || PLATFORM.Browser;
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
    _createOrUpdateProgram() {
        const changedTsFiles = this._getChangedTsFiles();
        changedTsFiles.forEach((file) => {
            if (!this._tsFilenames.includes(file)) {
                // TODO: figure out if action is needed for files that were removed from the compilation.
                this._tsFilenames.push(file);
            }
        });
        // Update the forked type checker.
        if (this._forkTypeChecker && !this._firstRun) {
            this._updateForkedTypeChecker(changedTsFiles);
        }
        if (this._JitMode) {
            // Create the TypeScript program.
            benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
            this._program = ts.createProgram(this._tsFilenames, this._angularCompilerOptions, this._angularCompilerHost, this._program);
            benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ts.createProgram');
            return Promise.resolve();
        }
        else {
            benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
            // Create the Angular program.
            this._program = ngtools_api_1.createProgram({
                rootNames: this._tsFilenames,
                options: this._angularCompilerOptions,
                host: this._angularCompilerHost,
                oldProgram: this._program
            });
            benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.createProgram');
            benchmark_1.time('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync');
            return this._program.loadNgStructureAsync().then(() => benchmark_1.timeEnd('AngularCompilerPlugin._createOrUpdateProgram.ng.loadNgStructureAsync'));
        }
    }
    _getLazyRoutesFromNgtools() {
        try {
            benchmark_1.time('AngularCompilerPlugin._getLazyRoutesFromNgtools');
            const result = ngtools_api_1.__NGTOOLS_PRIVATE_API_2.listLazyRoutes({
                program: this._getTsProgram(),
                host: this._compilerHost,
                angularCompilerOptions: Object.assign({}, this._angularCompilerOptions, {
                    // genDir seems to still be needed in @angular\compiler-cli\src\compiler_host.js:226.
                    genDir: ''
                }),
                entryModule: this._entryModule
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
    // Process the lazy routes discovered, adding then to _lazyRoutes.
    // TODO: find a way to remove lazy routes that don't exist anymore.
    // This will require a registry of known references to a lazy route, removing it when no
    // module references it anymore.
    _processLazyRoutes(discoveredLazyRoutes) {
        Object.keys(discoveredLazyRoutes)
            .forEach(lazyRouteKey => {
            const [lazyRouteModule, moduleName] = lazyRouteKey.split('#');
            if (!lazyRouteModule || !moduleName) {
                return;
            }
            const lazyRouteTSFile = discoveredLazyRoutes[lazyRouteKey];
            let modulePath, moduleKey;
            if (this._JitMode) {
                modulePath = lazyRouteTSFile;
                moduleKey = lazyRouteKey;
            }
            else {
                modulePath = lazyRouteTSFile.replace(/(\.d)?\.ts$/, `.ngfactory.js`);
                moduleKey = `${lazyRouteModule}.ngfactory#${moduleName}NgFactory`;
            }
            if (moduleKey in this._lazyRoutes) {
                if (this._lazyRoutes[moduleKey] !== modulePath) {
                    // Found a duplicate, this is an error.
                    this._compilation.warnings.push(new Error(`Duplicated path in loadChildren detected during a rebuild. `
                        + `We will take the latest version detected and override it to save rebuild time. `
                        + `You should perform a full build to validate that your routes don't overlap.`));
                }
            }
            else {
                // Found a new route, add it to the map and read it into the compiler host.
                this._lazyRoutes[moduleKey] = modulePath;
                this._angularCompilerHost.readFile(lazyRouteTSFile);
                this._angularCompilerHost.invalidate(lazyRouteTSFile);
            }
        });
    }
    _createForkedTypeChecker() {
        // Bootstrap type checker is using local CLI.
        const g = global;
        const typeCheckerFile = g['angularCliIsLocal']
            ? './type_checker_bootstrap.js'
            : './type_checker.js';
        this._typeCheckerProcess = child_process_1.fork(path.resolve(__dirname, typeCheckerFile));
        this._typeCheckerProcess.send(new type_checker_1.InitMessage(this._compilerOptions, this._basePath, this._JitMode, this._tsFilenames));
        // Cleanup.
        const killTypeCheckerProcess = () => {
            treeKill(this._typeCheckerProcess.pid, 'SIGTERM');
            process.exit();
        };
        process.on('exit', killTypeCheckerProcess);
        process.on('SIGINT', killTypeCheckerProcess);
        process.on('uncaughtException', killTypeCheckerProcess);
    }
    _updateForkedTypeChecker(changedTsFiles) {
        this._typeCheckerProcess.send(new type_checker_1.UpdateMessage(changedTsFiles));
    }
    // Registration hook for webpack plugin.
    apply(compiler) {
        this._compiler = compiler;
        // Decorate inputFileSystem to serve contents of CompilerHost.
        // Use decorated inputFileSystem in watchFileSystem.
        compiler.plugin('environment', () => {
            compiler.inputFileSystem = new virtual_file_system_decorator_1.VirtualFileSystemDecorator(compiler.inputFileSystem, this._compilerHost);
            compiler.watchFileSystem = new NodeWatchFileSystem(compiler.inputFileSystem);
        });
        // Add lazy modules to the context module for @angular/core
        compiler.plugin('context-module-factory', (cmf) => {
            const angularCorePackagePath = require.resolve('@angular/core/package.json');
            const angularCorePackageJson = require(angularCorePackagePath);
            const angularCoreModulePath = path.resolve(path.dirname(angularCorePackagePath), angularCorePackageJson['module']);
            // Pick the last part after the last node_modules instance. We do this to let people have
            // a linked @angular/core or cli which would not be under the same path as the project
            // being built.
            const angularCoreModuleDir = path.dirname(angularCoreModulePath).split(/node_modules/).pop();
            // Also support the es2015 in Angular versions that have it.
            let angularCoreEs2015Dir;
            if (angularCorePackageJson['es2015']) {
                const angularCoreEs2015Path = path.resolve(path.dirname(angularCorePackagePath), angularCorePackageJson['es2015']);
                angularCoreEs2015Dir = path.dirname(angularCoreEs2015Path).split(/node_modules/).pop();
            }
            cmf.plugin('after-resolve', (result, callback) => {
                if (!result) {
                    return callback();
                }
                // Alter only request from Angular.
                if (!(angularCoreModuleDir && result.resource.endsWith(angularCoreModuleDir))
                    && !(angularCoreEs2015Dir && result.resource.endsWith(angularCoreEs2015Dir))) {
                    return callback(null, result);
                }
                this.done.then(() => {
                    // This folder does not exist, but we need to give webpack a resource.
                    // TODO: check if we can't just leave it as is (angularCoreModuleDir).
                    result.resource = path.join(this._basePath, '$$_lazy_route_resource');
                    result.dependencies.forEach((d) => d.critical = false);
                    result.resolveDependencies = (_fs, _resource, _recursive, _regExp, cb) => {
                        const dependencies = Object.keys(this._lazyRoutes)
                            .map((key) => {
                            const modulePath = this._lazyRoutes[key];
                            const importPath = key.split('#')[0];
                            if (modulePath !== null) {
                                return new ContextElementDependency(modulePath, importPath);
                            }
                            else {
                                return null;
                            }
                        })
                            .filter(x => !!x);
                        cb(null, dependencies);
                    };
                    return callback(null, result);
                }, () => callback(null))
                    .catch(err => callback(err));
            });
        });
        // Remake the plugin on each compilation.
        compiler.plugin('make', (compilation, cb) => this._make(compilation, cb));
        compiler.plugin('invalid', () => this._firstRun = false);
        compiler.plugin('after-emit', (compilation, cb) => {
            compilation._ngToolsWebpackPluginInstance = null;
            cb();
        });
        compiler.plugin('done', () => {
            this._donePromise = null;
            this._compilation = null;
            this._failedCompilation = false;
        });
        // TODO: consider if it's better to remove this plugin and instead make it wait on the
        // VirtualFileSystemDecorator.
        compiler.plugin('after-resolvers', (compiler) => {
            // Virtual file system.
            // Wait for the plugin to be done when requesting `.ts` files directly (entry points), or
            // when the issuer is a `.ts` or `.ngfactory.js` file.
            compiler.resolvers.normal.plugin('before-resolve', (request, cb) => {
                if (request.request.endsWith('.ts')
                    || (request.context.issuer && /\.ts|ngfactory\.js$/.test(request.context.issuer))) {
                    this.done.then(() => cb(), () => cb());
                }
                else {
                    cb();
                }
            });
        });
        compiler.plugin('normal-module-factory', (nmf) => {
            compiler.resolvers.normal.apply(new paths_plugin_1.PathsPlugin({
                nmf,
                tsConfigPath: this._tsConfigPath,
                compilerOptions: this._compilerOptions,
                compilerHost: this._compilerHost
            }));
        });
    }
    _make(compilation, cb) {
        benchmark_1.time('AngularCompilerPlugin._make');
        this._compilation = compilation;
        if (this._compilation._ngToolsWebpackPluginInstance) {
            return cb(new Error('An @ngtools/webpack plugin already exist for this compilation.'));
        }
        // Set a private variable for this plugin instance.
        this._compilation._ngToolsWebpackPluginInstance = this;
        // Update the resource loader with the new webpack compilation.
        this._resourceLoader.update(compilation);
        this._donePromise = Promise.resolve()
            .then(() => {
            // Create a new process for the type checker.
            if (this._forkTypeChecker && !this._firstRun && !this._typeCheckerProcess) {
                this._createForkedTypeChecker();
            }
        })
            .then(() => {
            if (this._firstRun) {
                // Use the WebpackResourceLoader with a resource loader to create an AngularCompilerHost.
                this._angularCompilerHost = ngtools_api_1.createCompilerHost({
                    options: this._angularCompilerOptions,
                    tsHost: this._compilerHost
                });
                return this._createOrUpdateProgram()
                    .then(() => {
                    // If there's still no entryModule try to resolve from mainPath.
                    if (!this._entryModule && this._options.mainPath) {
                        benchmark_1.time('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
                        const mainPath = path.resolve(this._basePath, this._options.mainPath);
                        this._entryModule = entry_resolver_1.resolveEntryModuleFromMain(mainPath, this._compilerHost, this._getTsProgram());
                        benchmark_1.timeEnd('AngularCompilerPlugin._make.resolveEntryModuleFromMain');
                    }
                });
            }
        })
            .then(() => this._update())
            .then(() => {
            benchmark_1.timeEnd('AngularCompilerPlugin._make');
            cb();
        }, (err) => {
            this._failedCompilation = true;
            compilation.errors.push(err.stack);
            benchmark_1.timeEnd('AngularCompilerPlugin._make');
            cb();
        });
    }
    _update() {
        // We only want to update on TS and template changes, but all kinds of files are on this
        // list, like package.json and .ngsummary.json files.
        benchmark_1.time('AngularCompilerPlugin._update');
        let changedFiles = this._compilerHost.getChangedFilePaths()
            .filter(k => /(ts|html|css|scss|sass|less|styl)/.test(k));
        return Promise.resolve()
            .then(() => {
            // Try to find lazy routes.
            // We need to run the `listLazyRoutes` the first time because it also navigates libraries
            // and other things that we might miss using the (faster) findLazyRoutesInAst.
            // Lazy routes modules will be read with compilerHost and added to the changed files.
            const changedTsFiles = this._compilerHost.getChangedFilePaths()
                .filter(k => k.endsWith('.ts'));
            if (this._firstRun) {
                this._processLazyRoutes(this._getLazyRoutesFromNgtools());
            }
            else if (changedTsFiles.length > 0) {
                this._processLazyRoutes(this._findLazyRoutesInAst(changedTsFiles));
            }
        })
            .then(() => {
            // Make a new program and load the Angular structure if there are changes.
            if (changedFiles.length > 0) {
                return this._createOrUpdateProgram();
            }
        })
            .then(() => {
            // Build transforms, emit and report errors if there are changes or it's the first run.
            if (changedFiles.length > 0 || this._firstRun) {
                // We now have the final list of changed TS files.
                // Go through each changed file and add transforms as needed.
                const sourceFiles = this._getChangedTsFiles().map((fileName) => {
                    benchmark_1.time('AngularCompilerPlugin._update.getSourceFile');
                    const sourceFile = this._getTsProgram().getSourceFile(fileName);
                    if (!sourceFile) {
                        throw new Error(`${fileName} is not part of the TypeScript compilation. `
                            + `Please include it in your tsconfig via the 'files' or 'include' property.`);
                    }
                    benchmark_1.timeEnd('AngularCompilerPlugin._update.getSourceFile');
                    return sourceFile;
                });
                benchmark_1.time('AngularCompilerPlugin._update.transformOps');
                sourceFiles.forEach((sf) => {
                    const fileName = this._compilerHost.resolve(sf.fileName);
                    let transformOps = [];
                    if (this._JitMode) {
                        transformOps.push(...transformers_1.replaceResources(sf));
                    }
                    if (this._platform === PLATFORM.Browser) {
                        if (!this._JitMode) {
                            transformOps.push(...transformers_1.replaceBootstrap(sf, this.entryModule));
                        }
                        // If we have a locale, auto import the locale data file.
                        if (this._angularCompilerOptions.i18nInLocale) {
                            transformOps.push(...transformers_1.registerLocaleData(sf, this.entryModule, this._angularCompilerOptions.i18nInLocale));
                        }
                    }
                    else if (this._platform === PLATFORM.Server) {
                        if (fileName === this._compilerHost.resolve(this._options.mainPath)) {
                            transformOps.push(...transformers_1.exportLazyModuleMap(sf, this._lazyRoutes));
                            if (!this._JitMode) {
                                transformOps.push(...transformers_1.exportNgFactory(sf, this.entryModule));
                            }
                        }
                    }
                    // We need to keep a map of transforms for each file, to reapply on each update.
                    this._transformMap.set(fileName, transformOps);
                });
                const transformOps = [];
                for (let fileTransformOps of this._transformMap.values()) {
                    transformOps.push(...fileTransformOps);
                }
                benchmark_1.timeEnd('AngularCompilerPlugin._update.transformOps');
                benchmark_1.time('AngularCompilerPlugin._update.makeTransform');
                const transformers = {
                    beforeTs: transformOps.length > 0 ? [transformers_1.makeTransform(transformOps)] : []
                };
                benchmark_1.timeEnd('AngularCompilerPlugin._update.makeTransform');
                // Emit files.
                benchmark_1.time('AngularCompilerPlugin._update._emit');
                const { emitResult, diagnostics } = this._emit(sourceFiles, transformers);
                benchmark_1.timeEnd('AngularCompilerPlugin._update._emit');
                // Report diagnostics.
                const errors = diagnostics
                    .filter((diag) => diag.category === ts.DiagnosticCategory.Error);
                const warnings = diagnostics
                    .filter((diag) => diag.category === ts.DiagnosticCategory.Warning);
                if (errors.length > 0) {
                    const message = ngtools_api_1.formatDiagnostics(this._angularCompilerOptions, errors);
                    this._compilation.errors.push(message);
                }
                if (warnings.length > 0) {
                    const message = ngtools_api_1.formatDiagnostics(this._angularCompilerOptions, warnings);
                    this._compilation.warnings.push(message);
                }
                // Reset changed files on successful compilation.
                if (emitResult && !emitResult.emitSkipped && this._compilation.errors.length === 0) {
                    this._compilerHost.resetChangedFileTracker();
                }
                else {
                    this._failedCompilation = true;
                }
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
        const i18nOutFilePath = path.resolve(this._basePath, this._angularCompilerOptions.i18nOutFile);
        const i18nOutFileContent = this._compilerHost.readFile(i18nOutFilePath);
        if (i18nOutFileContent) {
            _recursiveMkDir(path.dirname(i18nOutFilePath))
                .then(() => fs.writeFileSync(i18nOutFilePath, i18nOutFileContent));
        }
    }
    getFile(fileName) {
        const outputFile = fileName.replace(/.ts$/, '.js');
        return {
            outputText: this._compilerHost.readFile(outputFile),
            sourceMap: this._compilerHost.readFile(outputFile + '.map')
        };
    }
    // This code mostly comes from `performCompilation` in `@angular/compiler-cli`.
    // It skips the program creation because we need to use `loadNgStructureAsync()`,
    // and uses CustomTransformers.
    _emit(sourceFiles, customTransformers) {
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
                if (this._firstRun || !this._forkTypeChecker) {
                    allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'AngularCompilerPlugin._emit.ts'));
                }
                if (!gather_diagnostics_1.hasErrors(allDiagnostics)) {
                    sourceFiles.forEach((sf) => {
                        const timeLabel = `AngularCompilerPlugin._emit.ts+${sf.fileName}+.emit`;
                        benchmark_1.time(timeLabel);
                        emitResult = tsProgram.emit(sf, undefined, undefined, undefined, { before: customTransformers.beforeTs });
                        allDiagnostics.push(...emitResult.diagnostics);
                        benchmark_1.timeEnd(timeLabel);
                    });
                }
            }
            else {
                const angularProgram = program;
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
                if (this._firstRun || !this._forkTypeChecker) {
                    allDiagnostics.push(...gather_diagnostics_1.gatherDiagnostics(this._program, this._JitMode, 'AngularCompilerPlugin._emit.ng'));
                }
                if (!gather_diagnostics_1.hasErrors(allDiagnostics)) {
                    benchmark_1.time('AngularCompilerPlugin._emit.ng.emit');
                    const extractI18n = !!this._angularCompilerOptions.i18nOutFile;
                    const emitFlags = extractI18n ? ngtools_api_1.EmitFlags.I18nBundle : ngtools_api_1.EmitFlags.Default;
                    emitResult = angularProgram.emit({ emitFlags, customTransformers });
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
                return error['ngSyntaxError'];
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
                this._program = undefined;
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
                    throw new Error(`Unable to load the locale data file "@angular/common/locales/${locale}", ` +
                        `please check that "${locale}" is a valid locale id.`);
                }
            }
        }
        return locale;
    }
}
exports.AngularCompilerPlugin = AngularCompilerPlugin;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/angular_compiler_plugin.js.map