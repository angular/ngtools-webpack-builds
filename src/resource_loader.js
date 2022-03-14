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
exports.WebpackResourceLoader = void 0;
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
const paths_1 = require("./ivy/paths");
const inline_resource_1 = require("./loaders/inline-resource");
const replace_resources_1 = require("./transformers/replace_resources");
class WebpackResourceLoader {
    constructor(shouldCache) {
        this._fileDependencies = new Map();
        this._reverseDependencies = new Map();
        this.modifiedResources = new Set();
        this.outputPathCounter = 1;
        this.inlineDataLoaderPath = inline_resource_1.InlineAngularResourceLoaderPath;
        if (shouldCache) {
            this.fileCache = new Map();
            this.assetCache = new Map();
        }
    }
    update(parentCompilation, changedFiles) {
        var _a, _b, _c, _d, _e;
        this._parentCompilation = parentCompilation;
        // Update resource cache and modified resources
        this.modifiedResources.clear();
        if (changedFiles) {
            for (const changedFile of changedFiles) {
                const changedFileNormalized = (0, paths_1.normalizePath)(changedFile);
                (_a = this.assetCache) === null || _a === void 0 ? void 0 : _a.delete(changedFileNormalized);
                for (const affectedResource of this.getAffectedResources(changedFile)) {
                    const affectedResourceNormalized = (0, paths_1.normalizePath)(affectedResource);
                    (_b = this.fileCache) === null || _b === void 0 ? void 0 : _b.delete(affectedResourceNormalized);
                    this.modifiedResources.add(affectedResource);
                    for (const effectedDependencies of this.getResourceDependencies(affectedResourceNormalized)) {
                        (_c = this.assetCache) === null || _c === void 0 ? void 0 : _c.delete((0, paths_1.normalizePath)(effectedDependencies));
                    }
                }
            }
        }
        else {
            (_d = this.fileCache) === null || _d === void 0 ? void 0 : _d.clear();
            (_e = this.assetCache) === null || _e === void 0 ? void 0 : _e.clear();
        }
        // Re-emit all assets for un-effected files
        if (this.assetCache) {
            for (const [, { name, source, info }] of this.assetCache) {
                this._parentCompilation.emitAsset(name, source, info);
            }
        }
    }
    clearParentCompilation() {
        this._parentCompilation = undefined;
    }
    getModifiedResourceFiles() {
        return this.modifiedResources;
    }
    getResourceDependencies(filePath) {
        return this._fileDependencies.get(filePath) || [];
    }
    getAffectedResources(file) {
        return this._reverseDependencies.get(file) || [];
    }
    setAffectedResources(file, resources) {
        this._reverseDependencies.set(file, new Set(resources));
    }
    async _compile(filePath, data, fileExtension, resourceType, containingFile) {
        if (!this._parentCompilation) {
            throw new Error('WebpackResourceLoader cannot be used without parentCompilation');
        }
        const getEntry = () => {
            if (filePath) {
                return `${filePath}?${replace_resources_1.NG_COMPONENT_RESOURCE_QUERY}`;
            }
            else if (resourceType) {
                return (
                // app.component.ts-2.css?ngResource!=!@ngtools/webpack/src/loaders/inline-resource.js!app.component.ts
                `${containingFile}-${this.outputPathCounter}.${fileExtension}` +
                    `?${replace_resources_1.NG_COMPONENT_RESOURCE_QUERY}!=!${this.inlineDataLoaderPath}!${containingFile}`);
            }
            else if (data) {
                // Create a special URL for reading the resource from memory
                return `angular-resource:${resourceType},${(0, crypto_1.createHash)('md5').update(data).digest('hex')}`;
            }
            throw new Error(`"filePath", "resourceType" or "data" must be specified.`);
        };
        const entry = getEntry();
        // Simple sanity check.
        if (filePath === null || filePath === void 0 ? void 0 : filePath.match(/\.[jt]s$/)) {
            throw new Error(`Cannot use a JavaScript or TypeScript file (${filePath}) in a component's styleUrls or templateUrl.`);
        }
        const outputFilePath = filePath ||
            `${containingFile}-angular-inline--${this.outputPathCounter++}.${resourceType === 'template' ? 'html' : 'css'}`;
        const outputOptions = {
            filename: outputFilePath,
            library: {
                type: 'var',
                name: 'resource',
            },
        };
        const { context, webpack } = this._parentCompilation.compiler;
        const { EntryPlugin, NormalModule, library, node, sources } = webpack;
        const childCompiler = this._parentCompilation.createChildCompiler('angular-compiler:resource', outputOptions, [
            new node.NodeTemplatePlugin(outputOptions),
            new node.NodeTargetPlugin(),
            new EntryPlugin(context, entry, { name: 'resource' }),
            new library.EnableLibraryPlugin('var'),
        ]);
        childCompiler.hooks.thisCompilation.tap('angular-compiler', (compilation, { normalModuleFactory }) => {
            // If no data is provided, the resource will be read from the filesystem
            if (data !== undefined) {
                normalModuleFactory.hooks.resolveForScheme
                    .for('angular-resource')
                    .tap('angular-compiler', (resourceData) => {
                    if (filePath) {
                        resourceData.path = filePath;
                        resourceData.resource = filePath;
                    }
                    return true;
                });
                NormalModule.getCompilationHooks(compilation)
                    .readResourceForScheme.for('angular-resource')
                    .tap('angular-compiler', () => data);
                compilation[inline_resource_1.InlineAngularResourceSymbol] = data;
            }
            compilation.hooks.additionalAssets.tap('angular-compiler', () => {
                const asset = compilation.assets[outputFilePath];
                if (!asset) {
                    return;
                }
                try {
                    const output = this._evaluate(outputFilePath, asset.source().toString());
                    if (typeof output === 'string') {
                        compilation.assets[outputFilePath] = new sources.RawSource(output);
                    }
                }
                catch (error) {
                    // Use compilation errors, as otherwise webpack will choke
                    compilation.errors.push(error);
                }
            });
        });
        let finalContent;
        childCompiler.hooks.compilation.tap('angular-compiler', (childCompilation) => {
            childCompilation.hooks.processAssets.tap({ name: 'angular-compiler', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
                var _a;
                finalContent = (_a = childCompilation.assets[outputFilePath]) === null || _a === void 0 ? void 0 : _a.source().toString();
                for (const { files } of childCompilation.chunks) {
                    for (const file of files) {
                        childCompilation.deleteAsset(file);
                    }
                }
            });
        });
        return new Promise((resolve, reject) => {
            childCompiler.runAsChild((error, _, childCompilation) => {
                var _a, _b;
                if (error) {
                    reject(error);
                    return;
                }
                else if (!childCompilation) {
                    reject(new Error('Unknown child compilation error'));
                    return;
                }
                // Workaround to attempt to reduce memory usage of child compilations.
                // This removes the child compilation from the main compilation and manually propagates
                // all dependencies, warnings, and errors.
                const parent = childCompiler.parentCompilation;
                if (parent) {
                    parent.children = parent.children.filter((child) => child !== childCompilation);
                    let fileDependencies;
                    for (const dependency of childCompilation.fileDependencies) {
                        // Skip paths that do not appear to be files (have no extension).
                        // `fileDependencies` can contain directories and not just files which can
                        // cause incorrect cache invalidation on rebuilds.
                        if (!path.extname(dependency)) {
                            continue;
                        }
                        if (data && containingFile && dependency.endsWith(entry)) {
                            // use containing file if the resource was inline
                            parent.fileDependencies.add(containingFile);
                        }
                        else {
                            parent.fileDependencies.add(dependency);
                        }
                        // Save the dependencies for this resource.
                        if (filePath) {
                            const resolvedFile = (0, paths_1.normalizePath)(dependency);
                            const entry = this._reverseDependencies.get(resolvedFile);
                            if (entry) {
                                entry.add(filePath);
                            }
                            else {
                                this._reverseDependencies.set(resolvedFile, new Set([filePath]));
                            }
                            if (fileDependencies) {
                                fileDependencies.add(dependency);
                            }
                            else {
                                fileDependencies = new Set([dependency]);
                                this._fileDependencies.set(filePath, fileDependencies);
                            }
                        }
                    }
                    parent.contextDependencies.addAll(childCompilation.contextDependencies);
                    parent.missingDependencies.addAll(childCompilation.missingDependencies);
                    parent.buildDependencies.addAll(childCompilation.buildDependencies);
                    parent.warnings.push(...childCompilation.warnings);
                    parent.errors.push(...childCompilation.errors);
                    if (this.assetCache) {
                        for (const { info, name, source } of childCompilation.getAssets()) {
                            // Use the originating file as the cache key if present
                            // Otherwise, generate a cache key based on the generated name
                            const cacheKey = (_a = info.sourceFilename) !== null && _a !== void 0 ? _a : `!![GENERATED]:${name}`;
                            this.assetCache.set(cacheKey, { info, name, source });
                        }
                    }
                }
                resolve({
                    content: finalContent !== null && finalContent !== void 0 ? finalContent : '',
                    success: ((_b = childCompilation.errors) === null || _b === void 0 ? void 0 : _b.length) === 0,
                });
            });
        });
    }
    _evaluate(filename, source) {
        var _a;
        // Evaluate code
        const context = {};
        try {
            vm.runInNewContext(source, context, { filename });
        }
        catch (_b) {
            // Error are propagated through the child compilation.
            return null;
        }
        if (typeof context.resource === 'string') {
            return context.resource;
        }
        else if (typeof ((_a = context.resource) === null || _a === void 0 ? void 0 : _a.default) === 'string') {
            return context.resource.default;
        }
        throw new Error(`The loader "${filename}" didn't return a string.`);
    }
    async get(filePath) {
        var _a;
        const normalizedFile = (0, paths_1.normalizePath)(filePath);
        let compilationResult = (_a = this.fileCache) === null || _a === void 0 ? void 0 : _a.get(normalizedFile);
        if (compilationResult === undefined) {
            // cache miss so compile resource
            compilationResult = await this._compile(filePath);
            // Only cache if compilation was successful
            if (this.fileCache && compilationResult.success) {
                this.fileCache.set(normalizedFile, compilationResult);
            }
        }
        return compilationResult.content;
    }
    async process(data, fileExtension, resourceType, containingFile) {
        if (data.trim().length === 0) {
            return '';
        }
        const compilationResult = await this._compile(undefined, data, fileExtension, resourceType, containingFile);
        return compilationResult.content;
    }
}
exports.WebpackResourceLoader = WebpackResourceLoader;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2VfbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9yZXNvdXJjZV9sb2FkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILG1DQUFvQztBQUNwQywyQ0FBNkI7QUFDN0IsdUNBQXlCO0FBRXpCLHVDQUE0QztBQUM1QywrREFJbUM7QUFDbkMsd0VBQStFO0FBUS9FLE1BQWEscUJBQXFCO0lBYWhDLFlBQVksV0FBb0I7UUFYeEIsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQXVCLENBQUM7UUFDbkQseUJBQW9CLEdBQUcsSUFBSSxHQUFHLEVBQXVCLENBQUM7UUFLdEQsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztRQUN0QyxzQkFBaUIsR0FBRyxDQUFDLENBQUM7UUFFYix5QkFBb0IsR0FBRyxpREFBK0IsQ0FBQztRQUd0RSxJQUFJLFdBQVcsRUFBRTtZQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7U0FDN0I7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLGlCQUE4QixFQUFFLFlBQStCOztRQUNwRSxJQUFJLENBQUMsa0JBQWtCLEdBQUcsaUJBQWlCLENBQUM7UUFFNUMsK0NBQStDO1FBQy9DLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUUvQixJQUFJLFlBQVksRUFBRTtZQUNoQixLQUFLLE1BQU0sV0FBVyxJQUFJLFlBQVksRUFBRTtnQkFDdEMsTUFBTSxxQkFBcUIsR0FBRyxJQUFBLHFCQUFhLEVBQUMsV0FBVyxDQUFDLENBQUM7Z0JBQ3pELE1BQUEsSUFBSSxDQUFDLFVBQVUsMENBQUUsTUFBTSxDQUFDLHFC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QWdCOztRQUN4QixNQUFNLGNBQWMsR0FBRyxJQUFBLHFCQUFhLEVBQUMsUUFBUSxDQUFDLENBQUM7UUFDL0MsSUFBSSxpQkFBaUIsR0FBRyxNQUFBLElBQUksQ0FBQyxTQUFTLDBDQUFFLEdBQUcsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUU1RCxJQUFJLGlCQUFpQixLQUFLLFNBQVMsRUFBRTtZQUNuQyxpQ0FBaUM7WUFDakMsaUJBQWlCLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBRWxELDJDQUEyQztZQUMzQyxJQUFJLElBQUksQ0FBQyxTQUFTLElBQUksaUJBQWlCLENBQUMsT0FBTyxFQUFFO2dCQUMvQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsaUJBQWlCLENBQUMsQ0FBQzthQUN2RDtTQUNGO1FBRUQsT0FBTyxpQkFBaUIsQ0FBQyxPQUFPLENBQUM7SUFDbkMsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQ1gsSUFBWSxFQUNaLGFBQWlDLEVBQ2pDLFlBQWtDLEVBQ2xDLGNBQXVCO1FBRXZCLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7WUFDNUIsT0FBTyxFQUFFLENBQUM7U0FDWDtRQUVELE1BQU0saUJBQWlCLEdBQUcsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUMzQyxTQUFTLEVBQ1QsSUFBSSxFQUNKLGFBQWEsRUFDYixZQUFZLEVBQ1osY0FBYyxDQUNmLENBQUM7UUFFRixPQUFPLGlCQUFpQixDQUFDLE9BQU8sQ0FBQztJQUNuQyxDQUFDO0NBQ0Y7QUE5VUQsc0RBOFVDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHZtIGZyb20gJ3ZtJztcbmltcG9ydCB0eXBlIHsgQXNzZXQsIENvbXBpbGF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoIH0gZnJvbSAnLi9pdnkvcGF0aHMnO1xuaW1wb3J0IHtcbiAgQ29tcGlsYXRpb25XaXRoSW5saW5lQW5ndWxhclJlc291cmNlLFxuICBJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRoLFxuICBJbmxpbmVBbmd1bGFyUmVzb3VyY2VTeW1ib2wsXG59IGZyb20gJy4vbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UnO1xuaW1wb3J0IHsgTkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZIH0gZnJvbSAnLi90cmFuc2Zvcm1lcnMvcmVwbGFjZV9yZXNvdXJjZXMnO1xuXG5pbnRlcmZhY2UgQ29tcGlsYXRpb25PdXRwdXQge1xuICBjb250ZW50OiBzdHJpbmc7XG4gIG1hcD86IHN0cmluZztcbiAgc3VjY2VzczogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYnBhY2tSZXNvdXJjZUxvYWRlciB7XG4gIHByaXZhdGUgX3BhcmVudENvbXBpbGF0aW9uPzogQ29tcGlsYXRpb247XG4gIHByaXZhdGUgX2ZpbGVEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG4gIHByaXZhdGUgX3JldmVyc2VEZXBlbmRlbmNpZXMgPSBuZXcgTWFwPHN0cmluZywgU2V0PHN0cmluZz4+KCk7XG5cbiAgcHJpdmF0ZSBmaWxlQ2FjaGU/OiBNYXA8c3RyaW5nLCBDb21waWxhdGlvbk91dHB1dD47XG4gIHByaXZhdGUgYXNzZXRDYWNoZT86IE1hcDxzdHJpbmcsIEFzc2V0PjtcblxuICBwcml2YXRlIG1vZGlmaWVkUmVzb3VyY2VzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIHByaXZhdGUgb3V0cHV0UGF0aENvdW50ZXIgPSAxO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgaW5saW5lRGF0YUxvYWRlclBhdGggPSBJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRoO1xuXG4gIGNvbnN0cnVjdG9yKHNob3VsZENhY2hlOiBib29sZWFuKSB7XG4gICAgaWYgKHNob3VsZENhY2hlKSB7XG4gICAgICB0aGlzLmZpbGVDYWNoZSA9IG5ldyBNYXAoKTtcbiAgICAgIHRoaXMuYXNzZXRDYWNoZSA9IG5ldyBNYXAoKTtcbiAgICB9XG4gIH1cblxuICB1cGRhdGUocGFyZW50Q29tcGlsYXRpb246IENvbXBpbGF0aW9uLCBjaGFuZ2VkRmlsZXM/OiBJdGVyYWJsZTxzdHJpbmc+KSB7XG4gICAgdGhpcy5fcGFyZW50Q29tcGlsYXRpb24gPSBwYXJlbnRDb21waWxhdGlvbjtcblxuICAgIC8vIFVwZGF0ZSByZXNvdXJjZSBjYWNoZSBhbmQgbW9kaWZpZWQgcmVzb3VyY2VzXG4gICAgdGhpcy5tb2RpZmllZFJlc291cmNlcy5jbGVhcigpO1xuXG4gICAgaWYgKGNoYW5nZWRGaWxlcykge1xuICAgICAgZm9yIChjb25zdCBjaGFuZ2VkRmlsZSBvZiBjaGFuZ2VkRmlsZXMpIHtcbiAgICAgICAgY29uc3QgY2hhbmdlZEZpbGVOb3JtYWxpemVkID0gbm9ybWFsaXplUGF0aChjaGFuZ2VkRmlsZSk7XG4gICAgICAgIHRoaXMuYXNzZXRDYWNoZT8uZGVsZXRlKGNoYW5nZWRGaWxlTm9ybWFsaXplZCk7XG5cbiAgICAgICAgZm9yIChjb25zdCBhZmZlY3RlZFJlc291cmNlIG9mIHRoaXMuZ2V0QWZmZWN0ZWRSZXNvdXJjZXMoY2hhbmdlZEZpbGUpKSB7XG4gICAgICAgICAgY29uc3QgYWZmZWN0ZWRSZXNvdXJjZU5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKGFmZmVjdGVkUmVzb3VyY2UpO1xuICAgICAgICAgIHRoaXMuZmlsZUNhY2hlPy5kZWxldGUoYWZmZWN0ZWRSZXNvdXJjZU5vcm1hbGl6ZWQpO1xuICAgICAgICAgIHRoaXMubW9kaWZpZWRSZXNvdXJjZXMuYWRkKGFmZmVjdGVkUmVzb3VyY2UpO1xuXG4gICAgICAgICAgZm9yIChjb25zdCBlZmZlY3RlZERlcGVuZGVuY2llcyBvZiB0aGlzLmdldFJlc291cmNlRGVwZW5kZW5jaWVzKFxuICAgICAgICAgICAgYWZmZWN0ZWRSZXNvdXJjZU5vcm1hbGl6ZWQsXG4gICAgICAgICAgKSkge1xuICAgICAgICAgICAgdGhpcy5hc3NldENhY2hlPy5kZWxldGUobm9ybWFsaXplUGF0aChlZmZlY3RlZERlcGVuZGVuY2llcykpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmZpbGVDYWNoZT8uY2xlYXIoKTtcbiAgICAgIHRoaXMuYXNzZXRDYWNoZT8uY2xlYXIoKTtcbiAgICB9XG5cbiAgICAvLyBSZS1lbWl0IGFsbCBhc3NldHMgZm9yIHVuLWVmZmVjdGVkIGZpbGVzXG4gICAgaWYgKHRoaXMuYXNzZXRDYWNoZSkge1xuICAgICAgZm9yIChjb25zdCBbLCB7IG5hbWUsIHNvdXJjZSwgaW5mbyB9XSBvZiB0aGlzLmFzc2V0Q2FjaGUpIHtcbiAgICAgICAgdGhpcy5fcGFyZW50Q29tcGlsYXRpb24uZW1pdEFzc2V0KG5hbWUsIHNvdXJjZSwgaW5mbyk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgY2xlYXJQYXJlbnRDb21waWxhdGlvbigpIHtcbiAgICB0aGlzLl9wYXJlbnRDb21waWxhdGlvbiA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGdldE1vZGlmaWVkUmVzb3VyY2VGaWxlcygpIHtcbiAgICByZXR1cm4gdGhpcy5tb2RpZmllZFJlc291cmNlcztcbiAgfVxuXG4gIGdldFJlc291cmNlRGVwZW5kZW5jaWVzKGZpbGVQYXRoOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fZmlsZURlcGVuZGVuY2llcy5nZXQoZmlsZVBhdGgpIHx8IFtdO1xuICB9XG5cbiAgZ2V0QWZmZWN0ZWRSZXNvdXJjZXMoZmlsZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JldmVyc2VEZXBlbmRlbmNpZXMuZ2V0KGZpbGUpIHx8IFtdO1xuICB9XG5cbiAgc2V0QWZmZWN0ZWRSZXNvdXJjZXMoZmlsZTogc3RyaW5nLCByZXNvdXJjZXM6IEl0ZXJhYmxlPHN0cmluZz4pIHtcbiAgICB0aGlzLl9yZXZlcnNlRGVwZW5kZW5jaWVzLnNldChmaWxlLCBuZXcgU2V0KHJlc291cmNlcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBfY29tcGlsZShcbiAgICBmaWxlUGF0aD86IHN0cmluZyxcbiAgICBkYXRhPzogc3RyaW5nLFxuICAgIGZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4gICAgcmVzb3VyY2VUeXBlPzogJ3N0eWxlJyB8ICd0ZW1wbGF0ZScsXG4gICAgY29udGFpbmluZ0ZpbGU/OiBzdHJpbmcsXG4gICk6IFByb21pc2U8Q29tcGlsYXRpb25PdXRwdXQ+IHtcbiAgICBpZiAoIXRoaXMuX3BhcmVudENvbXBpbGF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1dlYnBhY2tSZXNvdXJjZUxvYWRlciBjYW5ub3QgYmUgdXNlZCB3aXRob3V0IHBhcmVudENvbXBpbGF0aW9uJyk7XG4gICAgfVxuXG4gICAgY29uc3QgZ2V0RW50cnkgPSAoKTogc3RyaW5nID0+IHtcbiAgICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgICByZXR1cm4gYCR7ZmlsZVBhdGh9PyR7TkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZfWA7XG4gICAgICB9IGVsc2UgaWYgKHJlc291cmNlVHlwZSkge1xuICAgICAgICByZXR1cm4gKFxuICAgICAgICAgIC8vIGFwcC5jb21wb25lbnQudHMtMi5jc3M/bmdSZXNvdXJjZSE9IUBuZ3Rvb2xzL3dlYnBhY2svc3JjL2xvYWRlcnMvaW5saW5lLXJlc291cmNlLmpzIWFwcC5jb21wb25lbnQudHNcbiAgICAgICAgICBgJHtjb250YWluaW5nRmlsZX0tJHt0aGlzLm91dHB1dFBhdGhDb3VudGVyfS4ke2ZpbGVFeHRlbnNpb259YCArXG4gICAgICAgICAgYD8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX0hPSEke3RoaXMuaW5saW5lRGF0YUxvYWRlclBhdGh9ISR7Y29udGFpbmluZ0ZpbGV9YFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChkYXRhKSB7XG4gICAgICAgIC8vIENyZWF0ZSBhIHNwZWNpYWwgVVJMIGZvciByZWFkaW5nIHRoZSByZXNvdXJjZSBmcm9tIG1lbW9yeVxuICAgICAgICByZXR1cm4gYGFuZ3VsYXItcmVzb3VyY2U6JHtyZXNvdXJjZVR5cGV9LCR7Y3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGRhdGEpLmRpZ2VzdCgnaGV4Jyl9YDtcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBcImZpbGVQYXRoXCIsIFwicmVzb3VyY2VUeXBlXCIgb3IgXCJkYXRhXCIgbXVzdCBiZSBzcGVjaWZpZWQuYCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGVudHJ5ID0gZ2V0RW50cnkoKTtcblxuICAgIC8vIFNpbXBsZSBzYW5pdHkgY2hlY2suXG4gICAgaWYgKGZpbGVQYXRoPy5tYXRjaCgvXFwuW2p0XXMkLykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYENhbm5vdCB1c2UgYSBKYXZhU2NyaXB0IG9yIFR5cGVTY3JpcHQgZmlsZSAoJHtmaWxlUGF0aH0pIGluIGEgY29tcG9uZW50J3Mgc3R5bGVVcmxzIG9yIHRlbXBsYXRlVXJsLmAsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IG91dHB1dEZpbGVQYXRoID1cbiAgICAgIGZpbGVQYXRoIHx8XG4gICAgICBgJHtjb250YWluaW5nRmlsZX0tYW5ndWxhci1pbmxpbmUtLSR7dGhpcy5vdXRwdXRQYXRoQ291bnRlcisrfS4ke1xuICAgICAgICByZXNvdXJjZVR5cGUgPT09ICd0ZW1wbGF0ZScgPyAnaHRtbCcgOiAnY3NzJ1xuICAgICAgfWA7XG4gICAgY29uc3Qgb3V0cHV0T3B0aW9ucyA9IHtcbiAgICAgIGZpbGVuYW1lOiBvdXRwdXRGaWxlUGF0aCxcbiAgICAgIGxpYnJhcnk6IHtcbiAgICAgICAgdHlwZTogJ3ZhcicsXG4gICAgICAgIG5hbWU6ICdyZXNvdXJjZScsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCB7IGNvbnRleHQsIHdlYnBhY2sgfSA9IHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmNvbXBpbGVyO1xuICAgIGNvbnN0IHsgRW50cnlQbHVnaW4sIE5vcm1hbE1vZHVsZSwgbGlicmFyeSwgbm9kZSwgc291cmNlcyB9ID0gd2VicGFjaztcbiAgICBjb25zdCBjaGlsZENvbXBpbGVyID0gdGhpcy5fcGFyZW50Q29tcGlsYXRpb24uY3JlYXRlQ2hpbGRDb21waWxlcihcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyOnJlc291cmNlJyxcbiAgICAgIG91dHB1dE9wdGlvbnMsXG4gICAgICBbXG4gICAgICAgIG5ldyBub2RlLk5vZGVUZW1wbGF0ZVBsdWdpbihvdXRwdXRPcHRpb25zKSxcbiAgICAgICAgbmV3IG5vZGUuTm9kZVRhcmdldFBsdWdpbigpLFxuICAgICAgICBuZXcgRW50cnlQbHVnaW4oY29udGV4dCwgZW50cnksIHsgbmFtZTogJ3Jlc291cmNlJyB9KSxcbiAgICAgICAgbmV3IGxpYnJhcnkuRW5hYmxlTGlicmFyeVBsdWdpbigndmFyJyksXG4gICAgICBdLFxuICAgICk7XG5cbiAgICBjaGlsZENvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoXG4gICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAoY29tcGlsYXRpb24sIHsgbm9ybWFsTW9kdWxlRmFjdG9yeSB9KSA9PiB7XG4gICAgICAgIC8vIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQsIHRoZSByZXNvdXJjZSB3aWxsIGJlIHJlYWQgZnJvbSB0aGUgZmlsZXN5c3RlbVxuICAgICAgICBpZiAoZGF0YSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbm9ybWFsTW9kdWxlRmFjdG9yeS5ob29rcy5yZXNvbHZlRm9yU2NoZW1lXG4gICAgICAgICAgICAuZm9yKCdhbmd1bGFyLXJlc291cmNlJylcbiAgICAgICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVzb3VyY2VEYXRhKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIHJlc291cmNlRGF0YS5wYXRoID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VEYXRhLnJlc291cmNlID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIE5vcm1hbE1vZHVsZS5nZXRDb21waWxhdGlvbkhvb2tzKGNvbXBpbGF0aW9uKVxuICAgICAgICAgICAgLnJlYWRSZXNvdXJjZUZvclNjaGVtZS5mb3IoJ2FuZ3VsYXItcmVzb3VyY2UnKVxuICAgICAgICAgICAgLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IGRhdGEpO1xuXG4gICAgICAgICAgKGNvbXBpbGF0aW9uIGFzIENvbXBpbGF0aW9uV2l0aElubGluZUFuZ3VsYXJSZXNvdXJjZSlbSW5saW5lQW5ndWxhclJlc291cmNlU3ltYm9sXSA9IGRhdGE7XG4gICAgICAgIH1cblxuICAgICAgICBjb21waWxhdGlvbi5ob29rcy5hZGRpdGlvbmFsQXNzZXRzLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgICAgICBjb25zdCBhc3NldCA9IGNvbXBpbGF0aW9uLmFzc2V0c1tvdXRwdXRGaWxlUGF0aF07XG4gICAgICAgICAgaWYgKCFhc3NldCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvdXRwdXQgPSB0aGlzLl9ldmFsdWF0ZShvdXRwdXRGaWxlUGF0aCwgYXNzZXQuc291cmNlKCkudG9TdHJpbmcoKSk7XG5cbiAgICAgICAgICAgIGlmICh0eXBlb2Ygb3V0cHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBjb21waWxhdGlvbi5hc3NldHNbb3V0cHV0RmlsZVBhdGhdID0gbmV3IHNvdXJjZXMuUmF3U291cmNlKG91dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIFVzZSBjb21waWxhdGlvbiBlcnJvcnMsIGFzIG90aGVyd2lzZSB3ZWJwYWNrIHdpbGwgY2hva2VcbiAgICAgICAgICAgIGNvbXBpbGF0aW9uLmVycm9ycy5wdXNoKGVycm9yKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICApO1xuXG4gICAgbGV0IGZpbmFsQ29udGVudDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGNoaWxkQ29tcGlsZXIuaG9va3MuY29tcGlsYXRpb24udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKGNoaWxkQ29tcGlsYXRpb24pID0+IHtcbiAgICAgIGNoaWxkQ29tcGlsYXRpb24uaG9va3MucHJvY2Vzc0Fzc2V0cy50YXAoXG4gICAgICAgIHsgbmFtZTogJ2FuZ3VsYXItY29tcGlsZXInLCBzdGFnZTogd2VicGFjay5Db21waWxhdGlvbi5QUk9DRVNTX0FTU0VUU19TVEFHRV9SRVBPUlQgfSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgIGZpbmFsQ29udGVudCA9IGNoaWxkQ29tcGlsYXRpb24uYXNzZXRzW291dHB1dEZpbGVQYXRoXT8uc291cmNlKCkudG9TdHJpbmcoKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgeyBmaWxlcyB9IG9mIGNoaWxkQ29tcGlsYXRpb24uY2h1bmtzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgICAgICAgICAgY2hpbGRDb21waWxhdGlvbi5kZWxldGVBc3NldChmaWxlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPENvbXBpbGF0aW9uT3V0cHV0PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjaGlsZENvbXBpbGVyLnJ1bkFzQ2hpbGQoKGVycm9yLCBfLCBjaGlsZENvbXBpbGF0aW9uKSA9PiB7XG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIHJlamVjdChlcnJvcik7XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSBpZiAoIWNoaWxkQ29tcGlsYXRpb24pIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdVbmtub3duIGNoaWxkIGNvbXBpbGF0aW9uIGVycm9yJykpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gV29ya2Fyb3VuZCB0byBhdHRlbXB0IHRvIHJlZHVjZSBtZW1vcnkgdXNhZ2Ugb2YgY2hpbGQgY29tcGlsYXRpb25zLlxuICAgICAgICAvLyBUaGlzIHJlbW92ZXMgdGhlIGNoaWxkIGNvbXBpbGF0aW9uIGZyb20gdGhlIG1haW4gY29tcGlsYXRpb24gYW5kIG1hbnVhbGx5IHByb3BhZ2F0ZXNcbiAgICAgICAgLy8gYWxsIGRlcGVuZGVuY2llcywgd2FybmluZ3MsIGFuZCBlcnJvcnMuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGNoaWxkQ29tcGlsZXIucGFyZW50Q29tcGlsYXRpb247XG4gICAgICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgICBwYXJlbnQuY2hpbGRyZW4gPSBwYXJlbnQuY2hpbGRyZW4uZmlsdGVyKChjaGlsZCkgPT4gY2hpbGQgIT09IGNoaWxkQ29tcGlsYXRpb24pO1xuICAgICAgICAgIGxldCBmaWxlRGVwZW5kZW5jaWVzOiBTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeSBvZiBjaGlsZENvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIC8vIFNraXAgcGF0aHMgdGhhdCBkbyBub3QgYXBwZWFyIHRvIGJlIGZpbGVzIChoYXZlIG5vIGV4dGVuc2lvbikuXG4gICAgICAgICAgICAvLyBgZmlsZURlcGVuZGVuY2llc2AgY2FuIGNvbnRhaW4gZGlyZWN0b3JpZXMgYW5kIG5vdCBqdXN0IGZpbGVzIHdoaWNoIGNhblxuICAgICAgICAgICAgLy8gY2F1c2UgaW5jb3JyZWN0IGNhY2hlIGludmFsaWRhdGlvbiBvbiByZWJ1aWxkcy5cbiAgICAgICAgICAgIGlmICghcGF0aC5leHRuYW1lKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZGF0YSAmJiBjb250YWluaW5nRmlsZSAmJiBkZXBlbmRlbmN5LmVuZHNXaXRoKGVudHJ5KSkge1xuICAgICAgICAgICAgICAvLyB1c2UgY29udGFpbmluZyBmaWxlIGlmIHRoZSByZXNvdXJjZSB3YXMgaW5saW5lXG4gICAgICAgICAgICAgIHBhcmVudC5maWxlRGVwZW5kZW5jaWVzLmFkZChjb250YWluaW5nRmlsZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBwYXJlbnQuZmlsZURlcGVuZGVuY2llcy5hZGQoZGVwZW5kZW5jeSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNhdmUgdGhlIGRlcGVuZGVuY2llcyBmb3IgdGhpcyByZXNvdXJjZS5cbiAgICAgICAgICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICBjb25zdCByZXNvbHZlZEZpbGUgPSBub3JtYWxpemVQYXRoKGRlcGVuZGVuY3kpO1xuICAgICAgICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3JldmVyc2VEZXBlbmRlbmNpZXMuZ2V0KHJlc29sdmVkRmlsZSk7XG4gICAgICAgICAgICAgIGlmIChlbnRyeSkge1xuICAgICAgICAgICAgICAgIGVudHJ5LmFkZChmaWxlUGF0aCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fcmV2ZXJzZURlcGVuZGVuY2llcy5zZXQocmVzb2x2ZWRGaWxlLCBuZXcgU2V0KFtmaWxlUGF0aF0pKTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGlmIChmaWxlRGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICAgICAgZmlsZURlcGVuZGVuY2llcy5hZGQoZGVwZW5kZW5jeSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZmlsZURlcGVuZGVuY2llcyA9IG5ldyBTZXQoW2RlcGVuZGVuY3ldKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9maWxlRGVwZW5kZW5jaWVzLnNldChmaWxlUGF0aCwgZmlsZURlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJlbnQuY29udGV4dERlcGVuZGVuY2llcy5hZGRBbGwoY2hpbGRDb21waWxhdGlvbi5jb250ZXh0RGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICBwYXJlbnQubWlzc2luZ0RlcGVuZGVuY2llcy5hZGRBbGwoY2hpbGRDb21waWxhdGlvbi5taXNzaW5nRGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICBwYXJlbnQuYnVpbGREZXBlbmRlbmNpZXMuYWRkQWxsKGNoaWxkQ29tcGlsYXRpb24uYnVpbGREZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgICAgcGFyZW50Lndhcm5pbmdzLnB1c2goLi4uY2hpbGRDb21waWxhdGlvbi53YXJuaW5ncyk7XG4gICAgICAgICAgcGFyZW50LmVycm9ycy5wdXNoKC4uLmNoaWxkQ29tcGlsYXRpb24uZXJyb3JzKTtcblxuICAgICAgICAgIGlmICh0aGlzLmFzc2V0Q2FjaGUpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBpbmZvLCBuYW1lLCBzb3VyY2UgfSBvZiBjaGlsZENvbXBpbGF0aW9uLmdldEFzc2V0cygpKSB7XG4gICAgICAgICAgICAgIC8vIFVzZSB0aGUgb3JpZ2luYXRpbmcgZmlsZSBhcyB0aGUgY2FjaGUga2V5IGlmIHByZXNlbnRcbiAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCBnZW5lcmF0ZSBhIGNhY2hlIGtleSBiYXNlZCBvbiB0aGUgZ2VuZXJhdGVkIG5hbWVcbiAgICAgICAgICAgICAgY29uc3QgY2FjaGVLZXkgPSBpbmZvLnNvdXJjZUZpbGVuYW1lID8/IGAhIVtHRU5FUkFURURdOiR7bmFtZX1gO1xuXG4gICAgICAgICAgICAgIHRoaXMuYXNzZXRDYWNoZS5zZXQoY2FjaGVLZXksIHsgaW5mbywgbmFtZSwgc291cmNlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgIGNvbnRlbnQ6IGZpbmFsQ29udGVudCA/PyAnJyxcbiAgICAgICAgICBzdWNjZXNzOiBjaGlsZENvbXBpbGF0aW9uLmVycm9ycz8ubGVuZ3RoID09PSAwLFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfZXZhbHVhdGUoZmlsZW5hbWU6IHN0cmluZywgc291cmNlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBFdmFsdWF0ZSBjb2RlXG4gICAgY29uc3QgY29udGV4dDogeyByZXNvdXJjZT86IHN0cmluZyB8IHsgZGVmYXVsdD86IHN0cmluZyB9IH0gPSB7fTtcblxuICAgIHRyeSB7XG4gICAgICB2bS5ydW5Jbk5ld0NvbnRleHQoc291cmNlLCBjb250ZXh0LCB7IGZpbGVuYW1lIH0pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gRXJyb3IgYXJlIHByb3BhZ2F0ZWQgdGhyb3VnaCB0aGUgY2hpbGQgY29tcGlsYXRpb24uXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbnRleHQucmVzb3VyY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gY29udGV4dC5yZXNvdXJjZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250ZXh0LnJlc291cmNlPy5kZWZhdWx0ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGNvbnRleHQucmVzb3VyY2UuZGVmYXVsdDtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBsb2FkZXIgXCIke2ZpbGVuYW1lfVwiIGRpZG4ndCByZXR1cm4gYSBzdHJpbmcuYCk7XG4gIH1cblxuICBhc3luYyBnZXQoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEZpbGUgPSBub3JtYWxpemVQYXRoKGZpbGVQYXRoKTtcbiAgICBsZXQgY29tcGlsYXRpb25SZXN1bHQgPSB0aGlzLmZpbGVDYWNoZT8uZ2V0KG5vcm1hbGl6ZWRGaWxlKTtcblxuICAgIGlmIChjb21waWxhdGlvblJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBjYWNoZSBtaXNzIHNvIGNvbXBpbGUgcmVzb3VyY2VcbiAgICAgIGNvbXBpbGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5fY29tcGlsZShmaWxlUGF0aCk7XG5cbiAgICAgIC8vIE9ubHkgY2FjaGUgaWYgY29tcGlsYXRpb24gd2FzIHN1Y2Nlc3NmdWxcbiAgICAgIGlmICh0aGlzLmZpbGVDYWNoZSAmJiBjb21waWxhdGlvblJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHRoaXMuZmlsZUNhY2hlLnNldChub3JtYWxpemVkRmlsZSwgY29tcGlsYXRpb25SZXN1bHQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb21waWxhdGlvblJlc3VsdC5jb250ZW50O1xuICB9XG5cbiAgYXN5bmMgcHJvY2VzcyhcbiAgICBkYXRhOiBzdHJpbmcsXG4gICAgZmlsZUV4dGVuc2lvbjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHJlc291cmNlVHlwZTogJ3RlbXBsYXRlJyB8ICdzdHlsZScsXG4gICAgY29udGFpbmluZ0ZpbGU/OiBzdHJpbmcsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKGRhdGEudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBpbGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5fY29tcGlsZShcbiAgICAgIHVuZGVmaW5lZCxcbiAgICAgIGRhdGEsXG4gICAgICBmaWxlRXh0ZW5zaW9uLFxuICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgY29udGFpbmluZ0ZpbGUsXG4gICAgKTtcblxuICAgIHJldHVybiBjb21waWxhdGlvblJlc3VsdC5jb250ZW50O1xuICB9XG59XG4iXX0=