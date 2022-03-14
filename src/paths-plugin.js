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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGF0aHMtcGx1Z2luLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy9wYXRocy1wbHVnaW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwyQ0FBNkI7QUFpQjdCLE1BQWEscUJBQXFCO0lBSWhDLFlBQVksT0FBc0M7UUFDaEQsSUFBSSxPQUFPLEVBQUU7WUFDWCxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1NBQ3RCO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE1BQU0sQ0FBQyxPQUFxQzs7UUFDMUMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDO1FBQy9CLElBQUksQ0FBQyxRQUFRLEdBQUcsU0FBUyxDQUFDO1FBRTFCLElBQUksT0FBTyxDQUFDLEtBQUssRUFBRTtZQUNqQixLQUFLLE1BQU0sQ0FBQyxPQUFPLEVBQUUsVUFBVSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUU7Z0JBQ2pFLDREQUE0RDtnQkFDNUQsSUFBSSxVQUFVLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxTQUFTLEtBQUssR0FBRyxDQUFDLEVBQUU7b0JBQ2pGLFNBQVM7aUJBQ1Y7Z0JBRUQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDdkMsSUFBSSxNQUFNLEdBQUcsT0FBTyxDQUFDO2dCQUNyQixJQUFJLE1BQU0sQ0FBQztnQkFDWCxJQUFJLFNBQVMsR0FBRyxDQUFDLENBQUMsRUFBRTtvQkFDbEIsTUFBTSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFF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NUY7U0FDRjtRQUVELDBEQUEwRDtRQUMxRCxJQUFJLE9BQU8sS0FBSyxTQUFTLEVBQUU7WUFDekIsU0FBUztTQUNWO1FBRUQsc0ZBQXNGO1FBQ3RGLHdDQUF3QztRQUN4QyxLQUFLLE1BQU0sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJLFVBQVUsRUFBRTtZQUNwRCxJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUM7WUFFekIsSUFBSSxPQUFPLEVBQUU7Z0JBQ1gsV0FBVyxJQUFJLE9BQU8sQ0FBQztnQkFDdkIsSUFBSSxNQUFNLEVBQUU7b0JBQ1YsV0FBVyxJQUFJLE1BQU0sQ0FBQztpQkFDdkI7YUFDRjtZQUVELE1BQU0sV0FBVyxDQUFDO1NBQ25CO0tBQ0Y7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBDb21waWxlck9wdGlvbnMgfSBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB0eXBlIHsgQ29uZmlndXJhdGlvbiB9IGZyb20gJ3dlYnBhY2snO1xuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWVtcHR5LWludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBUeXBlU2NyaXB0UGF0aHNQbHVnaW5PcHRpb25zIGV4dGVuZHMgUGljazxDb21waWxlck9wdGlvbnMsICdwYXRocycgfCAnYmFzZVVybCc+IHt9XG5cbi8vIEV4dHJhY3QgUmVzb2x2ZXIgdHlwZSBmcm9tIFdlYnBhY2sgdHlwZXMgc2luY2UgaXQgaXMgbm90IGRpcmVjdGx5IGV4cG9ydGVkXG50eXBlIFJlc29sdmVyID0gRXhjbHVkZTxFeGNsdWRlPENvbmZpZ3VyYXRpb25bJ3Jlc29sdmUnXSwgdW5kZWZpbmVkPlsncmVzb2x2ZXInXSwgdW5kZWZpbmVkPjtcblxuaW50ZXJmYWNlIFBhdGhQYXR0ZXJuIHtcbiAgc3RhckluZGV4OiBudW1iZXI7XG4gIHByZWZpeDogc3RyaW5nO1xuICBzdWZmaXg/OiBzdHJpbmc7XG4gIHBvdGVudGlhbHM6IHsgaGFzU3RhcjogYm9vbGVhbjsgcHJlZml4OiBzdHJpbmc7IHN1ZmZpeD86IHN0cmluZyB9W107XG59XG5cbmV4cG9ydCBjbGFzcyBUeXBlU2NyaXB0UGF0aHNQbHVnaW4ge1xuICBwcml2YXRlIGJhc2VVcmw/OiBzdHJpbmc7XG4gIHByaXZhdGUgcGF0dGVybnM/OiBQYXRoUGF0dGVybltdO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM/OiBUeXBlU2NyaXB0UGF0aHNQbHVnaW5PcHRpb25zKSB7XG4gICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgIHRoaXMudXBkYXRlKG9wdGlvbnMpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgdGhlIHBsdWdpbiB3aXRoIG5ldyBwYXRoIG1hcHBpbmcgb3B0aW9uIHZhbHVlcy5cbiAgICogVGhlIG9wdGlvbnMgd2lsbCBhbHNvIGJlIHByZXByb2Nlc3NlZCB0byByZWR1Y2UgdGhlIG92ZXJoZWFkIG9mIGluZGl2aWR1YWwgcmVzb2x2ZSBhY3Rpb25zXG4gICAqIGR1cmluZyBhIGJ1aWxkLlxuICAgKlxuICAgKiBAcGFyYW0gb3B0aW9ucyBUaGUgYHBhdGhzYCBhbmQgYGJhc2VVcmxgIG9wdGlvbnMgZnJvbSBUeXBlU2NyaXB0J3MgYENvbXBpbGVyT3B0aW9uc2AuXG4gICAqL1xuICB1cGRhdGUob3B0aW9uczogVHlwZVNjcmlwdFBhdGhzUGx1Z2luT3B0aW9ucyk6IHZvaWQge1xuICAgIHRoaXMuYmFzZVVybCA9IG9wdGlvbnMuYmFzZVVybDtcbiAgICB0aGlzLnBhdHRlcm5zID0gdW5kZWZpbmVkO1xuXG4gICAgaWYgKG9wdGlvbnMucGF0aHMpIHtcbiAgICAgIGZvciAoY29uc3QgW3BhdHRlcm4sIHBvdGVudGlhbHNdIG9mIE9iamVjdC5lbnRyaWVzKG9wdGlvbnMucGF0aHMpKSB7XG4gICAgICAgIC8vIElnbm9yZSBhbnkgZW50cmllcyB0aGF0IHdvdWxkIG5vdCByZXN1bHQgaW4gYSBuZXcgbWFwcGluZ1xuICAgICAgICBpZiAocG90ZW50aWFscy5sZW5ndGggPT09IDAgfHwgcG90ZW50aWFscy5ldmVyeSgocG90ZW50aWFsKSA9PiBwb3RlbnRpYWwgPT09ICcqJykpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHN0YXJJbmRleCA9IHBhdHRlcm4uaW5kZXhPZignKicpO1xuICAgICAgICBsZXQgcHJlZml4ID0gcGF0dGVybjtcbiAgICAgICAgbGV0IHN1ZmZpeDtcbiAgICAgICAgaWYgKHN0YXJJbmRleCA+IC0xKSB7XG4gICAgICAgICAgcHJlZml4ID0gcGF0dGVybi5zbGljZSgwLCBzdGFySW5kZXgpO1xuICAgICAgICAgIGlmIChzdGFySW5kZXggPCBwYXR0ZXJuLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgICAgIHN1ZmZpeCA9IHBhdHRlcm4uc2xpY2Uoc3RhckluZGV4ICsgMSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5wYXR0ZXJucyA/Pz0gW107XG4gICAgICAgIHRoaXMucGF0dGVybnMucHVzaCh7XG4gICAgICAgICAgc3RhckluZGV4LFxuICAgICAgICAgIHByZWZpeCxcbiAgICAgICAgICBzdWZmaXgsXG4gICAgICAgICAgcG90ZW50aWFsczogcG90ZW50aWFscy5tYXAoKHBvdGVudGlhbCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgcG90ZW50aWFsU3RhckluZGV4ID0gcG90ZW50aWFsLmluZGV4T2YoJyonKTtcbiAgICAgICAgICAgIGlmIChwb3RlbnRpYWxTdGFySW5kZXggPT09IC0xKSB7XG4gICAgICAgICAgICAgIHJldHVybiB7IGhhc1N0YXI6IGZhbHNlLCBwcmVmaXg6IHBvdGVudGlhbCB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBoYXNTdGFyOiB0cnVlLFxuICAgICAgICAgICAgICBwcmVmaXg6IHBvdGVudGlhbC5zbGljZSgwLCBwb3RlbnRpYWxTdGFySW5kZXgpLFxuICAgICAgICAgICAgICBzdWZmaXg6XG4gICAgICAgICAgICAgICAgcG90ZW50aWFsU3RhckluZGV4IDwgcG90ZW50aWFsLmxlbmd0aCAtIDFcbiAgICAgICAgICAgICAgICAgID8gcG90ZW50aWFsLnNsaWNlKHBvdGVudGlhbFN0YXJJbmRleCArIDEpXG4gICAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSksXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBTb3J0IHBhdHRlcm5zIHNvIHRoYXQgZXhhY3QgbWF0Y2hlcyB0YWtlIHByaW9yaXR5IHRoZW4gbGFyZ2VzdCBwcmVmaXggbWF0Y2hcbiAgICAgIHRoaXMucGF0dGVybnM/LnNvcnQoKGEsIGIpID0+IHtcbiAgICAgICAgaWYgKGEuc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgICAgIHJldHVybiAtMTtcbiAgICAgICAgfSBlbHNlIGlmIChiLnN0YXJJbmRleCA9PT0gLTEpIHtcbiAgICAgICAgICByZXR1cm4gMTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gYi5zdGFySW5kZXggLSBhLnN0YXJJbmRleDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgYXBwbHkocmVzb2x2ZXI6IFJlc29sdmVyKTogdm9pZCB7XG4gICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZXIuZW5zdXJlSG9vaygncmVzb2x2ZScpO1xuXG4gICAgLy8gVG8gc3VwcG9ydCBzeW5jaHJvbm91cyByZXNvbHZlcnMgdGhpcyBob29rIGNhbm5vdCBiZSBwcm9taXNlIGJhc2VkLlxuICAgIC8vIFdlYnBhY2sgc3VwcG9ydHMgc3luY2hyb25vdXMgcmVzb2x1dGlvbiB3aXRoIGB0YXBgIGFuZCBgdGFwQXN5bmNgIGhvb2tzLlxuICAgIHJlc29sdmVyLmdldEhvb2soJ2Rlc2NyaWJlZC1yZXNvbHZlJykudGFwQXN5bmMoXG4gICAgICAnVHlwZVNjcmlwdFBhdGhzUGx1Z2luJyxcbiAgICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICAocmVxdWVzdDogYW55LCByZXNvbHZlQ29udGV4dCwgY2FsbGJhY2spID0+IHtcbiAgICAgICAgLy8gUHJlcHJvY2Vzc2luZyBvZiB0aGUgb3B0aW9ucyB3aWxsIGVuc3VyZSB0aGF0IGBwYXR0ZXJuc2AgaXMgZWl0aGVyIHVuZGVmaW5lZCBvciBoYXMgZWxlbWVudHMgdG8gY2hlY2tcbiAgICAgICAgaWYgKCF0aGlzLnBhdHRlcm5zKSB7XG4gICAgICAgICAgY2FsbGJhY2soKTtcblxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghcmVxdWVzdCB8fCByZXF1ZXN0LnR5cGVzY3JpcHRQYXRoTWFwcGVkKSB7XG4gICAgICAgICAgY2FsbGJhY2soKTtcblxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG9yaWdpbmFsUmVxdWVzdCA9IHJlcXVlc3QucmVxdWVzdCB8fCByZXF1ZXN0LnBhdGg7XG4gICAgICAgIGlmICghb3JpZ2luYWxSZXF1ZXN0KSB7XG4gICAgICAgICAgY2FsbGJhY2soKTtcblxuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE9ubHkgd29yayBvbiBKYXZhc2NyaXB0L1R5cGVTY3JpcHQgaXNzdWVycy5cbiAgICAgICAgaWYgKCFyZXF1ZXN0LmNvbnRleHQuaXNzdWVyIHx8ICFyZXF1ZXN0LmNvbnRleHQuaXNzdWVyLm1hdGNoKC9cXC5bY21dP1tqdF1zeD8kLykpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc3dpdGNoIChvcmlnaW5hbFJlcXVlc3RbMF0pIHtcbiAgICAgICAgICBjYXNlICcuJzpcbiAgICAgICAgICBjYXNlICcvJzpcbiAgICAgICAgICAgIC8vIFJlbGF0aXZlIG9yIGFic29sdXRlIHJlcXVlc3RzIGFyZSBub3QgbWFwcGVkXG4gICAgICAgICAgICBjYWxsYmFjaygpO1xuXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgY2FzZSAnISc6XG4gICAgICAgICAgICAvLyBJZ25vcmUgYWxsIHdlYnBhY2sgc3BlY2lhbCByZXF1ZXN0c1xuICAgICAgICAgICAgaWYgKG9yaWdpbmFsUmVxdWVzdC5sZW5ndGggPiAxICYmIG9yaWdpbmFsUmVxdWVzdFsxXSA9PT0gJyEnKSB7XG4gICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG5cbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBIGdlbmVyYXRvciBpcyB1c2VkIHRvIGxpbWl0IHRoZSBhbW91bnQgb2YgcmVwbGFjZW1lbnRzIHRoYXQgbmVlZCB0byBiZSBjcmVhdGVkLlxuICAgICAgICAvLyBGb3IgZXhhbXBsZSwgaWYgdGhlIGZpcnN0IG9uZSByZXNvbHZlcywgYW55IG90aGVycyBhcmUgbm90IG5lZWRlZCBhbmQgZG8gbm90IG5lZWRcbiAgICAgICAgLy8gdG8gYmUgY3JlYXRlZC5cbiAgICAgICAgY29uc3QgcmVwbGFjZW1lbnRzID0gZmluZFJlcGxhY2VtZW50cyhvcmlnaW5hbFJlcXVlc3QsIHRoaXMucGF0dGVybnMpO1xuXG4gICAgICAgIGNvbnN0IHRyeVJlc29sdmUgPSAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgbmV4dCA9IHJlcGxhY2VtZW50cy5uZXh0KCk7XG4gICAgICAgICAgaWYgKG5leHQuZG9uZSkge1xuICAgICAgICAgICAgY2FsbGJhY2soKTtcblxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHBvdGVudGlhbFJlcXVlc3QgPSB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LFxuICAgICAgICAgICAgcmVxdWVzdDogcGF0aC5yZXNvbHZlKHRoaXMuYmFzZVVybCA/PyAnJywgbmV4dC52YWx1ZSksXG4gICAgICAgICAgICB0eXBlc2NyaXB0UGF0aE1hcHBlZDogdHJ1ZSxcbiAgICAgICAgICB9O1xuXG4gICAgICAgICAgcmVzb2x2ZXIuZG9SZXNvbHZlKFxuICAgICAgICAgICAgdGFyZ2V0LFxuICAgICAgICAgICAgcG90ZW50aWFsUmVxdWVzdCxcbiAgICAgICAgICAgICcnLFxuICAgICAgICAgICAgcmVzb2x2ZUNvbnRleHQsXG4gICAgICAgICAgICAvLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuICAgICAgICAgICAgKGVycm9yOiBFcnJvciB8IG51bGwsIHJlc3VsdDogYW55KSA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycm9yKTtcbiAgICAgICAgICAgICAgfSBlbHNlIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayh1bmRlZmluZWQsIHJlc3VsdCk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgdHJ5UmVzb2x2ZSgpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICk7XG4gICAgICAgIH07XG5cbiAgICAgICAgdHJ5UmVzb2x2ZSgpO1xuICAgICAgfSxcbiAgICApO1xuICB9XG59XG5cbmZ1bmN0aW9uKiBmaW5kUmVwbGFjZW1lbnRzKFxuICBvcmlnaW5hbFJlcXVlc3Q6IHN0cmluZyxcbiAgcGF0dGVybnM6IFBhdGhQYXR0ZXJuW10sXG4pOiBJdGVyYWJsZUl0ZXJhdG9yPHN0cmluZz4ge1xuICAvLyBjaGVjayBpZiBhbnkgcGF0aCBtYXBwaW5nIHJ1bGVzIGFyZSByZWxldmFudFxuICBmb3IgKGNvbnN0IHsgc3RhckluZGV4LCBwcmVmaXgsIHN1ZmZpeCwgcG90ZW50aWFscyB9IG9mIHBhdHRlcm5zKSB7XG4gICAgbGV0IHBhcnRpYWw7XG5cbiAgICBpZiAoc3RhckluZGV4ID09PSAtMSkge1xuICAgICAgLy8gTm8gc3RhciBtZWFucyBhbiBleGFjdCBtYXRjaCBpcyByZXF1aXJlZFxuICAgICAgaWYgKHByZWZpeCA9PT0gb3JpZ2luYWxSZXF1ZXN0KSB7XG4gICAgICAgIHBhcnRpYWwgPSAnJztcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHN0YXJJbmRleCA9PT0gMCAmJiAhc3VmZml4KSB7XG4gICAgICAvLyBFdmVyeXRoaW5nIG1hdGNoZXMgYSBzaW5nbGUgd2lsZGNhcmQgcGF0dGVybiAoXCIqXCIpXG4gICAgICBwYXJ0aWFsID0gb3JpZ2luYWxSZXF1ZXN0O1xuICAgIH0gZWxzZSBpZiAoIXN1ZmZpeCkge1xuICAgICAgLy8gTm8gc3VmZml4IG1lYW5zIHRoZSBzdGFyIGlzIGF0IHRoZSBlbmQgb2YgdGhlIHBhdHRlcm5cbiAgICAgIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aChwcmVmaXgpKSB7XG4gICAgICAgIHBhcnRpYWwgPSBvcmlnaW5hbFJlcXVlc3Quc2xpY2UocHJlZml4Lmxlbmd0aCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFN0YXIgd2FzIGluIHRoZSBtaWRkbGUgb2YgdGhlIHBhdHRlcm5cbiAgICAgIGlmIChvcmlnaW5hbFJlcXVlc3Quc3RhcnRzV2l0aChwcmVmaXgpICYmIG9yaWdpbmFsUmVxdWVzdC5lbmRzV2l0aChzdWZmaXgpKSB7XG4gICAgICAgIHBhcnRpYWwgPSBvcmlnaW5hbFJlcXVlc3Quc3Vic3RyaW5nKHByZWZpeC5sZW5ndGgsIG9yaWdpbmFsUmVxdWVzdC5sZW5ndGggLSBzdWZmaXgubGVuZ3RoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiByZXF1ZXN0IHdhcyBub3QgbWF0Y2hlZCwgbW92ZSBvbiB0byB0aGUgbmV4dCBwYXR0ZXJuXG4gICAgaWYgKHBhcnRpYWwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIHRoZSBmdWxsIHJlcGxhY2VtZW50IHZhbHVlcyBiYXNlZCBvbiB0aGUgb3JpZ2luYWwgcmVxdWVzdCBhbmQgdGhlIHBvdGVudGlhbHNcbiAgICAvLyBmb3IgdGhlIHN1Y2Nlc3NmdWxseSBtYXRjaGVkIHBhdHRlcm4uXG4gICAgZm9yIChjb25zdCB7IGhhc1N0YXIsIHByZWZpeCwgc3VmZml4IH0gb2YgcG90ZW50aWFscykge1xuICAgICAgbGV0IHJlcGxhY2VtZW50ID0gcHJlZml4O1xuXG4gICAgICBpZiAoaGFzU3Rhcikge1xuICAgICAgICByZXBsYWNlbWVudCArPSBwYXJ0aWFsO1xuICAgICAgICBpZiAoc3VmZml4KSB7XG4gICAgICAgICAgcmVwbGFjZW1lbnQgKz0gc3VmZml4O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHlpZWxkIHJlcGxhY2VtZW50O1xuICAgIH1cbiAgfVxufVxuIl19