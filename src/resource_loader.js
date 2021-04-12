"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebpackResourceLoader = void 0;
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const vm = require("vm");
const webpack_1 = require("webpack");
const webpack_sources_1 = require("webpack-sources");
const paths_1 = require("./ivy/paths");
const webpack_version_1 = require("./webpack-version");
const NodeTemplatePlugin = require('webpack/lib/node/NodeTemplatePlugin');
const NodeTargetPlugin = require('webpack/lib/node/NodeTargetPlugin');
const LibraryTemplatePlugin = require('webpack/lib/LibraryTemplatePlugin');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');
class WebpackResourceLoader {
    constructor() {
        this._fileDependencies = new Map();
        this._reverseDependencies = new Map();
        this.cache = new Map();
        this.modifiedResources = new Set();
        this.outputPathCounter = 1;
    }
    update(parentCompilation, changedFiles) {
        this._parentCompilation = parentCompilation;
        // Update resource cache and modified resources
        this.modifiedResources.clear();
        if (changedFiles) {
            for (const changedFile of changedFiles) {
                for (const affectedResource of this.getAffectedResources(changedFile)) {
                    this.cache.delete(paths_1.normalizePath(affectedResource));
                    this.modifiedResources.add(affectedResource);
                }
            }
        }
        else {
            this.cache.clear();
        }
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
    async _compile(filePath, data, mimeType) {
        if (!this._parentCompilation) {
            throw new Error('WebpackResourceLoader cannot be used without parentCompilation');
        }
        // Simple sanity check.
        if (filePath === null || filePath === void 0 ? void 0 : filePath.match(/\.[jt]s$/)) {
            return Promise.reject(`Cannot use a JavaScript or TypeScript file (${filePath}) in a component's styleUrls or templateUrl.`);
        }
        // Create a special URL for reading the resource from memory
        const angularScheme = 'angular-resource://';
        const outputFilePath = filePath || `angular-resource-output-${this.outputPathCounter++}.css`;
        const outputOptions = { filename: outputFilePath };
        const context = this._parentCompilation.compiler.context;
        const childCompiler = this._parentCompilation.createChildCompiler('angular-compiler:resource', outputOptions, [
            new NodeTemplatePlugin(outputOptions),
            new NodeTargetPlugin(),
            new SingleEntryPlugin(context, data ? angularScheme : filePath, 'resource'),
            new LibraryTemplatePlugin('resource', 'var'),
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
                    if (mimeType) {
                        resourceData.data.mimetype = mimeType;
                    }
                    return true;
                });
                webpack_1.NormalModule.getCompilationHooks(compilation)
                    .readResourceForScheme.for('angular-resource')
                    .tap('angular-compiler', () => data);
            }
            compilation.hooks.additionalAssets.tap('angular-compiler', () => {
                const asset = compilation.assets[outputFilePath];
                if (!asset) {
                    return;
                }
                try {
                    const output = this._evaluate(outputFilePath, asset.source().toString());
                    if (typeof output === 'string') {
                        // `webpack-sources` package has incomplete typings
                        // tslint:disable-next-line: no-any
                        compilation.assets[outputFilePath] = new webpack_sources_1.RawSource(output);
                    }
                }
                catch (error) {
                    // Use compilation errors, as otherwise webpack will choke
                    compilation.errors.push(error);
                }
            });
        });
        let finalContent;
        let finalMap;
        if (webpack_version_1.isWebpackFiveOrHigher()) {
            childCompiler.hooks.compilation.tap('angular-compiler', (childCompilation) => {
                // tslint:disable-next-line: no-any
                childCompilation.hooks.processAssets.tap({ name: 'angular-compiler', stage: 5000 }, () => {
                    var _a, _b;
                    finalContent = (_a = childCompilation.assets[outputFilePath]) === null || _a === void 0 ? void 0 : _a.source().toString();
                    finalMap = (_b = childCompilation.assets[outputFilePath + '.map']) === null || _b === void 0 ? void 0 : _b.source().toString();
                    delete childCompilation.assets[outputFilePath];
                    delete childCompilation.assets[outputFilePath + '.map'];
                });
            });
        }
        else {
            childCompiler.hooks.afterCompile.tap('angular-compiler', (childCompilation) => {
                var _a, _b;
                finalContent = (_a = childCompilation.assets[outputFilePath]) === null || _a === void 0 ? void 0 : _a.source().toString();
                finalMap = (_b = childCompilation.assets[outputFilePath + '.map']) === null || _b === void 0 ? void 0 : _b.source().toString();
                delete childCompilation.assets[outputFilePath];
                delete childCompilation.assets[outputFilePath + '.map'];
            });
        }
        return new Promise((resolve, reject) => {
            childCompiler.runAsChild((error, _, childCompilation) => {
                var _a;
                if (error) {
                    reject(error);
                    return;
                }
                else if (!childCompilation) {
                    reject(new Error('Unknown child compilation error'));
                    return;
                }
                // Save the dependencies for this resource.
                if (filePath) {
                    this._fileDependencies.set(filePath, new Set(childCompilation.fileDependencies));
                    for (const file of childCompilation.fileDependencies) {
                        const resolvedFile = paths_1.normalizePath(file);
                        const entry = this._reverseDependencies.get(resolvedFile);
                        if (entry) {
                            entry.add(filePath);
                        }
                        else {
                            this._reverseDependencies.set(resolvedFile, new Set([filePath]));
                        }
                    }
                }
                resolve({
                    content: finalContent !== null && finalContent !== void 0 ? finalContent : '',
                    map: finalMap,
                    success: ((_a = childCompilation.errors) === null || _a === void 0 ? void 0 : _a.length) === 0,
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
        catch {
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
        const normalizedFile = paths_1.normalizePath(filePath);
        let compilationResult = this.cache.get(normalizedFile);
        if (compilationResult === undefined) {
            // cache miss so compile resource
            compilationResult = await this._compile(filePath);
            // Only cache if compilation was successful
            if (compilationResult.success) {
                this.cache.set(normalizedFile, compilationResult);
            }
        }
        return compilationResult.content;
    }
    async process(data, mimeType) {
        if (data.trim().length === 0) {
            return '';
        }
        const compilationResult = await this._compile(undefined, data, mimeType);
        return compilationResult.content;
    }
}
exports.WebpackResourceLoader = WebpackResourceLoader;
