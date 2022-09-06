"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AngularWebpackPlugin = void 0;
const assert_1 = require("assert");
const ts = __importStar(require("typescript"));
const ngcc_processor_1 = require("../ngcc_processor");
const paths_plugin_1 = require("../paths-plugin");
const resource_loader_1 = require("../resource_loader");
const cache_1 = require("./cache");
const diagnostics_1 = require("./diagnostics");
const host_1 = require("./host");
const paths_1 = require("./paths");
const symbol_1 = require("./symbol");
const system_1 = require("./system");
const transformation_1 = require("./transformation");
/**
 * The threshold used to determine whether Angular file diagnostics should optimize for full programs
 * or single files. If the number of affected files for a build is more than the threshold, full
 * program optimization will be used.
 */
const DIAGNOSTICS_AFFECTED_THRESHOLD = 1;
function initializeNgccProcessor(compiler, tsconfig, compilerNgccModule) {
    var _a, _b, _c;
    const { inputFileSystem, options: webpackOptions } = compiler;
    const mainFields = (_c = (_b = (_a = webpackOptions.resolve) === null || _a === void 0 ? void 0 : _a.mainFields) === null || _b === void 0 ? void 0 : _b.flat()) !== null && _c !== void 0 ? _c : [];
    const errors = [];
    const warnings = [];
    const resolver = compiler.resolverFactory.get('normal', {
        // Caching must be disabled because it causes the resolver to become async after a rebuild
        cache: false,
        extensions: ['.json'],
        useSyncFileSystemCalls: true,
    });
    // The compilerNgccModule field is guaranteed to be defined during a compilation
    // due to the `beforeCompile` hook. Usage of this property accessor prior to the
    // hook execution is an implementation error.
    assert_1.strict.ok(compilerNgccModule, `'@angular/compiler-cli/ngcc' used prior to Webpack compilation.`);
    const processor = new ngcc_processor_1.NgccProcessor(compilerNgccModule, mainFields, warnings, errors, compiler.context, tsconfig, inputFileSystem, resolver);
    return { processor, errors, warnings };
}
const PLUGIN_NAME = 'angular-compiler';
const compilationFileEmitters = new WeakMap();
class AngularWebpackPlugin {
    constructor(options = {}) {
        this.fileDependencies = new Map();
        this.requiredFilesToEmit = new Set();
        this.requiredFilesToEmitCache = new Map();
        this.fileEmitHistory = new Map();
        this.pluginOptions = {
            emitClassMetadata: false,
            emitNgModuleScope: false,
            jitMode: false,
            fileReplacements: {},
            substitutions: {},
            directTemplateLoading: true,
            tsconfig: 'tsconfig.json',
            ...options,
        };
    }
    get compilerCli() {
        // The compilerCliModule field is guaranteed to be defined during a compilation
        // due to the `beforeCompile` hook. Usage of this property accessor prior to the
        // hook execution is an implementation error.
        assert_1.strict.ok(this.compilerCliModule, `'@angular/compiler-cli' used prior to Webpack compilation.`);
        return this.compilerCliModule;
    }
    get options() {
        return this.pluginOptions;
    }
    apply(compiler) {
        const { NormalModuleReplacementPlugin, WebpackError, util } = compiler.webpack;
        this.webpackCreateHash = util.createHash;
        // Setup file replacements with webpack
        for (const [key, value] of Object.entries(this.pluginOptions.fileReplacements)) {
            new NormalModuleReplacementPlugin(new RegExp('^' + key.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&') + '$'), value).apply(compiler);
        }
        // Set resolver options
        const pathsPlugin = new paths_plugin_1.TypeScriptPathsPlugin();
        compiler.hooks.afterResolvers.tap(PLUGIN_NAME, (compiler) => {
            // When Ivy is enabled we need to add the fields added by NGCC
            // to take precedence over the provided mainFields.
            // NGCC adds fields in package.json suffixed with '_ivy_ngcc'
            // Example: module -> module__ivy_ngcc
            compiler.resolverFactory.hooks.resolveOptions
                .for('normal')
                .tap(PLUGIN_NAME, (resolveOptions) => {
                var _a, _b;
                const originalMainFields = resolveOptions.mainFields;
                const ivyMainFields = (_a = originalMainFields === null || originalMainFields === void 0 ? void 0 : originalMainFields.flat().map((f) => `${f}_ivy_ngcc`)) !== null && _a !== void 0 ? _a : [];
                (_b = resolveOptions.plugins) !== null && _b !== void 0 ? _b : (resolveOptions.plugins = []);
                resolveOptions.plugins.push(pathsPlugin);
                // https://github.com/webpack/webpack/issues/11635#issuecomment-707016779
                return util.cleverMerge(resolveOptions, { mainFields: [...ivyMainFields, '...'] });
            });
        });
        // Load the compiler-cli if not already available
        compiler.hooks.beforeCompile.tapPromise(PLUGIN_NAME, () => this.initializeCompilerCli());
        const compilationState = { pathsPlugin };
        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
            try {
                this.setupCompilation(compilation, compilationState);
            }
            catch (error) {
                compilation.errors.push(new WebpackError(`Failed to initialize Angular compilation - ${error instanceof Error ? error.message : error}`));
            }
        });
    }
    setupCompilation(compilation, state) {
        const compiler = compilation.compiler;
        // Register plugin to ensure deterministic emit order in multi-plugin usage
        const emitRegistration = this.registerWithCompilation(compilation);
        this.watchMode = compiler.watchMode;
        // Initialize webpack cache
        if (!this.webpackCache && compilation.options.cache) {
            this.webpackCache = compilation.getCache(PLUGIN_NAME);
        }
        // Initialize the resource loader if not already setup
        if (!state.resourceLoader) {
            state.resourceLoader = new resource_loader_1.WebpackResourceLoader(this.watchMode);
        }
        // Initialize and process eager ngcc if not already setup
        if (!state.ngccProcessor) {
            const { processor, errors, warnings } = initializeNgccProcessor(compiler, this.pluginOptions.tsconfig, this.compilerNgccModule);
            processor.process();
            warnings.forEach((warning) => (0, diagnostics_1.addWarning)(compilation, warning));
            errors.forEach((error) => (0, diagnostics_1.addError)(compilation, error));
            state.ngccProcessor = processor;
        }
        // Setup and read TypeScript and Angular compiler configuration
        const { compilerOptions, rootNames, errors } = this.loadConfiguration();
        // Create diagnostics reporter and report configuration file errors
        const diagnosticsReporter = (0, diagnostics_1.createDiagnosticsReporter)(compilation, (diagnostic) => this.compilerCli.formatDiagnostics([diagnostic]));
        diagnosticsReporter(errors);
        // Update TypeScript path mapping plugin with new configuration
        state.pathsPlugin.update(compilerOptions);
        // Create a Webpack-based TypeScript compiler host
        const system = (0, system_1.createWebpackSystem)(
        // Webpack lacks an InputFileSytem type definition with sync functions
        compiler.inputFileSystem, (0, paths_1.normalizePath)(compiler.context));
        const host = ts.createIncrementalCompilerHost(compilerOptions, system);
        // Setup source file caching and reuse cache from previous compilation if present
        let cache = this.sourceFileCache;
        let changedFiles;
        if (cache) {
            changedFiles = new Set();
            for (const changedFile of [...compiler.modifiedFiles, ...compiler.removedFiles]) {
                const normalizedChangedFile = (0, paths_1.normalizePath)(changedFile);
                // Invalidate file dependencies
                this.fileDependencies.delete(normalizedChangedFile);
                // Invalidate existing cache
                cache.invalidate(normalizedChangedFile);
                changedFiles.add(normalizedChangedFile);
            }
        }
        else {
            // Initialize a new cache
            cache = new cache_1.SourceFileCache();
            // Only store cache if in watch mode
            if (this.watchMode) {
                this.sourceFileCache = cache;
            }
        }
        (0, host_1.augmentHostWithCaching)(host, cache);
        const moduleResolutionCache = ts.createModuleResolutionCache(host.getCurrentDirectory(), host.getCanonicalFileName.bind(host), compilerOptions);
        // Setup source file dependency collection
        (0, host_1.augmentHostWithDependencyCollection)(host, this.fileDependencies, moduleResolutionCache);
        // Setup on demand ngcc
        (0, host_1.augmentHostWithNgcc)(host, state.ngccProcessor, moduleResolutionCache);
        // Setup resource loading
        state.resourceLoader.update(compilation, changedFiles);
        (0, host_1.augmentHostWithResources)(host, state.resourceLoader, {
            directTemplateLoading: this.pluginOptions.directTemplateLoading,
            inlineStyleFileExtension: this.pluginOptions.inlineStyleFileExtension,
        });
        // Setup source file adjustment options
        (0, host_1.augmentHostWithReplacements)(host, this.pluginOptions.fileReplacements, moduleResolutionCache);
        (0, host_1.augmentHostWithSubstitutions)(host, this.pluginOptions.substitutions);
        // Create the file emitter used by the webpack loader
        const { fileEmitter, builder, internalFiles } = this.pluginOptions.jitMode
            ? this.updateJitProgram(compilerOptions, rootNames, host, diagnosticsReporter)
            : this.updateAotProgram(compilerOptions, rootNames, host, diagnosticsReporter, state.resourceLoader);
        // Set of files used during the unused TypeScript file analysis
        const currentUnused = new Set();
        for (const sourceFile of builder.getSourceFiles()) {
            if (internalFiles === null || internalFiles === void 0 ? void 0 : internalFiles.has(sourceFile)) {
                continue;
            }
            // Ensure all program files are considered part of the compilation and will be watched.
            // Webpack does not normalize paths. Therefore, we need to normalize the path with FS seperators.
            compilation.fileDependencies.add((0, paths_1.externalizePath)(sourceFile.fileName));
            // Add all non-declaration files to the initial set of unused files. The set will be
            // analyzed and pruned after all Webpack modules are finished building.
            if (!sourceFile.isDeclarationFile) {
                currentUnused.add((0, paths_1.normalizePath)(sourceFile.fileName));
            }
        }
        compilation.hooks.finishModules.tapPromise(PLUGIN_NAME, async (modules) => {
            var _a, _b;
            // Rebuild any remaining AOT required modules
            await this.rebuildRequiredFiles(modules, compilation, fileEmitter);
            // Clear out the Webpack compilation to avoid an extra retaining reference
            (_a = state.resourceLoader) === null || _a === void 0 ? void 0 : _a.clearParentCompilation();
            // Analyze program for unused files
            if (compilation.errors.length > 0) {
                return;
            }
            for (const webpackModule of modules) {
                const resource = webpackModule.resource;
                if (resource) {
                    this.markResourceUsed((0, paths_1.normalizePath)(resource), currentUnused);
                }
            }
            for (const unused of currentUnused) {
                if ((_b = state.previousUnused) === null || _b === void 0 ? void 0 : _b.has(unused)) {
                    continue;
                }
                (0, diagnostics_1.addWarning)(compilation, `${unused} is part of the TypeScript compilation but it's unused.\n` +
                    `Add only entry points to the 'files' or 'include' properties in your tsconfig.`);
            }
            state.previousUnused = currentUnused;
        });
        // Store file emitter for loader usage
        emitRegistration.update(fileEmitter);
    }
    registerWithCompilation(compilation) {
        let fileEmitters = compilationFileEmitters.get(compilation);
        if (!fileEmitters) {
            fileEmitters = new symbol_1.FileEmitterCollection();
            compilationFileEmitters.set(compilation, fileEmitters);
            compilation.compiler.webpack.NormalModule.getCompilationHooks(compilation).loader.tap(PLUGIN_NAME, (loaderContext) => {
                loaderContext[symbol_1.AngularPluginSymbol] = fileEmitters;
            });
        }
        const emitRegistration = fileEmitters.register();
        return emitRegistration;
    }
    markResourceUsed(normalizedResourcePath, currentUnused) {
        if (!currentUnused.has(normalizedResourcePath)) {
            return;
        }
        currentUnused.delete(normalizedResourcePath);
        const dependencies = this.fileDependencies.get(normalizedResourcePath);
        if (!dependencies) {
            return;
        }
        for (const dependency of dependencies) {
            this.markResourceUsed((0, paths_1.normalizePath)(dependency), currentUnused);
        }
    }
    async rebuildRequiredFiles(modules, compilation, fileEmitter) {
        if (this.requiredFilesToEmit.size === 0) {
            return;
        }
        const filesToRebuild = new Set();
        for (const requiredFile of this.requiredFilesToEmit) {
            const history = await this.getFileEmitHistory(requiredFile);
            if (history) {
                const emitResult = await fileEmitter(requiredFile);
                if ((emitResult === null || emitResult === void 0 ? void 0 : emitResult.content) === undefined ||
                    history.length !== emitResult.content.length ||
                    emitResult.hash === undefined ||
                    Buffer.compare(history.hash, emitResult.hash) !== 0) {
                    // New emit result is different so rebuild using new emit result
                    this.requiredFilesToEmitCache.set(requiredFile, emitResult);
                    filesToRebuild.add(requiredFile);
                }
            }
            else {
                // No emit history so rebuild
                filesToRebuild.add(requiredFile);
            }
        }
        if (filesToRebuild.size > 0) {
            const rebuild = (webpackModule) => new Promise((resolve) => compilation.rebuildModule(webpackModule, () => resolve()));
            const modulesToRebuild = [];
            for (const webpackModule of modules) {
                const resource = webpackModule.resource;
                if (resource && filesToRebuild.has((0, paths_1.normalizePath)(resource))) {
                    modulesToRebuild.push(webpackModule);
                }
            }
            await Promise.all(modulesToRebuild.map((webpackModule) => rebuild(webpackModule)));
        }
        this.requiredFilesToEmit.clear();
        this.requiredFilesToEmitCache.clear();
    }
    loadConfiguration() {
        const { options: compilerOptions, rootNames, errors, } = this.compilerCli.readConfiguration(this.pluginOptions.tsconfig, this.pluginOptions.compilerOptions);
        compilerOptions.noEmitOnError = false;
        compilerOptions.suppressOutputPathCheck = true;
        compilerOptions.outDir = undefined;
        compilerOptions.inlineSources = compilerOptions.sourceMap;
        compilerOptions.inlineSourceMap = false;
        compilerOptions.mapRoot = undefined;
        compilerOptions.sourceRoot = undefined;
        compilerOptions.allowEmptyCodegenFiles = false;
        compilerOptions.annotationsAs = 'decorators';
        compilerOptions.enableResourceInlining = false;
        return { compilerOptions, rootNames, errors };
    }
    updateAotProgram(compilerOptions, rootNames, host, diagnosticsReporter, resourceLoader) {
        // Create the Angular specific program that contains the Angular compiler
        const angularProgram = new this.compilerCli.NgtscProgram(rootNames, compilerOptions, host, this.ngtscNextProgram);
        const angularCompiler = angularProgram.compiler;
        // The `ignoreForEmit` return value can be safely ignored when emitting. Only files
        // that will be bundled (requested by Webpack) will be emitted. Combined with TypeScript's
        // eliding of type only imports, this will cause type only files to be automatically ignored.
        // Internal Angular type check files are also not resolvable by the bundler. Even if they
        // were somehow errantly imported, the bundler would error before an emit was attempted.
        // Diagnostics are still collected for all files which requires using `ignoreForDiagnostics`.
        const { ignoreForDiagnostics, ignoreForEmit } = angularCompiler;
        // SourceFile versions are required for builder programs.
        // The wrapped host inside NgtscProgram adds additional files that will not have versions.
        const typeScriptProgram = angularProgram.getTsProgram();
        (0, host_1.augmentProgramWithVersioning)(typeScriptProgram);
        let builder;
        if (this.watchMode) {
            builder = this.builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(typeScriptProgram, host, this.builder);
            this.ngtscNextProgram = angularProgram;
        }
        else {
            // When not in watch mode, the startup cost of the incremental analysis can be avoided by
            // using an abstract builder that only wraps a TypeScript program.
            builder = ts.createAbstractBuilder(typeScriptProgram, host);
        }
        // Update semantic diagnostics cache
        const affectedFiles = new Set();
        // Analyze affected files when in watch mode for incremental type checking
        if ('getSemanticDiagnosticsOfNextAffectedFile' in builder) {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const result = builder.getSemanticDiagnosticsOfNextAffectedFile(undefined, (sourceFile) => {
                    // If the affected file is a TTC shim, add the shim's original source file.
                    // This ensures that changes that affect TTC are typechecked even when the changes
                    // are otherwise unrelated from a TS perspective and do not result in Ivy codegen changes.
                    // For example, changing @Input property types of a directive used in another component's
                    // template.
                    if (ignoreForDiagnostics.has(sourceFile) &&
                        sourceFile.fileName.endsWith('.ngtypecheck.ts')) {
                        // This file name conversion relies on internal compiler logic and should be converted
                        // to an official method when available. 15 is length of `.ngtypecheck.ts`
                        const originalFilename = sourceFile.fileName.slice(0, -15) + '.ts';
                        const originalSourceFile = builder.getSourceFile(originalFilename);
                        if (originalSourceFile) {
                            affectedFiles.add(originalSourceFile);
                        }
                        return true;
                    }
                    return false;
                });
                if (!result) {
                    break;
                }
                affectedFiles.add(result.affected);
            }
        }
        // Collect program level diagnostics
        const diagnostics = [
            ...angularCompiler.getOptionDiagnostics(),
            ...builder.getOptionsDiagnostics(),
            ...builder.getGlobalDiagnostics(),
        ];
        diagnosticsReporter(diagnostics);
        // Collect source file specific diagnostics
        for (const sourceFile of builder.getSourceFiles()) {
            if (!ignoreForDiagnostics.has(sourceFile)) {
                diagnosticsReporter(builder.getSyntacticDiagnostics(sourceFile));
                diagnosticsReporter(builder.getSemanticDiagnostics(sourceFile));
            }
        }
        const transformers = (0, transformation_1.createAotTransformers)(builder, this.pluginOptions);
        const getDependencies = (sourceFile) => {
            const dependencies = [];
            for (const resourcePath of angularCompiler.getResourceDependencies(sourceFile)) {
                dependencies.push(resourcePath, 
                // Retrieve all dependencies of the resource (stylesheet imports, etc.)
                ...resourceLoader.getResourceDependencies(resourcePath));
            }
            return dependencies;
        };
        // Required to support asynchronous resource loading
        // Must be done before creating transformers or getting template diagnostics
        const pendingAnalysis = angularCompiler
            .analyzeAsync()
            .then(() => {
            var _a;
            this.requiredFilesToEmit.clear();
            for (const sourceFile of builder.getSourceFiles()) {
                if (sourceFile.isDeclarationFile) {
                    continue;
                }
                // Collect sources that are required to be emitted
                if (!ignoreForEmit.has(sourceFile) &&
                    !angularCompiler.incrementalDriver.safeToSkipEmit(sourceFile)) {
                    this.requiredFilesToEmit.add((0, paths_1.normalizePath)(sourceFile.fileName));
                    // If required to emit, diagnostics may have also changed
                    if (!ignoreForDiagnostics.has(sourceFile)) {
                        affectedFiles.add(sourceFile);
                    }
                }
                else if (this.sourceFileCache &&
                    !affectedFiles.has(sourceFile) &&
                    !ignoreForDiagnostics.has(sourceFile)) {
                    // Use cached Angular diagnostics for unchanged and unaffected files
                    const angularDiagnostics = this.sourceFileCache.getAngularDiagnostics(sourceFile);
                    if (angularDiagnostics) {
                        diagnosticsReporter(angularDiagnostics);
                    }
                }
            }
            // Collect new Angular diagnostics for files affected by changes
            const OptimizeFor = this.compilerCli.OptimizeFor;
            const optimizeDiagnosticsFor = affectedFiles.size <= DIAGNOSTICS_AFFECTED_THRESHOLD
                ? OptimizeFor.SingleFile
                : OptimizeFor.WholeProgram;
            for (const affectedFile of affectedFiles) {
                const angularDiagnostics = angularCompiler.getDiagnosticsForFile(affectedFile, optimizeDiagnosticsFor);
                diagnosticsReporter(angularDiagnostics);
                (_a = this.sourceFileCache) === null || _a === void 0 ? void 0 : _a.updateAngularDiagnostics(affectedFile, angularDiagnostics);
            }
            return {
                emitter: this.createFileEmitter(builder, (0, transformation_1.mergeTransformers)(angularCompiler.prepareEmit().transformers, transformers), getDependencies, (sourceFile) => {
                    this.requiredFilesToEmit.delete((0, paths_1.normalizePath)(sourceFile.fileName));
                    angularCompiler.incrementalDriver.recordSuccessfulEmit(sourceFile);
                }),
            };
        })
            .catch((err) => ({ errorMessage: err instanceof Error ? err.message : `${err}` }));
        const analyzingFileEmitter = async (file) => {
            const analysis = await pendingAnalysis;
            if ('errorMessage' in analysis) {
                throw new Error(analysis.errorMessage);
            }
            return analysis.emitter(file);
        };
        return {
            fileEmitter: analyzingFileEmitter,
            builder,
            internalFiles: ignoreForEmit,
        };
    }
    updateJitProgram(compilerOptions, rootNames, host, diagnosticsReporter) {
        let builder;
        if (this.watchMode) {
            builder = this.builder = ts.createEmitAndSemanticDiagnosticsBuilderProgram(rootNames, compilerOptions, host, this.builder);
        }
        else {
            // When not in watch mode, the startup cost of the incremental analysis can be avoided by
            // using an abstract builder that only wraps a TypeScript program.
            builder = ts.createAbstractBuilder(rootNames, compilerOptions, host);
        }
        const diagnostics = [
            ...builder.getOptionsDiagnostics(),
            ...builder.getGlobalDiagnostics(),
            ...builder.getSyntacticDiagnostics(),
            // Gather incremental semantic diagnostics
            ...builder.getSemanticDiagnostics(),
        ];
        diagnosticsReporter(diagnostics);
        const transformers = (0, transformation_1.createJitTransformers)(builder, this.compilerCli, this.pluginOptions);
        return {
            fileEmitter: this.createFileEmitter(builder, transformers, () => []),
            builder,
            internalFiles: undefined,
        };
    }
    createFileEmitter(program, transformers = {}, getExtraDependencies, onAfterEmit) {
        return async (file) => {
            const filePath = (0, paths_1.normalizePath)(file);
            if (this.requiredFilesToEmitCache.has(filePath)) {
                return this.requiredFilesToEmitCache.get(filePath);
            }
            const sourceFile = program.getSourceFile(filePath);
            if (!sourceFile) {
                return undefined;
            }
            let content;
            let map;
            program.emit(sourceFile, (filename, data) => {
                if (filename.endsWith('.map')) {
                    map = data;
                }
                else if (filename.endsWith('.js')) {
                    content = data;
                }
            }, undefined, undefined, transformers);
            onAfterEmit === null || onAfterEmit === void 0 ? void 0 : onAfterEmit(sourceFile);
            // Capture emit history info for Angular rebuild analysis
            const hash = content ? (await this.addFileEmitHistory(filePath, content)).hash : undefined;
            const dependencies = [
                ...(this.fileDependencies.get(filePath) || []),
                ...getExtraDependencies(sourceFile),
            ].map(paths_1.externalizePath);
            return { content, map, dependencies, hash };
        };
    }
    async initializeCompilerCli() {
        if (this.compilerCliModule) {
            return;
        }
        // This uses a dynamic import to load `@angular/compiler-cli` which may be ESM.
        // CommonJS code can load ESM code via a dynamic import. Unfortunately, TypeScript
        // will currently, unconditionally downlevel dynamic import into a require call.
        // require calls cannot load ESM code and will result in a runtime error. To workaround
        // this, a Function constructor is used to prevent TypeScript from changing the dynamic import.
        // Once TypeScript provides support for keeping the dynamic import this workaround can
        // be dropped.
        this.compilerCliModule = await new Function(`return import('@angular/compiler-cli');`)();
        this.compilerNgccModule = await new Function(`return import('@angular/compiler-cli/ngcc');`)();
    }
    async addFileEmitHistory(filePath, content) {
        assert_1.strict.ok(this.webpackCreateHash, 'File emitter is used prior to Webpack compilation');
        const historyData = {
            length: content.length,
            hash: this.webpackCreateHash('xxhash64').update(content).digest(),
        };
        if (this.webpackCache) {
            const history = await this.getFileEmitHistory(filePath);
            if (!history || Buffer.compare(history.hash, historyData.hash) !== 0) {
                // Hash doesn't match or item doesn't exist.
                await this.webpackCache.storePromise(filePath, null, historyData);
            }
        }
        else if (this.watchMode) {
            // The in memory file emit history is only required during watch mode.
            this.fileEmitHistory.set(filePath, historyData);
        }
        return historyData;
    }
    async getFileEmitHistory(filePath) {
        return this.webpackCache
            ? this.webpackCache.getPromise(filePath, null)
            : this.fileEmitHistory.get(filePath);
    }
}
exports.AngularWebpackPlugin = AngularWebpackPlugin;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLCtDQUFpQztBQUVqQyxzREFBa0Q7QUFDbEQsa0RBQXdEO0FBQ3hELHdEQUEyRDtBQUMzRCxtQ0FBMEM7QUFDMUMsK0NBS3VCO0FBQ3ZCLGlDQVFnQjtBQUNoQixtQ0FBeUQ7QUFDekQscUNBQW1HO0FBQ25HLHFDQUFvRTtBQUNwRSxxREFBbUc7QUFFbkc7Ozs7R0FJRztBQUNILE1BQU0sOEJBQThCLEdBQUcsQ0FBQyxDQUFDO0FBd0J6QyxTQUFTLHVCQUF1QixDQUM5QixRQUFrQixFQUNsQixRQUFnQixFQUNoQixrQkFBMkU7O0lBRTNFLE1BQU0sRUFBRSxlQUFlLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxHQUFHLFFBQVEsQ0FBQztJQUM5RCxNQUFNLFVBQVUsR0FBRyxNQUFBLE1BQUEsTUFBQSxjQUFjLENBQUMsT0FBTywwQ0FBRSxVQUFVLDBDQUFFLElBQUksRUFBRSxtQ0FBSSxFQUFFLENBQUM7SUFFcEUsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQztJQUM5QixNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7UUFDdEQsMEZBQTBGO1FBQzFGLEtBQUssRUFBRSxLQUFLO1FBQ1osVUFBVSxFQUFFLENBQUMsT0FBTyxDQUFDO1FBQ3JCLHNCQUFzQixFQUFFLElBQUk7S0FDN0IsQ0FBQyxDQUFDO0lBRUgsZ0ZBQWdGO0lBQ2hGLGdGQUFnRjtJQUNoRiw2Q0FBNkM7SUFDN0MsZUFBTSxDQUFDLEVBQUUsQ0FBQyxrQkFB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QUksQ0FBQyxTQUFTLEVBQUU7WUFDekIsc0VBQXNFO1lBQ3RFLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztTQUNqRDtRQUVELE9BQU8sV0FBVyxDQUFDO0lBQ3JCLENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsUUFBZ0I7UUFDL0MsT0FBTyxJQUFJLENBQUMsWUFBWTtZQUN0QixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQWtDLFFBQVEsRUFBRSxJQUFJLENBQUM7WUFDL0UsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7Q0FDRjtBQS9xQkQsb0RBK3FCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IENvbXBpbGVySG9zdCwgQ29tcGlsZXJPcHRpb25zLCBOZ3RzY1Byb2dyYW0gfSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgc3RyaWN0IGFzIGFzc2VydCB9IGZyb20gJ2Fzc2VydCc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB0eXBlIHsgQ29tcGlsYXRpb24sIENvbXBpbGVyLCBNb2R1bGUsIE5vcm1hbE1vZHVsZSB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgTmdjY1Byb2Nlc3NvciB9IGZyb20gJy4uL25nY2NfcHJvY2Vzc29yJztcbmltcG9ydCB7IFR5cGVTY3JpcHRQYXRoc1BsdWdpbiB9IGZyb20gJy4uL3BhdGhzLXBsdWdpbic7XG5pbXBvcnQgeyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfSBmcm9tICcuLi9yZXNvdXJjZV9sb2FkZXInO1xuaW1wb3J0IHsgU291cmNlRmlsZUNhY2hlIH0gZnJvbSAnLi9jYWNoZSc7XG5pbXBvcnQge1xuICBEaWFnbm9zdGljc1JlcG9ydGVyLFxuICBhZGRFcnJvcixcbiAgYWRkV2FybmluZyxcbiAgY3JlYXRlRGlhZ25vc3RpY3NSZXBvcnRlcixcbn0gZnJvbSAnLi9kaWFnbm9zdGljcyc7XG5pbXBvcnQge1xuICBhdWdtZW50SG9zdFdpdGhDYWNoaW5nLFxuICBhdWdtZW50SG9zdFdpdGhEZXBlbmRlbmN5Q29sbGVjdGlvbixcbiAgYXVnbWVudEhvc3RXaXRoTmdjYyxcbiAgYXVnbWVudEhvc3RXaXRoUmVwbGFjZW1lbnRzLFxuICBhdWdtZW50SG9zdFdpdGhSZXNvdXJjZXMsXG4gIGF1Z21lbnRIb3N0V2l0aFN1YnN0aXR1dGlvbnMsXG4gIGF1Z21lbnRQcm9ncmFtV2l0aFZlcnNpb25pbmcsXG59IGZyb20gJy4vaG9zdCc7XG5pbXBvcnQgeyBleHRlcm5hbGl6ZVBhdGgsIG5vcm1hbGl6ZVBhdGggfSBmcm9tICcuL3BhdGhzJztcbmltcG9ydCB7IEFuZ3VsYXJQbHVnaW5TeW1ib2wsIEVtaXRGaWxlUmVzdWx0LCBGaWxlRW1pdHRlciwgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uIH0gZnJvbSAnLi9zeW1ib2wnO1xuaW1wb3J0IHsgSW5wdXRGaWxlU3lzdGVtU3luYywgY3JlYXRlV2VicGFja1N5c3RlbSB9IGZyb20gJy4vc3lzdGVtJztcbmltcG9ydCB7IGNyZWF0ZUFvdFRyYW5zZm9ybWVycywgY3JlYXRlSml0VHJhbnNmb3JtZXJzLCBtZXJnZVRyYW5zZm9ybWVycyB9IGZyb20gJy4vdHJhbnNmb3JtYXRpb24nO1xuXG4vKipcbiAqIFRoZSB0aHJlc2hvbGQgdXNlZCB0byBkZXRlcm1pbmUgd2hldGhlciBBbmd1bGFyIGZpbGUgZGlhZ25vc3RpY3Mgc2hvdWxkIG9wdGltaXplIGZvciBmdWxsIHByb2dyYW1zXG4gKiBvciBzaW5nbGUgZmlsZXMuIElmIHRoZSBudW1iZXIgb2YgYWZmZWN0ZWQgZmlsZXMgZm9yIGEgYnVpbGQgaXMgbW9yZSB0aGFuIHRoZSB0aHJlc2hvbGQsIGZ1bGxcbiAqIHByb2dyYW0gb3B0aW1pemF0aW9uIHdpbGwgYmUgdXNlZC5cbiAqL1xuY29uc3QgRElBR05PU1RJQ1NfQUZGRUNURURfVEhSRVNIT0xEID0gMTtcblxuZXhwb3J0IGludGVyZmFjZSBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnMge1xuICB0c2NvbmZpZzogc3RyaW5nO1xuICBjb21waWxlck9wdGlvbnM/OiBDb21waWxlck9wdGlvbnM7XG4gIGZpbGVSZXBsYWNlbWVudHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIHN1YnN0aXR1dGlvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogYm9vbGVhbjtcbiAgZW1pdENsYXNzTWV0YWRhdGE6IGJvb2xlYW47XG4gIGVtaXROZ01vZHVsZVNjb3BlOiBib29sZWFuO1xuICBqaXRNb2RlOiBib29sZWFuO1xuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogVGhlIEFuZ3VsYXIgY29tcGlsYXRpb24gc3RhdGUgdGhhdCBpcyBtYWludGFpbmVkIGFjcm9zcyBlYWNoIFdlYnBhY2sgY29tcGlsYXRpb24uXG4gKi9cbmludGVyZmFjZSBBbmd1bGFyQ29tcGlsYXRpb25TdGF0ZSB7XG4gIG5nY2NQcm9jZXNzb3I/OiBOZ2NjUHJvY2Vzc29yO1xuICByZXNvdXJjZUxvYWRlcj86IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgcHJldmlvdXNVbnVzZWQ/OiBTZXQ8c3RyaW5nPjtcbiAgcGF0aHNQbHVnaW46IFR5cGVTY3JpcHRQYXRoc1BsdWdpbjtcbn1cblxuZnVuY3Rpb24gaW5pdGlhbGl6ZU5nY2NQcm9jZXNzb3IoXG4gIGNvbXBpbGVyOiBDb21waWxlcixcbiAgdHNjb25maWc6IHN0cmluZyxcbiAgY29tcGlsZXJOZ2NjTW9kdWxlOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpIHwgdW5kZWZpbmVkLFxuKTogeyBwcm9jZXNzb3I6IE5nY2NQcm9jZXNzb3I7IGVycm9yczogc3RyaW5nW107IHdhcm5pbmdzOiBzdHJpbmdbXSB9IHtcbiAgY29uc3QgeyBpbnB1dEZpbGVTeXN0ZW0sIG9wdGlvbnM6IHdlYnBhY2tPcHRpb25zIH0gPSBjb21waWxlcjtcbiAgY29uc3QgbWFpbkZpZWxkcyA9IHdlYnBhY2tPcHRpb25zLnJlc29sdmU/Lm1haW5GaWVsZHM/LmZsYXQoKSA/PyBbXTtcblxuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZXNvbHZlciA9IGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5nZXQoJ25vcm1hbCcsIHtcbiAgICAvLyBDYWNoaW5nIG11c3QgYmUgZGlzYWJsZWQgYmVjYXVzZSBpdCBjYXVzZXMgdGhlIHJlc29sdmVyIHRvIGJlY29tZSBhc3luYyBhZnRlciBhIHJlYnVpbGRcbiAgICBjYWNoZTogZmFsc2UsXG4gICAgZXh0ZW5zaW9uczogWycuanNvbiddLFxuICAgIHVzZVN5bmNGaWxlU3lzdGVtQ2FsbHM6IHRydWUsXG4gIH0pO1xuXG4gIC8vIFRoZSBjb21waWxlck5nY2NNb2R1bGUgZmllbGQgaXMgZ3VhcmFudGVlZCB0byBiZSBkZWZpbmVkIGR1cmluZyBhIGNvbXBpbGF0aW9uXG4gIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICBhc3NlcnQub2soY29tcGlsZXJOZ2NjTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgY29uc3QgcHJvY2Vzc29yID0gbmV3IE5nY2NQcm9jZXNzb3IoXG4gICAgY29tcGlsZXJOZ2NjTW9kdWxlLFxuICAgIG1haW5GaWVsZHMsXG4gICAgd2FybmluZ3MsXG4gICAgZXJyb3JzLFxuICAgIGNvbXBpbGVyLmNvbnRleHQsXG4gICAgdHNjb25maWcsXG4gICAgaW5wdXRGaWxlU3lzdGVtLFxuICAgIHJlc29sdmVyLFxuICApO1xuXG4gIHJldHVybiB7IHByb2Nlc3NvciwgZXJyb3JzLCB3YXJuaW5ncyB9O1xufVxuXG5jb25zdCBQTFVHSU5fTkFNRSA9ICdhbmd1bGFyLWNvbXBpbGVyJztcbmNvbnN0IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzID0gbmV3IFdlYWtNYXA8Q29tcGlsYXRpb24sIEZpbGVFbWl0dGVyQ29sbGVjdGlvbj4oKTtcblxuaW50ZXJmYWNlIEZpbGVFbWl0SGlzdG9yeUl0ZW0ge1xuICBsZW5ndGg6IG51bWJlcjtcbiAgaGFzaDogVWludDhBcnJheTtcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJXZWJwYWNrUGx1Z2luIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5PcHRpb25zOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM7XG4gIHByaXZhdGUgY29tcGlsZXJDbGlNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtcbiAgcHJpdmF0ZSBjb21waWxlck5nY2NNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpO1xuICBwcml2YXRlIHdhdGNoTW9kZT86IGJvb2xlYW47XG4gIHByaXZhdGUgbmd0c2NOZXh0UHJvZ3JhbT86IE5ndHNjUHJvZ3JhbTtcbiAgcHJpdmF0ZSBidWlsZGVyPzogdHMuRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbTtcbiAgcHJpdmF0ZSBzb3VyY2VGaWxlQ2FjaGU/OiBTb3VyY2VGaWxlQ2FjaGU7XG4gIHByaXZhdGUgd2VicGFja0NhY2hlPzogUmV0dXJuVHlwZTxDb21waWxhdGlvblsnZ2V0Q2FjaGUnXT47XG4gIHByaXZhdGUgd2VicGFja0NyZWF0ZUhhc2g/OiBDb21waWxlclsnd2VicGFjayddWyd1dGlsJ11bJ2NyZWF0ZUhhc2gnXTtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRGVwZW5kZW5jaWVzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgRW1pdEZpbGVSZXN1bHQgfCB1bmRlZmluZWQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZUVtaXRIaXN0b3J5ID0gbmV3IE1hcDxzdHJpbmcsIEZpbGVFbWl0SGlzdG9yeUl0ZW0+KCk7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUGFydGlhbDxBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM+ID0ge30pIHtcbiAgICB0aGlzLnBsdWdpbk9wdGlvbnMgPSB7XG4gICAgICBlbWl0Q2xhc3NNZXRhZGF0YTogZmFsc2UsXG4gICAgICBlbWl0TmdNb2R1bGVTY29wZTogZmFsc2UsXG4gICAgICBqaXRNb2RlOiBmYWxzZSxcbiAgICAgIGZpbGVSZXBsYWNlbWVudHM6IHt9LFxuICAgICAgc3Vic3RpdHV0aW9uczoge30sXG4gICAgICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IHRydWUsXG4gICAgICB0c2NvbmZpZzogJ3RzY29uZmlnLmpzb24nLFxuICAgICAgLi4ub3B0aW9ucyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29tcGlsZXJDbGkoKTogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJykge1xuICAgIC8vIFRoZSBjb21waWxlckNsaU1vZHVsZSBmaWVsZCBpcyBndWFyYW50ZWVkIHRvIGJlIGRlZmluZWQgZHVyaW5nIGEgY29tcGlsYXRpb25cbiAgICAvLyBkdWUgdG8gdGhlIGBiZWZvcmVDb21waWxlYCBob29rLiBVc2FnZSBvZiB0aGlzIHByb3BlcnR5IGFjY2Vzc29yIHByaW9yIHRvIHRoZVxuICAgIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICAgIGFzc2VydC5vayh0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScgdXNlZCBwcmlvciB0byBXZWJwYWNrIGNvbXBpbGF0aW9uLmApO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcGlsZXJDbGlNb2R1bGU7XG4gIH1cblxuICBnZXQgb3B0aW9ucygpOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnMge1xuICAgIHJldHVybiB0aGlzLnBsdWdpbk9wdGlvbnM7XG4gIH1cblxuICBhcHBseShjb21waWxlcjogQ29tcGlsZXIpOiB2b2lkIHtcbiAgICBjb25zdCB7IE5vcm1hbE1vZHVsZVJlcGxhY2VtZW50UGx1Z2luLCBXZWJwYWNrRXJyb3IsIHV0aWwgfSA9IGNvbXBpbGVyLndlYnBhY2s7XG4gICAgdGhpcy53ZWJwYWNrQ3JlYXRlSGFzaCA9IHV0aWwuY3JlYXRlSGFzaDtcblxuICAgIC8vIFNldHVwIGZpbGUgcmVwbGFjZW1lbnRzIHdpdGggd2VicGFja1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMucGx1Z2luT3B0aW9ucy5maWxlUmVwbGFjZW1lbnRzKSkge1xuICAgICAgbmV3IE5vcm1hbE1vZHVsZVJlcGxhY2VtZW50UGx1Z2luKFxuICAgICAgICBuZXcgUmVnRXhwKCdeJyArIGtleS5yZXBsYWNlKC9bLiorXFwtP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpICsgJyQnKSxcbiAgICAgICAgdmFsdWUsXG4gICAgICApLmFwcGx5KGNvbXBpbGVyKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgcmVzb2x2ZXIgb3B0aW9uc1xuICAgIGNvbnN0IHBhdGhzUGx1Z2luID0gbmV3IFR5cGVTY3JpcHRQYXRoc1BsdWdpbigpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGVyKSA9PiB7XG4gICAgICAvLyBXaGVuIEl2eSBpcyBlbmFibGVkIHdlIG5lZWQgdG8gYWRkIHRoZSBmaWVsZHMgYWRkZWQgYnkgTkdDQ1xuICAgICAgLy8gdG8gdGFrZSBwcmVjZWRlbmNlIG92ZXIgdGhlIHByb3ZpZGVkIG1haW5GaWVsZHMuXG4gICAgICAvLyBOR0NDIGFkZHMgZmllbGRzIGluIHBhY2thZ2UuanNvbiBzdWZmaXhlZCB3aXRoICdfaXZ5X25nY2MnXG4gICAgICAvLyBFeGFtcGxlOiBtb2R1bGUgLT4gbW9kdWxlX19pdnlfbmdjY1xuICAgICAgY29tcGlsZXIucmVzb2x2ZXJGYWN0b3J5Lmhvb2tzLnJlc29sdmVPcHRpb25zXG4gICAgICAgIC5mb3IoJ25vcm1hbCcpXG4gICAgICAgIC50YXAoUExVR0lOX05BTUUsIChyZXNvbHZlT3B0aW9ucykgPT4ge1xuICAgICAgICAgIGNvbnN0IG9yaWdpbmFsTWFpbkZpZWxkcyA9IHJlc29sdmVPcHRpb25zLm1haW5GaWVsZHM7XG4gICAgICAgICAgY29uc3QgaXZ5TWFpbkZpZWxkcyA9IG9yaWdpbmFsTWFpbkZpZWxkcz8uZmxhdCgpLm1hcCgoZikgPT4gYCR7Zn1faXZ5X25nY2NgKSA/PyBbXTtcblxuICAgICAgICAgIHJlc29sdmVPcHRpb25zLnBsdWdpbnMgPz89IFtdO1xuICAgICAgICAgIHJlc29sdmVPcHRpb25zLnBsdWdpbnMucHVzaChwYXRoc1BsdWdpbik7XG5cbiAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vd2VicGFjay93ZWJwYWNrL2lzc3Vlcy8xMTYzNSNpc3N1ZWNvbW1lbnQtNzA3MDE2Nzc5XG4gICAgICAgICAgcmV0dXJuIHV0aWwuY2xldmVyTWVyZ2UocmVzb2x2ZU9wdGlvbnMsIHsgbWFpbkZpZWxkczogWy4uLml2eU1haW5GaWVsZHMsICcuLi4nXSB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBMb2FkIHRoZSBjb21waWxlci1jbGkgaWYgbm90IGFscmVhZHkgYXZhaWxhYmxlXG4gICAgY29tcGlsZXIuaG9va3MuYmVmb3JlQ29tcGlsZS50YXBQcm9taXNlKFBMVUdJTl9OQU1FLCAoKSA9PiB0aGlzLmluaXRpYWxpemVDb21waWxlckNsaSgpKTtcblxuICAgIGNvbnN0IGNvbXBpbGF0aW9uU3RhdGU6IEFuZ3VsYXJDb21waWxhdGlvblN0YXRlID0geyBwYXRoc1BsdWdpbiB9O1xuICAgIGNvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoUExVR0lOX05BTUUsIChjb21waWxhdGlvbikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5zZXR1cENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uLCBjb21waWxhdGlvblN0YXRlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKFxuICAgICAgICAgIG5ldyBXZWJwYWNrRXJyb3IoXG4gICAgICAgICAgICBgRmFpbGVkIHRvIGluaXRpYWxpemUgQW5ndWxhciBjb21waWxhdGlvbiAtICR7XG4gICAgICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogZXJyb3JcbiAgICAgICAgICAgIH1gLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwQ29tcGlsYXRpb24oY29tcGlsYXRpb246IENvbXBpbGF0aW9uLCBzdGF0ZTogQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUpOiB2b2lkIHtcbiAgICBjb25zdCBjb21waWxlciA9IGNvbXBpbGF0aW9uLmNvbXBpbGVyO1xuXG4gICAgLy8gUmVnaXN0ZXIgcGx1Z2luIHRvIGVuc3VyZSBkZXRlcm1pbmlzdGljIGVtaXQgb3JkZXIgaW4gbXVsdGktcGx1Z2luIHVzYWdlXG4gICAgY29uc3QgZW1pdFJlZ2lzdHJhdGlvbiA9IHRoaXMucmVnaXN0ZXJXaXRoQ29tcGlsYXRpb24oY29tcGlsYXRpb24pO1xuICAgIHRoaXMud2F0Y2hNb2RlID0gY29tcGlsZXIud2F0Y2hNb2RlO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSB3ZWJwYWNrIGNhY2hlXG4gICAgaWYgKCF0aGlzLndlYnBhY2tDYWNoZSAmJiBjb21waWxhdGlvbi5vcHRpb25zLmNhY2hlKSB7XG4gICAgICB0aGlzLndlYnBhY2tDYWNoZSA9IGNvbXBpbGF0aW9uLmdldENhY2hlKFBMVUdJTl9OQU1FKTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIHRoZSByZXNvdXJjZSBsb2FkZXIgaWYgbm90IGFscmVhZHkgc2V0dXBcbiAgICBpZiAoIXN0YXRlLnJlc291cmNlTG9hZGVyKSB7XG4gICAgICBzdGF0ZS5yZXNvdXJjZUxvYWRlciA9IG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIodGhpcy53YXRjaE1vZGUpO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgYW5kIHByb2Nlc3MgZWFnZXIgbmdjYyBpZiBub3QgYWxyZWFkeSBzZXR1cFxuICAgIGlmICghc3RhdGUubmdjY1Byb2Nlc3Nvcikge1xuICAgICAgY29uc3QgeyBwcm9jZXNzb3IsIGVycm9ycywgd2FybmluZ3MgfSA9IGluaXRpYWxpemVOZ2NjUHJvY2Vzc29yKFxuICAgICAgICBjb21waWxlcixcbiAgICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLnRzY29uZmlnLFxuICAgICAgICB0aGlzLmNvbXBpbGVyTmdjY01vZHVsZSxcbiAgICAgICk7XG5cbiAgICAgIHByb2Nlc3Nvci5wcm9jZXNzKCk7XG4gICAgICB3YXJuaW5ncy5mb3JFYWNoKCh3YXJuaW5nKSA9PiBhZGRXYXJuaW5nKGNvbXBpbGF0aW9uLCB3YXJuaW5nKSk7XG4gICAgICBlcnJvcnMuZm9yRWFjaCgoZXJyb3IpID0+IGFkZEVycm9yKGNvbXBpbGF0aW9uLCBlcnJvcikpO1xuXG4gICAgICBzdGF0ZS5uZ2NjUHJvY2Vzc29yID0gcHJvY2Vzc29yO1xuICAgIH1cblxuICAgIC8vIFNldHVwIGFuZCByZWFkIFR5cGVTY3JpcHQgYW5kIEFuZ3VsYXIgY29tcGlsZXIgY29uZmlndXJhdGlvblxuICAgIGNvbnN0IHsgY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGVycm9ycyB9ID0gdGhpcy5sb2FkQ29uZmlndXJhdGlvbigpO1xuXG4gICAgLy8gQ3JlYXRlIGRpYWdub3N0aWNzIHJlcG9ydGVyIGFuZCByZXBvcnQgY29uZmlndXJhdGlvbiBmaWxlIGVycm9yc1xuICAgIGNvbnN0IGRpYWdub3N0aWNzUmVwb3J0ZXIgPSBjcmVhdGVEaWFnbm9zdGljc1JlcG9ydGVyKGNvbXBpbGF0aW9uLCAoZGlhZ25vc3RpYykgPT5cbiAgICAgIHRoaXMuY29tcGlsZXJDbGkuZm9ybWF0RGlhZ25vc3RpY3MoW2RpYWdub3N0aWNdKSxcbiAgICApO1xuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZXJyb3JzKTtcblxuICAgIC8vIFVwZGF0ZSBUeXBlU2NyaXB0IHBhdGggbWFwcGluZyBwbHVnaW4gd2l0aCBuZXcgY29uZmlndXJhdGlvblxuICAgIHN0YXRlLnBhdGhzUGx1Z2luLnVwZGF0ZShjb21waWxlck9wdGlvbnMpO1xuXG4gICAgLy8gQ3JlYXRlIGEgV2VicGFjay1iYXNlZCBUeXBlU2NyaXB0IGNvbXBpbGVyIGhvc3RcbiAgICBjb25zdCBzeXN0ZW0gPSBjcmVhdGVXZWJwYWNrU3lzdGVtKFxuICAgICAgLy8gV2VicGFjayBsYWNrcyBhbiBJbnB1dEZpbGVTeXRlbSB0eXBlIGRlZmluaXRpb24gd2l0aCBzeW5jIGZ1bmN0aW9uc1xuICAgICAgY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtIGFzIElucHV0RmlsZVN5c3RlbVN5bmMsXG4gICAgICBub3JtYWxpemVQYXRoKGNvbXBpbGVyLmNvbnRleHQpLFxuICAgICk7XG4gICAgY29uc3QgaG9zdCA9IHRzLmNyZWF0ZUluY3JlbWVudGFsQ29tcGlsZXJIb3N0KGNvbXBpbGVyT3B0aW9ucywgc3lzdGVtKTtcblxuICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGNhY2hpbmcgYW5kIHJldXNlIGNhY2hlIGZyb20gcHJldmlvdXMgY29tcGlsYXRpb24gaWYgcHJlc2VudFxuICAgIGxldCBjYWNoZSA9IHRoaXMuc291cmNlRmlsZUNhY2hlO1xuICAgIGxldCBjaGFuZ2VkRmlsZXM7XG4gICAgaWYgKGNhY2hlKSB7XG4gICAgICBjaGFuZ2VkRmlsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgY2hhbmdlZEZpbGUgb2YgWy4uLmNvbXBpbGVyLm1vZGlmaWVkRmlsZXMsIC4uLmNvbXBpbGVyLnJlbW92ZWRGaWxlc10pIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZENoYW5nZWRGaWxlID0gbm9ybWFsaXplUGF0aChjaGFuZ2VkRmlsZSk7XG4gICAgICAgIC8vIEludmFsaWRhdGUgZmlsZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgdGhpcy5maWxlRGVwZW5kZW5jaWVzLmRlbGV0ZShub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgICAvLyBJbnZhbGlkYXRlIGV4aXN0aW5nIGNhY2hlXG4gICAgICAgIGNhY2hlLmludmFsaWRhdGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcblxuICAgICAgICBjaGFuZ2VkRmlsZXMuYWRkKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEluaXRpYWxpemUgYSBuZXcgY2FjaGVcbiAgICAgIGNhY2hlID0gbmV3IFNvdXJjZUZpbGVDYWNoZSgpO1xuICAgICAgLy8gT25seSBzdG9yZSBjYWNoZSBpZiBpbiB3YXRjaCBtb2RlXG4gICAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgPSBjYWNoZTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyhob3N0LCBjYWNoZSk7XG5cbiAgICBjb25zdCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUoXG4gICAgICBob3N0LmdldEN1cnJlbnREaXJlY3RvcnkoKSxcbiAgICAgIGhvc3QuZ2V0Q2Fub25pY2FsRmlsZU5hbWUuYmluZChob3N0KSxcbiAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICApO1xuXG4gICAgLy8gU2V0dXAgc291cmNlIGZpbGUgZGVwZW5kZW5jeSBjb2xsZWN0aW9uXG4gICAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24oaG9zdCwgdGhpcy5maWxlRGVwZW5kZW5jaWVzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuXG4gICAgLy8gU2V0dXAgb24gZGVtYW5kIG5nY2NcbiAgICBhdWdtZW50SG9zdFdpdGhOZ2NjKGhvc3QsIHN0YXRlLm5nY2NQcm9jZXNzb3IsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG5cbiAgICAvLyBTZXR1cCByZXNvdXJjZSBsb2FkaW5nXG4gICAgc3RhdGUucmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uLCBjaGFuZ2VkRmlsZXMpO1xuICAgIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyhob3N0LCBzdGF0ZS5yZXNvdXJjZUxvYWRlciwge1xuICAgICAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nOiB0aGlzLnBsdWdpbk9wdGlvbnMuZGlyZWN0VGVtcGxhdGVMb2FkaW5nLFxuICAgICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uOiB0aGlzLnBsdWdpbk9wdGlvbnMuaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uLFxuICAgIH0pO1xuXG4gICAgLy8gU2V0dXAgc291cmNlIGZpbGUgYWRqdXN0bWVudCBvcHRpb25zXG4gICAgYXVnbWVudEhvc3RXaXRoUmVwbGFjZW1lbnRzKGhvc3QsIHRoaXMucGx1Z2luT3B0aW9ucy5maWxlUmVwbGFjZW1lbnRzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuICAgIGF1Z21lbnRIb3N0V2l0aFN1YnN0aXR1dGlvbnMoaG9zdCwgdGhpcy5wbHVnaW5PcHRpb25zLnN1YnN0aXR1dGlvbnMpO1xuXG4gICAgLy8gQ3JlYXRlIHRoZSBmaWxlIGVtaXR0ZXIgdXNlZCBieSB0aGUgd2VicGFjayBsb2FkZXJcbiAgICBjb25zdCB7IGZpbGVFbWl0dGVyLCBidWlsZGVyLCBpbnRlcm5hbEZpbGVzIH0gPSB0aGlzLnBsdWdpbk9wdGlvbnMuaml0TW9kZVxuICAgICAgPyB0aGlzLnVwZGF0ZUppdFByb2dyYW0oY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGhvc3QsIGRpYWdub3N0aWNzUmVwb3J0ZXIpXG4gICAgICA6IHRoaXMudXBkYXRlQW90UHJvZ3JhbShcbiAgICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgcm9vdE5hbWVzLFxuICAgICAgICAgIGhvc3QsXG4gICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgICAgICAgICBzdGF0ZS5yZXNvdXJjZUxvYWRlcixcbiAgICAgICAgKTtcblxuICAgIC8vIFNldCBvZiBmaWxlcyB1c2VkIGR1cmluZyB0aGUgdW51c2VkIFR5cGVTY3JpcHQgZmlsZSBhbmFseXNpc1xuICAgIGNvbnN0IGN1cnJlbnRVbnVzZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgIGlmIChpbnRlcm5hbEZpbGVzPy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIEVuc3VyZSBhbGwgcHJvZ3JhbSBmaWxlcyBhcmUgY29uc2lkZXJlZCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvbiBhbmQgd2lsbCBiZSB3YXRjaGVkLlxuICAgICAgLy8gV2VicGFjayBkb2VzIG5vdCBub3JtYWxpemUgcGF0aHMuIFRoZXJlZm9yZSwgd2UgbmVlZCB0byBub3JtYWxpemUgdGhlIHBhdGggd2l0aCBGUyBzZXBlcmF0b3JzLlxuICAgICAgY29tcGlsYXRpb24uZmlsZURlcGVuZGVuY2llcy5hZGQoZXh0ZXJuYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcblxuICAgICAgLy8gQWRkIGFsbCBub24tZGVjbGFyYXRpb24gZmlsZXMgdG8gdGhlIGluaXRpYWwgc2V0IG9mIHVudXNlZCBmaWxlcy4gVGhlIHNldCB3aWxsIGJlXG4gICAgICAvLyBhbmFseXplZCBhbmQgcHJ1bmVkIGFmdGVyIGFsbCBXZWJwYWNrIG1vZHVsZXMgYXJlIGZpbmlzaGVkIGJ1aWxkaW5nLlxuICAgICAgaWYgKCFzb3VyY2VGaWxlLmlzRGVjbGFyYXRpb25GaWxlKSB7XG4gICAgICAgIGN1cnJlbnRVbnVzZWQuYWRkKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbXBpbGF0aW9uLmhvb2tzLmZpbmlzaE1vZHVsZXMudGFwUHJvbWlzZShQTFVHSU5fTkFNRSwgYXN5bmMgKG1vZHVsZXMpID0+IHtcbiAgICAgIC8vIFJlYnVpbGQgYW55IHJlbWFpbmluZyBBT1QgcmVxdWlyZWQgbW9kdWxlc1xuICAgICAgYXdhaXQgdGhpcy5yZWJ1aWxkUmVxdWlyZWRGaWxlcyhtb2R1bGVzLCBjb21waWxhdGlvbiwgZmlsZUVtaXR0ZXIpO1xuXG4gICAgICAvLyBDbGVhciBvdXQgdGhlIFdlYnBhY2sgY29tcGlsYXRpb24gdG8gYXZvaWQgYW4gZXh0cmEgcmV0YWluaW5nIHJlZmVyZW5jZVxuICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXI/LmNsZWFyUGFyZW50Q29tcGlsYXRpb24oKTtcblxuICAgICAgLy8gQW5hbHl6ZSBwcm9ncmFtIGZvciB1bnVzZWQgZmlsZXNcbiAgICAgIGlmIChjb21waWxhdGlvbi5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3Qgd2VicGFja01vZHVsZSBvZiBtb2R1bGVzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlID0gKHdlYnBhY2tNb2R1bGUgYXMgTm9ybWFsTW9kdWxlKS5yZXNvdXJjZTtcbiAgICAgICAgaWYgKHJlc291cmNlKSB7XG4gICAgICAgICAgdGhpcy5tYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZVBhdGgocmVzb3VyY2UpLCBjdXJyZW50VW51c2VkKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHVudXNlZCBvZiBjdXJyZW50VW51c2VkKSB7XG4gICAgICAgIGlmIChzdGF0ZS5wcmV2aW91c1VudXNlZD8uaGFzKHVudXNlZCkpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhZGRXYXJuaW5nKFxuICAgICAgICAgIGNvbXBpbGF0aW9uLFxuICAgICAgICAgIGAke3VudXNlZH0gaXMgcGFydCBvZiB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbiBidXQgaXQncyB1bnVzZWQuXFxuYCArXG4gICAgICAgICAgICBgQWRkIG9ubHkgZW50cnkgcG9pbnRzIHRvIHRoZSAnZmlsZXMnIG9yICdpbmNsdWRlJyBwcm9wZXJ0aWVzIGluIHlvdXIgdHNjb25maWcuYCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHN0YXRlLnByZXZpb3VzVW51c2VkID0gY3VycmVudFVudXNlZDtcbiAgICB9KTtcblxuICAgIC8vIFN0b3JlIGZpbGUgZW1pdHRlciBmb3IgbG9hZGVyIHVzYWdlXG4gICAgZW1pdFJlZ2lzdHJhdGlvbi51cGRhdGUoZmlsZUVtaXR0ZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWdpc3RlcldpdGhDb21waWxhdGlvbihjb21waWxhdGlvbjogQ29tcGlsYXRpb24pIHtcbiAgICBsZXQgZmlsZUVtaXR0ZXJzID0gY29tcGlsYXRpb25GaWxlRW1pdHRlcnMuZ2V0KGNvbXBpbGF0aW9uKTtcbiAgICBpZiAoIWZpbGVFbWl0dGVycykge1xuICAgICAgZmlsZUVtaXR0ZXJzID0gbmV3IEZpbGVFbWl0dGVyQ29sbGVjdGlvbigpO1xuICAgICAgY29tcGlsYXRpb25GaWxlRW1pdHRlcnMuc2V0KGNvbXBpbGF0aW9uLCBmaWxlRW1pdHRlcnMpO1xuICAgICAgY29tcGlsYXRpb24uY29tcGlsZXIud2VicGFjay5Ob3JtYWxNb2R1bGUuZ2V0Q29tcGlsYXRpb25Ib29rcyhjb21waWxhdGlvbikubG9hZGVyLnRhcChcbiAgICAgICAgUExVR0lOX05BTUUsXG4gICAgICAgIChsb2FkZXJDb250ZXh0OiB7IFtBbmd1bGFyUGx1Z2luU3ltYm9sXT86IEZpbGVFbWl0dGVyQ29sbGVjdGlvbiB9KSA9PiB7XG4gICAgICAgICAgbG9hZGVyQ29udGV4dFtBbmd1bGFyUGx1Z2luU3ltYm9sXSA9IGZpbGVFbWl0dGVycztcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSBmaWxlRW1pdHRlcnMucmVnaXN0ZXIoKTtcblxuICAgIHJldHVybiBlbWl0UmVnaXN0cmF0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSBtYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGg6IHN0cmluZywgY3VycmVudFVudXNlZDogU2V0PHN0cmluZz4pOiB2b2lkIHtcbiAgICBpZiAoIWN1cnJlbnRVbnVzZWQuaGFzKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY3VycmVudFVudXNlZC5kZWxldGUobm9ybWFsaXplZFJlc291cmNlUGF0aCk7XG4gICAgY29uc3QgZGVwZW5kZW5jaWVzID0gdGhpcy5maWxlRGVwZW5kZW5jaWVzLmdldChub3JtYWxpemVkUmVzb3VyY2VQYXRoKTtcbiAgICBpZiAoIWRlcGVuZGVuY2llcykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGRlcGVuZGVuY3kgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICB0aGlzLm1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplUGF0aChkZXBlbmRlbmN5KSwgY3VycmVudFVudXNlZCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWJ1aWxkUmVxdWlyZWRGaWxlcyhcbiAgICBtb2R1bGVzOiBJdGVyYWJsZTxNb2R1bGU+LFxuICAgIGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbixcbiAgICBmaWxlRW1pdHRlcjogRmlsZUVtaXR0ZXIsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzVG9SZWJ1aWxkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCByZXF1aXJlZEZpbGUgb2YgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0KSB7XG4gICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgdGhpcy5nZXRGaWxlRW1pdEhpc3RvcnkocmVxdWlyZWRGaWxlKTtcbiAgICAgIGlmIChoaXN0b3J5KSB7XG4gICAgICAgIGNvbnN0IGVtaXRSZXN1bHQgPSBhd2FpdCBmaWxlRW1pdHRlcihyZXF1aXJlZEZpbGUpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgZW1pdFJlc3VsdD8uY29udGVudCA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgaGlzdG9yeS5sZW5ndGggIT09IGVtaXRSZXN1bHQuY29udGVudC5sZW5ndGggfHxcbiAgICAgICAgICBlbWl0UmVzdWx0Lmhhc2ggPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIEJ1ZmZlci5jb21wYXJlKGhpc3RvcnkuaGFzaCwgZW1pdFJlc3VsdC5oYXNoKSAhPT0gMFxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBOZXcgZW1pdCByZXN1bHQgaXMgZGlmZmVyZW50IHNvIHJlYnVpbGQgdXNpbmcgbmV3IGVtaXQgcmVzdWx0XG4gICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuc2V0KHJlcXVpcmVkRmlsZSwgZW1pdFJlc3VsdCk7XG4gICAgICAgICAgZmlsZXNUb1JlYnVpbGQuYWRkKHJlcXVpcmVkRmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE5vIGVtaXQgaGlzdG9yeSBzbyByZWJ1aWxkXG4gICAgICAgIGZpbGVzVG9SZWJ1aWxkLmFkZChyZXF1aXJlZEZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmaWxlc1RvUmVidWlsZC5zaXplID4gMCkge1xuICAgICAgY29uc3QgcmVidWlsZCA9ICh3ZWJwYWNrTW9kdWxlOiBNb2R1bGUpID0+XG4gICAgICAgIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiBjb21waWxhdGlvbi5yZWJ1aWxkTW9kdWxlKHdlYnBhY2tNb2R1bGUsICgpID0+IHJlc29sdmUoKSkpO1xuXG4gICAgICBjb25zdCBtb2R1bGVzVG9SZWJ1aWxkID0gW107XG4gICAgICBmb3IgKGNvbnN0IHdlYnBhY2tNb2R1bGUgb2YgbW9kdWxlcykge1xuICAgICAgICBjb25zdCByZXNvdXJjZSA9ICh3ZWJwYWNrTW9kdWxlIGFzIE5vcm1hbE1vZHVsZSkucmVzb3VyY2U7XG4gICAgICAgIGlmIChyZXNvdXJjZSAmJiBmaWxlc1RvUmVidWlsZC5oYXMobm9ybWFsaXplUGF0aChyZXNvdXJjZSkpKSB7XG4gICAgICAgICAgbW9kdWxlc1RvUmVidWlsZC5wdXNoKHdlYnBhY2tNb2R1bGUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChtb2R1bGVzVG9SZWJ1aWxkLm1hcCgod2VicGFja01vZHVsZSkgPT4gcmVidWlsZCh3ZWJwYWNrTW9kdWxlKSkpO1xuICAgIH1cblxuICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5jbGVhcigpO1xuICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmNsZWFyKCk7XG4gIH1cblxuICBwcml2YXRlIGxvYWRDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IHtcbiAgICAgIG9wdGlvbnM6IGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHJvb3ROYW1lcyxcbiAgICAgIGVycm9ycyxcbiAgICB9ID0gdGhpcy5jb21waWxlckNsaS5yZWFkQ29uZmlndXJhdGlvbihcbiAgICAgIHRoaXMucGx1Z2luT3B0aW9ucy50c2NvbmZpZyxcbiAgICAgIHRoaXMucGx1Z2luT3B0aW9ucy5jb21waWxlck9wdGlvbnMsXG4gICAgKTtcbiAgICBjb21waWxlck9wdGlvbnMubm9FbWl0T25FcnJvciA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5zdXBwcmVzc091dHB1dFBhdGhDaGVjayA9IHRydWU7XG4gICAgY29tcGlsZXJPcHRpb25zLm91dERpciA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IGNvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXA7XG4gICAgY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5hbGxvd0VtcHR5Q29kZWdlbkZpbGVzID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLmFubm90YXRpb25zQXMgPSAnZGVjb3JhdG9ycyc7XG4gICAgY29tcGlsZXJPcHRpb25zLmVuYWJsZVJlc291cmNlSW5saW5pbmcgPSBmYWxzZTtcblxuICAgIHJldHVybiB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQW90UHJvZ3JhbShcbiAgICBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgICByb290TmFtZXM6IHN0cmluZ1tdLFxuICAgIGhvc3Q6IENvbXBpbGVySG9zdCxcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyOiBEaWFnbm9zdGljc1JlcG9ydGVyLFxuICAgIHJlc291cmNlTG9hZGVyOiBXZWJwYWNrUmVzb3VyY2VMb2FkZXIsXG4gICkge1xuICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBzcGVjaWZpYyBwcm9ncmFtIHRoYXQgY29udGFpbnMgdGhlIEFuZ3VsYXIgY29tcGlsZXJcbiAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IG5ldyB0aGlzLmNvbXBpbGVyQ2xpLk5ndHNjUHJvZ3JhbShcbiAgICAgIHJvb3ROYW1lcyxcbiAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgIGhvc3QsXG4gICAgICB0aGlzLm5ndHNjTmV4dFByb2dyYW0sXG4gICAgKTtcbiAgICBjb25zdCBhbmd1bGFyQ29tcGlsZXIgPSBhbmd1bGFyUHJvZ3JhbS5jb21waWxlcjtcblxuICAgIC8vIFRoZSBgaWdub3JlRm9yRW1pdGAgcmV0dXJuIHZhbHVlIGNhbiBiZSBzYWZlbHkgaWdub3JlZCB3aGVuIGVtaXR0aW5nLiBPbmx5IGZpbGVzXG4gICAgLy8gdGhhdCB3aWxsIGJlIGJ1bmRsZWQgKHJlcXVlc3RlZCBieSBXZWJwYWNrKSB3aWxsIGJlIGVtaXR0ZWQuIENvbWJpbmVkIHdpdGggVHlwZVNjcmlwdCdzXG4gICAgLy8gZWxpZGluZyBvZiB0eXBlIG9ubHkgaW1wb3J0cywgdGhpcyB3aWxsIGNhdXNlIHR5cGUgb25seSBmaWxlcyB0byBiZSBhdXRvbWF0aWNhbGx5IGlnbm9yZWQuXG4gICAgLy8gSW50ZXJuYWwgQW5ndWxhciB0eXBlIGNoZWNrIGZpbGVzIGFyZSBhbHNvIG5vdCByZXNvbHZhYmxlIGJ5IHRoZSBidW5kbGVyLiBFdmVuIGlmIHRoZXlcbiAgICAvLyB3ZXJlIHNvbWVob3cgZXJyYW50bHkgaW1wb3J0ZWQsIHRoZSBidW5kbGVyIHdvdWxkIGVycm9yIGJlZm9yZSBhbiBlbWl0IHdhcyBhdHRlbXB0ZWQuXG4gICAgLy8gRGlhZ25vc3RpY3MgYXJlIHN0aWxsIGNvbGxlY3RlZCBmb3IgYWxsIGZpbGVzIHdoaWNoIHJlcXVpcmVzIHVzaW5nIGBpZ25vcmVGb3JEaWFnbm9zdGljc2AuXG4gICAgY29uc3QgeyBpZ25vcmVGb3JEaWFnbm9zdGljcywgaWdub3JlRm9yRW1pdCB9ID0gYW5ndWxhckNvbXBpbGVyO1xuXG4gICAgLy8gU291cmNlRmlsZSB2ZXJzaW9ucyBhcmUgcmVxdWlyZWQgZm9yIGJ1aWxkZXIgcHJvZ3JhbXMuXG4gICAgLy8gVGhlIHdyYXBwZWQgaG9zdCBpbnNpZGUgTmd0c2NQcm9ncmFtIGFkZHMgYWRkaXRpb25hbCBmaWxlcyB0aGF0IHdpbGwgbm90IGhhdmUgdmVyc2lvbnMuXG4gICAgY29uc3QgdHlwZVNjcmlwdFByb2dyYW0gPSBhbmd1bGFyUHJvZ3JhbS5nZXRUc1Byb2dyYW0oKTtcbiAgICBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nKHR5cGVTY3JpcHRQcm9ncmFtKTtcblxuICAgIGxldCBidWlsZGVyOiB0cy5CdWlsZGVyUHJvZ3JhbSB8IHRzLkVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW07XG4gICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICBidWlsZGVyID0gdGhpcy5idWlsZGVyID0gdHMuY3JlYXRlRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbShcbiAgICAgICAgdHlwZVNjcmlwdFByb2dyYW0sXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHRoaXMuYnVpbGRlcixcbiAgICAgICk7XG4gICAgICB0aGlzLm5ndHNjTmV4dFByb2dyYW0gPSBhbmd1bGFyUHJvZ3JhbTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2hlbiBub3QgaW4gd2F0Y2ggbW9kZSwgdGhlIHN0YXJ0dXAgY29zdCBvZiB0aGUgaW5jcmVtZW50YWwgYW5hbHlzaXMgY2FuIGJlIGF2b2lkZWQgYnlcbiAgICAgIC8vIHVzaW5nIGFuIGFic3RyYWN0IGJ1aWxkZXIgdGhhdCBvbmx5IHdyYXBzIGEgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgYnVpbGRlciA9IHRzLmNyZWF0ZUFic3RyYWN0QnVpbGRlcih0eXBlU2NyaXB0UHJvZ3JhbSwgaG9zdCk7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIHNlbWFudGljIGRpYWdub3N0aWNzIGNhY2hlXG4gICAgY29uc3QgYWZmZWN0ZWRGaWxlcyA9IG5ldyBTZXQ8dHMuU291cmNlRmlsZT4oKTtcblxuICAgIC8vIEFuYWx5emUgYWZmZWN0ZWQgZmlsZXMgd2hlbiBpbiB3YXRjaCBtb2RlIGZvciBpbmNyZW1lbnRhbCB0eXBlIGNoZWNraW5nXG4gICAgaWYgKCdnZXRTZW1hbnRpY0RpYWdub3N0aWNzT2ZOZXh0QWZmZWN0ZWRGaWxlJyBpbiBidWlsZGVyKSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc3RhbnQtY29uZGl0aW9uXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBidWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3NPZk5leHRBZmZlY3RlZEZpbGUodW5kZWZpbmVkLCAoc291cmNlRmlsZSkgPT4ge1xuICAgICAgICAgIC8vIElmIHRoZSBhZmZlY3RlZCBmaWxlIGlzIGEgVFRDIHNoaW0sIGFkZCB0aGUgc2hpbSdzIG9yaWdpbmFsIHNvdXJjZSBmaWxlLlxuICAgICAgICAgIC8vIFRoaXMgZW5zdXJlcyB0aGF0IGNoYW5nZXMgdGhhdCBhZmZlY3QgVFRDIGFyZSB0eXBlY2hlY2tlZCBldmVuIHdoZW4gdGhlIGNoYW5nZXNcbiAgICAgICAgICAvLyBhcmUgb3RoZXJ3aXNlIHVucmVsYXRlZCBmcm9tIGEgVFMgcGVyc3BlY3RpdmUgYW5kIGRvIG5vdCByZXN1bHQgaW4gSXZ5IGNvZGVnZW4gY2hhbmdlcy5cbiAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgY2hhbmdpbmcgQElucHV0IHByb3BlcnR5IHR5cGVzIG9mIGEgZGlyZWN0aXZlIHVzZWQgaW4gYW5vdGhlciBjb21wb25lbnQnc1xuICAgICAgICAgIC8vIHRlbXBsYXRlLlxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgc291cmNlRmlsZS5maWxlTmFtZS5lbmRzV2l0aCgnLm5ndHlwZWNoZWNrLnRzJylcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIFRoaXMgZmlsZSBuYW1lIGNvbnZlcnNpb24gcmVsaWVzIG9uIGludGVybmFsIGNvbXBpbGVyIGxvZ2ljIGFuZCBzaG91bGQgYmUgY29udmVydGVkXG4gICAgICAgICAgICAvLyB0byBhbiBvZmZpY2lhbCBtZXRob2Qgd2hlbiBhdmFpbGFibGUuIDE1IGlzIGxlbmd0aCBvZiBgLm5ndHlwZWNoZWNrLnRzYFxuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlbmFtZSA9IHNvdXJjZUZpbGUuZmlsZU5hbWUuc2xpY2UoMCwgLTE1KSArICcudHMnO1xuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxTb3VyY2VGaWxlID0gYnVpbGRlci5nZXRTb3VyY2VGaWxlKG9yaWdpbmFsRmlsZW5hbWUpO1xuICAgICAgICAgICAgaWYgKG9yaWdpbmFsU291cmNlRmlsZSkge1xuICAgICAgICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChvcmlnaW5hbFNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChyZXN1bHQuYWZmZWN0ZWQgYXMgdHMuU291cmNlRmlsZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBwcm9ncmFtIGxldmVsIGRpYWdub3N0aWNzXG4gICAgY29uc3QgZGlhZ25vc3RpY3MgPSBbXG4gICAgICAuLi5hbmd1bGFyQ29tcGlsZXIuZ2V0T3B0aW9uRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldEdsb2JhbERpYWdub3N0aWNzKCksXG4gICAgXTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGRpYWdub3N0aWNzKTtcblxuICAgIC8vIENvbGxlY3Qgc291cmNlIGZpbGUgc3BlY2lmaWMgZGlhZ25vc3RpY3NcbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICBpZiAoIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGJ1aWxkZXIuZ2V0U3ludGFjdGljRGlhZ25vc3RpY3Moc291cmNlRmlsZSkpO1xuICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljcyhzb3VyY2VGaWxlKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNmb3JtZXJzID0gY3JlYXRlQW90VHJhbnNmb3JtZXJzKGJ1aWxkZXIsIHRoaXMucGx1Z2luT3B0aW9ucyk7XG5cbiAgICBjb25zdCBnZXREZXBlbmRlbmNpZXMgPSAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlUGF0aCBvZiBhbmd1bGFyQ29tcGlsZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGVwZW5kZW5jaWVzLnB1c2goXG4gICAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICAgIC8vIFJldHJpZXZlIGFsbCBkZXBlbmRlbmNpZXMgb2YgdGhlIHJlc291cmNlIChzdHlsZXNoZWV0IGltcG9ydHMsIGV0Yy4pXG4gICAgICAgICAgLi4ucmVzb3VyY2VMb2FkZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMocmVzb3VyY2VQYXRoKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlcGVuZGVuY2llcztcbiAgICB9O1xuXG4gICAgLy8gUmVxdWlyZWQgdG8gc3VwcG9ydCBhc3luY2hyb25vdXMgcmVzb3VyY2UgbG9hZGluZ1xuICAgIC8vIE11c3QgYmUgZG9uZSBiZWZvcmUgY3JlYXRpbmcgdHJhbnNmb3JtZXJzIG9yIGdldHRpbmcgdGVtcGxhdGUgZGlhZ25vc3RpY3NcbiAgICBjb25zdCBwZW5kaW5nQW5hbHlzaXMgPSBhbmd1bGFyQ29tcGlsZXJcbiAgICAgIC5hbmFseXplQXN5bmMoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICAgICAgaWYgKHNvdXJjZUZpbGUuaXNEZWNsYXJhdGlvbkZpbGUpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIENvbGxlY3Qgc291cmNlcyB0aGF0IGFyZSByZXF1aXJlZCB0byBiZSBlbWl0dGVkXG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWlnbm9yZUZvckVtaXQuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhYW5ndWxhckNvbXBpbGVyLmluY3JlbWVudGFsRHJpdmVyLnNhZmVUb1NraXBFbWl0KHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuYWRkKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuXG4gICAgICAgICAgICAvLyBJZiByZXF1aXJlZCB0byBlbWl0LCBkaWFnbm9zdGljcyBtYXkgaGF2ZSBhbHNvIGNoYW5nZWRcbiAgICAgICAgICAgIGlmICghaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZSAmJlxuICAgICAgICAgICAgIWFmZmVjdGVkRmlsZXMuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBVc2UgY2FjaGVkIEFuZ3VsYXIgZGlhZ25vc3RpY3MgZm9yIHVuY2hhbmdlZCBhbmQgdW5hZmZlY3RlZCBmaWxlc1xuICAgICAgICAgICAgY29uc3QgYW5ndWxhckRpYWdub3N0aWNzID0gdGhpcy5zb3VyY2VGaWxlQ2FjaGUuZ2V0QW5ndWxhckRpYWdub3N0aWNzKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgaWYgKGFuZ3VsYXJEaWFnbm9zdGljcykge1xuICAgICAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29sbGVjdCBuZXcgQW5ndWxhciBkaWFnbm9zdGljcyBmb3IgZmlsZXMgYWZmZWN0ZWQgYnkgY2hhbmdlc1xuICAgICAgICBjb25zdCBPcHRpbWl6ZUZvciA9IHRoaXMuY29tcGlsZXJDbGkuT3B0aW1pemVGb3I7XG4gICAgICAgIGNvbnN0IG9wdGltaXplRGlhZ25vc3RpY3NGb3IgPVxuICAgICAgICAgIGFmZmVjdGVkRmlsZXMuc2l6ZSA8PSBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTERcbiAgICAgICAgICAgID8gT3B0aW1pemVGb3IuU2luZ2xlRmlsZVxuICAgICAgICAgICAgOiBPcHRpbWl6ZUZvci5XaG9sZVByb2dyYW07XG4gICAgICAgIGZvciAoY29uc3QgYWZmZWN0ZWRGaWxlIG9mIGFmZmVjdGVkRmlsZXMpIHtcbiAgICAgICAgICBjb25zdCBhbmd1bGFyRGlhZ25vc3RpY3MgPSBhbmd1bGFyQ29tcGlsZXIuZ2V0RGlhZ25vc3RpY3NGb3JGaWxlKFxuICAgICAgICAgICAgYWZmZWN0ZWRGaWxlLFxuICAgICAgICAgICAgb3B0aW1pemVEaWFnbm9zdGljc0ZvcixcbiAgICAgICAgICApO1xuICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZT8udXBkYXRlQW5ndWxhckRpYWdub3N0aWNzKGFmZmVjdGVkRmlsZSwgYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZW1pdHRlcjogdGhpcy5jcmVhdGVGaWxlRW1pdHRlcihcbiAgICAgICAgICAgIGJ1aWxkZXIsXG4gICAgICAgICAgICBtZXJnZVRyYW5zZm9ybWVycyhhbmd1bGFyQ29tcGlsZXIucHJlcGFyZUVtaXQoKS50cmFuc2Zvcm1lcnMsIHRyYW5zZm9ybWVycyksXG4gICAgICAgICAgICBnZXREZXBlbmRlbmNpZXMsXG4gICAgICAgICAgICAoc291cmNlRmlsZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuZGVsZXRlKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuICAgICAgICAgICAgICBhbmd1bGFyQ29tcGlsZXIuaW5jcmVtZW50YWxEcml2ZXIucmVjb3JkU3VjY2Vzc2Z1bEVtaXQoc291cmNlRmlsZSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICksXG4gICAgICAgIH07XG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnIpID0+ICh7IGVycm9yTWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IGAke2Vycn1gIH0pKTtcblxuICAgIGNvbnN0IGFuYWx5emluZ0ZpbGVFbWl0dGVyOiBGaWxlRW1pdHRlciA9IGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IHBlbmRpbmdBbmFseXNpcztcblxuICAgICAgaWYgKCdlcnJvck1lc3NhZ2UnIGluIGFuYWx5c2lzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihhbmFseXNpcy5lcnJvck1lc3NhZ2UpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYW5hbHlzaXMuZW1pdHRlcihmaWxlKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiBhbmFseXppbmdGaWxlRW1pdHRlcixcbiAgICAgIGJ1aWxkZXIsXG4gICAgICBpbnRlcm5hbEZpbGVzOiBpZ25vcmVGb3JFbWl0LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUppdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgKSB7XG4gICAgbGV0IGJ1aWxkZXI7XG4gICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICBidWlsZGVyID0gdGhpcy5idWlsZGVyID0gdHMuY3JlYXRlRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbShcbiAgICAgICAgcm9vdE5hbWVzLFxuICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHRoaXMuYnVpbGRlcixcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIocm9vdE5hbWVzLCBjb21waWxlck9wdGlvbnMsIGhvc3QpO1xuICAgIH1cblxuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYnVpbGRlci5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0U3ludGFjdGljRGlhZ25vc3RpY3MoKSxcbiAgICAgIC8vIEdhdGhlciBpbmNyZW1lbnRhbCBzZW1hbnRpYyBkaWFnbm9zdGljc1xuICAgICAgLi4uYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKCksXG4gICAgXTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGRpYWdub3N0aWNzKTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUppdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLmNvbXBpbGVyQ2xpLCB0aGlzLnBsdWdpbk9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiB0aGlzLmNyZWF0ZUZpbGVFbWl0dGVyKGJ1aWxkZXIsIHRyYW5zZm9ybWVycywgKCkgPT4gW10pLFxuICAgICAgYnVpbGRlcixcbiAgICAgIGludGVybmFsRmlsZXM6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVGaWxlRW1pdHRlcihcbiAgICBwcm9ncmFtOiB0cy5CdWlsZGVyUHJvZ3JhbSxcbiAgICB0cmFuc2Zvcm1lcnM6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyA9IHt9LFxuICAgIGdldEV4dHJhRGVwZW5kZW5jaWVzOiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4gSXRlcmFibGU8c3RyaW5nPixcbiAgICBvbkFmdGVyRW1pdD86IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB2b2lkLFxuICApOiBGaWxlRW1pdHRlciB7XG4gICAgcmV0dXJuIGFzeW5jIChmaWxlOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gbm9ybWFsaXplUGF0aChmaWxlKTtcbiAgICAgIGlmICh0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5oYXMoZmlsZVBhdGgpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5nZXQoZmlsZVBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2VGaWxlID0gcHJvZ3JhbS5nZXRTb3VyY2VGaWxlKGZpbGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBsZXQgY29udGVudDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgbGV0IG1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgcHJvZ3JhbS5lbWl0KFxuICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICAoZmlsZW5hbWUsIGRhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoJy5tYXAnKSkge1xuICAgICAgICAgICAgbWFwID0gZGF0YTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKCcuanMnKSkge1xuICAgICAgICAgICAgY29udGVudCA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdHJhbnNmb3JtZXJzLFxuICAgICAgKTtcblxuICAgICAgb25BZnRlckVtaXQ/Lihzb3VyY2VGaWxlKTtcblxuICAgICAgLy8gQ2FwdHVyZSBlbWl0IGhpc3RvcnkgaW5mbyBmb3IgQW5ndWxhciByZWJ1aWxkIGFuYWx5c2lzXG4gICAgICBjb25zdCBoYXNoID0gY29udGVudCA/IChhd2FpdCB0aGlzLmFkZEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCwgY29udGVudCkpLmhhc2ggOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IFtcbiAgICAgICAgLi4uKHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQoZmlsZVBhdGgpIHx8IFtdKSxcbiAgICAgICAgLi4uZ2V0RXh0cmFEZXBlbmRlbmNpZXMoc291cmNlRmlsZSksXG4gICAgICBdLm1hcChleHRlcm5hbGl6ZVBhdGgpO1xuXG4gICAgICByZXR1cm4geyBjb250ZW50LCBtYXAsIGRlcGVuZGVuY2llcywgaGFzaCB9O1xuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVDb21waWxlckNsaSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5jb21waWxlckNsaU1vZHVsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFRoaXMgdXNlcyBhIGR5bmFtaWMgaW1wb3J0IHRvIGxvYWQgYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAgd2hpY2ggbWF5IGJlIEVTTS5cbiAgICAvLyBDb21tb25KUyBjb2RlIGNhbiBsb2FkIEVTTSBjb2RlIHZpYSBhIGR5bmFtaWMgaW1wb3J0LiBVbmZvcnR1bmF0ZWx5LCBUeXBlU2NyaXB0XG4gICAgLy8gd2lsbCBjdXJyZW50bHksIHVuY29uZGl0aW9uYWxseSBkb3dubGV2ZWwgZHluYW1pYyBpbXBvcnQgaW50byBhIHJlcXVpcmUgY2FsbC5cbiAgICAvLyByZXF1aXJlIGNhbGxzIGNhbm5vdCBsb2FkIEVTTSBjb2RlIGFuZCB3aWxsIHJlc3VsdCBpbiBhIHJ1bnRpbWUgZXJyb3IuIFRvIHdvcmthcm91bmRcbiAgICAvLyB0aGlzLCBhIEZ1bmN0aW9uIGNvbnN0cnVjdG9yIGlzIHVzZWQgdG8gcHJldmVudCBUeXBlU2NyaXB0IGZyb20gY2hhbmdpbmcgdGhlIGR5bmFtaWMgaW1wb3J0LlxuICAgIC8vIE9uY2UgVHlwZVNjcmlwdCBwcm92aWRlcyBzdXBwb3J0IGZvciBrZWVwaW5nIHRoZSBkeW5hbWljIGltcG9ydCB0aGlzIHdvcmthcm91bmQgY2FuXG4gICAgLy8gYmUgZHJvcHBlZC5cbiAgICB0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlID0gYXdhaXQgbmV3IEZ1bmN0aW9uKGByZXR1cm4gaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtgKSgpO1xuICAgIHRoaXMuY29tcGlsZXJOZ2NjTW9kdWxlID0gYXdhaXQgbmV3IEZ1bmN0aW9uKGByZXR1cm4gaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpO2ApKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFkZEZpbGVFbWl0SGlzdG9yeShcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRlbnQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtPiB7XG4gICAgYXNzZXJ0Lm9rKHRoaXMud2VicGFja0NyZWF0ZUhhc2gsICdGaWxlIGVtaXR0ZXIgaXMgdXNlZCBwcmlvciB0byBXZWJwYWNrIGNvbXBpbGF0aW9uJyk7XG5cbiAgICBjb25zdCBoaXN0b3J5RGF0YTogRmlsZUVtaXRIaXN0b3J5SXRlbSA9IHtcbiAgICAgIGxlbmd0aDogY29udGVudC5sZW5ndGgsXG4gICAgICBoYXNoOiB0aGlzLndlYnBhY2tDcmVhdGVIYXNoKCd4eGhhc2g2NCcpLnVwZGF0ZShjb250ZW50KS5kaWdlc3QoKSBhcyBVaW50OEFycmF5LFxuICAgIH07XG5cbiAgICBpZiAodGhpcy53ZWJwYWNrQ2FjaGUpIHtcbiAgICAgIGNvbnN0IGhpc3RvcnkgPSBhd2FpdCB0aGlzLmdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCk7XG4gICAgICBpZiAoIWhpc3RvcnkgfHwgQnVmZmVyLmNvbXBhcmUoaGlzdG9yeS5oYXNoLCBoaXN0b3J5RGF0YS5oYXNoKSAhPT0gMCkge1xuICAgICAgICAvLyBIYXNoIGRvZXNuJ3QgbWF0Y2ggb3IgaXRlbSBkb2Vzbid0IGV4aXN0LlxuICAgICAgICBhd2FpdCB0aGlzLndlYnBhY2tDYWNoZS5zdG9yZVByb21pc2UoZmlsZVBhdGgsIG51bGwsIGhpc3RvcnlEYXRhKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICAvLyBUaGUgaW4gbWVtb3J5IGZpbGUgZW1pdCBoaXN0b3J5IGlzIG9ubHkgcmVxdWlyZWQgZHVyaW5nIHdhdGNoIG1vZGUuXG4gICAgICB0aGlzLmZpbGVFbWl0SGlzdG9yeS5zZXQoZmlsZVBhdGgsIGhpc3RvcnlEYXRhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGlzdG9yeURhdGE7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtIHwgdW5kZWZpbmVkPiB7XG4gICAgcmV0dXJuIHRoaXMud2VicGFja0NhY2hlXG4gICAgICA/IHRoaXMud2VicGFja0NhY2hlLmdldFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbSB8IHVuZGVmaW5lZD4oZmlsZVBhdGgsIG51bGwpXG4gICAgICA6IHRoaXMuZmlsZUVtaXRIaXN0b3J5LmdldChmaWxlUGF0aCk7XG4gIH1cbn1cbiJdfQ==