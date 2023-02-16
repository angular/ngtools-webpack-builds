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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebpackResourceLoader = void 0;
const node_assert_1 = __importDefault(require("node:assert"));
const node_buffer_1 = require("node:buffer");
const path = __importStar(require("node:path"));
const vm = __importStar(require("node:vm"));
const diagnostics_1 = require("./ivy/diagnostics");
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
        this._parentCompilation = parentCompilation;
        // Update resource cache and modified resources
        this.modifiedResources.clear();
        if (changedFiles) {
            for (const changedFile of changedFiles) {
                const changedFileNormalized = (0, paths_1.normalizePath)(changedFile);
                this.assetCache?.delete(changedFileNormalized);
                for (const affectedResource of this.getAffectedResources(changedFile)) {
                    const affectedResourceNormalized = (0, paths_1.normalizePath)(affectedResource);
                    this.fileCache?.delete(affectedResourceNormalized);
                    this.modifiedResources.add(affectedResource);
                    for (const effectedDependencies of this.getResourceDependencies(affectedResourceNormalized)) {
                        this.assetCache?.delete((0, paths_1.normalizePath)(effectedDependencies));
                    }
                }
            }
        }
        else {
            this.fileCache?.clear();
            this.assetCache?.clear();
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
    // eslint-disable-next-line max-lines-per-function
    async _compile(filePath, data, fileExtension, resourceType, containingFile) {
        if (!this._parentCompilation) {
            throw new Error('WebpackResourceLoader cannot be used without parentCompilation');
        }
        const { context, webpack } = this._parentCompilation.compiler;
        const { EntryPlugin, NormalModule, WebpackError, library, node, sources, util: { createHash }, } = webpack;
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
                return `angular-resource:${resourceType},${createHash('xxhash64')
                    .update(data)
                    .digest('hex')}`;
            }
            throw new Error(`"filePath", "resourceType" or "data" must be specified.`);
        };
        const entry = getEntry();
        // Simple sanity check.
        if (filePath?.match(/\.[jt]s$/)) {
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
                    (0, node_assert_1.default)(error instanceof Error, 'catch clause variable is not an Error instance');
                    // Use compilation errors, as otherwise webpack will choke
                    (0, diagnostics_1.addError)(compilation, error.message);
                }
            });
        });
        let finalContent;
        childCompiler.hooks.compilation.tap('angular-compiler', (childCompilation) => {
            childCompilation.hooks.processAssets.tap({ name: 'angular-compiler', stage: webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
                finalContent = childCompilation.assets[outputFilePath]?.source().toString();
                for (const { files } of childCompilation.chunks) {
                    for (const file of files) {
                        childCompilation.deleteAsset(file);
                    }
                }
            });
        });
        return new Promise((resolve, reject) => {
            childCompiler.runAsChild((error, _, childCompilation) => {
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
                            const cacheKey = info.sourceFilename ?? `!![GENERATED]:${name}`;
                            this.assetCache.set(cacheKey, { info, name, source });
                        }
                    }
                }
                resolve({
                    content: finalContent ?? '',
                    success: childCompilation.errors?.length === 0,
                });
            });
        });
    }
    _evaluate(filename, source) {
        // Evaluate code
        // css-loader requires the btoa function to exist to correctly generate inline sourcemaps
        const context = {
            btoa(input) {
                return node_buffer_1.Buffer.from(input).toString('base64');
            },
        };
        try {
            vm.runInNewContext(source, context, { filename });
        }
        catch {
            // Error are propagated through the child compilation.
            return null;
        }
        if (typeof context.resource === 'string') {
            return context.resource;
        }
        else if (typeof context.resource?.default === 'string') {
            return context.resource.default;
        }
        throw new Error(`The loader "${filename}" didn't return a string.`);
    }
    async get(filePath) {
        const normalizedFile = (0, paths_1.normalizePath)(filePath);
        let compilationResult = this.fileCache?.get(normalizedFile);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2VfbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9yZXNvdXJjZV9sb2FkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCw4REFBaUM7QUFDakMsNkNBQXFDO0FBQ3JDLGdEQUFrQztBQUNsQyw0Q0FBOEI7QUFFOUIsbURBQTZDO0FBQzdDLHVDQUE0QztBQUM1QywrREFJbUM7QUFDbkMsd0VBQStFO0FBUS9FLE1BQWEscUJBQXFCO0lBYWhDLFlBQVksV0FBb0I7UUFYeEIsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQXVCLENBQUM7UUFDbkQseUJBQW9CLEdBQUcsSUFBSSxHQUFHLEVBQXVCLENBQUM7UUFLdEQsc0JBQWlCLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztRQUN0QyxzQkFBaUIsR0FBRyxDQUFDLENBQUM7UUFFYix5QkFBb0IsR0FBRyxpREFBK0IsQ0FBQztRQUd0RSxJQUFJLFdBQVcsRUFBRTtZQUNmLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQztZQUMzQixJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7U0FDN0I7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLGlCQUE4QixFQUFFLFlBQStCO1FBQ3BFLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxpQkFBaUIsQ0FBQztRQUU1QywrQ0FBK0M7UUFDL0MsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEtBQUssRUFBRSxDQUFDO1FBRS9CLElBQUksWUFBWSxFQUFFO1lBQ2hCLEtBQUssTUFBTSxXQUFXLElBQUksWUFBWSxFQUFFO2dCQUN0QyxNQUFNLHFCQUFxQixHQUFHLElBQUEscUJBQWEsRUFBQyxXQUFXLENBQUMsQ0FBQztnQkFDekQsSUFBSSxD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KipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IGFzc2VydCBmcm9tICdub2RlOmFzc2VydCc7XG5pbXBvcnQgeyBCdWZmZXIgfSBmcm9tICdub2RlOmJ1ZmZlcic7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ25vZGU6cGF0aCc7XG5pbXBvcnQgKiBhcyB2bSBmcm9tICdub2RlOnZtJztcbmltcG9ydCB0eXBlIHsgQXNzZXQsIENvbXBpbGF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5pbXBvcnQgeyBhZGRFcnJvciB9IGZyb20gJy4vaXZ5L2RpYWdub3N0aWNzJztcbmltcG9ydCB7IG5vcm1hbGl6ZVBhdGggfSBmcm9tICcuL2l2eS9wYXRocyc7XG5pbXBvcnQge1xuICBDb21waWxhdGlvbldpdGhJbmxpbmVBbmd1bGFyUmVzb3VyY2UsXG4gIElubGluZUFuZ3VsYXJSZXNvdXJjZUxvYWRlclBhdGgsXG4gIElubGluZUFuZ3VsYXJSZXNvdXJjZVN5bWJvbCxcbn0gZnJvbSAnLi9sb2FkZXJzL2lubGluZS1yZXNvdXJjZSc7XG5pbXBvcnQgeyBOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUlkgfSBmcm9tICcuL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcyc7XG5cbmludGVyZmFjZSBDb21waWxhdGlvbk91dHB1dCB7XG4gIGNvbnRlbnQ6IHN0cmluZztcbiAgbWFwPzogc3RyaW5nO1xuICBzdWNjZXNzOiBib29sZWFuO1xufVxuXG5leHBvcnQgY2xhc3MgV2VicGFja1Jlc291cmNlTG9hZGVyIHtcbiAgcHJpdmF0ZSBfcGFyZW50Q29tcGlsYXRpb24/OiBDb21waWxhdGlvbjtcbiAgcHJpdmF0ZSBfZmlsZURlcGVuZGVuY2llcyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4oKTtcbiAgcHJpdmF0ZSBfcmV2ZXJzZURlcGVuZGVuY2llcyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4oKTtcblxuICBwcml2YXRlIGZpbGVDYWNoZT86IE1hcDxzdHJpbmcsIENvbXBpbGF0aW9uT3V0cHV0PjtcbiAgcHJpdmF0ZSBhc3NldENhY2hlPzogTWFwPHN0cmluZywgQXNzZXQ+O1xuXG4gIHByaXZhdGUgbW9kaWZpZWRSZXNvdXJjZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgcHJpdmF0ZSBvdXRwdXRQYXRoQ291bnRlciA9IDE7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBpbmxpbmVEYXRhTG9hZGVyUGF0aCA9IElubGluZUFuZ3VsYXJSZXNvdXJjZUxvYWRlclBhdGg7XG5cbiAgY29uc3RydWN0b3Ioc2hvdWxkQ2FjaGU6IGJvb2xlYW4pIHtcbiAgICBpZiAoc2hvdWxkQ2FjaGUpIHtcbiAgICAgIHRoaXMuZmlsZUNhY2hlID0gbmV3IE1hcCgpO1xuICAgICAgdGhpcy5hc3NldENhY2hlID0gbmV3IE1hcCgpO1xuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZShwYXJlbnRDb21waWxhdGlvbjogQ29tcGlsYXRpb24sIGNoYW5nZWRGaWxlcz86IEl0ZXJhYmxlPHN0cmluZz4pIHtcbiAgICB0aGlzLl9wYXJlbnRDb21waWxhdGlvbiA9IHBhcmVudENvbXBpbGF0aW9uO1xuXG4gICAgLy8gVXBkYXRlIHJlc291cmNlIGNhY2hlIGFuZCBtb2RpZmllZCByZXNvdXJjZXNcbiAgICB0aGlzLm1vZGlmaWVkUmVzb3VyY2VzLmNsZWFyKCk7XG5cbiAgICBpZiAoY2hhbmdlZEZpbGVzKSB7XG4gICAgICBmb3IgKGNvbnN0IGNoYW5nZWRGaWxlIG9mIGNoYW5nZWRGaWxlcykge1xuICAgICAgICBjb25zdCBjaGFuZ2VkRmlsZU5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKGNoYW5nZWRGaWxlKTtcbiAgICAgICAgdGhpcy5hc3NldENhY2hlPy5kZWxldGUoY2hhbmdlZEZpbGVOb3JtYWxpemVkKTtcblxuICAgICAgICBmb3IgKGNvbnN0IGFmZmVjdGVkUmVzb3VyY2Ugb2YgdGhpcy5nZXRBZmZlY3RlZFJlc291cmNlcyhjaGFuZ2VkRmlsZSkpIHtcbiAgICAgICAgICBjb25zdCBhZmZlY3RlZFJlc291cmNlTm9ybWFsaXplZCA9IG5vcm1hbGl6ZVBhdGgoYWZmZWN0ZWRSZXNvdXJjZSk7XG4gICAgICAgICAgdGhpcy5maWxlQ2FjaGU/LmRlbGV0ZShhZmZlY3RlZFJlc291cmNlTm9ybWFsaXplZCk7XG4gICAgICAgICAgdGhpcy5tb2RpZmllZFJlc291cmNlcy5hZGQoYWZmZWN0ZWRSZXNvdXJjZSk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGVmZmVjdGVkRGVwZW5kZW5jaWVzIG9mIHRoaXMuZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoXG4gICAgICAgICAgICBhZmZlY3RlZFJlc291cmNlTm9ybWFsaXplZCxcbiAgICAgICAgICApKSB7XG4gICAgICAgICAgICB0aGlzLmFzc2V0Q2FjaGU/LmRlbGV0ZShub3JtYWxpemVQYXRoKGVmZmVjdGVkRGVwZW5kZW5jaWVzKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZmlsZUNhY2hlPy5jbGVhcigpO1xuICAgICAgdGhpcy5hc3NldENhY2hlPy5jbGVhcigpO1xuICAgIH1cblxuICAgIC8vIFJlLWVtaXQgYWxsIGFzc2V0cyBmb3IgdW4tZWZmZWN0ZWQgZmlsZXNcbiAgICBpZiAodGhpcy5hc3NldENhY2hlKSB7XG4gICAgICBmb3IgKGNvbnN0IFssIHsgbmFtZSwgc291cmNlLCBpbmZvIH1dIG9mIHRoaXMuYXNzZXRDYWNoZSkge1xuICAgICAgICB0aGlzLl9wYXJlbnRDb21waWxhdGlvbi5lbWl0QXNzZXQobmFtZSwgc291cmNlLCBpbmZvKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjbGVhclBhcmVudENvbXBpbGF0aW9uKCkge1xuICAgIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgZ2V0TW9kaWZpZWRSZXNvdXJjZUZpbGVzKCkge1xuICAgIHJldHVybiB0aGlzLm1vZGlmaWVkUmVzb3VyY2VzO1xuICB9XG5cbiAgZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoZmlsZVBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9maWxlRGVwZW5kZW5jaWVzLmdldChmaWxlUGF0aCkgfHwgW107XG4gIH1cblxuICBnZXRBZmZlY3RlZFJlc291cmNlcyhmaWxlOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fcmV2ZXJzZURlcGVuZGVuY2llcy5nZXQoZmlsZSkgfHwgW107XG4gIH1cblxuICBzZXRBZmZlY3RlZFJlc291cmNlcyhmaWxlOiBzdHJpbmcsIHJlc291cmNlczogSXRlcmFibGU8c3RyaW5nPikge1xuICAgIHRoaXMuX3JldmVyc2VEZXBlbmRlbmNpZXMuc2V0KGZpbGUsIG5ldyBTZXQocmVzb3VyY2VzKSk7XG4gIH1cblxuICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgbWF4LWxpbmVzLXBlci1mdW5jdGlvblxuICBwcml2YXRlIGFzeW5jIF9jb21waWxlKFxuICAgIGZpbGVQYXRoPzogc3RyaW5nLFxuICAgIGRhdGE/OiBzdHJpbmcsXG4gICAgZmlsZUV4dGVuc2lvbj86IHN0cmluZyxcbiAgICByZXNvdXJjZVR5cGU/OiAnc3R5bGUnIHwgJ3RlbXBsYXRlJyxcbiAgICBjb250YWluaW5nRmlsZT86IHN0cmluZyxcbiAgKTogUHJvbWlzZTxDb21waWxhdGlvbk91dHB1dD4ge1xuICAgIGlmICghdGhpcy5fcGFyZW50Q29tcGlsYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignV2VicGFja1Jlc291cmNlTG9hZGVyIGNhbm5vdCBiZSB1c2VkIHdpdGhvdXQgcGFyZW50Q29tcGlsYXRpb24nKTtcbiAgICB9XG5cbiAgICBjb25zdCB7IGNvbnRleHQsIHdlYnBhY2sgfSA9IHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmNvbXBpbGVyO1xuICAgIGNvbnN0IHtcbiAgICAgIEVudHJ5UGx1Z2luLFxuICAgICAgTm9ybWFsTW9kdWxlLFxuICAgICAgV2VicGFja0Vycm9yLFxuICAgICAgbGlicmFyeSxcbiAgICAgIG5vZGUsXG4gICAgICBzb3VyY2VzLFxuICAgICAgdXRpbDogeyBjcmVhdGVIYXNoIH0sXG4gICAgfSA9IHdlYnBhY2s7XG5cbiAgICBjb25zdCBnZXRFbnRyeSA9ICgpOiBzdHJpbmcgPT4ge1xuICAgICAgaWYgKGZpbGVQYXRoKSB7XG4gICAgICAgIHJldHVybiBgJHtmaWxlUGF0aH0/JHtOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUll9YDtcbiAgICAgIH0gZWxzZSBpZiAocmVzb3VyY2VUeXBlKSB7XG4gICAgICAgIHJldHVybiAoXG4gICAgICAgICAgLy8gYXBwLmNvbXBvbmVudC50cy0yLmNzcz9uZ1Jlc291cmNlIT0hQG5ndG9vbHMvd2VicGFjay9zcmMvbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UuanMhYXBwLmNvbXBvbmVudC50c1xuICAgICAgICAgIGAke2NvbnRhaW5pbmdGaWxlfS0ke3RoaXMub3V0cHV0UGF0aENvdW50ZXJ9LiR7ZmlsZUV4dGVuc2lvbn1gICtcbiAgICAgICAgICBgPyR7TkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZfSE9ISR7dGhpcy5pbmxpbmVEYXRhTG9hZGVyUGF0aH0hJHtjb250YWluaW5nRmlsZX1gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKGRhdGEpIHtcbiAgICAgICAgLy8gQ3JlYXRlIGEgc3BlY2lhbCBVUkwgZm9yIHJlYWRpbmcgdGhlIHJlc291cmNlIGZyb20gbWVtb3J5XG4gICAgICAgIHJldHVybiBgYW5ndWxhci1yZXNvdXJjZToke3Jlc291cmNlVHlwZX0sJHtjcmVhdGVIYXNoKCd4eGhhc2g2NCcpXG4gICAgICAgICAgLnVwZGF0ZShkYXRhKVxuICAgICAgICAgIC5kaWdlc3QoJ2hleCcpfWA7XG4gICAgICB9XG5cbiAgICAgIHRocm93IG5ldyBFcnJvcihgXCJmaWxlUGF0aFwiLCBcInJlc291cmNlVHlwZVwiIG9yIFwiZGF0YVwiIG11c3QgYmUgc3BlY2lmaWVkLmApO1xuICAgIH07XG5cbiAgICBjb25zdCBlbnRyeSA9IGdldEVudHJ5KCk7XG5cbiAgICAvLyBTaW1wbGUgc2FuaXR5IGNoZWNrLlxuICAgIGlmIChmaWxlUGF0aD8ubWF0Y2goL1xcLltqdF1zJC8pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBDYW5ub3QgdXNlIGEgSmF2YVNjcmlwdCBvciBUeXBlU2NyaXB0IGZpbGUgKCR7ZmlsZVBhdGh9KSBpbiBhIGNvbXBvbmVudCdzIHN0eWxlVXJscyBvciB0ZW1wbGF0ZVVybC5gLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBvdXRwdXRGaWxlUGF0aCA9XG4gICAgICBmaWxlUGF0aCB8fFxuICAgICAgYCR7Y29udGFpbmluZ0ZpbGV9LWFuZ3VsYXItaW5saW5lLS0ke3RoaXMub3V0cHV0UGF0aENvdW50ZXIrK30uJHtcbiAgICAgICAgcmVzb3VyY2VUeXBlID09PSAndGVtcGxhdGUnID8gJ2h0bWwnIDogJ2NzcydcbiAgICAgIH1gO1xuICAgIGNvbnN0IG91dHB1dE9wdGlvbnMgPSB7XG4gICAgICBmaWxlbmFtZTogb3V0cHV0RmlsZVBhdGgsXG4gICAgICBsaWJyYXJ5OiB7XG4gICAgICAgIHR5cGU6ICd2YXInLFxuICAgICAgICBuYW1lOiAncmVzb3VyY2UnLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgY2hpbGRDb21waWxlciA9IHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmNyZWF0ZUNoaWxkQ29tcGlsZXIoXG4gICAgICAnYW5ndWxhci1jb21waWxlcjpyZXNvdXJjZScsXG4gICAgICBvdXRwdXRPcHRpb25zLFxuICAgICAgW1xuICAgICAgICBuZXcgbm9kZS5Ob2RlVGVtcGxhdGVQbHVnaW4ob3V0cHV0T3B0aW9ucyksXG4gICAgICAgIG5ldyBub2RlLk5vZGVUYXJnZXRQbHVnaW4oKSxcbiAgICAgICAgbmV3IEVudHJ5UGx1Z2luKGNvbnRleHQsIGVudHJ5LCB7IG5hbWU6ICdyZXNvdXJjZScgfSksXG4gICAgICAgIG5ldyBsaWJyYXJ5LkVuYWJsZUxpYnJhcnlQbHVnaW4oJ3ZhcicpLFxuICAgICAgXSxcbiAgICApO1xuXG4gICAgY2hpbGRDb21waWxlci5ob29rcy50aGlzQ29tcGlsYXRpb24udGFwKFxuICAgICAgJ2FuZ3VsYXItY29tcGlsZXInLFxuICAgICAgKGNvbXBpbGF0aW9uLCB7IG5vcm1hbE1vZHVsZUZhY3RvcnkgfSkgPT4ge1xuICAgICAgICAvLyBJZiBubyBkYXRhIGlzIHByb3ZpZGVkLCB0aGUgcmVzb3VyY2Ugd2lsbCBiZSByZWFkIGZyb20gdGhlIGZpbGVzeXN0ZW1cbiAgICAgICAgaWYgKGRhdGEgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIG5vcm1hbE1vZHVsZUZhY3RvcnkuaG9va3MucmVzb2x2ZUZvclNjaGVtZVxuICAgICAgICAgICAgLmZvcignYW5ndWxhci1yZXNvdXJjZScpXG4gICAgICAgICAgICAudGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKHJlc291cmNlRGF0YSkgPT4ge1xuICAgICAgICAgICAgICBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZURhdGEucGF0aCA9IGZpbGVQYXRoO1xuICAgICAgICAgICAgICAgIHJlc291cmNlRGF0YS5yZXNvdXJjZSA9IGZpbGVQYXRoO1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICBOb3JtYWxNb2R1bGUuZ2V0Q29tcGlsYXRpb25Ib29rcyhjb21waWxhdGlvbilcbiAgICAgICAgICAgIC5yZWFkUmVzb3VyY2VGb3JTY2hlbWUuZm9yKCdhbmd1bGFyLXJlc291cmNlJylcbiAgICAgICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiBkYXRhKTtcblxuICAgICAgICAgIChjb21waWxhdGlvbiBhcyBDb21waWxhdGlvbldpdGhJbmxpbmVBbmd1bGFyUmVzb3VyY2UpW0lubGluZUFuZ3VsYXJSZXNvdXJjZVN5bWJvbF0gPSBkYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tcGlsYXRpb24uaG9va3MuYWRkaXRpb25hbEFzc2V0cy50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgYXNzZXQgPSBjb21waWxhdGlvbi5hc3NldHNbb3V0cHV0RmlsZVBhdGhdO1xuICAgICAgICAgIGlmICghYXNzZXQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0cHV0ID0gdGhpcy5fZXZhbHVhdGUob3V0cHV0RmlsZVBhdGgsIGFzc2V0LnNvdXJjZSgpLnRvU3RyaW5nKCkpO1xuXG4gICAgICAgICAgICBpZiAodHlwZW9mIG91dHB1dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgY29tcGlsYXRpb24uYXNzZXRzW291dHB1dEZpbGVQYXRoXSA9IG5ldyBzb3VyY2VzLlJhd1NvdXJjZShvdXRwdXQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBhc3NlcnQoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciwgJ2NhdGNoIGNsYXVzZSB2YXJpYWJsZSBpcyBub3QgYW4gRXJyb3IgaW5zdGFuY2UnKTtcbiAgICAgICAgICAgIC8vIFVzZSBjb21waWxhdGlvbiBlcnJvcnMsIGFzIG90aGVyd2lzZSB3ZWJwYWNrIHdpbGwgY2hva2VcbiAgICAgICAgICAgIGFkZEVycm9yKGNvbXBpbGF0aW9uLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSxcbiAgICApO1xuXG4gICAgbGV0IGZpbmFsQ29udGVudDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGNoaWxkQ29tcGlsZXIuaG9va3MuY29tcGlsYXRpb24udGFwKCdhbmd1bGFyLWNvbXBpbGVyJywgKGNoaWxkQ29tcGlsYXRpb24pID0+IHtcbiAgICAgIGNoaWxkQ29tcGlsYXRpb24uaG9va3MucHJvY2Vzc0Fzc2V0cy50YXAoXG4gICAgICAgIHsgbmFtZTogJ2FuZ3VsYXItY29tcGlsZXInLCBzdGFnZTogd2VicGFjay5Db21waWxhdGlvbi5QUk9DRVNTX0FTU0VUU19TVEFHRV9SRVBPUlQgfSxcbiAgICAgICAgKCkgPT4ge1xuICAgICAgICAgIGZpbmFsQ29udGVudCA9IGNoaWxkQ29tcGlsYXRpb24uYXNzZXRzW291dHB1dEZpbGVQYXRoXT8uc291cmNlKCkudG9TdHJpbmcoKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgeyBmaWxlcyB9IG9mIGNoaWxkQ29tcGlsYXRpb24uY2h1bmtzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgICAgICAgICAgY2hpbGRDb21waWxhdGlvbi5kZWxldGVBc3NldChmaWxlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPENvbXBpbGF0aW9uT3V0cHV0PigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjaGlsZENvbXBpbGVyLnJ1bkFzQ2hpbGQoKGVycm9yLCBfLCBjaGlsZENvbXBpbGF0aW9uKSA9PiB7XG4gICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgIHJlamVjdChlcnJvcik7XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSBpZiAoIWNoaWxkQ29tcGlsYXRpb24pIHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKCdVbmtub3duIGNoaWxkIGNvbXBpbGF0aW9uIGVycm9yJykpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gV29ya2Fyb3VuZCB0byBhdHRlbXB0IHRvIHJlZHVjZSBtZW1vcnkgdXNhZ2Ugb2YgY2hpbGQgY29tcGlsYXRpb25zLlxuICAgICAgICAvLyBUaGlzIHJlbW92ZXMgdGhlIGNoaWxkIGNvbXBpbGF0aW9uIGZyb20gdGhlIG1haW4gY29tcGlsYXRpb24gYW5kIG1hbnVhbGx5IHByb3BhZ2F0ZXNcbiAgICAgICAgLy8gYWxsIGRlcGVuZGVuY2llcywgd2FybmluZ3MsIGFuZCBlcnJvcnMuXG4gICAgICAgIGNvbnN0IHBhcmVudCA9IGNoaWxkQ29tcGlsZXIucGFyZW50Q29tcGlsYXRpb247XG4gICAgICAgIGlmIChwYXJlbnQpIHtcbiAgICAgICAgICBwYXJlbnQuY2hpbGRyZW4gPSBwYXJlbnQuY2hpbGRyZW4uZmlsdGVyKChjaGlsZCkgPT4gY2hpbGQgIT09IGNoaWxkQ29tcGlsYXRpb24pO1xuICAgICAgICAgIGxldCBmaWxlRGVwZW5kZW5jaWVzOiBTZXQ8c3RyaW5nPiB8IHVuZGVmaW5lZDtcblxuICAgICAgICAgIGZvciAoY29uc3QgZGVwZW5kZW5jeSBvZiBjaGlsZENvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIC8vIFNraXAgcGF0aHMgdGhhdCBkbyBub3QgYXBwZWFyIHRvIGJlIGZpbGVzIChoYXZlIG5vIGV4dGVuc2lvbikuXG4gICAgICAgICAgICAvLyBgZmlsZURlcGVuZGVuY2llc2AgY2FuIGNvbnRhaW4gZGlyZWN0b3JpZXMgYW5kIG5vdCBqdXN0IGZpbGVzIHdoaWNoIGNhblxuICAgICAgICAgICAgLy8gY2F1c2UgaW5jb3JyZWN0IGNhY2hlIGludmFsaWRhdGlvbiBvbiByZWJ1aWxkcy5cbiAgICAgICAgICAgIGlmICghcGF0aC5leHRuYW1lKGRlcGVuZGVuY3kpKSB7XG4gICAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZGF0YSAmJiBjb250YWluaW5nRmlsZSAmJiBkZXBlbmRlbmN5LmVuZHNXaXRoKGVudHJ5KSkge1xuICAgICAgICAgICAgICAvLyB1c2UgY29udGFpbmluZyBmaWxlIGlmIHRoZSByZXNvdXJjZSB3YXMgaW5saW5lXG4gICAgICAgICAgICAgIHBhcmVudC5maWxlRGVwZW5kZW5jaWVzLmFkZChjb250YWluaW5nRmlsZSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBwYXJlbnQuZmlsZURlcGVuZGVuY2llcy5hZGQoZGVwZW5kZW5jeSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFNhdmUgdGhlIGRlcGVuZGVuY2llcyBmb3IgdGhpcyByZXNvdXJjZS5cbiAgICAgICAgICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICBjb25zdCByZXNvbHZlZEZpbGUgPSBub3JtYWxpemVQYXRoKGRlcGVuZGVuY3kpO1xuICAgICAgICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuX3JldmVyc2VEZXBlbmRlbmNpZXMuZ2V0KHJlc29sdmVkRmlsZSk7XG4gICAgICAgICAgICAgIGlmIChlbnRyeSkge1xuICAgICAgICAgICAgICAgIGVudHJ5LmFkZChmaWxlUGF0aCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fcmV2ZXJzZURlcGVuZGVuY2llcy5zZXQocmVzb2x2ZWRGaWxlLCBuZXcgU2V0KFtmaWxlUGF0aF0pKTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIGlmIChmaWxlRGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICAgICAgZmlsZURlcGVuZGVuY2llcy5hZGQoZGVwZW5kZW5jeSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZmlsZURlcGVuZGVuY2llcyA9IG5ldyBTZXQoW2RlcGVuZGVuY3ldKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9maWxlRGVwZW5kZW5jaWVzLnNldChmaWxlUGF0aCwgZmlsZURlcGVuZGVuY2llcyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwYXJlbnQuY29udGV4dERlcGVuZGVuY2llcy5hZGRBbGwoY2hpbGRDb21waWxhdGlvbi5jb250ZXh0RGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICBwYXJlbnQubWlzc2luZ0RlcGVuZGVuY2llcy5hZGRBbGwoY2hpbGRDb21waWxhdGlvbi5taXNzaW5nRGVwZW5kZW5jaWVzKTtcbiAgICAgICAgICBwYXJlbnQuYnVpbGREZXBlbmRlbmNpZXMuYWRkQWxsKGNoaWxkQ29tcGlsYXRpb24uYnVpbGREZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgICAgcGFyZW50Lndhcm5pbmdzLnB1c2goLi4uY2hpbGRDb21waWxhdGlvbi53YXJuaW5ncyk7XG4gICAgICAgICAgcGFyZW50LmVycm9ycy5wdXNoKC4uLmNoaWxkQ29tcGlsYXRpb24uZXJyb3JzKTtcblxuICAgICAgICAgIGlmICh0aGlzLmFzc2V0Q2FjaGUpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgeyBpbmZvLCBuYW1lLCBzb3VyY2UgfSBvZiBjaGlsZENvbXBpbGF0aW9uLmdldEFzc2V0cygpKSB7XG4gICAgICAgICAgICAgIC8vIFVzZSB0aGUgb3JpZ2luYXRpbmcgZmlsZSBhcyB0aGUgY2FjaGUga2V5IGlmIHByZXNlbnRcbiAgICAgICAgICAgICAgLy8gT3RoZXJ3aXNlLCBnZW5lcmF0ZSBhIGNhY2hlIGtleSBiYXNlZCBvbiB0aGUgZ2VuZXJhdGVkIG5hbWVcbiAgICAgICAgICAgICAgY29uc3QgY2FjaGVLZXkgPSBpbmZvLnNvdXJjZUZpbGVuYW1lID8/IGAhIVtHRU5FUkFURURdOiR7bmFtZX1gO1xuXG4gICAgICAgICAgICAgIHRoaXMuYXNzZXRDYWNoZS5zZXQoY2FjaGVLZXksIHsgaW5mbywgbmFtZSwgc291cmNlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJlc29sdmUoe1xuICAgICAgICAgIGNvbnRlbnQ6IGZpbmFsQ29udGVudCA/PyAnJyxcbiAgICAgICAgICBzdWNjZXNzOiBjaGlsZENvbXBpbGF0aW9uLmVycm9ycz8ubGVuZ3RoID09PSAwLFxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfZXZhbHVhdGUoZmlsZW5hbWU6IHN0cmluZywgc291cmNlOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBFdmFsdWF0ZSBjb2RlXG5cbiAgICAvLyBjc3MtbG9hZGVyIHJlcXVpcmVzIHRoZSBidG9hIGZ1bmN0aW9uIHRvIGV4aXN0IHRvIGNvcnJlY3RseSBnZW5lcmF0ZSBpbmxpbmUgc291cmNlbWFwc1xuICAgIGNvbnN0IGNvbnRleHQ6IHsgYnRvYTogKGlucHV0OiBzdHJpbmcpID0+IHN0cmluZzsgcmVzb3VyY2U/OiBzdHJpbmcgfCB7IGRlZmF1bHQ/OiBzdHJpbmcgfSB9ID0ge1xuICAgICAgYnRvYShpbnB1dCkge1xuICAgICAgICByZXR1cm4gQnVmZmVyLmZyb20oaW5wdXQpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICB2bS5ydW5Jbk5ld0NvbnRleHQoc291cmNlLCBjb250ZXh0LCB7IGZpbGVuYW1lIH0pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gRXJyb3IgYXJlIHByb3BhZ2F0ZWQgdGhyb3VnaCB0aGUgY2hpbGQgY29tcGlsYXRpb24uXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGNvbnRleHQucmVzb3VyY2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICByZXR1cm4gY29udGV4dC5yZXNvdXJjZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBjb250ZXh0LnJlc291cmNlPy5kZWZhdWx0ID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGNvbnRleHQucmVzb3VyY2UuZGVmYXVsdDtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZSBsb2FkZXIgXCIke2ZpbGVuYW1lfVwiIGRpZG4ndCByZXR1cm4gYSBzdHJpbmcuYCk7XG4gIH1cblxuICBhc3luYyBnZXQoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZEZpbGUgPSBub3JtYWxpemVQYXRoKGZpbGVQYXRoKTtcbiAgICBsZXQgY29tcGlsYXRpb25SZXN1bHQgPSB0aGlzLmZpbGVDYWNoZT8uZ2V0KG5vcm1hbGl6ZWRGaWxlKTtcblxuICAgIGlmIChjb21waWxhdGlvblJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBjYWNoZSBtaXNzIHNvIGNvbXBpbGUgcmVzb3VyY2VcbiAgICAgIGNvbXBpbGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5fY29tcGlsZShmaWxlUGF0aCk7XG5cbiAgICAgIC8vIE9ubHkgY2FjaGUgaWYgY29tcGlsYXRpb24gd2FzIHN1Y2Nlc3NmdWxcbiAgICAgIGlmICh0aGlzLmZpbGVDYWNoZSAmJiBjb21waWxhdGlvblJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIHRoaXMuZmlsZUNhY2hlLnNldChub3JtYWxpemVkRmlsZSwgY29tcGlsYXRpb25SZXN1bHQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBjb21waWxhdGlvblJlc3VsdC5jb250ZW50O1xuICB9XG5cbiAgYXN5bmMgcHJvY2VzcyhcbiAgICBkYXRhOiBzdHJpbmcsXG4gICAgZmlsZUV4dGVuc2lvbjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuICAgIHJlc291cmNlVHlwZTogJ3RlbXBsYXRlJyB8ICdzdHlsZScsXG4gICAgY29udGFpbmluZ0ZpbGU/OiBzdHJpbmcsXG4gICk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKGRhdGEudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGNvbnN0IGNvbXBpbGF0aW9uUmVzdWx0ID0gYXdhaXQgdGhpcy5fY29tcGlsZShcbiAgICAgIHVuZGVmaW5lZCxcbiAgICAgIGRhdGEsXG4gICAgICBmaWxlRXh0ZW5zaW9uLFxuICAgICAgcmVzb3VyY2VUeXBlLFxuICAgICAgY29udGFpbmluZ0ZpbGUsXG4gICAgKTtcblxuICAgIHJldHVybiBjb21waWxhdGlvblJlc3VsdC5jb250ZW50O1xuICB9XG59XG4iXX0=