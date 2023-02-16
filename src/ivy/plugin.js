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
            compiler.resolverFactory.hooks.resolveOptions
                .for('normal')
                .tap(PLUGIN_NAME, (resolveOptions) => {
                resolveOptions.plugins ?? (resolveOptions.plugins = []);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLCtDQUFpQztBQUVqQyxrREFBd0Q7QUFDeEQsd0RBQTJEO0FBQzNELG1DQUEwQztBQUMxQywrQ0FLdUI7QUFDdkIsaUNBT2dCO0FBQ2hCLG1DQUF5RDtBQUN6RCxxQ0FBbUc7QUFDbkcscUNBQW9FO0FBQ3BFLHFEQUFtRztBQUVuRzs7OztHQUlHO0FBQ0gsTUFBTSw4QkFBOEIsR0FBRyxDQUFDLENBQUM7QUF1QnpDLE1BQU0sV0FBVyxHQUFHLGtCQUFrQixDQUFDO0FBQ3ZDLE1BQU0sdUJBQXVCLEdBQUcsSUFBSSxPQUFPLEVBQXNDLENBQUM7QUFPbEYsTUFBYSxvQkFBb0I7SUFjL0IsWUFBWSxVQUFnRCxFQUFFO1FBTDdDLHFCQUFnQixHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBQ2xELHdCQUFtQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFDeEMsNkJBQXdCLEdBQUcsSUFBSSxHQUFHLEVBQXNDLENBQUM7UUFDekUsb0JBQWUsR0FBRyxJQUFJLEdBQUcsRUFBK0IsQ0FBQztRQUd4RSxJQUFJLENBQUMsYUFBYSxHQUFHO1lBQ25CLGlCQUFpQixFQUFFLEtBQUs7WUFDeEIsaUJBQWlCLEVBQUUsS0FBSztZQUN4QixPQUFPLEVBQUUsS0FBSztZQUNkLGdCQUFnQixFQUFFLEVBQUU7WUFDcEIsYUFBYSxFQUFFLEVBQUU7WUFDakIscUJBQXFCLEVBQUUsSUFBSTtZQUMzQixRQUFRLEVBQUUsZUFBZTtZQUN6QixHQUFHLE9BQU87U0FDWCxDQUFDO0lBQ0osQ0FBQztJQUVELElBQVksV0FBVztRQUNyQiwrRUFBK0U7UUFD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LElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUN6QixzRUFBc0U7WUFDdEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ2pEO1FBRUQsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQztJQUVPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxRQUFnQjtRQUMvQyxPQUFPLElBQUksQ0FBQyxZQUFZO1lBQ3RCLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBa0MsUUFBUSxFQUFFLElBQUksQ0FBQztZQUMvRSxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNGO0FBbHBCRCxvREFrcEJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB0eXBlIHsgQ29tcGlsZXJIb3N0LCBDb21waWxlck9wdGlvbnMsIE5ndHNjUHJvZ3JhbSB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBzdHJpY3QgYXMgYXNzZXJ0IH0gZnJvbSAnYXNzZXJ0JztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb21waWxhdGlvbiwgQ29tcGlsZXIsIE1vZHVsZSwgTm9ybWFsTW9kdWxlIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7IFNvdXJjZUZpbGVDYWNoZSB9IGZyb20gJy4vY2FjaGUnO1xuaW1wb3J0IHtcbiAgRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgYWRkRXJyb3IsXG4gIGFkZFdhcm5pbmcsXG4gIGNyZWF0ZURpYWdub3N0aWNzUmVwb3J0ZXIsXG59IGZyb20gJy4vZGlhZ25vc3RpY3MnO1xuaW1wb3J0IHtcbiAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyxcbiAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24sXG4gIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyxcbiAgYXVnbWVudEhvc3RXaXRoUmVzb3VyY2VzLFxuICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zLFxuICBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nLFxufSBmcm9tICcuL2hvc3QnO1xuaW1wb3J0IHsgZXh0ZXJuYWxpemVQYXRoLCBub3JtYWxpemVQYXRoIH0gZnJvbSAnLi9wYXRocyc7XG5pbXBvcnQgeyBBbmd1bGFyUGx1Z2luU3ltYm9sLCBFbWl0RmlsZVJlc3VsdCwgRmlsZUVtaXR0ZXIsIEZpbGVFbWl0dGVyQ29sbGVjdGlvbiB9IGZyb20gJy4vc3ltYm9sJztcbmltcG9ydCB7IElucHV0RmlsZVN5c3RlbVN5bmMsIGNyZWF0ZVdlYnBhY2tTeXN0ZW0gfSBmcm9tICcuL3N5c3RlbSc7XG5pbXBvcnQgeyBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMsIGNyZWF0ZUppdFRyYW5zZm9ybWVycywgbWVyZ2VUcmFuc2Zvcm1lcnMgfSBmcm9tICcuL3RyYW5zZm9ybWF0aW9uJztcblxuLyoqXG4gKiBUaGUgdGhyZXNob2xkIHVzZWQgdG8gZGV0ZXJtaW5lIHdoZXRoZXIgQW5ndWxhciBmaWxlIGRpYWdub3N0aWNzIHNob3VsZCBvcHRpbWl6ZSBmb3IgZnVsbCBwcm9ncmFtc1xuICogb3Igc2luZ2xlIGZpbGVzLiBJZiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGZpbGVzIGZvciBhIGJ1aWxkIGlzIG1vcmUgdGhhbiB0aGUgdGhyZXNob2xkLCBmdWxsXG4gKiBwcm9ncmFtIG9wdGltaXphdGlvbiB3aWxsIGJlIHVzZWQuXG4gKi9cbmNvbnN0IERJQUdOT1NUSUNTX0FGRkVDVEVEX1RIUkVTSE9MRCA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zIHtcbiAgdHNjb25maWc6IHN0cmluZztcbiAgY29tcGlsZXJPcHRpb25zPzogQ29tcGlsZXJPcHRpb25zO1xuICBmaWxlUmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IGJvb2xlYW47XG4gIGVtaXRDbGFzc01ldGFkYXRhOiBib29sZWFuO1xuICBlbWl0TmdNb2R1bGVTY29wZTogYm9vbGVhbjtcbiAgaml0TW9kZTogYm9vbGVhbjtcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFRoZSBBbmd1bGFyIGNvbXBpbGF0aW9uIHN0YXRlIHRoYXQgaXMgbWFpbnRhaW5lZCBhY3Jvc3MgZWFjaCBXZWJwYWNrIGNvbXBpbGF0aW9uLlxuICovXG5pbnRlcmZhY2UgQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUge1xuICByZXNvdXJjZUxvYWRlcj86IFdlYnBhY2tSZXNvdXJjZUxvYWRlcjtcbiAgcHJldmlvdXNVbnVzZWQ/OiBTZXQ8c3RyaW5nPjtcbiAgcGF0aHNQbHVnaW46IFR5cGVTY3JpcHRQYXRoc1BsdWdpbjtcbn1cblxuY29uc3QgUExVR0lOX05BTUUgPSAnYW5ndWxhci1jb21waWxlcic7XG5jb25zdCBjb21waWxhdGlvbkZpbGVFbWl0dGVycyA9IG5ldyBXZWFrTWFwPENvbXBpbGF0aW9uLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24+KCk7XG5cbmludGVyZmFjZSBGaWxlRW1pdEhpc3RvcnlJdGVtIHtcbiAgbGVuZ3RoOiBudW1iZXI7XG4gIGhhc2g6IFVpbnQ4QXJyYXk7XG59XG5cbmV4cG9ydCBjbGFzcyBBbmd1bGFyV2VicGFja1BsdWdpbiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luT3B0aW9uczogQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zO1xuICBwcml2YXRlIGNvbXBpbGVyQ2xpTW9kdWxlPzogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyk7XG4gIHByaXZhdGUgd2F0Y2hNb2RlPzogYm9vbGVhbjtcbiAgcHJpdmF0ZSBuZ3RzY05leHRQcm9ncmFtPzogTmd0c2NQcm9ncmFtO1xuICBwcml2YXRlIGJ1aWxkZXI/OiB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICBwcml2YXRlIHNvdXJjZUZpbGVDYWNoZT86IFNvdXJjZUZpbGVDYWNoZTtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ2FjaGU/OiBSZXR1cm5UeXBlPENvbXBpbGF0aW9uWydnZXRDYWNoZSddPjtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ3JlYXRlSGFzaD86IENvbXBpbGVyWyd3ZWJwYWNrJ11bJ3V0aWwnXVsnY3JlYXRlSGFzaCddO1xuICBwcml2YXRlIHJlYWRvbmx5IGZpbGVEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVxdWlyZWRGaWxlc1RvRW1pdCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZSA9IG5ldyBNYXA8c3RyaW5nLCBFbWl0RmlsZVJlc3VsdCB8IHVuZGVmaW5lZD4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRW1pdEhpc3RvcnkgPSBuZXcgTWFwPHN0cmluZywgRmlsZUVtaXRIaXN0b3J5SXRlbT4oKTtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBQYXJ0aWFsPEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucz4gPSB7fSkge1xuICAgIHRoaXMucGx1Z2luT3B0aW9ucyA9IHtcbiAgICAgIGVtaXRDbGFzc01ldGFkYXRhOiBmYWxzZSxcbiAgICAgIGVtaXROZ01vZHVsZVNjb3BlOiBmYWxzZSxcbiAgICAgIGppdE1vZGU6IGZhbHNlLFxuICAgICAgZmlsZVJlcGxhY2VtZW50czoge30sXG4gICAgICBzdWJzdGl0dXRpb25zOiB7fSxcbiAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdHJ1ZSxcbiAgICAgIHRzY29uZmlnOiAndHNjb25maWcuanNvbicsXG4gICAgICAuLi5vcHRpb25zLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldCBjb21waWxlckNsaSgpOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKSB7XG4gICAgLy8gVGhlIGNvbXBpbGVyQ2xpTW9kdWxlIGZpZWxkIGlzIGd1YXJhbnRlZWQgdG8gYmUgZGVmaW5lZCBkdXJpbmcgYSBjb21waWxhdGlvblxuICAgIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gICAgLy8gaG9vayBleGVjdXRpb24gaXMgYW4gaW1wbGVtZW50YXRpb24gZXJyb3IuXG4gICAgYXNzZXJ0Lm9rKHRoaXMuY29tcGlsZXJDbGlNb2R1bGUsIGAnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgICByZXR1cm4gdGhpcy5jb21waWxlckNsaU1vZHVsZTtcbiAgfVxuXG4gIGdldCBvcHRpb25zKCk6IEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucyB7XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luT3B0aW9ucztcbiAgfVxuXG4gIGFwcGx5KGNvbXBpbGVyOiBDb21waWxlcik6IHZvaWQge1xuICAgIGNvbnN0IHsgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4sIFdlYnBhY2tFcnJvciwgdXRpbCB9ID0gY29tcGlsZXIud2VicGFjaztcbiAgICB0aGlzLndlYnBhY2tDcmVhdGVIYXNoID0gdXRpbC5jcmVhdGVIYXNoO1xuXG4gICAgLy8gU2V0dXAgZmlsZSByZXBsYWNlbWVudHMgd2l0aCB3ZWJwYWNrXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMpKSB7XG4gICAgICBuZXcgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4oXG4gICAgICAgIG5ldyBSZWdFeHAoJ14nICsga2V5LnJlcGxhY2UoL1suKitcXC0/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJykgKyAnJCcpLFxuICAgICAgICB2YWx1ZSxcbiAgICAgICkuYXBwbHkoY29tcGlsZXIpO1xuICAgIH1cblxuICAgIC8vIFNldCByZXNvbHZlciBvcHRpb25zXG4gICAgY29uc3QgcGF0aHNQbHVnaW4gPSBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKCk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKFBMVUdJTl9OQU1FLCAoY29tcGlsZXIpID0+IHtcbiAgICAgIGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlT3B0aW9uc1xuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAudGFwKFBMVUdJTl9OQU1FLCAocmVzb2x2ZU9wdGlvbnMpID0+IHtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zID8/PSBbXTtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zLnB1c2gocGF0aHNQbHVnaW4pO1xuXG4gICAgICAgICAgcmV0dXJuIHJlc29sdmVPcHRpb25zO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIExvYWQgdGhlIGNvbXBpbGVyLWNsaSBpZiBub3QgYWxyZWFkeSBhdmFpbGFibGVcbiAgICBjb21waWxlci5ob29rcy5iZWZvcmVDb21waWxlLnRhcFByb21pc2UoUExVR0lOX05BTUUsICgpID0+IHRoaXMuaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCkpO1xuXG4gICAgY29uc3QgY29tcGlsYXRpb25TdGF0ZTogQW5ndWxhckNvbXBpbGF0aW9uU3RhdGUgPSB7IHBhdGhzUGx1Z2luIH07XG4gICAgY29tcGlsZXIuaG9va3MudGhpc0NvbXBpbGF0aW9uLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGF0aW9uKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLnNldHVwQ29tcGlsYXRpb24oY29tcGlsYXRpb24sIGNvbXBpbGF0aW9uU3RhdGUpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgYWRkRXJyb3IoXG4gICAgICAgICAgY29tcGlsYXRpb24sXG4gICAgICAgICAgYEZhaWxlZCB0byBpbml0aWFsaXplIEFuZ3VsYXIgY29tcGlsYXRpb24gLSAke1xuICAgICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBlcnJvclxuICAgICAgICAgIH1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbiwgc3RhdGU6IEFuZ3VsYXJDb21waWxhdGlvblN0YXRlKTogdm9pZCB7XG4gICAgY29uc3QgY29tcGlsZXIgPSBjb21waWxhdGlvbi5jb21waWxlcjtcblxuICAgIC8vIFJlZ2lzdGVyIHBsdWdpbiB0byBlbnN1cmUgZGV0ZXJtaW5pc3RpYyBlbWl0IG9yZGVyIGluIG11bHRpLXBsdWdpbiB1c2FnZVxuICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSB0aGlzLnJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uKTtcbiAgICB0aGlzLndhdGNoTW9kZSA9IGNvbXBpbGVyLndhdGNoTW9kZTtcblxuICAgIC8vIEluaXRpYWxpemUgd2VicGFjayBjYWNoZVxuICAgIGlmICghdGhpcy53ZWJwYWNrQ2FjaGUgJiYgY29tcGlsYXRpb24ub3B0aW9ucy5jYWNoZSkge1xuICAgICAgdGhpcy53ZWJwYWNrQ2FjaGUgPSBjb21waWxhdGlvbi5nZXRDYWNoZShQTFVHSU5fTkFNRSk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIGlmIG5vdCBhbHJlYWR5IHNldHVwXG4gICAgaWYgKCFzdGF0ZS5yZXNvdXJjZUxvYWRlcikge1xuICAgICAgc3RhdGUucmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKHRoaXMud2F0Y2hNb2RlKTtcbiAgICB9XG5cbiAgICAvLyBTZXR1cCBhbmQgcmVhZCBUeXBlU2NyaXB0IGFuZCBBbmd1bGFyIGNvbXBpbGVyIGNvbmZpZ3VyYXRpb25cbiAgICBjb25zdCB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfSA9IHRoaXMubG9hZENvbmZpZ3VyYXRpb24oKTtcblxuICAgIC8vIENyZWF0ZSBkaWFnbm9zdGljcyByZXBvcnRlciBhbmQgcmVwb3J0IGNvbmZpZ3VyYXRpb24gZmlsZSBlcnJvcnNcbiAgICBjb25zdCBkaWFnbm9zdGljc1JlcG9ydGVyID0gY3JlYXRlRGlhZ25vc3RpY3NSZXBvcnRlcihjb21waWxhdGlvbiwgKGRpYWdub3N0aWMpID0+XG4gICAgICB0aGlzLmNvbXBpbGVyQ2xpLmZvcm1hdERpYWdub3N0aWNzKFtkaWFnbm9zdGljXSksXG4gICAgKTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGVycm9ycyk7XG5cbiAgICAvLyBVcGRhdGUgVHlwZVNjcmlwdCBwYXRoIG1hcHBpbmcgcGx1Z2luIHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICBzdGF0ZS5wYXRoc1BsdWdpbi51cGRhdGUoY29tcGlsZXJPcHRpb25zKTtcblxuICAgIC8vIENyZWF0ZSBhIFdlYnBhY2stYmFzZWQgVHlwZVNjcmlwdCBjb21waWxlciBob3N0XG4gICAgY29uc3Qgc3lzdGVtID0gY3JlYXRlV2VicGFja1N5c3RlbShcbiAgICAgIC8vIFdlYnBhY2sgbGFja3MgYW4gSW5wdXRGaWxlU3l0ZW0gdHlwZSBkZWZpbml0aW9uIHdpdGggc3luYyBmdW5jdGlvbnNcbiAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSBhcyBJbnB1dEZpbGVTeXN0ZW1TeW5jLFxuICAgICAgbm9ybWFsaXplUGF0aChjb21waWxlci5jb250ZXh0KSxcbiAgICApO1xuICAgIGNvbnN0IGhvc3QgPSB0cy5jcmVhdGVJbmNyZW1lbnRhbENvbXBpbGVySG9zdChjb21waWxlck9wdGlvbnMsIHN5c3RlbSk7XG5cbiAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBjYWNoaW5nIGFuZCByZXVzZSBjYWNoZSBmcm9tIHByZXZpb3VzIGNvbXBpbGF0aW9uIGlmIHByZXNlbnRcbiAgICBsZXQgY2FjaGUgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZTtcbiAgICBsZXQgY2hhbmdlZEZpbGVzO1xuICAgIGlmIChjYWNoZSkge1xuICAgICAgY2hhbmdlZEZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIFsuLi5jb21waWxlci5tb2RpZmllZEZpbGVzLCAuLi5jb21waWxlci5yZW1vdmVkRmlsZXNdKSB7XG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSA9IG5vcm1hbGl6ZVBhdGgoY2hhbmdlZEZpbGUpO1xuICAgICAgICAvLyBJbnZhbGlkYXRlIGZpbGUgZGVwZW5kZW5jaWVzXG4gICAgICAgIHRoaXMuZmlsZURlcGVuZGVuY2llcy5kZWxldGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcbiAgICAgICAgLy8gSW52YWxpZGF0ZSBleGlzdGluZyBjYWNoZVxuICAgICAgICBjYWNoZS5pbnZhbGlkYXRlKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG5cbiAgICAgICAgY2hhbmdlZEZpbGVzLmFkZChub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJbml0aWFsaXplIGEgbmV3IGNhY2hlXG4gICAgICBjYWNoZSA9IG5ldyBTb3VyY2VGaWxlQ2FjaGUoKTtcbiAgICAgIC8vIE9ubHkgc3RvcmUgY2FjaGUgaWYgaW4gd2F0Y2ggbW9kZVxuICAgICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlID0gY2FjaGU7XG4gICAgICB9XG4gICAgfVxuICAgIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcoaG9zdCwgY2FjaGUpO1xuXG4gICAgY29uc3QgbW9kdWxlUmVzb2x1dGlvbkNhY2hlID0gdHMuY3JlYXRlTW9kdWxlUmVzb2x1dGlvbkNhY2hlKFxuICAgICAgaG9zdC5nZXRDdXJyZW50RGlyZWN0b3J5KCksXG4gICAgICBob3N0LmdldENhbm9uaWNhbEZpbGVOYW1lLmJpbmQoaG9zdCksXG4gICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgKTtcblxuICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGRlcGVuZGVuY3kgY29sbGVjdGlvblxuICAgIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uKGhvc3QsIHRoaXMuZmlsZURlcGVuZGVuY2llcywgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcblxuICAgIC8vIFNldHVwIHJlc291cmNlIGxvYWRpbmdcbiAgICBzdGF0ZS5yZXNvdXJjZUxvYWRlci51cGRhdGUoY29tcGlsYXRpb24sIGNoYW5nZWRGaWxlcyk7XG4gICAgYXVnbWVudEhvc3RXaXRoUmVzb3VyY2VzKGhvc3QsIHN0YXRlLnJlc291cmNlTG9hZGVyLCB7XG4gICAgICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IHRoaXMucGx1Z2luT3B0aW9ucy5kaXJlY3RUZW1wbGF0ZUxvYWRpbmcsXG4gICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb246IHRoaXMucGx1Z2luT3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgfSk7XG5cbiAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBhZGp1c3RtZW50IG9wdGlvbnNcbiAgICBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMoaG9zdCwgdGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG4gICAgYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyhob3N0LCB0aGlzLnBsdWdpbk9wdGlvbnMuc3Vic3RpdHV0aW9ucyk7XG5cbiAgICAvLyBDcmVhdGUgdGhlIGZpbGUgZW1pdHRlciB1c2VkIGJ5IHRoZSB3ZWJwYWNrIGxvYWRlclxuICAgIGNvbnN0IHsgZmlsZUVtaXR0ZXIsIGJ1aWxkZXIsIGludGVybmFsRmlsZXMgfSA9IHRoaXMucGx1Z2luT3B0aW9ucy5qaXRNb2RlXG4gICAgICA/IHRoaXMudXBkYXRlSml0UHJvZ3JhbShjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgaG9zdCwgZGlhZ25vc3RpY3NSZXBvcnRlcilcbiAgICAgIDogdGhpcy51cGRhdGVBb3RQcm9ncmFtKFxuICAgICAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICByb290TmFtZXMsXG4gICAgICAgICAgaG9zdCxcbiAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyLFxuICAgICAgICAgIHN0YXRlLnJlc291cmNlTG9hZGVyLFxuICAgICAgICApO1xuXG4gICAgLy8gU2V0IG9mIGZpbGVzIHVzZWQgZHVyaW5nIHRoZSB1bnVzZWQgVHlwZVNjcmlwdCBmaWxlIGFuYWx5c2lzXG4gICAgY29uc3QgY3VycmVudFVudXNlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgaWYgKGludGVybmFsRmlsZXM/Lmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gRW5zdXJlIGFsbCBwcm9ncmFtIGZpbGVzIGFyZSBjb25zaWRlcmVkIHBhcnQgb2YgdGhlIGNvbXBpbGF0aW9uIGFuZCB3aWxsIGJlIHdhdGNoZWQuXG4gICAgICAvLyBXZWJwYWNrIGRvZXMgbm90IG5vcm1hbGl6ZSBwYXRocy4gVGhlcmVmb3JlLCB3ZSBuZWVkIHRvIG5vcm1hbGl6ZSB0aGUgcGF0aCB3aXRoIEZTIHNlcGVyYXRvcnMuXG4gICAgICBjb21waWxhdGlvbi5maWxlRGVwZW5kZW5jaWVzLmFkZChleHRlcm5hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuXG4gICAgICAvLyBBZGQgYWxsIG5vbi1kZWNsYXJhdGlvbiBmaWxlcyB0byB0aGUgaW5pdGlhbCBzZXQgb2YgdW51c2VkIGZpbGVzLiBUaGUgc2V0IHdpbGwgYmVcbiAgICAgIC8vIGFuYWx5emVkIGFuZCBwcnVuZWQgYWZ0ZXIgYWxsIFdlYnBhY2sgbW9kdWxlcyBhcmUgZmluaXNoZWQgYnVpbGRpbmcuXG4gICAgICBpZiAoIXNvdXJjZUZpbGUuaXNEZWNsYXJhdGlvbkZpbGUpIHtcbiAgICAgICAgY3VycmVudFVudXNlZC5hZGQobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29tcGlsYXRpb24uaG9va3MuZmluaXNoTW9kdWxlcy50YXBQcm9taXNlKFBMVUdJTl9OQU1FLCBhc3luYyAobW9kdWxlcykgPT4ge1xuICAgICAgLy8gUmVidWlsZCBhbnkgcmVtYWluaW5nIEFPVCByZXF1aXJlZCBtb2R1bGVzXG4gICAgICBhd2FpdCB0aGlzLnJlYnVpbGRSZXF1aXJlZEZpbGVzKG1vZHVsZXMsIGNvbXBpbGF0aW9uLCBmaWxlRW1pdHRlcik7XG5cbiAgICAgIC8vIENsZWFyIG91dCB0aGUgV2VicGFjayBjb21waWxhdGlvbiB0byBhdm9pZCBhbiBleHRyYSByZXRhaW5pbmcgcmVmZXJlbmNlXG4gICAgICBzdGF0ZS5yZXNvdXJjZUxvYWRlcj8uY2xlYXJQYXJlbnRDb21waWxhdGlvbigpO1xuXG4gICAgICAvLyBBbmFseXplIHByb2dyYW0gZm9yIHVudXNlZCBmaWxlc1xuICAgICAgaWYgKGNvbXBpbGF0aW9uLmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCB3ZWJwYWNrTW9kdWxlIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2UgPSAod2VicGFja01vZHVsZSBhcyBOb3JtYWxNb2R1bGUpLnJlc291cmNlO1xuICAgICAgICBpZiAocmVzb3VyY2UpIHtcbiAgICAgICAgICB0aGlzLm1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplUGF0aChyZXNvdXJjZSksIGN1cnJlbnRVbnVzZWQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgdW51c2VkIG9mIGN1cnJlbnRVbnVzZWQpIHtcbiAgICAgICAgaWYgKHN0YXRlLnByZXZpb3VzVW51c2VkPy5oYXModW51c2VkKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGFkZFdhcm5pbmcoXG4gICAgICAgICAgY29tcGlsYXRpb24sXG4gICAgICAgICAgYCR7dW51c2VkfSBpcyBwYXJ0IG9mIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uIGJ1dCBpdCdzIHVudXNlZC5cXG5gICtcbiAgICAgICAgICAgIGBBZGQgb25seSBlbnRyeSBwb2ludHMgdG8gdGhlICdmaWxlcycgb3IgJ2luY2x1ZGUnIHByb3BlcnRpZXMgaW4geW91ciB0c2NvbmZpZy5gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc3RhdGUucHJldmlvdXNVbnVzZWQgPSBjdXJyZW50VW51c2VkO1xuICAgIH0pO1xuXG4gICAgLy8gU3RvcmUgZmlsZSBlbWl0dGVyIGZvciBsb2FkZXIgdXNhZ2VcbiAgICBlbWl0UmVnaXN0cmF0aW9uLnVwZGF0ZShmaWxlRW1pdHRlcik7XG4gIH1cblxuICBwcml2YXRlIHJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbikge1xuICAgIGxldCBmaWxlRW1pdHRlcnMgPSBjb21waWxhdGlvbkZpbGVFbWl0dGVycy5nZXQoY29tcGlsYXRpb24pO1xuICAgIGlmICghZmlsZUVtaXR0ZXJzKSB7XG4gICAgICBmaWxlRW1pdHRlcnMgPSBuZXcgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uKCk7XG4gICAgICBjb21waWxhdGlvbkZpbGVFbWl0dGVycy5zZXQoY29tcGlsYXRpb24sIGZpbGVFbWl0dGVycyk7XG4gICAgICBjb21waWxhdGlvbi5jb21waWxlci53ZWJwYWNrLk5vcm1hbE1vZHVsZS5nZXRDb21waWxhdGlvbkhvb2tzKGNvbXBpbGF0aW9uKS5sb2FkZXIudGFwKFxuICAgICAgICBQTFVHSU5fTkFNRSxcbiAgICAgICAgKGxvYWRlckNvbnRleHQ6IHsgW0FuZ3VsYXJQbHVnaW5TeW1ib2xdPzogRmlsZUVtaXR0ZXJDb2xsZWN0aW9uIH0pID0+IHtcbiAgICAgICAgICBsb2FkZXJDb250ZXh0W0FuZ3VsYXJQbHVnaW5TeW1ib2xdID0gZmlsZUVtaXR0ZXJzO1xuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZW1pdFJlZ2lzdHJhdGlvbiA9IGZpbGVFbWl0dGVycy5yZWdpc3RlcigpO1xuXG4gICAgcmV0dXJuIGVtaXRSZWdpc3RyYXRpb247XG4gIH1cblxuICBwcml2YXRlIG1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplZFJlc291cmNlUGF0aDogc3RyaW5nLCBjdXJyZW50VW51c2VkOiBTZXQ8c3RyaW5nPik6IHZvaWQge1xuICAgIGlmICghY3VycmVudFVudXNlZC5oYXMobm9ybWFsaXplZFJlc291cmNlUGF0aCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjdXJyZW50VW51c2VkLmRlbGV0ZShub3JtYWxpemVkUmVzb3VyY2VQYXRoKTtcbiAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSB0aGlzLmZpbGVEZXBlbmRlbmNpZXMuZ2V0KG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpO1xuICAgIGlmICghZGVwZW5kZW5jaWVzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeSBvZiBkZXBlbmRlbmNpZXMpIHtcbiAgICAgIHRoaXMubWFya1Jlc291cmNlVXNlZChub3JtYWxpemVQYXRoKGRlcGVuZGVuY3kpLCBjdXJyZW50VW51c2VkKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYnVpbGRSZXF1aXJlZEZpbGVzKFxuICAgIG1vZHVsZXM6IEl0ZXJhYmxlPE1vZHVsZT4sXG4gICAgY29tcGlsYXRpb246IENvbXBpbGF0aW9uLFxuICAgIGZpbGVFbWl0dGVyOiBGaWxlRW1pdHRlcixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZXNUb1JlYnVpbGQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IHJlcXVpcmVkRmlsZSBvZiB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQpIHtcbiAgICAgIGNvbnN0IGhpc3RvcnkgPSBhd2FpdCB0aGlzLmdldEZpbGVFbWl0SGlzdG9yeShyZXF1aXJlZEZpbGUpO1xuICAgICAgaWYgKGhpc3RvcnkpIHtcbiAgICAgICAgY29uc3QgZW1pdFJlc3VsdCA9IGF3YWl0IGZpbGVFbWl0dGVyKHJlcXVpcmVkRmlsZSk7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlbWl0UmVzdWx0Py5jb250ZW50ID09PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICBoaXN0b3J5Lmxlbmd0aCAhPT0gZW1pdFJlc3VsdC5jb250ZW50Lmxlbmd0aCB8fFxuICAgICAgICAgIGVtaXRSZXN1bHQuaGFzaCA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgQnVmZmVyLmNvbXBhcmUoaGlzdG9yeS5oYXNoLCBlbWl0UmVzdWx0Lmhhc2gpICE9PSAwXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIE5ldyBlbWl0IHJlc3VsdCBpcyBkaWZmZXJlbnQgc28gcmVidWlsZCB1c2luZyBuZXcgZW1pdCByZXN1bHRcbiAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5zZXQocmVxdWlyZWRGaWxlLCBlbWl0UmVzdWx0KTtcbiAgICAgICAgICBmaWxlc1RvUmVidWlsZC5hZGQocmVxdWlyZWRGaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTm8gZW1pdCBoaXN0b3J5IHNvIHJlYnVpbGRcbiAgICAgICAgZmlsZXNUb1JlYnVpbGQuYWRkKHJlcXVpcmVkRmlsZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZpbGVzVG9SZWJ1aWxkLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCByZWJ1aWxkID0gKHdlYnBhY2tNb2R1bGU6IE1vZHVsZSkgPT5cbiAgICAgICAgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IGNvbXBpbGF0aW9uLnJlYnVpbGRNb2R1bGUod2VicGFja01vZHVsZSwgKCkgPT4gcmVzb2x2ZSgpKSk7XG5cbiAgICAgIGNvbnN0IG1vZHVsZXNUb1JlYnVpbGQgPSBbXTtcbiAgICAgIGZvciAoY29uc3Qgd2VicGFja01vZHVsZSBvZiBtb2R1bGVzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlID0gKHdlYnBhY2tNb2R1bGUgYXMgTm9ybWFsTW9kdWxlKS5yZXNvdXJjZTtcbiAgICAgICAgaWYgKHJlc291cmNlICYmIGZpbGVzVG9SZWJ1aWxkLmhhcyhub3JtYWxpemVQYXRoKHJlc291cmNlKSkpIHtcbiAgICAgICAgICBtb2R1bGVzVG9SZWJ1aWxkLnB1c2god2VicGFja01vZHVsZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKG1vZHVsZXNUb1JlYnVpbGQubWFwKCh3ZWJwYWNrTW9kdWxlKSA9PiByZWJ1aWxkKHdlYnBhY2tNb2R1bGUpKSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmNsZWFyKCk7XG4gICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuY2xlYXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgbG9hZENvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3Qge1xuICAgICAgb3B0aW9uczogY29tcGlsZXJPcHRpb25zLFxuICAgICAgcm9vdE5hbWVzLFxuICAgICAgZXJyb3JzLFxuICAgIH0gPSB0aGlzLmNvbXBpbGVyQ2xpLnJlYWRDb25maWd1cmF0aW9uKFxuICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLnRzY29uZmlnLFxuICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLmNvbXBpbGVyT3B0aW9ucyxcbiAgICApO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcbiAgICBjb21waWxlck9wdGlvbnMub3V0RGlyID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcDtcbiAgICBjb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLmFsbG93RW1wdHlDb2RlZ2VuRmlsZXMgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMuYW5ub3RhdGlvbnNBcyA9ICdkZWNvcmF0b3JzJztcbiAgICBjb21waWxlck9wdGlvbnMuZW5hYmxlUmVzb3VyY2VJbmxpbmluZyA9IGZhbHNlO1xuXG4gICAgcmV0dXJuIHsgY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGVycm9ycyB9O1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVBb3RQcm9ncmFtKFxuICAgIGNvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIHJvb3ROYW1lczogc3RyaW5nW10sXG4gICAgaG9zdDogQ29tcGlsZXJIb3N0LFxuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXI6IERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICAgcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcixcbiAgKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHNwZWNpZmljIHByb2dyYW0gdGhhdCBjb250YWlucyB0aGUgQW5ndWxhciBjb21waWxlclxuICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gbmV3IHRoaXMuY29tcGlsZXJDbGkuTmd0c2NQcm9ncmFtKFxuICAgICAgcm9vdE5hbWVzLFxuICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgaG9zdCxcbiAgICAgIHRoaXMubmd0c2NOZXh0UHJvZ3JhbSxcbiAgICApO1xuICAgIGNvbnN0IGFuZ3VsYXJDb21waWxlciA9IGFuZ3VsYXJQcm9ncmFtLmNvbXBpbGVyO1xuXG4gICAgLy8gVGhlIGBpZ25vcmVGb3JFbWl0YCByZXR1cm4gdmFsdWUgY2FuIGJlIHNhZmVseSBpZ25vcmVkIHdoZW4gZW1pdHRpbmcuIE9ubHkgZmlsZXNcbiAgICAvLyB0aGF0IHdpbGwgYmUgYnVuZGxlZCAocmVxdWVzdGVkIGJ5IFdlYnBhY2spIHdpbGwgYmUgZW1pdHRlZC4gQ29tYmluZWQgd2l0aCBUeXBlU2NyaXB0J3NcbiAgICAvLyBlbGlkaW5nIG9mIHR5cGUgb25seSBpbXBvcnRzLCB0aGlzIHdpbGwgY2F1c2UgdHlwZSBvbmx5IGZpbGVzIHRvIGJlIGF1dG9tYXRpY2FsbHkgaWdub3JlZC5cbiAgICAvLyBJbnRlcm5hbCBBbmd1bGFyIHR5cGUgY2hlY2sgZmlsZXMgYXJlIGFsc28gbm90IHJlc29sdmFibGUgYnkgdGhlIGJ1bmRsZXIuIEV2ZW4gaWYgdGhleVxuICAgIC8vIHdlcmUgc29tZWhvdyBlcnJhbnRseSBpbXBvcnRlZCwgdGhlIGJ1bmRsZXIgd291bGQgZXJyb3IgYmVmb3JlIGFuIGVtaXQgd2FzIGF0dGVtcHRlZC5cbiAgICAvLyBEaWFnbm9zdGljcyBhcmUgc3RpbGwgY29sbGVjdGVkIGZvciBhbGwgZmlsZXMgd2hpY2ggcmVxdWlyZXMgdXNpbmcgYGlnbm9yZUZvckRpYWdub3N0aWNzYC5cbiAgICBjb25zdCB7IGlnbm9yZUZvckRpYWdub3N0aWNzLCBpZ25vcmVGb3JFbWl0IH0gPSBhbmd1bGFyQ29tcGlsZXI7XG5cbiAgICAvLyBTb3VyY2VGaWxlIHZlcnNpb25zIGFyZSByZXF1aXJlZCBmb3IgYnVpbGRlciBwcm9ncmFtcy5cbiAgICAvLyBUaGUgd3JhcHBlZCBob3N0IGluc2lkZSBOZ3RzY1Byb2dyYW0gYWRkcyBhZGRpdGlvbmFsIGZpbGVzIHRoYXQgd2lsbCBub3QgaGF2ZSB2ZXJzaW9ucy5cbiAgICBjb25zdCB0eXBlU2NyaXB0UHJvZ3JhbSA9IGFuZ3VsYXJQcm9ncmFtLmdldFRzUHJvZ3JhbSgpO1xuICAgIGF1Z21lbnRQcm9ncmFtV2l0aFZlcnNpb25pbmcodHlwZVNjcmlwdFByb2dyYW0pO1xuXG4gICAgbGV0IGJ1aWxkZXI6IHRzLkJ1aWxkZXJQcm9ncmFtIHwgdHMuRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbTtcbiAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIGJ1aWxkZXIgPSB0aGlzLmJ1aWxkZXIgPSB0cy5jcmVhdGVFbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtKFxuICAgICAgICB0eXBlU2NyaXB0UHJvZ3JhbSxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdGhpcy5idWlsZGVyLFxuICAgICAgKTtcbiAgICAgIHRoaXMubmd0c2NOZXh0UHJvZ3JhbSA9IGFuZ3VsYXJQcm9ncmFtO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXaGVuIG5vdCBpbiB3YXRjaCBtb2RlLCB0aGUgc3RhcnR1cCBjb3N0IG9mIHRoZSBpbmNyZW1lbnRhbCBhbmFseXNpcyBjYW4gYmUgYXZvaWRlZCBieVxuICAgICAgLy8gdXNpbmcgYW4gYWJzdHJhY3QgYnVpbGRlciB0aGF0IG9ubHkgd3JhcHMgYSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gICAgICBidWlsZGVyID0gdHMuY3JlYXRlQWJzdHJhY3RCdWlsZGVyKHR5cGVTY3JpcHRQcm9ncmFtLCBob3N0KTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgc2VtYW50aWMgZGlhZ25vc3RpY3MgY2FjaGVcbiAgICBjb25zdCBhZmZlY3RlZEZpbGVzID0gbmV3IFNldDx0cy5Tb3VyY2VGaWxlPigpO1xuXG4gICAgLy8gQW5hbHl6ZSBhZmZlY3RlZCBmaWxlcyB3aGVuIGluIHdhdGNoIG1vZGUgZm9yIGluY3JlbWVudGFsIHR5cGUgY2hlY2tpbmdcbiAgICBpZiAoJ2dldFNlbWFudGljRGlhZ25vc3RpY3NPZk5leHRBZmZlY3RlZEZpbGUnIGluIGJ1aWxkZXIpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zdGFudC1jb25kaXRpb25cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljc09mTmV4dEFmZmVjdGVkRmlsZSh1bmRlZmluZWQsIChzb3VyY2VGaWxlKSA9PiB7XG4gICAgICAgICAgLy8gSWYgdGhlIGFmZmVjdGVkIGZpbGUgaXMgYSBUVEMgc2hpbSwgYWRkIHRoZSBzaGltJ3Mgb3JpZ2luYWwgc291cmNlIGZpbGUuXG4gICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIHRoYXQgY2hhbmdlcyB0aGF0IGFmZmVjdCBUVEMgYXJlIHR5cGVjaGVja2VkIGV2ZW4gd2hlbiB0aGUgY2hhbmdlc1xuICAgICAgICAgIC8vIGFyZSBvdGhlcndpc2UgdW5yZWxhdGVkIGZyb20gYSBUUyBwZXJzcGVjdGl2ZSBhbmQgZG8gbm90IHJlc3VsdCBpbiBJdnkgY29kZWdlbiBjaGFuZ2VzLlxuICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBjaGFuZ2luZyBASW5wdXQgcHJvcGVydHkgdHlwZXMgb2YgYSBkaXJlY3RpdmUgdXNlZCBpbiBhbm90aGVyIGNvbXBvbmVudCdzXG4gICAgICAgICAgLy8gdGVtcGxhdGUuXG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICBzb3VyY2VGaWxlLmZpbGVOYW1lLmVuZHNXaXRoKCcubmd0eXBlY2hlY2sudHMnKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgLy8gVGhpcyBmaWxlIG5hbWUgY29udmVyc2lvbiByZWxpZXMgb24gaW50ZXJuYWwgY29tcGlsZXIgbG9naWMgYW5kIHNob3VsZCBiZSBjb252ZXJ0ZWRcbiAgICAgICAgICAgIC8vIHRvIGFuIG9mZmljaWFsIG1ldGhvZCB3aGVuIGF2YWlsYWJsZS4gMTUgaXMgbGVuZ3RoIG9mIGAubmd0eXBlY2hlY2sudHNgXG4gICAgICAgICAgICBjb25zdCBvcmlnaW5hbEZpbGVuYW1lID0gc291cmNlRmlsZS5maWxlTmFtZS5zbGljZSgwLCAtMTUpICsgJy50cyc7XG4gICAgICAgICAgICBjb25zdCBvcmlnaW5hbFNvdXJjZUZpbGUgPSBidWlsZGVyLmdldFNvdXJjZUZpbGUob3JpZ2luYWxGaWxlbmFtZSk7XG4gICAgICAgICAgICBpZiAob3JpZ2luYWxTb3VyY2VGaWxlKSB7XG4gICAgICAgICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKG9yaWdpbmFsU291cmNlRmlsZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKHJlc3VsdC5hZmZlY3RlZCBhcyB0cy5Tb3VyY2VGaWxlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDb2xsZWN0IHByb2dyYW0gbGV2ZWwgZGlhZ25vc3RpY3NcbiAgICBjb25zdCBkaWFnbm9zdGljcyA9IFtcbiAgICAgIC4uLmFuZ3VsYXJDb21waWxlci5nZXRPcHRpb25EaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSxcbiAgICBdO1xuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZGlhZ25vc3RpY3MpO1xuXG4gICAgLy8gQ29sbGVjdCBzb3VyY2UgZmlsZSBzcGVjaWZpYyBkaWFnbm9zdGljc1xuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgIGlmICghaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYnVpbGRlci5nZXRTeW50YWN0aWNEaWFnbm9zdGljcyhzb3VyY2VGaWxlKSk7XG4gICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKHNvdXJjZUZpbGUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2Zvcm1lcnMgPSBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMoYnVpbGRlciwgdGhpcy5wbHVnaW5PcHRpb25zKTtcblxuICAgIGNvbnN0IGdldERlcGVuZGVuY2llcyA9IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB7XG4gICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VQYXRoIG9mIGFuZ3VsYXJDb21waWxlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICBkZXBlbmRlbmNpZXMucHVzaChcbiAgICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgICAgLy8gUmV0cmlldmUgYWxsIGRlcGVuZGVuY2llcyBvZiB0aGUgcmVzb3VyY2UgKHN0eWxlc2hlZXQgaW1wb3J0cywgZXRjLilcbiAgICAgICAgICAuLi5yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhyZXNvdXJjZVBhdGgpLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGVwZW5kZW5jaWVzO1xuICAgIH07XG5cbiAgICAvLyBSZXF1aXJlZCB0byBzdXBwb3J0IGFzeW5jaHJvbm91cyByZXNvdXJjZSBsb2FkaW5nXG4gICAgLy8gTXVzdCBiZSBkb25lIGJlZm9yZSBjcmVhdGluZyB0cmFuc2Zvcm1lcnMgb3IgZ2V0dGluZyB0ZW1wbGF0ZSBkaWFnbm9zdGljc1xuICAgIGNvbnN0IHBlbmRpbmdBbmFseXNpcyA9IGFuZ3VsYXJDb21waWxlclxuICAgICAgLmFuYWx5emVBc3luYygpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5jbGVhcigpO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgICAgICBpZiAoc291cmNlRmlsZS5pc0RlY2xhcmF0aW9uRmlsZSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQ29sbGVjdCBzb3VyY2VzIHRoYXQgYXJlIHJlcXVpcmVkIHRvIGJlIGVtaXR0ZWRcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAhaWdub3JlRm9yRW1pdC5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgICFhbmd1bGFyQ29tcGlsZXIuaW5jcmVtZW50YWxDb21waWxhdGlvbi5zYWZlVG9Ta2lwRW1pdChzb3VyY2VGaWxlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmFkZChub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcblxuICAgICAgICAgICAgLy8gSWYgcmVxdWlyZWQgdG8gZW1pdCwgZGlhZ25vc3RpY3MgbWF5IGhhdmUgYWxzbyBjaGFuZ2VkXG4gICAgICAgICAgICBpZiAoIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgJiZcbiAgICAgICAgICAgICFhZmZlY3RlZEZpbGVzLmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgLy8gVXNlIGNhY2hlZCBBbmd1bGFyIGRpYWdub3N0aWNzIGZvciB1bmNoYW5nZWQgYW5kIHVuYWZmZWN0ZWQgZmlsZXNcbiAgICAgICAgICAgIGNvbnN0IGFuZ3VsYXJEaWFnbm9zdGljcyA9IHRoaXMuc291cmNlRmlsZUNhY2hlLmdldEFuZ3VsYXJEaWFnbm9zdGljcyhzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIGlmIChhbmd1bGFyRGlhZ25vc3RpY3MpIHtcbiAgICAgICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbGxlY3QgbmV3IEFuZ3VsYXIgZGlhZ25vc3RpY3MgZm9yIGZpbGVzIGFmZmVjdGVkIGJ5IGNoYW5nZXNcbiAgICAgICAgY29uc3QgT3B0aW1pemVGb3IgPSB0aGlzLmNvbXBpbGVyQ2xpLk9wdGltaXplRm9yO1xuICAgICAgICBjb25zdCBvcHRpbWl6ZURpYWdub3N0aWNzRm9yID1cbiAgICAgICAgICBhZmZlY3RlZEZpbGVzLnNpemUgPD0gRElBR05PU1RJQ1NfQUZGRUNURURfVEhSRVNIT0xEXG4gICAgICAgICAgICA/IE9wdGltaXplRm9yLlNpbmdsZUZpbGVcbiAgICAgICAgICAgIDogT3B0aW1pemVGb3IuV2hvbGVQcm9ncmFtO1xuICAgICAgICBmb3IgKGNvbnN0IGFmZmVjdGVkRmlsZSBvZiBhZmZlY3RlZEZpbGVzKSB7XG4gICAgICAgICAgY29uc3QgYW5ndWxhckRpYWdub3N0aWNzID0gYW5ndWxhckNvbXBpbGVyLmdldERpYWdub3N0aWNzRm9yRmlsZShcbiAgICAgICAgICAgIGFmZmVjdGVkRmlsZSxcbiAgICAgICAgICAgIG9wdGltaXplRGlhZ25vc3RpY3NGb3IsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGU/LnVwZGF0ZUFuZ3VsYXJEaWFnbm9zdGljcyhhZmZlY3RlZEZpbGUsIGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGVtaXR0ZXI6IHRoaXMuY3JlYXRlRmlsZUVtaXR0ZXIoXG4gICAgICAgICAgICBidWlsZGVyLFxuICAgICAgICAgICAgbWVyZ2VUcmFuc2Zvcm1lcnMoYW5ndWxhckNvbXBpbGVyLnByZXBhcmVFbWl0KCkudHJhbnNmb3JtZXJzLCB0cmFuc2Zvcm1lcnMpLFxuICAgICAgICAgICAgZ2V0RGVwZW5kZW5jaWVzLFxuICAgICAgICAgICAgKHNvdXJjZUZpbGUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmRlbGV0ZShub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcbiAgICAgICAgICAgICAgYW5ndWxhckNvbXBpbGVyLmluY3JlbWVudGFsQ29tcGlsYXRpb24ucmVjb3JkU3VjY2Vzc2Z1bEVtaXQoc291cmNlRmlsZSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICksXG4gICAgICAgIH07XG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnIpID0+ICh7IGVycm9yTWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IGAke2Vycn1gIH0pKTtcblxuICAgIGNvbnN0IGFuYWx5emluZ0ZpbGVFbWl0dGVyOiBGaWxlRW1pdHRlciA9IGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IHBlbmRpbmdBbmFseXNpcztcblxuICAgICAgaWYgKCdlcnJvck1lc3NhZ2UnIGluIGFuYWx5c2lzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihhbmFseXNpcy5lcnJvck1lc3NhZ2UpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYW5hbHlzaXMuZW1pdHRlcihmaWxlKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiBhbmFseXppbmdGaWxlRW1pdHRlcixcbiAgICAgIGJ1aWxkZXIsXG4gICAgICBpbnRlcm5hbEZpbGVzOiBpZ25vcmVGb3JFbWl0LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUppdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgKSB7XG4gICAgbGV0IGJ1aWxkZXI7XG4gICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICBidWlsZGVyID0gdGhpcy5idWlsZGVyID0gdHMuY3JlYXRlRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbShcbiAgICAgICAgcm9vdE5hbWVzLFxuICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHRoaXMuYnVpbGRlcixcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIocm9vdE5hbWVzLCBjb21waWxlck9wdGlvbnMsIGhvc3QpO1xuICAgIH1cblxuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYnVpbGRlci5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0U3ludGFjdGljRGlhZ25vc3RpY3MoKSxcbiAgICAgIC8vIEdhdGhlciBpbmNyZW1lbnRhbCBzZW1hbnRpYyBkaWFnbm9zdGljc1xuICAgICAgLi4uYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKCksXG4gICAgXTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGRpYWdub3N0aWNzKTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUppdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLmNvbXBpbGVyQ2xpLCB0aGlzLnBsdWdpbk9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiB0aGlzLmNyZWF0ZUZpbGVFbWl0dGVyKGJ1aWxkZXIsIHRyYW5zZm9ybWVycywgKCkgPT4gW10pLFxuICAgICAgYnVpbGRlcixcbiAgICAgIGludGVybmFsRmlsZXM6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVGaWxlRW1pdHRlcihcbiAgICBwcm9ncmFtOiB0cy5CdWlsZGVyUHJvZ3JhbSxcbiAgICB0cmFuc2Zvcm1lcnM6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyA9IHt9LFxuICAgIGdldEV4dHJhRGVwZW5kZW5jaWVzOiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4gSXRlcmFibGU8c3RyaW5nPixcbiAgICBvbkFmdGVyRW1pdD86IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB2b2lkLFxuICApOiBGaWxlRW1pdHRlciB7XG4gICAgcmV0dXJuIGFzeW5jIChmaWxlOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gbm9ybWFsaXplUGF0aChmaWxlKTtcbiAgICAgIGlmICh0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5oYXMoZmlsZVBhdGgpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5nZXQoZmlsZVBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2VGaWxlID0gcHJvZ3JhbS5nZXRTb3VyY2VGaWxlKGZpbGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBsZXQgY29udGVudDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgbGV0IG1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgcHJvZ3JhbS5lbWl0KFxuICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICAoZmlsZW5hbWUsIGRhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoJy5tYXAnKSkge1xuICAgICAgICAgICAgbWFwID0gZGF0YTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKCcuanMnKSkge1xuICAgICAgICAgICAgY29udGVudCA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdHJhbnNmb3JtZXJzLFxuICAgICAgKTtcblxuICAgICAgb25BZnRlckVtaXQ/Lihzb3VyY2VGaWxlKTtcblxuICAgICAgLy8gQ2FwdHVyZSBlbWl0IGhpc3RvcnkgaW5mbyBmb3IgQW5ndWxhciByZWJ1aWxkIGFuYWx5c2lzXG4gICAgICBjb25zdCBoYXNoID0gY29udGVudCA/IChhd2FpdCB0aGlzLmFkZEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCwgY29udGVudCkpLmhhc2ggOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IFtcbiAgICAgICAgLi4uKHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQoZmlsZVBhdGgpIHx8IFtdKSxcbiAgICAgICAgLi4uZ2V0RXh0cmFEZXBlbmRlbmNpZXMoc291cmNlRmlsZSksXG4gICAgICBdLm1hcChleHRlcm5hbGl6ZVBhdGgpO1xuXG4gICAgICByZXR1cm4geyBjb250ZW50LCBtYXAsIGRlcGVuZGVuY2llcywgaGFzaCB9O1xuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVDb21waWxlckNsaSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5jb21waWxlckNsaU1vZHVsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFRoaXMgdXNlcyBhIGR5bmFtaWMgaW1wb3J0IHRvIGxvYWQgYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAgd2hpY2ggbWF5IGJlIEVTTS5cbiAgICAvLyBDb21tb25KUyBjb2RlIGNhbiBsb2FkIEVTTSBjb2RlIHZpYSBhIGR5bmFtaWMgaW1wb3J0LiBVbmZvcnR1bmF0ZWx5LCBUeXBlU2NyaXB0XG4gICAgLy8gd2lsbCBjdXJyZW50bHksIHVuY29uZGl0aW9uYWxseSBkb3dubGV2ZWwgZHluYW1pYyBpbXBvcnQgaW50byBhIHJlcXVpcmUgY2FsbC5cbiAgICAvLyByZXF1aXJlIGNhbGxzIGNhbm5vdCBsb2FkIEVTTSBjb2RlIGFuZCB3aWxsIHJlc3VsdCBpbiBhIHJ1bnRpbWUgZXJyb3IuIFRvIHdvcmthcm91bmRcbiAgICAvLyB0aGlzLCBhIEZ1bmN0aW9uIGNvbnN0cnVjdG9yIGlzIHVzZWQgdG8gcHJldmVudCBUeXBlU2NyaXB0IGZyb20gY2hhbmdpbmcgdGhlIGR5bmFtaWMgaW1wb3J0LlxuICAgIC8vIE9uY2UgVHlwZVNjcmlwdCBwcm92aWRlcyBzdXBwb3J0IGZvciBrZWVwaW5nIHRoZSBkeW5hbWljIGltcG9ydCB0aGlzIHdvcmthcm91bmQgY2FuXG4gICAgLy8gYmUgZHJvcHBlZC5cbiAgICB0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlID0gYXdhaXQgbmV3IEZ1bmN0aW9uKGByZXR1cm4gaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtgKSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhZGRGaWxlRW1pdEhpc3RvcnkoXG4gICAgZmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZW50OiBzdHJpbmcsXG4gICk6IFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbT4ge1xuICAgIGFzc2VydC5vayh0aGlzLndlYnBhY2tDcmVhdGVIYXNoLCAnRmlsZSBlbWl0dGVyIGlzIHVzZWQgcHJpb3IgdG8gV2VicGFjayBjb21waWxhdGlvbicpO1xuXG4gICAgY29uc3QgaGlzdG9yeURhdGE6IEZpbGVFbWl0SGlzdG9yeUl0ZW0gPSB7XG4gICAgICBsZW5ndGg6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgaGFzaDogdGhpcy53ZWJwYWNrQ3JlYXRlSGFzaCgneHhoYXNoNjQnKS51cGRhdGUoY29udGVudCkuZGlnZXN0KCkgYXMgVWludDhBcnJheSxcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMud2VicGFja0NhY2hlKSB7XG4gICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgdGhpcy5nZXRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGgpO1xuICAgICAgaWYgKCFoaXN0b3J5IHx8IEJ1ZmZlci5jb21wYXJlKGhpc3RvcnkuaGFzaCwgaGlzdG9yeURhdGEuaGFzaCkgIT09IDApIHtcbiAgICAgICAgLy8gSGFzaCBkb2Vzbid0IG1hdGNoIG9yIGl0ZW0gZG9lc24ndCBleGlzdC5cbiAgICAgICAgYXdhaXQgdGhpcy53ZWJwYWNrQ2FjaGUuc3RvcmVQcm9taXNlKGZpbGVQYXRoLCBudWxsLCBoaXN0b3J5RGF0YSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgLy8gVGhlIGluIG1lbW9yeSBmaWxlIGVtaXQgaGlzdG9yeSBpcyBvbmx5IHJlcXVpcmVkIGR1cmluZyB3YXRjaCBtb2RlLlxuICAgICAgdGhpcy5maWxlRW1pdEhpc3Rvcnkuc2V0KGZpbGVQYXRoLCBoaXN0b3J5RGF0YSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhpc3RvcnlEYXRhO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbSB8IHVuZGVmaW5lZD4ge1xuICAgIHJldHVybiB0aGlzLndlYnBhY2tDYWNoZVxuICAgICAgPyB0aGlzLndlYnBhY2tDYWNoZS5nZXRQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0gfCB1bmRlZmluZWQ+KGZpbGVQYXRoLCBudWxsKVxuICAgICAgOiB0aGlzLmZpbGVFbWl0SGlzdG9yeS5nZXQoZmlsZVBhdGgpO1xuICB9XG59XG4iXX0=