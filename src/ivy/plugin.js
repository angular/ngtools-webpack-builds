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
exports.AngularWebpackPlugin = exports.imageDomains = void 0;
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
exports.imageDomains = new Set();
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
        const transformers = (0, transformation_1.createAotTransformers)(builder, this.pluginOptions, exports.imageDomains);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLCtDQUFpQztBQUVqQyxrREFBd0Q7QUFDeEQsd0RBQTJEO0FBQzNELG1DQUEwQztBQUMxQywrQ0FLdUI7QUFDdkIsaUNBT2dCO0FBQ2hCLG1DQUF5RDtBQUN6RCxxQ0FBbUc7QUFDbkcscUNBQW9FO0FBQ3BFLHFEQUFtRztBQUVuRzs7OztHQUlHO0FBQ0gsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLENBQUM7QUFFNUIsUUFBQSxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztBQXVCOUMsTUFBTSxXQUFXLEdBQUcsa0JBQWtCLENBQUM7QUFDdkMsTUFBTSx1QkFBdUIsR0FBRyxJQUFJLE9BQU8sRUFBc0MsQ0FBQztBQU9sRixNQUFhLG9CQUFvQjtJQUNkLGFBQWEsQ0FBOEI7SUFDcEQsaUJBQWlCLENBQTBDO0lBQzNELFNBQVMsQ0FBVztJQUNwQixnQkFBZ0IsQ0FBZ0I7SUFDaEMsT0FBTyxDQUErQztJQUN0RCxlQUFlLENBQW1CO0lBQ2xDLFlBQVksQ0FBdUM7SUFDbkQsaUJBQWlCLENBQTZDO0lBQ3JELGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO0lBQ2xELG1CQUFtQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7SUFDeEMsd0JBQXdCLEdBQUcsSUFBSSxHQUFHLEVBQXNDLENBQUM7SUFDekUsZUFBZSxHQUFHLElBQUksR0FBRyxFQUErQixDQUFDO0lBRTFFLFlBQVksVUFBZ0QsRUFBRTtRQUM1RCxJQUFJLENBQUMsYUFBYSxHQUFHO1lBQ25CLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsaUJBQWlCLEVBQUUs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QyxDQUFDO1lBQ3hELElBQUksQ0FBQyxPQUFPLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7Z0JBQ3BFLDRDQUE0QztnQkFDNUMsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO2FBQ25FO1NBQ0Y7YUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDekIsc0VBQXNFO1lBQ3RFLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztTQUNqRDtRQUVELE9BQU8sV0FBVyxDQUFDO0lBQ3JCLENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsUUFBZ0I7UUFDL0MsT0FBTyxJQUFJLENBQUMsWUFBWTtZQUN0QixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQWtDLFFBQVEsRUFBRSxJQUFJLENBQUM7WUFDL0UsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7Q0FDRjtBQXJwQkQsb0RBcXBCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IENvbXBpbGVySG9zdCwgQ29tcGlsZXJPcHRpb25zLCBOZ3RzY1Byb2dyYW0gfSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgc3RyaWN0IGFzIGFzc2VydCB9IGZyb20gJ2Fzc2VydCc7XG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB0eXBlIHsgQ29tcGlsYXRpb24sIENvbXBpbGVyLCBNb2R1bGUsIE5vcm1hbE1vZHVsZSB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgVHlwZVNjcmlwdFBhdGhzUGx1Z2luIH0gZnJvbSAnLi4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4uL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQgeyBTb3VyY2VGaWxlQ2FjaGUgfSBmcm9tICcuL2NhY2hlJztcbmltcG9ydCB7XG4gIERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gIGFkZEVycm9yLFxuICBhZGRXYXJuaW5nLFxuICBjcmVhdGVEaWFnbm9zdGljc1JlcG9ydGVyLFxufSBmcm9tICcuL2RpYWdub3N0aWNzJztcbmltcG9ydCB7XG4gIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcsXG4gIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uLFxuICBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMsXG4gIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyxcbiAgYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyxcbiAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyxcbn0gZnJvbSAnLi9ob3N0JztcbmltcG9ydCB7IGV4dGVybmFsaXplUGF0aCwgbm9ybWFsaXplUGF0aCB9IGZyb20gJy4vcGF0aHMnO1xuaW1wb3J0IHsgQW5ndWxhclBsdWdpblN5bWJvbCwgRW1pdEZpbGVSZXN1bHQsIEZpbGVFbWl0dGVyLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSBmcm9tICcuL3N5bWJvbCc7XG5pbXBvcnQgeyBJbnB1dEZpbGVTeXN0ZW1TeW5jLCBjcmVhdGVXZWJwYWNrU3lzdGVtIH0gZnJvbSAnLi9zeXN0ZW0nO1xuaW1wb3J0IHsgY3JlYXRlQW90VHJhbnNmb3JtZXJzLCBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMsIG1lcmdlVHJhbnNmb3JtZXJzIH0gZnJvbSAnLi90cmFuc2Zvcm1hdGlvbic7XG5cbi8qKlxuICogVGhlIHRocmVzaG9sZCB1c2VkIHRvIGRldGVybWluZSB3aGV0aGVyIEFuZ3VsYXIgZmlsZSBkaWFnbm9zdGljcyBzaG91bGQgb3B0aW1pemUgZm9yIGZ1bGwgcHJvZ3JhbXNcbiAqIG9yIHNpbmdsZSBmaWxlcy4gSWYgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBmaWxlcyBmb3IgYSBidWlsZCBpcyBtb3JlIHRoYW4gdGhlIHRocmVzaG9sZCwgZnVsbFxuICogcHJvZ3JhbSBvcHRpbWl6YXRpb24gd2lsbCBiZSB1c2VkLlxuICovXG5jb25zdCBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTEQgPSAxO1xuXG5leHBvcnQgY29uc3QgaW1hZ2VEb21haW5zID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zIHtcbiAgdHNjb25maWc6IHN0cmluZztcbiAgY29tcGlsZXJPcHRpb25zPzogQ29tcGlsZXJPcHRpb25zO1xuICBmaWxlUmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IGJvb2xlYW47XG4gIGVtaXRDbGFzc01ldGFkYXRhOiBib29sZWFuO1xuICBlbWl0TmdNb2R1bGVTY29wZTogYm9vbGVhbjtcbiAgaml0TW9kZTogYm9vbGVhbjtcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFRoZSBBbmd1bGFyIGNvbXBpbGF0aW9uIHN0YXRlIHRoYXQgaXMgbWFpbnRhaW5lZCBhY3Jvc3MgZWFjaCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICovXG5pbnRlcmZhY2UgQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUge1xuICByZXNvdXJjZUxvYWRlcj86IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgcHJldmlvdXNVbnVzZWQ/OiBTZXQ8c3RyaW5nPjtcbiAgcGF0aHNQbHVnaW46IFR5cGVTY3JpcHRQYXRoc1BsdWdpbjtcbn1cblxuY29uc3QgUExVR0lOX05BTUUgPSAnYW5ndWxhci1jb21waWxlcic7XG5jb25zdCBjb21waWxhdGlvbkZpbGVFbWl0dGVycyA9IG5ldyBXZWFrTWFwPENvbXBpbGF0aW9uLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24+KCk7XG5cbmludGVyZmFjZSBGaWxlRW1pdEhpc3RvcnlJdGVtIHtcbiAgbGVuZ3RoOiBudW1iZXI7XG4gIGhhc2g6IFVpbnQ4QXJyYXk7XG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyV2VicGFja1BsdWdpbiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luT3B0aW9uczogQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zO1xuICBwcml2YXRlIGNvbXBpbGVyQ2xpTW9kdWxlPzogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyk7XG4gIHByaXZhdGUgd2F0Y2hNb2RlPzogYm9vbGVhbjtcbiAgcHJpdmF0ZSBuZ3RzY05leHRQcm9ncmFtPzogTmd0c2NQcm9ncmFtO1xuICBwcml2YXRlIGJ1aWxkZXI/OiB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICBwcml2YXRlIHNvdXJjZUZpbGVDYWNoZT86IFNvdXJjZUZpbGVDYWNoZTtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ2FjaGU/OiBSZXR1cm5UeXBlPENvbXBpbGF0aW9uWydnZXRDYWNoZSddPjtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ3JlYXRlSGFzaD86IENvbXBpbGVyWyd3ZWJwYWNrJ11bJ3V0aWwnXVsnY3JlYXRlSGFzaCddO1xuICBwcml2YXRlIHJlYWRvbmx5IGZpbGVEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVxdWlyZWRGaWxlc1RvRW1pdCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBFbWl0RmlsZVJlc3VsdCB8IHVuZGVmaW5lZD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRW1pdEhpc3RvcnkgPSBuZXcgTWFwPHN0cmluZywgRmlsZUVtaXRIaXN0b3J5SXRlbT4oKTtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBQYXJ0aWFsPEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucz4gPSB7fSkge1xuICAgIHRoaXMucGx1Z2luT3B0aW9ucyA9IHtcbiAgICAgIGVtaXRDbGFzc01ldGFkYXRhOiBmYWxzZSxcbiAgICAgIGVtaXROZ01vZHVsZVNjb3BlOiBmYWxzZSxcbiAgICAgIGppdE1vZGU6IGZhbHNlLFxuICAgICAgZmlsZVJlcGxhY2VtZW50czoge30sXG4gICAgICBzdWJzdGl0dXRpb25zOiB7fSxcbiAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdHJ1ZSxcbiAgICAgIHRzY29uZmlnOiAndHNjb25maWcuanNvbicsXG4gICAgICAuLi5vcHRpb25zLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldCBjb21waWxlckNsaSgpOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKSB7XG4gICAgLy8gVGhlIGNvbXBpbGVyQ2xpTW9kdWxlIGZpZWxkIGlzIGd1YXJhbnRlZWQgdG8gYmUgZGVmaW5lZCBkdXJpbmcgYSBjb21waWxhdGlvblxuICAgIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gICAgLy8gaG9vayBleGVjdXRpb24gaXMgYW4gaW1wbGVtZW50YXRpb24gZXJyb3IuXG4gICAgYXNzZXJ0Lm9rKHRoaXMuY29tcGlsZXJDbGlNb2R1bGUsIGAnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgICByZXR1cm4gdGhpcy5jb21waWxlckNsaU1vZHVsZTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCk6IEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucyB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luT3B0aW9ucztcbiAgfVxuXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlcik6IHZvaWQge1xuICAgIGNvbnN0IHsgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4sIFdlYnBhY2tFcnJvciwgdXRpbCB9ID0gY29tcGlsZXIud2VicGFjaztcbiAgICB0aGlzLndlYnBhY2tDcmVhdGVIYXNoID0gdXRpbC5jcmVhdGVIYXNoO1xuXG4gICAgLy8gU2V0dXAgZmlsZSByZXBsYWNlbWVudHMgd2l0aCB3ZWJwYWNrXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMpKSB7XG4gICAgICBuZXcgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4oXG4gICAgICAgIG5ldyBSZWdFeHAoJ14nICsga2V5LnJlcGxhY2UoL1suKitcXC0/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJykgKyAnJCcpLFxuICAgICAgICB2YWx1ZSxcbiAgICAgICkuYXBwbHkoY29tcGlsZXIpO1xuICAgIH1cblxuICAgIC8vIFNldCByZXNvbHZlciBvcHRpb25zXG4gICAgY29uc3QgcGF0aHNQbHVnaW4gPSBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKCk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKFBMVUdJTl9OQU1FLCAoY29tcGlsZXIpID0+IHtcbiAgICAgIGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlT3B0aW9uc1xuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAudGFwKFBMVUdJTl9OQU1FLCAocmVzb2x2ZU9wdGlvbnMpID0+IHtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zID8/PSBbXTtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zLnB1c2gocGF0aHNQbHVnaW4pO1xuXG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVPcHRpb25zO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIExvYWQgdGhlIGNvbXBpbGVyLWNsaSBpZiBub3QgYWxyZWFkeSBhdmFpbGFibGVcbiAgICBjb21waWxlci5ob29rcy5iZWZvcmVDb21waWxlLnRhcFByb21pc2UoUExVR0lOX05BTUUsICgpID0+IHRoaXMuaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCkpO1xuXG4gICAgY29uc3QgY29tcGlsYXRpb25TdGF0ZTogQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUgPSB7IHBhdGhzUGx1Z2luIH07XG4gICAgY29tcGlsZXIuaG9va3MudGhpc0NvbXBpbGF0aW9uLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGF0aW9uKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLnNldHVwQ29tcGlsYXRpb24oY29tcGlsYXRpb24sIGNvbXBpbGF0aW9uU3RhdGUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWRkRXJyb3IoXG4gICAgICAgICAgY29tcGlsYXRpb24sXG4gICAgICAgICAgYEZhaWxlZCB0byBpbml0aWFsaXplIEFuZ3VsYXIgY29tcGlsYXRpb24gLSAke1xuICAgICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvclxuICAgICAgICAgIH1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbiwgc3RhdGU6IEFuZ3VsYXJDb21waWxhdGlvblN0YXRlKTogdm9pZCB7XG4gICAgY29uc3QgY29tcGlsZXIgPSBjb21waWxhdGlvbi5jb21waWxlcjtcblxuICAgIC8vIFJlZ2lzdGVyIHBsdWdpbiB0byBlbnN1cmUgZGV0ZXJtaW5pc3RpYyBlbWl0IG9yZGVyIGluIG11bHRpLXBsdWdpbiB1c2FnZVxuICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSB0aGlzLnJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uKTtcbiAgICB0aGlzLndhdGNoTW9kZSA9IGNvbXBpbGVyLndhdGNoTW9kZTtcblxuICAgIC8vIEluaXRpYWxpemUgd2VicGFjayBjYWNoZVxuICAgIGlmICghdGhpcy53ZWJwYWNrQ2FjaGUgJiYgY29tcGlsYXRpb24ub3B0aW9ucy5jYWNoZSkge1xuICAgICAgdGhpcy53ZWJwYWNrQ2FjaGUgPSBjb21waWxhdGlvbi5nZXRDYWNoZShQTFVHSU5fTkFNRSk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIGlmIG5vdCBhbHJlYWR5IHNldHVwXG4gICAgaWYgKCFzdGF0ZS5yZXNvdXJjZUxvYWRlcikge1xuICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKHRoaXMud2F0Y2hNb2RlKTtcbiAgICB9XG5cbiAgICAvLyBTZXR1cCBhbmQgcmVhZCBUeXBlU2NyaXB0IGFuZCBBbmd1bGFyIGNvbXBpbGVyIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfSA9IHRoaXMubG9hZENvbmZpZ3VyYXRpb24oKTtcblxuICAgIC8vIENyZWF0ZSBkaWFnbm9zdGljcyByZXBvcnRlciBhbmQgcmVwb3J0IGNvbmZpZ3VyYXRpb24gZmlsZSBlcnJvcnNcbiAgICBjb25zdCBkaWFnbm9zdGljc1JlcG9ydGVyID0gY3JlYXRlRGlhZ25vc3RpY3NSZXBvcnRlcihjb21waWxhdGlvbiwgKGRpYWdub3N0aWMpID0+XG4gICAgICB0aGlzLmNvbXBpbGVyQ2xpLmZvcm1hdERpYWdub3N0aWNzKFtkaWFnbm9zdGljXSksXG4gICAgKTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGVycm9ycyk7XG5cbiAgICAvLyBVcGRhdGUgVHlwZVNjcmlwdCBwYXRoIG1hcHBpbmcgcGx1Z2luIHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICBzdGF0ZS5wYXRoc1BsdWdpbi51cGRhdGUoY29tcGlsZXJPcHRpb25zKTtcblxuICAgIC8vIENyZWF0ZSBhIFdlYnBhY2stYmFzZWQgVHlwZVNjcmlwdCBjb21waWxlciBob3N0XG4gICAgY29uc3Qgc3lzdGVtID0gY3JlYXRlV2VicGFja1N5c3RlbShcbiAgICAgIC8vIFdlYnBhY2sgbGFja3MgYW4gSW5wdXRGaWxlU3l0ZW0gdHlwZSBkZWZpbml0aW9uIHdpdGggc3luYyBmdW5jdGlvbnNcbiAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSBhcyBJbnB1dEZpbGVTeXN0ZW1TeW5jLFxuICAgICAgbm9ybWFsaXplUGF0aChjb21waWxlci5jb250ZXh0KSxcbiAgICApO1xuICAgIGNvbnN0IGhvc3QgPSB0cy5jcmVhdGVJbmNyZW1lbnRhbENvbXBpbGVySG9zdChjb21waWxlck9wdGlvbnMsIHN5c3RlbSk7XG5cbiAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBjYWNoaW5nIGFuZCByZXVzZSBjYWNoZSBmcm9tIHByZXZpb3VzIGNvbXBpbGF0aW9uIGlmIHByZXNlbnRcbiAgICBsZXQgY2FjaGUgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZTtcbiAgICBsZXQgY2hhbmdlZEZpbGVzO1xuICAgIGlmIChjYWNoZSkge1xuICAgICAgY2hhbmdlZEZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIFtcbiAgICAgICAgLi4uKGNvbXBpbGVyLm1vZGlmaWVkRmlsZXMgPz8gW10pLFxuICAgICAgICAuLi4oY29tcGlsZXIucmVtb3ZlZEZpbGVzID8/IFtdKSxcbiAgICAgIF0pIHtcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZENoYW5nZWRGaWxlID0gbm9ybWFsaXplUGF0aChjaGFuZ2VkRmlsZSk7XG4gICAgICAgIC8vIEludmFsaWRhdGUgZmlsZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgdGhpcy5maWxlRGVwZW5kZW5jaWVzLmRlbGV0ZShub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgICAvLyBJbnZhbGlkYXRlIGV4aXN0aW5nIGNhY2hlXG4gICAgICAgIGNhY2hlLmludmFsaWRhdGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcblxuICAgICAgICBjaGFuZ2VkRmlsZXMuYWRkKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIEluaXRpYWxpemUgYSBuZXcgY2FjaGVcbiAgICAgIGNhY2hlID0gbmV3IFNvdXJjZUZpbGVDYWNoZSgpO1xuICAgICAgLy8gT25seSBzdG9yZSBjYWNoZSBpZiBpbiB3YXRjaCBtb2RlXG4gICAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgPSBjYWNoZTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyhob3N0LCBjYWNoZSk7XG5cbiAgICBjb25zdCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUoXG4gICAgICBob3N0LmdldEN1cnJlbnREaXJlY3RvcnkoKSxcbiAgICAgIGhvc3QuZ2V0Q2Fub25pY2FsRmlsZU5hbWUuYmluZChob3N0KSxcbiAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICApO1xuXG4gICAgLy8gU2V0dXAgc291cmNlIGZpbGUgZGVwZW5kZW5jeSBjb2xsZWN0aW9uXG4gICAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24oaG9zdCwgdGhpcy5maWxlRGVwZW5kZW5jaWVzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuXG4gICAgLy8gU2V0dXAgcmVzb3VyY2UgbG9hZGluZ1xuICAgIHN0YXRlLnJlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbiwgY2hhbmdlZEZpbGVzKTtcbiAgICBhdWdtZW50SG9zdFdpdGhSZXNvdXJjZXMoaG9zdCwgc3RhdGUucmVzb3VyY2VMb2FkZXIsIHtcbiAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdGhpcy5wbHVnaW5PcHRpb25zLmRpcmVjdFRlbXBsYXRlTG9hZGluZyxcbiAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbjogdGhpcy5wbHVnaW5PcHRpb25zLmlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICB9KTtcblxuICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGFkanVzdG1lbnQgb3B0aW9uc1xuICAgIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyhob3N0LCB0aGlzLnBsdWdpbk9wdGlvbnMuZmlsZVJlcGxhY2VtZW50cywgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcbiAgICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zKGhvc3QsIHRoaXMucGx1Z2luT3B0aW9ucy5zdWJzdGl0dXRpb25zKTtcblxuICAgIC8vIENyZWF0ZSB0aGUgZmlsZSBlbWl0dGVyIHVzZWQgYnkgdGhlIHdlYnBhY2sgbG9hZGVyXG4gICAgY29uc3QgeyBmaWxlRW1pdHRlciwgYnVpbGRlciwgaW50ZXJuYWxGaWxlcyB9ID0gdGhpcy5wbHVnaW5PcHRpb25zLmppdE1vZGVcbiAgICAgID8gdGhpcy51cGRhdGVKaXRQcm9ncmFtKGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBob3N0LCBkaWFnbm9zdGljc1JlcG9ydGVyKVxuICAgICAgOiB0aGlzLnVwZGF0ZUFvdFByb2dyYW0oXG4gICAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgIHJvb3ROYW1lcyxcbiAgICAgICAgICBob3N0LFxuICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICAgICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXIsXG4gICAgICAgICk7XG5cbiAgICAvLyBTZXQgb2YgZmlsZXMgdXNlZCBkdXJpbmcgdGhlIHVudXNlZCBUeXBlU2NyaXB0IGZpbGUgYW5hbHlzaXNcbiAgICBjb25zdCBjdXJyZW50VW51c2VkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICBpZiAoaW50ZXJuYWxGaWxlcz8uaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgYWxsIHByb2dyYW0gZmlsZXMgYXJlIGNvbnNpZGVyZWQgcGFydCBvZiB0aGUgY29tcGlsYXRpb24gYW5kIHdpbGwgYmUgd2F0Y2hlZC5cbiAgICAgIC8vIFdlYnBhY2sgZG9lcyBub3Qgbm9ybWFsaXplIHBhdGhzLiBUaGVyZWZvcmUsIHdlIG5lZWQgdG8gbm9ybWFsaXplIHRoZSBwYXRoIHdpdGggRlMgc2VwZXJhdG9ycy5cbiAgICAgIGNvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMuYWRkKGV4dGVybmFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG5cbiAgICAgIC8vIEFkZCBhbGwgbm9uLWRlY2xhcmF0aW9uIGZpbGVzIHRvIHRoZSBpbml0aWFsIHNldCBvZiB1bnVzZWQgZmlsZXMuIFRoZSBzZXQgd2lsbCBiZVxuICAgICAgLy8gYW5hbHl6ZWQgYW5kIHBydW5lZCBhZnRlciBhbGwgV2VicGFjayBtb2R1bGVzIGFyZSBmaW5pc2hlZCBidWlsZGluZy5cbiAgICAgIGlmICghc291cmNlRmlsZS5pc0RlY2xhcmF0aW9uRmlsZSkge1xuICAgICAgICBjdXJyZW50VW51c2VkLmFkZChub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb21waWxhdGlvbi5ob29rcy5maW5pc2hNb2R1bGVzLnRhcFByb21pc2UoUExVR0lOX05BTUUsIGFzeW5jIChtb2R1bGVzKSA9PiB7XG4gICAgICAvLyBSZWJ1aWxkIGFueSByZW1haW5pbmcgQU9UIHJlcXVpcmVkIG1vZHVsZXNcbiAgICAgIGF3YWl0IHRoaXMucmVidWlsZFJlcXVpcmVkRmlsZXMobW9kdWxlcywgY29tcGlsYXRpb24sIGZpbGVFbWl0dGVyKTtcblxuICAgICAgLy8gQ2xlYXIgb3V0IHRoZSBXZWJwYWNrIGNvbXBpbGF0aW9uIHRvIGF2b2lkIGFuIGV4dHJhIHJldGFpbmluZyByZWZlcmVuY2VcbiAgICAgIHN0YXRlLnJlc291cmNlTG9hZGVyPy5jbGVhclBhcmVudENvbXBpbGF0aW9uKCk7XG5cbiAgICAgIC8vIEFuYWx5emUgcHJvZ3JhbSBmb3IgdW51c2VkIGZpbGVzXG4gICAgICBpZiAoY29tcGlsYXRpb24uZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHdlYnBhY2tNb2R1bGUgb2YgbW9kdWxlcykge1xuICAgICAgICBjb25zdCByZXNvdXJjZSA9ICh3ZWJwYWNrTW9kdWxlIGFzIE5vcm1hbE1vZHVsZSkucmVzb3VyY2U7XG4gICAgICAgIGlmIChyZXNvdXJjZSkge1xuICAgICAgICAgIHRoaXMubWFya1Jlc291cmNlVXNlZChub3JtYWxpemVQYXRoKHJlc291cmNlKSwgY3VycmVudFVudXNlZCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB1bnVzZWQgb2YgY3VycmVudFVudXNlZCkge1xuICAgICAgICBpZiAoc3RhdGUucHJldmlvdXNVbnVzZWQ/Lmhhcyh1bnVzZWQpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYWRkV2FybmluZyhcbiAgICAgICAgICBjb21waWxhdGlvbixcbiAgICAgICAgICBgJHt1bnVzZWR9IGlzIHBhcnQgb2YgdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24gYnV0IGl0J3MgdW51c2VkLlxcbmAgK1xuICAgICAgICAgICAgYEFkZCBvbmx5IGVudHJ5IHBvaW50cyB0byB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydGllcyBpbiB5b3VyIHRzY29uZmlnLmAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzdGF0ZS5wcmV2aW91c1VudXNlZCA9IGN1cnJlbnRVbnVzZWQ7XG4gICAgfSk7XG5cbiAgICAvLyBTdG9yZSBmaWxlIGVtaXR0ZXIgZm9yIGxvYWRlciB1c2FnZVxuICAgIGVtaXRSZWdpc3RyYXRpb24udXBkYXRlKGZpbGVFbWl0dGVyKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVnaXN0ZXJXaXRoQ29tcGlsYXRpb24oY29tcGlsYXRpb246IENvbXBpbGF0aW9uKSB7XG4gICAgbGV0IGZpbGVFbWl0dGVycyA9IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLmdldChjb21waWxhdGlvbik7XG4gICAgaWYgKCFmaWxlRW1pdHRlcnMpIHtcbiAgICAgIGZpbGVFbWl0dGVycyA9IG5ldyBGaWxlRW1pdHRlckNvbGxlY3Rpb24oKTtcbiAgICAgIGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLnNldChjb21waWxhdGlvbiwgZmlsZUVtaXR0ZXJzKTtcbiAgICAgIGNvbXBpbGF0aW9uLmNvbXBpbGVyLndlYnBhY2suTm9ybWFsTW9kdWxlLmdldENvbXBpbGF0aW9uSG9va3MoY29tcGlsYXRpb24pLmxvYWRlci50YXAoXG4gICAgICAgIFBMVUdJTl9OQU1FLFxuICAgICAgICAobG9hZGVyQ29udGV4dDogeyBbQW5ndWxhclBsdWdpblN5bWJvbF0/OiBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSkgPT4ge1xuICAgICAgICAgIGxvYWRlckNvbnRleHRbQW5ndWxhclBsdWdpblN5bWJvbF0gPSBmaWxlRW1pdHRlcnM7XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBlbWl0UmVnaXN0cmF0aW9uID0gZmlsZUVtaXR0ZXJzLnJlZ2lzdGVyKCk7XG5cbiAgICByZXR1cm4gZW1pdFJlZ2lzdHJhdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgbWFya1Jlc291cmNlVXNlZChub3JtYWxpemVkUmVzb3VyY2VQYXRoOiBzdHJpbmcsIGN1cnJlbnRVbnVzZWQ6IFNldDxzdHJpbmc+KTogdm9pZCB7XG4gICAgaWYgKCFjdXJyZW50VW51c2VkLmhhcyhub3JtYWxpemVkUmVzb3VyY2VQYXRoKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGN1cnJlbnRVbnVzZWQuZGVsZXRlKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpO1xuICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQobm9ybWFsaXplZFJlc291cmNlUGF0aCk7XG4gICAgaWYgKCFkZXBlbmRlbmNpZXMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBkZXBlbmRlbmN5IG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgdGhpcy5tYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZVBhdGgoZGVwZW5kZW5jeSksIGN1cnJlbnRVbnVzZWQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVidWlsZFJlcXVpcmVkRmlsZXMoXG4gICAgbW9kdWxlczogSXRlcmFibGU8TW9kdWxlPixcbiAgICBjb21waWxhdGlvbjogQ29tcGlsYXRpb24sXG4gICAgZmlsZUVtaXR0ZXI6IEZpbGVFbWl0dGVyLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LnNpemUgPT09IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlc1RvUmVidWlsZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgcmVxdWlyZWRGaWxlIG9mIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdCkge1xuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0RmlsZUVtaXRIaXN0b3J5KHJlcXVpcmVkRmlsZSk7XG4gICAgICBpZiAoaGlzdG9yeSkge1xuICAgICAgICBjb25zdCBlbWl0UmVzdWx0ID0gYXdhaXQgZmlsZUVtaXR0ZXIocmVxdWlyZWRGaWxlKTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVtaXRSZXN1bHQ/LmNvbnRlbnQgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIGhpc3RvcnkubGVuZ3RoICE9PSBlbWl0UmVzdWx0LmNvbnRlbnQubGVuZ3RoIHx8XG4gICAgICAgICAgZW1pdFJlc3VsdC5oYXNoID09PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICBCdWZmZXIuY29tcGFyZShoaXN0b3J5Lmhhc2gsIGVtaXRSZXN1bHQuaGFzaCkgIT09IDBcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gTmV3IGVtaXQgcmVzdWx0IGlzIGRpZmZlcmVudCBzbyByZWJ1aWxkIHVzaW5nIG5ldyBlbWl0IHJlc3VsdFxuICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLnNldChyZXF1aXJlZEZpbGUsIGVtaXRSZXN1bHQpO1xuICAgICAgICAgIGZpbGVzVG9SZWJ1aWxkLmFkZChyZXF1aXJlZEZpbGUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBlbWl0IGhpc3Rvcnkgc28gcmVidWlsZFxuICAgICAgICBmaWxlc1RvUmVidWlsZC5hZGQocmVxdWlyZWRGaWxlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmlsZXNUb1JlYnVpbGQuc2l6ZSA+IDApIHtcbiAgICAgIGNvbnN0IHJlYnVpbGQgPSAod2VicGFja01vZHVsZTogTW9kdWxlKSA9PlxuICAgICAgICBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4gY29tcGlsYXRpb24ucmVidWlsZE1vZHVsZSh3ZWJwYWNrTW9kdWxlLCAoKSA9PiByZXNvbHZlKCkpKTtcblxuICAgICAgY29uc3QgbW9kdWxlc1RvUmVidWlsZCA9IFtdO1xuICAgICAgZm9yIChjb25zdCB3ZWJwYWNrTW9kdWxlIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2UgPSAod2VicGFja01vZHVsZSBhcyBOb3JtYWxNb2R1bGUpLnJlc291cmNlO1xuICAgICAgICBpZiAocmVzb3VyY2UgJiYgZmlsZXNUb1JlYnVpbGQuaGFzKG5vcm1hbGl6ZVBhdGgocmVzb3VyY2UpKSkge1xuICAgICAgICAgIG1vZHVsZXNUb1JlYnVpbGQucHVzaCh3ZWJwYWNrTW9kdWxlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwobW9kdWxlc1RvUmVidWlsZC5tYXAoKHdlYnBhY2tNb2R1bGUpID0+IHJlYnVpbGQod2VicGFja01vZHVsZSkpKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5jbGVhcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBsb2FkQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCB7XG4gICAgICBvcHRpb25zOiBjb21waWxlck9wdGlvbnMsXG4gICAgICByb290TmFtZXMsXG4gICAgICBlcnJvcnMsXG4gICAgfSA9IHRoaXMuY29tcGlsZXJDbGkucmVhZENvbmZpZ3VyYXRpb24oXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMudHNjb25maWcsXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMuY29tcGlsZXJPcHRpb25zLFxuICAgICk7XG4gICAgY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSBjb21waWxlck9wdGlvbnMuc291cmNlTWFwO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuYWxsb3dFbXB0eUNvZGVnZW5GaWxlcyA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5hbm5vdGF0aW9uc0FzID0gJ2RlY29yYXRvcnMnO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5lbmFibGVSZXNvdXJjZUlubGluaW5nID0gZmFsc2U7XG5cbiAgICByZXR1cm4geyBjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgZXJyb3JzIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUFvdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgICByZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyLFxuICApIHtcbiAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgc3BlY2lmaWMgcHJvZ3JhbSB0aGF0IGNvbnRhaW5zIHRoZSBBbmd1bGFyIGNvbXBpbGVyXG4gICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBuZXcgdGhpcy5jb21waWxlckNsaS5OZ3RzY1Byb2dyYW0oXG4gICAgICByb290TmFtZXMsXG4gICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICBob3N0LFxuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtLFxuICAgICk7XG4gICAgY29uc3QgYW5ndWxhckNvbXBpbGVyID0gYW5ndWxhclByb2dyYW0uY29tcGlsZXI7XG5cbiAgICAvLyBUaGUgYGlnbm9yZUZvckVtaXRgIHJldHVybiB2YWx1ZSBjYW4gYmUgc2FmZWx5IGlnbm9yZWQgd2hlbiBlbWl0dGluZy4gT25seSBmaWxlc1xuICAgIC8vIHRoYXQgd2lsbCBiZSBidW5kbGVkIChyZXF1ZXN0ZWQgYnkgV2VicGFjaykgd2lsbCBiZSBlbWl0dGVkLiBDb21iaW5lZCB3aXRoIFR5cGVTY3JpcHQnc1xuICAgIC8vIGVsaWRpbmcgb2YgdHlwZSBvbmx5IGltcG9ydHMsIHRoaXMgd2lsbCBjYXVzZSB0eXBlIG9ubHkgZmlsZXMgdG8gYmUgYXV0b21hdGljYWxseSBpZ25vcmVkLlxuICAgIC8vIEludGVybmFsIEFuZ3VsYXIgdHlwZSBjaGVjayBmaWxlcyBhcmUgYWxzbyBub3QgcmVzb2x2YWJsZSBieSB0aGUgYnVuZGxlci4gRXZlbiBpZiB0aGV5XG4gICAgLy8gd2VyZSBzb21laG93IGVycmFudGx5IGltcG9ydGVkLCB0aGUgYnVuZGxlciB3b3VsZCBlcnJvciBiZWZvcmUgYW4gZW1pdCB3YXMgYXR0ZW1wdGVkLlxuICAgIC8vIERpYWdub3N0aWNzIGFyZSBzdGlsbCBjb2xsZWN0ZWQgZm9yIGFsbCBmaWxlcyB3aGljaCByZXF1aXJlcyB1c2luZyBgaWdub3JlRm9yRGlhZ25vc3RpY3NgLlxuICAgIGNvbnN0IHsgaWdub3JlRm9yRGlhZ25vc3RpY3MsIGlnbm9yZUZvckVtaXQgfSA9IGFuZ3VsYXJDb21waWxlcjtcblxuICAgIC8vIFNvdXJjZUZpbGUgdmVyc2lvbnMgYXJlIHJlcXVpcmVkIGZvciBidWlsZGVyIHByb2dyYW1zLlxuICAgIC8vIFRoZSB3cmFwcGVkIGhvc3QgaW5zaWRlIE5ndHNjUHJvZ3JhbSBhZGRzIGFkZGl0aW9uYWwgZmlsZXMgdGhhdCB3aWxsIG5vdCBoYXZlIHZlcnNpb25zLlxuICAgIGNvbnN0IHR5cGVTY3JpcHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW0uZ2V0VHNQcm9ncmFtKCk7XG4gICAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyh0eXBlU2NyaXB0UHJvZ3JhbSk7XG5cbiAgICBsZXQgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0gfCB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgYnVpbGRlciA9IHRoaXMuYnVpbGRlciA9IHRzLmNyZWF0ZUVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW0oXG4gICAgICAgIHR5cGVTY3JpcHRQcm9ncmFtLFxuICAgICAgICBob3N0LFxuICAgICAgICB0aGlzLmJ1aWxkZXIsXG4gICAgICApO1xuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW07XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIodHlwZVNjcmlwdFByb2dyYW0sIGhvc3QpO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzZW1hbnRpYyBkaWFnbm9zdGljcyBjYWNoZVxuICAgIGNvbnN0IGFmZmVjdGVkRmlsZXMgPSBuZXcgU2V0PHRzLlNvdXJjZUZpbGU+KCk7XG5cbiAgICAvLyBBbmFseXplIGFmZmVjdGVkIGZpbGVzIHdoZW4gaW4gd2F0Y2ggbW9kZSBmb3IgaW5jcmVtZW50YWwgdHlwZSBjaGVja2luZ1xuICAgIGlmICgnZ2V0U2VtYW50aWNEaWFnbm9zdGljc09mTmV4dEFmZmVjdGVkRmlsZScgaW4gYnVpbGRlcikge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnN0YW50LWNvbmRpdGlvblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzT2ZOZXh0QWZmZWN0ZWRGaWxlKHVuZGVmaW5lZCwgKHNvdXJjZUZpbGUpID0+IHtcbiAgICAgICAgICAvLyBJZiB0aGUgYWZmZWN0ZWQgZmlsZSBpcyBhIFRUQyBzaGltLCBhZGQgdGhlIHNoaW0ncyBvcmlnaW5hbCBzb3VyY2UgZmlsZS5cbiAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgdGhhdCBjaGFuZ2VzIHRoYXQgYWZmZWN0IFRUQyBhcmUgdHlwZWNoZWNrZWQgZXZlbiB3aGVuIHRoZSBjaGFuZ2VzXG4gICAgICAgICAgLy8gYXJlIG90aGVyd2lzZSB1bnJlbGF0ZWQgZnJvbSBhIFRTIHBlcnNwZWN0aXZlIGFuZCBkbyBub3QgcmVzdWx0IGluIEl2eSBjb2RlZ2VuIGNoYW5nZXMuXG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGNoYW5naW5nIEBJbnB1dCBwcm9wZXJ0eSB0eXBlcyBvZiBhIGRpcmVjdGl2ZSB1c2VkIGluIGFub3RoZXIgY29tcG9uZW50J3NcbiAgICAgICAgICAvLyB0ZW1wbGF0ZS5cbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgIHNvdXJjZUZpbGUuZmlsZU5hbWUuZW5kc1dpdGgoJy5uZ3R5cGVjaGVjay50cycpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGZpbGUgbmFtZSBjb252ZXJzaW9uIHJlbGllcyBvbiBpbnRlcm5hbCBjb21waWxlciBsb2dpYyBhbmQgc2hvdWxkIGJlIGNvbnZlcnRlZFxuICAgICAgICAgICAgLy8gdG8gYW4gb2ZmaWNpYWwgbWV0aG9kIHdoZW4gYXZhaWxhYmxlLiAxNSBpcyBsZW5ndGggb2YgYC5uZ3R5cGVjaGVjay50c2BcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZW5hbWUgPSBzb3VyY2VGaWxlLmZpbGVOYW1lLnNsaWNlKDAsIC0xNSkgKyAnLnRzJztcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsU291cmNlRmlsZSA9IGJ1aWxkZXIuZ2V0U291cmNlRmlsZShvcmlnaW5hbEZpbGVuYW1lKTtcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbFNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQob3JpZ2luYWxTb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQocmVzdWx0LmFmZmVjdGVkIGFzIHRzLlNvdXJjZUZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbGxlY3QgcHJvZ3JhbSBsZXZlbCBkaWFnbm9zdGljc1xuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYW5ndWxhckNvbXBpbGVyLmdldE9wdGlvbkRpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldE9wdGlvbnNEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRHbG9iYWxEaWFnbm9zdGljcygpLFxuICAgIF07XG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcihkaWFnbm9zdGljcyk7XG5cbiAgICAvLyBDb2xsZWN0IHNvdXJjZSBmaWxlIHNwZWNpZmljIGRpYWdub3N0aWNzXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgaWYgKCFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKHNvdXJjZUZpbGUpKTtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3Moc291cmNlRmlsZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUFvdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLnBsdWdpbk9wdGlvbnMsIGltYWdlRG9tYWlucyk7XG5cbiAgICBjb25zdCBnZXREZXBlbmRlbmNpZXMgPSAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlUGF0aCBvZiBhbmd1bGFyQ29tcGlsZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGVwZW5kZW5jaWVzLnB1c2goXG4gICAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICAgIC8vIFJldHJpZXZlIGFsbCBkZXBlbmRlbmNpZXMgb2YgdGhlIHJlc291cmNlIChzdHlsZXNoZWV0IGltcG9ydHMsIGV0Yy4pXG4gICAgICAgICAgLi4ucmVzb3VyY2VMb2FkZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMocmVzb3VyY2VQYXRoKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlcGVuZGVuY2llcztcbiAgICB9O1xuXG4gICAgLy8gUmVxdWlyZWQgdG8gc3VwcG9ydCBhc3luY2hyb25vdXMgcmVzb3VyY2UgbG9hZGluZ1xuICAgIC8vIE11c3QgYmUgZG9uZSBiZWZvcmUgY3JlYXRpbmcgdHJhbnNmb3JtZXJzIG9yIGdldHRpbmcgdGVtcGxhdGUgZGlhZ25vc3RpY3NcbiAgICBjb25zdCBwZW5kaW5nQW5hbHlzaXMgPSBhbmd1bGFyQ29tcGlsZXJcbiAgICAgIC5hbmFseXplQXN5bmMoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICAgICAgaWYgKHNvdXJjZUZpbGUuaXNEZWNsYXJhdGlvbkZpbGUpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIENvbGxlY3Qgc291cmNlcyB0aGF0IGFyZSByZXF1aXJlZCB0byBiZSBlbWl0dGVkXG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWlnbm9yZUZvckVtaXQuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhYW5ndWxhckNvbXBpbGVyLmluY3JlbWVudGFsQ29tcGlsYXRpb24uc2FmZVRvU2tpcEVtaXQoc291cmNlRmlsZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5hZGQobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG5cbiAgICAgICAgICAgIC8vIElmIHJlcXVpcmVkIHRvIGVtaXQsIGRpYWdub3N0aWNzIG1heSBoYXZlIGFsc28gY2hhbmdlZFxuICAgICAgICAgICAgaWYgKCFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQoc291cmNlRmlsZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlICYmXG4gICAgICAgICAgICAhYWZmZWN0ZWRGaWxlcy5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgICFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIFVzZSBjYWNoZWQgQW5ndWxhciBkaWFnbm9zdGljcyBmb3IgdW5jaGFuZ2VkIGFuZCB1bmFmZmVjdGVkIGZpbGVzXG4gICAgICAgICAgICBjb25zdCBhbmd1bGFyRGlhZ25vc3RpY3MgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZS5nZXRBbmd1bGFyRGlhZ25vc3RpY3Moc291cmNlRmlsZSk7XG4gICAgICAgICAgICBpZiAoYW5ndWxhckRpYWdub3N0aWNzKSB7XG4gICAgICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb2xsZWN0IG5ldyBBbmd1bGFyIGRpYWdub3N0aWNzIGZvciBmaWxlcyBhZmZlY3RlZCBieSBjaGFuZ2VzXG4gICAgICAgIGNvbnN0IE9wdGltaXplRm9yID0gdGhpcy5jb21waWxlckNsaS5PcHRpbWl6ZUZvcjtcbiAgICAgICAgY29uc3Qgb3B0aW1pemVEaWFnbm9zdGljc0ZvciA9XG4gICAgICAgICAgYWZmZWN0ZWRGaWxlcy5zaXplIDw9IERJQUdOT1NUSUNTX0FGRkVDVEVEX1RIUkVTSE9MRFxuICAgICAgICAgICAgPyBPcHRpbWl6ZUZvci5TaW5nbGVGaWxlXG4gICAgICAgICAgICA6IE9wdGltaXplRm9yLldob2xlUHJvZ3JhbTtcbiAgICAgICAgZm9yIChjb25zdCBhZmZlY3RlZEZpbGUgb2YgYWZmZWN0ZWRGaWxlcykge1xuICAgICAgICAgIGNvbnN0IGFuZ3VsYXJEaWFnbm9zdGljcyA9IGFuZ3VsYXJDb21waWxlci5nZXREaWFnbm9zdGljc0ZvckZpbGUoXG4gICAgICAgICAgICBhZmZlY3RlZEZpbGUsXG4gICAgICAgICAgICBvcHRpbWl6ZURpYWdub3N0aWNzRm9yLFxuICAgICAgICAgICk7XG4gICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlPy51cGRhdGVBbmd1bGFyRGlhZ25vc3RpY3MoYWZmZWN0ZWRGaWxlLCBhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBlbWl0dGVyOiB0aGlzLmNyZWF0ZUZpbGVFbWl0dGVyKFxuICAgICAgICAgICAgYnVpbGRlcixcbiAgICAgICAgICAgIG1lcmdlVHJhbnNmb3JtZXJzKGFuZ3VsYXJDb21waWxlci5wcmVwYXJlRW1pdCgpLnRyYW5zZm9ybWVycywgdHJhbnNmb3JtZXJzKSxcbiAgICAgICAgICAgIGdldERlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIChzb3VyY2VGaWxlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5kZWxldGUobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG4gICAgICAgICAgICAgIGFuZ3VsYXJDb21waWxlci5pbmNyZW1lbnRhbENvbXBpbGF0aW9uLnJlY29yZFN1Y2Nlc3NmdWxFbWl0KHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICApLFxuICAgICAgICB9O1xuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoZXJyKSA9PiAoeyBlcnJvck1lc3NhZ2U6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBgJHtlcnJ9YCB9KSk7XG5cbiAgICBjb25zdCBhbmFseXppbmdGaWxlRW1pdHRlcjogRmlsZUVtaXR0ZXIgPSBhc3luYyAoZmlsZSkgPT4ge1xuICAgICAgY29uc3QgYW5hbHlzaXMgPSBhd2FpdCBwZW5kaW5nQW5hbHlzaXM7XG5cbiAgICAgIGlmICgnZXJyb3JNZXNzYWdlJyBpbiBhbmFseXNpcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYW5hbHlzaXMuZXJyb3JNZXNzYWdlKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFuYWx5c2lzLmVtaXR0ZXIoZmlsZSk7XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlRW1pdHRlcjogYW5hbHl6aW5nRmlsZUVtaXR0ZXIsXG4gICAgICBidWlsZGVyLFxuICAgICAgaW50ZXJuYWxGaWxlczogaWdub3JlRm9yRW1pdCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVKaXRQcm9ncmFtKFxuICAgIGNvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIHJvb3ROYW1lczogcmVhZG9ubHkgc3RyaW5nW10sXG4gICAgaG9zdDogQ29tcGlsZXJIb3N0LFxuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXI6IERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICkge1xuICAgIGxldCBidWlsZGVyO1xuICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgYnVpbGRlciA9IHRoaXMuYnVpbGRlciA9IHRzLmNyZWF0ZUVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW0oXG4gICAgICAgIHJvb3ROYW1lcyxcbiAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0LFxuICAgICAgICB0aGlzLmJ1aWxkZXIsXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXaGVuIG5vdCBpbiB3YXRjaCBtb2RlLCB0aGUgc3RhcnR1cCBjb3N0IG9mIHRoZSBpbmNyZW1lbnRhbCBhbmFseXNpcyBjYW4gYmUgYXZvaWRlZCBieVxuICAgICAgLy8gdXNpbmcgYW4gYWJzdHJhY3QgYnVpbGRlciB0aGF0IG9ubHkgd3JhcHMgYSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gICAgICBidWlsZGVyID0gdHMuY3JlYXRlQWJzdHJhY3RCdWlsZGVyKHJvb3ROYW1lcywgY29tcGlsZXJPcHRpb25zLCBob3N0KTtcbiAgICB9XG5cbiAgICBjb25zdCBkaWFnbm9zdGljcyA9IFtcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldEdsb2JhbERpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKCksXG4gICAgICAvLyBHYXRoZXIgaW5jcmVtZW50YWwgc2VtYW50aWMgZGlhZ25vc3RpY3NcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljcygpLFxuICAgIF07XG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcihkaWFnbm9zdGljcyk7XG5cbiAgICBjb25zdCB0cmFuc2Zvcm1lcnMgPSBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMoYnVpbGRlciwgdGhpcy5jb21waWxlckNsaSwgdGhpcy5wbHVnaW5PcHRpb25zKTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlRW1pdHRlcjogdGhpcy5jcmVhdGVGaWxlRW1pdHRlcihidWlsZGVyLCB0cmFuc2Zvcm1lcnMsICgpID0+IFtdKSxcbiAgICAgIGJ1aWxkZXIsXG4gICAgICBpbnRlcm5hbEZpbGVzOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlRmlsZUVtaXR0ZXIoXG4gICAgcHJvZ3JhbTogdHMuQnVpbGRlclByb2dyYW0sXG4gICAgdHJhbnNmb3JtZXJzOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMgPSB7fSxcbiAgICBnZXRFeHRyYURlcGVuZGVuY2llczogKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IEl0ZXJhYmxlPHN0cmluZz4sXG4gICAgb25BZnRlckVtaXQ/OiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4gdm9pZCxcbiAgKTogRmlsZUVtaXR0ZXIge1xuICAgIHJldHVybiBhc3luYyAoZmlsZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlUGF0aCA9IG5vcm1hbGl6ZVBhdGgoZmlsZSk7XG4gICAgICBpZiAodGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuaGFzKGZpbGVQYXRoKSkge1xuICAgICAgICByZXR1cm4gdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuZ2V0KGZpbGVQYXRoKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlRmlsZSA9IHByb2dyYW0uZ2V0U291cmNlRmlsZShmaWxlUGF0aCk7XG4gICAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgbGV0IGNvbnRlbnQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGxldCBtYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIHByb2dyYW0uZW1pdChcbiAgICAgICAgc291cmNlRmlsZSxcbiAgICAgICAgKGZpbGVuYW1lLCBkYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKCcubWFwJykpIHtcbiAgICAgICAgICAgIG1hcCA9IGRhdGE7XG4gICAgICAgICAgfSBlbHNlIGlmIChmaWxlbmFtZS5lbmRzV2l0aCgnLmpzJykpIHtcbiAgICAgICAgICAgIGNvbnRlbnQgPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHRyYW5zZm9ybWVycyxcbiAgICAgICk7XG5cbiAgICAgIG9uQWZ0ZXJFbWl0Py4oc291cmNlRmlsZSk7XG5cbiAgICAgIC8vIENhcHR1cmUgZW1pdCBoaXN0b3J5IGluZm8gZm9yIEFuZ3VsYXIgcmVidWlsZCBhbmFseXNpc1xuICAgICAgY29uc3QgaGFzaCA9IGNvbnRlbnQgPyAoYXdhaXQgdGhpcy5hZGRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGgsIGNvbnRlbnQpKS5oYXNoIDogdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBbXG4gICAgICAgIC4uLih0aGlzLmZpbGVEZXBlbmRlbmNpZXMuZ2V0KGZpbGVQYXRoKSB8fCBbXSksXG4gICAgICAgIC4uLmdldEV4dHJhRGVwZW5kZW5jaWVzKHNvdXJjZUZpbGUpLFxuICAgICAgXS5tYXAoZXh0ZXJuYWxpemVQYXRoKTtcblxuICAgICAgcmV0dXJuIHsgY29udGVudCwgbWFwLCBkZXBlbmRlbmNpZXMsIGhhc2ggfTtcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplQ29tcGlsZXJDbGkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuY29tcGlsZXJDbGlNb2R1bGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHVzZXMgYSBkeW5hbWljIGltcG9ydCB0byBsb2FkIGBAYW5ndWxhci9jb21waWxlci1jbGlgIHdoaWNoIG1heSBiZSBFU00uXG4gICAgLy8gQ29tbW9uSlMgY29kZSBjYW4gbG9hZCBFU00gY29kZSB2aWEgYSBkeW5hbWljIGltcG9ydC4gVW5mb3J0dW5hdGVseSwgVHlwZVNjcmlwdFxuICAgIC8vIHdpbGwgY3VycmVudGx5LCB1bmNvbmRpdGlvbmFsbHkgZG93bmxldmVsIGR5bmFtaWMgaW1wb3J0IGludG8gYSByZXF1aXJlIGNhbGwuXG4gICAgLy8gcmVxdWlyZSBjYWxscyBjYW5ub3QgbG9hZCBFU00gY29kZSBhbmQgd2lsbCByZXN1bHQgaW4gYSBydW50aW1lIGVycm9yLiBUbyB3b3JrYXJvdW5kXG4gICAgLy8gdGhpcywgYSBGdW5jdGlvbiBjb25zdHJ1Y3RvciBpcyB1c2VkIHRvIHByZXZlbnQgVHlwZVNjcmlwdCBmcm9tIGNoYW5naW5nIHRoZSBkeW5hbWljIGltcG9ydC5cbiAgICAvLyBPbmNlIFR5cGVTY3JpcHQgcHJvdmlkZXMgc3VwcG9ydCBmb3Iga2VlcGluZyB0aGUgZHluYW1pYyBpbXBvcnQgdGhpcyB3b3JrYXJvdW5kIGNhblxuICAgIC8vIGJlIGRyb3BwZWQuXG4gICAgdGhpcy5jb21waWxlckNsaU1vZHVsZSA9IGF3YWl0IG5ldyBGdW5jdGlvbihgcmV0dXJuIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyk7YCkoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYWRkRmlsZUVtaXRIaXN0b3J5KFxuICAgIGZpbGVQYXRoOiBzdHJpbmcsXG4gICAgY29udGVudDogc3RyaW5nLFxuICApOiBQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0+IHtcbiAgICBhc3NlcnQub2sodGhpcy53ZWJwYWNrQ3JlYXRlSGFzaCwgJ0ZpbGUgZW1pdHRlciBpcyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24nKTtcblxuICAgIGNvbnN0IGhpc3RvcnlEYXRhOiBGaWxlRW1pdEhpc3RvcnlJdGVtID0ge1xuICAgICAgbGVuZ3RoOiBjb250ZW50Lmxlbmd0aCxcbiAgICAgIGhhc2g6IHRoaXMud2VicGFja0NyZWF0ZUhhc2goJ3h4aGFzaDY0JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgpIGFzIFVpbnQ4QXJyYXksXG4gICAgfTtcblxuICAgIGlmICh0aGlzLndlYnBhY2tDYWNoZSkge1xuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0RmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoKTtcbiAgICAgIGlmICghaGlzdG9yeSB8fCBCdWZmZXIuY29tcGFyZShoaXN0b3J5Lmhhc2gsIGhpc3RvcnlEYXRhLmhhc2gpICE9PSAwKSB7XG4gICAgICAgIC8vIEhhc2ggZG9lc24ndCBtYXRjaCBvciBpdGVtIGRvZXNuJ3QgZXhpc3QuXG4gICAgICAgIGF3YWl0IHRoaXMud2VicGFja0NhY2hlLnN0b3JlUHJvbWlzZShmaWxlUGF0aCwgbnVsbCwgaGlzdG9yeURhdGEpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIC8vIFRoZSBpbiBtZW1vcnkgZmlsZSBlbWl0IGhpc3RvcnkgaXMgb25seSByZXF1aXJlZCBkdXJpbmcgd2F0Y2ggbW9kZS5cbiAgICAgIHRoaXMuZmlsZUVtaXRIaXN0b3J5LnNldChmaWxlUGF0aCwgaGlzdG9yeURhdGEpO1xuICAgIH1cblxuICAgIHJldHVybiBoaXN0b3J5RGF0YTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0RmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0gfCB1bmRlZmluZWQ+IHtcbiAgICByZXR1cm4gdGhpcy53ZWJwYWNrQ2FjaGVcbiAgICAgID8gdGhpcy53ZWJwYWNrQ2FjaGUuZ2V0UHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtIHwgdW5kZWZpbmVkPihmaWxlUGF0aCwgbnVsbClcbiAgICAgIDogdGhpcy5maWxlRW1pdEhpc3RvcnkuZ2V0KGZpbGVQYXRoKTtcbiAgfVxufVxuIl19