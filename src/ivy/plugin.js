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
const crypto_1 = require("crypto");
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
    // eslint-disable-next-line max-lines-per-function
    apply(compiler) {
        const { NormalModuleReplacementPlugin, util } = compiler.webpack;
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
        let ngccProcessor;
        let resourceLoader;
        let previousUnused;
        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
            // Register plugin to ensure deterministic emit order in multi-plugin usage
            const emitRegistration = this.registerWithCompilation(compilation);
            this.watchMode = compiler.watchMode;
            // Initialize webpack cache
            if (!this.webpackCache && compilation.options.cache) {
                this.webpackCache = compilation.getCache(PLUGIN_NAME);
            }
            // Initialize the resource loader if not already setup
            if (!resourceLoader) {
                resourceLoader = new resource_loader_1.WebpackResourceLoader(this.watchMode);
            }
            // Initialize and process eager ngcc if not already setup
            if (!ngccProcessor) {
                const { processor, errors, warnings } = initializeNgccProcessor(compiler, this.pluginOptions.tsconfig, this.compilerNgccModule);
                processor.process();
                warnings.forEach((warning) => (0, diagnostics_1.addWarning)(compilation, warning));
                errors.forEach((error) => (0, diagnostics_1.addError)(compilation, error));
                ngccProcessor = processor;
            }
            // Setup and read TypeScript and Angular compiler configuration
            const { compilerOptions, rootNames, errors } = this.loadConfiguration();
            // Create diagnostics reporter and report configuration file errors
            const diagnosticsReporter = (0, diagnostics_1.createDiagnosticsReporter)(compilation, (diagnostic) => this.compilerCli.formatDiagnostics([diagnostic]));
            diagnosticsReporter(errors);
            // Update TypeScript path mapping plugin with new configuration
            pathsPlugin.update(compilerOptions);
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
            (0, host_1.augmentHostWithNgcc)(host, ngccProcessor, moduleResolutionCache);
            // Setup resource loading
            resourceLoader.update(compilation, changedFiles);
            (0, host_1.augmentHostWithResources)(host, resourceLoader, {
                directTemplateLoading: this.pluginOptions.directTemplateLoading,
                inlineStyleFileExtension: this.pluginOptions.inlineStyleFileExtension,
            });
            // Setup source file adjustment options
            (0, host_1.augmentHostWithReplacements)(host, this.pluginOptions.fileReplacements, moduleResolutionCache);
            (0, host_1.augmentHostWithSubstitutions)(host, this.pluginOptions.substitutions);
            // Create the file emitter used by the webpack loader
            const { fileEmitter, builder, internalFiles } = this.pluginOptions.jitMode
                ? this.updateJitProgram(compilerOptions, rootNames, host, diagnosticsReporter)
                : this.updateAotProgram(compilerOptions, rootNames, host, diagnosticsReporter, resourceLoader);
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
                // Rebuild any remaining AOT required modules
                await this.rebuildRequiredFiles(modules, compilation, fileEmitter);
                // Clear out the Webpack compilation to avoid an extra retaining reference
                resourceLoader === null || resourceLoader === void 0 ? void 0 : resourceLoader.clearParentCompilation();
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
                    if (previousUnused && previousUnused.has(unused)) {
                        continue;
                    }
                    (0, diagnostics_1.addWarning)(compilation, `${unused} is part of the TypeScript compilation but it's unused.\n` +
                        `Add only entry points to the 'files' or 'include' properties in your tsconfig.`);
                }
                previousUnused = currentUnused;
            });
            // Store file emitter for loader usage
            emitRegistration.update(fileEmitter);
        });
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
        compilerOptions.enableIvy = true;
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
        const historyData = {
            length: content.length,
            hash: (0, crypto_1.createHash)('md5').update(content).digest(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLG1DQUFvQztBQUNwQywrQ0FBaUM7QUFFakMsc0RBQWtEO0FBQ2xELGtEQUF3RDtBQUN4RCx3REFBMkQ7QUFDM0QsbUNBQTBDO0FBQzFDLCtDQUt1QjtBQUN2QixpQ0FRZ0I7QUFDaEIsbUNBQXlEO0FBQ3pELHFDQUFtRztBQUNuRyxxQ0FBb0U7QUFDcEUscURBQW1HO0FBRW5HOzs7O0dBSUc7QUFDSCxNQUFNLDhCQUE4QixHQUFHLENBQUMsQ0FBQztBQWN6QyxTQUFTLHVCQUF1QixDQUM5QixRQUFrQixFQUNsQixRQUFnQixFQUNoQixrQkFBMkU7O0lBRTNFLE1BQU0sRUFBRSxlQUFlLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxHQUFHLFFBQVEsQ0FBQztJQUM5RCxNQUFNLFVBQVUsR0FBRyxNQUFBLE1BQUEsTUFBQSxjQUFjLENBQUMsT0FBTywwQ0FBRSxVQUFVLDBDQUFFLElBQUksRUFBRSxtQ0FBSSxFQUFFLENBQUM7SUFFcEUsTUFBTSxNQUFNLEdBQWEsRUFBRSxDQUFDO0lBQzVCLE1BQU0sUUFBUSxHQUFhLEVBQUUsQ0FBQztJQUM5QixNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7UUFDdEQsMEZBQTBGO1FBQzFGLEtBQUssRUFBRSxLQUFLO1FBQ1osVUFBVSxFQUFFLENBQUMsT0FBTyxDQUFDO1FBQ3JCLHNCQUFzQixFQUFFLElBQUk7S0FDN0IsQ0FBQyxDQUFDO0lBRUgsZ0ZBQWdGO0lBQ2hGLGdGQUFnRjtJQUNoRiw2Q0FBNkM7SUFDN0MsZUFBTSxDQUFDLEVB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LEVBQ2hCLE9BQWU7UUFFZixNQUFNLFdBQVcsR0FBd0I7WUFDdkMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQ3RCLElBQUksRUFBRSxJQUFBLG1CQUFVLEVBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLE1BQU0sRUFBRTtTQUNqRCxDQUFDO1FBRUYsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFO1lBQ3JCLE1BQU0sT0FBTyxHQUFHLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3hELElBQUksQ0FBQyxPQUFPLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUU7Z0JBQ3BFLDRDQUE0QztnQkFDNUMsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO2FBQ25FO1NBQ0Y7YUFBTSxJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDekIsc0VBQXNFO1lBQ3RFLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxXQUFXLENBQUMsQ0FBQztTQUNqRDtRQUVELE9BQU8sV0FBVyxDQUFDO0lBQ3JCLENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsUUFBZ0I7UUFDL0MsT0FBTyxJQUFJLENBQUMsWUFBWTtZQUN0QixDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQWtDLFFBQVEsRUFBRSxJQUFJLENBQUM7WUFDL0UsQ0FBQyxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7Q0FDRjtBQS9wQkQsb0RBK3BCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IENvbXBpbGVySG9zdCwgQ29tcGlsZXJPcHRpb25zLCBOZ3RzY1Byb2dyYW0gfSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgc3RyaWN0IGFzIGFzc2VydCB9IGZyb20gJ2Fzc2VydCc7XG5pbXBvcnQgeyBjcmVhdGVIYXNoIH0gZnJvbSAnY3J5cHRvJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb21waWxhdGlvbiwgQ29tcGlsZXIsIE1vZHVsZSwgTm9ybWFsTW9kdWxlIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBOZ2NjUHJvY2Vzc29yIH0gZnJvbSAnLi4vbmdjY19wcm9jZXNzb3InO1xuaW1wb3J0IHsgVHlwZVNjcmlwdFBhdGhzUGx1Z2luIH0gZnJvbSAnLi4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4uL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQgeyBTb3VyY2VGaWxlQ2FjaGUgfSBmcm9tICcuL2NhY2hlJztcbmltcG9ydCB7XG4gIERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gIGFkZEVycm9yLFxuICBhZGRXYXJuaW5nLFxuICBjcmVhdGVEaWFnbm9zdGljc1JlcG9ydGVyLFxufSBmcm9tICcuL2RpYWdub3N0aWNzJztcbmltcG9ydCB7XG4gIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcsXG4gIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uLFxuICBhdWdtZW50SG9zdFdpdGhOZ2NjLFxuICBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMsXG4gIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyxcbiAgYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyxcbiAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyxcbn0gZnJvbSAnLi9ob3N0JztcbmltcG9ydCB7IGV4dGVybmFsaXplUGF0aCwgbm9ybWFsaXplUGF0aCB9IGZyb20gJy4vcGF0aHMnO1xuaW1wb3J0IHsgQW5ndWxhclBsdWdpblN5bWJvbCwgRW1pdEZpbGVSZXN1bHQsIEZpbGVFbWl0dGVyLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSBmcm9tICcuL3N5bWJvbCc7XG5pbXBvcnQgeyBJbnB1dEZpbGVTeXN0ZW1TeW5jLCBjcmVhdGVXZWJwYWNrU3lzdGVtIH0gZnJvbSAnLi9zeXN0ZW0nO1xuaW1wb3J0IHsgY3JlYXRlQW90VHJhbnNmb3JtZXJzLCBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMsIG1lcmdlVHJhbnNmb3JtZXJzIH0gZnJvbSAnLi90cmFuc2Zvcm1hdGlvbic7XG5cbi8qKlxuICogVGhlIHRocmVzaG9sZCB1c2VkIHRvIGRldGVybWluZSB3aGV0aGVyIEFuZ3VsYXIgZmlsZSBkaWFnbm9zdGljcyBzaG91bGQgb3B0aW1pemUgZm9yIGZ1bGwgcHJvZ3JhbXNcbiAqIG9yIHNpbmdsZSBmaWxlcy4gSWYgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBmaWxlcyBmb3IgYSBidWlsZCBpcyBtb3JlIHRoYW4gdGhlIHRocmVzaG9sZCwgZnVsbFxuICogcHJvZ3JhbSBvcHRpbWl6YXRpb24gd2lsbCBiZSB1c2VkLlxuICovXG5jb25zdCBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTEQgPSAxO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucyB7XG4gIHRzY29uZmlnOiBzdHJpbmc7XG4gIGNvbXBpbGVyT3B0aW9ucz86IENvbXBpbGVyT3B0aW9ucztcbiAgZmlsZVJlcGxhY2VtZW50czogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgc3Vic3RpdHV0aW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nOiBib29sZWFuO1xuICBlbWl0Q2xhc3NNZXRhZGF0YTogYm9vbGVhbjtcbiAgZW1pdE5nTW9kdWxlU2NvcGU6IGJvb2xlYW47XG4gIGppdE1vZGU6IGJvb2xlYW47XG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZztcbn1cblxuZnVuY3Rpb24gaW5pdGlhbGl6ZU5nY2NQcm9jZXNzb3IoXG4gIGNvbXBpbGVyOiBDb21waWxlcixcbiAgdHNjb25maWc6IHN0cmluZyxcbiAgY29tcGlsZXJOZ2NjTW9kdWxlOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpIHwgdW5kZWZpbmVkLFxuKTogeyBwcm9jZXNzb3I6IE5nY2NQcm9jZXNzb3I7IGVycm9yczogc3RyaW5nW107IHdhcm5pbmdzOiBzdHJpbmdbXSB9IHtcbiAgY29uc3QgeyBpbnB1dEZpbGVTeXN0ZW0sIG9wdGlvbnM6IHdlYnBhY2tPcHRpb25zIH0gPSBjb21waWxlcjtcbiAgY29uc3QgbWFpbkZpZWxkcyA9IHdlYnBhY2tPcHRpb25zLnJlc29sdmU/Lm1haW5GaWVsZHM/LmZsYXQoKSA/PyBbXTtcblxuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZXNvbHZlciA9IGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5nZXQoJ25vcm1hbCcsIHtcbiAgICAvLyBDYWNoaW5nIG11c3QgYmUgZGlzYWJsZWQgYmVjYXVzZSBpdCBjYXVzZXMgdGhlIHJlc29sdmVyIHRvIGJlY29tZSBhc3luYyBhZnRlciBhIHJlYnVpbGRcbiAgICBjYWNoZTogZmFsc2UsXG4gICAgZXh0ZW5zaW9uczogWycuanNvbiddLFxuICAgIHVzZVN5bmNGaWxlU3lzdGVtQ2FsbHM6IHRydWUsXG4gIH0pO1xuXG4gIC8vIFRoZSBjb21waWxlck5nY2NNb2R1bGUgZmllbGQgaXMgZ3VhcmFudGVlZCB0byBiZSBkZWZpbmVkIGR1cmluZyBhIGNvbXBpbGF0aW9uXG4gIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICBhc3NlcnQub2soY29tcGlsZXJOZ2NjTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgY29uc3QgcHJvY2Vzc29yID0gbmV3IE5nY2NQcm9jZXNzb3IoXG4gICAgY29tcGlsZXJOZ2NjTW9kdWxlLFxuICAgIG1haW5GaWVsZHMsXG4gICAgd2FybmluZ3MsXG4gICAgZXJyb3JzLFxuICAgIGNvbXBpbGVyLmNvbnRleHQsXG4gICAgdHNjb25maWcsXG4gICAgaW5wdXRGaWxlU3lzdGVtLFxuICAgIHJlc29sdmVyLFxuICApO1xuXG4gIHJldHVybiB7IHByb2Nlc3NvciwgZXJyb3JzLCB3YXJuaW5ncyB9O1xufVxuXG5jb25zdCBQTFVHSU5fTkFNRSA9ICdhbmd1bGFyLWNvbXBpbGVyJztcbmNvbnN0IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzID0gbmV3IFdlYWtNYXA8Q29tcGlsYXRpb24sIEZpbGVFbWl0dGVyQ29sbGVjdGlvbj4oKTtcblxuaW50ZXJmYWNlIEZpbGVFbWl0SGlzdG9yeUl0ZW0ge1xuICBsZW5ndGg6IG51bWJlcjtcbiAgaGFzaDogVWludDhBcnJheTtcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJXZWJwYWNrUGx1Z2luIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5PcHRpb25zOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM7XG4gIHByaXZhdGUgY29tcGlsZXJDbGlNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtcbiAgcHJpdmF0ZSBjb21waWxlck5nY2NNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpO1xuICBwcml2YXRlIHdhdGNoTW9kZT86IGJvb2xlYW47XG4gIHByaXZhdGUgbmd0c2NOZXh0UHJvZ3JhbT86IE5ndHNjUHJvZ3JhbTtcbiAgcHJpdmF0ZSBidWlsZGVyPzogdHMuRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbTtcbiAgcHJpdmF0ZSBzb3VyY2VGaWxlQ2FjaGU/OiBTb3VyY2VGaWxlQ2FjaGU7XG4gIHByaXZhdGUgd2VicGFja0NhY2hlPzogUmV0dXJuVHlwZTxDb21waWxhdGlvblsnZ2V0Q2FjaGUnXT47XG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZURlcGVuZGVuY2llcyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1aXJlZEZpbGVzVG9FbWl0ID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlID0gbmV3IE1hcDxzdHJpbmcsIEVtaXRGaWxlUmVzdWx0IHwgdW5kZWZpbmVkPigpO1xuICBwcml2YXRlIHJlYWRvbmx5IGZpbGVFbWl0SGlzdG9yeSA9IG5ldyBNYXA8c3RyaW5nLCBGaWxlRW1pdEhpc3RvcnlJdGVtPigpO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFBhcnRpYWw8QW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zPiA9IHt9KSB7XG4gICAgdGhpcy5wbHVnaW5PcHRpb25zID0ge1xuICAgICAgZW1pdENsYXNzTWV0YWRhdGE6IGZhbHNlLFxuICAgICAgZW1pdE5nTW9kdWxlU2NvcGU6IGZhbHNlLFxuICAgICAgaml0TW9kZTogZmFsc2UsXG4gICAgICBmaWxlUmVwbGFjZW1lbnRzOiB7fSxcbiAgICAgIHN1YnN0aXR1dGlvbnM6IHt9LFxuICAgICAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nOiB0cnVlLFxuICAgICAgdHNjb25maWc6ICd0c2NvbmZpZy5qc29uJyxcbiAgICAgIC4uLm9wdGlvbnMsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGNvbXBpbGVyQ2xpKCk6IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScpIHtcbiAgICAvLyBUaGUgY29tcGlsZXJDbGlNb2R1bGUgZmllbGQgaXMgZ3VhcmFudGVlZCB0byBiZSBkZWZpbmVkIGR1cmluZyBhIGNvbXBpbGF0aW9uXG4gICAgLy8gZHVlIHRvIHRoZSBgYmVmb3JlQ29tcGlsZWAgaG9vay4gVXNhZ2Ugb2YgdGhpcyBwcm9wZXJ0eSBhY2Nlc3NvciBwcmlvciB0byB0aGVcbiAgICAvLyBob29rIGV4ZWN1dGlvbiBpcyBhbiBpbXBsZW1lbnRhdGlvbiBlcnJvci5cbiAgICBhc3NlcnQub2sodGhpcy5jb21waWxlckNsaU1vZHVsZSwgYCdAYW5ndWxhci9jb21waWxlci1jbGknIHVzZWQgcHJpb3IgdG8gV2VicGFjayBjb21waWxhdGlvbi5gKTtcblxuICAgIHJldHVybiB0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlO1xuICB9XG5cbiAgZ2V0IG9wdGlvbnMoKTogQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zIHtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW5PcHRpb25zO1xuICB9XG5cbiAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG1heC1saW5lcy1wZXItZnVuY3Rpb25cbiAgYXBwbHkoY29tcGlsZXI6IENvbXBpbGVyKTogdm9pZCB7XG4gICAgY29uc3QgeyBOb3JtYWxNb2R1bGVSZXBsYWNlbWVudFBsdWdpbiwgdXRpbCB9ID0gY29tcGlsZXIud2VicGFjaztcblxuICAgIC8vIFNldHVwIGZpbGUgcmVwbGFjZW1lbnRzIHdpdGggd2VicGFja1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMucGx1Z2luT3B0aW9ucy5maWxlUmVwbGFjZW1lbnRzKSkge1xuICAgICAgbmV3IE5vcm1hbE1vZHVsZVJlcGxhY2VtZW50UGx1Z2luKFxuICAgICAgICBuZXcgUmVnRXhwKCdeJyArIGtleS5yZXBsYWNlKC9bLiorXFwtP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpICsgJyQnKSxcbiAgICAgICAgdmFsdWUsXG4gICAgICApLmFwcGx5KGNvbXBpbGVyKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgcmVzb2x2ZXIgb3B0aW9uc1xuICAgIGNvbnN0IHBhdGhzUGx1Z2luID0gbmV3IFR5cGVTY3JpcHRQYXRoc1BsdWdpbigpO1xuICAgIGNvbXBpbGVyLmhvb2tzLmFmdGVyUmVzb2x2ZXJzLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGVyKSA9PiB7XG4gICAgICAvLyBXaGVuIEl2eSBpcyBlbmFibGVkIHdlIG5lZWQgdG8gYWRkIHRoZSBmaWVsZHMgYWRkZWQgYnkgTkdDQ1xuICAgICAgLy8gdG8gdGFrZSBwcmVjZWRlbmNlIG92ZXIgdGhlIHByb3ZpZGVkIG1haW5GaWVsZHMuXG4gICAgICAvLyBOR0NDIGFkZHMgZmllbGRzIGluIHBhY2thZ2UuanNvbiBzdWZmaXhlZCB3aXRoICdfaXZ5X25nY2MnXG4gICAgICAvLyBFeGFtcGxlOiBtb2R1bGUgLT4gbW9kdWxlX19pdnlfbmdjY1xuICAgICAgY29tcGlsZXIucmVzb2x2ZXJGYWN0b3J5Lmhvb2tzLnJlc29sdmVPcHRpb25zXG4gICAgICAgIC5mb3IoJ25vcm1hbCcpXG4gICAgICAgIC50YXAoUExVR0lOX05BTUUsIChyZXNvbHZlT3B0aW9ucykgPT4ge1xuICAgICAgICAgIGNvbnN0IG9yaWdpbmFsTWFpbkZpZWxkcyA9IHJlc29sdmVPcHRpb25zLm1haW5GaWVsZHM7XG4gICAgICAgICAgY29uc3QgaXZ5TWFpbkZpZWxkcyA9IG9yaWdpbmFsTWFpbkZpZWxkcz8uZmxhdCgpLm1hcCgoZikgPT4gYCR7Zn1faXZ5X25nY2NgKSA/PyBbXTtcblxuICAgICAgICAgIHJlc29sdmVPcHRpb25zLnBsdWdpbnMgPz89IFtdO1xuICAgICAgICAgIHJlc29sdmVPcHRpb25zLnBsdWdpbnMucHVzaChwYXRoc1BsdWdpbik7XG5cbiAgICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vd2VicGFjay93ZWJwYWNrL2lzc3Vlcy8xMTYzNSNpc3N1ZWNvbW1lbnQtNzA3MDE2Nzc5XG4gICAgICAgICAgcmV0dXJuIHV0aWwuY2xldmVyTWVyZ2UocmVzb2x2ZU9wdGlvbnMsIHsgbWFpbkZpZWxkczogWy4uLml2eU1haW5GaWVsZHMsICcuLi4nXSB9KTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBMb2FkIHRoZSBjb21waWxlci1jbGkgaWYgbm90IGFscmVhZHkgYXZhaWxhYmxlXG4gICAgY29tcGlsZXIuaG9va3MuYmVmb3JlQ29tcGlsZS50YXBQcm9taXNlKFBMVUdJTl9OQU1FLCAoKSA9PiB0aGlzLmluaXRpYWxpemVDb21waWxlckNsaSgpKTtcblxuICAgIGxldCBuZ2NjUHJvY2Vzc29yOiBOZ2NjUHJvY2Vzc29yIHwgdW5kZWZpbmVkO1xuICAgIGxldCByZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyIHwgdW5kZWZpbmVkO1xuICAgIGxldCBwcmV2aW91c1VudXNlZDogU2V0PHN0cmluZz4gfCB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXIuaG9va3MudGhpc0NvbXBpbGF0aW9uLnRhcChQTFVHSU5fTkFNRSwgKGNvbXBpbGF0aW9uKSA9PiB7XG4gICAgICAvLyBSZWdpc3RlciBwbHVnaW4gdG8gZW5zdXJlIGRldGVybWluaXN0aWMgZW1pdCBvcmRlciBpbiBtdWx0aS1wbHVnaW4gdXNhZ2VcbiAgICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSB0aGlzLnJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uKTtcbiAgICAgIHRoaXMud2F0Y2hNb2RlID0gY29tcGlsZXIud2F0Y2hNb2RlO1xuXG4gICAgICAvLyBJbml0aWFsaXplIHdlYnBhY2sgY2FjaGVcbiAgICAgIGlmICghdGhpcy53ZWJwYWNrQ2FjaGUgJiYgY29tcGlsYXRpb24ub3B0aW9ucy5jYWNoZSkge1xuICAgICAgICB0aGlzLndlYnBhY2tDYWNoZSA9IGNvbXBpbGF0aW9uLmdldENhY2hlKFBMVUdJTl9OQU1FKTtcbiAgICAgIH1cblxuICAgICAgLy8gSW5pdGlhbGl6ZSB0aGUgcmVzb3VyY2UgbG9hZGVyIGlmIG5vdCBhbHJlYWR5IHNldHVwXG4gICAgICBpZiAoIXJlc291cmNlTG9hZGVyKSB7XG4gICAgICAgIHJlc291cmNlTG9hZGVyID0gbmV3IFdlYnBhY2tSZXNvdXJjZUxvYWRlcih0aGlzLndhdGNoTW9kZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEluaXRpYWxpemUgYW5kIHByb2Nlc3MgZWFnZXIgbmdjYyBpZiBub3QgYWxyZWFkeSBzZXR1cFxuICAgICAgaWYgKCFuZ2NjUHJvY2Vzc29yKSB7XG4gICAgICAgIGNvbnN0IHsgcHJvY2Vzc29yLCBlcnJvcnMsIHdhcm5pbmdzIH0gPSBpbml0aWFsaXplTmdjY1Byb2Nlc3NvcihcbiAgICAgICAgICBjb21waWxlcixcbiAgICAgICAgICB0aGlzLnBsdWdpbk9wdGlvbnMudHNjb25maWcsXG4gICAgICAgICAgdGhpcy5jb21waWxlck5nY2NNb2R1bGUsXG4gICAgICAgICk7XG5cbiAgICAgICAgcHJvY2Vzc29yLnByb2Nlc3MoKTtcbiAgICAgICAgd2FybmluZ3MuZm9yRWFjaCgod2FybmluZykgPT4gYWRkV2FybmluZyhjb21waWxhdGlvbiwgd2FybmluZykpO1xuICAgICAgICBlcnJvcnMuZm9yRWFjaCgoZXJyb3IpID0+IGFkZEVycm9yKGNvbXBpbGF0aW9uLCBlcnJvcikpO1xuXG4gICAgICAgIG5nY2NQcm9jZXNzb3IgPSBwcm9jZXNzb3I7XG4gICAgICB9XG5cbiAgICAgIC8vIFNldHVwIGFuZCByZWFkIFR5cGVTY3JpcHQgYW5kIEFuZ3VsYXIgY29tcGlsZXIgY29uZmlndXJhdGlvblxuICAgICAgY29uc3QgeyBjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgZXJyb3JzIH0gPSB0aGlzLmxvYWRDb25maWd1cmF0aW9uKCk7XG5cbiAgICAgIC8vIENyZWF0ZSBkaWFnbm9zdGljcyByZXBvcnRlciBhbmQgcmVwb3J0IGNvbmZpZ3VyYXRpb24gZmlsZSBlcnJvcnNcbiAgICAgIGNvbnN0IGRpYWdub3N0aWNzUmVwb3J0ZXIgPSBjcmVhdGVEaWFnbm9zdGljc1JlcG9ydGVyKGNvbXBpbGF0aW9uLCAoZGlhZ25vc3RpYykgPT5cbiAgICAgICAgdGhpcy5jb21waWxlckNsaS5mb3JtYXREaWFnbm9zdGljcyhbZGlhZ25vc3RpY10pLFxuICAgICAgKTtcbiAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZXJyb3JzKTtcblxuICAgICAgLy8gVXBkYXRlIFR5cGVTY3JpcHQgcGF0aCBtYXBwaW5nIHBsdWdpbiB3aXRoIG5ldyBjb25maWd1cmF0aW9uXG4gICAgICBwYXRoc1BsdWdpbi51cGRhdGUoY29tcGlsZXJPcHRpb25zKTtcblxuICAgICAgLy8gQ3JlYXRlIGEgV2VicGFjay1iYXNlZCBUeXBlU2NyaXB0IGNvbXBpbGVyIGhvc3RcbiAgICAgIGNvbnN0IHN5c3RlbSA9IGNyZWF0ZVdlYnBhY2tTeXN0ZW0oXG4gICAgICAgIC8vIFdlYnBhY2sgbGFja3MgYW4gSW5wdXRGaWxlU3l0ZW0gdHlwZSBkZWZpbml0aW9uIHdpdGggc3luYyBmdW5jdGlvbnNcbiAgICAgICAgY29tcGlsZXIuaW5wdXRGaWxlU3lzdGVtIGFzIElucHV0RmlsZVN5c3RlbVN5bmMsXG4gICAgICAgIG5vcm1hbGl6ZVBhdGgoY29tcGlsZXIuY29udGV4dCksXG4gICAgICApO1xuICAgICAgY29uc3QgaG9zdCA9IHRzLmNyZWF0ZUluY3JlbWVudGFsQ29tcGlsZXJIb3N0KGNvbXBpbGVyT3B0aW9ucywgc3lzdGVtKTtcblxuICAgICAgLy8gU2V0dXAgc291cmNlIGZpbGUgY2FjaGluZyBhbmQgcmV1c2UgY2FjaGUgZnJvbSBwcmV2aW91cyBjb21waWxhdGlvbiBpZiBwcmVzZW50XG4gICAgICBsZXQgY2FjaGUgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZTtcbiAgICAgIGxldCBjaGFuZ2VkRmlsZXM7XG4gICAgICBpZiAoY2FjaGUpIHtcbiAgICAgICAgY2hhbmdlZEZpbGVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgICAgIGZvciAoY29uc3QgY2hhbmdlZEZpbGUgb2YgWy4uLmNvbXBpbGVyLm1vZGlmaWVkRmlsZXMsIC4uLmNvbXBpbGVyLnJlbW92ZWRGaWxlc10pIHtcbiAgICAgICAgICBjb25zdCBub3JtYWxpemVkQ2hhbmdlZEZpbGUgPSBub3JtYWxpemVQYXRoKGNoYW5nZWRGaWxlKTtcbiAgICAgICAgICAvLyBJbnZhbGlkYXRlIGZpbGUgZGVwZW5kZW5jaWVzXG4gICAgICAgICAgdGhpcy5maWxlRGVwZW5kZW5jaWVzLmRlbGV0ZShub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgICAgIC8vIEludmFsaWRhdGUgZXhpc3RpbmcgY2FjaGVcbiAgICAgICAgICBjYWNoZS5pbnZhbGlkYXRlKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG5cbiAgICAgICAgICBjaGFuZ2VkRmlsZXMuYWRkKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIEluaXRpYWxpemUgYSBuZXcgY2FjaGVcbiAgICAgICAgY2FjaGUgPSBuZXcgU291cmNlRmlsZUNhY2hlKCk7XG4gICAgICAgIC8vIE9ubHkgc3RvcmUgY2FjaGUgaWYgaW4gd2F0Y2ggbW9kZVxuICAgICAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZSA9IGNhY2hlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBhdWdtZW50SG9zdFdpdGhDYWNoaW5nKGhvc3QsIGNhY2hlKTtcblxuICAgICAgY29uc3QgbW9kdWxlUmVzb2x1dGlvbkNhY2hlID0gdHMuY3JlYXRlTW9kdWxlUmVzb2x1dGlvbkNhY2hlKFxuICAgICAgICBob3N0LmdldEN1cnJlbnREaXJlY3RvcnkoKSxcbiAgICAgICAgaG9zdC5nZXRDYW5vbmljYWxGaWxlTmFtZS5iaW5kKGhvc3QpLFxuICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICApO1xuXG4gICAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBkZXBlbmRlbmN5IGNvbGxlY3Rpb25cbiAgICAgIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uKGhvc3QsIHRoaXMuZmlsZURlcGVuZGVuY2llcywgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcblxuICAgICAgLy8gU2V0dXAgb24gZGVtYW5kIG5nY2NcbiAgICAgIGF1Z21lbnRIb3N0V2l0aE5nY2MoaG9zdCwgbmdjY1Byb2Nlc3NvciwgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcblxuICAgICAgLy8gU2V0dXAgcmVzb3VyY2UgbG9hZGluZ1xuICAgICAgcmVzb3VyY2VMb2FkZXIudXBkYXRlKGNvbXBpbGF0aW9uLCBjaGFuZ2VkRmlsZXMpO1xuICAgICAgYXVnbWVudEhvc3RXaXRoUmVzb3VyY2VzKGhvc3QsIHJlc291cmNlTG9hZGVyLCB7XG4gICAgICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZzogdGhpcy5wbHVnaW5PcHRpb25zLmRpcmVjdFRlbXBsYXRlTG9hZGluZyxcbiAgICAgICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uOiB0aGlzLnBsdWdpbk9wdGlvbnMuaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGFkanVzdG1lbnQgb3B0aW9uc1xuICAgICAgYXVnbWVudEhvc3RXaXRoUmVwbGFjZW1lbnRzKGhvc3QsIHRoaXMucGx1Z2luT3B0aW9ucy5maWxlUmVwbGFjZW1lbnRzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuICAgICAgYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyhob3N0LCB0aGlzLnBsdWdpbk9wdGlvbnMuc3Vic3RpdHV0aW9ucyk7XG5cbiAgICAgIC8vIENyZWF0ZSB0aGUgZmlsZSBlbWl0dGVyIHVzZWQgYnkgdGhlIHdlYnBhY2sgbG9hZGVyXG4gICAgICBjb25zdCB7IGZpbGVFbWl0dGVyLCBidWlsZGVyLCBpbnRlcm5hbEZpbGVzIH0gPSB0aGlzLnBsdWdpbk9wdGlvbnMuaml0TW9kZVxuICAgICAgICA/IHRoaXMudXBkYXRlSml0UHJvZ3JhbShjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgaG9zdCwgZGlhZ25vc3RpY3NSZXBvcnRlcilcbiAgICAgICAgOiB0aGlzLnVwZGF0ZUFvdFByb2dyYW0oXG4gICAgICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICAgICAgICByb290TmFtZXMsXG4gICAgICAgICAgICBob3N0LFxuICAgICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgICAgICAgICAgIHJlc291cmNlTG9hZGVyLFxuICAgICAgICAgICk7XG5cbiAgICAgIC8vIFNldCBvZiBmaWxlcyB1c2VkIGR1cmluZyB0aGUgdW51c2VkIFR5cGVTY3JpcHQgZmlsZSBhbmFseXNpc1xuICAgICAgY29uc3QgY3VycmVudFVudXNlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gICAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICAgIGlmIChpbnRlcm5hbEZpbGVzPy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEVuc3VyZSBhbGwgcHJvZ3JhbSBmaWxlcyBhcmUgY29uc2lkZXJlZCBwYXJ0IG9mIHRoZSBjb21waWxhdGlvbiBhbmQgd2lsbCBiZSB3YXRjaGVkLlxuICAgICAgICAvLyBXZWJwYWNrIGRvZXMgbm90IG5vcm1hbGl6ZSBwYXRocy4gVGhlcmVmb3JlLCB3ZSBuZWVkIHRvIG5vcm1hbGl6ZSB0aGUgcGF0aCB3aXRoIEZTIHNlcGVyYXRvcnMuXG4gICAgICAgIGNvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMuYWRkKGV4dGVybmFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG5cbiAgICAgICAgLy8gQWRkIGFsbCBub24tZGVjbGFyYXRpb24gZmlsZXMgdG8gdGhlIGluaXRpYWwgc2V0IG9mIHVudXNlZCBmaWxlcy4gVGhlIHNldCB3aWxsIGJlXG4gICAgICAgIC8vIGFuYWx5emVkIGFuZCBwcnVuZWQgYWZ0ZXIgYWxsIFdlYnBhY2sgbW9kdWxlcyBhcmUgZmluaXNoZWQgYnVpbGRpbmcuXG4gICAgICAgIGlmICghc291cmNlRmlsZS5pc0RlY2xhcmF0aW9uRmlsZSkge1xuICAgICAgICAgIGN1cnJlbnRVbnVzZWQuYWRkKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbXBpbGF0aW9uLmhvb2tzLmZpbmlzaE1vZHVsZXMudGFwUHJvbWlzZShQTFVHSU5fTkFNRSwgYXN5bmMgKG1vZHVsZXMpID0+IHtcbiAgICAgICAgLy8gUmVidWlsZCBhbnkgcmVtYWluaW5nIEFPVCByZXF1aXJlZCBtb2R1bGVzXG4gICAgICAgIGF3YWl0IHRoaXMucmVidWlsZFJlcXVpcmVkRmlsZXMobW9kdWxlcywgY29tcGlsYXRpb24sIGZpbGVFbWl0dGVyKTtcblxuICAgICAgICAvLyBDbGVhciBvdXQgdGhlIFdlYnBhY2sgY29tcGlsYXRpb24gdG8gYXZvaWQgYW4gZXh0cmEgcmV0YWluaW5nIHJlZmVyZW5jZVxuICAgICAgICByZXNvdXJjZUxvYWRlcj8uY2xlYXJQYXJlbnRDb21waWxhdGlvbigpO1xuXG4gICAgICAgIC8vIEFuYWx5emUgcHJvZ3JhbSBmb3IgdW51c2VkIGZpbGVzXG4gICAgICAgIGlmIChjb21waWxhdGlvbi5lcnJvcnMubGVuZ3RoID4gMCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3Qgd2VicGFja01vZHVsZSBvZiBtb2R1bGVzKSB7XG4gICAgICAgICAgY29uc3QgcmVzb3VyY2UgPSAod2VicGFja01vZHVsZSBhcyBOb3JtYWxNb2R1bGUpLnJlc291cmNlO1xuICAgICAgICAgIGlmIChyZXNvdXJjZSkge1xuICAgICAgICAgICAgdGhpcy5tYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZVBhdGgocmVzb3VyY2UpLCBjdXJyZW50VW51c2VkKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHVudXNlZCBvZiBjdXJyZW50VW51c2VkKSB7XG4gICAgICAgICAgaWYgKHByZXZpb3VzVW51c2VkICYmIHByZXZpb3VzVW51c2VkLmhhcyh1bnVzZWQpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYWRkV2FybmluZyhcbiAgICAgICAgICAgIGNvbXBpbGF0aW9uLFxuICAgICAgICAgICAgYCR7dW51c2VkfSBpcyBwYXJ0IG9mIHRoZSBUeXBlU2NyaXB0IGNvbXBpbGF0aW9uIGJ1dCBpdCdzIHVudXNlZC5cXG5gICtcbiAgICAgICAgICAgICAgYEFkZCBvbmx5IGVudHJ5IHBvaW50cyB0byB0aGUgJ2ZpbGVzJyBvciAnaW5jbHVkZScgcHJvcGVydGllcyBpbiB5b3VyIHRzY29uZmlnLmAsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwcmV2aW91c1VudXNlZCA9IGN1cnJlbnRVbnVzZWQ7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3RvcmUgZmlsZSBlbWl0dGVyIGZvciBsb2FkZXIgdXNhZ2VcbiAgICAgIGVtaXRSZWdpc3RyYXRpb24udXBkYXRlKGZpbGVFbWl0dGVyKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVnaXN0ZXJXaXRoQ29tcGlsYXRpb24oY29tcGlsYXRpb246IENvbXBpbGF0aW9uKSB7XG4gICAgbGV0IGZpbGVFbWl0dGVycyA9IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLmdldChjb21waWxhdGlvbik7XG4gICAgaWYgKCFmaWxlRW1pdHRlcnMpIHtcbiAgICAgIGZpbGVFbWl0dGVycyA9IG5ldyBGaWxlRW1pdHRlckNvbGxlY3Rpb24oKTtcbiAgICAgIGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzLnNldChjb21waWxhdGlvbiwgZmlsZUVtaXR0ZXJzKTtcbiAgICAgIGNvbXBpbGF0aW9uLmNvbXBpbGVyLndlYnBhY2suTm9ybWFsTW9kdWxlLmdldENvbXBpbGF0aW9uSG9va3MoY29tcGlsYXRpb24pLmxvYWRlci50YXAoXG4gICAgICAgIFBMVUdJTl9OQU1FLFxuICAgICAgICAobG9hZGVyQ29udGV4dDogeyBbQW5ndWxhclBsdWdpblN5bWJvbF0/OiBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSkgPT4ge1xuICAgICAgICAgIGxvYWRlckNvbnRleHRbQW5ndWxhclBsdWdpblN5bWJvbF0gPSBmaWxlRW1pdHRlcnM7XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH1cbiAgICBjb25zdCBlbWl0UmVnaXN0cmF0aW9uID0gZmlsZUVtaXR0ZXJzLnJlZ2lzdGVyKCk7XG5cbiAgICByZXR1cm4gZW1pdFJlZ2lzdHJhdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgbWFya1Jlc291cmNlVXNlZChub3JtYWxpemVkUmVzb3VyY2VQYXRoOiBzdHJpbmcsIGN1cnJlbnRVbnVzZWQ6IFNldDxzdHJpbmc+KTogdm9pZCB7XG4gICAgaWYgKCFjdXJyZW50VW51c2VkLmhhcyhub3JtYWxpemVkUmVzb3VyY2VQYXRoKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGN1cnJlbnRVbnVzZWQuZGVsZXRlKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpO1xuICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQobm9ybWFsaXplZFJlc291cmNlUGF0aCk7XG4gICAgaWYgKCFkZXBlbmRlbmNpZXMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBkZXBlbmRlbmN5IG9mIGRlcGVuZGVuY2llcykge1xuICAgICAgdGhpcy5tYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZVBhdGgoZGVwZW5kZW5jeSksIGN1cnJlbnRVbnVzZWQpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVidWlsZFJlcXVpcmVkRmlsZXMoXG4gICAgbW9kdWxlczogSXRlcmFibGU8TW9kdWxlPixcbiAgICBjb21waWxhdGlvbjogQ29tcGlsYXRpb24sXG4gICAgZmlsZUVtaXR0ZXI6IEZpbGVFbWl0dGVyLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LnNpemUgPT09IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlc1RvUmVidWlsZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgcmVxdWlyZWRGaWxlIG9mIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdCkge1xuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0RmlsZUVtaXRIaXN0b3J5KHJlcXVpcmVkRmlsZSk7XG4gICAgICBpZiAoaGlzdG9yeSkge1xuICAgICAgICBjb25zdCBlbWl0UmVzdWx0ID0gYXdhaXQgZmlsZUVtaXR0ZXIocmVxdWlyZWRGaWxlKTtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGVtaXRSZXN1bHQ/LmNvbnRlbnQgPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIGhpc3RvcnkubGVuZ3RoICE9PSBlbWl0UmVzdWx0LmNvbnRlbnQubGVuZ3RoIHx8XG4gICAgICAgICAgZW1pdFJlc3VsdC5oYXNoID09PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICBCdWZmZXIuY29tcGFyZShoaXN0b3J5Lmhhc2gsIGVtaXRSZXN1bHQuaGFzaCkgIT09IDBcbiAgICAgICAgKSB7XG4gICAgICAgICAgLy8gTmV3IGVtaXQgcmVzdWx0IGlzIGRpZmZlcmVudCBzbyByZWJ1aWxkIHVzaW5nIG5ldyBlbWl0IHJlc3VsdFxuICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLnNldChyZXF1aXJlZEZpbGUsIGVtaXRSZXN1bHQpO1xuICAgICAgICAgIGZpbGVzVG9SZWJ1aWxkLmFkZChyZXF1aXJlZEZpbGUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBObyBlbWl0IGhpc3Rvcnkgc28gcmVidWlsZFxuICAgICAgICBmaWxlc1RvUmVidWlsZC5hZGQocmVxdWlyZWRGaWxlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmlsZXNUb1JlYnVpbGQuc2l6ZSA+IDApIHtcbiAgICAgIGNvbnN0IHJlYnVpbGQgPSAod2VicGFja01vZHVsZTogTW9kdWxlKSA9PlxuICAgICAgICBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4gY29tcGlsYXRpb24ucmVidWlsZE1vZHVsZSh3ZWJwYWNrTW9kdWxlLCAoKSA9PiByZXNvbHZlKCkpKTtcblxuICAgICAgY29uc3QgbW9kdWxlc1RvUmVidWlsZCA9IFtdO1xuICAgICAgZm9yIChjb25zdCB3ZWJwYWNrTW9kdWxlIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgY29uc3QgcmVzb3VyY2UgPSAod2VicGFja01vZHVsZSBhcyBOb3JtYWxNb2R1bGUpLnJlc291cmNlO1xuICAgICAgICBpZiAocmVzb3VyY2UgJiYgZmlsZXNUb1JlYnVpbGQuaGFzKG5vcm1hbGl6ZVBhdGgocmVzb3VyY2UpKSkge1xuICAgICAgICAgIG1vZHVsZXNUb1JlYnVpbGQucHVzaCh3ZWJwYWNrTW9kdWxlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwobW9kdWxlc1RvUmVidWlsZC5tYXAoKHdlYnBhY2tNb2R1bGUpID0+IHJlYnVpbGQod2VicGFja01vZHVsZSkpKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcbiAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5jbGVhcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBsb2FkQ29uZmlndXJhdGlvbigpIHtcbiAgICBjb25zdCB7XG4gICAgICBvcHRpb25zOiBjb21waWxlck9wdGlvbnMsXG4gICAgICByb290TmFtZXMsXG4gICAgICBlcnJvcnMsXG4gICAgfSA9IHRoaXMuY29tcGlsZXJDbGkucmVhZENvbmZpZ3VyYXRpb24oXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMudHNjb25maWcsXG4gICAgICB0aGlzLnBsdWdpbk9wdGlvbnMuY29tcGlsZXJPcHRpb25zLFxuICAgICk7XG4gICAgY29tcGlsZXJPcHRpb25zLmVuYWJsZUl2eSA9IHRydWU7XG4gICAgY29tcGlsZXJPcHRpb25zLm5vRW1pdE9uRXJyb3IgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMuc3VwcHJlc3NPdXRwdXRQYXRoQ2hlY2sgPSB0cnVlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5vdXREaXIgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZXMgPSBjb21waWxlck9wdGlvbnMuc291cmNlTWFwO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VNYXAgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMubWFwUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuc291cmNlUm9vdCA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuYWxsb3dFbXB0eUNvZGVnZW5GaWxlcyA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5hbm5vdGF0aW9uc0FzID0gJ2RlY29yYXRvcnMnO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5lbmFibGVSZXNvdXJjZUlubGluaW5nID0gZmFsc2U7XG5cbiAgICByZXR1cm4geyBjb21waWxlck9wdGlvbnMsIHJvb3ROYW1lcywgZXJyb3JzIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUFvdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgICByZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyLFxuICApIHtcbiAgICAvLyBDcmVhdGUgdGhlIEFuZ3VsYXIgc3BlY2lmaWMgcHJvZ3JhbSB0aGF0IGNvbnRhaW5zIHRoZSBBbmd1bGFyIGNvbXBpbGVyXG4gICAgY29uc3QgYW5ndWxhclByb2dyYW0gPSBuZXcgdGhpcy5jb21waWxlckNsaS5OZ3RzY1Byb2dyYW0oXG4gICAgICByb290TmFtZXMsXG4gICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICBob3N0LFxuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtLFxuICAgICk7XG4gICAgY29uc3QgYW5ndWxhckNvbXBpbGVyID0gYW5ndWxhclByb2dyYW0uY29tcGlsZXI7XG5cbiAgICAvLyBUaGUgYGlnbm9yZUZvckVtaXRgIHJldHVybiB2YWx1ZSBjYW4gYmUgc2FmZWx5IGlnbm9yZWQgd2hlbiBlbWl0dGluZy4gT25seSBmaWxlc1xuICAgIC8vIHRoYXQgd2lsbCBiZSBidW5kbGVkIChyZXF1ZXN0ZWQgYnkgV2VicGFjaykgd2lsbCBiZSBlbWl0dGVkLiBDb21iaW5lZCB3aXRoIFR5cGVTY3JpcHQnc1xuICAgIC8vIGVsaWRpbmcgb2YgdHlwZSBvbmx5IGltcG9ydHMsIHRoaXMgd2lsbCBjYXVzZSB0eXBlIG9ubHkgZmlsZXMgdG8gYmUgYXV0b21hdGljYWxseSBpZ25vcmVkLlxuICAgIC8vIEludGVybmFsIEFuZ3VsYXIgdHlwZSBjaGVjayBmaWxlcyBhcmUgYWxzbyBub3QgcmVzb2x2YWJsZSBieSB0aGUgYnVuZGxlci4gRXZlbiBpZiB0aGV5XG4gICAgLy8gd2VyZSBzb21laG93IGVycmFudGx5IGltcG9ydGVkLCB0aGUgYnVuZGxlciB3b3VsZCBlcnJvciBiZWZvcmUgYW4gZW1pdCB3YXMgYXR0ZW1wdGVkLlxuICAgIC8vIERpYWdub3N0aWNzIGFyZSBzdGlsbCBjb2xsZWN0ZWQgZm9yIGFsbCBmaWxlcyB3aGljaCByZXF1aXJlcyB1c2luZyBgaWdub3JlRm9yRGlhZ25vc3RpY3NgLlxuICAgIGNvbnN0IHsgaWdub3JlRm9yRGlhZ25vc3RpY3MsIGlnbm9yZUZvckVtaXQgfSA9IGFuZ3VsYXJDb21waWxlcjtcblxuICAgIC8vIFNvdXJjZUZpbGUgdmVyc2lvbnMgYXJlIHJlcXVpcmVkIGZvciBidWlsZGVyIHByb2dyYW1zLlxuICAgIC8vIFRoZSB3cmFwcGVkIGhvc3QgaW5zaWRlIE5ndHNjUHJvZ3JhbSBhZGRzIGFkZGl0aW9uYWwgZmlsZXMgdGhhdCB3aWxsIG5vdCBoYXZlIHZlcnNpb25zLlxuICAgIGNvbnN0IHR5cGVTY3JpcHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW0uZ2V0VHNQcm9ncmFtKCk7XG4gICAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyh0eXBlU2NyaXB0UHJvZ3JhbSk7XG5cbiAgICBsZXQgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0gfCB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgYnVpbGRlciA9IHRoaXMuYnVpbGRlciA9IHRzLmNyZWF0ZUVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW0oXG4gICAgICAgIHR5cGVTY3JpcHRQcm9ncmFtLFxuICAgICAgICBob3N0LFxuICAgICAgICB0aGlzLmJ1aWxkZXIsXG4gICAgICApO1xuICAgICAgdGhpcy5uZ3RzY05leHRQcm9ncmFtID0gYW5ndWxhclByb2dyYW07XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIodHlwZVNjcmlwdFByb2dyYW0sIGhvc3QpO1xuICAgIH1cblxuICAgIC8vIFVwZGF0ZSBzZW1hbnRpYyBkaWFnbm9zdGljcyBjYWNoZVxuICAgIGNvbnN0IGFmZmVjdGVkRmlsZXMgPSBuZXcgU2V0PHRzLlNvdXJjZUZpbGU+KCk7XG5cbiAgICAvLyBBbmFseXplIGFmZmVjdGVkIGZpbGVzIHdoZW4gaW4gd2F0Y2ggbW9kZSBmb3IgaW5jcmVtZW50YWwgdHlwZSBjaGVja2luZ1xuICAgIGlmICgnZ2V0U2VtYW50aWNEaWFnbm9zdGljc09mTmV4dEFmZmVjdGVkRmlsZScgaW4gYnVpbGRlcikge1xuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIG5vLWNvbnN0YW50LWNvbmRpdGlvblxuICAgICAgd2hpbGUgKHRydWUpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzT2ZOZXh0QWZmZWN0ZWRGaWxlKHVuZGVmaW5lZCwgKHNvdXJjZUZpbGUpID0+IHtcbiAgICAgICAgICAvLyBJZiB0aGUgYWZmZWN0ZWQgZmlsZSBpcyBhIFRUQyBzaGltLCBhZGQgdGhlIHNoaW0ncyBvcmlnaW5hbCBzb3VyY2UgZmlsZS5cbiAgICAgICAgICAvLyBUaGlzIGVuc3VyZXMgdGhhdCBjaGFuZ2VzIHRoYXQgYWZmZWN0IFRUQyBhcmUgdHlwZWNoZWNrZWQgZXZlbiB3aGVuIHRoZSBjaGFuZ2VzXG4gICAgICAgICAgLy8gYXJlIG90aGVyd2lzZSB1bnJlbGF0ZWQgZnJvbSBhIFRTIHBlcnNwZWN0aXZlIGFuZCBkbyBub3QgcmVzdWx0IGluIEl2eSBjb2RlZ2VuIGNoYW5nZXMuXG4gICAgICAgICAgLy8gRm9yIGV4YW1wbGUsIGNoYW5naW5nIEBJbnB1dCBwcm9wZXJ0eSB0eXBlcyBvZiBhIGRpcmVjdGl2ZSB1c2VkIGluIGFub3RoZXIgY29tcG9uZW50J3NcbiAgICAgICAgICAvLyB0ZW1wbGF0ZS5cbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICBpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgIHNvdXJjZUZpbGUuZmlsZU5hbWUuZW5kc1dpdGgoJy5uZ3R5cGVjaGVjay50cycpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGZpbGUgbmFtZSBjb252ZXJzaW9uIHJlbGllcyBvbiBpbnRlcm5hbCBjb21waWxlciBsb2dpYyBhbmQgc2hvdWxkIGJlIGNvbnZlcnRlZFxuICAgICAgICAgICAgLy8gdG8gYW4gb2ZmaWNpYWwgbWV0aG9kIHdoZW4gYXZhaWxhYmxlLiAxNSBpcyBsZW5ndGggb2YgYC5uZ3R5cGVjaGVjay50c2BcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsRmlsZW5hbWUgPSBzb3VyY2VGaWxlLmZpbGVOYW1lLnNsaWNlKDAsIC0xNSkgKyAnLnRzJztcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsU291cmNlRmlsZSA9IGJ1aWxkZXIuZ2V0U291cmNlRmlsZShvcmlnaW5hbEZpbGVuYW1lKTtcbiAgICAgICAgICAgIGlmIChvcmlnaW5hbFNvdXJjZUZpbGUpIHtcbiAgICAgICAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQob3JpZ2luYWxTb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQocmVzdWx0LmFmZmVjdGVkIGFzIHRzLlNvdXJjZUZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENvbGxlY3QgcHJvZ3JhbSBsZXZlbCBkaWFnbm9zdGljc1xuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYW5ndWxhckNvbXBpbGVyLmdldE9wdGlvbkRpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldE9wdGlvbnNEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRHbG9iYWxEaWFnbm9zdGljcygpLFxuICAgIF07XG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcihkaWFnbm9zdGljcyk7XG5cbiAgICAvLyBDb2xsZWN0IHNvdXJjZSBmaWxlIHNwZWNpZmljIGRpYWdub3N0aWNzXG4gICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgaWYgKCFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKHNvdXJjZUZpbGUpKTtcbiAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihidWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3Moc291cmNlRmlsZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUFvdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLnBsdWdpbk9wdGlvbnMpO1xuXG4gICAgY29uc3QgZ2V0RGVwZW5kZW5jaWVzID0gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCByZXNvdXJjZVBhdGggb2YgYW5ndWxhckNvbXBpbGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGRlcGVuZGVuY2llcy5wdXNoKFxuICAgICAgICAgIHJlc291cmNlUGF0aCxcbiAgICAgICAgICAvLyBSZXRyaWV2ZSBhbGwgZGVwZW5kZW5jaWVzIG9mIHRoZSByZXNvdXJjZSAoc3R5bGVzaGVldCBpbXBvcnRzLCBldGMuKVxuICAgICAgICAgIC4uLnJlc291cmNlTG9hZGVyLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKHJlc291cmNlUGF0aCksXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkZXBlbmRlbmNpZXM7XG4gICAgfTtcblxuICAgIC8vIFJlcXVpcmVkIHRvIHN1cHBvcnQgYXN5bmNocm9ub3VzIHJlc291cmNlIGxvYWRpbmdcbiAgICAvLyBNdXN0IGJlIGRvbmUgYmVmb3JlIGNyZWF0aW5nIHRyYW5zZm9ybWVycyBvciBnZXR0aW5nIHRlbXBsYXRlIGRpYWdub3N0aWNzXG4gICAgY29uc3QgcGVuZGluZ0FuYWx5c2lzID0gYW5ndWxhckNvbXBpbGVyXG4gICAgICAuYW5hbHl6ZUFzeW5jKClcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmNsZWFyKCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgICAgIGlmIChzb3VyY2VGaWxlLmlzRGVjbGFyYXRpb25GaWxlKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBDb2xsZWN0IHNvdXJjZXMgdGhhdCBhcmUgcmVxdWlyZWQgdG8gYmUgZW1pdHRlZFxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICFpZ25vcmVGb3JFbWl0Lmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgIWFuZ3VsYXJDb21waWxlci5pbmNyZW1lbnRhbERyaXZlci5zYWZlVG9Ta2lwRW1pdChzb3VyY2VGaWxlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmFkZChub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcblxuICAgICAgICAgICAgLy8gSWYgcmVxdWlyZWQgdG8gZW1pdCwgZGlhZ25vc3RpY3MgbWF5IGhhdmUgYWxzbyBjaGFuZ2VkXG4gICAgICAgICAgICBpZiAoIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKFxuICAgICAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgJiZcbiAgICAgICAgICAgICFhZmZlY3RlZEZpbGVzLmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgLy8gVXNlIGNhY2hlZCBBbmd1bGFyIGRpYWdub3N0aWNzIGZvciB1bmNoYW5nZWQgYW5kIHVuYWZmZWN0ZWQgZmlsZXNcbiAgICAgICAgICAgIGNvbnN0IGFuZ3VsYXJEaWFnbm9zdGljcyA9IHRoaXMuc291cmNlRmlsZUNhY2hlLmdldEFuZ3VsYXJEaWFnbm9zdGljcyhzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIGlmIChhbmd1bGFyRGlhZ25vc3RpY3MpIHtcbiAgICAgICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIENvbGxlY3QgbmV3IEFuZ3VsYXIgZGlhZ25vc3RpY3MgZm9yIGZpbGVzIGFmZmVjdGVkIGJ5IGNoYW5nZXNcbiAgICAgICAgY29uc3QgT3B0aW1pemVGb3IgPSB0aGlzLmNvbXBpbGVyQ2xpLk9wdGltaXplRm9yO1xuICAgICAgICBjb25zdCBvcHRpbWl6ZURpYWdub3N0aWNzRm9yID1cbiAgICAgICAgICBhZmZlY3RlZEZpbGVzLnNpemUgPD0gRElBR05PU1RJQ1NfQUZGRUNURURfVEhSRVNIT0xEXG4gICAgICAgICAgICA/IE9wdGltaXplRm9yLlNpbmdsZUZpbGVcbiAgICAgICAgICAgIDogT3B0aW1pemVGb3IuV2hvbGVQcm9ncmFtO1xuICAgICAgICBmb3IgKGNvbnN0IGFmZmVjdGVkRmlsZSBvZiBhZmZlY3RlZEZpbGVzKSB7XG4gICAgICAgICAgY29uc3QgYW5ndWxhckRpYWdub3N0aWNzID0gYW5ndWxhckNvbXBpbGVyLmdldERpYWdub3N0aWNzRm9yRmlsZShcbiAgICAgICAgICAgIGFmZmVjdGVkRmlsZSxcbiAgICAgICAgICAgIG9wdGltaXplRGlhZ25vc3RpY3NGb3IsXG4gICAgICAgICAgKTtcbiAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGU/LnVwZGF0ZUFuZ3VsYXJEaWFnbm9zdGljcyhhZmZlY3RlZEZpbGUsIGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGVtaXR0ZXI6IHRoaXMuY3JlYXRlRmlsZUVtaXR0ZXIoXG4gICAgICAgICAgICBidWlsZGVyLFxuICAgICAgICAgICAgbWVyZ2VUcmFuc2Zvcm1lcnMoYW5ndWxhckNvbXBpbGVyLnByZXBhcmVFbWl0KCkudHJhbnNmb3JtZXJzLCB0cmFuc2Zvcm1lcnMpLFxuICAgICAgICAgICAgZ2V0RGVwZW5kZW5jaWVzLFxuICAgICAgICAgICAgKHNvdXJjZUZpbGUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmRlbGV0ZShub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcbiAgICAgICAgICAgICAgYW5ndWxhckNvbXBpbGVyLmluY3JlbWVudGFsRHJpdmVyLnJlY29yZFN1Y2Nlc3NmdWxFbWl0KHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICApLFxuICAgICAgICB9O1xuICAgICAgfSlcbiAgICAgIC5jYXRjaCgoZXJyKSA9PiAoeyBlcnJvck1lc3NhZ2U6IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBgJHtlcnJ9YCB9KSk7XG5cbiAgICBjb25zdCBhbmFseXppbmdGaWxlRW1pdHRlcjogRmlsZUVtaXR0ZXIgPSBhc3luYyAoZmlsZSkgPT4ge1xuICAgICAgY29uc3QgYW5hbHlzaXMgPSBhd2FpdCBwZW5kaW5nQW5hbHlzaXM7XG5cbiAgICAgIGlmICgnZXJyb3JNZXNzYWdlJyBpbiBhbmFseXNpcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYW5hbHlzaXMuZXJyb3JNZXNzYWdlKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFuYWx5c2lzLmVtaXR0ZXIoZmlsZSk7XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlRW1pdHRlcjogYW5hbHl6aW5nRmlsZUVtaXR0ZXIsXG4gICAgICBidWlsZGVyLFxuICAgICAgaW50ZXJuYWxGaWxlczogaWdub3JlRm9yRW1pdCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVKaXRQcm9ncmFtKFxuICAgIGNvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIHJvb3ROYW1lczogcmVhZG9ubHkgc3RyaW5nW10sXG4gICAgaG9zdDogQ29tcGlsZXJIb3N0LFxuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXI6IERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICkge1xuICAgIGxldCBidWlsZGVyO1xuICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgYnVpbGRlciA9IHRoaXMuYnVpbGRlciA9IHRzLmNyZWF0ZUVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW0oXG4gICAgICAgIHJvb3ROYW1lcyxcbiAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgICBob3N0LFxuICAgICAgICB0aGlzLmJ1aWxkZXIsXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXaGVuIG5vdCBpbiB3YXRjaCBtb2RlLCB0aGUgc3RhcnR1cCBjb3N0IG9mIHRoZSBpbmNyZW1lbnRhbCBhbmFseXNpcyBjYW4gYmUgYXZvaWRlZCBieVxuICAgICAgLy8gdXNpbmcgYW4gYWJzdHJhY3QgYnVpbGRlciB0aGF0IG9ubHkgd3JhcHMgYSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gICAgICBidWlsZGVyID0gdHMuY3JlYXRlQWJzdHJhY3RCdWlsZGVyKHJvb3ROYW1lcywgY29tcGlsZXJPcHRpb25zLCBob3N0KTtcbiAgICB9XG5cbiAgICBjb25zdCBkaWFnbm9zdGljcyA9IFtcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldEdsb2JhbERpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldFN5bnRhY3RpY0RpYWdub3N0aWNzKCksXG4gICAgICAvLyBHYXRoZXIgaW5jcmVtZW50YWwgc2VtYW50aWMgZGlhZ25vc3RpY3NcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljcygpLFxuICAgIF07XG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcihkaWFnbm9zdGljcyk7XG5cbiAgICBjb25zdCB0cmFuc2Zvcm1lcnMgPSBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMoYnVpbGRlciwgdGhpcy5jb21waWxlckNsaSwgdGhpcy5wbHVnaW5PcHRpb25zKTtcblxuICAgIHJldHVybiB7XG4gICAgICBmaWxlRW1pdHRlcjogdGhpcy5jcmVhdGVGaWxlRW1pdHRlcihidWlsZGVyLCB0cmFuc2Zvcm1lcnMsICgpID0+IFtdKSxcbiAgICAgIGJ1aWxkZXIsXG4gICAgICBpbnRlcm5hbEZpbGVzOiB1bmRlZmluZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlRmlsZUVtaXR0ZXIoXG4gICAgcHJvZ3JhbTogdHMuQnVpbGRlclByb2dyYW0sXG4gICAgdHJhbnNmb3JtZXJzOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMgPSB7fSxcbiAgICBnZXRFeHRyYURlcGVuZGVuY2llczogKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IEl0ZXJhYmxlPHN0cmluZz4sXG4gICAgb25BZnRlckVtaXQ/OiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4gdm9pZCxcbiAgKTogRmlsZUVtaXR0ZXIge1xuICAgIHJldHVybiBhc3luYyAoZmlsZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlUGF0aCA9IG5vcm1hbGl6ZVBhdGgoZmlsZSk7XG4gICAgICBpZiAodGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuaGFzKGZpbGVQYXRoKSkge1xuICAgICAgICByZXR1cm4gdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuZ2V0KGZpbGVQYXRoKTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlRmlsZSA9IHByb2dyYW0uZ2V0U291cmNlRmlsZShmaWxlUGF0aCk7XG4gICAgICBpZiAoIXNvdXJjZUZpbGUpIHtcbiAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgbGV0IGNvbnRlbnQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGxldCBtYXA6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIHByb2dyYW0uZW1pdChcbiAgICAgICAgc291cmNlRmlsZSxcbiAgICAgICAgKGZpbGVuYW1lLCBkYXRhKSA9PiB7XG4gICAgICAgICAgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKCcubWFwJykpIHtcbiAgICAgICAgICAgIG1hcCA9IGRhdGE7XG4gICAgICAgICAgfSBlbHNlIGlmIChmaWxlbmFtZS5lbmRzV2l0aCgnLmpzJykpIHtcbiAgICAgICAgICAgIGNvbnRlbnQgPSBkYXRhO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHRyYW5zZm9ybWVycyxcbiAgICAgICk7XG5cbiAgICAgIG9uQWZ0ZXJFbWl0Py4oc291cmNlRmlsZSk7XG5cbiAgICAgIC8vIENhcHR1cmUgZW1pdCBoaXN0b3J5IGluZm8gZm9yIEFuZ3VsYXIgcmVidWlsZCBhbmFseXNpc1xuICAgICAgY29uc3QgaGFzaCA9IGNvbnRlbnQgPyAoYXdhaXQgdGhpcy5hZGRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGgsIGNvbnRlbnQpKS5oYXNoIDogdW5kZWZpbmVkO1xuXG4gICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBbXG4gICAgICAgIC4uLih0aGlzLmZpbGVEZXBlbmRlbmNpZXMuZ2V0KGZpbGVQYXRoKSB8fCBbXSksXG4gICAgICAgIC4uLmdldEV4dHJhRGVwZW5kZW5jaWVzKHNvdXJjZUZpbGUpLFxuICAgICAgXS5tYXAoZXh0ZXJuYWxpemVQYXRoKTtcblxuICAgICAgcmV0dXJuIHsgY29udGVudCwgbWFwLCBkZXBlbmRlbmNpZXMsIGhhc2ggfTtcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbml0aWFsaXplQ29tcGlsZXJDbGkoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuY29tcGlsZXJDbGlNb2R1bGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGlzIHVzZXMgYSBkeW5hbWljIGltcG9ydCB0byBsb2FkIGBAYW5ndWxhci9jb21waWxlci1jbGlgIHdoaWNoIG1heSBiZSBFU00uXG4gICAgLy8gQ29tbW9uSlMgY29kZSBjYW4gbG9hZCBFU00gY29kZSB2aWEgYSBkeW5hbWljIGltcG9ydC4gVW5mb3J0dW5hdGVseSwgVHlwZVNjcmlwdFxuICAgIC8vIHdpbGwgY3VycmVudGx5LCB1bmNvbmRpdGlvbmFsbHkgZG93bmxldmVsIGR5bmFtaWMgaW1wb3J0IGludG8gYSByZXF1aXJlIGNhbGwuXG4gICAgLy8gcmVxdWlyZSBjYWxscyBjYW5ub3QgbG9hZCBFU00gY29kZSBhbmQgd2lsbCByZXN1bHQgaW4gYSBydW50aW1lIGVycm9yLiBUbyB3b3JrYXJvdW5kXG4gICAgLy8gdGhpcywgYSBGdW5jdGlvbiBjb25zdHJ1Y3RvciBpcyB1c2VkIHRvIHByZXZlbnQgVHlwZVNjcmlwdCBmcm9tIGNoYW5naW5nIHRoZSBkeW5hbWljIGltcG9ydC5cbiAgICAvLyBPbmNlIFR5cGVTY3JpcHQgcHJvdmlkZXMgc3VwcG9ydCBmb3Iga2VlcGluZyB0aGUgZHluYW1pYyBpbXBvcnQgdGhpcyB3b3JrYXJvdW5kIGNhblxuICAgIC8vIGJlIGRyb3BwZWQuXG4gICAgdGhpcy5jb21waWxlckNsaU1vZHVsZSA9IGF3YWl0IG5ldyBGdW5jdGlvbihgcmV0dXJuIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyk7YCkoKTtcbiAgICB0aGlzLmNvbXBpbGVyTmdjY01vZHVsZSA9IGF3YWl0IG5ldyBGdW5jdGlvbihgcmV0dXJuIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpL25nY2MnKTtgKSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhZGRGaWxlRW1pdEhpc3RvcnkoXG4gICAgZmlsZVBhdGg6IHN0cmluZyxcbiAgICBjb250ZW50OiBzdHJpbmcsXG4gICk6IFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbT4ge1xuICAgIGNvbnN0IGhpc3RvcnlEYXRhOiBGaWxlRW1pdEhpc3RvcnlJdGVtID0ge1xuICAgICAgbGVuZ3RoOiBjb250ZW50Lmxlbmd0aCxcbiAgICAgIGhhc2g6IGNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShjb250ZW50KS5kaWdlc3QoKSxcbiAgICB9O1xuXG4gICAgaWYgKHRoaXMud2VicGFja0NhY2hlKSB7XG4gICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgdGhpcy5nZXRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGgpO1xuICAgICAgaWYgKCFoaXN0b3J5IHx8IEJ1ZmZlci5jb21wYXJlKGhpc3RvcnkuaGFzaCwgaGlzdG9yeURhdGEuaGFzaCkgIT09IDApIHtcbiAgICAgICAgLy8gSGFzaCBkb2Vzbid0IG1hdGNoIG9yIGl0ZW0gZG9lc24ndCBleGlzdC5cbiAgICAgICAgYXdhaXQgdGhpcy53ZWJwYWNrQ2FjaGUuc3RvcmVQcm9taXNlKGZpbGVQYXRoLCBudWxsLCBoaXN0b3J5RGF0YSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgLy8gVGhlIGluIG1lbW9yeSBmaWxlIGVtaXQgaGlzdG9yeSBpcyBvbmx5IHJlcXVpcmVkIGR1cmluZyB3YXRjaCBtb2RlLlxuICAgICAgdGhpcy5maWxlRW1pdEhpc3Rvcnkuc2V0KGZpbGVQYXRoLCBoaXN0b3J5RGF0YSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGhpc3RvcnlEYXRhO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBnZXRGaWxlRW1pdEhpc3RvcnkoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbSB8IHVuZGVmaW5lZD4ge1xuICAgIHJldHVybiB0aGlzLndlYnBhY2tDYWNoZVxuICAgICAgPyB0aGlzLndlYnBhY2tDYWNoZS5nZXRQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0gfCB1bmRlZmluZWQ+KGZpbGVQYXRoLCBudWxsKVxuICAgICAgOiB0aGlzLmZpbGVFbWl0SGlzdG9yeS5nZXQoZmlsZVBhdGgpO1xuICB9XG59XG4iXX0=