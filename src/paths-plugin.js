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
exports.TypeScriptPathsPlugin = void 0;
const path = __importStar(require("path"));
class TypeScriptPathsPlugin {
    constructor(options) {
        if (options) {
            this.update(options);
        }
    }
    /**
     * Update the plugin with new path mapping option values.
     * The options will also be preprocessed to reduce the overhead of individual resolve actions
     * during a build.
     *
     * @param options The `paths` and `baseUrl` options from TypeScript's `CompilerOptions`.
     */
    update(options) {
        var _a, _b;
        this.baseUrl = options.baseUrl;
        this.patterns = undefined;
        if (options.paths) {
            for (const [pattern, potentials] of Object.entries(options.paths)) {
                // Ignore any entries that would not result in a new mapping
                if (potentials.length === 0 || potentials.every((potential) => potential === '*')) {
                    continue;
                }
                const starIndex = pattern.indexOf('*');
                let prefix = pattern;
                let suffix;
                if (starIndex > -1) {
                    prefix = pattern.slice(0, starIndex);
                    if (starIndex < pattern.length - 1) {
                        suffix = pattern.slice(starIndex + 1);
                    }
                }
                (_a = this.patterns) !== null && _a !== void 0 ? _a : (this.patterns = []);
                this.patterns.push({
                    starIndex,
                    prefix,
                    suffix,
                    potentials: potentials.map((potential) => {
                        const potentialStarIndex = potential.indexOf('*');
                        if (potentialStarIndex === -1) {
                            return { hasStar: false, prefix: potential };
                        }
                        return {
                            hasStar: true,
                            prefix: potential.slice(0, potentialStarIndex),
                            suffix: potentialStarIndex < potential.length - 1
                                ? potential.slice(potentialStarIndex + 1)
                                : undefined,
                        };
                    }),
                });
            }
            // Sort patterns so that exact matches take priority then largest prefix match
            (_b = this.patterns) === null || _b === void 0 ? void 0 : _b.sort((a, b) => {
                if (a.starIndex === -1) {
                    return -1;
                }
                else if (b.starIndex === -1) {
                    return 1;
                }
                else {
                    return b.starIndex - a.starIndex;
                }
            });
        }
    }
    apply(resolver) {
        const target = resolver.ensureHook('resolve');
        // To support synchronous resolvers this hook cannot be promise based.
        // Webpack supports synchronous resolution with `tap` and `tapAsync` hooks.
        resolver.getHook('described-resolve').tapAsync('TypeScriptPathsPlugin', 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request, resolveContext, callback) => {
            // Preprocessing of the options will ensure that `patterns` is either undefined or has elements to check
            if (!this.patterns) {
                callback();
                return;
            }
            if (!request || request.typescriptPathMapped) {
                callback();
                return;
            }
            const originalRequest = request.request || request.path;
            if (!originalRequest) {
                callback();
                return;
            }
            // Only work on Javascript/TypeScript issuers.
            if (!request.context.issuer || !request.context.issuer.match(/\.[cm]?[jt]sx?$/)) {
                callback();
                return;
            }
            switch (originalRequest[0]) {
                case '.':
                case '/':
                    // Relative or absolute requests are not mapped
                    callback();
                    return;
                case '!':
                    // Ignore all webpack special requests
                    if (originalRequest.length > 1 && originalRequest[1] === '!') {
                        callback();
                        return;
                    }
                    break;
            }
            // A generator is used to limit the amount of replacements that need to be created.
            // For example, if the first one resolves, any others are not needed and do not need
            // to be created.
            const replacements = findReplacements(originalRequest, this.patterns);
            const tryResolve = () => {
                var _a;
                const next = replacements.next();
                if (next.done) {
                    callback();
                    return;
                }
                const potentialRequest = {
                    ...request,
                    request: path.resolve((_a = this.baseUrl) !== null && _a !== void 0 ? _a : '', next.value),
                    typescriptPathMapped: true,
                };
                resolver.doResolve(target, potentialRequest, '', resolveContext, 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (error, result) => {
                    if (error) {
                        callback(error);
                    }
                    else if (result) {
                        callback(undefined, result);
                    }
                    else {
                        tryResolve();
                    }
                });
            };
            tryResolve();
        });
    }
}
exports.TypeScriptPathsPlugin = TypeScriptPathsPlugin;
function* findReplacements(originalRequest, patterns) {
    // check if any path mapping rules are relevant
    for (const { starIndex, prefix, suffix, potentials } of patterns) {
        let partial;
        if (starIndex === -1) {
            // No star means an exact match is required
            if (prefix === originalRequest) {
                partial = '';
            }
        }
        else if (starIndex === 0 && !suffix) {
            // Everything matches a single wildcard pattern ("*")
            partial = originalRequest;
        }
        else if (!suffix) {
            // No suffix means the star is at the end of the pattern
            if (originalRequest.startsWith(prefix)) {
                partial = originalRequest.slice(prefix.length);
            }
        }
        else {
            // Star was in the middle of the pattern
            if (originalRequest.startsWith(prefix) && originalRequest.endsWith(suffix)) {
                partial = originalRequest.substring(prefix.length, originalRequest.length - suffix.length);
            }
        }
        // If request was not matched, move on to the next pattern
        if (partial === undefined) {
            continue;
        }
        // Create the full replacement values based on the original request and the potentials
        // for the successfully matched pattern.
        for (const { hasStar, prefix, suffix } of potentials) {
            let replacement = prefix;
            if (hasStar) {
                replacement += partial;
                if (suffix) {
                    replacement += suffix;
                }
            }
            yield replacement;
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMtcGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9wYXRocy1wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILDJDQUE2QjtBQWlCN0IsTUFBYSxxQkFBcUI7SUFJaEMsWUFBWSxPQUFzQztRQUNoRCxJQUFJLE9BQU8sRUFBRTtZQUNYLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDdEI7SUFDSCxDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0gsTUFBTSxDQUFDLE9BQXFDOztRQUMxQyxJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUM7UUFDL0IsSUFBSSxDQUFDLFFBQVEsR0FBRyxTQUFTLENBQUM7UUFFMUIsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFO1lBQ2pCLEtBQUssTUFBTSxDQUFDLE9BQU8sRUFBRSxVQUFVLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRTtnQkFDakUsNERBQTREO2dCQUM1RCxJQUFJLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLFNBQVMsS0FBSyxHQUFHLENBQUMsRUFBRTtvQkFDakYsU0FBUztpQkFDVjtnQkFFRCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUN2QyxJQUFJLE1BQU0sR0FBRyxPQUFPLENBQUM7Z0JBQ3JCLElBQUksTUFBTSxDQUFDO2dCQUNYLElBQUksU0FBUyxHQUFHLENBQUMsQ0FBQyxFQUFFO29CQUNsQixNQUFNLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsU0FB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QUNGO1FBRUQsMERBQTBEO1FBQzFELElBQUksT0FBTyxLQUFLLFNBQVMsRUFBRTtZQUN6QixTQUFTO1NBQ1Y7UUFFRCxzRkFBc0Y7UUFDdEYsd0NBQXdDO1FBQ3hDLEtBQUssTUFBTSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksVUFBVSxFQUFFO1lBQ3BELElBQUksV0FBVyxHQUFHLE1BQU0sQ0FBQztZQUV6QixJQUFJLE9BQU8sRUFBRTtnQkFDWCxXQUFXLElBQUksT0FBTyxDQUFDO2dCQUN2QixJQUFJLE1BQU0sRUFBRTtvQkFDVixXQUFXLElBQUksTUFBTSxDQUFDO2lCQUN2QjthQUNGO1lBRUQsTUFBTSxXQUFXLENBQUM7U0FDbkI7S0FDRjtBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IENvbXBpbGVyT3B0aW9ucyB9IGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHR5cGUgeyBDb25maWd1cmF0aW9uIH0gZnJvbSAnd2VicGFjayc7XG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZW1wdHktaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFR5cGVTY3JpcHRQYXRoc1BsdWdpbk9wdGlvbnMgZXh0ZW5kcyBQaWNrPENvbXBpbGVyT3B0aW9ucywgJ3BhdGhzJyB8ICdiYXNlVXJsJz4ge31cblxuLy8gRXh0cmFjdCBSZXNvbHZlciB0eXBlIGZyb20gV2VicGFjayB0eXBlcyBzaW5jZSBpdCBpcyBub3QgZGlyZWN0bHkgZXhwb3J0ZWRcbnR5cGUgUmVzb2x2ZXIgPSBFeGNsdWRlPEV4Y2x1ZGU8Q29uZmlndXJhdGlvblsncmVzb2x2ZSddLCB1bmRlZmluZWQ+WydyZXNvbHZlciddLCB1bmRlZmluZWQ+O1xuXG5pbnRlcmZhY2UgUGF0aFBhdHRlcm4ge1xuICBzdGFySW5kZXg6IG51bWJlcjtcbiAgcHJlZml4OiBzdHJpbmc7XG4gIHN1ZmZpeD86IHN0cmluZztcbiAgcG90ZW50aWFsczogeyBoYXNTdGFyOiBib29sZWFuOyBwcmVmaXg6IHN0cmluZzsgc3VmZml4Pzogc3RyaW5nIH1bXTtcbn1cblxuZXhwb3J0IGNsYXNzIFR5cGVTY3JpcHRQYXRoc1BsdWdpbiB7XG4gIHByaXZhdGUgYmFzZVVybD86IHN0cmluZztcbiAgcHJpdmF0ZSBwYXR0ZXJucz86IFBhdGhQYXR0ZXJuW107XG5cbiAgY29uc3RydWN0b3Iob3B0aW9ucz86IFR5cGVTY3JpcHRQYXRoc1BsdWdpbk9wdGlvbnMpIHtcbiAgICBpZiAob3B0aW9ucykge1xuICAgICAgdGhpcy51cGRhdGUob3B0aW9ucyk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSB0aGUgcGx1Z2luIHdpdGggbmV3IHBhdGggbWFwcGluZyBvcHRpb24gdmFsdWVzLlxuICAgKiBUaGUgb3B0aW9ucyB3aWxsIGFsc28gYmUgcHJlcHJvY2Vzc2VkIHRvIHJlZHVjZSB0aGUgb3ZlcmhlYWQgb2YgaW5kaXZpZHVhbCByZXNvbHZlIGFjdGlvbnNcbiAgICogZHVyaW5nIGEgYnVpbGQuXG4gICAqXG4gICAqIEBwYXJhbSBvcHRpb25zIFRoZSBgcGF0aHNgIGFuZCBgYmFzZVVybGAgb3B0aW9ucyBmcm9tIFR5cGVTY3JpcHQncyBgQ29tcGlsZXJPcHRpb25zYC5cbiAgICovXG4gIHVwZGF0ZShvcHRpb25zOiBUeXBlU2NyaXB0UGF0aHNQbHVnaW5PcHRpb25zKTogdm9pZCB7XG4gICAgdGhpcy5iYXNlVXJsID0gb3B0aW9ucy5iYXNlVXJsO1xuICAgIHRoaXMucGF0dGVybnMgPSB1bmRlZmluZWQ7XG5cbiAgICBpZiAob3B0aW9ucy5wYXRocykge1xuICAgICAgZm9yIChjb25zdCBbcGF0dGVybiwgcG90ZW50aWFsc10gb2YgT2JqZWN0LmVudHJpZXMob3B0aW9ucy5wYXRocykpIHtcbiAgICAgICAgLy8gSWdub3JlIGFueSBlbnRyaWVzIHRoYXQgd291bGQgbm90IHJlc3VsdCBpbiBhIG5ldyBtYXBwaW5nXG4gICAgICAgIGlmIChwb3RlbnRpYWxzLmxlbmd0aCA9PT0gMCB8fCBwb3RlbnRpYWxzLmV2ZXJ5KChwb3RlbnRpYWwpID0+IHBvdGVudGlhbCA9PT0gJyonKSkge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgc3RhckluZGV4ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gICAgICAgIGxldCBwcmVmaXggPSBwYXR0ZXJuO1xuICAgICAgICBsZXQgc3VmZml4O1xuICAgICAgICBpZiAoc3RhckluZGV4ID4gLTEpIHtcbiAgICAgICAgICBwcmVmaXggPSBwYXR0ZXJuLnNsaWNlKDAsIHN0YXJJbmRleCk7XG4gICAgICAgICAgaWYgKHN0YXJJbmRleCA8IHBhdHRlcm4ubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgc3VmZml4ID0gcGF0dGVybi5zbGljZShzdGFySW5kZXggKyAxKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnBhdHRlcm5zID8/PSBbXTtcbiAgICAgICAgdGhpcy5wYXR0ZXJucy5wdXNoKHtcbiAgICAgICAgICBzdGFySW5kZXgsXG4gICAgICAgICAgcHJlZml4LFxuICAgICAgICAgIHN1ZmZpeCxcbiAgICAgICAgICBwb3RlbnRpYWxzOiBwb3RlbnRpYWxzLm1hcCgocG90ZW50aWFsKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBwb3RlbnRpYWxTdGFySW5kZXggPSBwb3RlbnRpYWwuaW5kZXhPZignKicpO1xuICAgICAgICAgICAgaWYgKHBvdGVudGlhbFN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHsgaGFzU3RhcjogZmFsc2UsIHByZWZpeDogcG90ZW50aWFsIH07XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgIGhhc1N0YXI6IHRydWUsXG4gICAgICAgICAgICAgIHByZWZpeDogcG90ZW50aWFsLnNsaWNlKDAsIHBvdGVudGlhbFN0YXJJbmRleCksXG4gICAgICAgICAgICAgIHN1ZmZpeDpcbiAgICAgICAgICAgICAgICBwb3RlbnRpYWxTdGFySW5kZXggPCBwb3RlbnRpYWwubGVuZ3RoIC0gMVxuICAgICAgICAgICAgICAgICAgPyBwb3RlbnRpYWwuc2xpY2UocG90ZW50aWFsU3RhckluZGV4ICsgMSlcbiAgICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNvcnQgcGF0dGVybnMgc28gdGhhdCBleGFjdCBtYXRjaGVzIHRha2UgcHJpb3JpdHkgdGhlbiBsYXJnZXN0IHByZWZpeCBtYXRjaFxuICAgICAgdGhpcy5wYXR0ZXJucz8uc29ydCgoYSwgYikgPT4ge1xuICAgICAgICBpZiAoYS5zdGFySW5kZXggPT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgICB9IGVsc2UgaWYgKGIuc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgICAgIHJldHVybiAxO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBiLnN0YXJJbmRleCAtIGEuc3RhckluZGV4O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBhcHBseShyZXNvbHZlcjogUmVzb2x2ZXIpOiB2b2lkIHtcbiAgICBjb25zdCB0YXJnZXQgPSByZXNvbHZlci5lbnN1cmVIb29rKCdyZXNvbHZlJyk7XG5cbiAgICAvLyBUbyBzdXBwb3J0IHN5bmNocm9ub3VzIHJlc29sdmVycyB0aGlzIGhvb2sgY2Fubm90IGJlIHByb21pc2UgYmFzZWQuXG4gICAgLy8gV2VicGFjayBzdXBwb3J0cyBzeW5jaHJvbm91cyByZXNvbHV0aW9uIHdpdGggYHRhcGAgYW5kIGB0YXBBc3luY2AgaG9va3MuXG4gICAgcmVzb2x2ZXIuZ2V0SG9vaygnZGVzY3JpYmVkLXJlc29sdmUnKS50YXBBc3luYyhcbiAgICAgICdUeXBlU2NyaXB0UGF0aHNQbHVnaW4nLFxuICAgICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1leHBsaWNpdC1hbnlcbiAgICAgIChyZXF1ZXN0OiBhbnksIHJlc29sdmVDb250ZXh0LCBjYWxsYmFjaykgPT4ge1xuICAgICAgICAvLyBQcmVwcm9jZXNzaW5nIG9mIHRoZSBvcHRpb25zIHdpbGwgZW5zdXJlIHRoYXQgYHBhdHRlcm5zYCBpcyBlaXRoZXIgdW5kZWZpbmVkIG9yIGhhcyBlbGVtZW50cyB0byBjaGVja1xuICAgICAgICBpZiAoIXRoaXMucGF0dGVybnMpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCFyZXF1ZXN0IHx8IHJlcXVlc3QudHlwZXNjcmlwdFBhdGhNYXBwZWQpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qgb3JpZ2luYWxSZXF1ZXN0ID0gcmVxdWVzdC5yZXF1ZXN0IHx8IHJlcXVlc3QucGF0aDtcbiAgICAgICAgaWYgKCFvcmlnaW5hbFJlcXVlc3QpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gT25seSB3b3JrIG9uIEphdmFzY3JpcHQvVHlwZVNjcmlwdCBpc3N1ZXJzLlxuICAgICAgICBpZiAoIXJlcXVlc3QuY29udGV4dC5pc3N1ZXIgfHwgIXJlcXVlc3QuY29udGV4dC5pc3N1ZXIubWF0Y2goL1xcLltjbV0/W2p0XXN4PyQvKSkge1xuICAgICAgICAgIGNhbGxiYWNrKCk7XG5cbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzd2l0Y2ggKG9yaWdpbmFsUmVxdWVzdFswXSkge1xuICAgICAgICAgIGNhc2UgJy4nOlxuICAgICAgICAgIGNhc2UgJy8nOlxuICAgICAgICAgICAgLy8gUmVsYXRpdmUgb3IgYWJzb2x1dGUgcmVxdWVzdHMgYXJlIG5vdCBtYXBwZWRcbiAgICAgICAgICAgIGNhbGxiYWNrKCk7XG5cbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICBjYXNlICchJzpcbiAgICAgICAgICAgIC8vIElnbm9yZSBhbGwgd2VicGFjayBzcGVjaWFsIHJlcXVlc3RzXG4gICAgICAgICAgICBpZiAob3JpZ2luYWxSZXF1ZXN0Lmxlbmd0aCA+IDEgJiYgb3JpZ2luYWxSZXF1ZXN0WzFdID09PSAnIScpIHtcbiAgICAgICAgICAgICAgY2FsbGJhY2soKTtcblxuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEEgZ2VuZXJhdG9yIGlzIHVzZWQgdG8gbGltaXQgdGhlIGFtb3VudCBvZiByZXBsYWNlbWVudHMgdGhhdCBuZWVkIHRvIGJlIGNyZWF0ZWQuXG4gICAgICAgIC8vIEZvciBleGFtcGxlLCBpZiB0aGUgZmlyc3Qgb25lIHJlc29sdmVzLCBhbnkgb3RoZXJzIGFyZSBub3QgbmVlZGVkIGFuZCBkbyBub3QgbmVlZFxuICAgICAgICAvLyB0byBiZSBjcmVhdGVkLlxuICAgICAgICBjb25zdCByZXBsYWNlbWVudHMgPSBmaW5kUmVwbGFjZW1lbnRzKG9yaWdpbmFsUmVxdWVzdCwgdGhpcy5wYXR0ZXJucyk7XG5cbiAgICAgICAgY29uc3QgdHJ5UmVzb2x2ZSA9ICgpID0+IHtcbiAgICAgICAgICBjb25zdCBuZXh0ID0gcmVwbGFjZW1lbnRzLm5leHQoKTtcbiAgICAgICAgICBpZiAobmV4dC5kb25lKSB7XG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgcG90ZW50aWFsUmVxdWVzdCA9IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QsXG4gICAgICAgICAgICByZXF1ZXN0OiBwYXRoLnJlc29sdmUodGhpcy5iYXNlVXJsID8/ICcnLCBuZXh0LnZhbHVlKSxcbiAgICAgICAgICAgIHR5cGVzY3JpcHRQYXRoTWFwcGVkOiB0cnVlLFxuICAgICAgICAgIH07XG5cbiAgICAgICAgICByZXNvbHZlci5kb1Jlc29sdmUoXG4gICAgICAgICAgICB0YXJnZXQsXG4gICAgICAgICAgICBwb3RlbnRpYWxSZXF1ZXN0LFxuICAgICAgICAgICAgJycsXG4gICAgICAgICAgICByZXNvbHZlQ29udGV4dCxcbiAgICAgICAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICAgICAgICAoZXJyb3I6IEVycm9yIHwgbnVsbCwgcmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgaWYgKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyb3IpO1xuICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3VsdCkge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKHVuZGVmaW5lZCwgcmVzdWx0KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0cnlSZXNvbHZlKCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgKTtcbiAgICAgICAgfTtcblxuICAgICAgICB0cnlSZXNvbHZlKCk7XG4gICAgICB9LFxuICAgICk7XG4gIH1cbn1cblxuZnVuY3Rpb24qIGZpbmRSZXBsYWNlbWVudHMoXG4gIG9yaWdpbmFsUmVxdWVzdDogc3RyaW5nLFxuICBwYXR0ZXJuczogUGF0aFBhdHRlcm5bXSxcbik6IEl0ZXJhYmxlSXRlcmF0b3I8c3RyaW5nPiB7XG4gIC8vIGNoZWNrIGlmIGFueSBwYXRoIG1hcHBpbmcgcnVsZXMgYXJlIHJlbGV2YW50XG4gIGZvciAoY29uc3QgeyBzdGFySW5kZXgsIHByZWZpeCwgc3VmZml4LCBwb3RlbnRpYWxzIH0gb2YgcGF0dGVybnMpIHtcbiAgICBsZXQgcGFydGlhbDtcblxuICAgIGlmIChzdGFySW5kZXggPT09IC0xKSB7XG4gICAgICAvLyBObyBzdGFyIG1lYW5zIGFuIGV4YWN0IG1hdGNoIGlzIHJlcXVpcmVkXG4gICAgICBpZiAocHJlZml4ID09PSBvcmlnaW5hbFJlcXVlc3QpIHtcbiAgICAgICAgcGFydGlhbCA9ICcnO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoc3RhckluZGV4ID09PSAwICYmICFzdWZmaXgpIHtcbiAgICAgIC8vIEV2ZXJ5dGhpbmcgbWF0Y2hlcyBhIHNpbmdsZSB3aWxkY2FyZCBwYXR0ZXJuIChcIipcIilcbiAgICAgIHBhcnRpYWwgPSBvcmlnaW5hbFJlcXVlc3Q7XG4gICAgfSBlbHNlIGlmICghc3VmZml4KSB7XG4gICAgICAvLyBObyBzdWZmaXggbWVhbnMgdGhlIHN0YXIgaXMgYXQgdGhlIGVuZCBvZiB0aGUgcGF0dGVyblxuICAgICAgaWYgKG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKHByZWZpeCkpIHtcbiAgICAgICAgcGFydGlhbCA9IG9yaWdpbmFsUmVxdWVzdC5zbGljZShwcmVmaXgubGVuZ3RoKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU3RhciB3YXMgaW4gdGhlIG1pZGRsZSBvZiB0aGUgcGF0dGVyblxuICAgICAgaWYgKG9yaWdpbmFsUmVxdWVzdC5zdGFydHNXaXRoKHByZWZpeCkgJiYgb3JpZ2luYWxSZXF1ZXN0LmVuZHNXaXRoKHN1ZmZpeCkpIHtcbiAgICAgICAgcGFydGlhbCA9IG9yaWdpbmFsUmVxdWVzdC5zdWJzdHJpbmcocHJlZml4Lmxlbmd0aCwgb3JpZ2luYWxSZXF1ZXN0Lmxlbmd0aCAtIHN1ZmZpeC5sZW5ndGgpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHJlcXVlc3Qgd2FzIG5vdCBtYXRjaGVkLCBtb3ZlIG9uIHRvIHRoZSBuZXh0IHBhdHRlcm5cbiAgICBpZiAocGFydGlhbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgdGhlIGZ1bGwgcmVwbGFjZW1lbnQgdmFsdWVzIGJhc2VkIG9uIHRoZSBvcmlnaW5hbCByZXF1ZXN0IGFuZCB0aGUgcG90ZW50aWFsc1xuICAgIC8vIGZvciB0aGUgc3VjY2Vzc2Z1bGx5IG1hdGNoZWQgcGF0dGVybi5cbiAgICBmb3IgKGNvbnN0IHsgaGFzU3RhciwgcHJlZml4LCBzdWZmaXggfSBvZiBwb3RlbnRpYWxzKSB7XG4gICAgICBsZXQgcmVwbGFjZW1lbnQgPSBwcmVmaXg7XG5cbiAgICAgIGlmIChoYXNTdGFyKSB7XG4gICAgICAgIHJlcGxhY2VtZW50ICs9IHBhcnRpYWw7XG4gICAgICAgIGlmIChzdWZmaXgpIHtcbiAgICAgICAgICByZXBsYWNlbWVudCArPSBzdWZmaXg7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgeWllbGQgcmVwbGFjZW1lbnQ7XG4gICAgfVxuICB9XG59XG4iXX0=