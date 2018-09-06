"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
// TODO: fix typings.
// tslint:disable-next-line:no-global-tslint-disable
// tslint:disable:no-any
const path = require("path");
const vm = require("vm");
const webpack_sources_1 = require("webpack-sources");
const NodeTemplatePlugin = require('webpack/lib/node/NodeTemplatePlugin');
const NodeTargetPlugin = require('webpack/lib/node/NodeTargetPlugin');
const LoaderTargetPlugin = require('webpack/lib/LoaderTargetPlugin');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');
class WebpackResourceLoader {
    constructor() {
        this._fileDependencies = new Map();
        this._cachedSources = new Map();
        this._cachedEvaluatedSources = new Map();
    }
    update(parentCompilation) {
        this._parentCompilation = parentCompilation;
        this._context = parentCompilation.context;
    }
    getResourceDependencies(filePath) {
        return this._fileDependencies.get(filePath) || [];
    }
    _compile(filePath) {
        if (!this._parentCompilation) {
            throw new Error('WebpackResourceLoader cannot be used without parentCompilation');
        }
        // Simple sanity check.
        if (filePath.match(/\.[jt]s$/)) {
            return Promise.reject('Cannot use a JavaScript or TypeScript file for styleUrl.');
        }
        const outputOptions = { filename: filePath };
        const relativePath = path.relative(this._context || '', filePath);
        const childCompiler = this._parentCompilation.createChildCompiler(relativePath, outputOptions);
        childCompiler.context = this._context;
        new NodeTemplatePlugin(outputOptions).apply(childCompiler);
        new NodeTargetPlugin().apply(childCompiler);
        new SingleEntryPlugin(this._context, filePath).apply(childCompiler);
        new LoaderTargetPlugin('node').apply(childCompiler);
        childCompiler.hooks.thisCompilation.tap('ngtools-webpack', (compilation) => {
            compilation.hooks.additionalAssets.tapAsync('ngtools-webpack', (callback) => {
                if (this._cachedEvaluatedSources.has(compilation.fullHash)) {
                    const cachedEvaluatedSource = this._cachedEvaluatedSources.get(compilation.fullHash);
                    compilation.assets[filePath] = cachedEvaluatedSource;
                    callback();
                    return;
                }
                const asset = compilation.assets[filePath];
                if (asset) {
                    this._evaluate({ outputName: filePath, source: asset.source() })
                        .then(output => {
                        const evaluatedSource = new webpack_sources_1.RawSource(output);
                        this._cachedEvaluatedSources.set(compilation.fullHash, evaluatedSource);
                        compilation.assets[filePath] = evaluatedSource;
                        callback();
                    })
                        .catch(err => callback(err));
                }
                else {
                    callback();
                }
            });
        });
        // Compile and return a promise
        return new Promise((resolve, reject) => {
            childCompiler.compile((err, childCompilation) => {
                // Resolve / reject the promise
                if (childCompilation && childCompilation.errors && childCompilation.errors.length) {
                    const errorDetails = childCompilation.errors.map(function (error) {
                        return error.message + (error.error ? ':\n' + error.error : '');
                    }).join('\n');
                    reject(new Error('Child compilation failed:\n' + errorDetails));
                }
                else if (err) {
                    reject(err);
                }
                else {
                    Object.keys(childCompilation.assets).forEach(assetName => {
                        // Add all new assets to the parent compilation, with the exception of
                        // the file we're loading and its sourcemap.
                        if (assetName !== filePath
                            && assetName !== `${filePath}.map`
                            && this._parentCompilation.assets[assetName] == undefined) {
                            this._parentCompilation.assets[assetName] = childCompilation.assets[assetName];
                        }
                    });
                    // Save the dependencies for this resource.
                    this._fileDependencies.set(filePath, childCompilation.fileDependencies);
                    const compilationHash = childCompilation.fullHash;
                    const maybeSource = this._cachedSources.get(compilationHash);
                    if (maybeSource) {
                        resolve({ outputName: filePath, source: maybeSource });
                    }
                    else {
                        const source = childCompilation.assets[filePath].source();
                        this._cachedSources.set(compilationHash, source);
                        resolve({ outputName: filePath, source });
                    }
                }
            });
        });
    }
    _evaluate({ outputName, source }) {
        try {
            // Evaluate code
            const evaluatedSource = vm.runInNewContext(source, undefined, { filename: outputName });
            if (typeof evaluatedSource == 'string') {
                return Promise.resolve(evaluatedSource);
            }
            return Promise.reject('The loader "' + outputName + '" didn\'t return a string.');
        }
        catch (e) {
            return Promise.reject(e);
        }
    }
    get(filePath) {
        return this._compile(filePath)
            .then((result) => result.source);
    }
}
exports.WebpackResourceLoader = WebpackResourceLoader;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2VfbG9hZGVyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3Jlc291cmNlX2xvYWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILHFCQUFxQjtBQUNyQixvREFBb0Q7QUFDcEQsd0JBQXdCO0FBQ3hCLDZCQUE2QjtBQUM3Qix5QkFBeUI7QUFDekIscURBQTRDO0FBRTVDLE1BQU0sa0JBQWtCLEdBQUcsT0FBTyxDQUFDLHFDQUFxQyxDQUFDLENBQUM7QUFDMUUsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsbUNBQW1DLENBQUMsQ0FBQztBQUN0RSxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBQ3JFLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLCtCQUErQixDQUFDLENBQUM7QUFRbkUsTUFBYSxxQkFBcUI7SUFPaEM7UUFKUSxzQkFBaUIsR0FBRyxJQUFJLEdBQUcsRUFBb0IsQ0FBQztRQUNoRCxtQkFBYyxHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO1FBQzNDLDRCQUF1QixHQUFHLElBQUksR0FBRyxFQUFxQixDQUFDO0lBRWhELENBQUM7SUFFaEIsTUFBTSxDQUFDLGlCQUFzQjtRQUMzQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsaUJBQWlCLENBQUM7UUFDNUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxpQkFBaUIsQ0FBQyxPQUFPLENBQUM7SUFDNUMsQ0FBQztJQUVELHVCQUF1QixDQUFDLFFBQWdCO1FBQ3RDLE9BQU8sSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDcEQsQ0FBQztJQUVPLFFBQVEsQ0FBQyxRQUFnQjtRQUUvQixJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFO1lBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0VB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Q0FBQyxDQUFDLE1BQXlCLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUN4RCxDQUFDO0NBQ0Y7QUEvSEQsc0RBK0hDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBJbmMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuLy8gVE9ETzogZml4IHR5cGluZ3MuXG4vLyB0c2xpbnQ6ZGlzYWJsZS1uZXh0LWxpbmU6bm8tZ2xvYmFsLXRzbGludC1kaXNhYmxlXG4vLyB0c2xpbnQ6ZGlzYWJsZTpuby1hbnlcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyB2bSBmcm9tICd2bSc7XG5pbXBvcnQgeyBSYXdTb3VyY2UgfSBmcm9tICd3ZWJwYWNrLXNvdXJjZXMnO1xuXG5jb25zdCBOb2RlVGVtcGxhdGVQbHVnaW4gPSByZXF1aXJlKCd3ZWJwYWNrL2xpYi9ub2RlL05vZGVUZW1wbGF0ZVBsdWdpbicpO1xuY29uc3QgTm9kZVRhcmdldFBsdWdpbiA9IHJlcXVpcmUoJ3dlYnBhY2svbGliL25vZGUvTm9kZVRhcmdldFBsdWdpbicpO1xuY29uc3QgTG9hZGVyVGFyZ2V0UGx1Z2luID0gcmVxdWlyZSgnd2VicGFjay9saWIvTG9hZGVyVGFyZ2V0UGx1Z2luJyk7XG5jb25zdCBTaW5nbGVFbnRyeVBsdWdpbiA9IHJlcXVpcmUoJ3dlYnBhY2svbGliL1NpbmdsZUVudHJ5UGx1Z2luJyk7XG5cblxuaW50ZXJmYWNlIENvbXBpbGF0aW9uT3V0cHV0IHtcbiAgb3V0cHV0TmFtZTogc3RyaW5nO1xuICBzb3VyY2U6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFdlYnBhY2tSZXNvdXJjZUxvYWRlciB7XG4gIHByaXZhdGUgX3BhcmVudENvbXBpbGF0aW9uOiBhbnk7XG4gIHByaXZhdGUgX2NvbnRleHQ6IHN0cmluZztcbiAgcHJpdmF0ZSBfZmlsZURlcGVuZGVuY2llcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmdbXT4oKTtcbiAgcHJpdmF0ZSBfY2FjaGVkU291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIHByaXZhdGUgX2NhY2hlZEV2YWx1YXRlZFNvdXJjZXMgPSBuZXcgTWFwPHN0cmluZywgUmF3U291cmNlPigpO1xuXG4gIGNvbnN0cnVjdG9yKCkge31cblxuICB1cGRhdGUocGFyZW50Q29tcGlsYXRpb246IGFueSkge1xuICAgIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uID0gcGFyZW50Q29tcGlsYXRpb247XG4gICAgdGhpcy5fY29udGV4dCA9IHBhcmVudENvbXBpbGF0aW9uLmNvbnRleHQ7XG4gIH1cblxuICBnZXRSZXNvdXJjZURlcGVuZGVuY2llcyhmaWxlUGF0aDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2ZpbGVEZXBlbmRlbmNpZXMuZ2V0KGZpbGVQYXRoKSB8fCBbXTtcbiAgfVxuXG4gIHByaXZhdGUgX2NvbXBpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8Q29tcGlsYXRpb25PdXRwdXQ+IHtcblxuICAgIGlmICghdGhpcy5fcGFyZW50Q29tcGlsYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignV2VicGFja1Jlc291cmNlTG9hZGVyIGNhbm5vdCBiZSB1c2VkIHdpdGhvdXQgcGFyZW50Q29tcGlsYXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBTaW1wbGUgc2FuaXR5IGNoZWNrLlxuICAgIGlmIChmaWxlUGF0aC5tYXRjaCgvXFwuW2p0XXMkLykpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdCgnQ2Fubm90IHVzZSBhIEphdmFTY3JpcHQgb3IgVHlwZVNjcmlwdCBmaWxlIGZvciBzdHlsZVVybC4nKTtcbiAgICB9XG5cbiAgICBjb25zdCBvdXRwdXRPcHRpb25zID0geyBmaWxlbmFtZTogZmlsZVBhdGggfTtcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSBwYXRoLnJlbGF0aXZlKHRoaXMuX2NvbnRleHQgfHwgJycsIGZpbGVQYXRoKTtcbiAgICBjb25zdCBjaGlsZENvbXBpbGVyID0gdGhpcy5fcGFyZW50Q29tcGlsYXRpb24uY3JlYXRlQ2hpbGRDb21waWxlcihyZWxhdGl2ZVBhdGgsIG91dHB1dE9wdGlvbnMpO1xuICAgIGNoaWxkQ29tcGlsZXIuY29udGV4dCA9IHRoaXMuX2NvbnRleHQ7XG5cbiAgICBuZXcgTm9kZVRlbXBsYXRlUGx1Z2luKG91dHB1dE9wdGlvbnMpLmFwcGx5KGNoaWxkQ29tcGlsZXIpO1xuICAgIG5ldyBOb2RlVGFyZ2V0UGx1Z2luKCkuYXBwbHkoY2hpbGRDb21waWxlcik7XG4gICAgbmV3IFNpbmdsZUVudHJ5UGx1Z2luKHRoaXMuX2NvbnRleHQsIGZpbGVQYXRoKS5hcHBseShjaGlsZENvbXBpbGVyKTtcbiAgICBuZXcgTG9hZGVyVGFyZ2V0UGx1Z2luKCdub2RlJykuYXBwbHkoY2hpbGRDb21waWxlcik7XG5cbiAgICBjaGlsZENvbXBpbGVyLmhvb2tzLnRoaXNDb21waWxhdGlvbi50YXAoJ25ndG9vbHMtd2VicGFjaycsIChjb21waWxhdGlvbjogYW55KSA9PiB7XG4gICAgICBjb21waWxhdGlvbi5ob29rcy5hZGRpdGlvbmFsQXNzZXRzLnRhcEFzeW5jKCduZ3Rvb2xzLXdlYnBhY2snLFxuICAgICAgKGNhbGxiYWNrOiAoZXJyPzogRXJyb3IpID0+IHZvaWQpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX2NhY2hlZEV2YWx1YXRlZFNvdXJjZXMuaGFzKGNvbXBpbGF0aW9uLmZ1bGxIYXNoKSkge1xuICAgICAgICAgIGNvbnN0IGNhY2hlZEV2YWx1YXRlZFNvdXJjZSA9IHRoaXMuX2NhY2hlZEV2YWx1YXRlZFNvdXJjZXMuZ2V0KGNvbXBpbGF0aW9uLmZ1bGxIYXNoKTtcbiAgICAgICAgICBjb21waWxhdGlvbi5hc3NldHNbZmlsZVBhdGhdID0gY2FjaGVkRXZhbHVhdGVkU291cmNlO1xuICAgICAgICAgIGNhbGxiYWNrKCk7XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhc3NldCA9IGNvbXBpbGF0aW9uLmFzc2V0c1tmaWxlUGF0aF07XG4gICAgICAgIGlmIChhc3NldCkge1xuICAgICAgICAgIHRoaXMuX2V2YWx1YXRlKHsgb3V0cHV0TmFtZTogZmlsZVBhdGgsIHNvdXJjZTogYXNzZXQuc291cmNlKCkgfSlcbiAgICAgICAgICAgIC50aGVuKG91dHB1dCA9PiB7XG4gICAgICAgICAgICAgIGNvbnN0IGV2YWx1YXRlZFNvdXJjZSA9IG5ldyBSYXdTb3VyY2Uob3V0cHV0KTtcbiAgICAgICAgICAgICAgdGhpcy5fY2FjaGVkRXZhbHVhdGVkU291cmNlcy5zZXQoY29tcGlsYXRpb24uZnVsbEhhc2gsIGV2YWx1YXRlZFNvdXJjZSk7XG4gICAgICAgICAgICAgIGNvbXBpbGF0aW9uLmFzc2V0c1tmaWxlUGF0aF0gPSBldmFsdWF0ZWRTb3VyY2U7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLmNhdGNoKGVyciA9PiBjYWxsYmFjayhlcnIpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIENvbXBpbGUgYW5kIHJldHVybiBhIHByb21pc2VcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY2hpbGRDb21waWxlci5jb21waWxlKChlcnI6IEVycm9yLCBjaGlsZENvbXBpbGF0aW9uOiBhbnkpID0+IHtcbiAgICAgICAgLy8gUmVzb2x2ZSAvIHJlamVjdCB0aGUgcHJvbWlzZVxuICAgICAgICBpZiAoY2hpbGRDb21waWxhdGlvbiAmJiBjaGlsZENvbXBpbGF0aW9uLmVycm9ycyAmJiBjaGlsZENvbXBpbGF0aW9uLmVycm9ycy5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCBlcnJvckRldGFpbHMgPSBjaGlsZENvbXBpbGF0aW9uLmVycm9ycy5tYXAoZnVuY3Rpb24gKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHJldHVybiBlcnJvci5tZXNzYWdlICsgKGVycm9yLmVycm9yID8gJzpcXG4nICsgZXJyb3IuZXJyb3IgOiAnJyk7XG4gICAgICAgICAgfSkuam9pbignXFxuJyk7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcignQ2hpbGQgY29tcGlsYXRpb24gZmFpbGVkOlxcbicgKyBlcnJvckRldGFpbHMpKTtcbiAgICAgICAgfSBlbHNlIGlmIChlcnIpIHtcbiAgICAgICAgICByZWplY3QoZXJyKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBPYmplY3Qua2V5cyhjaGlsZENvbXBpbGF0aW9uLmFzc2V0cykuZm9yRWFjaChhc3NldE5hbWUgPT4ge1xuICAgICAgICAgICAgLy8gQWRkIGFsbCBuZXcgYXNzZXRzIHRvIHRoZSBwYXJlbnQgY29tcGlsYXRpb24sIHdpdGggdGhlIGV4Y2VwdGlvbiBvZlxuICAgICAgICAgICAgLy8gdGhlIGZpbGUgd2UncmUgbG9hZGluZyBhbmQgaXRzIHNvdXJjZW1hcC5cbiAgICAgICAgICAgIGlmIChcbiAgICAgICAgICAgICAgYXNzZXROYW1lICE9PSBmaWxlUGF0aFxuICAgICAgICAgICAgICAmJiBhc3NldE5hbWUgIT09IGAke2ZpbGVQYXRofS5tYXBgXG4gICAgICAgICAgICAgICYmIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmFzc2V0c1thc3NldE5hbWVdID09IHVuZGVmaW5lZFxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmFzc2V0c1thc3NldE5hbWVdID0gY2hpbGRDb21waWxhdGlvbi5hc3NldHNbYXNzZXROYW1lXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIFNhdmUgdGhlIGRlcGVuZGVuY2llcyBmb3IgdGhpcyByZXNvdXJjZS5cbiAgICAgICAgICB0aGlzLl9maWxlRGVwZW5kZW5jaWVzLnNldChmaWxlUGF0aCwgY2hpbGRDb21waWxhdGlvbi5maWxlRGVwZW5kZW5jaWVzKTtcblxuICAgICAgICAgIGNvbnN0IGNvbXBpbGF0aW9uSGFzaCA9IGNoaWxkQ29tcGlsYXRpb24uZnVsbEhhc2g7XG4gICAgICAgICAgY29uc3QgbWF5YmVTb3VyY2UgPSB0aGlzLl9jYWNoZWRTb3VyY2VzLmdldChjb21waWxhdGlvbkhhc2gpO1xuICAgICAgICAgIGlmIChtYXliZVNvdXJjZSkge1xuICAgICAgICAgICAgcmVzb2x2ZSh7IG91dHB1dE5hbWU6IGZpbGVQYXRoLCBzb3VyY2U6IG1heWJlU291cmNlIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBzb3VyY2UgPSBjaGlsZENvbXBpbGF0aW9uLmFzc2V0c1tmaWxlUGF0aF0uc291cmNlKCk7XG4gICAgICAgICAgICB0aGlzLl9jYWNoZWRTb3VyY2VzLnNldChjb21waWxhdGlvbkhhc2gsIHNvdXJjZSk7XG5cbiAgICAgICAgICAgIHJlc29sdmUoeyBvdXRwdXROYW1lOiBmaWxlUGF0aCwgc291cmNlIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIF9ldmFsdWF0ZSh7IG91dHB1dE5hbWUsIHNvdXJjZSB9OiBDb21waWxhdGlvbk91dHB1dCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEV2YWx1YXRlIGNvZGVcbiAgICAgIGNvbnN0IGV2YWx1YXRlZFNvdXJjZSA9IHZtLnJ1bkluTmV3Q29udGV4dChzb3VyY2UsIHVuZGVmaW5lZCwgeyBmaWxlbmFtZTogb3V0cHV0TmFtZSB9KTtcblxuICAgICAgaWYgKHR5cGVvZiBldmFsdWF0ZWRTb3VyY2UgPT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShldmFsdWF0ZWRTb3VyY2UpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoJ1RoZSBsb2FkZXIgXCInICsgb3V0cHV0TmFtZSArICdcIiBkaWRuXFwndCByZXR1cm4gYSBzdHJpbmcuJyk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KGUpO1xuICAgIH1cbiAgfVxuXG4gIGdldChmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gdGhpcy5fY29tcGlsZShmaWxlUGF0aClcbiAgICAgIC50aGVuKChyZXN1bHQ6IENvbXBpbGF0aW9uT3V0cHV0KSA9PiByZXN1bHQuc291cmNlKTtcbiAgfVxufVxuIl19