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
const assert_1 = __importDefault(require("assert"));
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
                    (0, assert_1.default)(error instanceof Error, 'catch clause variable is not an Error instance');
                    // Use compilation errors, as otherwise webpack will choke
                    compilation.errors.push(new WebpackError(error.message));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2VfbG9hZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9yZXNvdXJjZV9sb2FkZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCxvREFBNEI7QUFDNUIsMkNBQTZCO0FBQzdCLHVDQUF5QjtBQUV6Qix1Q0FBNEM7QUFDNUMsK0RBSW1DO0FBQ25DLHdFQUErRTtBQVEvRSxNQUFhLHFCQUFxQjtJQWFoQyxZQUFZLFdBQW9CO1FBWHhCLHNCQUFpQixHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBQ25ELHlCQUFvQixHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBS3RELHNCQUFpQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7UUFDdEMsc0JBQWlCLEdBQUcsQ0FBQyxDQUFDO1FBRWIseUJBQW9CLEdBQUcsaURBQStCLENBQUM7UUFHdEUsSUFBSSxXQUFXLEVBQUU7WUFDZixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO1NBQzdCO0lBQ0gsQ0FBQztJQUVELE1BQU0sQ0FBQyxpQkFBOEIsRUFBRSxZQUErQjs7UUFDcEUsSUFBSSxDQUFDLGtCQUFrQixHQUFHLGlCQUFpQixDQUFDO1FBRTVDLCtDQUErQztRQUMvQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsS0FBSyxFQUFFLENBQUM7UUFFL0IsSUFBSSxZQUFZLEVBQUU7WUFDaEIsS0FBSyxNQUFNLFdBQVcsSUFBSSxZQUFZLEVBQUU7Z0JBQ3RDLE1BQU0scUJBQXFCLEdBQUcsSUFBQSxxQkFBYSxFQUFDLFdBQVcsQ0FBQyxDQUFDO2dCQUN6RCxNQUFBLElBQUksQ0FBQyxVQUFVLDBDQUFFLE1BQU0s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XG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCBhc3NlcnQgZnJvbSAnYXNzZXJ0JztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB2bSBmcm9tICd2bSc7XG5pbXBvcnQgdHlwZSB7IEFzc2V0LCBDb21waWxhdGlvbiB9IGZyb20gJ3dlYnBhY2snO1xuaW1wb3J0IHsgbm9ybWFsaXplUGF0aCB9IGZyb20gJy4vaXZ5L3BhdGhzJztcbmltcG9ydCB7XG4gIENvbXBpbGF0aW9uV2l0aElubGluZUFuZ3VsYXJSZXNvdXJjZSxcbiAgSW5saW5lQW5ndWxhclJlc291cmNlTG9hZGVyUGF0aCxcbiAgSW5saW5lQW5ndWxhclJlc291cmNlU3ltYm9sLFxufSBmcm9tICcuL2xvYWRlcnMvaW5saW5lLXJlc291cmNlJztcbmltcG9ydCB7IE5HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWSB9IGZyb20gJy4vdHJhbnNmb3JtZXJzL3JlcGxhY2VfcmVzb3VyY2VzJztcblxuaW50ZXJmYWNlIENvbXBpbGF0aW9uT3V0cHV0IHtcbiAgY29udGVudDogc3RyaW5nO1xuICBtYXA/OiBzdHJpbmc7XG4gIHN1Y2Nlc3M6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJwYWNrUmVzb3VyY2VMb2FkZXIge1xuICBwcml2YXRlIF9wYXJlbnRDb21waWxhdGlvbj86IENvbXBpbGF0aW9uO1xuICBwcml2YXRlIF9maWxlRGVwZW5kZW5jaWVzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuICBwcml2YXRlIF9yZXZlcnNlRGVwZW5kZW5jaWVzID0gbmV3IE1hcDxzdHJpbmcsIFNldDxzdHJpbmc+PigpO1xuXG4gIHByaXZhdGUgZmlsZUNhY2hlPzogTWFwPHN0cmluZywgQ29tcGlsYXRpb25PdXRwdXQ+O1xuICBwcml2YXRlIGFzc2V0Q2FjaGU/OiBNYXA8c3RyaW5nLCBBc3NldD47XG5cbiAgcHJpdmF0ZSBtb2RpZmllZFJlc291cmNlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBwcml2YXRlIG91dHB1dFBhdGhDb3VudGVyID0gMTtcblxuICBwcml2YXRlIHJlYWRvbmx5IGlubGluZURhdGFMb2FkZXJQYXRoID0gSW5saW5lQW5ndWxhclJlc291cmNlTG9hZGVyUGF0aDtcblxuICBjb25zdHJ1Y3RvcihzaG91bGRDYWNoZTogYm9vbGVhbikge1xuICAgIGlmIChzaG91bGRDYWNoZSkge1xuICAgICAgdGhpcy5maWxlQ2FjaGUgPSBuZXcgTWFwKCk7XG4gICAgICB0aGlzLmFzc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XG4gICAgfVxuICB9XG5cbiAgdXBkYXRlKHBhcmVudENvbXBpbGF0aW9uOiBDb21waWxhdGlvbiwgY2hhbmdlZEZpbGVzPzogSXRlcmFibGU8c3RyaW5nPikge1xuICAgIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uID0gcGFyZW50Q29tcGlsYXRpb247XG5cbiAgICAvLyBVcGRhdGUgcmVzb3VyY2UgY2FjaGUgYW5kIG1vZGlmaWVkIHJlc291cmNlc1xuICAgIHRoaXMubW9kaWZpZWRSZXNvdXJjZXMuY2xlYXIoKTtcblxuICAgIGlmIChjaGFuZ2VkRmlsZXMpIHtcbiAgICAgIGZvciAoY29uc3QgY2hhbmdlZEZpbGUgb2YgY2hhbmdlZEZpbGVzKSB7XG4gICAgICAgIGNvbnN0IGNoYW5nZWRGaWxlTm9ybWFsaXplZCA9IG5vcm1hbGl6ZVBhdGgoY2hhbmdlZEZpbGUpO1xuICAgICAgICB0aGlzLmFzc2V0Q2FjaGU/LmRlbGV0ZShjaGFuZ2VkRmlsZU5vcm1hbGl6ZWQpO1xuXG4gICAgICAgIGZvciAoY29uc3QgYWZmZWN0ZWRSZXNvdXJjZSBvZiB0aGlzLmdldEFmZmVjdGVkUmVzb3VyY2VzKGNoYW5nZWRGaWxlKSkge1xuICAgICAgICAgIGNvbnN0IGFmZmVjdGVkUmVzb3VyY2VOb3JtYWxpemVkID0gbm9ybWFsaXplUGF0aChhZmZlY3RlZFJlc291cmNlKTtcbiAgICAgICAgICB0aGlzLmZpbGVDYWNoZT8uZGVsZXRlKGFmZmVjdGVkUmVzb3VyY2VOb3JtYWxpemVkKTtcbiAgICAgICAgICB0aGlzLm1vZGlmaWVkUmVzb3VyY2VzLmFkZChhZmZlY3RlZFJlc291cmNlKTtcblxuICAgICAgICAgIGZvciAoY29uc3QgZWZmZWN0ZWREZXBlbmRlbmNpZXMgb2YgdGhpcy5nZXRSZXNvdXJjZURlcGVuZGVuY2llcyhcbiAgICAgICAgICAgIGFmZmVjdGVkUmVzb3VyY2VOb3JtYWxpemVkLFxuICAgICAgICAgICkpIHtcbiAgICAgICAgICAgIHRoaXMuYXNzZXRDYWNoZT8uZGVsZXRlKG5vcm1hbGl6ZVBhdGgoZWZmZWN0ZWREZXBlbmRlbmNpZXMpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5maWxlQ2FjaGU/LmNsZWFyKCk7XG4gICAgICB0aGlzLmFzc2V0Q2FjaGU/LmNsZWFyKCk7XG4gICAgfVxuXG4gICAgLy8gUmUtZW1pdCBhbGwgYXNzZXRzIGZvciB1bi1lZmZlY3RlZCBmaWxlc1xuICAgIGlmICh0aGlzLmFzc2V0Q2FjaGUpIHtcbiAgICAgIGZvciAoY29uc3QgWywgeyBuYW1lLCBzb3VyY2UsIGluZm8gfV0gb2YgdGhpcy5hc3NldENhY2hlKSB7XG4gICAgICAgIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmVtaXRBc3NldChuYW1lLCBzb3VyY2UsIGluZm8pO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNsZWFyUGFyZW50Q29tcGlsYXRpb24oKSB7XG4gICAgdGhpcy5fcGFyZW50Q29tcGlsYXRpb24gPSB1bmRlZmluZWQ7XG4gIH1cblxuICBnZXRNb2RpZmllZFJlc291cmNlRmlsZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMubW9kaWZpZWRSZXNvdXJjZXM7XG4gIH1cblxuICBnZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlUGF0aDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZpbGVEZXBlbmRlbmNpZXMuZ2V0KGZpbGVQYXRoKSB8fCBbXTtcbiAgfVxuXG4gIGdldEFmZmVjdGVkUmVzb3VyY2VzKGZpbGU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9yZXZlcnNlRGVwZW5kZW5jaWVzLmdldChmaWxlKSB8fCBbXTtcbiAgfVxuXG4gIHNldEFmZmVjdGVkUmVzb3VyY2VzKGZpbGU6IHN0cmluZywgcmVzb3VyY2VzOiBJdGVyYWJsZTxzdHJpbmc+KSB7XG4gICAgdGhpcy5fcmV2ZXJzZURlcGVuZGVuY2llcy5zZXQoZmlsZSwgbmV3IFNldChyZXNvdXJjZXMpKTtcbiAgfVxuXG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBtYXgtbGluZXMtcGVyLWZ1bmN0aW9uXG4gIHByaXZhdGUgYXN5bmMgX2NvbXBpbGUoXG4gICAgZmlsZVBhdGg/OiBzdHJpbmcsXG4gICAgZGF0YT86IHN0cmluZyxcbiAgICBmaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuICAgIHJlc291cmNlVHlwZT86ICdzdHlsZScgfCAndGVtcGxhdGUnLFxuICAgIGNvbnRhaW5pbmdGaWxlPzogc3RyaW5nLFxuICApOiBQcm9taXNlPENvbXBpbGF0aW9uT3V0cHV0PiB7XG4gICAgaWYgKCF0aGlzLl9wYXJlbnRDb21waWxhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdXZWJwYWNrUmVzb3VyY2VMb2FkZXIgY2Fubm90IGJlIHVzZWQgd2l0aG91dCBwYXJlbnRDb21waWxhdGlvbicpO1xuICAgIH1cblxuICAgIGNvbnN0IHsgY29udGV4dCwgd2VicGFjayB9ID0gdGhpcy5fcGFyZW50Q29tcGlsYXRpb24uY29tcGlsZXI7XG4gICAgY29uc3Qge1xuICAgICAgRW50cnlQbHVnaW4sXG4gICAgICBOb3JtYWxNb2R1bGUsXG4gICAgICBXZWJwYWNrRXJyb3IsXG4gICAgICBsaWJyYXJ5LFxuICAgICAgbm9kZSxcbiAgICAgIHNvdXJjZXMsXG4gICAgICB1dGlsOiB7IGNyZWF0ZUhhc2ggfSxcbiAgICB9ID0gd2VicGFjaztcblxuICAgIGNvbnN0IGdldEVudHJ5ID0gKCk6IHN0cmluZyA9PiB7XG4gICAgICBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgcmV0dXJuIGAke2ZpbGVQYXRofT8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX1gO1xuICAgICAgfSBlbHNlIGlmIChyZXNvdXJjZVR5cGUpIHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAvLyBhcHAuY29tcG9uZW50LnRzLTIuY3NzP25nUmVzb3VyY2UhPSFAbmd0b29scy93ZWJwYWNrL3NyYy9sb2FkZXJzL2lubGluZS1yZXNvdXJjZS5qcyFhcHAuY29tcG9uZW50LnRzXG4gICAgICAgICAgYCR7Y29udGFpbmluZ0ZpbGV9LSR7dGhpcy5vdXRwdXRQYXRoQ291bnRlcn0uJHtmaWxlRXh0ZW5zaW9ufWAgK1xuICAgICAgICAgIGA/JHtOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUll9IT0hJHt0aGlzLmlubGluZURhdGFMb2FkZXJQYXRofSEke2NvbnRhaW5pbmdGaWxlfWBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoZGF0YSkge1xuICAgICAgICAvLyBDcmVhdGUgYSBzcGVjaWFsIFVSTCBmb3IgcmVhZGluZyB0aGUgcmVzb3VyY2UgZnJvbSBtZW1vcnlcbiAgICAgICAgcmV0dXJuIGBhbmd1bGFyLXJlc291cmNlOiR7cmVzb3VyY2VUeXBlfSwke2NyZWF0ZUhhc2goJ3h4aGFzaDY0JylcbiAgICAgICAgICAudXBkYXRlKGRhdGEpXG4gICAgICAgICAgLmRpZ2VzdCgnaGV4Jyl9YDtcbiAgICAgIH1cblxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBcImZpbGVQYXRoXCIsIFwicmVzb3VyY2VUeXBlXCIgb3IgXCJkYXRhXCIgbXVzdCBiZSBzcGVjaWZpZWQuYCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGVudHJ5ID0gZ2V0RW50cnkoKTtcblxuICAgIC8vIFNpbXBsZSBzYW5pdHkgY2hlY2suXG4gICAgaWYgKGZpbGVQYXRoPy5tYXRjaCgvXFwuW2p0XXMkLykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYENhbm5vdCB1c2UgYSBKYXZhU2NyaXB0IG9yIFR5cGVTY3JpcHQgZmlsZSAoJHtmaWxlUGF0aH0pIGluIGEgY29tcG9uZW50J3Mgc3R5bGVVcmxzIG9yIHRlbXBsYXRlVXJsLmAsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IG91dHB1dEZpbGVQYXRoID1cbiAgICAgIGZpbGVQYXRoIHx8XG4gICAgICBgJHtjb250YWluaW5nRmlsZX0tYW5ndWxhci1pbmxpbmUtLSR7dGhpcy5vdXRwdXRQYXRoQ291bnRlcisrfS4ke1xuICAgICAgICByZXNvdXJjZVR5cGUgPT09ICd0ZW1wbGF0ZScgPyAnaHRtbCcgOiAnY3NzJ1xuICAgICAgfWA7XG4gICAgY29uc3Qgb3V0cHV0T3B0aW9ucyA9IHtcbiAgICAgIGZpbGVuYW1lOiBvdXRwdXRGaWxlUGF0aCxcbiAgICAgIGxpYnJhcnk6IHtcbiAgICAgICAgdHlwZTogJ3ZhcicsXG4gICAgICAgIG5hbWU6ICdyZXNvdXJjZScsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCBjaGlsZENvbXBpbGVyID0gdGhpcy5fcGFyZW50Q29tcGlsYXRpb24uY3JlYXRlQ2hpbGRDb21waWxlcihcbiAgICAgICdhbmd1bGFyLWNvbXBpbGVyOnJlc291cmNlJyxcbiAgICAgIG91dHB1dE9wdGlvbnMsXG4gICAgICBbXG4gICAgICAgIG5ldyBub2RlLk5vZGVUZW1wbGF0ZVBsdWdpbihvdXRwdXRPcHRpb25zKSxcbiAgICAgICAgbmV3IG5vZGUuTm9kZVRhcmdldFBsdWdpbigpLFxuICAgICAgICBuZXcgRW50cnlQbHVnaW4oY29udGV4dCwgZW50cnksIHsgbmFtZTogJ3Jlc291cmNlJyB9KSxcbiAgICAgICAgbmV3IGxpYnJhcnkuRW5hYmxlTGlicmFyeVBsdWdpbigndmFyJyksXG4gICAgICBdLFxuICAgICk7XG5cbiAgICBjaGlsZENvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoXG4gICAgICAnYW5ndWxhci1jb21waWxlcicsXG4gICAgICAoY29tcGlsYXRpb24sIHsgbm9ybWFsTW9kdWxlRmFjdG9yeSB9KSA9PiB7XG4gICAgICAgIC8vIElmIG5vIGRhdGEgaXMgcHJvdmlkZWQsIHRoZSByZXNvdXJjZSB3aWxsIGJlIHJlYWQgZnJvbSB0aGUgZmlsZXN5c3RlbVxuICAgICAgICBpZiAoZGF0YSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbm9ybWFsTW9kdWxlRmFjdG9yeS5ob29rcy5yZXNvbHZlRm9yU2NoZW1lXG4gICAgICAgICAgICAuZm9yKCdhbmd1bGFyLXJlc291cmNlJylcbiAgICAgICAgICAgIC50YXAoJ2FuZ3VsYXItY29tcGlsZXInLCAocmVzb3VyY2VEYXRhKSA9PiB7XG4gICAgICAgICAgICAgIGlmIChmaWxlUGF0aCkge1xuICAgICAgICAgICAgICAgIHJlc291cmNlRGF0YS5wYXRoID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VEYXRhLnJlc291cmNlID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIE5vcm1hbE1vZHVsZS5nZXRDb21waWxhdGlvbkhvb2tzKGNvbXBpbGF0aW9uKVxuICAgICAgICAgICAgLnJlYWRSZXNvdXJjZUZvclNjaGVtZS5mb3IoJ2FuZ3VsYXItcmVzb3VyY2UnKVxuICAgICAgICAgICAgLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IGRhdGEpO1xuXG4gICAgICAgICAgKGNvbXBpbGF0aW9uIGFzIENvbXBpbGF0aW9uV2l0aElubGluZUFuZ3VsYXJSZXNvdXJjZSlbSW5saW5lQW5ndWxhclJlc291cmNlU3ltYm9sXSA9IGRhdGE7XG4gICAgICAgIH1cblxuICAgICAgICBjb21waWxhdGlvbi5ob29rcy5hZGRpdGlvbmFsQXNzZXRzLnRhcCgnYW5ndWxhci1jb21waWxlcicsICgpID0+IHtcbiAgICAgICAgICBjb25zdCBhc3NldCA9IGNvbXBpbGF0aW9uLmFzc2V0c1tvdXRwdXRGaWxlUGF0aF07XG4gICAgICAgICAgaWYgKCFhc3NldCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvdXRwdXQgPSB0aGlzLl9ldmFsdWF0ZShvdXRwdXRGaWxlUGF0aCwgYXNzZXQuc291cmNlKCkudG9TdHJpbmcoKSk7XG5cbiAgICAgICAgICAgIGlmICh0eXBlb2Ygb3V0cHV0ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBjb21waWxhdGlvbi5hc3NldHNbb3V0cHV0RmlsZVBhdGhdID0gbmV3IHNvdXJjZXMuUmF3U291cmNlKG91dHB1dCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGFzc2VydChlcnJvciBpbnN0YW5jZW9mIEVycm9yLCAnY2F0Y2ggY2xhdXNlIHZhcmlhYmxlIGlzIG5vdCBhbiBFcnJvciBpbnN0YW5jZScpO1xuICAgICAgICAgICAgLy8gVXNlIGNvbXBpbGF0aW9uIGVycm9ycywgYXMgb3RoZXJ3aXNlIHdlYnBhY2sgd2lsbCBjaG9rZVxuICAgICAgICAgICAgY29tcGlsYXRpb24uZXJyb3JzLnB1c2gobmV3IFdlYnBhY2tFcnJvcihlcnJvci5tZXNzYWdlKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGxldCBmaW5hbENvbnRlbnQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBjaGlsZENvbXBpbGVyLmhvb2tzLmNvbXBpbGF0aW9uLnRhcCgnYW5ndWxhci1jb21waWxlcicsIChjaGlsZENvbXBpbGF0aW9uKSA9PiB7XG4gICAgICBjaGlsZENvbXBpbGF0aW9uLmhvb2tzLnByb2Nlc3NBc3NldHMudGFwKFxuICAgICAgICB7IG5hbWU6ICdhbmd1bGFyLWNvbXBpbGVyJywgc3RhZ2U6IHdlYnBhY2suQ29tcGlsYXRpb24uUFJPQ0VTU19BU1NFVFNfU1RBR0VfUkVQT1JUIH0sXG4gICAgICAgICgpID0+IHtcbiAgICAgICAgICBmaW5hbENvbnRlbnQgPSBjaGlsZENvbXBpbGF0aW9uLmFzc2V0c1tvdXRwdXRGaWxlUGF0aF0/LnNvdXJjZSgpLnRvU3RyaW5nKCk7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IHsgZmlsZXMgfSBvZiBjaGlsZENvbXBpbGF0aW9uLmNodW5rcykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICAgICAgICAgIGNoaWxkQ29tcGlsYXRpb24uZGVsZXRlQXNzZXQoZmlsZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9KTtcblxuICAgIHJldHVybiBuZXcgUHJvbWlzZTxDb21waWxhdGlvbk91dHB1dD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGRDb21waWxlci5ydW5Bc0NoaWxkKChlcnJvciwgXywgY2hpbGRDb21waWxhdGlvbikgPT4ge1xuICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICByZWplY3QoZXJyb3IpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2UgaWYgKCFjaGlsZENvbXBpbGF0aW9uKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignVW5rbm93biBjaGlsZCBjb21waWxhdGlvbiBlcnJvcicpKTtcblxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFdvcmthcm91bmQgdG8gYXR0ZW1wdCB0byByZWR1Y2UgbWVtb3J5IHVzYWdlIG9mIGNoaWxkIGNvbXBpbGF0aW9ucy5cbiAgICAgICAgLy8gVGhpcyByZW1vdmVzIHRoZSBjaGlsZCBjb21waWxhdGlvbiBmcm9tIHRoZSBtYWluIGNvbXBpbGF0aW9uIGFuZCBtYW51YWxseSBwcm9wYWdhdGVzXG4gICAgICAgIC8vIGFsbCBkZXBlbmRlbmNpZXMsIHdhcm5pbmdzLCBhbmQgZXJyb3JzLlxuICAgICAgICBjb25zdCBwYXJlbnQgPSBjaGlsZENvbXBpbGVyLnBhcmVudENvbXBpbGF0aW9uO1xuICAgICAgICBpZiAocGFyZW50KSB7XG4gICAgICAgICAgcGFyZW50LmNoaWxkcmVuID0gcGFyZW50LmNoaWxkcmVuLmZpbHRlcigoY2hpbGQpID0+IGNoaWxkICE9PSBjaGlsZENvbXBpbGF0aW9uKTtcbiAgICAgICAgICBsZXQgZmlsZURlcGVuZGVuY2llczogU2V0PHN0cmluZz4gfCB1bmRlZmluZWQ7XG5cbiAgICAgICAgICBmb3IgKGNvbnN0IGRlcGVuZGVuY3kgb2YgY2hpbGRDb21waWxhdGlvbi5maWxlRGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICAvLyBTa2lwIHBhdGhzIHRoYXQgZG8gbm90IGFwcGVhciB0byBiZSBmaWxlcyAoaGF2ZSBubyBleHRlbnNpb24pLlxuICAgICAgICAgICAgLy8gYGZpbGVEZXBlbmRlbmNpZXNgIGNhbiBjb250YWluIGRpcmVjdG9yaWVzIGFuZCBub3QganVzdCBmaWxlcyB3aGljaCBjYW5cbiAgICAgICAgICAgIC8vIGNhdXNlIGluY29ycmVjdCBjYWNoZSBpbnZhbGlkYXRpb24gb24gcmVidWlsZHMuXG4gICAgICAgICAgICBpZiAoIXBhdGguZXh0bmFtZShkZXBlbmRlbmN5KSkge1xuICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKGRhdGEgJiYgY29udGFpbmluZ0ZpbGUgJiYgZGVwZW5kZW5jeS5lbmRzV2l0aChlbnRyeSkpIHtcbiAgICAgICAgICAgICAgLy8gdXNlIGNvbnRhaW5pbmcgZmlsZSBpZiB0aGUgcmVzb3VyY2Ugd2FzIGlubGluZVxuICAgICAgICAgICAgICBwYXJlbnQuZmlsZURlcGVuZGVuY2llcy5hZGQoY29udGFpbmluZ0ZpbGUpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgcGFyZW50LmZpbGVEZXBlbmRlbmNpZXMuYWRkKGRlcGVuZGVuY3kpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBTYXZlIHRoZSBkZXBlbmRlbmNpZXMgZm9yIHRoaXMgcmVzb3VyY2UuXG4gICAgICAgICAgICBpZiAoZmlsZVBhdGgpIHtcbiAgICAgICAgICAgICAgY29uc3QgcmVzb2x2ZWRGaWxlID0gbm9ybWFsaXplUGF0aChkZXBlbmRlbmN5KTtcbiAgICAgICAgICAgICAgY29uc3QgZW50cnkgPSB0aGlzLl9yZXZlcnNlRGVwZW5kZW5jaWVzLmdldChyZXNvbHZlZEZpbGUpO1xuICAgICAgICAgICAgICBpZiAoZW50cnkpIHtcbiAgICAgICAgICAgICAgICBlbnRyeS5hZGQoZmlsZVBhdGgpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuX3JldmVyc2VEZXBlbmRlbmNpZXMuc2V0KHJlc29sdmVkRmlsZSwgbmV3IFNldChbZmlsZVBhdGhdKSk7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAoZmlsZURlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgICAgIGZpbGVEZXBlbmRlbmNpZXMuYWRkKGRlcGVuZGVuY3kpO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGZpbGVEZXBlbmRlbmNpZXMgPSBuZXcgU2V0KFtkZXBlbmRlbmN5XSk7XG4gICAgICAgICAgICAgICAgdGhpcy5fZmlsZURlcGVuZGVuY2llcy5zZXQoZmlsZVBhdGgsIGZpbGVEZXBlbmRlbmNpZXMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcGFyZW50LmNvbnRleHREZXBlbmRlbmNpZXMuYWRkQWxsKGNoaWxkQ29tcGlsYXRpb24uY29udGV4dERlcGVuZGVuY2llcyk7XG4gICAgICAgICAgcGFyZW50Lm1pc3NpbmdEZXBlbmRlbmNpZXMuYWRkQWxsKGNoaWxkQ29tcGlsYXRpb24ubWlzc2luZ0RlcGVuZGVuY2llcyk7XG4gICAgICAgICAgcGFyZW50LmJ1aWxkRGVwZW5kZW5jaWVzLmFkZEFsbChjaGlsZENvbXBpbGF0aW9uLmJ1aWxkRGVwZW5kZW5jaWVzKTtcblxuICAgICAgICAgIHBhcmVudC53YXJuaW5ncy5wdXNoKC4uLmNoaWxkQ29tcGlsYXRpb24ud2FybmluZ3MpO1xuICAgICAgICAgIHBhcmVudC5lcnJvcnMucHVzaCguLi5jaGlsZENvbXBpbGF0aW9uLmVycm9ycyk7XG5cbiAgICAgICAgICBpZiAodGhpcy5hc3NldENhY2hlKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHsgaW5mbywgbmFtZSwgc291cmNlIH0gb2YgY2hpbGRDb21waWxhdGlvbi5nZXRBc3NldHMoKSkge1xuICAgICAgICAgICAgICAvLyBVc2UgdGhlIG9yaWdpbmF0aW5nIGZpbGUgYXMgdGhlIGNhY2hlIGtleSBpZiBwcmVzZW50XG4gICAgICAgICAgICAgIC8vIE90aGVyd2lzZSwgZ2VuZXJhdGUgYSBjYWNoZSBrZXkgYmFzZWQgb24gdGhlIGdlbmVyYXRlZCBuYW1lXG4gICAgICAgICAgICAgIGNvbnN0IGNhY2hlS2V5ID0gaW5mby5zb3VyY2VGaWxlbmFtZSA/PyBgISFbR0VORVJBVEVEXToke25hbWV9YDtcblxuICAgICAgICAgICAgICB0aGlzLmFzc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCB7IGluZm8sIG5hbWUsIHNvdXJjZSB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICBjb250ZW50OiBmaW5hbENvbnRlbnQgPz8gJycsXG4gICAgICAgICAgc3VjY2VzczogY2hpbGRDb21waWxhdGlvbi5lcnJvcnM/Lmxlbmd0aCA9PT0gMCxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgX2V2YWx1YXRlKGZpbGVuYW1lOiBzdHJpbmcsIHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gRXZhbHVhdGUgY29kZVxuICAgIGNvbnN0IGNvbnRleHQ6IHsgcmVzb3VyY2U/OiBzdHJpbmcgfCB7IGRlZmF1bHQ/OiBzdHJpbmcgfSB9ID0ge307XG5cbiAgICB0cnkge1xuICAgICAgdm0ucnVuSW5OZXdDb250ZXh0KHNvdXJjZSwgY29udGV4dCwgeyBmaWxlbmFtZSB9KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIEVycm9yIGFyZSBwcm9wYWdhdGVkIHRocm91Z2ggdGhlIGNoaWxkIGNvbXBpbGF0aW9uLlxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBjb250ZXh0LnJlc291cmNlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGNvbnRleHQucmVzb3VyY2U7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgY29udGV4dC5yZXNvdXJjZT8uZGVmYXVsdCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHJldHVybiBjb250ZXh0LnJlc291cmNlLmRlZmF1bHQ7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBUaGUgbG9hZGVyIFwiJHtmaWxlbmFtZX1cIiBkaWRuJ3QgcmV0dXJuIGEgc3RyaW5nLmApO1xuICB9XG5cbiAgYXN5bmMgZ2V0KGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRGaWxlID0gbm9ybWFsaXplUGF0aChmaWxlUGF0aCk7XG4gICAgbGV0IGNvbXBpbGF0aW9uUmVzdWx0ID0gdGhpcy5maWxlQ2FjaGU/LmdldChub3JtYWxpemVkRmlsZSk7XG5cbiAgICBpZiAoY29tcGlsYXRpb25SZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gY2FjaGUgbWlzcyBzbyBjb21waWxlIHJlc291cmNlXG4gICAgICBjb21waWxhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMuX2NvbXBpbGUoZmlsZVBhdGgpO1xuXG4gICAgICAvLyBPbmx5IGNhY2hlIGlmIGNvbXBpbGF0aW9uIHdhcyBzdWNjZXNzZnVsXG4gICAgICBpZiAodGhpcy5maWxlQ2FjaGUgJiYgY29tcGlsYXRpb25SZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICB0aGlzLmZpbGVDYWNoZS5zZXQobm9ybWFsaXplZEZpbGUsIGNvbXBpbGF0aW9uUmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gY29tcGlsYXRpb25SZXN1bHQuY29udGVudDtcbiAgfVxuXG4gIGFzeW5jIHByb2Nlc3MoXG4gICAgZGF0YTogc3RyaW5nLFxuICAgIGZpbGVFeHRlbnNpb246IHN0cmluZyB8IHVuZGVmaW5lZCxcbiAgICByZXNvdXJjZVR5cGU6ICd0ZW1wbGF0ZScgfCAnc3R5bGUnLFxuICAgIGNvbnRhaW5pbmdGaWxlPzogc3RyaW5nLFxuICApOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGlmIChkYXRhLnRyaW0oKS5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBjb25zdCBjb21waWxhdGlvblJlc3VsdCA9IGF3YWl0IHRoaXMuX2NvbXBpbGUoXG4gICAgICB1bmRlZmluZWQsXG4gICAgICBkYXRhLFxuICAgICAgZmlsZUV4dGVuc2lvbixcbiAgICAgIHJlc291cmNlVHlwZSxcbiAgICAgIGNvbnRhaW5pbmdGaWxlLFxuICAgICk7XG5cbiAgICByZXR1cm4gY29tcGlsYXRpb25SZXN1bHQuY29udGVudDtcbiAgfVxufVxuIl19