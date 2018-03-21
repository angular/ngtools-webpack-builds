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
        this._resourceDependencies = new Map();
        this._cachedResources = new Map();
    }
    update(parentCompilation) {
        this._parentCompilation = parentCompilation;
        this._context = parentCompilation.context;
    }
    getResourceDependencies(filePath) {
        return this._resourceDependencies.get(filePath) || [];
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
                if (this._cachedResources.has(compilation.fullHash)) {
                    callback();
                    return;
                }
                const asset = compilation.assets[filePath];
                if (asset) {
                    this._evaluate({ outputName: filePath, source: asset.source() })
                        .then(output => {
                        compilation.assets[filePath] = new webpack_sources_1.RawSource(output);
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
                        if (assetName !== filePath && this._parentCompilation.assets[assetName] == undefined) {
                            this._parentCompilation.assets[assetName] = childCompilation.assets[assetName];
                        }
                    });
                    // Save the dependencies for this resource.
                    this._resourceDependencies.set(filePath, childCompilation.fileDependencies);
                    const compilationHash = childCompilation.fullHash;
                    const maybeSource = this._cachedResources.get(compilationHash);
                    if (maybeSource) {
                        resolve({ outputName: filePath, source: maybeSource });
                    }
                    else {
                        const source = childCompilation.assets[filePath].source();
                        this._cachedResources.set(compilationHash, source);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzb3VyY2VfbG9hZGVyLmpzIiwic291cmNlUm9vdCI6Ii4vIiwic291cmNlcyI6WyJwYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3Jlc291cmNlX2xvYWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILHFCQUFxQjtBQUNyQixvREFBb0Q7QUFDcEQsd0JBQXdCO0FBQ3hCLDZCQUE2QjtBQUM3Qix5QkFBeUI7QUFDekIscURBQTRDO0FBRTVDLE1BQU0sa0JBQWtCLEdBQUcsT0FBTyxDQUFDLHFDQUFxQyxDQUFDLENBQUM7QUFDMUUsTUFBTSxnQkFBZ0IsR0FBRyxPQUFPLENBQUMsbUNBQW1DLENBQUMsQ0FBQztBQUN0RSxNQUFNLGtCQUFrQixHQUFHLE9BQU8sQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO0FBQ3JFLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLCtCQUErQixDQUFDLENBQUM7QUFRbkU7SUFNRTtRQUhRLDBCQUFxQixHQUFHLElBQUksR0FBRyxFQUFvQixDQUFDO1FBQ3BELHFCQUFnQixHQUFHLElBQUksR0FBRyxFQUFrQixDQUFDO0lBRXRDLENBQUM7SUFFaEIsTUFBTSxDQUFDLGlCQUFzQjtRQUMzQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsaUJBQWlCLENBQUM7UUFDNUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxpQkFBaUIsQ0FBQyxPQUFPLENBQUM7SUFDNUMsQ0FBQztJQUVELHVCQUF1QixDQUFDLFFBQWdCO1FBQ3RDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUN4RCxDQUFDO0lBRU8sUUFBUSxDQUFDLFFBQWdCO1FBRS9CLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztZQUM3QixNQUFNLElBQUksS0FBSyxDQUFDLGdFQUFnRSxDQUFDLENBQUM7UUFDcEYsQ0FBQztR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Q0FBQyxRQUFRLENBQUM7YUFDM0IsSUFBSSxDQUFDLENBQUMsTUFBeUIsRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ3hELENBQUM7Q0FDRjtBQW5IRCxzREFtSEMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG4vLyBUT0RPOiBmaXggdHlwaW5ncy5cbi8vIHRzbGludDpkaXNhYmxlLW5leHQtbGluZTpuby1nbG9iYWwtdHNsaW50LWRpc2FibGVcbi8vIHRzbGludDpkaXNhYmxlOm5vLWFueVxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHZtIGZyb20gJ3ZtJztcbmltcG9ydCB7IFJhd1NvdXJjZSB9IGZyb20gJ3dlYnBhY2stc291cmNlcyc7XG5cbmNvbnN0IE5vZGVUZW1wbGF0ZVBsdWdpbiA9IHJlcXVpcmUoJ3dlYnBhY2svbGliL25vZGUvTm9kZVRlbXBsYXRlUGx1Z2luJyk7XG5jb25zdCBOb2RlVGFyZ2V0UGx1Z2luID0gcmVxdWlyZSgnd2VicGFjay9saWIvbm9kZS9Ob2RlVGFyZ2V0UGx1Z2luJyk7XG5jb25zdCBMb2FkZXJUYXJnZXRQbHVnaW4gPSByZXF1aXJlKCd3ZWJwYWNrL2xpYi9Mb2FkZXJUYXJnZXRQbHVnaW4nKTtcbmNvbnN0IFNpbmdsZUVudHJ5UGx1Z2luID0gcmVxdWlyZSgnd2VicGFjay9saWIvU2luZ2xlRW50cnlQbHVnaW4nKTtcblxuXG5pbnRlcmZhY2UgQ29tcGlsYXRpb25PdXRwdXQge1xuICBvdXRwdXROYW1lOiBzdHJpbmc7XG4gIHNvdXJjZTogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgV2VicGFja1Jlc291cmNlTG9hZGVyIHtcbiAgcHJpdmF0ZSBfcGFyZW50Q29tcGlsYXRpb246IGFueTtcbiAgcHJpdmF0ZSBfY29udGV4dDogc3RyaW5nO1xuICBwcml2YXRlIF9yZXNvdXJjZURlcGVuZGVuY2llcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmdbXT4oKTtcbiAgcHJpdmF0ZSBfY2FjaGVkUmVzb3VyY2VzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcblxuICBjb25zdHJ1Y3RvcigpIHt9XG5cbiAgdXBkYXRlKHBhcmVudENvbXBpbGF0aW9uOiBhbnkpIHtcbiAgICB0aGlzLl9wYXJlbnRDb21waWxhdGlvbiA9IHBhcmVudENvbXBpbGF0aW9uO1xuICAgIHRoaXMuX2NvbnRleHQgPSBwYXJlbnRDb21waWxhdGlvbi5jb250ZXh0O1xuICB9XG5cbiAgZ2V0UmVzb3VyY2VEZXBlbmRlbmNpZXMoZmlsZVBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9yZXNvdXJjZURlcGVuZGVuY2llcy5nZXQoZmlsZVBhdGgpIHx8IFtdO1xuICB9XG5cbiAgcHJpdmF0ZSBfY29tcGlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxDb21waWxhdGlvbk91dHB1dD4ge1xuXG4gICAgaWYgKCF0aGlzLl9wYXJlbnRDb21waWxhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdXZWJwYWNrUmVzb3VyY2VMb2FkZXIgY2Fubm90IGJlIHVzZWQgd2l0aG91dCBwYXJlbnRDb21waWxhdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFNpbXBsZSBzYW5pdHkgY2hlY2suXG4gICAgaWYgKGZpbGVQYXRoLm1hdGNoKC9cXC5banRdcyQvKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KCdDYW5ub3QgdXNlIGEgSmF2YVNjcmlwdCBvciBUeXBlU2NyaXB0IGZpbGUgZm9yIHN0eWxlVXJsLicpO1xuICAgIH1cblxuICAgIGNvbnN0IG91dHB1dE9wdGlvbnMgPSB7IGZpbGVuYW1lOiBmaWxlUGF0aCB9O1xuICAgIGNvbnN0IHJlbGF0aXZlUGF0aCA9IHBhdGgucmVsYXRpdmUodGhpcy5fY29udGV4dCB8fCAnJywgZmlsZVBhdGgpO1xuICAgIGNvbnN0IGNoaWxkQ29tcGlsZXIgPSB0aGlzLl9wYXJlbnRDb21waWxhdGlvbi5jcmVhdGVDaGlsZENvbXBpbGVyKHJlbGF0aXZlUGF0aCwgb3V0cHV0T3B0aW9ucyk7XG4gICAgY2hpbGRDb21waWxlci5jb250ZXh0ID0gdGhpcy5fY29udGV4dDtcblxuICAgIG5ldyBOb2RlVGVtcGxhdGVQbHVnaW4ob3V0cHV0T3B0aW9ucykuYXBwbHkoY2hpbGRDb21waWxlcik7XG4gICAgbmV3IE5vZGVUYXJnZXRQbHVnaW4oKS5hcHBseShjaGlsZENvbXBpbGVyKTtcbiAgICBuZXcgU2luZ2xlRW50cnlQbHVnaW4odGhpcy5fY29udGV4dCwgZmlsZVBhdGgpLmFwcGx5KGNoaWxkQ29tcGlsZXIpO1xuICAgIG5ldyBMb2FkZXJUYXJnZXRQbHVnaW4oJ25vZGUnKS5hcHBseShjaGlsZENvbXBpbGVyKTtcblxuICAgIGNoaWxkQ29tcGlsZXIuaG9va3MudGhpc0NvbXBpbGF0aW9uLnRhcCgnbmd0b29scy13ZWJwYWNrJywgKGNvbXBpbGF0aW9uOiBhbnkpID0+IHtcbiAgICAgIGNvbXBpbGF0aW9uLmhvb2tzLmFkZGl0aW9uYWxBc3NldHMudGFwQXN5bmMoJ25ndG9vbHMtd2VicGFjaycsXG4gICAgICAoY2FsbGJhY2s6IChlcnI/OiBFcnJvcikgPT4gdm9pZCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5fY2FjaGVkUmVzb3VyY2VzLmhhcyhjb21waWxhdGlvbi5mdWxsSGFzaCkpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgYXNzZXQgPSBjb21waWxhdGlvbi5hc3NldHNbZmlsZVBhdGhdO1xuICAgICAgICBpZiAoYXNzZXQpIHtcbiAgICAgICAgICB0aGlzLl9ldmFsdWF0ZSh7IG91dHB1dE5hbWU6IGZpbGVQYXRoLCBzb3VyY2U6IGFzc2V0LnNvdXJjZSgpIH0pXG4gICAgICAgICAgICAudGhlbihvdXRwdXQgPT4ge1xuICAgICAgICAgICAgICBjb21waWxhdGlvbi5hc3NldHNbZmlsZVBhdGhdID0gbmV3IFJhd1NvdXJjZShvdXRwdXQpO1xuICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaChlcnIgPT4gY2FsbGJhY2soZXJyKSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBDb21waWxlIGFuZCByZXR1cm4gYSBwcm9taXNlXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNoaWxkQ29tcGlsZXIuY29tcGlsZSgoZXJyOiBFcnJvciwgY2hpbGRDb21waWxhdGlvbjogYW55KSA9PiB7XG4gICAgICAgIC8vIFJlc29sdmUgLyByZWplY3QgdGhlIHByb21pc2VcbiAgICAgICAgaWYgKGNoaWxkQ29tcGlsYXRpb24gJiYgY2hpbGRDb21waWxhdGlvbi5lcnJvcnMgJiYgY2hpbGRDb21waWxhdGlvbi5lcnJvcnMubGVuZ3RoKSB7XG4gICAgICAgICAgY29uc3QgZXJyb3JEZXRhaWxzID0gY2hpbGRDb21waWxhdGlvbi5lcnJvcnMubWFwKGZ1bmN0aW9uIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICByZXR1cm4gZXJyb3IubWVzc2FnZSArIChlcnJvci5lcnJvciA/ICc6XFxuJyArIGVycm9yLmVycm9yIDogJycpO1xuICAgICAgICAgIH0pLmpvaW4oJ1xcbicpO1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ0NoaWxkIGNvbXBpbGF0aW9uIGZhaWxlZDpcXG4nICsgZXJyb3JEZXRhaWxzKSk7XG4gICAgICAgIH0gZWxzZSBpZiAoZXJyKSB7XG4gICAgICAgICAgcmVqZWN0KGVycik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgT2JqZWN0LmtleXMoY2hpbGRDb21waWxhdGlvbi5hc3NldHMpLmZvckVhY2goYXNzZXROYW1lID0+IHtcbiAgICAgICAgICAgIGlmIChhc3NldE5hbWUgIT09IGZpbGVQYXRoICYmIHRoaXMuX3BhcmVudENvbXBpbGF0aW9uLmFzc2V0c1thc3NldE5hbWVdID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLl9wYXJlbnRDb21waWxhdGlvbi5hc3NldHNbYXNzZXROYW1lXSA9IGNoaWxkQ29tcGlsYXRpb24uYXNzZXRzW2Fzc2V0TmFtZV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgICAvLyBTYXZlIHRoZSBkZXBlbmRlbmNpZXMgZm9yIHRoaXMgcmVzb3VyY2UuXG4gICAgICAgICAgdGhpcy5fcmVzb3VyY2VEZXBlbmRlbmNpZXMuc2V0KGZpbGVQYXRoLCBjaGlsZENvbXBpbGF0aW9uLmZpbGVEZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgICAgY29uc3QgY29tcGlsYXRpb25IYXNoID0gY2hpbGRDb21waWxhdGlvbi5mdWxsSGFzaDtcbiAgICAgICAgICBjb25zdCBtYXliZVNvdXJjZSA9IHRoaXMuX2NhY2hlZFJlc291cmNlcy5nZXQoY29tcGlsYXRpb25IYXNoKTtcbiAgICAgICAgICBpZiAobWF5YmVTb3VyY2UpIHtcbiAgICAgICAgICAgIHJlc29sdmUoeyBvdXRwdXROYW1lOiBmaWxlUGF0aCwgc291cmNlOiBtYXliZVNvdXJjZSB9KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3Qgc291cmNlID0gY2hpbGRDb21waWxhdGlvbi5hc3NldHNbZmlsZVBhdGhdLnNvdXJjZSgpO1xuICAgICAgICAgICAgdGhpcy5fY2FjaGVkUmVzb3VyY2VzLnNldChjb21waWxhdGlvbkhhc2gsIHNvdXJjZSk7XG4gICAgICAgICAgICByZXNvbHZlKHsgb3V0cHV0TmFtZTogZmlsZVBhdGgsIHNvdXJjZSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBfZXZhbHVhdGUoeyBvdXRwdXROYW1lLCBzb3VyY2UgfTogQ29tcGlsYXRpb25PdXRwdXQpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBFdmFsdWF0ZSBjb2RlXG4gICAgICBjb25zdCBldmFsdWF0ZWRTb3VyY2UgPSB2bS5ydW5Jbk5ld0NvbnRleHQoc291cmNlLCB1bmRlZmluZWQsIHsgZmlsZW5hbWU6IG91dHB1dE5hbWUgfSk7XG5cbiAgICAgIGlmICh0eXBlb2YgZXZhbHVhdGVkU291cmNlID09ICdzdHJpbmcnKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZXZhbHVhdGVkU291cmNlKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KCdUaGUgbG9hZGVyIFwiJyArIG91dHB1dE5hbWUgKyAnXCIgZGlkblxcJ3QgcmV0dXJuIGEgc3RyaW5nLicpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlKTtcbiAgICB9XG4gIH1cblxuICBnZXQoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbXBpbGUoZmlsZVBhdGgpXG4gICAgICAudGhlbigocmVzdWx0OiBDb21waWxhdGlvbk91dHB1dCkgPT4gcmVzdWx0LnNvdXJjZSk7XG4gIH1cbn1cbiJdfQ==