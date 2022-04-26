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
    // eslint-disable-next-line max-lines-per-function
    apply(compiler) {
        const { NormalModuleReplacementPlugin, util } = compiler.webpack;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBR0gsbUNBQTBDO0FBQzFDLCtDQUFpQztBQUVqQyxzREFBa0Q7QUFDbEQsa0RBQXdEO0FBQ3hELHdEQUEyRDtBQUMzRCxtQ0FBMEM7QUFDMUMsK0NBS3VCO0FBQ3ZCLGlDQVFnQjtBQUNoQixtQ0FBeUQ7QUFDekQscUNBQW1HO0FBQ25HLHFDQUFvRTtBQUNwRSxxREFBbUc7QUFFbkc7Ozs7R0FJRztBQUNILE1BQU0sOEJBQThCLEdBQUcsQ0FBQyxDQUFDO0FBY3pDLFNBQVMsdUJBQXVCLENBQzlCLFFBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLGtCQUEyRTs7SUFFM0UsTUFBTSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLEdBQUcsUUFBUSxDQUFDO0lBQzlELE1BQU0sVUFBVSxHQUFHLE1BQUEsTUFBQSxNQUFBLGNBQWMsQ0FBQyxPQUFPLDBDQUFFLFVBQVUsMENBQUUsSUFBSSxFQUFFLG1DQUFJLEVBQUUsQ0FBQztJQUVwRSxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxRQUFRLEdBQWEsRUFBRSxDQUFDO0lBQzlCLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtRQUN0RCwwRkFBMEY7UUFDMUYsS0FBSyxFQUFFLEtBQUs7UUFDWixVQUFVLEVBQUUsQ0FBQyxPQUFPLENBQUM7UUFDckIsc0JBQXNCLEVBQUUsSUFBSTtLQUM3QixDQUFDLENBQUM7SUFFSCxnRkFBZ0Y7SUFDaEYsZ0ZBQWdGO0lBQ2hGLDZDQUE2QztJQUM3QyxlQUFNLENBQUMsRUFBRSxDQUFDLGtCQUFr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QUNGO0FBbnFCRCxvREFtcUJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB0eXBlIHsgQ29tcGlsZXJIb3N0LCBDb21waWxlck9wdGlvbnMsIE5ndHNjUHJvZ3JhbSB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBzdHJpY3QgYXMgYXNzZXJ0IH0gZnJvbSAnYXNzZXJ0JztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb21waWxhdGlvbiwgQ29tcGlsZXIsIE1vZHVsZSwgTm9ybWFsTW9kdWxlIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBOZ2NjUHJvY2Vzc29yIH0gZnJvbSAnLi4vbmdjY19wcm9jZXNzb3InO1xuaW1wb3J0IHsgVHlwZVNjcmlwdFBhdGhzUGx1Z2luIH0gZnJvbSAnLi4vcGF0aHMtcGx1Z2luJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4uL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQgeyBTb3VyY2VGaWxlQ2FjaGUgfSBmcm9tICcuL2NhY2hlJztcbmltcG9ydCB7XG4gIERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gIGFkZEVycm9yLFxuICBhZGRXYXJuaW5nLFxuICBjcmVhdGVEaWFnbm9zdGljc1JlcG9ydGVyLFxufSBmcm9tICcuL2RpYWdub3N0aWNzJztcbmltcG9ydCB7XG4gIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcsXG4gIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uLFxuICBhdWdtZW50SG9zdFdpdGhOZ2NjLFxuICBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMsXG4gIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyxcbiAgYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyxcbiAgYXVnbWVudFByb2dyYW1XaXRoVmVyc2lvbmluZyxcbn0gZnJvbSAnLi9ob3N0JztcbmltcG9ydCB7IGV4dGVybmFsaXplUGF0aCwgbm9ybWFsaXplUGF0aCB9IGZyb20gJy4vcGF0aHMnO1xuaW1wb3J0IHsgQW5ndWxhclBsdWdpblN5bWJvbCwgRW1pdEZpbGVSZXN1bHQsIEZpbGVFbWl0dGVyLCBGaWxlRW1pdHRlckNvbGxlY3Rpb24gfSBmcm9tICcuL3N5bWJvbCc7XG5pbXBvcnQgeyBJbnB1dEZpbGVTeXN0ZW1TeW5jLCBjcmVhdGVXZWJwYWNrU3lzdGVtIH0gZnJvbSAnLi9zeXN0ZW0nO1xuaW1wb3J0IHsgY3JlYXRlQW90VHJhbnNmb3JtZXJzLCBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMsIG1lcmdlVHJhbnNmb3JtZXJzIH0gZnJvbSAnLi90cmFuc2Zvcm1hdGlvbic7XG5cbi8qKlxuICogVGhlIHRocmVzaG9sZCB1c2VkIHRvIGRldGVybWluZSB3aGV0aGVyIEFuZ3VsYXIgZmlsZSBkaWFnbm9zdGljcyBzaG91bGQgb3B0aW1pemUgZm9yIGZ1bGwgcHJvZ3JhbXNcbiAqIG9yIHNpbmdsZSBmaWxlcy4gSWYgdGhlIG51bWJlciBvZiBhZmZlY3RlZCBmaWxlcyBmb3IgYSBidWlsZCBpcyBtb3JlIHRoYW4gdGhlIHRocmVzaG9sZCwgZnVsbFxuICogcHJvZ3JhbSBvcHRpbWl6YXRpb24gd2lsbCBiZSB1c2VkLlxuICovXG5jb25zdCBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTEQgPSAxO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucyB7XG4gIHRzY29uZmlnOiBzdHJpbmc7XG4gIGNvbXBpbGVyT3B0aW9ucz86IENvbXBpbGVyT3B0aW9ucztcbiAgZmlsZVJlcGxhY2VtZW50czogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgc3Vic3RpdHV0aW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nOiBib29sZWFuO1xuICBlbWl0Q2xhc3NNZXRhZGF0YTogYm9vbGVhbjtcbiAgZW1pdE5nTW9kdWxlU2NvcGU6IGJvb2xlYW47XG4gIGppdE1vZGU6IGJvb2xlYW47XG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZztcbn1cblxuZnVuY3Rpb24gaW5pdGlhbGl6ZU5nY2NQcm9jZXNzb3IoXG4gIGNvbXBpbGVyOiBDb21waWxlcixcbiAgdHNjb25maWc6IHN0cmluZyxcbiAgY29tcGlsZXJOZ2NjTW9kdWxlOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpIHwgdW5kZWZpbmVkLFxuKTogeyBwcm9jZXNzb3I6IE5nY2NQcm9jZXNzb3I7IGVycm9yczogc3RyaW5nW107IHdhcm5pbmdzOiBzdHJpbmdbXSB9IHtcbiAgY29uc3QgeyBpbnB1dEZpbGVTeXN0ZW0sIG9wdGlvbnM6IHdlYnBhY2tPcHRpb25zIH0gPSBjb21waWxlcjtcbiAgY29uc3QgbWFpbkZpZWxkcyA9IHdlYnBhY2tPcHRpb25zLnJlc29sdmU/Lm1haW5GaWVsZHM/LmZsYXQoKSA/PyBbXTtcblxuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHdhcm5pbmdzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCByZXNvbHZlciA9IGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5nZXQoJ25vcm1hbCcsIHtcbiAgICAvLyBDYWNoaW5nIG11c3QgYmUgZGlzYWJsZWQgYmVjYXVzZSBpdCBjYXVzZXMgdGhlIHJlc29sdmVyIHRvIGJlY29tZSBhc3luYyBhZnRlciBhIHJlYnVpbGRcbiAgICBjYWNoZTogZmFsc2UsXG4gICAgZXh0ZW5zaW9uczogWycuanNvbiddLFxuICAgIHVzZVN5bmNGaWxlU3lzdGVtQ2FsbHM6IHRydWUsXG4gIH0pO1xuXG4gIC8vIFRoZSBjb21waWxlck5nY2NNb2R1bGUgZmllbGQgaXMgZ3VhcmFudGVlZCB0byBiZSBkZWZpbmVkIGR1cmluZyBhIGNvbXBpbGF0aW9uXG4gIC8vIGR1ZSB0byB0aGUgYGJlZm9yZUNvbXBpbGVgIGhvb2suIFVzYWdlIG9mIHRoaXMgcHJvcGVydHkgYWNjZXNzb3IgcHJpb3IgdG8gdGhlXG4gIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICBhc3NlcnQub2soY29tcGlsZXJOZ2NjTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24uYCk7XG5cbiAgY29uc3QgcHJvY2Vzc29yID0gbmV3IE5nY2NQcm9jZXNzb3IoXG4gICAgY29tcGlsZXJOZ2NjTW9kdWxlLFxuICAgIG1haW5GaWVsZHMsXG4gICAgd2FybmluZ3MsXG4gICAgZXJyb3JzLFxuICAgIGNvbXBpbGVyLmNvbnRleHQsXG4gICAgdHNjb25maWcsXG4gICAgaW5wdXRGaWxlU3lzdGVtLFxuICAgIHJlc29sdmVyLFxuICApO1xuXG4gIHJldHVybiB7IHByb2Nlc3NvciwgZXJyb3JzLCB3YXJuaW5ncyB9O1xufVxuXG5jb25zdCBQTFVHSU5fTkFNRSA9ICdhbmd1bGFyLWNvbXBpbGVyJztcbmNvbnN0IGNvbXBpbGF0aW9uRmlsZUVtaXR0ZXJzID0gbmV3IFdlYWtNYXA8Q29tcGlsYXRpb24sIEZpbGVFbWl0dGVyQ29sbGVjdGlvbj4oKTtcblxuaW50ZXJmYWNlIEZpbGVFbWl0SGlzdG9yeUl0ZW0ge1xuICBsZW5ndGg6IG51bWJlcjtcbiAgaGFzaDogVWludDhBcnJheTtcbn1cblxuZXhwb3J0IGNsYXNzIEFuZ3VsYXJXZWJwYWNrUGx1Z2luIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW5PcHRpb25zOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM7XG4gIHByaXZhdGUgY29tcGlsZXJDbGlNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtcbiAgcHJpdmF0ZSBjb21waWxlck5nY2NNb2R1bGU/OiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpO1xuICBwcml2YXRlIHdhdGNoTW9kZT86IGJvb2xlYW47XG4gIHByaXZhdGUgbmd0c2NOZXh0UHJvZ3JhbT86IE5ndHNjUHJvZ3JhbTtcbiAgcHJpdmF0ZSBidWlsZGVyPzogdHMuRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbTtcbiAgcHJpdmF0ZSBzb3VyY2VGaWxlQ2FjaGU/OiBTb3VyY2VGaWxlQ2FjaGU7XG4gIHByaXZhdGUgd2VicGFja0NhY2hlPzogUmV0dXJuVHlwZTxDb21waWxhdGlvblsnZ2V0Q2FjaGUnXT47XG4gIHByaXZhdGUgd2VicGFja0NyZWF0ZUhhc2g/OiBDb21waWxlclsnd2VicGFjayddWyd1dGlsJ11bJ2NyZWF0ZUhhc2gnXTtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRGVwZW5kZW5jaWVzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgRW1pdEZpbGVSZXN1bHQgfCB1bmRlZmluZWQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZUVtaXRIaXN0b3J5ID0gbmV3IE1hcDxzdHJpbmcsIEZpbGVFbWl0SGlzdG9yeUl0ZW0+KCk7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUGFydGlhbDxBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM+ID0ge30pIHtcbiAgICB0aGlzLnBsdWdpbk9wdGlvbnMgPSB7XG4gICAgICBlbWl0Q2xhc3NNZXRhZGF0YTogZmFsc2UsXG4gICAgICBlbWl0TmdNb2R1bGVTY29wZTogZmFsc2UsXG4gICAgICBqaXRNb2RlOiBmYWxzZSxcbiAgICAgIGZpbGVSZXBsYWNlbWVudHM6IHt9LFxuICAgICAgc3Vic3RpdHV0aW9uczoge30sXG4gICAgICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IHRydWUsXG4gICAgICB0c2NvbmZpZzogJ3RzY29uZmlnLmpzb24nLFxuICAgICAgLi4ub3B0aW9ucyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29tcGlsZXJDbGkoKTogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJykge1xuICAgIC8vIFRoZSBjb21waWxlckNsaU1vZHVsZSBmaWVsZCBpcyBndWFyYW50ZWVkIHRvIGJlIGRlZmluZWQgZHVyaW5nIGEgY29tcGlsYXRpb25cbiAgICAvLyBkdWUgdG8gdGhlIGBiZWZvcmVDb21waWxlYCBob29rLiBVc2FnZSBvZiB0aGlzIHByb3BlcnR5IGFjY2Vzc29yIHByaW9yIHRvIHRoZVxuICAgIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICAgIGFzc2VydC5vayh0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScgdXNlZCBwcmlvciB0byBXZWJwYWNrIGNvbXBpbGF0aW9uLmApO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcGlsZXJDbGlNb2R1bGU7XG4gIH1cblxuICBnZXQgb3B0aW9ucygpOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnMge1xuICAgIHJldHVybiB0aGlzLnBsdWdpbk9wdGlvbnM7XG4gIH1cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxpbmVzLXBlci1mdW5jdGlvblxuICBhcHBseShjb21waWxlcjogQ29tcGlsZXIpOiB2b2lkIHtcbiAgICBjb25zdCB7IE5vcm1hbE1vZHVsZVJlcGxhY2VtZW50UGx1Z2luLCB1dGlsIH0gPSBjb21waWxlci53ZWJwYWNrO1xuICAgIHRoaXMud2VicGFja0NyZWF0ZUhhc2ggPSB1dGlsLmNyZWF0ZUhhc2g7XG5cbiAgICAvLyBTZXR1cCBmaWxlIHJlcGxhY2VtZW50cyB3aXRoIHdlYnBhY2tcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh0aGlzLnBsdWdpbk9wdGlvbnMuZmlsZVJlcGxhY2VtZW50cykpIHtcbiAgICAgIG5ldyBOb3JtYWxNb2R1bGVSZXBsYWNlbWVudFBsdWdpbihcbiAgICAgICAgbmV3IFJlZ0V4cCgnXicgKyBrZXkucmVwbGFjZSgvWy4qK1xcLT9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKSArICckJyksXG4gICAgICAgIHZhbHVlLFxuICAgICAgKS5hcHBseShjb21waWxlcik7XG4gICAgfVxuXG4gICAgLy8gU2V0IHJlc29sdmVyIG9wdGlvbnNcbiAgICBjb25zdCBwYXRoc1BsdWdpbiA9IG5ldyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4oKTtcbiAgICBjb21waWxlci5ob29rcy5hZnRlclJlc29sdmVycy50YXAoUExVR0lOX05BTUUsIChjb21waWxlcikgPT4ge1xuICAgICAgLy8gV2hlbiBJdnkgaXMgZW5hYmxlZCB3ZSBuZWVkIHRvIGFkZCB0aGUgZmllbGRzIGFkZGVkIGJ5IE5HQ0NcbiAgICAgIC8vIHRvIHRha2UgcHJlY2VkZW5jZSBvdmVyIHRoZSBwcm92aWRlZCBtYWluRmllbGRzLlxuICAgICAgLy8gTkdDQyBhZGRzIGZpZWxkcyBpbiBwYWNrYWdlLmpzb24gc3VmZml4ZWQgd2l0aCAnX2l2eV9uZ2NjJ1xuICAgICAgLy8gRXhhbXBsZTogbW9kdWxlIC0+IG1vZHVsZV9faXZ5X25nY2NcbiAgICAgIGNvbXBpbGVyLnJlc29sdmVyRmFjdG9yeS5ob29rcy5yZXNvbHZlT3B0aW9uc1xuICAgICAgICAuZm9yKCdub3JtYWwnKVxuICAgICAgICAudGFwKFBMVUdJTl9OQU1FLCAocmVzb2x2ZU9wdGlvbnMpID0+IHtcbiAgICAgICAgICBjb25zdCBvcmlnaW5hbE1haW5GaWVsZHMgPSByZXNvbHZlT3B0aW9ucy5tYWluRmllbGRzO1xuICAgICAgICAgIGNvbnN0IGl2eU1haW5GaWVsZHMgPSBvcmlnaW5hbE1haW5GaWVsZHM/LmZsYXQoKS5tYXAoKGYpID0+IGAke2Z9X2l2eV9uZ2NjYCkgPz8gW107XG5cbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zID8/PSBbXTtcbiAgICAgICAgICByZXNvbHZlT3B0aW9ucy5wbHVnaW5zLnB1c2gocGF0aHNQbHVnaW4pO1xuXG4gICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3dlYnBhY2svd2VicGFjay9pc3N1ZXMvMTE2MzUjaXNzdWVjb21tZW50LTcwNzAxNjc3OVxuICAgICAgICAgIHJldHVybiB1dGlsLmNsZXZlck1lcmdlKHJlc29sdmVPcHRpb25zLCB7IG1haW5GaWVsZHM6IFsuLi5pdnlNYWluRmllbGRzLCAnLi4uJ10gfSk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gTG9hZCB0aGUgY29tcGlsZXItY2xpIGlmIG5vdCBhbHJlYWR5IGF2YWlsYWJsZVxuICAgIGNvbXBpbGVyLmhvb2tzLmJlZm9yZUNvbXBpbGUudGFwUHJvbWlzZShQTFVHSU5fTkFNRSwgKCkgPT4gdGhpcy5pbml0aWFsaXplQ29tcGlsZXJDbGkoKSk7XG5cbiAgICBsZXQgbmdjY1Byb2Nlc3NvcjogTmdjY1Byb2Nlc3NvciB8IHVuZGVmaW5lZDtcbiAgICBsZXQgcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB8IHVuZGVmaW5lZDtcbiAgICBsZXQgcHJldmlvdXNVbnVzZWQ6IFNldDxzdHJpbmc+IHwgdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoUExVR0lOX05BTUUsIChjb21waWxhdGlvbikgPT4ge1xuICAgICAgLy8gUmVnaXN0ZXIgcGx1Z2luIHRvIGVuc3VyZSBkZXRlcm1pbmlzdGljIGVtaXQgb3JkZXIgaW4gbXVsdGktcGx1Z2luIHVzYWdlXG4gICAgICBjb25zdCBlbWl0UmVnaXN0cmF0aW9uID0gdGhpcy5yZWdpc3RlcldpdGhDb21waWxhdGlvbihjb21waWxhdGlvbik7XG4gICAgICB0aGlzLndhdGNoTW9kZSA9IGNvbXBpbGVyLndhdGNoTW9kZTtcblxuICAgICAgLy8gSW5pdGlhbGl6ZSB3ZWJwYWNrIGNhY2hlXG4gICAgICBpZiAoIXRoaXMud2VicGFja0NhY2hlICYmIGNvbXBpbGF0aW9uLm9wdGlvbnMuY2FjaGUpIHtcbiAgICAgICAgdGhpcy53ZWJwYWNrQ2FjaGUgPSBjb21waWxhdGlvbi5nZXRDYWNoZShQTFVHSU5fTkFNRSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEluaXRpYWxpemUgdGhlIHJlc291cmNlIGxvYWRlciBpZiBub3QgYWxyZWFkeSBzZXR1cFxuICAgICAgaWYgKCFyZXNvdXJjZUxvYWRlcikge1xuICAgICAgICByZXNvdXJjZUxvYWRlciA9IG5ldyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIodGhpcy53YXRjaE1vZGUpO1xuICAgICAgfVxuXG4gICAgICAvLyBJbml0aWFsaXplIGFuZCBwcm9jZXNzIGVhZ2VyIG5nY2MgaWYgbm90IGFscmVhZHkgc2V0dXBcbiAgICAgIGlmICghbmdjY1Byb2Nlc3Nvcikge1xuICAgICAgICBjb25zdCB7IHByb2Nlc3NvciwgZXJyb3JzLCB3YXJuaW5ncyB9ID0gaW5pdGlhbGl6ZU5nY2NQcm9jZXNzb3IoXG4gICAgICAgICAgY29tcGlsZXIsXG4gICAgICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLnRzY29uZmlnLFxuICAgICAgICAgIHRoaXMuY29tcGlsZXJOZ2NjTW9kdWxlLFxuICAgICAgICApO1xuXG4gICAgICAgIHByb2Nlc3Nvci5wcm9jZXNzKCk7XG4gICAgICAgIHdhcm5pbmdzLmZvckVhY2goKHdhcm5pbmcpID0+IGFkZFdhcm5pbmcoY29tcGlsYXRpb24sIHdhcm5pbmcpKTtcbiAgICAgICAgZXJyb3JzLmZvckVhY2goKGVycm9yKSA9PiBhZGRFcnJvcihjb21waWxhdGlvbiwgZXJyb3IpKTtcblxuICAgICAgICBuZ2NjUHJvY2Vzc29yID0gcHJvY2Vzc29yO1xuICAgICAgfVxuXG4gICAgICAvLyBTZXR1cCBhbmQgcmVhZCBUeXBlU2NyaXB0IGFuZCBBbmd1bGFyIGNvbXBpbGVyIGNvbmZpZ3VyYXRpb25cbiAgICAgIGNvbnN0IHsgY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGVycm9ycyB9ID0gdGhpcy5sb2FkQ29uZmlndXJhdGlvbigpO1xuXG4gICAgICAvLyBDcmVhdGUgZGlhZ25vc3RpY3MgcmVwb3J0ZXIgYW5kIHJlcG9ydCBjb25maWd1cmF0aW9uIGZpbGUgZXJyb3JzXG4gICAgICBjb25zdCBkaWFnbm9zdGljc1JlcG9ydGVyID0gY3JlYXRlRGlhZ25vc3RpY3NSZXBvcnRlcihjb21waWxhdGlvbiwgKGRpYWdub3N0aWMpID0+XG4gICAgICAgIHRoaXMuY29tcGlsZXJDbGkuZm9ybWF0RGlhZ25vc3RpY3MoW2RpYWdub3N0aWNdKSxcbiAgICAgICk7XG4gICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGVycm9ycyk7XG5cbiAgICAgIC8vIFVwZGF0ZSBUeXBlU2NyaXB0IHBhdGggbWFwcGluZyBwbHVnaW4gd2l0aCBuZXcgY29uZmlndXJhdGlvblxuICAgICAgcGF0aHNQbHVnaW4udXBkYXRlKGNvbXBpbGVyT3B0aW9ucyk7XG5cbiAgICAgIC8vIENyZWF0ZSBhIFdlYnBhY2stYmFzZWQgVHlwZVNjcmlwdCBjb21waWxlciBob3N0XG4gICAgICBjb25zdCBzeXN0ZW0gPSBjcmVhdGVXZWJwYWNrU3lzdGVtKFxuICAgICAgICAvLyBXZWJwYWNrIGxhY2tzIGFuIElucHV0RmlsZVN5dGVtIHR5cGUgZGVmaW5pdGlvbiB3aXRoIHN5bmMgZnVuY3Rpb25zXG4gICAgICAgIGNvbXBpbGVyLmlucHV0RmlsZVN5c3RlbSBhcyBJbnB1dEZpbGVTeXN0ZW1TeW5jLFxuICAgICAgICBub3JtYWxpemVQYXRoKGNvbXBpbGVyLmNvbnRleHQpLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IGhvc3QgPSB0cy5jcmVhdGVJbmNyZW1lbnRhbENvbXBpbGVySG9zdChjb21waWxlck9wdGlvbnMsIHN5c3RlbSk7XG5cbiAgICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGNhY2hpbmcgYW5kIHJldXNlIGNhY2hlIGZyb20gcHJldmlvdXMgY29tcGlsYXRpb24gaWYgcHJlc2VudFxuICAgICAgbGV0IGNhY2hlID0gdGhpcy5zb3VyY2VGaWxlQ2FjaGU7XG4gICAgICBsZXQgY2hhbmdlZEZpbGVzO1xuICAgICAgaWYgKGNhY2hlKSB7XG4gICAgICAgIGNoYW5nZWRGaWxlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIFsuLi5jb21waWxlci5tb2RpZmllZEZpbGVzLCAuLi5jb21waWxlci5yZW1vdmVkRmlsZXNdKSB7XG4gICAgICAgICAgY29uc3Qgbm9ybWFsaXplZENoYW5nZWRGaWxlID0gbm9ybWFsaXplUGF0aChjaGFuZ2VkRmlsZSk7XG4gICAgICAgICAgLy8gSW52YWxpZGF0ZSBmaWxlIGRlcGVuZGVuY2llc1xuICAgICAgICAgIHRoaXMuZmlsZURlcGVuZGVuY2llcy5kZWxldGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcbiAgICAgICAgICAvLyBJbnZhbGlkYXRlIGV4aXN0aW5nIGNhY2hlXG4gICAgICAgICAgY2FjaGUuaW52YWxpZGF0ZShub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuXG4gICAgICAgICAgY2hhbmdlZEZpbGVzLmFkZChub3JtYWxpemVkQ2hhbmdlZEZpbGUpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJbml0aWFsaXplIGEgbmV3IGNhY2hlXG4gICAgICAgIGNhY2hlID0gbmV3IFNvdXJjZUZpbGVDYWNoZSgpO1xuICAgICAgICAvLyBPbmx5IHN0b3JlIGNhY2hlIGlmIGluIHdhdGNoIG1vZGVcbiAgICAgICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICAgICAgdGhpcy5zb3VyY2VGaWxlQ2FjaGUgPSBjYWNoZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyhob3N0LCBjYWNoZSk7XG5cbiAgICAgIGNvbnN0IG1vZHVsZVJlc29sdXRpb25DYWNoZSA9IHRzLmNyZWF0ZU1vZHVsZVJlc29sdXRpb25DYWNoZShcbiAgICAgICAgaG9zdC5nZXRDdXJyZW50RGlyZWN0b3J5KCksXG4gICAgICAgIGhvc3QuZ2V0Q2Fub25pY2FsRmlsZU5hbWUuYmluZChob3N0KSxcbiAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgKTtcblxuICAgICAgLy8gU2V0dXAgc291cmNlIGZpbGUgZGVwZW5kZW5jeSBjb2xsZWN0aW9uXG4gICAgICBhdWdtZW50SG9zdFdpdGhEZXBlbmRlbmN5Q29sbGVjdGlvbihob3N0LCB0aGlzLmZpbGVEZXBlbmRlbmNpZXMsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG5cbiAgICAgIC8vIFNldHVwIG9uIGRlbWFuZCBuZ2NjXG4gICAgICBhdWdtZW50SG9zdFdpdGhOZ2NjKGhvc3QsIG5nY2NQcm9jZXNzb3IsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG5cbiAgICAgIC8vIFNldHVwIHJlc291cmNlIGxvYWRpbmdcbiAgICAgIHJlc291cmNlTG9hZGVyLnVwZGF0ZShjb21waWxhdGlvbiwgY2hhbmdlZEZpbGVzKTtcbiAgICAgIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyhob3N0LCByZXNvdXJjZUxvYWRlciwge1xuICAgICAgICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IHRoaXMucGx1Z2luT3B0aW9ucy5kaXJlY3RUZW1wbGF0ZUxvYWRpbmcsXG4gICAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbjogdGhpcy5wbHVnaW5PcHRpb25zLmlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBhZGp1c3RtZW50IG9wdGlvbnNcbiAgICAgIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyhob3N0LCB0aGlzLnBsdWdpbk9wdGlvbnMuZmlsZVJlcGxhY2VtZW50cywgbW9kdWxlUmVzb2x1dGlvbkNhY2hlKTtcbiAgICAgIGF1Z21lbnRIb3N0V2l0aFN1YnN0aXR1dGlvbnMoaG9zdCwgdGhpcy5wbHVnaW5PcHRpb25zLnN1YnN0aXR1dGlvbnMpO1xuXG4gICAgICAvLyBDcmVhdGUgdGhlIGZpbGUgZW1pdHRlciB1c2VkIGJ5IHRoZSB3ZWJwYWNrIGxvYWRlclxuICAgICAgY29uc3QgeyBmaWxlRW1pdHRlciwgYnVpbGRlciwgaW50ZXJuYWxGaWxlcyB9ID0gdGhpcy5wbHVnaW5PcHRpb25zLmppdE1vZGVcbiAgICAgICAgPyB0aGlzLnVwZGF0ZUppdFByb2dyYW0oY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGhvc3QsIGRpYWdub3N0aWNzUmVwb3J0ZXIpXG4gICAgICAgIDogdGhpcy51cGRhdGVBb3RQcm9ncmFtKFxuICAgICAgICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgICAgICAgcm9vdE5hbWVzLFxuICAgICAgICAgICAgaG9zdCxcbiAgICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICAgICAgICAgICByZXNvdXJjZUxvYWRlcixcbiAgICAgICAgICApO1xuXG4gICAgICAvLyBTZXQgb2YgZmlsZXMgdXNlZCBkdXJpbmcgdGhlIHVudXNlZCBUeXBlU2NyaXB0IGZpbGUgYW5hbHlzaXNcbiAgICAgIGNvbnN0IGN1cnJlbnRVbnVzZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcblxuICAgICAgZm9yIChjb25zdCBzb3VyY2VGaWxlIG9mIGJ1aWxkZXIuZ2V0U291cmNlRmlsZXMoKSkge1xuICAgICAgICBpZiAoaW50ZXJuYWxGaWxlcz8uaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBFbnN1cmUgYWxsIHByb2dyYW0gZmlsZXMgYXJlIGNvbnNpZGVyZWQgcGFydCBvZiB0aGUgY29tcGlsYXRpb24gYW5kIHdpbGwgYmUgd2F0Y2hlZC5cbiAgICAgICAgLy8gV2VicGFjayBkb2VzIG5vdCBub3JtYWxpemUgcGF0aHMuIFRoZXJlZm9yZSwgd2UgbmVlZCB0byBub3JtYWxpemUgdGhlIHBhdGggd2l0aCBGUyBzZXBlcmF0b3JzLlxuICAgICAgICBjb21waWxhdGlvbi5maWxlRGVwZW5kZW5jaWVzLmFkZChleHRlcm5hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuXG4gICAgICAgIC8vIEFkZCBhbGwgbm9uLWRlY2xhcmF0aW9uIGZpbGVzIHRvIHRoZSBpbml0aWFsIHNldCBvZiB1bnVzZWQgZmlsZXMuIFRoZSBzZXQgd2lsbCBiZVxuICAgICAgICAvLyBhbmFseXplZCBhbmQgcHJ1bmVkIGFmdGVyIGFsbCBXZWJwYWNrIG1vZHVsZXMgYXJlIGZpbmlzaGVkIGJ1aWxkaW5nLlxuICAgICAgICBpZiAoIXNvdXJjZUZpbGUuaXNEZWNsYXJhdGlvbkZpbGUpIHtcbiAgICAgICAgICBjdXJyZW50VW51c2VkLmFkZChub3JtYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb21waWxhdGlvbi5ob29rcy5maW5pc2hNb2R1bGVzLnRhcFByb21pc2UoUExVR0lOX05BTUUsIGFzeW5jIChtb2R1bGVzKSA9PiB7XG4gICAgICAgIC8vIFJlYnVpbGQgYW55IHJlbWFpbmluZyBBT1QgcmVxdWlyZWQgbW9kdWxlc1xuICAgICAgICBhd2FpdCB0aGlzLnJlYnVpbGRSZXF1aXJlZEZpbGVzKG1vZHVsZXMsIGNvbXBpbGF0aW9uLCBmaWxlRW1pdHRlcik7XG5cbiAgICAgICAgLy8gQ2xlYXIgb3V0IHRoZSBXZWJwYWNrIGNvbXBpbGF0aW9uIHRvIGF2b2lkIGFuIGV4dHJhIHJldGFpbmluZyByZWZlcmVuY2VcbiAgICAgICAgcmVzb3VyY2VMb2FkZXI/LmNsZWFyUGFyZW50Q29tcGlsYXRpb24oKTtcblxuICAgICAgICAvLyBBbmFseXplIHByb2dyYW0gZm9yIHVudXNlZCBmaWxlc1xuICAgICAgICBpZiAoY29tcGlsYXRpb24uZXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGNvbnN0IHdlYnBhY2tNb2R1bGUgb2YgbW9kdWxlcykge1xuICAgICAgICAgIGNvbnN0IHJlc291cmNlID0gKHdlYnBhY2tNb2R1bGUgYXMgTm9ybWFsTW9kdWxlKS5yZXNvdXJjZTtcbiAgICAgICAgICBpZiAocmVzb3VyY2UpIHtcbiAgICAgICAgICAgIHRoaXMubWFya1Jlc291cmNlVXNlZChub3JtYWxpemVQYXRoKHJlc291cmNlKSwgY3VycmVudFVudXNlZCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCB1bnVzZWQgb2YgY3VycmVudFVudXNlZCkge1xuICAgICAgICAgIGlmIChwcmV2aW91c1VudXNlZCAmJiBwcmV2aW91c1VudXNlZC5oYXModW51c2VkKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGFkZFdhcm5pbmcoXG4gICAgICAgICAgICBjb21waWxhdGlvbixcbiAgICAgICAgICAgIGAke3VudXNlZH0gaXMgcGFydCBvZiB0aGUgVHlwZVNjcmlwdCBjb21waWxhdGlvbiBidXQgaXQncyB1bnVzZWQuXFxuYCArXG4gICAgICAgICAgICAgIGBBZGQgb25seSBlbnRyeSBwb2ludHMgdG8gdGhlICdmaWxlcycgb3IgJ2luY2x1ZGUnIHByb3BlcnRpZXMgaW4geW91ciB0c2NvbmZpZy5gLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcHJldmlvdXNVbnVzZWQgPSBjdXJyZW50VW51c2VkO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0b3JlIGZpbGUgZW1pdHRlciBmb3IgbG9hZGVyIHVzYWdlXG4gICAgICBlbWl0UmVnaXN0cmF0aW9uLnVwZGF0ZShmaWxlRW1pdHRlcik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHJlZ2lzdGVyV2l0aENvbXBpbGF0aW9uKGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbikge1xuICAgIGxldCBmaWxlRW1pdHRlcnMgPSBjb21waWxhdGlvbkZpbGVFbWl0dGVycy5nZXQoY29tcGlsYXRpb24pO1xuICAgIGlmICghZmlsZUVtaXR0ZXJzKSB7XG4gICAgICBmaWxlRW1pdHRlcnMgPSBuZXcgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uKCk7XG4gICAgICBjb21waWxhdGlvbkZpbGVFbWl0dGVycy5zZXQoY29tcGlsYXRpb24sIGZpbGVFbWl0dGVycyk7XG4gICAgICBjb21waWxhdGlvbi5jb21waWxlci53ZWJwYWNrLk5vcm1hbE1vZHVsZS5nZXRDb21waWxhdGlvbkhvb2tzKGNvbXBpbGF0aW9uKS5sb2FkZXIudGFwKFxuICAgICAgICBQTFVHSU5fTkFNRSxcbiAgICAgICAgKGxvYWRlckNvbnRleHQ6IHsgW0FuZ3VsYXJQbHVnaW5TeW1ib2xdPzogRmlsZUVtaXR0ZXJDb2xsZWN0aW9uIH0pID0+IHtcbiAgICAgICAgICBsb2FkZXJDb250ZXh0W0FuZ3VsYXJQbHVnaW5TeW1ib2xdID0gZmlsZUVtaXR0ZXJzO1xuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9XG4gICAgY29uc3QgZW1pdFJlZ2lzdHJhdGlvbiA9IGZpbGVFbWl0dGVycy5yZWdpc3RlcigpO1xuXG4gICAgcmV0dXJuIGVtaXRSZWdpc3RyYXRpb247XG4gIH1cblxuICBwcml2YXRlIG1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplZFJlc291cmNlUGF0aDogc3RyaW5nLCBjdXJyZW50VW51c2VkOiBTZXQ8c3RyaW5nPik6IHZvaWQge1xuICAgIGlmICghY3VycmVudFVudXNlZC5oYXMobm9ybWFsaXplZFJlc291cmNlUGF0aCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjdXJyZW50VW51c2VkLmRlbGV0ZShub3JtYWxpemVkUmVzb3VyY2VQYXRoKTtcbiAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSB0aGlzLmZpbGVEZXBlbmRlbmNpZXMuZ2V0KG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpO1xuICAgIGlmICghZGVwZW5kZW5jaWVzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeSBvZiBkZXBlbmRlbmNpZXMpIHtcbiAgICAgIHRoaXMubWFya1Jlc291cmNlVXNlZChub3JtYWxpemVQYXRoKGRlcGVuZGVuY3kpLCBjdXJyZW50VW51c2VkKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYnVpbGRSZXF1aXJlZEZpbGVzKFxuICAgIG1vZHVsZXM6IEl0ZXJhYmxlPE1vZHVsZT4sXG4gICAgY29tcGlsYXRpb246IENvbXBpbGF0aW9uLFxuICAgIGZpbGVFbWl0dGVyOiBGaWxlRW1pdHRlcixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZXNUb1JlYnVpbGQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IHJlcXVpcmVkRmlsZSBvZiB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQpIHtcbiAgICAgIGNvbnN0IGhpc3RvcnkgPSBhd2FpdCB0aGlzLmdldEZpbGVFbWl0SGlzdG9yeShyZXF1aXJlZEZpbGUpO1xuICAgICAgaWYgKGhpc3RvcnkpIHtcbiAgICAgICAgY29uc3QgZW1pdFJlc3VsdCA9IGF3YWl0IGZpbGVFbWl0dGVyKHJlcXVpcmVkRmlsZSk7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBlbWl0UmVzdWx0Py5jb250ZW50ID09PSB1bmRlZmluZWQgfHxcbiAgICAgICAgICBoaXN0b3J5Lmxlbmd0aCAhPT0gZW1pdFJlc3VsdC5jb250ZW50Lmxlbmd0aCB8fFxuICAgICAgICAgIGVtaXRSZXN1bHQuaGFzaCA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgQnVmZmVyLmNvbXBhcmUoaGlzdG9yeS5oYXNoLCBlbWl0UmVzdWx0Lmhhc2gpICE9PSAwXG4gICAgICAgICkge1xuICAgICAgICAgIC8vIE5ldyBlbWl0IHJlc3VsdCBpcyBkaWZmZXJlbnQgc28gcmVidWlsZCB1c2luZyBuZXcgZW1pdCByZXN1bHRcbiAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5zZXQocmVxdWlyZWRGaWxlLCBlbWl0UmVzdWx0KTtcbiAgICAgICAgICBmaWxlc1RvUmVidWlsZC5hZGQocmVxdWlyZWRGaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTm8gZW1pdCBoaXN0b3J5IHNvIHJlYnVpbGRcbiAgICAgICAgZmlsZXNUb1JlYnVpbGQuYWRkKHJlcXVpcmVkRmlsZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGZpbGVzVG9SZWJ1aWxkLnNpemUgPiAwKSB7XG4gICAgICBjb25zdCByZWJ1aWxkID0gKHdlYnBhY2tNb2R1bGU6IE1vZHVsZSkgPT5cbiAgICAgICAgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IGNvbXBpbGF0aW9uLnJlYnVpbGRNb2R1bGUod2VicGFja01vZHVsZSwgKCkgPT4gcmVzb2x2ZSgpKSk7XG5cbiAgICAgIGNvbnN0IG1vZHVsZXNUb1JlYnVpbGQgPSBbXTtcbiAgICAgIGZvciAoY29uc3Qgd2VicGFja01vZHVsZSBvZiBtb2R1bGVzKSB7XG4gICAgICAgIGNvbnN0IHJlc291cmNlID0gKHdlYnBhY2tNb2R1bGUgYXMgTm9ybWFsTW9kdWxlKS5yZXNvdXJjZTtcbiAgICAgICAgaWYgKHJlc291cmNlICYmIGZpbGVzVG9SZWJ1aWxkLmhhcyhub3JtYWxpemVQYXRoKHJlc291cmNlKSkpIHtcbiAgICAgICAgICBtb2R1bGVzVG9SZWJ1aWxkLnB1c2god2VicGFja01vZHVsZSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKG1vZHVsZXNUb1JlYnVpbGQubWFwKCh3ZWJwYWNrTW9kdWxlKSA9PiByZWJ1aWxkKHdlYnBhY2tNb2R1bGUpKSk7XG4gICAgfVxuXG4gICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0LmNsZWFyKCk7XG4gICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuY2xlYXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgbG9hZENvbmZpZ3VyYXRpb24oKSB7XG4gICAgY29uc3Qge1xuICAgICAgb3B0aW9uczogY29tcGlsZXJPcHRpb25zLFxuICAgICAgcm9vdE5hbWVzLFxuICAgICAgZXJyb3JzLFxuICAgIH0gPSB0aGlzLmNvbXBpbGVyQ2xpLnJlYWRDb25maWd1cmF0aW9uKFxuICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLnRzY29uZmlnLFxuICAgICAgdGhpcy5wbHVnaW5PcHRpb25zLmNvbXBpbGVyT3B0aW9ucyxcbiAgICApO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5lbmFibGVJdnkgPSB0cnVlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5ub0VtaXRPbkVycm9yID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLnN1cHByZXNzT3V0cHV0UGF0aENoZWNrID0gdHJ1ZTtcbiAgICBjb21waWxlck9wdGlvbnMub3V0RGlyID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5pbmxpbmVTb3VyY2VzID0gY29tcGlsZXJPcHRpb25zLnNvdXJjZU1hcDtcbiAgICBjb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlTWFwID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLm1hcFJvb3QgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLnNvdXJjZVJvb3QgPSB1bmRlZmluZWQ7XG4gICAgY29tcGlsZXJPcHRpb25zLmFsbG93RW1wdHlDb2RlZ2VuRmlsZXMgPSBmYWxzZTtcbiAgICBjb21waWxlck9wdGlvbnMuYW5ub3RhdGlvbnNBcyA9ICdkZWNvcmF0b3JzJztcbiAgICBjb21waWxlck9wdGlvbnMuZW5hYmxlUmVzb3VyY2VJbmxpbmluZyA9IGZhbHNlO1xuXG4gICAgcmV0dXJuIHsgY29tcGlsZXJPcHRpb25zLCByb290TmFtZXMsIGVycm9ycyB9O1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVBb3RQcm9ncmFtKFxuICAgIGNvbXBpbGVyT3B0aW9uczogQ29tcGlsZXJPcHRpb25zLFxuICAgIHJvb3ROYW1lczogc3RyaW5nW10sXG4gICAgaG9zdDogQ29tcGlsZXJIb3N0LFxuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXI6IERpYWdub3N0aWNzUmVwb3J0ZXIsXG4gICAgcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcixcbiAgKSB7XG4gICAgLy8gQ3JlYXRlIHRoZSBBbmd1bGFyIHNwZWNpZmljIHByb2dyYW0gdGhhdCBjb250YWlucyB0aGUgQW5ndWxhciBjb21waWxlclxuICAgIGNvbnN0IGFuZ3VsYXJQcm9ncmFtID0gbmV3IHRoaXMuY29tcGlsZXJDbGkuTmd0c2NQcm9ncmFtKFxuICAgICAgcm9vdE5hbWVzLFxuICAgICAgY29tcGlsZXJPcHRpb25zLFxuICAgICAgaG9zdCxcbiAgICAgIHRoaXMubmd0c2NOZXh0UHJvZ3JhbSxcbiAgICApO1xuICAgIGNvbnN0IGFuZ3VsYXJDb21waWxlciA9IGFuZ3VsYXJQcm9ncmFtLmNvbXBpbGVyO1xuXG4gICAgLy8gVGhlIGBpZ25vcmVGb3JFbWl0YCByZXR1cm4gdmFsdWUgY2FuIGJlIHNhZmVseSBpZ25vcmVkIHdoZW4gZW1pdHRpbmcuIE9ubHkgZmlsZXNcbiAgICAvLyB0aGF0IHdpbGwgYmUgYnVuZGxlZCAocmVxdWVzdGVkIGJ5IFdlYnBhY2spIHdpbGwgYmUgZW1pdHRlZC4gQ29tYmluZWQgd2l0aCBUeXBlU2NyaXB0J3NcbiAgICAvLyBlbGlkaW5nIG9mIHR5cGUgb25seSBpbXBvcnRzLCB0aGlzIHdpbGwgY2F1c2UgdHlwZSBvbmx5IGZpbGVzIHRvIGJlIGF1dG9tYXRpY2FsbHkgaWdub3JlZC5cbiAgICAvLyBJbnRlcm5hbCBBbmd1bGFyIHR5cGUgY2hlY2sgZmlsZXMgYXJlIGFsc28gbm90IHJlc29sdmFibGUgYnkgdGhlIGJ1bmRsZXIuIEV2ZW4gaWYgdGhleVxuICAgIC8vIHdlcmUgc29tZWhvdyBlcnJhbnRseSBpbXBvcnRlZCwgdGhlIGJ1bmRsZXIgd291bGQgZXJyb3IgYmVmb3JlIGFuIGVtaXQgd2FzIGF0dGVtcHRlZC5cbiAgICAvLyBEaWFnbm9zdGljcyBhcmUgc3RpbGwgY29sbGVjdGVkIGZvciBhbGwgZmlsZXMgd2hpY2ggcmVxdWlyZXMgdXNpbmcgYGlnbm9yZUZvckRpYWdub3N0aWNzYC5cbiAgICBjb25zdCB7IGlnbm9yZUZvckRpYWdub3N0aWNzLCBpZ25vcmVGb3JFbWl0IH0gPSBhbmd1bGFyQ29tcGlsZXI7XG5cbiAgICAvLyBTb3VyY2VGaWxlIHZlcnNpb25zIGFyZSByZXF1aXJlZCBmb3IgYnVpbGRlciBwcm9ncmFtcy5cbiAgICAvLyBUaGUgd3JhcHBlZCBob3N0IGluc2lkZSBOZ3RzY1Byb2dyYW0gYWRkcyBhZGRpdGlvbmFsIGZpbGVzIHRoYXQgd2lsbCBub3QgaGF2ZSB2ZXJzaW9ucy5cbiAgICBjb25zdCB0eXBlU2NyaXB0UHJvZ3JhbSA9IGFuZ3VsYXJQcm9ncmFtLmdldFRzUHJvZ3JhbSgpO1xuICAgIGF1Z21lbnRQcm9ncmFtV2l0aFZlcnNpb25pbmcodHlwZVNjcmlwdFByb2dyYW0pO1xuXG4gICAgbGV0IGJ1aWxkZXI6IHRzLkJ1aWxkZXJQcm9ncmFtIHwgdHMuRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbTtcbiAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIGJ1aWxkZXIgPSB0aGlzLmJ1aWxkZXIgPSB0cy5jcmVhdGVFbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtKFxuICAgICAgICB0eXBlU2NyaXB0UHJvZ3JhbSxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdGhpcy5idWlsZGVyLFxuICAgICAgKTtcbiAgICAgIHRoaXMubmd0c2NOZXh0UHJvZ3JhbSA9IGFuZ3VsYXJQcm9ncmFtO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBXaGVuIG5vdCBpbiB3YXRjaCBtb2RlLCB0aGUgc3RhcnR1cCBjb3N0IG9mIHRoZSBpbmNyZW1lbnRhbCBhbmFseXNpcyBjYW4gYmUgYXZvaWRlZCBieVxuICAgICAgLy8gdXNpbmcgYW4gYWJzdHJhY3QgYnVpbGRlciB0aGF0IG9ubHkgd3JhcHMgYSBUeXBlU2NyaXB0IHByb2dyYW0uXG4gICAgICBidWlsZGVyID0gdHMuY3JlYXRlQWJzdHJhY3RCdWlsZGVyKHR5cGVTY3JpcHRQcm9ncmFtLCBob3N0KTtcbiAgICB9XG5cbiAgICAvLyBVcGRhdGUgc2VtYW50aWMgZGlhZ25vc3RpY3MgY2FjaGVcbiAgICBjb25zdCBhZmZlY3RlZEZpbGVzID0gbmV3IFNldDx0cy5Tb3VyY2VGaWxlPigpO1xuXG4gICAgLy8gQW5hbHl6ZSBhZmZlY3RlZCBmaWxlcyB3aGVuIGluIHdhdGNoIG1vZGUgZm9yIGluY3JlbWVudGFsIHR5cGUgY2hlY2tpbmdcbiAgICBpZiAoJ2dldFNlbWFudGljRGlhZ25vc3RpY3NPZk5leHRBZmZlY3RlZEZpbGUnIGluIGJ1aWxkZXIpIHtcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBuby1jb25zdGFudC1jb25kaXRpb25cbiAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljc09mTmV4dEFmZmVjdGVkRmlsZSh1bmRlZmluZWQsIChzb3VyY2VGaWxlKSA9PiB7XG4gICAgICAgICAgLy8gSWYgdGhlIGFmZmVjdGVkIGZpbGUgaXMgYSBUVEMgc2hpbSwgYWRkIHRoZSBzaGltJ3Mgb3JpZ2luYWwgc291cmNlIGZpbGUuXG4gICAgICAgICAgLy8gVGhpcyBlbnN1cmVzIHRoYXQgY2hhbmdlcyB0aGF0IGFmZmVjdCBUVEMgYXJlIHR5cGVjaGVja2VkIGV2ZW4gd2hlbiB0aGUgY2hhbmdlc1xuICAgICAgICAgIC8vIGFyZSBvdGhlcndpc2UgdW5yZWxhdGVkIGZyb20gYSBUUyBwZXJzcGVjdGl2ZSBhbmQgZG8gbm90IHJlc3VsdCBpbiBJdnkgY29kZWdlbiBjaGFuZ2VzLlxuICAgICAgICAgIC8vIEZvciBleGFtcGxlLCBjaGFuZ2luZyBASW5wdXQgcHJvcGVydHkgdHlwZXMgb2YgYSBkaXJlY3RpdmUgdXNlZCBpbiBhbm90aGVyIGNvbXBvbmVudCdzXG4gICAgICAgICAgLy8gdGVtcGxhdGUuXG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICBzb3VyY2VGaWxlLmZpbGVOYW1lLmVuZHNXaXRoKCcubmd0eXBlY2hlY2sudHMnKVxuICAgICAgICAgICkge1xuICAgICAgICAgICAgLy8gVGhpcyBmaWxlIG5hbWUgY29udmVyc2lvbiByZWxpZXMgb24gaW50ZXJuYWwgY29tcGlsZXIgbG9naWMgYW5kIHNob3VsZCBiZSBjb252ZXJ0ZWRcbiAgICAgICAgICAgIC8vIHRvIGFuIG9mZmljaWFsIG1ldGhvZCB3aGVuIGF2YWlsYWJsZS4gMTUgaXMgbGVuZ3RoIG9mIGAubmd0eXBlY2hlY2sudHNgXG4gICAgICAgICAgICBjb25zdCBvcmlnaW5hbEZpbGVuYW1lID0gc291cmNlRmlsZS5maWxlTmFtZS5zbGljZSgwLCAtMTUpICsgJy50cyc7XG4gICAgICAgICAgICBjb25zdCBvcmlnaW5hbFNvdXJjZUZpbGUgPSBidWlsZGVyLmdldFNvdXJjZUZpbGUob3JpZ2luYWxGaWxlbmFtZSk7XG4gICAgICAgICAgICBpZiAob3JpZ2luYWxTb3VyY2VGaWxlKSB7XG4gICAgICAgICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKG9yaWdpbmFsU291cmNlRmlsZSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKHJlc3VsdC5hZmZlY3RlZCBhcyB0cy5Tb3VyY2VGaWxlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDb2xsZWN0IHByb2dyYW0gbGV2ZWwgZGlhZ25vc3RpY3NcbiAgICBjb25zdCBkaWFnbm9zdGljcyA9IFtcbiAgICAgIC4uLmFuZ3VsYXJDb21waWxlci5nZXRPcHRpb25EaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSxcbiAgICBdO1xuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZGlhZ25vc3RpY3MpO1xuXG4gICAgLy8gQ29sbGVjdCBzb3VyY2UgZmlsZSBzcGVjaWZpYyBkaWFnbm9zdGljc1xuICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgIGlmICghaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYnVpbGRlci5nZXRTeW50YWN0aWNEaWFnbm9zdGljcyhzb3VyY2VGaWxlKSk7XG4gICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKHNvdXJjZUZpbGUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2Zvcm1lcnMgPSBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMoYnVpbGRlciwgdGhpcy5wbHVnaW5PcHRpb25zKTtcblxuICAgIGNvbnN0IGdldERlcGVuZGVuY2llcyA9IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB7XG4gICAgICBjb25zdCBkZXBlbmRlbmNpZXMgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcmVzb3VyY2VQYXRoIG9mIGFuZ3VsYXJDb21waWxlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICBkZXBlbmRlbmNpZXMucHVzaChcbiAgICAgICAgICByZXNvdXJjZVBhdGgsXG4gICAgICAgICAgLy8gUmV0cmlldmUgYWxsIGRlcGVuZGVuY2llcyBvZiB0aGUgcmVzb3VyY2UgKHN0eWxlc2hlZXQgaW1wb3J0cywgZXRjLilcbiAgICAgICAgICAuLi5yZXNvdXJjZUxvYWRlci5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhyZXNvdXJjZVBhdGgpLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGVwZW5kZW5jaWVzO1xuICAgIH07XG5cbiAgICAvLyBSZXF1aXJlZCB0byBzdXBwb3J0IGFzeW5jaHJvbm91cyByZXNvdXJjZSBsb2FkaW5nXG4gICAgLy8gTXVzdCBiZSBkb25lIGJlZm9yZSBjcmVhdGluZyB0cmFuc2Zvcm1lcnMgb3IgZ2V0dGluZyB0ZW1wbGF0ZSBkaWFnbm9zdGljc1xuICAgIGNvbnN0IHBlbmRpbmdBbmFseXNpcyA9IGFuZ3VsYXJDb21waWxlclxuICAgICAgLmFuYWx5emVBc3luYygpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5jbGVhcigpO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgICAgICBpZiAoc291cmNlRmlsZS5pc0RlY2xhcmF0aW9uRmlsZSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQ29sbGVjdCBzb3VyY2VzIHRoYXQgYXJlIHJlcXVpcmVkIHRvIGJlIGVtaXR0ZWRcbiAgICAgICAgICBpZiAoXG4gICAgICAgICAgICAhaWdub3JlRm9yRW1pdC5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgICFhbmd1bGFyQ29tcGlsZXIuaW5jcmVtZW50YWxEcml2ZXIuc2FmZVRvU2tpcEVtaXQoc291cmNlRmlsZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5hZGQobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG5cbiAgICAgICAgICAgIC8vIElmIHJlcXVpcmVkIHRvIGVtaXQsIGRpYWdub3N0aWNzIG1heSBoYXZlIGFsc28gY2hhbmdlZFxuICAgICAgICAgICAgaWYgKCFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgICAgICAgYWZmZWN0ZWRGaWxlcy5hZGQoc291cmNlRmlsZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlICYmXG4gICAgICAgICAgICAhYWZmZWN0ZWRGaWxlcy5oYXMoc291cmNlRmlsZSkgJiZcbiAgICAgICAgICAgICFpZ25vcmVGb3JEaWFnbm9zdGljcy5oYXMoc291cmNlRmlsZSlcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIFVzZSBjYWNoZWQgQW5ndWxhciBkaWFnbm9zdGljcyBmb3IgdW5jaGFuZ2VkIGFuZCB1bmFmZmVjdGVkIGZpbGVzXG4gICAgICAgICAgICBjb25zdCBhbmd1bGFyRGlhZ25vc3RpY3MgPSB0aGlzLnNvdXJjZUZpbGVDYWNoZS5nZXRBbmd1bGFyRGlhZ25vc3RpY3Moc291cmNlRmlsZSk7XG4gICAgICAgICAgICBpZiAoYW5ndWxhckRpYWdub3N0aWNzKSB7XG4gICAgICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDb2xsZWN0IG5ldyBBbmd1bGFyIGRpYWdub3N0aWNzIGZvciBmaWxlcyBhZmZlY3RlZCBieSBjaGFuZ2VzXG4gICAgICAgIGNvbnN0IE9wdGltaXplRm9yID0gdGhpcy5jb21waWxlckNsaS5PcHRpbWl6ZUZvcjtcbiAgICAgICAgY29uc3Qgb3B0aW1pemVEaWFnbm9zdGljc0ZvciA9XG4gICAgICAgICAgYWZmZWN0ZWRGaWxlcy5zaXplIDw9IERJQUdOT1NUSUNTX0FGRkVDVEVEX1RIUkVTSE9MRFxuICAgICAgICAgICAgPyBPcHRpbWl6ZUZvci5TaW5nbGVGaWxlXG4gICAgICAgICAgICA6IE9wdGltaXplRm9yLldob2xlUHJvZ3JhbTtcbiAgICAgICAgZm9yIChjb25zdCBhZmZlY3RlZEZpbGUgb2YgYWZmZWN0ZWRGaWxlcykge1xuICAgICAgICAgIGNvbnN0IGFuZ3VsYXJEaWFnbm9zdGljcyA9IGFuZ3VsYXJDb21waWxlci5nZXREaWFnbm9zdGljc0ZvckZpbGUoXG4gICAgICAgICAgICBhZmZlY3RlZEZpbGUsXG4gICAgICAgICAgICBvcHRpbWl6ZURpYWdub3N0aWNzRm9yLFxuICAgICAgICAgICk7XG4gICAgICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlPy51cGRhdGVBbmd1bGFyRGlhZ25vc3RpY3MoYWZmZWN0ZWRGaWxlLCBhbmd1bGFyRGlhZ25vc3RpY3MpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBlbWl0dGVyOiB0aGlzLmNyZWF0ZUZpbGVFbWl0dGVyKFxuICAgICAgICAgICAgYnVpbGRlcixcbiAgICAgICAgICAgIG1lcmdlVHJhbnNmb3JtZXJzKGFuZ3VsYXJDb21waWxlci5wcmVwYXJlRW1pdCgpLnRyYW5zZm9ybWVycywgdHJhbnNmb3JtZXJzKSxcbiAgICAgICAgICAgIGdldERlcGVuZGVuY2llcyxcbiAgICAgICAgICAgIChzb3VyY2VGaWxlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5kZWxldGUobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG4gICAgICAgICAgICAgIGFuZ3VsYXJDb21waWxlci5pbmNyZW1lbnRhbERyaXZlci5yZWNvcmRTdWNjZXNzZnVsRW1pdChzb3VyY2VGaWxlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKSxcbiAgICAgICAgfTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goKGVycikgPT4gKHsgZXJyb3JNZXNzYWdlOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogYCR7ZXJyfWAgfSkpO1xuXG4gICAgY29uc3QgYW5hbHl6aW5nRmlsZUVtaXR0ZXI6IEZpbGVFbWl0dGVyID0gYXN5bmMgKGZpbGUpID0+IHtcbiAgICAgIGNvbnN0IGFuYWx5c2lzID0gYXdhaXQgcGVuZGluZ0FuYWx5c2lzO1xuXG4gICAgICBpZiAoJ2Vycm9yTWVzc2FnZScgaW4gYW5hbHlzaXMpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGFuYWx5c2lzLmVycm9yTWVzc2FnZSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhbmFseXNpcy5lbWl0dGVyKGZpbGUpO1xuICAgIH07XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmlsZUVtaXR0ZXI6IGFuYWx5emluZ0ZpbGVFbWl0dGVyLFxuICAgICAgYnVpbGRlcixcbiAgICAgIGludGVybmFsRmlsZXM6IGlnbm9yZUZvckVtaXQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlSml0UHJvZ3JhbShcbiAgICBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgICByb290TmFtZXM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuICAgIGhvc3Q6IENvbXBpbGVySG9zdCxcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyOiBEaWFnbm9zdGljc1JlcG9ydGVyLFxuICApIHtcbiAgICBsZXQgYnVpbGRlcjtcbiAgICBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIGJ1aWxkZXIgPSB0aGlzLmJ1aWxkZXIgPSB0cy5jcmVhdGVFbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtKFxuICAgICAgICByb290TmFtZXMsXG4gICAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgaG9zdCxcbiAgICAgICAgdGhpcy5idWlsZGVyLFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2hlbiBub3QgaW4gd2F0Y2ggbW9kZSwgdGhlIHN0YXJ0dXAgY29zdCBvZiB0aGUgaW5jcmVtZW50YWwgYW5hbHlzaXMgY2FuIGJlIGF2b2lkZWQgYnlcbiAgICAgIC8vIHVzaW5nIGFuIGFic3RyYWN0IGJ1aWxkZXIgdGhhdCBvbmx5IHdyYXBzIGEgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgYnVpbGRlciA9IHRzLmNyZWF0ZUFic3RyYWN0QnVpbGRlcihyb290TmFtZXMsIGNvbXBpbGVyT3B0aW9ucywgaG9zdCk7XG4gICAgfVxuXG4gICAgY29uc3QgZGlhZ25vc3RpY3MgPSBbXG4gICAgICAuLi5idWlsZGVyLmdldE9wdGlvbnNEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRHbG9iYWxEaWFnbm9zdGljcygpLFxuICAgICAgLi4uYnVpbGRlci5nZXRTeW50YWN0aWNEaWFnbm9zdGljcygpLFxuICAgICAgLy8gR2F0aGVyIGluY3JlbWVudGFsIHNlbWFudGljIGRpYWdub3N0aWNzXG4gICAgICAuLi5idWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3MoKSxcbiAgICBdO1xuICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoZGlhZ25vc3RpY3MpO1xuXG4gICAgY29uc3QgdHJhbnNmb3JtZXJzID0gY3JlYXRlSml0VHJhbnNmb3JtZXJzKGJ1aWxkZXIsIHRoaXMuY29tcGlsZXJDbGksIHRoaXMucGx1Z2luT3B0aW9ucyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmlsZUVtaXR0ZXI6IHRoaXMuY3JlYXRlRmlsZUVtaXR0ZXIoYnVpbGRlciwgdHJhbnNmb3JtZXJzLCAoKSA9PiBbXSksXG4gICAgICBidWlsZGVyLFxuICAgICAgaW50ZXJuYWxGaWxlczogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZUZpbGVFbWl0dGVyKFxuICAgIHByb2dyYW06IHRzLkJ1aWxkZXJQcm9ncmFtLFxuICAgIHRyYW5zZm9ybWVyczogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzID0ge30sXG4gICAgZ2V0RXh0cmFEZXBlbmRlbmNpZXM6IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiBJdGVyYWJsZTxzdHJpbmc+LFxuICAgIG9uQWZ0ZXJFbWl0PzogKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHZvaWQsXG4gICk6IEZpbGVFbWl0dGVyIHtcbiAgICByZXR1cm4gYXN5bmMgKGZpbGU6IHN0cmluZykgPT4ge1xuICAgICAgY29uc3QgZmlsZVBhdGggPSBub3JtYWxpemVQYXRoKGZpbGUpO1xuICAgICAgaWYgKHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmhhcyhmaWxlUGF0aCkpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmdldChmaWxlUGF0aCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZUZpbGUgPSBwcm9ncmFtLmdldFNvdXJjZUZpbGUoZmlsZVBhdGgpO1xuICAgICAgaWYgKCFzb3VyY2VGaWxlKSB7XG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGxldCBjb250ZW50OiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBsZXQgbWFwOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICBwcm9ncmFtLmVtaXQoXG4gICAgICAgIHNvdXJjZUZpbGUsXG4gICAgICAgIChmaWxlbmFtZSwgZGF0YSkgPT4ge1xuICAgICAgICAgIGlmIChmaWxlbmFtZS5lbmRzV2l0aCgnLm1hcCcpKSB7XG4gICAgICAgICAgICBtYXAgPSBkYXRhO1xuICAgICAgICAgIH0gZWxzZSBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoJy5qcycpKSB7XG4gICAgICAgICAgICBjb250ZW50ID0gZGF0YTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB0cmFuc2Zvcm1lcnMsXG4gICAgICApO1xuXG4gICAgICBvbkFmdGVyRW1pdD8uKHNvdXJjZUZpbGUpO1xuXG4gICAgICAvLyBDYXB0dXJlIGVtaXQgaGlzdG9yeSBpbmZvIGZvciBBbmd1bGFyIHJlYnVpbGQgYW5hbHlzaXNcbiAgICAgIGNvbnN0IGhhc2ggPSBjb250ZW50ID8gKGF3YWl0IHRoaXMuYWRkRmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoLCBjb250ZW50KSkuaGFzaCA6IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gW1xuICAgICAgICAuLi4odGhpcy5maWxlRGVwZW5kZW5jaWVzLmdldChmaWxlUGF0aCkgfHwgW10pLFxuICAgICAgICAuLi5nZXRFeHRyYURlcGVuZGVuY2llcyhzb3VyY2VGaWxlKSxcbiAgICAgIF0ubWFwKGV4dGVybmFsaXplUGF0aCk7XG5cbiAgICAgIHJldHVybiB7IGNvbnRlbnQsIG1hcCwgZGVwZW5kZW5jaWVzLCBoYXNoIH07XG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhpcyB1c2VzIGEgZHluYW1pYyBpbXBvcnQgdG8gbG9hZCBgQGFuZ3VsYXIvY29tcGlsZXItY2xpYCB3aGljaCBtYXkgYmUgRVNNLlxuICAgIC8vIENvbW1vbkpTIGNvZGUgY2FuIGxvYWQgRVNNIGNvZGUgdmlhIGEgZHluYW1pYyBpbXBvcnQuIFVuZm9ydHVuYXRlbHksIFR5cGVTY3JpcHRcbiAgICAvLyB3aWxsIGN1cnJlbnRseSwgdW5jb25kaXRpb25hbGx5IGRvd25sZXZlbCBkeW5hbWljIGltcG9ydCBpbnRvIGEgcmVxdWlyZSBjYWxsLlxuICAgIC8vIHJlcXVpcmUgY2FsbHMgY2Fubm90IGxvYWQgRVNNIGNvZGUgYW5kIHdpbGwgcmVzdWx0IGluIGEgcnVudGltZSBlcnJvci4gVG8gd29ya2Fyb3VuZFxuICAgIC8vIHRoaXMsIGEgRnVuY3Rpb24gY29uc3RydWN0b3IgaXMgdXNlZCB0byBwcmV2ZW50IFR5cGVTY3JpcHQgZnJvbSBjaGFuZ2luZyB0aGUgZHluYW1pYyBpbXBvcnQuXG4gICAgLy8gT25jZSBUeXBlU2NyaXB0IHByb3ZpZGVzIHN1cHBvcnQgZm9yIGtlZXBpbmcgdGhlIGR5bmFtaWMgaW1wb3J0IHRoaXMgd29ya2Fyb3VuZCBjYW5cbiAgICAvLyBiZSBkcm9wcGVkLlxuICAgIHRoaXMuY29tcGlsZXJDbGlNb2R1bGUgPSBhd2FpdCBuZXcgRnVuY3Rpb24oYHJldHVybiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScpO2ApKCk7XG4gICAgdGhpcy5jb21waWxlck5nY2NNb2R1bGUgPSBhd2FpdCBuZXcgRnVuY3Rpb24oYHJldHVybiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyk7YCkoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYWRkRmlsZUVtaXRIaXN0b3J5KFxuICAgIGZpbGVQYXRoOiBzdHJpbmcsXG4gICAgY29udGVudDogc3RyaW5nLFxuICApOiBQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0+IHtcbiAgICBhc3NlcnQub2sodGhpcy53ZWJwYWNrQ3JlYXRlSGFzaCwgJ0ZpbGUgZW1pdHRlciBpcyB1c2VkIHByaW9yIHRvIFdlYnBhY2sgY29tcGlsYXRpb24nKTtcblxuICAgIGNvbnN0IGhpc3RvcnlEYXRhOiBGaWxlRW1pdEhpc3RvcnlJdGVtID0ge1xuICAgICAgbGVuZ3RoOiBjb250ZW50Lmxlbmd0aCxcbiAgICAgIGhhc2g6IHRoaXMud2VicGFja0NyZWF0ZUhhc2goJ3h4aGFzaDY0JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgpIGFzIFVpbnQ4QXJyYXksXG4gICAgfTtcblxuICAgIGlmICh0aGlzLndlYnBhY2tDYWNoZSkge1xuICAgICAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IHRoaXMuZ2V0RmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoKTtcbiAgICAgIGlmICghaGlzdG9yeSB8fCBCdWZmZXIuY29tcGFyZShoaXN0b3J5Lmhhc2gsIGhpc3RvcnlEYXRhLmhhc2gpICE9PSAwKSB7XG4gICAgICAgIC8vIEhhc2ggZG9lc24ndCBtYXRjaCBvciBpdGVtIGRvZXNuJ3QgZXhpc3QuXG4gICAgICAgIGF3YWl0IHRoaXMud2VicGFja0NhY2hlLnN0b3JlUHJvbWlzZShmaWxlUGF0aCwgbnVsbCwgaGlzdG9yeURhdGEpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodGhpcy53YXRjaE1vZGUpIHtcbiAgICAgIC8vIFRoZSBpbiBtZW1vcnkgZmlsZSBlbWl0IGhpc3RvcnkgaXMgb25seSByZXF1aXJlZCBkdXJpbmcgd2F0Y2ggbW9kZS5cbiAgICAgIHRoaXMuZmlsZUVtaXRIaXN0b3J5LnNldChmaWxlUGF0aCwgaGlzdG9yeURhdGEpO1xuICAgIH1cblxuICAgIHJldHVybiBoaXN0b3J5RGF0YTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0RmlsZUVtaXRIaXN0b3J5KGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEZpbGVFbWl0SGlzdG9yeUl0ZW0gfCB1bmRlZmluZWQ+IHtcbiAgICByZXR1cm4gdGhpcy53ZWJwYWNrQ2FjaGVcbiAgICAgID8gdGhpcy53ZWJwYWNrQ2FjaGUuZ2V0UHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtIHwgdW5kZWZpbmVkPihmaWxlUGF0aCwgbnVsbClcbiAgICAgIDogdGhpcy5maWxlRW1pdEhpc3RvcnkuZ2V0KGZpbGVQYXRoKTtcbiAgfVxufVxuIl19