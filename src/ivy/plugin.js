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
const PLUGIN_NAME = 'angular-compiler';
const compilationFileEmitters = new WeakMap();
class AngularWebpackPlugin {
    pluginOptions;
    compilerCliModule;
    watchMode;
    ngtscNextProgram;
    builder;
    sourceFileCache;
    webpackCache;
    webpackCreateHash;
    fileDependencies = new Map();
    requiredFilesToEmit = new Set();
    requiredFilesToEmitCache = new Map();
    fileEmitHistory = new Map();
    constructor(options = {}) {
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
            compiler.resolverFactory.hooks.resolveOptions
                .for('normal')
                .tap(PLUGIN_NAME, (resolveOptions) => {
                resolveOptions.plugins ??= [];
                resolveOptions.plugins.push(pathsPlugin);
                return resolveOptions;
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
                (0, diagnostics_1.addError)(compilation, `Failed to initialize Angular compilation - ${error instanceof Error ? error.message : error}`);
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
            for (const changedFile of [
                ...(compiler.modifiedFiles ?? []),
                ...(compiler.removedFiles ?? []),
            ]) {
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
            if (internalFiles?.has(sourceFile)) {
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
            // Rebuild any remaining AOT required modules
            await this.rebuildRequiredFiles(modules, compilation, fileEmitter);
            // Clear out the Webpack compilation to avoid an extra retaining reference
            state.resourceLoader?.clearParentCompilation();
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
                if (state.previousUnused?.has(unused)) {
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
                if (emitResult?.content === undefined ||
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
            this.requiredFilesToEmit.clear();
            for (const sourceFile of builder.getSourceFiles()) {
                if (sourceFile.isDeclarationFile) {
                    continue;
                }
                // Collect sources that are required to be emitted
                if (!ignoreForEmit.has(sourceFile) &&
                    !angularCompiler.incrementalCompilation.safeToSkipEmit(sourceFile)) {
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
                this.sourceFileCache?.updateAngularDiagnostics(affectedFile, angularDiagnostics);
            }
            return {
                emitter: this.createFileEmitter(builder, (0, transformation_1.mergeTransformers)(angularCompiler.prepareEmit().transformers, transformers), getDependencies, (sourceFile) => {
                    this.requiredFilesToEmit.delete((0, paths_1.normalizePath)(sourceFile.fileName));
                    angularCompiler.incrementalCompilation.recordSuccessfulEmit(sourceFile);
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
            onAfterEmit?.(sourceFile);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLCtDQUFpQztBQUVqQyxrREFBd0Q7QUFDeEQsd0RBQTJEO0FBQzNELG1DQUEwQztBQUMxQywrQ0FLdUI7QUFDdkIsaUNBT2dCO0FBQ2hCLG1DQUF5RDtBQUN6RCxxQ0FBbUc7QUFDbkcscUNBQW9FO0FBQ3BFLHFEQUFtRztBQUVuRzs7OztHQUlHO0FBQ0gsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLENBQUM7QUF1QnpDLE1BQU0sV0FBVyxHQUFHLGtCQUFrQixDQUFDO0FBQ3ZDLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxPQUFPLEVBQXNDLENBQUM7QUFPbEYsTUFBYSxvQkFBb0I7SUFDZCxhQUFhLENBQThCO0lBQ3BELGlCQUFpQixDQUEwQztJQUMzRCxTQUFTLENBQVc7SUFDcEIsZ0JBQWdCLENBQWdCO0lBQ2hDLE9BQU8sQ0FBK0M7SUFDdEQsZUFBZSxDQUFtQjtJQUNsQyxZQUFZLENBQXVDO0lBQ25ELGlCQUFpQixDQUE2QztJQUNyRCxnQkFBZ0IsR0FBRyxJQUFJLEdBQUcsRUFBdUIsQ0FBQztJQUNsRCxtQkFBbUIsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBQ3hDLHdCQUF3QixHQUFHLElBQUksR0FBRyxFQUFzQyxDQUFDO0lBQ3pFLGVBQWUsR0FBRyxJQUFJLEdBQUcsRUFBK0IsQ0FBQztJQUUxRSxZQUFZLFVBQWdELEVBQUU7UUFDNUQsSUFBSSxDQUFDLGFBQWEsR0FBRztZQUNuQixpQkFBaUIsRUFBRSxLQUFLO1lBQ3hCLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsT0FBTyxFQUFFLEtBQUs7WUFDZCxnQkFBZ0IsRUFB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LE9BQU8sQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRTtnQkFDcEUsNENBQTRDO2dCQUM1QyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7YUFDbkU7U0FDRjthQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUN6QixzRUFBc0U7WUFDdEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ2pEO1FBRUQsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQztJQUVPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxRQUFnQjtRQUMvQyxPQUFPLElBQUksQ0FBQyxZQUFZO1lBQ3RCLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBa0MsUUFBUSxFQUFFLElBQUksQ0FBQztZQUMvRSxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNGO0FBcnBCRCxvREFxcEJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB0eXBlIHsgQ29tcGlsZXJIb3N0LCBDb21waWxlck9wdGlvbnMsIE5ndHNjUHJvZ3JhbSB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBzdHJpY3QgYXMgYXNzZXJ0IH0gZnJvbSAnYXNzZXJ0JztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb21waWxhdGlvbiwgQ29tcGlsZXIsIE1vZHVsZSwgTm9ybWFsTW9kdWxlIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7IFNvdXJjZUZpbGVDYWNoZSB9IGZyb20gJy4vY2FjaGUnO1xuaW1wb3J0IHtcbiAgRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgYWRkRXJyb3IsXG4gIGFkZFdhcm5pbmcsXG4gIGNyZWF0ZURpYWdub3N0aWNzUmVwb3J0ZXIsXG59IGZyb20gJy4vZGlhZ25vc3RpY3MnO1xuaW1wb3J0IHtcbiAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyxcbiAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24sXG4gIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyxcbiAgYXVnbWVudEhvc3RXaXRoUmVzb3VyY2VzLFxuICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zLFxuICBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nLFxufSBmcm9tICcuL2hvc3QnO1xuaW1wb3J0IHsgZXh0ZXJuYWxpemVQYXRoLCBub3JtYWxpemVQYXRoIH0gZnJvbSAnLi9wYXRocyc7XG5pbXBvcnQgeyBBbmd1bGFyUGx1Z2luU3ltYm9sLCBFbWl0RmlsZVJlc3VsdCwgRmlsZUVtaXR0ZXIsIEZpbGVFbWl0dGVyQ29sbGVjdGlvbiB9IGZyb20gJy4vc3ltYm9sJztcbmltcG9ydCB7IElucHV0RmlsZVN5c3RlbVN5bmMsIGNyZWF0ZVdlYnBhY2tTeXN0ZW0gfSBmcm9tICcuL3N5c3RlbSc7XG5pbXBvcnQgeyBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMsIGNyZWF0ZUppdFRyYW5zZm9ybWVycywgbWVyZ2VUcmFuc2Zvcm1lcnMgfSBmcm9tICcuL3RyYW5zZm9ybWF0aW9uJztcblxuLyoqXG4gKiBUaGUgdGhyZXNob2xkIHVzZWQgdG8gZGV0ZXJtaW5lIHdoZXRoZXIgQW5ndWxhciBmaWxlIGRpYWdub3N0aWNzIHNob3VsZCBvcHRpbWl6ZSBmb3IgZnVsbCBwcm9ncmFtc1xuICogb3Igc2luZ2xlIGZpbGVzLiBJZiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGZpbGVzIGZvciBhIGJ1aWxkIGlzIG1vcmUgdGhhbiB0aGUgdGhyZXNob2xkLCBmdWxsXG4gKiBwcm9ncmFtIG9wdGltaXphdGlvbiB3aWxsIGJlIHVzZWQuXG4gKi9cbmNvbnN0IERJQUdOT1NUSUNTX0FGRkVDVEVEX1RIUkVTSE9MRCA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zIHtcbiAgdHNjb25maWc6IHN0cmluZztcbiAgY29tcGlsZXJPcHRpb25zPzogQ29tcGlsZXJPcHRpb25zO1xuICBmaWxlUmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IGJvb2xlYW47XG4gIGVtaXRDbGFzc01ldGFkYXRhOiBib29sZWFuO1xuICBlbWl0TmdNb2R1bGVTY29wZTogYm9vbGVhbjtcbiAgaml0TW9kZTogYm9vbGVhbjtcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFRoZSBBbmd1bGFyIGNvbXBpbGF0aW9uIHN0YXRlIHRoYXQgaXMgbWFpbnRhaW5lZCBhY3Jvc3MgZWFjaCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICovXG5pbnRlcmZhY2UgQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUge1xuICByZXNvdXJjZUxvYWRlcj86IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgcHJldmlvdXNVbnVzZWQ/OiBTZXQ8c3RyaW5nPjtcbiAgcGF0aHNQbHVnaW46IFR5cGVTY3JpcHRQYXRoc1BsdWdpbjtcbn1cblxuY29uc3QgUExVR0lOX05BTUUgPSAnYW5ndWxhci1jb21waWxlcic7XG5jb25zdCBjb21waWxhdGlvbkZpbGVFbWl0dGVycyA9IG5ldyBXZWFrTWFwPENvbXBpbGF0aW9uLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24+KCk7XG5cbmludGVyZmFjZSBGaWxlRW1pdEhpc3RvcnlJdGVtIHtcbiAgbGVuZ3RoOiBudW1iZXI7XG4gIGhhc2g6IFVpbnQ4QXJyYXk7XG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyV2VicGFja1BsdWdpbiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luT3B0aW9uczogQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zO1xuICBwcml2YXRlIGNvbXBpbGVyQ2xpTW9kdWxlPzogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyk7XG4gIHByaXZhdGUgd2F0Y2hNb2RlPzogYm9vbGVhbjtcbiAgcHJpdmF0ZSBuZ3RzY05leHRQcm9ncmFtPzogTmd0c2NQcm9ncmFtO1xuICBwcml2YXRlIGJ1aWxkZXI/OiB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICBwcml2YXRlIHNvdXJjZUZpbGVDYWNoZT86IFNvdXJjZUZpbGVDYWNoZTtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ2FjaGU/OiBSZXR1cm5UeXBlPENvbXBpbGF0aW9uWydnZXRDYWNoZSddPjtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ3JlYXRlSGFzaD86IENvbXBpbGVyWyd3ZWJwYWNrJ11bJ3V0aWwnXVsnY3JlYXRlSGFzaCddO1xuICBwcml2YXRlIHJlYWRvbmx5IGZpbGVEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVxdWlyZWRGaWxlc1RvRW1pdCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBFbWl0RmlsZVJlc3VsdCB8IHVuZGVmaW5lZD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRW1pdEhpc3RvcnkgPSBuZXcgTWFwPHN0cmluZywgRmlsZUVtaXRIaXN0b3J5SXRlbT4oKTtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBQYXJ0aWFsPEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucz4gPSB7fSkge1xuICAgIHRoaXMucGx1Z2luT3B0aW9ucyA9IHtcbiAgICAgIGVtaXRDbGFzc01ldGFkYXRhOiBmYWxzZSxcbiAgICAgIGVtaXROZ01vZHVsZVNjb3BlOiBmYWxzZSxcbiAgICAgIGppdE1vZGU6IGZhbHNlLFxuICAgICAgZmlsZVJlcGxhY2VtZW50czoge30sXG4gICAgICBzdWJzdGl0dXRpb25zOiB7fSxcbiAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdHJ1ZSxcbiAgICAgIHRzY29uZmlnOiAndHNjb25maWcuanNvbicsXG4gICAgICAuLi5vcHRpb25zLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldCBjb21waWxlckNsaSgpOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKSB7XG4gICAgLy8gVGhlIGNvbXBpbGVyQ2xpTW9kdWxlIGZpZWxkIGlzIGd1YXJhbnRlZWQgdG8gYmUgZGVmaW5lZCBkdXJpbmcgYSBjb21waWxhdGlvblxuICAgIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gICAgLy8gaG9vayBleGVjdXRpb24gaXMgYW4gaW1wbGVtZW50YXRpb24gZXJyb3IuXG4gICAgYXNzZXJ0Lm9rKHRoaXMuY29tcGlsZXJDbGlNb2R1bGUsIGAnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgICByZXR1cm4gdGhpcy5jb21waWxlckNsaU1vZHVsZTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCk6IEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucyB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luT3B0aW9ucztcbiAgfVxuXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlcik6IHZvaWQge1xuICAgIGNvbnN0IHsgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4sIFdlYnBhY2tFcnJvciwgdXRpbCB9ID0gY29tcGlsZXIud2VicGFjaztcbiAgICB0aGlzLndlYnBhY2tDcmVhdGVIYXNoID0gdXRpbC5jcmVhdGVIYXNoO1xuXG4gICAgLy8gU2V0dXAgZmlsZSByZXBsYWNlbWVudHMgd2l0aCB3ZWJwYWNrXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMpKSB7XG4gICAgICBuZXcgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4oXG4gICAgICAgIG5ldyBSZWdFeHAoJ14nICsga2V5LnJlcGxhY2UoL1suKitcXC0/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJykgKyAnJCcpLFxuICAgICAgICB2YWx1ZSxcbiAgICAgICkuYXBwbHkoY29tcGlsZXIpO1xuICAgIH1cblxuICAgIC8vIFNldCByZXNvbHZlciBvcHRpb25zXG4gICAgY29uc3QgcGF0aHNQbHVnaW4gPSBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKCk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKFBMVUdJTl9OQU1FLCAoY29tcGlsZXIpID0+IHtcbiAgICAgIGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlT3B0aW9uc1xuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAudGFwKFBMVUdJTl9OQU1FLCAocmVzb2x2ZU9wdGlvbnMpID0+IHtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zID8/PSBbXTtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zLnB1c2gocGF0aHNQbHVnaW4pO1xuXG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVPcHRpb25zO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIExvYWQgdGhlIGNvbXBpbGVyLWNsaSBpZiBub3QgYWxyZWFkeSBhdmFpbGFibGVcbiAgICBjb21waWxlci5ob29rcy5iZWZvcmVDb21waWxlLnRhcFByb21pc2UoUExVR0lOX05BTUUsICgpID0+IHRoaXMuaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCkpO1xuXG4gICAgY29uc3QgY29tcGlsYXRpb25TdGF0ZTogQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUgPSB7IHBhdGhzUGx1Z2luIH07XG4gICAgY29tcGlsZXIuaG9va3MudGhpc0NvbXBpbGF0aW9uLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGF0aW9uKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLnNldHVwQ29tcGlsYXRpb24oY29tcGlsYXRpb24sIGNvbXBpbGF0aW9uU3RhdGUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWRkRXJyb3IoXG4gICAgICAgICAgY29tcGlsYXRpb24sXG4gICAgICAgICAgYEZhaWxlZCB0byBpbml0aWFsaXplIEFuZ3VsYXIgY29tcGlsYXRpb24gLSAke1xuICAgICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvclxuICAgICAgICAgIH1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbiwgc3RhdGU6IEFuZ3VsYXJDb21waWxhdGlvblN0YXRlKTogdm9pZCB7XG4gICAgY29uc3QgY29tcGlsZXIgPSBjb21waWxhdGlvbi5jb21waWxlcjtcblxuICAgIC8vIFJlZ2lzdGVyIHBsdWdpbiB0byBlbnN1cmUgZGV0ZXJtaW5pc3RpYyBlbWl0IG9yZGVyIGluIG11bHRpLXBsdWdpbiB1c2FnZVxuICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSB0aGlzLnJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uKTtcbiAgICB0aGlzLndhdGNoTW9kZSA9IGNvbXBpbGVyLndhdGNoTW9kZTtcblxuICAgIC8vIEluaXRpYWxpemUgd2VicGFjayBjYWNoZVxuICAgIGlmICghdGhpcy53ZWJwYWNrQ2FjaGUgJiYgY29tcGlsYXRpb24ub3B0aW9ucy5jYWNoZSkge1xuICAgICAgdGhpcy53ZWJwYWNrQ2FjaGUgPSBjb21waWxhdGlvbi5nZXRDYWNoZShQTFVHSU5fTkFNRSk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIGlmIG5vdCBhbHJlYWR5IHNldHVwXG4gICAgaWYgKCFzdGF0ZS5yZXNvdXJjZUxvYWRlcikge1xuICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKHRoaXMud2F0Y2hNb2RlKTtcbiAgICB9XG5cbiAgICAvLyBTZXR1cCBhbmQgcmVhZCBUeXBlU2NyaXB0IGFuZCBBbmd1bGFyIGNvbXBpbGVyIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfSA9IHRoaXMubG9hZENvbmZpZ3VyYXRpb24oKTtcblxuICAgIC8vIENyZWF0ZSBkaWFnbm9zdGljcyByZXBvcnRlciBhbmQgcmVwb3J0IGNvbmZpZ3VyYXRpb24gZmlsZSBlcnJvcnNcbiAgICBjb25zdCBkaWFnbm9zdGljc1JlcG9ydGVyID0gY3JlYXRlRGlhZ25vc3RpY3NSZXBvcnRlcihjb21waWxhdGlvbiwgKGRpYWdub3N0aWMpID0+XG4gICAgICB0aGlzLmNvbXBpbGVyQ2xpLmZvcm1hdERpYWdub3N0aWNzKFtkaWFnbm9zdGljXSksXG4gICAgKTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGVycm9ycyk7XG5cbiAgICAvLyBVcGRhdGUgVHlwZVNjcmlwdCBwYXRoIG1hcHBpbmcgcGx1Z2luIHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICBzdGF0ZS5wYXRoc1BsdWdpbi51cGRhdGUoY29tcGlsZXJPcHRpb25zKTtcblxuICAgIC8vIENyZWF0ZSBhIFdlYnBhY2stYmFzZWQgVHlwZVNjcmlwdCBjb21waWxlciBob3N0XG4gICAgY29uc3Qgc3lzdGVtID0gY3JlYXRlV2VicGFja1N5c3RlbShcbiAgICAgIC8vIFdlYnBhY2sgbGFja3MgYW4gSW5wdXRGaWxlU3l0ZW0gdHlwZSBkZWZpbml0aW9uIHdpdGggc3luYyBmdW5jdGlvbnNcbiAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSBhcyBJbnB1dEZpbGVTeXN0ZW1TeW5jLFxuICAgICAgbm9ybWFsaXplUGF0aChjb21waWxlci5jb250ZXh0KSxcbiAgICApO1xuICAgIGNvbnN0IGhvc3QgPSB0cy5jcmVhdGVJbmNyZW1lbnRhbENvbXBpbGVySG9zdChjb21waWxlck9wdGlvbnMsIHN5c3RlbSk7XG5cbiAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBjYWNoaW5nIGFuZCByZXVzZSBjYWNoZSBmcm9tIHByZXZpb3VzIGNvbXBpbGF0aW9uIGlmIHByZXNlbnRcbiAgICBsZXQgY2FjaGUgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZTtcbiAgICBsZXQgY2hhbmdlZEZpbGVzO1xuICAgIGlmIChjYWNoZSkge1xuICAgICAgY2hhbmdlZEZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIFtcbiAgICAgICAgLi4uKGNvbXBpbGVyLm1vZGlmaWVkRmlsZXMgPz8gW10pLFxuICAgICAgICAuLi4oY29tcGlsZXIucmVtb3ZlZEZpbGVzID8/IFtdKSxcbiAgICAgIF0pIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZENoYW5nZWRGaWxlID0gbm9ybWFsaXplUGF0aChjaGFuZ2VkRmlsZSk7XG4gICAgICAgIC8vIEludmFsaWRhdGUgZmlsZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgdGhpcy5maWxlRGVwZW5kZW5jaWVzLmRlbGV0ZShub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgICAvLyBJbnZhbGlkYXRlIGV4aXN0aW5nIGNhY2hlXG4gICAgICAgIGNhY2hlLmludmFsaWRhdGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcblxuICAgICAgICBjaGFuZ2VkRmlsZXMuYWRkKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEluaXRpYWxpemUgYSBuZXcgY2FjaGVcbiAgICAgIGNhY2hlID0gbmV3IFNvdXJjZUZpbGVDYWNoZSgpO1xuICAgICAgLy8gT25seSBzdG9yZSBjYWNoZSBpZiBpbiB3YXRjaCBtb2RlXG4gICAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgPSBjYWNoZTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyhob3N0LCBjYWNoZSk7XG5cbiAgICBjb25zdCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUoXG4gICAgICBob3N0LmdldEN1cnJlbnREaXJlY3RvcnkoKSxcbiAgICAgIGhvc3QuZ2V0Q2Fub25pY2FsRmlsZU5hbWUuYmluZChob3N0KSxcbiAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICApO1xuXG4gICAgLy8gU2V0dXAgc291cmNlIGZpbGUgZGVwZW5kZW5jeSBjb2xsZWN0aW9uXG4gICAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24oaG9zdCwgdGhpcy5maWxlRGVwZW5kZW5jaWVzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuXG4gICAgLy8gU2V0dXAgcmVzb3VyY2UgbG9hZGluZ1xuICAgIHN0YXRlLnJlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbiwgY2hhbmdlZEZpbGVzKTtcbiAgICBhdWdtZW50SG9zdFdpdGhSZXNvdXJjZXMoaG9zdCwgc3RhdGUucmVzb3VyY2VMb2FkZXIsIHtcbiAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdGhpcy5wbHVnaW5PcHRpb25zLmRpcmVjdFRlbXBsYXRlTG9hZGluZyxcbiAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbjogdGhpcy5wbHVnaW5PcHRpb25zLmlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICB9KTtcblxuICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGFkanVzdG1lbnQgb3B0aW9uc1xuICAgIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyhob3N0LCB0aGlzLnBsdWdpbk9wdGlvbnMuZmlsZVJlcGxhY2VtZW50cywgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcbiAgICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zKGhvc3QsIHRoaXMucGx1Z2luT3B0aW9ucy5zdWJzdGl0dXRpb25zKTtcblxuICAgIC8vIENyZWF0ZSB0aGUgZmlsZSBlbWl0dGVyIHVzZWQgYnkgdGhlIHdlYnBhY2sgbG9hZGVyXG4gICAgY29uc3QgeyBmaWxlRW1pdHRlciwgYnVpbGRlciwgaW50ZXJuYWxGaWxlcyB9ID0gdGhpcy5wbHVnaW5PcHRpb25zLmppdE1vZGVcbiAgICAgID8gdGhpcy51cGRhdGVKaXRQcm9ncmFtKGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBob3N0LCBkaWFnbm9zdGljc1JlcG9ydGVyKVxuICAgICAgOiB0aGlzLnVwZGF0ZUFvdFByb2dyYW0oXG4gICAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgIHJvb3ROYW1lcyxcbiAgICAgICAgICBob3N0LFxuICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICAgICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXIsXG4gICAgICAgICk7XG5cbiAgICAvLyBTZXQgb2YgZmlsZXMgdXNlZCBkdXJpbmcgdGhlIHVudXNlZCBUeXBlU2NyaXB0IGZpbGUgYW5hbHlzaXNcbiAgICBjb25zdCBjdXJyZW50VW51c2VkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICBpZiAoaW50ZXJuYWxGaWxlcz8uaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgYWxsIHByb2dyYW0gZmlsZXMgYXJlIGNvbnNpZGVyZWQgcGFydCBvZiB0aGUgY29tcGlsYXRpb24gYW5kIHdpbGwgYmUgd2F0Y2hlZC5cbiAgICAgIC8vIFdlYnBhY2sgZG9lcyBub3Qgbm9ybWFsaXplIHBhdGhzLiBUaGVyZWZvcmUsIHdlIG5lZWQgdG8gbm9ybWFsaXplIHRoZSBwYXRoIHdpdGggRlMgc2VwZXJhdG9ycy5cbiAgICAgIGNvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMuYWRkKGV4dGVybmFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG5cbiAgICAgIC8vIEFkZCBhbGwgbm9uLWRlY2xhcmF0aW9uIGZpbGVzIHRvIHRoZSBpbml0aWFsIHNldCBvZiB1bnVzZWQgZmlsZXMuIFRoZSBzZXQgd2lsbCBiZVxuICAgICAgLy8gYW5hbHl6ZWQgYW5kIHBydW5lZCBhZnRlciBhbGwgV2VicGFjayBtb2R1bGVzIGFyZSBmaW5pc2hlZCBidWlsZGluZy5cbiAgICAgIGlmICghc291cmNlRmlsZS5pc0RlY2xhcmF0aW9uRmlsZSkge1xuICAgICAgICBjdXJyZW50VW51c2VkLmFkZChub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb21waWxhdGlvbi5ob29rcy5maW5pc2hNb2R1bGVzLnRhcFByb21pc2UoUExVR0lOX05BTUUsIGFzeW5jIChtb2R1bGVzKSA9PiB7XG4gICAgICAvLyBSZWJ1aWxkIGFueSByZW1haW5pbmcgQU9UIHJlcXVpcmVkIG1vZHVsZXNcbiAgICAgIGF3YWl0IHRoaXMucmVidWlsZFJlcXVpcmVkRmlsZXMobW9kdWxlcywgY29tcGlsYXRpb24sIGZpbGVFbWl0dGVyKTtcblxuICAgICAgLy8gQ2xlYXIgb3V0IHRoZSBXZWJwYWNrIGNvbXBpbGF0aW9uIHRvIGF2b2lkIGFuIGV4dHJhIHJldGFpbmluZyByZWZlcmVuY2VcbiAgICAgIHN0YXRlLnJlc291cmNlTG9hZGVyPy5jbGVhclBhcmVudENvbXBpbGF0aW9uKCk7XG5cbiAgICAgIC8vIEFuYWx5emUgcHJvZ3JhbSBmb3IgdW51c2VkIGZpbGVzXG4gICAgICBpZiAoY29tcGlsYXRpb24uZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHdlYnBhY2tNb2R1bGUgb2YgbW9kdWxlcykge1xuICAgICAgICBjb25zdCByZXNvdXJjZSA9ICh3ZWJwYWNrTW9kdWxlIGFzIE5vcm1hbE1vZHVsZSkucmVzb3VyY2U7XG4gICAgICAgIGlmIChyZXNvdXJjZSkge1xuICAgICAgICAgIHRoaXMubWFya1Jlc291cmNlVXNlZChub3JtYWxpemVQYXRoKHJlc291cmNlKSwgY3VycmVudFVudXNlZCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB1bnVzZWQgb2YgY3VycmVudFVudXNlZCkge1xuICAgICAgICBpZiAoc3RhdGUucHJldmlvdXNVbnVzZWQ/Lmhhcyh1bnVzZWQpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYWRkV2FybmluZyhcbiAgICAgICAgICBjb21waWxhdGlvbixcbiAgICAgICAgICBgJHt1bnVzZWR9IGlzIHBhcnQgb2YgdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24gYnV0IGl0J3MgdW51c2VkLlxcbmAgK1xuICAgICAgICAgICAgYEFkZCBvbmx5IGVudHJ5IHBvaW50cyB0byB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydGllcyBpbiB5b3VyIHRzY29uZmlnLmAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzdGF0ZS5wcmV2aW91c1VudXNlZCA9IGN1cnJlbnRVbnVzZWQ7XG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSBmaWxlIGVtaXR0ZXIgZm9yIGxvYWRlciB1c2FnZVxuICAgIGVtaXRSZWdpc3RyYXRpb24udXBkYXRlKGZpbGVFbWl0dGVyKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVnaXN0ZXJXaXRoQ29tcGlsYXRpb24oY29tcGlsYXRpb246IENvbXBpbGF0aW9uKSB7XG4gICAgbGV0IGZpbGVFbWl0dGVycyA9IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLmdldChjb21waWxhdGlvbik7XG4gICAgaWYgKCFmaWxlRW1pdHRlcnMpIHtcbiAgICAgIGZpbGVFbWl0dGVycyA9IG5ldyBGaWxlRW1pdHRlckNvbGxlY3Rpb24oKTtcbiAgICAgIGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLnNldChjb21waWxhdGlvbiwgZmlsZUVtaXR0ZXJzKTtcbiAgICAgIGNvbXBpbGF0aW9uLmNvbXBpbGVyLndlYnBhY2suTm9ybWFsTW9kdWxlLmdldENvbXBpbGF0aW9uSG9va3MoY29tcGlsYXRpb24pLmxvYWRlci50YXAoXG4gICAgICAgIFBMVUdJTl9OQU1FLFxuICAgICAgICAobG9hZGVyQ29udGV4dDogeyBbQW5ndWxhclBsdWdpblN5bWJvbF0/OiBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSkgPT4ge1xuICAgICAgICAgIGxvYWRlckNvbnRleHRbQW5ndWxhclBsdWdpblN5bWJvbF0gPSBmaWxlRW1pdHRlcnM7XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBlbWl0UmVnaXN0cmF0aW9uID0gZmlsZUVtaXR0ZXJzLnJlZ2lzdGVyKCk7XG5cbiAgICByZXR1cm4gZW1pdFJlZ2lzdHJhdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgbWFya1Jlc291cmNlVXNlZChub3JtYWxpemVkUmVzb3VyY2VQYXRoOiBzdHJpbmcsIGN1cnJlbnRVbnVzZWQ6IFNldDxzdHJpbmc+KTogdm9pZCB7XG4gICAgaWYgKCFjdXJyZW50VW51c2VkLmhhcyhub3JtYWxpemVkUmVzb3VyY2VQYXRoKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGN1cnJlbnRVbnVzZWQuZGVsZXRlKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpO1xuICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQobm9ybWFsaXplZFJlc291cmNlUGF0aCk7XG4gICAgaWYgKCFkZXBlbmRlbmNpZXMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBkZXBlbmRlbmN5IG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgdGhpcy5tYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZVBhdGgoZGVwZW5kZW5jeSksIGN1cnJlbnRVbnVzZWQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVidWlsZFJlcXVpcmVkRmlsZXMoXG4gICAgbW9kdWxlczogSXRlcmFibGU8TW9kdWxlPixcbiAgICBjb21waWxhdGlvbjogQ29tcGlsYXRpb24sXG4gICAgZmlsZUVtaXR0ZXI6IEZpbGVFbWl0dGVyLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LnNpemUgPT09IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlc1RvUmVidWlsZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgcmVxdWlyZWRGaWxlIG9mIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdCkge1xuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0RmlsZUVtaXRIaXN0b3J5KHJlcXVpcmVkRmlsZSk7XG4gICAgICBpZiAoaGlzdG9yeSkge1xuICAgICAgICBjb25zdCBlbWl0UmVzdWx0ID0gYXdhaXQgZmlsZUVtaXR0ZXIocmVxdWlyZWRGaWxlKTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVtaXRSZXN1bHQ/LmNvbnRlbnQgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIGhpc3RvcnkubGVuZ3RoICE9PSBlbWl0UmVzdWx0LmNvbnRlbnQubGVuZ3RoIHx8XG4gICAgICAgICAgZW1pdFJlc3VsdC5oYXNoID09PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICBCdWZmZXIuY29tcGFyZShoaXN0b3J5Lmhhc2gsIGVtaXRSZXN1bHQuaGFzaCkgIT09IDBcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gTmV3IGVtaXQgcmVzdWx0IGlzIGRpZmZlcmVudCBzbyByZWJ1aWxkIHVzaW5nIG5ldyBlbWl0IHJlc3VsdFxuICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLnNldChyZXF1aXJlZEZpbGUsIGVtaXRSZXN1bHQpO1xuICAgICAgICAgIGZpbGVzVG9SZWJ1aWxkLmFkZChyZXF1aXJlZEZpbGUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBlbWl0IGhpc3Rvcnkgc28gcmVidWlsZFxuICAgICAgICBmaWxlc1RvUmVidWlsZC5hZGQocmVxdWlyZWRGaWxlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmlsZXNUb1JlYnVpbGQuc2l6ZSA+IDApIHtcbiAgICAgIGNvbnN0IHJlYnVpbGQgPSAod2VicGFja01vZHVsZTogTW9kdWxlKSA9PlxuICAgICAgICBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4gY29tcGlsYXRpb24ucmVidWlsZE1vZHVsZSh3ZWJwYWNrTW9kdWxlLCAoKSA9PiByZXNvbHZlKCkpKTtcblxuICAgICAgY29uc3QgbW9kdWxlc1RvUmVidWlsZCA9IFtdO1xuICAgICAgZm9yIChjb25zdCB3ZWJwYWNrTW9kdWxlIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2UgPSAod2VicGFja01vZHVsZSBhcyBOb3JtYWxNb2R1bGUpLnJlc291cmNlO1xuICAgICAgICBpZiAocmVzb3VyY2UgJiYgZmlsZXNUb1JlYnVpbGQuaGFzKG5vcm1hbGl6ZVBhdGgocmVzb3VyY2UpKSkge1xuICAgICAgICAgIG1vZHVsZXNUb1JlYnVpbGQucHVzaCh3ZWJwYWNrTW9kdWxlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwobW9kdWxlc1RvUmVidWlsZC5tYXAoKHdlYnBhY2tNb2R1bGUpID0+IHJlYnVpbGQod2VicGFja01vZHVsZSkpKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5jbGVhcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBsb2FkQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCB7XG4gICAgICBvcHRpb25zOiBjb21waWxlck9wdGlvbnMsXG4gICAgICByb290TmFtZXMsXG4gICAgICBlcnJvcnMsXG4gICAgfSA9IHRoaXMuY29tcGlsZXJDbGkucmVhZENvbmZpZ3VyYXRpb24oXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMudHNjb25maWcsXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMuY29tcGlsZXJPcHRpb25zLFxuICAgICk7XG4gICAgY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSBjb21waWxlck9wdGlvbnMuc291cmNlTWFwO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuYWxsb3dFbXB0eUNvZGVnZW5GaWxlcyA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5hbm5vdGF0aW9uc0FzID0gJ2RlY29yYXRvcnMnO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5lbmFibGVSZXNvdXJjZUlubGluaW5nID0gZmFsc2U7XG5cbiAgICByZXR1cm4geyBjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgZXJyb3JzIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUFvdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgICByZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyLFxuICApIHtcbiAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgc3BlY2lmaWMgcHJvZ3JhbSB0aGF0IGNvbnRhaW5zIHRoZSBBbmd1bGFyIGNvbXBpbGVyXG4gICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBuZXcgdGhpcy5jb21waWxlckNsaS5OZ3RzY1Byb2dyYW0oXG4gICAgICByb290TmFtZXMsXG4gICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICBob3N0LFxuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtLFxuICAgICk7XG4gICAgY29uc3QgYW5ndWxhckNvbXBpbGVyID0gYW5ndWxhclByb2dyYW0uY29tcGlsZXI7XG5cbiAgICAvLyBUaGUgYGlnbm9yZUZvckVtaXRgIHJldHVybiB2YWx1ZSBjYW4gYmUgc2FmZWx5IGlnbm9yZWQgd2hlbiBlbWl0dGluZy4gT25seSBmaWxlc1xuICAgIC8vIHRoYXQgd2lsbCBiZSBidW5kbGVkIChyZXF1ZXN0ZWQgYnkgV2VicGFjaykgd2lsbCBiZSBlbWl0dGVkLiBDb21iaW5lZCB3aXRoIFR5cGVTY3JpcHQnc1xuICAgIC8vIGVsaWRpbmcgb2YgdHlwZSBvbmx5IGltcG9ydHMsIHRoaXMgd2lsbCBjYXVzZSB0eXBlIG9ubHkgZmlsZXMgdG8gYmUgYXV0b21hdGljYWxseSBpZ25vcmVkLlxuICAgIC8vIEludGVybmFsIEFuZ3VsYXIgdHlwZSBjaGVjayBmaWxlcyBhcmUgYWxzbyBub3QgcmVzb2x2YWJsZSBieSB0aGUgYnVuZGxlci4gRXZlbiBpZiB0aGV5XG4gICAgLy8gd2VyZSBzb21laG93IGVycmFudGx5IGltcG9ydGVkLCB0aGUgYnVuZGxlciB3b3VsZCBlcnJvciBiZWZvcmUgYW4gZW1pdCB3YXMgYXR0ZW1wdGVkLlxuICAgIC8vIERpYWdub3N0aWNzIGFyZSBzdGlsbCBjb2xsZWN0ZWQgZm9yIGFsbCBmaWxlcyB3aGljaCByZXF1aXJlcyB1c2luZyBgaWdub3JlRm9yRGlhZ25vc3RpY3NgLlxuICAgIGNvbnN0IHsgaWdub3JlRm9yRGlhZ25vc3RpY3MsIGlnbm9yZUZvckVtaXQgfSA9IGFuZ3VsYXJDb21waWxlcjtcblxuICAgIC8vIFNvdXJjZUZpbGUgdmVyc2lvbnMgYXJlIHJlcXVpcmVkIGZvciBidWlsZGVyIHByb2dyYW1zLlxuICAgIC8vIFRoZSB3cmFwcGVkIGhvc3QgaW5zaWRlIE5ndHNjUHJvZ3JhbSBhZGRzIGFkZGl0aW9uYWwgZmlsZXMgdGhhdCB3aWxsIG5vdCBoYXZlIHZlcnNpb25zLlxuICAgIGNvbnN0IHR5cGVTY3JpcHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW0uZ2V0VHNQcm9ncmFtKCk7XG4gICAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyh0eXBlU2NyaXB0UHJvZ3JhbSk7XG5cbiAgICBsZXQgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0gfCB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgYnVpbGRlciA9IHRoaXMuYnVpbGRlciA9IHRzLmNyZWF0ZUVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW0oXG4gICAgICAgIHR5cGVTY3JpcHRQcm9ncmFtLFxuICAgICAgICBob3N0LFxuICAgICAgICB0aGlzLmJ1aWxkZXIsXG4gICAgICApO1xuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW07XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIodHlwZVNjcmlwdFByb2dyYW0sIGhvc3QpO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzZW1hbnRpYyBkaWFnbm9zdGljcyBjYWNoZVxuICAgIGNvbnN0IGFmZmVjdGVkRmlsZXMgPSBuZXcgU2V0PHRzLlNvdXJjZUZpbGU+KCk7XG5cbiAgICAvLyBBbmFseXplIGFmZmVjdGVkIGZpbGVzIHdoZW4gaW4gd2F0Y2ggbW9kZSBmb3IgaW5jcmVtZW50YWwgdHlwZSBjaGVja2luZ1xuICAgIGlmICgnZ2V0U2VtYW50aWNEaWFnbm9zdGljc09mTmV4dEFmZmVjdGVkRmlsZScgaW4gYnVpbGRlcikge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnN0YW50LWNvbmRpdGlvblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzT2ZOZXh0QWZmZWN0ZWRGaWxlKHVuZGVmaW5lZCwgKHNvdXJjZUZpbGUpID0+IHtcbiAgICAgICAgICAvLyBJZiB0aGUgYWZmZWN0ZWQgZmlsZSBpcyBhIFRUQyBzaGltLCBhZGQgdGhlIHNoaW0ncyBvcmlnaW5hbCBzb3VyY2UgZmlsZS5cbiAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgdGhhdCBjaGFuZ2VzIHRoYXQgYWZmZWN0IFRUQyBhcmUgdHlwZWNoZWNrZWQgZXZlbiB3aGVuIHRoZSBjaGFuZ2VzXG4gICAgICAgICAgLy8gYXJlIG90aGVyd2lzZSB1bnJlbGF0ZWQgZnJvbSBhIFRTIHBlcnNwZWN0aXZlIGFuZCBkbyBub3QgcmVzdWx0IGluIEl2eSBjb2RlZ2VuIGNoYW5nZXMuXG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGNoYW5naW5nIEBJbnB1dCBwcm9wZXJ0eSB0eXBlcyBvZiBhIGRpcmVjdGl2ZSB1c2VkIGluIGFub3RoZXIgY29tcG9uZW50J3NcbiAgICAgICAgICAvLyB0ZW1wbGF0ZS5cbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgIHNvdXJjZUZpbGUuZmlsZU5hbWUuZW5kc1dpdGgoJy5uZ3R5cGVjaGVjay50cycpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGZpbGUgbmFtZSBjb252ZXJzaW9uIHJlbGllcyBvbiBpbnRlcm5hbCBjb21waWxlciBsb2dpYyBhbmQgc2hvdWxkIGJlIGNvbnZlcnRlZFxuICAgICAgICAgICAgLy8gdG8gYW4gb2ZmaWNpYWwgbWV0aG9kIHdoZW4gYXZhaWxhYmxlLiAxNSBpcyBsZW5ndGggb2YgYC5uZ3R5cGVjaGVjay50c2BcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZW5hbWUgPSBzb3VyY2VGaWxlLmZpbGVOYW1lLnNsaWNlKDAsIC0xNSkgKyAnLnRzJztcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsU291cmNlRmlsZSA9IGJ1aWxkZXIuZ2V0U291cmNlRmlsZShvcmlnaW5hbEZpbGVuYW1lKTtcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbFNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQob3JpZ2luYWxTb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQocmVzdWx0LmFmZmVjdGVkIGFzIHRzLlNvdXJjZUZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbGxlY3QgcHJvZ3JhbSBsZXZlbCBkaWFnbm9zdGljc1xuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYW5ndWxhckNvbXBpbGVyLmdldE9wdGlvbkRpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldE9wdGlvbnNEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRHbG9iYWxEaWFnbm9zdGljcygpLFxuICAgIF07XG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcihkaWFnbm9zdGljcyk7XG5cbiAgICAvLyBDb2xsZWN0IHNvdXJjZSBmaWxlIHNwZWNpZmljIGRpYWdub3N0aWNzXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgaWYgKCFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKHNvdXJjZUZpbGUpKTtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3Moc291cmNlRmlsZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUFvdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLnBsdWdpbk9wdGlvbnMpO1xuXG4gICAgY29uc3QgZ2V0RGVwZW5kZW5jaWVzID0gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCByZXNvdXJjZVBhdGggb2YgYW5ndWxhckNvbXBpbGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGRlcGVuZGVuY2llcy5wdXNoKFxuICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAvLyBSZXRyaWV2ZSBhbGwgZGVwZW5kZW5jaWVzIG9mIHRoZSByZXNvdXJjZSAoc3R5bGVzaGVldCBpbXBvcnRzLCBldGMuKVxuICAgICAgICAgIC4uLnJlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHJlc291cmNlUGF0aCksXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkZXBlbmRlbmNpZXM7XG4gICAgfTtcblxuICAgIC8vIFJlcXVpcmVkIHRvIHN1cHBvcnQgYXN5bmNocm9ub3VzIHJlc291cmNlIGxvYWRpbmdcbiAgICAvLyBNdXN0IGJlIGRvbmUgYmVmb3JlIGNyZWF0aW5nIHRyYW5zZm9ybWVycyBvciBnZXR0aW5nIHRlbXBsYXRlIGRpYWdub3N0aWNzXG4gICAgY29uc3QgcGVuZGluZ0FuYWx5c2lzID0gYW5ndWxhckNvbXBpbGVyXG4gICAgICAuYW5hbHl6ZUFzeW5jKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmNsZWFyKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgICAgIGlmIChzb3VyY2VGaWxlLmlzRGVjbGFyYXRpb25GaWxlKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBDb2xsZWN0IHNvdXJjZXMgdGhhdCBhcmUgcmVxdWlyZWQgdG8gYmUgZW1pdHRlZFxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICFpZ25vcmVGb3JFbWl0Lmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgIWFuZ3VsYXJDb21waWxlci5pbmNyZW1lbnRhbENvbXBpbGF0aW9uLnNhZmVUb1NraXBFbWl0KHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuYWRkKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuXG4gICAgICAgICAgICAvLyBJZiByZXF1aXJlZCB0byBlbWl0LCBkaWFnbm9zdGljcyBtYXkgaGF2ZSBhbHNvIGNoYW5nZWRcbiAgICAgICAgICAgIGlmICghaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZSAmJlxuICAgICAgICAgICAgIWFmZmVjdGVkRmlsZXMuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBVc2UgY2FjaGVkIEFuZ3VsYXIgZGlhZ25vc3RpY3MgZm9yIHVuY2hhbmdlZCBhbmQgdW5hZmZlY3RlZCBmaWxlc1xuICAgICAgICAgICAgY29uc3QgYW5ndWxhckRpYWdub3N0aWNzID0gdGhpcy5zb3VyY2VGaWxlQ2FjaGUuZ2V0QW5ndWxhckRpYWdub3N0aWNzKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgaWYgKGFuZ3VsYXJEaWFnbm9zdGljcykge1xuICAgICAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29sbGVjdCBuZXcgQW5ndWxhciBkaWFnbm9zdGljcyBmb3IgZmlsZXMgYWZmZWN0ZWQgYnkgY2hhbmdlc1xuICAgICAgICBjb25zdCBPcHRpbWl6ZUZvciA9IHRoaXMuY29tcGlsZXJDbGkuT3B0aW1pemVGb3I7XG4gICAgICAgIGNvbnN0IG9wdGltaXplRGlhZ25vc3RpY3NGb3IgPVxuICAgICAgICAgIGFmZmVjdGVkRmlsZXMuc2l6ZSA8PSBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTERcbiAgICAgICAgICAgID8gT3B0aW1pemVGb3IuU2luZ2xlRmlsZVxuICAgICAgICAgICAgOiBPcHRpbWl6ZUZvci5XaG9sZVByb2dyYW07XG4gICAgICAgIGZvciAoY29uc3QgYWZmZWN0ZWRGaWxlIG9mIGFmZmVjdGVkRmlsZXMpIHtcbiAgICAgICAgICBjb25zdCBhbmd1bGFyRGlhZ25vc3RpY3MgPSBhbmd1bGFyQ29tcGlsZXIuZ2V0RGlhZ25vc3RpY3NGb3JGaWxlKFxuICAgICAgICAgICAgYWZmZWN0ZWRGaWxlLFxuICAgICAgICAgICAgb3B0aW1pemVEaWFnbm9zdGljc0ZvcixcbiAgICAgICAgICApO1xuICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZT8udXBkYXRlQW5ndWxhckRpYWdub3N0aWNzKGFmZmVjdGVkRmlsZSwgYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZW1pdHRlcjogdGhpcy5jcmVhdGVGaWxlRW1pdHRlcihcbiAgICAgICAgICAgIGJ1aWxkZXIsXG4gICAgICAgICAgICBtZXJnZVRyYW5zZm9ybWVycyhhbmd1bGFyQ29tcGlsZXIucHJlcGFyZUVtaXQoKS50cmFuc2Zvcm1lcnMsIHRyYW5zZm9ybWVycyksXG4gICAgICAgICAgICBnZXREZXBlbmRlbmNpZXMsXG4gICAgICAgICAgICAoc291cmNlRmlsZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuZGVsZXRlKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuICAgICAgICAgICAgICBhbmd1bGFyQ29tcGlsZXIuaW5jcmVtZW50YWxDb21waWxhdGlvbi5yZWNvcmRTdWNjZXNzZnVsRW1pdChzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKSxcbiAgICAgICAgfTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGVycikgPT4gKHsgZXJyb3JNZXNzYWdlOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogYCR7ZXJyfWAgfSkpO1xuXG4gICAgY29uc3QgYW5hbHl6aW5nRmlsZUVtaXR0ZXI6IEZpbGVFbWl0dGVyID0gYXN5bmMgKGZpbGUpID0+IHtcbiAgICAgIGNvbnN0IGFuYWx5c2lzID0gYXdhaXQgcGVuZGluZ0FuYWx5c2lzO1xuXG4gICAgICBpZiAoJ2Vycm9yTWVzc2FnZScgaW4gYW5hbHlzaXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGFuYWx5c2lzLmVycm9yTWVzc2FnZSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhbmFseXNpcy5lbWl0dGVyKGZpbGUpO1xuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmlsZUVtaXR0ZXI6IGFuYWx5emluZ0ZpbGVFbWl0dGVyLFxuICAgICAgYnVpbGRlcixcbiAgICAgIGludGVybmFsRmlsZXM6IGlnbm9yZUZvckVtaXQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlSml0UHJvZ3JhbShcbiAgICBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgICByb290TmFtZXM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuICAgIGhvc3Q6IENvbXBpbGVySG9zdCxcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyOiBEaWFnbm9zdGljc1JlcG9ydGVyLFxuICApIHtcbiAgICBsZXQgYnVpbGRlcjtcbiAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIGJ1aWxkZXIgPSB0aGlzLmJ1aWxkZXIgPSB0cy5jcmVhdGVFbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtKFxuICAgICAgICByb290TmFtZXMsXG4gICAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdGhpcy5idWlsZGVyLFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2hlbiBub3QgaW4gd2F0Y2ggbW9kZSwgdGhlIHN0YXJ0dXAgY29zdCBvZiB0aGUgaW5jcmVtZW50YWwgYW5hbHlzaXMgY2FuIGJlIGF2b2lkZWQgYnlcbiAgICAgIC8vIHVzaW5nIGFuIGFic3RyYWN0IGJ1aWxkZXIgdGhhdCBvbmx5IHdyYXBzIGEgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgYnVpbGRlciA9IHRzLmNyZWF0ZUFic3RyYWN0QnVpbGRlcihyb290TmFtZXMsIGNvbXBpbGVyT3B0aW9ucywgaG9zdCk7XG4gICAgfVxuXG4gICAgY29uc3QgZGlhZ25vc3RpY3MgPSBbXG4gICAgICAuLi5idWlsZGVyLmdldE9wdGlvbnNEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRHbG9iYWxEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRTeW50YWN0aWNEaWFnbm9zdGljcygpLFxuICAgICAgLy8gR2F0aGVyIGluY3JlbWVudGFsIHNlbWFudGljIGRpYWdub3N0aWNzXG4gICAgICAuLi5idWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3MoKSxcbiAgICBdO1xuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZGlhZ25vc3RpY3MpO1xuXG4gICAgY29uc3QgdHJhbnNmb3JtZXJzID0gY3JlYXRlSml0VHJhbnNmb3JtZXJzKGJ1aWxkZXIsIHRoaXMuY29tcGlsZXJDbGksIHRoaXMucGx1Z2luT3B0aW9ucyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmlsZUVtaXR0ZXI6IHRoaXMuY3JlYXRlRmlsZUVtaXR0ZXIoYnVpbGRlciwgdHJhbnNmb3JtZXJzLCAoKSA9PiBbXSksXG4gICAgICBidWlsZGVyLFxuICAgICAgaW50ZXJuYWxGaWxlczogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUZpbGVFbWl0dGVyKFxuICAgIHByb2dyYW06IHRzLkJ1aWxkZXJQcm9ncmFtLFxuICAgIHRyYW5zZm9ybWVyczogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzID0ge30sXG4gICAgZ2V0RXh0cmFEZXBlbmRlbmNpZXM6IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiBJdGVyYWJsZTxzdHJpbmc+LFxuICAgIG9uQWZ0ZXJFbWl0PzogKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHZvaWQsXG4gICk6IEZpbGVFbWl0dGVyIHtcbiAgICByZXR1cm4gYXN5bmMgKGZpbGU6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgZmlsZVBhdGggPSBub3JtYWxpemVQYXRoKGZpbGUpO1xuICAgICAgaWYgKHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmhhcyhmaWxlUGF0aCkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmdldChmaWxlUGF0aCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZUZpbGUgPSBwcm9ncmFtLmdldFNvdXJjZUZpbGUoZmlsZVBhdGgpO1xuICAgICAgaWYgKCFzb3VyY2VGaWxlKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGxldCBjb250ZW50OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBsZXQgbWFwOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBwcm9ncmFtLmVtaXQoXG4gICAgICAgIHNvdXJjZUZpbGUsXG4gICAgICAgIChmaWxlbmFtZSwgZGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlbmFtZS5lbmRzV2l0aCgnLm1hcCcpKSB7XG4gICAgICAgICAgICBtYXAgPSBkYXRhO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoJy5qcycpKSB7XG4gICAgICAgICAgICBjb250ZW50ID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB0cmFuc2Zvcm1lcnMsXG4gICAgICApO1xuXG4gICAgICBvbkFmdGVyRW1pdD8uKHNvdXJjZUZpbGUpO1xuXG4gICAgICAvLyBDYXB0dXJlIGVtaXQgaGlzdG9yeSBpbmZvIGZvciBBbmd1bGFyIHJlYnVpbGQgYW5hbHlzaXNcbiAgICAgIGNvbnN0IGhhc2ggPSBjb250ZW50ID8gKGF3YWl0IHRoaXMuYWRkRmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoLCBjb250ZW50KSkuaGFzaCA6IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gW1xuICAgICAgICAuLi4odGhpcy5maWxlRGVwZW5kZW5jaWVzLmdldChmaWxlUGF0aCkgfHwgW10pLFxuICAgICAgICAuLi5nZXRFeHRyYURlcGVuZGVuY2llcyhzb3VyY2VGaWxlKSxcbiAgICAgIF0ubWFwKGV4dGVybmFsaXplUGF0aCk7XG5cbiAgICAgIHJldHVybiB7IGNvbnRlbnQsIG1hcCwgZGVwZW5kZW5jaWVzLCBoYXNoIH07XG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhpcyB1c2VzIGEgZHluYW1pYyBpbXBvcnQgdG8gbG9hZCBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYCB3aGljaCBtYXkgYmUgRVNNLlxuICAgIC8vIENvbW1vbkpTIGNvZGUgY2FuIGxvYWQgRVNNIGNvZGUgdmlhIGEgZHluYW1pYyBpbXBvcnQuIFVuZm9ydHVuYXRlbHksIFR5cGVTY3JpcHRcbiAgICAvLyB3aWxsIGN1cnJlbnRseSwgdW5jb25kaXRpb25hbGx5IGRvd25sZXZlbCBkeW5hbWljIGltcG9ydCBpbnRvIGEgcmVxdWlyZSBjYWxsLlxuICAgIC8vIHJlcXVpcmUgY2FsbHMgY2Fubm90IGxvYWQgRVNNIGNvZGUgYW5kIHdpbGwgcmVzdWx0IGluIGEgcnVudGltZSBlcnJvci4gVG8gd29ya2Fyb3VuZFxuICAgIC8vIHRoaXMsIGEgRnVuY3Rpb24gY29uc3RydWN0b3IgaXMgdXNlZCB0byBwcmV2ZW50IFR5cGVTY3JpcHQgZnJvbSBjaGFuZ2luZyB0aGUgZHluYW1pYyBpbXBvcnQuXG4gICAgLy8gT25jZSBUeXBlU2NyaXB0IHByb3ZpZGVzIHN1cHBvcnQgZm9yIGtlZXBpbmcgdGhlIGR5bmFtaWMgaW1wb3J0IHRoaXMgd29ya2Fyb3VuZCBjYW5cbiAgICAvLyBiZSBkcm9wcGVkLlxuICAgIHRoaXMuY29tcGlsZXJDbGlNb2R1bGUgPSBhd2FpdCBuZXcgRnVuY3Rpb24oYHJldHVybiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScpO2ApKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFkZEZpbGVFbWl0SGlzdG9yeShcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRlbnQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtPiB7XG4gICAgYXNzZXJ0Lm9rKHRoaXMud2VicGFja0NyZWF0ZUhhc2gsICdGaWxlIGVtaXR0ZXIgaXMgdXNlZCBwcmlvciB0byBXZWJwYWNrIGNvbXBpbGF0aW9uJyk7XG5cbiAgICBjb25zdCBoaXN0b3J5RGF0YTogRmlsZUVtaXRIaXN0b3J5SXRlbSA9IHtcbiAgICAgIGxlbmd0aDogY29udGVudC5sZW5ndGgsXG4gICAgICBoYXNoOiB0aGlzLndlYnBhY2tDcmVhdGVIYXNoKCd4eGhhc2g2NCcpLnVwZGF0ZShjb250ZW50KS5kaWdlc3QoKSBhcyBVaW50OEFycmF5LFxuICAgIH07XG5cbiAgICBpZiAodGhpcy53ZWJwYWNrQ2FjaGUpIHtcbiAgICAgIGNvbnN0IGhpc3RvcnkgPSBhd2FpdCB0aGlzLmdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCk7XG4gICAgICBpZiAoIWhpc3RvcnkgfHwgQnVmZmVyLmNvbXBhcmUoaGlzdG9yeS5oYXNoLCBoaXN0b3J5RGF0YS5oYXNoKSAhPT0gMCkge1xuICAgICAgICAvLyBIYXNoIGRvZXNuJ3QgbWF0Y2ggb3IgaXRlbSBkb2Vzbid0IGV4aXN0LlxuICAgICAgICBhd2FpdCB0aGlzLndlYnBhY2tDYWNoZS5zdG9yZVByb21pc2UoZmlsZVBhdGgsIG51bGwsIGhpc3RvcnlEYXRhKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICAvLyBUaGUgaW4gbWVtb3J5IGZpbGUgZW1pdCBoaXN0b3J5IGlzIG9ubHkgcmVxdWlyZWQgZHVyaW5nIHdhdGNoIG1vZGUuXG4gICAgICB0aGlzLmZpbGVFbWl0SGlzdG9yeS5zZXQoZmlsZVBhdGgsIGhpc3RvcnlEYXRhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGlzdG9yeURhdGE7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtIHwgdW5kZWZpbmVkPiB7XG4gICAgcmV0dXJuIHRoaXMud2VicGFja0NhY2hlXG4gICAgICA/IHRoaXMud2VicGFja0NhY2hlLmdldFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbSB8IHVuZGVmaW5lZD4oZmlsZVBhdGgsIG51bGwpXG4gICAgICA6IHRoaXMuZmlsZUVtaXRIaXN0b3J5LmdldChmaWxlUGF0aCk7XG4gIH1cbn1cbiJdfQ==