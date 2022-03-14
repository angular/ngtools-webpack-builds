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
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9pdnkvcGx1Z2luLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFHSCxtQ0FBMEM7QUFDMUMsbUNBQW9DO0FBQ3BDLCtDQUFpQztBQUVqQyxzREFBa0Q7QUFDbEQsa0RBQXdEO0FBQ3hELHdEQUEyRDtBQUMzRCxtQ0FBMEM7QUFDMUMsK0NBS3VCO0FBQ3ZCLGlDQVFnQjtBQUNoQixtQ0FBeUQ7QUFDekQscUNBQW1HO0FBQ25HLHFDQUFvRTtBQUNwRSxxREFBbUc7QUFFbkc7Ozs7R0FJRztBQUNILE1BQU0sOEJBQThCLEdBQUcsQ0FBQyxDQUFDO0FBY3pDLFNBQVMsdUJBQXVCLENBQzlCLFFBQWtCLEVBQ2xCLFFBQWdCLEVBQ2hCLGtCQUEyRTs7SUFFM0UsTUFBTSxFQUFFLGVBQWUsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLEdBQUcsUUFBUSxDQUFDO0lBQzlELE1BQU0sVUFBVSxHQUFHLE1BQUEsTUFBQSxNQUFBLGNBQWMsQ0FBQyxPQUFPLDBDQUFFLFVBQVUsMENBQUUsSUFBSSxFQUFFLG1DQUFJLEVBQUUsQ0FBQztJQUVwRSxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxRQUFRLEdBQWEsRUFBRSxDQUFDO0lBQzlCLE1BQU0sUUFBUSxHQUFHLFFBQVEsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRTtRQUN0RCwwRkFBMEY7UUFDMUYsS0FBSyxFQUFFLEtBQUs7UUFDWixVQUFVLEVBQUUsQ0FBQyxPQUFPLENBQUM7UUFDckIsc0JBQXNCLEVBQUUsSUFBSTtLQUM3QixDQUFDLENBQUM7SUFFSCxnRkFBZ0Y7SUFDaEYsZ0ZBQWdGO0lBQ2hGLDZDQUE2QztJQUM3QyxlQUFNLENBQUMsRUFBRSxD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aEIsT0FBZTtRQUVmLE1BQU0sV0FBVyxHQUF3QjtZQUN2QyxNQUFNLEVBQUUsT0FBTyxDQUFDLE1BQU07WUFDdEIsSUFBSSxFQUFFLElBQUEsbUJBQVUsRUFBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxFQUFFO1NBQ2pELENBQUM7UUFFRixJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUU7WUFDckIsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDeEQsSUFBSSxDQUFDLE9BQU8sSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsV0FBVyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRTtnQkFDcEUsNENBQTRDO2dCQUM1QyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsV0FBVyxDQUFDLENBQUM7YUFDbkU7U0FDRjthQUFNLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUN6QixzRUFBc0U7WUFDdEUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFDO1NBQ2pEO1FBRUQsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQztJQUVPLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxRQUFnQjtRQUMvQyxPQUFPLElBQUksQ0FBQyxZQUFZO1lBQ3RCLENBQUMsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBa0MsUUFBUSxFQUFFLElBQUksQ0FBQztZQUMvRSxDQUFDLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDekMsQ0FBQztDQUNGO0FBL3BCRCxvREErcEJDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB0eXBlIHsgQ29tcGlsZXJIb3N0LCBDb21waWxlck9wdGlvbnMsIE5ndHNjUHJvZ3JhbSB9IGZyb20gJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaSc7XG5pbXBvcnQgeyBzdHJpY3QgYXMgYXNzZXJ0IH0gZnJvbSAnYXNzZXJ0JztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgdHlwZSB7IENvbXBpbGF0aW9uLCBDb21waWxlciwgTW9kdWxlLCBOb3JtYWxNb2R1bGUgfSBmcm9tICd3ZWJwYWNrJztcbmltcG9ydCB7IE5nY2NQcm9jZXNzb3IgfSBmcm9tICcuLi9uZ2NjX3Byb2Nlc3Nvcic7XG5pbXBvcnQgeyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4gfSBmcm9tICcuLi9wYXRocy1wbHVnaW4nO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7IFNvdXJjZUZpbGVDYWNoZSB9IGZyb20gJy4vY2FjaGUnO1xuaW1wb3J0IHtcbiAgRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgYWRkRXJyb3IsXG4gIGFkZFdhcm5pbmcsXG4gIGNyZWF0ZURpYWdub3N0aWNzUmVwb3J0ZXIsXG59IGZyb20gJy4vZGlhZ25vc3RpY3MnO1xuaW1wb3J0IHtcbiAgYXVnbWVudEhvc3RXaXRoQ2FjaGluZyxcbiAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24sXG4gIGF1Z21lbnRIb3N0V2l0aE5nY2MsXG4gIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyxcbiAgYXVnbWVudEhvc3RXaXRoUmVzb3VyY2VzLFxuICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zLFxuICBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nLFxufSBmcm9tICcuL2hvc3QnO1xuaW1wb3J0IHsgZXh0ZXJuYWxpemVQYXRoLCBub3JtYWxpemVQYXRoIH0gZnJvbSAnLi9wYXRocyc7XG5pbXBvcnQgeyBBbmd1bGFyUGx1Z2luU3ltYm9sLCBFbWl0RmlsZVJlc3VsdCwgRmlsZUVtaXR0ZXIsIEZpbGVFbWl0dGVyQ29sbGVjdGlvbiB9IGZyb20gJy4vc3ltYm9sJztcbmltcG9ydCB7IElucHV0RmlsZVN5c3RlbVN5bmMsIGNyZWF0ZVdlYnBhY2tTeXN0ZW0gfSBmcm9tICcuL3N5c3RlbSc7XG5pbXBvcnQgeyBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMsIGNyZWF0ZUppdFRyYW5zZm9ybWVycywgbWVyZ2VUcmFuc2Zvcm1lcnMgfSBmcm9tICcuL3RyYW5zZm9ybWF0aW9uJztcblxuLyoqXG4gKiBUaGUgdGhyZXNob2xkIHVzZWQgdG8gZGV0ZXJtaW5lIHdoZXRoZXIgQW5ndWxhciBmaWxlIGRpYWdub3N0aWNzIHNob3VsZCBvcHRpbWl6ZSBmb3IgZnVsbCBwcm9ncmFtc1xuICogb3Igc2luZ2xlIGZpbGVzLiBJZiB0aGUgbnVtYmVyIG9mIGFmZmVjdGVkIGZpbGVzIGZvciBhIGJ1aWxkIGlzIG1vcmUgdGhhbiB0aGUgdGhyZXNob2xkLCBmdWxsXG4gKiBwcm9ncmFtIG9wdGltaXphdGlvbiB3aWxsIGJlIHVzZWQuXG4gKi9cbmNvbnN0IERJQUdOT1NUSUNTX0FGRkVDVEVEX1RIUkVTSE9MRCA9IDE7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5ndWxhcldlYnBhY2tQbHVnaW5PcHRpb25zIHtcbiAgdHNjb25maWc6IHN0cmluZztcbiAgY29tcGlsZXJPcHRpb25zPzogQ29tcGlsZXJPcHRpb25zO1xuICBmaWxlUmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IGJvb2xlYW47XG4gIGVtaXRDbGFzc01ldGFkYXRhOiBib29sZWFuO1xuICBlbWl0TmdNb2R1bGVTY29wZTogYm9vbGVhbjtcbiAgaml0TW9kZTogYm9vbGVhbjtcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBpbml0aWFsaXplTmdjY1Byb2Nlc3NvcihcbiAgY29tcGlsZXI6IENvbXBpbGVyLFxuICB0c2NvbmZpZzogc3RyaW5nLFxuICBjb21waWxlck5nY2NNb2R1bGU6IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJykgfCB1bmRlZmluZWQsXG4pOiB7IHByb2Nlc3NvcjogTmdjY1Byb2Nlc3NvcjsgZXJyb3JzOiBzdHJpbmdbXTsgd2FybmluZ3M6IHN0cmluZ1tdIH0ge1xuICBjb25zdCB7IGlucHV0RmlsZVN5c3RlbSwgb3B0aW9uczogd2VicGFja09wdGlvbnMgfSA9IGNvbXBpbGVyO1xuICBjb25zdCBtYWluRmllbGRzID0gd2VicGFja09wdGlvbnMucmVzb2x2ZT8ubWFpbkZpZWxkcz8uZmxhdCgpID8/IFtdO1xuXG4gIGNvbnN0IGVycm9yczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgd2FybmluZ3M6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHJlc29sdmVyID0gY29tcGlsZXIucmVzb2x2ZXJGYWN0b3J5LmdldCgnbm9ybWFsJywge1xuICAgIC8vIENhY2hpbmcgbXVzdCBiZSBkaXNhYmxlZCBiZWNhdXNlIGl0IGNhdXNlcyB0aGUgcmVzb2x2ZXIgdG8gYmVjb21lIGFzeW5jIGFmdGVyIGEgcmVidWlsZFxuICAgIGNhY2hlOiBmYWxzZSxcbiAgICBleHRlbnNpb25zOiBbJy5qc29uJ10sXG4gICAgdXNlU3luY0ZpbGVTeXN0ZW1DYWxsczogdHJ1ZSxcbiAgfSk7XG5cbiAgLy8gVGhlIGNvbXBpbGVyTmdjY01vZHVsZSBmaWVsZCBpcyBndWFyYW50ZWVkIHRvIGJlIGRlZmluZWQgZHVyaW5nIGEgY29tcGlsYXRpb25cbiAgLy8gZHVlIHRvIHRoZSBgYmVmb3JlQ29tcGlsZWAgaG9vay4gVXNhZ2Ugb2YgdGhpcyBwcm9wZXJ0eSBhY2Nlc3NvciBwcmlvciB0byB0aGVcbiAgLy8gaG9vayBleGVjdXRpb24gaXMgYW4gaW1wbGVtZW50YXRpb24gZXJyb3IuXG4gIGFzc2VydC5vayhjb21waWxlck5nY2NNb2R1bGUsIGAnQGFuZ3VsYXIvY29tcGlsZXItY2xpL25nY2MnIHVzZWQgcHJpb3IgdG8gV2VicGFjayBjb21waWxhdGlvbi5gKTtcblxuICBjb25zdCBwcm9jZXNzb3IgPSBuZXcgTmdjY1Byb2Nlc3NvcihcbiAgICBjb21waWxlck5nY2NNb2R1bGUsXG4gICAgbWFpbkZpZWxkcyxcbiAgICB3YXJuaW5ncyxcbiAgICBlcnJvcnMsXG4gICAgY29tcGlsZXIuY29udGV4dCxcbiAgICB0c2NvbmZpZyxcbiAgICBpbnB1dEZpbGVTeXN0ZW0sXG4gICAgcmVzb2x2ZXIsXG4gICk7XG5cbiAgcmV0dXJuIHsgcHJvY2Vzc29yLCBlcnJvcnMsIHdhcm5pbmdzIH07XG59XG5cbmNvbnN0IFBMVUdJTl9OQU1FID0gJ2FuZ3VsYXItY29tcGlsZXInO1xuY29uc3QgY29tcGlsYXRpb25GaWxlRW1pdHRlcnMgPSBuZXcgV2Vha01hcDxDb21waWxhdGlvbiwgRmlsZUVtaXR0ZXJDb2xsZWN0aW9uPigpO1xuXG5pbnRlcmZhY2UgRmlsZUVtaXRIaXN0b3J5SXRlbSB7XG4gIGxlbmd0aDogbnVtYmVyO1xuICBoYXNoOiBVaW50OEFycmF5O1xufVxuXG5leHBvcnQgY2xhc3MgQW5ndWxhcldlYnBhY2tQbHVnaW4ge1xuICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbk9wdGlvbnM6IEFuZ3VsYXJXZWJwYWNrUGx1Z2luT3B0aW9ucztcbiAgcHJpdmF0ZSBjb21waWxlckNsaU1vZHVsZT86IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScpO1xuICBwcml2YXRlIGNvbXBpbGVyTmdjY01vZHVsZT86IHR5cGVvZiBpbXBvcnQoJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaS9uZ2NjJyk7XG4gIHByaXZhdGUgd2F0Y2hNb2RlPzogYm9vbGVhbjtcbiAgcHJpdmF0ZSBuZ3RzY05leHRQcm9ncmFtPzogTmd0c2NQcm9ncmFtO1xuICBwcml2YXRlIGJ1aWxkZXI/OiB0cy5FbWl0QW5kU2VtYW50aWNEaWFnbm9zdGljc0J1aWxkZXJQcm9ncmFtO1xuICBwcml2YXRlIHNvdXJjZUZpbGVDYWNoZT86IFNvdXJjZUZpbGVDYWNoZTtcbiAgcHJpdmF0ZSB3ZWJwYWNrQ2FjaGU/OiBSZXR1cm5UeXBlPENvbXBpbGF0aW9uWydnZXRDYWNoZSddPjtcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlRGVwZW5kZW5jaWVzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlcXVpcmVkRmlsZXNUb0VtaXQgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSByZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgRW1pdEZpbGVSZXN1bHQgfCB1bmRlZmluZWQ+KCk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZmlsZUVtaXRIaXN0b3J5ID0gbmV3IE1hcDxzdHJpbmcsIEZpbGVFbWl0SGlzdG9yeUl0ZW0+KCk7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUGFydGlhbDxBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnM+ID0ge30pIHtcbiAgICB0aGlzLnBsdWdpbk9wdGlvbnMgPSB7XG4gICAgICBlbWl0Q2xhc3NNZXRhZGF0YTogZmFsc2UsXG4gICAgICBlbWl0TmdNb2R1bGVTY29wZTogZmFsc2UsXG4gICAgICBqaXRNb2RlOiBmYWxzZSxcbiAgICAgIGZpbGVSZXBsYWNlbWVudHM6IHt9LFxuICAgICAgc3Vic3RpdHV0aW9uczoge30sXG4gICAgICBkaXJlY3RUZW1wbGF0ZUxvYWRpbmc6IHRydWUsXG4gICAgICB0c2NvbmZpZzogJ3RzY29uZmlnLmpzb24nLFxuICAgICAgLi4ub3B0aW9ucyxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgY29tcGlsZXJDbGkoKTogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJykge1xuICAgIC8vIFRoZSBjb21waWxlckNsaU1vZHVsZSBmaWVsZCBpcyBndWFyYW50ZWVkIHRvIGJlIGRlZmluZWQgZHVyaW5nIGEgY29tcGlsYXRpb25cbiAgICAvLyBkdWUgdG8gdGhlIGBiZWZvcmVDb21waWxlYCBob29rLiBVc2FnZSBvZiB0aGlzIHByb3BlcnR5IGFjY2Vzc29yIHByaW9yIHRvIHRoZVxuICAgIC8vIGhvb2sgZXhlY3V0aW9uIGlzIGFuIGltcGxlbWVudGF0aW9uIGVycm9yLlxuICAgIGFzc2VydC5vayh0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlLCBgJ0Bhbmd1bGFyL2NvbXBpbGVyLWNsaScgdXNlZCBwcmlvciB0byBXZWJwYWNrIGNvbXBpbGF0aW9uLmApO1xuXG4gICAgcmV0dXJuIHRoaXMuY29tcGlsZXJDbGlNb2R1bGU7XG4gIH1cblxuICBnZXQgb3B0aW9ucygpOiBBbmd1bGFyV2VicGFja1BsdWdpbk9wdGlvbnMge1xuICAgIHJldHVybiB0aGlzLnBsdWdpbk9wdGlvbnM7XG4gIH1cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxpbmVzLXBlci1mdW5jdGlvblxuICBhcHBseShjb21waWxlcjogQ29tcGlsZXIpOiB2b2lkIHtcbiAgICBjb25zdCB7IE5vcm1hbE1vZHVsZVJlcGxhY2VtZW50UGx1Z2luLCB1dGlsIH0gPSBjb21waWxlci53ZWJwYWNrO1xuXG4gICAgLy8gU2V0dXAgZmlsZSByZXBsYWNlbWVudHMgd2l0aCB3ZWJwYWNrXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMpKSB7XG4gICAgICBuZXcgTm9ybWFsTW9kdWxlUmVwbGFjZW1lbnRQbHVnaW4oXG4gICAgICAgIG5ldyBSZWdFeHAoJ14nICsga2V5LnJlcGxhY2UoL1suKitcXC0/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJykgKyAnJCcpLFxuICAgICAgICB2YWx1ZSxcbiAgICAgICkuYXBwbHkoY29tcGlsZXIpO1xuICAgIH1cblxuICAgIC8vIFNldCByZXNvbHZlciBvcHRpb25zXG4gICAgY29uc3QgcGF0aHNQbHVnaW4gPSBuZXcgVHlwZVNjcmlwdFBhdGhzUGx1Z2luKCk7XG4gICAgY29tcGlsZXIuaG9va3MuYWZ0ZXJSZXNvbHZlcnMudGFwKFBMVUdJTl9OQU1FLCAoY29tcGlsZXIpID0+IHtcbiAgICAgIC8vIFdoZW4gSXZ5IGlzIGVuYWJsZWQgd2UgbmVlZCB0byBhZGQgdGhlIGZpZWxkcyBhZGRlZCBieSBOR0NDXG4gICAgICAvLyB0byB0YWtlIHByZWNlZGVuY2Ugb3ZlciB0aGUgcHJvdmlkZWQgbWFpbkZpZWxkcy5cbiAgICAgIC8vIE5HQ0MgYWRkcyBmaWVsZHMgaW4gcGFja2FnZS5qc29uIHN1ZmZpeGVkIHdpdGggJ19pdnlfbmdjYydcbiAgICAgIC8vIEV4YW1wbGU6IG1vZHVsZSAtPiBtb2R1bGVfX2l2eV9uZ2NjXG4gICAgICBjb21waWxlci5yZXNvbHZlckZhY3RvcnkuaG9va3MucmVzb2x2ZU9wdGlvbnNcbiAgICAgICAgLmZvcignbm9ybWFsJylcbiAgICAgICAgLnRhcChQTFVHSU5fTkFNRSwgKHJlc29sdmVPcHRpb25zKSA9PiB7XG4gICAgICAgICAgY29uc3Qgb3JpZ2luYWxNYWluRmllbGRzID0gcmVzb2x2ZU9wdGlvbnMubWFpbkZpZWxkcztcbiAgICAgICAgICBjb25zdCBpdnlNYWluRmllbGRzID0gb3JpZ2luYWxNYWluRmllbGRzPy5mbGF0KCkubWFwKChmKSA9PiBgJHtmfV9pdnlfbmdjY2ApID8/IFtdO1xuXG4gICAgICAgICAgcmVzb2x2ZU9wdGlvbnMucGx1Z2lucyA/Pz0gW107XG4gICAgICAgICAgcmVzb2x2ZU9wdGlvbnMucGx1Z2lucy5wdXNoKHBhdGhzUGx1Z2luKTtcblxuICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS93ZWJwYWNrL3dlYnBhY2svaXNzdWVzLzExNjM1I2lzc3VlY29tbWVudC03MDcwMTY3NzlcbiAgICAgICAgICByZXR1cm4gdXRpbC5jbGV2ZXJNZXJnZShyZXNvbHZlT3B0aW9ucywgeyBtYWluRmllbGRzOiBbLi4uaXZ5TWFpbkZpZWxkcywgJy4uLiddIH0pO1xuICAgICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIExvYWQgdGhlIGNvbXBpbGVyLWNsaSBpZiBub3QgYWxyZWFkeSBhdmFpbGFibGVcbiAgICBjb21waWxlci5ob29rcy5iZWZvcmVDb21waWxlLnRhcFByb21pc2UoUExVR0lOX05BTUUsICgpID0+IHRoaXMuaW5pdGlhbGl6ZUNvbXBpbGVyQ2xpKCkpO1xuXG4gICAgbGV0IG5nY2NQcm9jZXNzb3I6IE5nY2NQcm9jZXNzb3IgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHJlc291cmNlTG9hZGVyOiBXZWJwYWNrUmVzb3VyY2VMb2FkZXIgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHByZXZpb3VzVW51c2VkOiBTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZDtcbiAgICBjb21waWxlci5ob29rcy50aGlzQ29tcGlsYXRpb24udGFwKFBMVUdJTl9OQU1FLCAoY29tcGlsYXRpb24pID0+IHtcbiAgICAgIC8vIFJlZ2lzdGVyIHBsdWdpbiB0byBlbnN1cmUgZGV0ZXJtaW5pc3RpYyBlbWl0IG9yZGVyIGluIG11bHRpLXBsdWdpbiB1c2FnZVxuICAgICAgY29uc3QgZW1pdFJlZ2lzdHJhdGlvbiA9IHRoaXMucmVnaXN0ZXJXaXRoQ29tcGlsYXRpb24oY29tcGlsYXRpb24pO1xuICAgICAgdGhpcy53YXRjaE1vZGUgPSBjb21waWxlci53YXRjaE1vZGU7XG5cbiAgICAgIC8vIEluaXRpYWxpemUgd2VicGFjayBjYWNoZVxuICAgICAgaWYgKCF0aGlzLndlYnBhY2tDYWNoZSAmJiBjb21waWxhdGlvbi5vcHRpb25zLmNhY2hlKSB7XG4gICAgICAgIHRoaXMud2VicGFja0NhY2hlID0gY29tcGlsYXRpb24uZ2V0Q2FjaGUoUExVR0lOX05BTUUpO1xuICAgICAgfVxuXG4gICAgICAvLyBJbml0aWFsaXplIHRoZSByZXNvdXJjZSBsb2FkZXIgaWYgbm90IGFscmVhZHkgc2V0dXBcbiAgICAgIGlmICghcmVzb3VyY2VMb2FkZXIpIHtcbiAgICAgICAgcmVzb3VyY2VMb2FkZXIgPSBuZXcgV2VicGFja1Jlc291cmNlTG9hZGVyKHRoaXMud2F0Y2hNb2RlKTtcbiAgICAgIH1cblxuICAgICAgLy8gSW5pdGlhbGl6ZSBhbmQgcHJvY2VzcyBlYWdlciBuZ2NjIGlmIG5vdCBhbHJlYWR5IHNldHVwXG4gICAgICBpZiAoIW5nY2NQcm9jZXNzb3IpIHtcbiAgICAgICAgY29uc3QgeyBwcm9jZXNzb3IsIGVycm9ycywgd2FybmluZ3MgfSA9IGluaXRpYWxpemVOZ2NjUHJvY2Vzc29yKFxuICAgICAgICAgIGNvbXBpbGVyLFxuICAgICAgICAgIHRoaXMucGx1Z2luT3B0aW9ucy50c2NvbmZpZyxcbiAgICAgICAgICB0aGlzLmNvbXBpbGVyTmdjY01vZHVsZSxcbiAgICAgICAgKTtcblxuICAgICAgICBwcm9jZXNzb3IucHJvY2VzcygpO1xuICAgICAgICB3YXJuaW5ncy5mb3JFYWNoKCh3YXJuaW5nKSA9PiBhZGRXYXJuaW5nKGNvbXBpbGF0aW9uLCB3YXJuaW5nKSk7XG4gICAgICAgIGVycm9ycy5mb3JFYWNoKChlcnJvcikgPT4gYWRkRXJyb3IoY29tcGlsYXRpb24sIGVycm9yKSk7XG5cbiAgICAgICAgbmdjY1Byb2Nlc3NvciA9IHByb2Nlc3NvcjtcbiAgICAgIH1cblxuICAgICAgLy8gU2V0dXAgYW5kIHJlYWQgVHlwZVNjcmlwdCBhbmQgQW5ndWxhciBjb21waWxlciBjb25maWd1cmF0aW9uXG4gICAgICBjb25zdCB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfSA9IHRoaXMubG9hZENvbmZpZ3VyYXRpb24oKTtcblxuICAgICAgLy8gQ3JlYXRlIGRpYWdub3N0aWNzIHJlcG9ydGVyIGFuZCByZXBvcnQgY29uZmlndXJhdGlvbiBmaWxlIGVycm9yc1xuICAgICAgY29uc3QgZGlhZ25vc3RpY3NSZXBvcnRlciA9IGNyZWF0ZURpYWdub3N0aWNzUmVwb3J0ZXIoY29tcGlsYXRpb24sIChkaWFnbm9zdGljKSA9PlxuICAgICAgICB0aGlzLmNvbXBpbGVyQ2xpLmZvcm1hdERpYWdub3N0aWNzKFtkaWFnbm9zdGljXSksXG4gICAgICApO1xuICAgICAgZGlhZ25vc3RpY3NSZXBvcnRlcihlcnJvcnMpO1xuXG4gICAgICAvLyBVcGRhdGUgVHlwZVNjcmlwdCBwYXRoIG1hcHBpbmcgcGx1Z2luIHdpdGggbmV3IGNvbmZpZ3VyYXRpb25cbiAgICAgIHBhdGhzUGx1Z2luLnVwZGF0ZShjb21waWxlck9wdGlvbnMpO1xuXG4gICAgICAvLyBDcmVhdGUgYSBXZWJwYWNrLWJhc2VkIFR5cGVTY3JpcHQgY29tcGlsZXIgaG9zdFxuICAgICAgY29uc3Qgc3lzdGVtID0gY3JlYXRlV2VicGFja1N5c3RlbShcbiAgICAgICAgLy8gV2VicGFjayBsYWNrcyBhbiBJbnB1dEZpbGVTeXRlbSB0eXBlIGRlZmluaXRpb24gd2l0aCBzeW5jIGZ1bmN0aW9uc1xuICAgICAgICBjb21waWxlci5pbnB1dEZpbGVTeXN0ZW0gYXMgSW5wdXRGaWxlU3lzdGVtU3luYyxcbiAgICAgICAgbm9ybWFsaXplUGF0aChjb21waWxlci5jb250ZXh0KSxcbiAgICAgICk7XG4gICAgICBjb25zdCBob3N0ID0gdHMuY3JlYXRlSW5jcmVtZW50YWxDb21waWxlckhvc3QoY29tcGlsZXJPcHRpb25zLCBzeXN0ZW0pO1xuXG4gICAgICAvLyBTZXR1cCBzb3VyY2UgZmlsZSBjYWNoaW5nIGFuZCByZXVzZSBjYWNoZSBmcm9tIHByZXZpb3VzIGNvbXBpbGF0aW9uIGlmIHByZXNlbnRcbiAgICAgIGxldCBjYWNoZSA9IHRoaXMuc291cmNlRmlsZUNhY2hlO1xuICAgICAgbGV0IGNoYW5nZWRGaWxlcztcbiAgICAgIGlmIChjYWNoZSkge1xuICAgICAgICBjaGFuZ2VkRmlsZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiBbLi4uY29tcGlsZXIubW9kaWZpZWRGaWxlcywgLi4uY29tcGlsZXIucmVtb3ZlZEZpbGVzXSkge1xuICAgICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSA9IG5vcm1hbGl6ZVBhdGgoY2hhbmdlZEZpbGUpO1xuICAgICAgICAgIC8vIEludmFsaWRhdGUgZmlsZSBkZXBlbmRlbmNpZXNcbiAgICAgICAgICB0aGlzLmZpbGVEZXBlbmRlbmNpZXMuZGVsZXRlKG5vcm1hbGl6ZWRDaGFuZ2VkRmlsZSk7XG4gICAgICAgICAgLy8gSW52YWxpZGF0ZSBleGlzdGluZyBjYWNoZVxuICAgICAgICAgIGNhY2hlLmludmFsaWRhdGUobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcblxuICAgICAgICAgIGNoYW5nZWRGaWxlcy5hZGQobm9ybWFsaXplZENoYW5nZWRGaWxlKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gSW5pdGlhbGl6ZSBhIG5ldyBjYWNoZVxuICAgICAgICBjYWNoZSA9IG5ldyBTb3VyY2VGaWxlQ2FjaGUoKTtcbiAgICAgICAgLy8gT25seSBzdG9yZSBjYWNoZSBpZiBpbiB3YXRjaCBtb2RlXG4gICAgICAgIGlmICh0aGlzLndhdGNoTW9kZSkge1xuICAgICAgICAgIHRoaXMuc291cmNlRmlsZUNhY2hlID0gY2FjaGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcoaG9zdCwgY2FjaGUpO1xuXG4gICAgICBjb25zdCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUgPSB0cy5jcmVhdGVNb2R1bGVSZXNvbHV0aW9uQ2FjaGUoXG4gICAgICAgIGhvc3QuZ2V0Q3VycmVudERpcmVjdG9yeSgpLFxuICAgICAgICBob3N0LmdldENhbm9uaWNhbEZpbGVOYW1lLmJpbmQoaG9zdCksXG4gICAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgICk7XG5cbiAgICAgIC8vIFNldHVwIHNvdXJjZSBmaWxlIGRlcGVuZGVuY3kgY29sbGVjdGlvblxuICAgICAgYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24oaG9zdCwgdGhpcy5maWxlRGVwZW5kZW5jaWVzLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuXG4gICAgICAvLyBTZXR1cCBvbiBkZW1hbmQgbmdjY1xuICAgICAgYXVnbWVudEhvc3RXaXRoTmdjYyhob3N0LCBuZ2NjUHJvY2Vzc29yLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xuXG4gICAgICAvLyBTZXR1cCByZXNvdXJjZSBsb2FkaW5nXG4gICAgICByZXNvdXJjZUxvYWRlci51cGRhdGUoY29tcGlsYXRpb24sIGNoYW5nZWRGaWxlcyk7XG4gICAgICBhdWdtZW50SG9zdFdpdGhSZXNvdXJjZXMoaG9zdCwgcmVzb3VyY2VMb2FkZXIsIHtcbiAgICAgICAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nOiB0aGlzLnBsdWdpbk9wdGlvbnMuZGlyZWN0VGVtcGxhdGVMb2FkaW5nLFxuICAgICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb246IHRoaXMucGx1Z2luT3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICB9KTtcblxuICAgICAgLy8gU2V0dXAgc291cmNlIGZpbGUgYWRqdXN0bWVudCBvcHRpb25zXG4gICAgICBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMoaG9zdCwgdGhpcy5wbHVnaW5PcHRpb25zLmZpbGVSZXBsYWNlbWVudHMsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG4gICAgICBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zKGhvc3QsIHRoaXMucGx1Z2luT3B0aW9ucy5zdWJzdGl0dXRpb25zKTtcblxuICAgICAgLy8gQ3JlYXRlIHRoZSBmaWxlIGVtaXR0ZXIgdXNlZCBieSB0aGUgd2VicGFjayBsb2FkZXJcbiAgICAgIGNvbnN0IHsgZmlsZUVtaXR0ZXIsIGJ1aWxkZXIsIGludGVybmFsRmlsZXMgfSA9IHRoaXMucGx1Z2luT3B0aW9ucy5qaXRNb2RlXG4gICAgICAgID8gdGhpcy51cGRhdGVKaXRQcm9ncmFtKGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBob3N0LCBkaWFnbm9zdGljc1JlcG9ydGVyKVxuICAgICAgICA6IHRoaXMudXBkYXRlQW90UHJvZ3JhbShcbiAgICAgICAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgICAgICAgIHJvb3ROYW1lcyxcbiAgICAgICAgICAgIGhvc3QsXG4gICAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyLFxuICAgICAgICAgICAgcmVzb3VyY2VMb2FkZXIsXG4gICAgICAgICAgKTtcblxuICAgICAgLy8gU2V0IG9mIGZpbGVzIHVzZWQgZHVyaW5nIHRoZSB1bnVzZWQgVHlwZVNjcmlwdCBmaWxlIGFuYWx5c2lzXG4gICAgICBjb25zdCBjdXJyZW50VW51c2VkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgICAgIGZvciAoY29uc3Qgc291cmNlRmlsZSBvZiBidWlsZGVyLmdldFNvdXJjZUZpbGVzKCkpIHtcbiAgICAgICAgaWYgKGludGVybmFsRmlsZXM/Lmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW5zdXJlIGFsbCBwcm9ncmFtIGZpbGVzIGFyZSBjb25zaWRlcmVkIHBhcnQgb2YgdGhlIGNvbXBpbGF0aW9uIGFuZCB3aWxsIGJlIHdhdGNoZWQuXG4gICAgICAgIC8vIFdlYnBhY2sgZG9lcyBub3Qgbm9ybWFsaXplIHBhdGhzLiBUaGVyZWZvcmUsIHdlIG5lZWQgdG8gbm9ybWFsaXplIHRoZSBwYXRoIHdpdGggRlMgc2VwZXJhdG9ycy5cbiAgICAgICAgY29tcGlsYXRpb24uZmlsZURlcGVuZGVuY2llcy5hZGQoZXh0ZXJuYWxpemVQYXRoKHNvdXJjZUZpbGUuZmlsZU5hbWUpKTtcblxuICAgICAgICAvLyBBZGQgYWxsIG5vbi1kZWNsYXJhdGlvbiBmaWxlcyB0byB0aGUgaW5pdGlhbCBzZXQgb2YgdW51c2VkIGZpbGVzLiBUaGUgc2V0IHdpbGwgYmVcbiAgICAgICAgLy8gYW5hbHl6ZWQgYW5kIHBydW5lZCBhZnRlciBhbGwgV2VicGFjayBtb2R1bGVzIGFyZSBmaW5pc2hlZCBidWlsZGluZy5cbiAgICAgICAgaWYgKCFzb3VyY2VGaWxlLmlzRGVjbGFyYXRpb25GaWxlKSB7XG4gICAgICAgICAgY3VycmVudFVudXNlZC5hZGQobm9ybWFsaXplUGF0aChzb3VyY2VGaWxlLmZpbGVOYW1lKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29tcGlsYXRpb24uaG9va3MuZmluaXNoTW9kdWxlcy50YXBQcm9taXNlKFBMVUdJTl9OQU1FLCBhc3luYyAobW9kdWxlcykgPT4ge1xuICAgICAgICAvLyBSZWJ1aWxkIGFueSByZW1haW5pbmcgQU9UIHJlcXVpcmVkIG1vZHVsZXNcbiAgICAgICAgYXdhaXQgdGhpcy5yZWJ1aWxkUmVxdWlyZWRGaWxlcyhtb2R1bGVzLCBjb21waWxhdGlvbiwgZmlsZUVtaXR0ZXIpO1xuXG4gICAgICAgIC8vIENsZWFyIG91dCB0aGUgV2VicGFjayBjb21waWxhdGlvbiB0byBhdm9pZCBhbiBleHRyYSByZXRhaW5pbmcgcmVmZXJlbmNlXG4gICAgICAgIHJlc291cmNlTG9hZGVyPy5jbGVhclBhcmVudENvbXBpbGF0aW9uKCk7XG5cbiAgICAgICAgLy8gQW5hbHl6ZSBwcm9ncmFtIGZvciB1bnVzZWQgZmlsZXNcbiAgICAgICAgaWYgKGNvbXBpbGF0aW9uLmVycm9ycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCB3ZWJwYWNrTW9kdWxlIG9mIG1vZHVsZXMpIHtcbiAgICAgICAgICBjb25zdCByZXNvdXJjZSA9ICh3ZWJwYWNrTW9kdWxlIGFzIE5vcm1hbE1vZHVsZSkucmVzb3VyY2U7XG4gICAgICAgICAgaWYgKHJlc291cmNlKSB7XG4gICAgICAgICAgICB0aGlzLm1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplUGF0aChyZXNvdXJjZSksIGN1cnJlbnRVbnVzZWQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgdW51c2VkIG9mIGN1cnJlbnRVbnVzZWQpIHtcbiAgICAgICAgICBpZiAocHJldmlvdXNVbnVzZWQgJiYgcHJldmlvdXNVbnVzZWQuaGFzKHVudXNlZCkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhZGRXYXJuaW5nKFxuICAgICAgICAgICAgY29tcGlsYXRpb24sXG4gICAgICAgICAgICBgJHt1bnVzZWR9IGlzIHBhcnQgb2YgdGhlIFR5cGVTY3JpcHQgY29tcGlsYXRpb24gYnV0IGl0J3MgdW51c2VkLlxcbmAgK1xuICAgICAgICAgICAgICBgQWRkIG9ubHkgZW50cnkgcG9pbnRzIHRvIHRoZSAnZmlsZXMnIG9yICdpbmNsdWRlJyBwcm9wZXJ0aWVzIGluIHlvdXIgdHNjb25maWcuYCxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHByZXZpb3VzVW51c2VkID0gY3VycmVudFVudXNlZDtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTdG9yZSBmaWxlIGVtaXR0ZXIgZm9yIGxvYWRlciB1c2FnZVxuICAgICAgZW1pdFJlZ2lzdHJhdGlvbi51cGRhdGUoZmlsZUVtaXR0ZXIpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZWdpc3RlcldpdGhDb21waWxhdGlvbihjb21waWxhdGlvbjogQ29tcGlsYXRpb24pIHtcbiAgICBsZXQgZmlsZUVtaXR0ZXJzID0gY29tcGlsYXRpb25GaWxlRW1pdHRlcnMuZ2V0KGNvbXBpbGF0aW9uKTtcbiAgICBpZiAoIWZpbGVFbWl0dGVycykge1xuICAgICAgZmlsZUVtaXR0ZXJzID0gbmV3IEZpbGVFbWl0dGVyQ29sbGVjdGlvbigpO1xuICAgICAgY29tcGlsYXRpb25GaWxlRW1pdHRlcnMuc2V0KGNvbXBpbGF0aW9uLCBmaWxlRW1pdHRlcnMpO1xuICAgICAgY29tcGlsYXRpb24uY29tcGlsZXIud2VicGFjay5Ob3JtYWxNb2R1bGUuZ2V0Q29tcGlsYXRpb25Ib29rcyhjb21waWxhdGlvbikubG9hZGVyLnRhcChcbiAgICAgICAgUExVR0lOX05BTUUsXG4gICAgICAgIChsb2FkZXJDb250ZXh0OiB7IFtBbmd1bGFyUGx1Z2luU3ltYm9sXT86IEZpbGVFbWl0dGVyQ29sbGVjdGlvbiB9KSA9PiB7XG4gICAgICAgICAgbG9hZGVyQ29udGV4dFtBbmd1bGFyUGx1Z2luU3ltYm9sXSA9IGZpbGVFbWl0dGVycztcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbnN0IGVtaXRSZWdpc3RyYXRpb24gPSBmaWxlRW1pdHRlcnMucmVnaXN0ZXIoKTtcblxuICAgIHJldHVybiBlbWl0UmVnaXN0cmF0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSBtYXJrUmVzb3VyY2VVc2VkKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGg6IHN0cmluZywgY3VycmVudFVudXNlZDogU2V0PHN0cmluZz4pOiB2b2lkIHtcbiAgICBpZiAoIWN1cnJlbnRVbnVzZWQuaGFzKG5vcm1hbGl6ZWRSZXNvdXJjZVBhdGgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY3VycmVudFVudXNlZC5kZWxldGUobm9ybWFsaXplZFJlc291cmNlUGF0aCk7XG4gICAgY29uc3QgZGVwZW5kZW5jaWVzID0gdGhpcy5maWxlRGVwZW5kZW5jaWVzLmdldChub3JtYWxpemVkUmVzb3VyY2VQYXRoKTtcbiAgICBpZiAoIWRlcGVuZGVuY2llcykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGRlcGVuZGVuY3kgb2YgZGVwZW5kZW5jaWVzKSB7XG4gICAgICB0aGlzLm1hcmtSZXNvdXJjZVVzZWQobm9ybWFsaXplUGF0aChkZXBlbmRlbmN5KSwgY3VycmVudFVudXNlZCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWJ1aWxkUmVxdWlyZWRGaWxlcyhcbiAgICBtb2R1bGVzOiBJdGVyYWJsZTxNb2R1bGU+LFxuICAgIGNvbXBpbGF0aW9uOiBDb21waWxhdGlvbixcbiAgICBmaWxlRW1pdHRlcjogRmlsZUVtaXR0ZXIsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGVzVG9SZWJ1aWxkID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCByZXF1aXJlZEZpbGUgb2YgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0KSB7XG4gICAgICBjb25zdCBoaXN0b3J5ID0gYXdhaXQgdGhpcy5nZXRGaWxlRW1pdEhpc3RvcnkocmVxdWlyZWRGaWxlKTtcbiAgICAgIGlmIChoaXN0b3J5KSB7XG4gICAgICAgIGNvbnN0IGVtaXRSZXN1bHQgPSBhd2FpdCBmaWxlRW1pdHRlcihyZXF1aXJlZEZpbGUpO1xuICAgICAgICBpZiAoXG4gICAgICAgICAgZW1pdFJlc3VsdD8uY29udGVudCA9PT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgaGlzdG9yeS5sZW5ndGggIT09IGVtaXRSZXN1bHQuY29udGVudC5sZW5ndGggfHxcbiAgICAgICAgICBlbWl0UmVzdWx0Lmhhc2ggPT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgIEJ1ZmZlci5jb21wYXJlKGhpc3RvcnkuaGFzaCwgZW1pdFJlc3VsdC5oYXNoKSAhPT0gMFxuICAgICAgICApIHtcbiAgICAgICAgICAvLyBOZXcgZW1pdCByZXN1bHQgaXMgZGlmZmVyZW50IHNvIHJlYnVpbGQgdXNpbmcgbmV3IGVtaXQgcmVzdWx0XG4gICAgICAgICAgdGhpcy5yZXF1aXJlZEZpbGVzVG9FbWl0Q2FjaGUuc2V0KHJlcXVpcmVkRmlsZSwgZW1pdFJlc3VsdCk7XG4gICAgICAgICAgZmlsZXNUb1JlYnVpbGQuYWRkKHJlcXVpcmVkRmlsZSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIE5vIGVtaXQgaGlzdG9yeSBzbyByZWJ1aWxkXG4gICAgICAgIGZpbGVzVG9SZWJ1aWxkLmFkZChyZXF1aXJlZEZpbGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChmaWxlc1RvUmVidWlsZC5zaXplID4gMCkge1xuICAgICAgY29uc3QgcmVidWlsZCA9ICh3ZWJwYWNrTW9kdWxlOiBNb2R1bGUpID0+XG4gICAgICAgIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiBjb21waWxhdGlvbi5yZWJ1aWxkTW9kdWxlKHdlYnBhY2tNb2R1bGUsICgpID0+IHJlc29sdmUoKSkpO1xuXG4gICAgICBjb25zdCBtb2R1bGVzVG9SZWJ1aWxkID0gW107XG4gICAgICBmb3IgKGNvbnN0IHdlYnBhY2tNb2R1bGUgb2YgbW9kdWxlcykge1xuICAgICAgICBjb25zdCByZXNvdXJjZSA9ICh3ZWJwYWNrTW9kdWxlIGFzIE5vcm1hbE1vZHVsZSkucmVzb3VyY2U7XG4gICAgICAgIGlmIChyZXNvdXJjZSAmJiBmaWxlc1RvUmVidWlsZC5oYXMobm9ybWFsaXplUGF0aChyZXNvdXJjZSkpKSB7XG4gICAgICAgICAgbW9kdWxlc1RvUmVidWlsZC5wdXNoKHdlYnBhY2tNb2R1bGUpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChtb2R1bGVzVG9SZWJ1aWxkLm1hcCgod2VicGFja01vZHVsZSkgPT4gcmVidWlsZCh3ZWJwYWNrTW9kdWxlKSkpO1xuICAgIH1cblxuICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdC5jbGVhcigpO1xuICAgIHRoaXMucmVxdWlyZWRGaWxlc1RvRW1pdENhY2hlLmNsZWFyKCk7XG4gIH1cblxuICBwcml2YXRlIGxvYWRDb25maWd1cmF0aW9uKCkge1xuICAgIGNvbnN0IHtcbiAgICAgIG9wdGlvbnM6IGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgIHJvb3ROYW1lcyxcbiAgICAgIGVycm9ycyxcbiAgICB9ID0gdGhpcy5jb21waWxlckNsaS5yZWFkQ29uZmlndXJhdGlvbihcbiAgICAgIHRoaXMucGx1Z2luT3B0aW9ucy50c2NvbmZpZyxcbiAgICAgIHRoaXMucGx1Z2luT3B0aW9ucy5jb21waWxlck9wdGlvbnMsXG4gICAgKTtcbiAgICBjb21waWxlck9wdGlvbnMuZW5hYmxlSXZ5ID0gdHJ1ZTtcbiAgICBjb21waWxlck9wdGlvbnMubm9FbWl0T25FcnJvciA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5zdXBwcmVzc091dHB1dFBhdGhDaGVjayA9IHRydWU7XG4gICAgY29tcGlsZXJPcHRpb25zLm91dERpciA9IHVuZGVmaW5lZDtcbiAgICBjb21waWxlck9wdGlvbnMuaW5saW5lU291cmNlcyA9IGNvbXBpbGVyT3B0aW9ucy5zb3VyY2VNYXA7XG4gICAgY29tcGlsZXJPcHRpb25zLmlubGluZVNvdXJjZU1hcCA9IGZhbHNlO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5tYXBSb290ID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5zb3VyY2VSb290ID0gdW5kZWZpbmVkO1xuICAgIGNvbXBpbGVyT3B0aW9ucy5hbGxvd0VtcHR5Q29kZWdlbkZpbGVzID0gZmFsc2U7XG4gICAgY29tcGlsZXJPcHRpb25zLmFubm90YXRpb25zQXMgPSAnZGVjb3JhdG9ycyc7XG4gICAgY29tcGlsZXJPcHRpb25zLmVuYWJsZVJlc291cmNlSW5saW5pbmcgPSBmYWxzZTtcblxuICAgIHJldHVybiB7IGNvbXBpbGVyT3B0aW9ucywgcm9vdE5hbWVzLCBlcnJvcnMgfTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlQW90UHJvZ3JhbShcbiAgICBjb21waWxlck9wdGlvbnM6IENvbXBpbGVyT3B0aW9ucyxcbiAgICByb290TmFtZXM6IHN0cmluZ1tdLFxuICAgIGhvc3Q6IENvbXBpbGVySG9zdCxcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyOiBEaWFnbm9zdGljc1JlcG9ydGVyLFxuICAgIHJlc291cmNlTG9hZGVyOiBXZWJwYWNrUmVzb3VyY2VMb2FkZXIsXG4gICkge1xuICAgIC8vIENyZWF0ZSB0aGUgQW5ndWxhciBzcGVjaWZpYyBwcm9ncmFtIHRoYXQgY29udGFpbnMgdGhlIEFuZ3VsYXIgY29tcGlsZXJcbiAgICBjb25zdCBhbmd1bGFyUHJvZ3JhbSA9IG5ldyB0aGlzLmNvbXBpbGVyQ2xpLk5ndHNjUHJvZ3JhbShcbiAgICAgIHJvb3ROYW1lcyxcbiAgICAgIGNvbXBpbGVyT3B0aW9ucyxcbiAgICAgIGhvc3QsXG4gICAgICB0aGlzLm5ndHNjTmV4dFByb2dyYW0sXG4gICAgKTtcbiAgICBjb25zdCBhbmd1bGFyQ29tcGlsZXIgPSBhbmd1bGFyUHJvZ3JhbS5jb21waWxlcjtcblxuICAgIC8vIFRoZSBgaWdub3JlRm9yRW1pdGAgcmV0dXJuIHZhbHVlIGNhbiBiZSBzYWZlbHkgaWdub3JlZCB3aGVuIGVtaXR0aW5nLiBPbmx5IGZpbGVzXG4gICAgLy8gdGhhdCB3aWxsIGJlIGJ1bmRsZWQgKHJlcXVlc3RlZCBieSBXZWJwYWNrKSB3aWxsIGJlIGVtaXR0ZWQuIENvbWJpbmVkIHdpdGggVHlwZVNjcmlwdCdzXG4gICAgLy8gZWxpZGluZyBvZiB0eXBlIG9ubHkgaW1wb3J0cywgdGhpcyB3aWxsIGNhdXNlIHR5cGUgb25seSBmaWxlcyB0byBiZSBhdXRvbWF0aWNhbGx5IGlnbm9yZWQuXG4gICAgLy8gSW50ZXJuYWwgQW5ndWxhciB0eXBlIGNoZWNrIGZpbGVzIGFyZSBhbHNvIG5vdCByZXNvbHZhYmxlIGJ5IHRoZSBidW5kbGVyLiBFdmVuIGlmIHRoZXlcbiAgICAvLyB3ZXJlIHNvbWVob3cgZXJyYW50bHkgaW1wb3J0ZWQsIHRoZSBidW5kbGVyIHdvdWxkIGVycm9yIGJlZm9yZSBhbiBlbWl0IHdhcyBhdHRlbXB0ZWQuXG4gICAgLy8gRGlhZ25vc3RpY3MgYXJlIHN0aWxsIGNvbGxlY3RlZCBmb3IgYWxsIGZpbGVzIHdoaWNoIHJlcXVpcmVzIHVzaW5nIGBpZ25vcmVGb3JEaWFnbm9zdGljc2AuXG4gICAgY29uc3QgeyBpZ25vcmVGb3JEaWFnbm9zdGljcywgaWdub3JlRm9yRW1pdCB9ID0gYW5ndWxhckNvbXBpbGVyO1xuXG4gICAgLy8gU291cmNlRmlsZSB2ZXJzaW9ucyBhcmUgcmVxdWlyZWQgZm9yIGJ1aWxkZXIgcHJvZ3JhbXMuXG4gICAgLy8gVGhlIHdyYXBwZWQgaG9zdCBpbnNpZGUgTmd0c2NQcm9ncmFtIGFkZHMgYWRkaXRpb25hbCBmaWxlcyB0aGF0IHdpbGwgbm90IGhhdmUgdmVyc2lvbnMuXG4gICAgY29uc3QgdHlwZVNjcmlwdFByb2dyYW0gPSBhbmd1bGFyUHJvZ3JhbS5nZXRUc1Byb2dyYW0oKTtcbiAgICBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nKHR5cGVTY3JpcHRQcm9ncmFtKTtcblxuICAgIGxldCBidWlsZGVyOiB0cy5CdWlsZGVyUHJvZ3JhbSB8IHRzLkVtaXRBbmRTZW1hbnRpY0RpYWdub3N0aWNzQnVpbGRlclByb2dyYW07XG4gICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICBidWlsZGVyID0gdGhpcy5idWlsZGVyID0gdHMuY3JlYXRlRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbShcbiAgICAgICAgdHlwZVNjcmlwdFByb2dyYW0sXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHRoaXMuYnVpbGRlcixcbiAgICAgICk7XG4gICAgICB0aGlzLm5ndHNjTmV4dFByb2dyYW0gPSBhbmd1bGFyUHJvZ3JhbTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gV2hlbiBub3QgaW4gd2F0Y2ggbW9kZSwgdGhlIHN0YXJ0dXAgY29zdCBvZiB0aGUgaW5jcmVtZW50YWwgYW5hbHlzaXMgY2FuIGJlIGF2b2lkZWQgYnlcbiAgICAgIC8vIHVzaW5nIGFuIGFic3RyYWN0IGJ1aWxkZXIgdGhhdCBvbmx5IHdyYXBzIGEgVHlwZVNjcmlwdCBwcm9ncmFtLlxuICAgICAgYnVpbGRlciA9IHRzLmNyZWF0ZUFic3RyYWN0QnVpbGRlcih0eXBlU2NyaXB0UHJvZ3JhbSwgaG9zdCk7XG4gICAgfVxuXG4gICAgLy8gVXBkYXRlIHNlbWFudGljIGRpYWdub3N0aWNzIGNhY2hlXG4gICAgY29uc3QgYWZmZWN0ZWRGaWxlcyA9IG5ldyBTZXQ8dHMuU291cmNlRmlsZT4oKTtcblxuICAgIC8vIEFuYWx5emUgYWZmZWN0ZWQgZmlsZXMgd2hlbiBpbiB3YXRjaCBtb2RlIGZvciBpbmNyZW1lbnRhbCB0eXBlIGNoZWNraW5nXG4gICAgaWYgKCdnZXRTZW1hbnRpY0RpYWdub3N0aWNzT2ZOZXh0QWZmZWN0ZWRGaWxlJyBpbiBidWlsZGVyKSB7XG4gICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbm8tY29uc3RhbnQtY29uZGl0aW9uXG4gICAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBidWlsZGVyLmdldFNlbWFudGljRGlhZ25vc3RpY3NPZk5leHRBZmZlY3RlZEZpbGUodW5kZWZpbmVkLCAoc291cmNlRmlsZSkgPT4ge1xuICAgICAgICAgIC8vIElmIHRoZSBhZmZlY3RlZCBmaWxlIGlzIGEgVFRDIHNoaW0sIGFkZCB0aGUgc2hpbSdzIG9yaWdpbmFsIHNvdXJjZSBmaWxlLlxuICAgICAgICAgIC8vIFRoaXMgZW5zdXJlcyB0aGF0IGNoYW5nZXMgdGhhdCBhZmZlY3QgVFRDIGFyZSB0eXBlY2hlY2tlZCBldmVuIHdoZW4gdGhlIGNoYW5nZXNcbiAgICAgICAgICAvLyBhcmUgb3RoZXJ3aXNlIHVucmVsYXRlZCBmcm9tIGEgVFMgcGVyc3BlY3RpdmUgYW5kIGRvIG5vdCByZXN1bHQgaW4gSXZ5IGNvZGVnZW4gY2hhbmdlcy5cbiAgICAgICAgICAvLyBGb3IgZXhhbXBsZSwgY2hhbmdpbmcgQElucHV0IHByb3BlcnR5IHR5cGVzIG9mIGEgZGlyZWN0aXZlIHVzZWQgaW4gYW5vdGhlciBjb21wb25lbnQnc1xuICAgICAgICAgIC8vIHRlbXBsYXRlLlxuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSAmJlxuICAgICAgICAgICAgc291cmNlRmlsZS5maWxlTmFtZS5lbmRzV2l0aCgnLm5ndHlwZWNoZWNrLnRzJylcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIC8vIFRoaXMgZmlsZSBuYW1lIGNvbnZlcnNpb24gcmVsaWVzIG9uIGludGVybmFsIGNvbXBpbGVyIGxvZ2ljIGFuZCBzaG91bGQgYmUgY29udmVydGVkXG4gICAgICAgICAgICAvLyB0byBhbiBvZmZpY2lhbCBtZXRob2Qgd2hlbiBhdmFpbGFibGUuIDE1IGlzIGxlbmd0aCBvZiBgLm5ndHlwZWNoZWNrLnRzYFxuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxGaWxlbmFtZSA9IHNvdXJjZUZpbGUuZmlsZU5hbWUuc2xpY2UoMCwgLTE1KSArICcudHMnO1xuICAgICAgICAgICAgY29uc3Qgb3JpZ2luYWxTb3VyY2VGaWxlID0gYnVpbGRlci5nZXRTb3VyY2VGaWxlKG9yaWdpbmFsRmlsZW5hbWUpO1xuICAgICAgICAgICAgaWYgKG9yaWdpbmFsU291cmNlRmlsZSkge1xuICAgICAgICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChvcmlnaW5hbFNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBhZmZlY3RlZEZpbGVzLmFkZChyZXN1bHQuYWZmZWN0ZWQgYXMgdHMuU291cmNlRmlsZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ29sbGVjdCBwcm9ncmFtIGxldmVsIGRpYWdub3N0aWNzXG4gICAgY29uc3QgZGlhZ25vc3RpY3MgPSBbXG4gICAgICAuLi5hbmd1bGFyQ29tcGlsZXIuZ2V0T3B0aW9uRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0T3B0aW9uc0RpYWdub3N0aWNzKCksXG4gICAgICAuLi5idWlsZGVyLmdldEdsb2JhbERpYWdub3N0aWNzKCksXG4gICAgXTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGRpYWdub3N0aWNzKTtcblxuICAgIC8vIENvbGxlY3Qgc291cmNlIGZpbGUgc3BlY2lmaWMgZGlhZ25vc3RpY3NcbiAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICBpZiAoIWlnbm9yZUZvckRpYWdub3N0aWNzLmhhcyhzb3VyY2VGaWxlKSkge1xuICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGJ1aWxkZXIuZ2V0U3ludGFjdGljRGlhZ25vc3RpY3Moc291cmNlRmlsZSkpO1xuICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGJ1aWxkZXIuZ2V0U2VtYW50aWNEaWFnbm9zdGljcyhzb3VyY2VGaWxlKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgdHJhbnNmb3JtZXJzID0gY3JlYXRlQW90VHJhbnNmb3JtZXJzKGJ1aWxkZXIsIHRoaXMucGx1Z2luT3B0aW9ucyk7XG5cbiAgICBjb25zdCBnZXREZXBlbmRlbmNpZXMgPSAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHJlc291cmNlUGF0aCBvZiBhbmd1bGFyQ29tcGlsZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoc291cmNlRmlsZSkpIHtcbiAgICAgICAgZGVwZW5kZW5jaWVzLnB1c2goXG4gICAgICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgICAgIC8vIFJldHJpZXZlIGFsbCBkZXBlbmRlbmNpZXMgb2YgdGhlIHJlc291cmNlIChzdHlsZXNoZWV0IGltcG9ydHMsIGV0Yy4pXG4gICAgICAgICAgLi4ucmVzb3VyY2VMb2FkZXIuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMocmVzb3VyY2VQYXRoKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRlcGVuZGVuY2llcztcbiAgICB9O1xuXG4gICAgLy8gUmVxdWlyZWQgdG8gc3VwcG9ydCBhc3luY2hyb25vdXMgcmVzb3VyY2UgbG9hZGluZ1xuICAgIC8vIE11c3QgYmUgZG9uZSBiZWZvcmUgY3JlYXRpbmcgdHJhbnNmb3JtZXJzIG9yIGdldHRpbmcgdGVtcGxhdGUgZGlhZ25vc3RpY3NcbiAgICBjb25zdCBwZW5kaW5nQW5hbHlzaXMgPSBhbmd1bGFyQ29tcGlsZXJcbiAgICAgIC5hbmFseXplQXN5bmMoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuY2xlYXIoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IHNvdXJjZUZpbGUgb2YgYnVpbGRlci5nZXRTb3VyY2VGaWxlcygpKSB7XG4gICAgICAgICAgaWYgKHNvdXJjZUZpbGUuaXNEZWNsYXJhdGlvbkZpbGUpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIENvbGxlY3Qgc291cmNlcyB0aGF0IGFyZSByZXF1aXJlZCB0byBiZSBlbWl0dGVkXG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIWlnbm9yZUZvckVtaXQuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhYW5ndWxhckNvbXBpbGVyLmluY3JlbWVudGFsRHJpdmVyLnNhZmVUb1NraXBFbWl0KHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuYWRkKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuXG4gICAgICAgICAgICAvLyBJZiByZXF1aXJlZCB0byBlbWl0LCBkaWFnbm9zdGljcyBtYXkgaGF2ZSBhbHNvIGNoYW5nZWRcbiAgICAgICAgICAgIGlmICghaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpKSB7XG4gICAgICAgICAgICAgIGFmZmVjdGVkRmlsZXMuYWRkKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZSAmJlxuICAgICAgICAgICAgIWFmZmVjdGVkRmlsZXMuaGFzKHNvdXJjZUZpbGUpICYmXG4gICAgICAgICAgICAhaWdub3JlRm9yRGlhZ25vc3RpY3MuaGFzKHNvdXJjZUZpbGUpXG4gICAgICAgICAgKSB7XG4gICAgICAgICAgICAvLyBVc2UgY2FjaGVkIEFuZ3VsYXIgZGlhZ25vc3RpY3MgZm9yIHVuY2hhbmdlZCBhbmQgdW5hZmZlY3RlZCBmaWxlc1xuICAgICAgICAgICAgY29uc3QgYW5ndWxhckRpYWdub3N0aWNzID0gdGhpcy5zb3VyY2VGaWxlQ2FjaGUuZ2V0QW5ndWxhckRpYWdub3N0aWNzKHNvdXJjZUZpbGUpO1xuICAgICAgICAgICAgaWYgKGFuZ3VsYXJEaWFnbm9zdGljcykge1xuICAgICAgICAgICAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGFuZ3VsYXJEaWFnbm9zdGljcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ29sbGVjdCBuZXcgQW5ndWxhciBkaWFnbm9zdGljcyBmb3IgZmlsZXMgYWZmZWN0ZWQgYnkgY2hhbmdlc1xuICAgICAgICBjb25zdCBPcHRpbWl6ZUZvciA9IHRoaXMuY29tcGlsZXJDbGkuT3B0aW1pemVGb3I7XG4gICAgICAgIGNvbnN0IG9wdGltaXplRGlhZ25vc3RpY3NGb3IgPVxuICAgICAgICAgIGFmZmVjdGVkRmlsZXMuc2l6ZSA8PSBESUFHTk9TVElDU19BRkZFQ1RFRF9USFJFU0hPTERcbiAgICAgICAgICAgID8gT3B0aW1pemVGb3IuU2luZ2xlRmlsZVxuICAgICAgICAgICAgOiBPcHRpbWl6ZUZvci5XaG9sZVByb2dyYW07XG4gICAgICAgIGZvciAoY29uc3QgYWZmZWN0ZWRGaWxlIG9mIGFmZmVjdGVkRmlsZXMpIHtcbiAgICAgICAgICBjb25zdCBhbmd1bGFyRGlhZ25vc3RpY3MgPSBhbmd1bGFyQ29tcGlsZXIuZ2V0RGlhZ25vc3RpY3NGb3JGaWxlKFxuICAgICAgICAgICAgYWZmZWN0ZWRGaWxlLFxuICAgICAgICAgICAgb3B0aW1pemVEaWFnbm9zdGljc0ZvcixcbiAgICAgICAgICApO1xuICAgICAgICAgIGRpYWdub3N0aWNzUmVwb3J0ZXIoYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgICB0aGlzLnNvdXJjZUZpbGVDYWNoZT8udXBkYXRlQW5ndWxhckRpYWdub3N0aWNzKGFmZmVjdGVkRmlsZSwgYW5ndWxhckRpYWdub3N0aWNzKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZW1pdHRlcjogdGhpcy5jcmVhdGVGaWxlRW1pdHRlcihcbiAgICAgICAgICAgIGJ1aWxkZXIsXG4gICAgICAgICAgICBtZXJnZVRyYW5zZm9ybWVycyhhbmd1bGFyQ29tcGlsZXIucHJlcGFyZUVtaXQoKS50cmFuc2Zvcm1lcnMsIHRyYW5zZm9ybWVycyksXG4gICAgICAgICAgICBnZXREZXBlbmRlbmNpZXMsXG4gICAgICAgICAgICAoc291cmNlRmlsZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXQuZGVsZXRlKG5vcm1hbGl6ZVBhdGgoc291cmNlRmlsZS5maWxlTmFtZSkpO1xuICAgICAgICAgICAgICBhbmd1bGFyQ29tcGlsZXIuaW5jcmVtZW50YWxEcml2ZXIucmVjb3JkU3VjY2Vzc2Z1bEVtaXQoc291cmNlRmlsZSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICksXG4gICAgICAgIH07XG4gICAgICB9KVxuICAgICAgLmNhdGNoKChlcnIpID0+ICh7IGVycm9yTWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IGAke2Vycn1gIH0pKTtcblxuICAgIGNvbnN0IGFuYWx5emluZ0ZpbGVFbWl0dGVyOiBGaWxlRW1pdHRlciA9IGFzeW5jIChmaWxlKSA9PiB7XG4gICAgICBjb25zdCBhbmFseXNpcyA9IGF3YWl0IHBlbmRpbmdBbmFseXNpcztcblxuICAgICAgaWYgKCdlcnJvck1lc3NhZ2UnIGluIGFuYWx5c2lzKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihhbmFseXNpcy5lcnJvck1lc3NhZ2UpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYW5hbHlzaXMuZW1pdHRlcihmaWxlKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiBhbmFseXppbmdGaWxlRW1pdHRlcixcbiAgICAgIGJ1aWxkZXIsXG4gICAgICBpbnRlcm5hbEZpbGVzOiBpZ25vcmVGb3JFbWl0LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZUppdFByb2dyYW0oXG4gICAgY29tcGlsZXJPcHRpb25zOiBDb21waWxlck9wdGlvbnMsXG4gICAgcm9vdE5hbWVzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgICBob3N0OiBDb21waWxlckhvc3QsXG4gICAgZGlhZ25vc3RpY3NSZXBvcnRlcjogRGlhZ25vc3RpY3NSZXBvcnRlcixcbiAgKSB7XG4gICAgbGV0IGJ1aWxkZXI7XG4gICAgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICBidWlsZGVyID0gdGhpcy5idWlsZGVyID0gdHMuY3JlYXRlRW1pdEFuZFNlbWFudGljRGlhZ25vc3RpY3NCdWlsZGVyUHJvZ3JhbShcbiAgICAgICAgcm9vdE5hbWVzLFxuICAgICAgICBjb21waWxlck9wdGlvbnMsXG4gICAgICAgIGhvc3QsXG4gICAgICAgIHRoaXMuYnVpbGRlcixcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFdoZW4gbm90IGluIHdhdGNoIG1vZGUsIHRoZSBzdGFydHVwIGNvc3Qgb2YgdGhlIGluY3JlbWVudGFsIGFuYWx5c2lzIGNhbiBiZSBhdm9pZGVkIGJ5XG4gICAgICAvLyB1c2luZyBhbiBhYnN0cmFjdCBidWlsZGVyIHRoYXQgb25seSB3cmFwcyBhIFR5cGVTY3JpcHQgcHJvZ3JhbS5cbiAgICAgIGJ1aWxkZXIgPSB0cy5jcmVhdGVBYnN0cmFjdEJ1aWxkZXIocm9vdE5hbWVzLCBjb21waWxlck9wdGlvbnMsIGhvc3QpO1xuICAgIH1cblxuICAgIGNvbnN0IGRpYWdub3N0aWNzID0gW1xuICAgICAgLi4uYnVpbGRlci5nZXRPcHRpb25zRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0R2xvYmFsRGlhZ25vc3RpY3MoKSxcbiAgICAgIC4uLmJ1aWxkZXIuZ2V0U3ludGFjdGljRGlhZ25vc3RpY3MoKSxcbiAgICAgIC8vIEdhdGhlciBpbmNyZW1lbnRhbCBzZW1hbnRpYyBkaWFnbm9zdGljc1xuICAgICAgLi4uYnVpbGRlci5nZXRTZW1hbnRpY0RpYWdub3N0aWNzKCksXG4gICAgXTtcbiAgICBkaWFnbm9zdGljc1JlcG9ydGVyKGRpYWdub3N0aWNzKTtcblxuICAgIGNvbnN0IHRyYW5zZm9ybWVycyA9IGNyZWF0ZUppdFRyYW5zZm9ybWVycyhidWlsZGVyLCB0aGlzLmNvbXBpbGVyQ2xpLCB0aGlzLnBsdWdpbk9wdGlvbnMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGZpbGVFbWl0dGVyOiB0aGlzLmNyZWF0ZUZpbGVFbWl0dGVyKGJ1aWxkZXIsIHRyYW5zZm9ybWVycywgKCkgPT4gW10pLFxuICAgICAgYnVpbGRlcixcbiAgICAgIGludGVybmFsRmlsZXM6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVGaWxlRW1pdHRlcihcbiAgICBwcm9ncmFtOiB0cy5CdWlsZGVyUHJvZ3JhbSxcbiAgICB0cmFuc2Zvcm1lcnM6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyA9IHt9LFxuICAgIGdldEV4dHJhRGVwZW5kZW5jaWVzOiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4gSXRlcmFibGU8c3RyaW5nPixcbiAgICBvbkFmdGVyRW1pdD86IChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB2b2lkLFxuICApOiBGaWxlRW1pdHRlciB7XG4gICAgcmV0dXJuIGFzeW5jIChmaWxlOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGVQYXRoID0gbm9ybWFsaXplUGF0aChmaWxlKTtcbiAgICAgIGlmICh0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5oYXMoZmlsZVBhdGgpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlcXVpcmVkRmlsZXNUb0VtaXRDYWNoZS5nZXQoZmlsZVBhdGgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2VGaWxlID0gcHJvZ3JhbS5nZXRTb3VyY2VGaWxlKGZpbGVQYXRoKTtcbiAgICAgIGlmICghc291cmNlRmlsZSkge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBsZXQgY29udGVudDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgbGV0IG1hcDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgcHJvZ3JhbS5lbWl0KFxuICAgICAgICBzb3VyY2VGaWxlLFxuICAgICAgICAoZmlsZW5hbWUsIGRhdGEpID0+IHtcbiAgICAgICAgICBpZiAoZmlsZW5hbWUuZW5kc1dpdGgoJy5tYXAnKSkge1xuICAgICAgICAgICAgbWFwID0gZGF0YTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKCcuanMnKSkge1xuICAgICAgICAgICAgY29udGVudCA9IGRhdGE7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdHJhbnNmb3JtZXJzLFxuICAgICAgKTtcblxuICAgICAgb25BZnRlckVtaXQ/Lihzb3VyY2VGaWxlKTtcblxuICAgICAgLy8gQ2FwdHVyZSBlbWl0IGhpc3RvcnkgaW5mbyBmb3IgQW5ndWxhciByZWJ1aWxkIGFuYWx5c2lzXG4gICAgICBjb25zdCBoYXNoID0gY29udGVudCA/IChhd2FpdCB0aGlzLmFkZEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCwgY29udGVudCkpLmhhc2ggOiB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGRlcGVuZGVuY2llcyA9IFtcbiAgICAgICAgLi4uKHRoaXMuZmlsZURlcGVuZGVuY2llcy5nZXQoZmlsZVBhdGgpIHx8IFtdKSxcbiAgICAgICAgLi4uZ2V0RXh0cmFEZXBlbmRlbmNpZXMoc291cmNlRmlsZSksXG4gICAgICBdLm1hcChleHRlcm5hbGl6ZVBhdGgpO1xuXG4gICAgICByZXR1cm4geyBjb250ZW50LCBtYXAsIGRlcGVuZGVuY2llcywgaGFzaCB9O1xuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluaXRpYWxpemVDb21waWxlckNsaSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5jb21waWxlckNsaU1vZHVsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFRoaXMgdXNlcyBhIGR5bmFtaWMgaW1wb3J0IHRvIGxvYWQgYEBhbmd1bGFyL2NvbXBpbGVyLWNsaWAgd2hpY2ggbWF5IGJlIEVTTS5cbiAgICAvLyBDb21tb25KUyBjb2RlIGNhbiBsb2FkIEVTTSBjb2RlIHZpYSBhIGR5bmFtaWMgaW1wb3J0LiBVbmZvcnR1bmF0ZWx5LCBUeXBlU2NyaXB0XG4gICAgLy8gd2lsbCBjdXJyZW50bHksIHVuY29uZGl0aW9uYWxseSBkb3dubGV2ZWwgZHluYW1pYyBpbXBvcnQgaW50byBhIHJlcXVpcmUgY2FsbC5cbiAgICAvLyByZXF1aXJlIGNhbGxzIGNhbm5vdCBsb2FkIEVTTSBjb2RlIGFuZCB3aWxsIHJlc3VsdCBpbiBhIHJ1bnRpbWUgZXJyb3IuIFRvIHdvcmthcm91bmRcbiAgICAvLyB0aGlzLCBhIEZ1bmN0aW9uIGNvbnN0cnVjdG9yIGlzIHVzZWQgdG8gcHJldmVudCBUeXBlU2NyaXB0IGZyb20gY2hhbmdpbmcgdGhlIGR5bmFtaWMgaW1wb3J0LlxuICAgIC8vIE9uY2UgVHlwZVNjcmlwdCBwcm92aWRlcyBzdXBwb3J0IGZvciBrZWVwaW5nIHRoZSBkeW5hbWljIGltcG9ydCB0aGlzIHdvcmthcm91bmQgY2FuXG4gICAgLy8gYmUgZHJvcHBlZC5cbiAgICB0aGlzLmNvbXBpbGVyQ2xpTW9kdWxlID0gYXdhaXQgbmV3IEZ1bmN0aW9uKGByZXR1cm4gaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKTtgKSgpO1xuICAgIHRoaXMuY29tcGlsZXJOZ2NjTW9kdWxlID0gYXdhaXQgbmV3IEZ1bmN0aW9uKGByZXR1cm4gaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGkvbmdjYycpO2ApKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFkZEZpbGVFbWl0SGlzdG9yeShcbiAgICBmaWxlUGF0aDogc3RyaW5nLFxuICAgIGNvbnRlbnQ6IHN0cmluZyxcbiAgKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtPiB7XG4gICAgY29uc3QgaGlzdG9yeURhdGE6IEZpbGVFbWl0SGlzdG9yeUl0ZW0gPSB7XG4gICAgICBsZW5ndGg6IGNvbnRlbnQubGVuZ3RoLFxuICAgICAgaGFzaDogY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGNvbnRlbnQpLmRpZ2VzdCgpLFxuICAgIH07XG5cbiAgICBpZiAodGhpcy53ZWJwYWNrQ2FjaGUpIHtcbiAgICAgIGNvbnN0IGhpc3RvcnkgPSBhd2FpdCB0aGlzLmdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aCk7XG4gICAgICBpZiAoIWhpc3RvcnkgfHwgQnVmZmVyLmNvbXBhcmUoaGlzdG9yeS5oYXNoLCBoaXN0b3J5RGF0YS5oYXNoKSAhPT0gMCkge1xuICAgICAgICAvLyBIYXNoIGRvZXNuJ3QgbWF0Y2ggb3IgaXRlbSBkb2Vzbid0IGV4aXN0LlxuICAgICAgICBhd2FpdCB0aGlzLndlYnBhY2tDYWNoZS5zdG9yZVByb21pc2UoZmlsZVBhdGgsIG51bGwsIGhpc3RvcnlEYXRhKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHRoaXMud2F0Y2hNb2RlKSB7XG4gICAgICAvLyBUaGUgaW4gbWVtb3J5IGZpbGUgZW1pdCBoaXN0b3J5IGlzIG9ubHkgcmVxdWlyZWQgZHVyaW5nIHdhdGNoIG1vZGUuXG4gICAgICB0aGlzLmZpbGVFbWl0SGlzdG9yeS5zZXQoZmlsZVBhdGgsIGhpc3RvcnlEYXRhKTtcbiAgICB9XG5cbiAgICByZXR1cm4gaGlzdG9yeURhdGE7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGdldEZpbGVFbWl0SGlzdG9yeShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxGaWxlRW1pdEhpc3RvcnlJdGVtIHwgdW5kZWZpbmVkPiB7XG4gICAgcmV0dXJuIHRoaXMud2VicGFja0NhY2hlXG4gICAgICA/IHRoaXMud2VicGFja0NhY2hlLmdldFByb21pc2U8RmlsZUVtaXRIaXN0b3J5SXRlbSB8IHVuZGVmaW5lZD4oZmlsZVBhdGgsIG51bGwpXG4gICAgICA6IHRoaXMuZmlsZUVtaXRIaXN0b3J5LmdldChmaWxlUGF0aCk7XG4gIH1cbn1cbiJdfQ==