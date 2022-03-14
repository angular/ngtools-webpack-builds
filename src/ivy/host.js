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
exports.augmentHostWithCaching = exports.augmentProgramWithVersioning = exports.augmentHostWithVersioning = exports.augmentHostWithSubstitutions = exports.augmentHostWithReplacements = exports.augmentHostWithNgcc = exports.augmentHostWithDependencyCollection = exports.augmentHostWithResources = void 0;
const crypto_1 = require("crypto");
const path = __importStar(require("path"));
const ts = __importStar(require("typescript"));
const paths_1 = require("./paths");
function augmentHostWithResources(host, resourceLoader, options = {}) {
    const resourceHost = host;
    resourceHost.readResource = function (fileName) {
        const filePath = (0, paths_1.normalizePath)(fileName);
        if (options.directTemplateLoading &&
            (filePath.endsWith('.html') || filePath.endsWith('.svg'))) {
            const content = this.readFile(filePath);
            if (content === undefined) {
                throw new Error('Unable to locate component resource: ' + fileName);
            }
            resourceLoader.setAffectedResources(filePath, [filePath]);
            return content;
        }
        else {
            return resourceLoader.get(filePath);
        }
    };
    resourceHost.resourceNameToFileName = function (resourceName, containingFile) {
        return path.join(path.dirname(containingFile), resourceName);
    };
    resourceHost.getModifiedResourceFiles = function () {
        return resourceLoader.getModifiedResourceFiles();
    };
    resourceHost.transformResource = async function (data, context) {
        // Only inline style resources are supported currently
        if (context.resourceFile || context.type !== 'style') {
            return null;
        }
        if (options.inlineStyleFileExtension) {
            const content = await resourceLoader.process(data, options.inlineStyleFileExtension, context.type, context.containingFile);
            return { content };
        }
        return null;
    };
}
exports.augmentHostWithResources = augmentHostWithResources;
function augmentResolveModuleNames(host, resolvedModuleModifier, moduleResolutionCache) {
    if (host.resolveModuleNames) {
        const baseResolveModuleNames = host.resolveModuleNames;
        host.resolveModuleNames = function (moduleNames, ...parameters) {
            return moduleNames.map((name) => {
                const result = baseResolveModuleNames.call(host, [name], ...parameters);
                return resolvedModuleModifier(result[0], name);
            });
        };
    }
    else {
        host.resolveModuleNames = function (moduleNames, containingFile, _reusedNames, redirectedReference, options) {
            return moduleNames.map((name) => {
                const result = ts.resolveModuleName(name, containingFile, options, host, moduleResolutionCache, redirectedReference).resolvedModule;
                return resolvedModuleModifier(result, name);
            });
        };
    }
}
/**
 * Augments a TypeScript Compiler Host's resolveModuleNames function to collect dependencies
 * of the containing file passed to the resolveModuleNames function. This process assumes
 * that consumers of the Compiler Host will only call resolveModuleNames with modules that are
 * actually present in a containing file.
 * This process is a workaround for gathering a TypeScript SourceFile's dependencies as there
 * is no currently exposed public method to do so. A BuilderProgram does have a `getAllDependencies`
 * function. However, that function returns all transitive dependencies as well which can cause
 * excessive Webpack rebuilds.
 *
 * @param host The CompilerHost to augment.
 * @param dependencies A Map which will be used to store file dependencies.
 * @param moduleResolutionCache An optional resolution cache to use when the host resolves a module.
 */
function augmentHostWithDependencyCollection(host, dependencies, moduleResolutionCache) {
    if (host.resolveModuleNames) {
        const baseResolveModuleNames = host.resolveModuleNames;
        host.resolveModuleNames = function (moduleNames, containingFile, ...parameters) {
            const results = baseResolveModuleNames.call(host, moduleNames, containingFile, ...parameters);
            const containingFilePath = (0, paths_1.normalizePath)(containingFile);
            for (const result of results) {
                if (result) {
                    const containingFileDependencies = dependencies.get(containingFilePath);
                    if (containingFileDependencies) {
                        containingFileDependencies.add(result.resolvedFileName);
                    }
                    else {
                        dependencies.set(containingFilePath, new Set([result.resolvedFileName]));
                    }
                }
            }
            return results;
        };
    }
    else {
        host.resolveModuleNames = function (moduleNames, containingFile, _reusedNames, redirectedReference, options) {
            return moduleNames.map((name) => {
                const result = ts.resolveModuleName(name, containingFile, options, host, moduleResolutionCache, redirectedReference).resolvedModule;
                if (result) {
                    const containingFilePath = (0, paths_1.normalizePath)(containingFile);
                    const containingFileDependencies = dependencies.get(containingFilePath);
                    if (containingFileDependencies) {
                        containingFileDependencies.add(result.resolvedFileName);
                    }
                    else {
                        dependencies.set(containingFilePath, new Set([result.resolvedFileName]));
                    }
                }
                return result;
            });
        };
    }
}
exports.augmentHostWithDependencyCollection = augmentHostWithDependencyCollection;
function augmentHostWithNgcc(host, ngcc, moduleResolutionCache) {
    augmentResolveModuleNames(host, (resolvedModule, moduleName) => {
        if (resolvedModule && ngcc) {
            ngcc.processModule(moduleName, resolvedModule);
        }
        return resolvedModule;
    }, moduleResolutionCache);
    if (host.resolveTypeReferenceDirectives) {
        const baseResolveTypeReferenceDirectives = host.resolveTypeReferenceDirectives;
        host.resolveTypeReferenceDirectives = function (names, ...parameters) {
            return names.map((name) => {
                const result = baseResolveTypeReferenceDirectives.call(host, [name], ...parameters);
                if (result[0] && ngcc) {
                    ngcc.processModule(name, result[0]);
                }
                return result[0];
            });
        };
    }
    else {
        host.resolveTypeReferenceDirectives = function (moduleNames, containingFile, redirectedReference, options) {
            return moduleNames.map((name) => {
                const result = ts.resolveTypeReferenceDirective(name, containingFile, options, host, redirectedReference).resolvedTypeReferenceDirective;
                if (result && ngcc) {
                    ngcc.processModule(name, result);
                }
                return result;
            });
        };
    }
}
exports.augmentHostWithNgcc = augmentHostWithNgcc;
function augmentHostWithReplacements(host, replacements, moduleResolutionCache) {
    if (Object.keys(replacements).length === 0) {
        return;
    }
    const normalizedReplacements = {};
    for (const [key, value] of Object.entries(replacements)) {
        normalizedReplacements[(0, paths_1.normalizePath)(key)] = (0, paths_1.normalizePath)(value);
    }
    const tryReplace = (resolvedModule) => {
        const replacement = resolvedModule && normalizedReplacements[resolvedModule.resolvedFileName];
        if (replacement) {
            return {
                resolvedFileName: replacement,
                isExternalLibraryImport: /[/\\]node_modules[/\\]/.test(replacement),
            };
        }
        else {
            return resolvedModule;
        }
    };
    augmentResolveModuleNames(host, tryReplace, moduleResolutionCache);
}
exports.augmentHostWithReplacements = augmentHostWithReplacements;
function augmentHostWithSubstitutions(host, substitutions) {
    const regexSubstitutions = [];
    for (const [key, value] of Object.entries(substitutions)) {
        regexSubstitutions.push([new RegExp(`\\b${key}\\b`, 'g'), value]);
    }
    if (regexSubstitutions.length === 0) {
        return;
    }
    const baseReadFile = host.readFile;
    host.readFile = function (...parameters) {
        let file = baseReadFile.call(host, ...parameters);
        if (file) {
            for (const entry of regexSubstitutions) {
                file = file.replace(entry[0], entry[1]);
            }
        }
        return file;
    };
}
exports.augmentHostWithSubstitutions = augmentHostWithSubstitutions;
function augmentHostWithVersioning(host) {
    const baseGetSourceFile = host.getSourceFile;
    host.getSourceFile = function (...parameters) {
        const file = baseGetSourceFile.call(host, ...parameters);
        if (file && file.version === undefined) {
            file.version = (0, crypto_1.createHash)('sha256').update(file.text).digest('hex');
        }
        return file;
    };
}
exports.augmentHostWithVersioning = augmentHostWithVersioning;
function augmentProgramWithVersioning(program) {
    const baseGetSourceFiles = program.getSourceFiles;
    program.getSourceFiles = function (...parameters) {
        const files = baseGetSourceFiles(...parameters);
        for (const file of files) {
            if (file.version === undefined) {
                file.version = (0, crypto_1.createHash)('sha256').update(file.text).digest('hex');
            }
        }
        return files;
    };
}
exports.augmentProgramWithVersioning = augmentProgramWithVersioning;
function augmentHostWithCaching(host, cache) {
    const baseGetSourceFile = host.getSourceFile;
    host.getSourceFile = function (fileName, languageVersion, onError, shouldCreateNewSourceFile, ...parameters) {
        if (!shouldCreateNewSourceFile && cache.has(fileName)) {
            return cache.get(fileName);
        }
        const file = baseGetSourceFile.call(host, fileName, languageVersion, onError, true, ...parameters);
        if (file) {
            cache.set(fileName, file);
        }
        return file;
    };
}
exports.augmentHostWithCaching = augmentHostWithCaching;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaG9zdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvaXZ5L2hvc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUlILG1DQUFvQztBQUNwQywyQ0FBNkI7QUFDN0IsK0NBQWlDO0FBR2pDLG1DQUF3QztBQUV4QyxTQUFnQix3QkFBd0IsQ0FDdEMsSUFBcUIsRUFDckIsY0FBcUMsRUFDckMsVUFHSSxFQUFFO0lBRU4sTUFBTSxZQUFZLEdBQUcsSUFBb0IsQ0FBQztJQUUxQyxZQUFZLENBQUMsWUFBWSxHQUFHLFVBQVUsUUFBZ0I7UUFDcEQsTUFBTSxRQUFRLEdBQUcsSUFBQSxxQkFBYSxFQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXpDLElBQ0UsT0FBTyxDQUFDLHFCQUFxQjtZQUM3QixDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksUUFBUSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUN6RDtZQUNBLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDeEMsSUFBSSxPQUFPLEtBQUssU0FBUyxFQUFFO2dCQUN6QixNQUFNLElBQUksS0FBSyxDQUFDLHVDQUF1QyxHQUFHLFFBQVEsQ0FBQyxDQUFDO2FBQ3JFO1lBRUQsY0FBYyxDQUFDLG9CQUFvQixDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFFMUQsT0FBTyxPQUFPLENBQUM7U0FDaEI7YUFBTTtZQUNMLE9BQU8sY0FBYyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztTQUNyQztJQUNILENBQUMsQ0FBQztJQUVGLFlBQVksQ0FBQyxzQkFBc0IsR0FBRyxVQUFVLFlBQW9CLEVBQUUsY0FBc0I7UUFDMUYsT0FBTyxJQUFJ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QUFHLFVBQ25CLFFBQVEsRUFDUixlQUFlLEVBQ2YsT0FBTyxFQUNQLHlCQUF5QixFQUN6QixHQUFHLFVBQVU7UUFFYixJQUFJLENBQUMseUJBQXlCLElBQUksS0FBSyxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsRUFBRTtZQUNyRCxPQUFPLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7U0FDNUI7UUFFRCxNQUFNLElBQUksR0FBRyxpQkFBaUIsQ0FBQyxJQUFJLENBQ2pDLElBQUksRUFDSixRQUFRLEVBQ1IsZUFBZSxFQUNmLE9BQU8sRUFDUCxJQUFJLEVBQ0osR0FBRyxVQUFVLENBQ2QsQ0FBQztRQUVGLElBQUksSUFBSSxFQUFFO1lBQ1IsS0FBSyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUM7U0FDM0I7UUFFRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUMsQ0FBQztBQUNKLENBQUM7QUEvQkQsd0RBK0JDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbi8qIGVzbGludC1kaXNhYmxlIEB0eXBlc2NyaXB0LWVzbGludC91bmJvdW5kLW1ldGhvZCAqL1xuaW1wb3J0IHR5cGUgeyBDb21waWxlckhvc3QgfSBmcm9tICdAYW5ndWxhci9jb21waWxlci1jbGknO1xuaW1wb3J0IHsgY3JlYXRlSGFzaCB9IGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBOZ2NjUHJvY2Vzc29yIH0gZnJvbSAnLi4vbmdjY19wcm9jZXNzb3InO1xuaW1wb3J0IHsgV2VicGFja1Jlc291cmNlTG9hZGVyIH0gZnJvbSAnLi4vcmVzb3VyY2VfbG9hZGVyJztcbmltcG9ydCB7IG5vcm1hbGl6ZVBhdGggfSBmcm9tICcuL3BhdGhzJztcblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aFJlc291cmNlcyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICByZXNvdXJjZUxvYWRlcjogV2VicGFja1Jlc291cmNlTG9hZGVyLFxuICBvcHRpb25zOiB7XG4gICAgZGlyZWN0VGVtcGxhdGVMb2FkaW5nPzogYm9vbGVhbjtcbiAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmc7XG4gIH0gPSB7fSxcbikge1xuICBjb25zdCByZXNvdXJjZUhvc3QgPSBob3N0IGFzIENvbXBpbGVySG9zdDtcblxuICByZXNvdXJjZUhvc3QucmVhZFJlc291cmNlID0gZnVuY3Rpb24gKGZpbGVOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBmaWxlUGF0aCA9IG5vcm1hbGl6ZVBhdGgoZmlsZU5hbWUpO1xuXG4gICAgaWYgKFxuICAgICAgb3B0aW9ucy5kaXJlY3RUZW1wbGF0ZUxvYWRpbmcgJiZcbiAgICAgIChmaWxlUGF0aC5lbmRzV2l0aCgnLmh0bWwnKSB8fCBmaWxlUGF0aC5lbmRzV2l0aCgnLnN2ZycpKVxuICAgICkge1xuICAgICAgY29uc3QgY29udGVudCA9IHRoaXMucmVhZEZpbGUoZmlsZVBhdGgpO1xuICAgICAgaWYgKGNvbnRlbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYWJsZSB0byBsb2NhdGUgY29tcG9uZW50IHJlc291cmNlOiAnICsgZmlsZU5hbWUpO1xuICAgICAgfVxuXG4gICAgICByZXNvdXJjZUxvYWRlci5zZXRBZmZlY3RlZFJlc291cmNlcyhmaWxlUGF0aCwgW2ZpbGVQYXRoXSk7XG5cbiAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gcmVzb3VyY2VMb2FkZXIuZ2V0KGZpbGVQYXRoKTtcbiAgICB9XG4gIH07XG5cbiAgcmVzb3VyY2VIb3N0LnJlc291cmNlTmFtZVRvRmlsZU5hbWUgPSBmdW5jdGlvbiAocmVzb3VyY2VOYW1lOiBzdHJpbmcsIGNvbnRhaW5pbmdGaWxlOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gcGF0aC5qb2luKHBhdGguZGlybmFtZShjb250YWluaW5nRmlsZSksIHJlc291cmNlTmFtZSk7XG4gIH07XG5cbiAgcmVzb3VyY2VIb3N0LmdldE1vZGlmaWVkUmVzb3VyY2VGaWxlcyA9IGZ1bmN0aW9uICgpIHtcbiAgICByZXR1cm4gcmVzb3VyY2VMb2FkZXIuZ2V0TW9kaWZpZWRSZXNvdXJjZUZpbGVzKCk7XG4gIH07XG5cbiAgcmVzb3VyY2VIb3N0LnRyYW5zZm9ybVJlc291cmNlID0gYXN5bmMgZnVuY3Rpb24gKGRhdGEsIGNvbnRleHQpIHtcbiAgICAvLyBPbmx5IGlubGluZSBzdHlsZSByZXNvdXJjZXMgYXJlIHN1cHBvcnRlZCBjdXJyZW50bHlcbiAgICBpZiAoY29udGV4dC5yZXNvdXJjZUZpbGUgfHwgY29udGV4dC50eXBlICE9PSAnc3R5bGUnKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAob3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24pIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCByZXNvdXJjZUxvYWRlci5wcm9jZXNzKFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcHRpb25zLmlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgICAgY29udGV4dC50eXBlLFxuICAgICAgICBjb250ZXh0LmNvbnRhaW5pbmdGaWxlLFxuICAgICAgKTtcblxuICAgICAgcmV0dXJuIHsgY29udGVudCB9O1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9O1xufVxuXG5mdW5jdGlvbiBhdWdtZW50UmVzb2x2ZU1vZHVsZU5hbWVzKFxuICBob3N0OiB0cy5Db21waWxlckhvc3QsXG4gIHJlc29sdmVkTW9kdWxlTW9kaWZpZXI6IChcbiAgICByZXNvbHZlZE1vZHVsZTogdHMuUmVzb2x2ZWRNb2R1bGUgfCB1bmRlZmluZWQsXG4gICAgbW9kdWxlTmFtZTogc3RyaW5nLFxuICApID0+IHRzLlJlc29sdmVkTW9kdWxlIHwgdW5kZWZpbmVkLFxuICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGU/OiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4pOiB2b2lkIHtcbiAgaWYgKGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzKSB7XG4gICAgY29uc3QgYmFzZVJlc29sdmVNb2R1bGVOYW1lcyA9IGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzO1xuICAgIGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzID0gZnVuY3Rpb24gKG1vZHVsZU5hbWVzOiBzdHJpbmdbXSwgLi4ucGFyYW1ldGVycykge1xuICAgICAgcmV0dXJuIG1vZHVsZU5hbWVzLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBiYXNlUmVzb2x2ZU1vZHVsZU5hbWVzLmNhbGwoaG9zdCwgW25hbWVdLCAuLi5wYXJhbWV0ZXJzKTtcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRNb2R1bGVNb2RpZmllcihyZXN1bHRbMF0sIG5hbWUpO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBob3N0LnJlc29sdmVNb2R1bGVOYW1lcyA9IGZ1bmN0aW9uIChcbiAgICAgIG1vZHVsZU5hbWVzOiBzdHJpbmdbXSxcbiAgICAgIGNvbnRhaW5pbmdGaWxlOiBzdHJpbmcsXG4gICAgICBfcmV1c2VkTmFtZXM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLFxuICAgICAgcmVkaXJlY3RlZFJlZmVyZW5jZTogdHMuUmVzb2x2ZWRQcm9qZWN0UmVmZXJlbmNlIHwgdW5kZWZpbmVkLFxuICAgICAgb3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuICAgICkge1xuICAgICAgcmV0dXJuIG1vZHVsZU5hbWVzLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbnRhaW5pbmdGaWxlLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgaG9zdCxcbiAgICAgICAgICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4gICAgICAgICAgcmVkaXJlY3RlZFJlZmVyZW5jZSxcbiAgICAgICAgKS5yZXNvbHZlZE1vZHVsZTtcblxuICAgICAgICByZXR1cm4gcmVzb2x2ZWRNb2R1bGVNb2RpZmllcihyZXN1bHQsIG5hbWUpO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxufVxuXG4vKipcbiAqIEF1Z21lbnRzIGEgVHlwZVNjcmlwdCBDb21waWxlciBIb3N0J3MgcmVzb2x2ZU1vZHVsZU5hbWVzIGZ1bmN0aW9uIHRvIGNvbGxlY3QgZGVwZW5kZW5jaWVzXG4gKiBvZiB0aGUgY29udGFpbmluZyBmaWxlIHBhc3NlZCB0byB0aGUgcmVzb2x2ZU1vZHVsZU5hbWVzIGZ1bmN0aW9uLiBUaGlzIHByb2Nlc3MgYXNzdW1lc1xuICogdGhhdCBjb25zdW1lcnMgb2YgdGhlIENvbXBpbGVyIEhvc3Qgd2lsbCBvbmx5IGNhbGwgcmVzb2x2ZU1vZHVsZU5hbWVzIHdpdGggbW9kdWxlcyB0aGF0IGFyZVxuICogYWN0dWFsbHkgcHJlc2VudCBpbiBhIGNvbnRhaW5pbmcgZmlsZS5cbiAqIFRoaXMgcHJvY2VzcyBpcyBhIHdvcmthcm91bmQgZm9yIGdhdGhlcmluZyBhIFR5cGVTY3JpcHQgU291cmNlRmlsZSdzIGRlcGVuZGVuY2llcyBhcyB0aGVyZVxuICogaXMgbm8gY3VycmVudGx5IGV4cG9zZWQgcHVibGljIG1ldGhvZCB0byBkbyBzby4gQSBCdWlsZGVyUHJvZ3JhbSBkb2VzIGhhdmUgYSBgZ2V0QWxsRGVwZW5kZW5jaWVzYFxuICogZnVuY3Rpb24uIEhvd2V2ZXIsIHRoYXQgZnVuY3Rpb24gcmV0dXJucyBhbGwgdHJhbnNpdGl2ZSBkZXBlbmRlbmNpZXMgYXMgd2VsbCB3aGljaCBjYW4gY2F1c2VcbiAqIGV4Y2Vzc2l2ZSBXZWJwYWNrIHJlYnVpbGRzLlxuICpcbiAqIEBwYXJhbSBob3N0IFRoZSBDb21waWxlckhvc3QgdG8gYXVnbWVudC5cbiAqIEBwYXJhbSBkZXBlbmRlbmNpZXMgQSBNYXAgd2hpY2ggd2lsbCBiZSB1c2VkIHRvIHN0b3JlIGZpbGUgZGVwZW5kZW5jaWVzLlxuICogQHBhcmFtIG1vZHVsZVJlc29sdXRpb25DYWNoZSBBbiBvcHRpb25hbCByZXNvbHV0aW9uIGNhY2hlIHRvIHVzZSB3aGVuIHRoZSBob3N0IHJlc29sdmVzIGEgbW9kdWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXVnbWVudEhvc3RXaXRoRGVwZW5kZW5jeUNvbGxlY3Rpb24oXG4gIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgZGVwZW5kZW5jaWVzOiBNYXA8c3RyaW5nLCBTZXQ8c3RyaW5nPj4sXG4gIG1vZHVsZVJlc29sdXRpb25DYWNoZT86IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZSxcbik6IHZvaWQge1xuICBpZiAoaG9zdC5yZXNvbHZlTW9kdWxlTmFtZXMpIHtcbiAgICBjb25zdCBiYXNlUmVzb2x2ZU1vZHVsZU5hbWVzID0gaG9zdC5yZXNvbHZlTW9kdWxlTmFtZXM7XG4gICAgaG9zdC5yZXNvbHZlTW9kdWxlTmFtZXMgPSBmdW5jdGlvbiAoXG4gICAgICBtb2R1bGVOYW1lczogc3RyaW5nW10sXG4gICAgICBjb250YWluaW5nRmlsZTogc3RyaW5nLFxuICAgICAgLi4ucGFyYW1ldGVyc1xuICAgICkge1xuICAgICAgY29uc3QgcmVzdWx0cyA9IGJhc2VSZXNvbHZlTW9kdWxlTmFtZXMuY2FsbChob3N0LCBtb2R1bGVOYW1lcywgY29udGFpbmluZ0ZpbGUsIC4uLnBhcmFtZXRlcnMpO1xuXG4gICAgICBjb25zdCBjb250YWluaW5nRmlsZVBhdGggPSBub3JtYWxpemVQYXRoKGNvbnRhaW5pbmdGaWxlKTtcbiAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHJlc3VsdHMpIHtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIGNvbnN0IGNvbnRhaW5pbmdGaWxlRGVwZW5kZW5jaWVzID0gZGVwZW5kZW5jaWVzLmdldChjb250YWluaW5nRmlsZVBhdGgpO1xuICAgICAgICAgIGlmIChjb250YWluaW5nRmlsZURlcGVuZGVuY2llcykge1xuICAgICAgICAgICAgY29udGFpbmluZ0ZpbGVEZXBlbmRlbmNpZXMuYWRkKHJlc3VsdC5yZXNvbHZlZEZpbGVOYW1lKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVwZW5kZW5jaWVzLnNldChjb250YWluaW5nRmlsZVBhdGgsIG5ldyBTZXQoW3Jlc3VsdC5yZXNvbHZlZEZpbGVOYW1lXSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzID0gZnVuY3Rpb24gKFxuICAgICAgbW9kdWxlTmFtZXM6IHN0cmluZ1tdLFxuICAgICAgY29udGFpbmluZ0ZpbGU6IHN0cmluZyxcbiAgICAgIF9yZXVzZWROYW1lczogc3RyaW5nW10gfCB1bmRlZmluZWQsXG4gICAgICByZWRpcmVjdGVkUmVmZXJlbmNlOiB0cy5SZXNvbHZlZFByb2plY3RSZWZlcmVuY2UgfCB1bmRlZmluZWQsXG4gICAgICBvcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4gICAgKSB7XG4gICAgICByZXR1cm4gbW9kdWxlTmFtZXMubWFwKChuYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgY29udGFpbmluZ0ZpbGUsXG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBob3N0LFxuICAgICAgICAgIG1vZHVsZVJlc29sdXRpb25DYWNoZSxcbiAgICAgICAgICByZWRpcmVjdGVkUmVmZXJlbmNlLFxuICAgICAgICApLnJlc29sdmVkTW9kdWxlO1xuXG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICBjb25zdCBjb250YWluaW5nRmlsZVBhdGggPSBub3JtYWxpemVQYXRoKGNvbnRhaW5pbmdGaWxlKTtcbiAgICAgICAgICBjb25zdCBjb250YWluaW5nRmlsZURlcGVuZGVuY2llcyA9IGRlcGVuZGVuY2llcy5nZXQoY29udGFpbmluZ0ZpbGVQYXRoKTtcbiAgICAgICAgICBpZiAoY29udGFpbmluZ0ZpbGVEZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIGNvbnRhaW5pbmdGaWxlRGVwZW5kZW5jaWVzLmFkZChyZXN1bHQucmVzb2x2ZWRGaWxlTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlcGVuZGVuY2llcy5zZXQoY29udGFpbmluZ0ZpbGVQYXRoLCBuZXcgU2V0KFtyZXN1bHQucmVzb2x2ZWRGaWxlTmFtZV0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXVnbWVudEhvc3RXaXRoTmdjYyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICBuZ2NjOiBOZ2NjUHJvY2Vzc29yLFxuICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGU/OiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4pOiB2b2lkIHtcbiAgYXVnbWVudFJlc29sdmVNb2R1bGVOYW1lcyhcbiAgICBob3N0LFxuICAgIChyZXNvbHZlZE1vZHVsZSwgbW9kdWxlTmFtZSkgPT4ge1xuICAgICAgaWYgKHJlc29sdmVkTW9kdWxlICYmIG5nY2MpIHtcbiAgICAgICAgbmdjYy5wcm9jZXNzTW9kdWxlKG1vZHVsZU5hbWUsIHJlc29sdmVkTW9kdWxlKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc29sdmVkTW9kdWxlO1xuICAgIH0sXG4gICAgbW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuICApO1xuXG4gIGlmIChob3N0LnJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlcykge1xuICAgIGNvbnN0IGJhc2VSZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMgPSBob3N0LnJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlcztcbiAgICBob3N0LnJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlcyA9IGZ1bmN0aW9uIChuYW1lczogc3RyaW5nW10sIC4uLnBhcmFtZXRlcnMpIHtcbiAgICAgIHJldHVybiBuYW1lcy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYmFzZVJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlcy5jYWxsKGhvc3QsIFtuYW1lXSwgLi4ucGFyYW1ldGVycyk7XG5cbiAgICAgICAgaWYgKHJlc3VsdFswXSAmJiBuZ2NjKSB7XG4gICAgICAgICAgbmdjYy5wcm9jZXNzTW9kdWxlKG5hbWUsIHJlc3VsdFswXSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzdWx0WzBdO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBob3N0LnJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlcyA9IGZ1bmN0aW9uIChcbiAgICAgIG1vZHVsZU5hbWVzOiBzdHJpbmdbXSxcbiAgICAgIGNvbnRhaW5pbmdGaWxlOiBzdHJpbmcsXG4gICAgICByZWRpcmVjdGVkUmVmZXJlbmNlOiB0cy5SZXNvbHZlZFByb2plY3RSZWZlcmVuY2UgfCB1bmRlZmluZWQsXG4gICAgICBvcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4gICAgKSB7XG4gICAgICByZXR1cm4gbW9kdWxlTmFtZXMubWFwKChuYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHRzLnJlc29sdmVUeXBlUmVmZXJlbmNlRGlyZWN0aXZlKFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgICAgY29udGFpbmluZ0ZpbGUsXG4gICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICBob3N0LFxuICAgICAgICAgIHJlZGlyZWN0ZWRSZWZlcmVuY2UsXG4gICAgICAgICkucmVzb2x2ZWRUeXBlUmVmZXJlbmNlRGlyZWN0aXZlO1xuXG4gICAgICAgIGlmIChyZXN1bHQgJiYgbmdjYykge1xuICAgICAgICAgIG5nY2MucHJvY2Vzc01vZHVsZShuYW1lLCByZXN1bHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aFJlcGxhY2VtZW50cyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICByZXBsYWNlbWVudHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gIG1vZHVsZVJlc29sdXRpb25DYWNoZT86IHRzLk1vZHVsZVJlc29sdXRpb25DYWNoZSxcbik6IHZvaWQge1xuICBpZiAoT2JqZWN0LmtleXMocmVwbGFjZW1lbnRzKS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBub3JtYWxpemVkUmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHJlcGxhY2VtZW50cykpIHtcbiAgICBub3JtYWxpemVkUmVwbGFjZW1lbnRzW25vcm1hbGl6ZVBhdGgoa2V5KV0gPSBub3JtYWxpemVQYXRoKHZhbHVlKTtcbiAgfVxuXG4gIGNvbnN0IHRyeVJlcGxhY2UgPSAocmVzb2x2ZWRNb2R1bGU6IHRzLlJlc29sdmVkTW9kdWxlIHwgdW5kZWZpbmVkKSA9PiB7XG4gICAgY29uc3QgcmVwbGFjZW1lbnQgPSByZXNvbHZlZE1vZHVsZSAmJiBub3JtYWxpemVkUmVwbGFjZW1lbnRzW3Jlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWVdO1xuICAgIGlmIChyZXBsYWNlbWVudCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgcmVzb2x2ZWRGaWxlTmFtZTogcmVwbGFjZW1lbnQsXG4gICAgICAgIGlzRXh0ZXJuYWxMaWJyYXJ5SW1wb3J0OiAvWy9cXFxcXW5vZGVfbW9kdWxlc1svXFxcXF0vLnRlc3QocmVwbGFjZW1lbnQpLFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHJlc29sdmVkTW9kdWxlO1xuICAgIH1cbiAgfTtcblxuICBhdWdtZW50UmVzb2x2ZU1vZHVsZU5hbWVzKGhvc3QsIHRyeVJlcGxhY2UsIG1vZHVsZVJlc29sdXRpb25DYWNoZSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhdWdtZW50SG9zdFdpdGhTdWJzdGl0dXRpb25zKFxuICBob3N0OiB0cy5Db21waWxlckhvc3QsXG4gIHN1YnN0aXR1dGlvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4pOiB2b2lkIHtcbiAgY29uc3QgcmVnZXhTdWJzdGl0dXRpb25zOiBbUmVnRXhwLCBzdHJpbmddW10gPSBbXTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc3Vic3RpdHV0aW9ucykpIHtcbiAgICByZWdleFN1YnN0aXR1dGlvbnMucHVzaChbbmV3IFJlZ0V4cChgXFxcXGIke2tleX1cXFxcYmAsICdnJyksIHZhbHVlXSk7XG4gIH1cblxuICBpZiAocmVnZXhTdWJzdGl0dXRpb25zLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGJhc2VSZWFkRmlsZSA9IGhvc3QucmVhZEZpbGU7XG4gIGhvc3QucmVhZEZpbGUgPSBmdW5jdGlvbiAoLi4ucGFyYW1ldGVycykge1xuICAgIGxldCBmaWxlOiBzdHJpbmcgfCB1bmRlZmluZWQgPSBiYXNlUmVhZEZpbGUuY2FsbChob3N0LCAuLi5wYXJhbWV0ZXJzKTtcbiAgICBpZiAoZmlsZSkge1xuICAgICAgZm9yIChjb25zdCBlbnRyeSBvZiByZWdleFN1YnN0aXR1dGlvbnMpIHtcbiAgICAgICAgZmlsZSA9IGZpbGUucmVwbGFjZShlbnRyeVswXSwgZW50cnlbMV0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlO1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXVnbWVudEhvc3RXaXRoVmVyc2lvbmluZyhob3N0OiB0cy5Db21waWxlckhvc3QpOiB2b2lkIHtcbiAgY29uc3QgYmFzZUdldFNvdXJjZUZpbGUgPSBob3N0LmdldFNvdXJjZUZpbGU7XG4gIGhvc3QuZ2V0U291cmNlRmlsZSA9IGZ1bmN0aW9uICguLi5wYXJhbWV0ZXJzKSB7XG4gICAgY29uc3QgZmlsZTogKHRzLlNvdXJjZUZpbGUgJiB7IHZlcnNpb24/OiBzdHJpbmcgfSkgfCB1bmRlZmluZWQgPSBiYXNlR2V0U291cmNlRmlsZS5jYWxsKFxuICAgICAgaG9zdCxcbiAgICAgIC4uLnBhcmFtZXRlcnMsXG4gICAgKTtcbiAgICBpZiAoZmlsZSAmJiBmaWxlLnZlcnNpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgZmlsZS52ZXJzaW9uID0gY3JlYXRlSGFzaCgnc2hhMjU2JykudXBkYXRlKGZpbGUudGV4dCkuZGlnZXN0KCdoZXgnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRQcm9ncmFtV2l0aFZlcnNpb25pbmcocHJvZ3JhbTogdHMuUHJvZ3JhbSk6IHZvaWQge1xuICBjb25zdCBiYXNlR2V0U291cmNlRmlsZXMgPSBwcm9ncmFtLmdldFNvdXJjZUZpbGVzO1xuICBwcm9ncmFtLmdldFNvdXJjZUZpbGVzID0gZnVuY3Rpb24gKC4uLnBhcmFtZXRlcnMpIHtcbiAgICBjb25zdCBmaWxlczogcmVhZG9ubHkgKHRzLlNvdXJjZUZpbGUgJiB7IHZlcnNpb24/OiBzdHJpbmcgfSlbXSA9IGJhc2VHZXRTb3VyY2VGaWxlcyhcbiAgICAgIC4uLnBhcmFtZXRlcnMsXG4gICAgKTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgaWYgKGZpbGUudmVyc2lvbiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGZpbGUudmVyc2lvbiA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShmaWxlLnRleHQpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGVzO1xuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXVnbWVudEhvc3RXaXRoQ2FjaGluZyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICBjYWNoZTogTWFwPHN0cmluZywgdHMuU291cmNlRmlsZT4sXG4pOiB2b2lkIHtcbiAgY29uc3QgYmFzZUdldFNvdXJjZUZpbGUgPSBob3N0LmdldFNvdXJjZUZpbGU7XG4gIGhvc3QuZ2V0U291cmNlRmlsZSA9IGZ1bmN0aW9uIChcbiAgICBmaWxlTmFtZSxcbiAgICBsYW5ndWFnZVZlcnNpb24sXG4gICAgb25FcnJvcixcbiAgICBzaG91bGRDcmVhdGVOZXdTb3VyY2VGaWxlLFxuICAgIC4uLnBhcmFtZXRlcnNcbiAgKSB7XG4gICAgaWYgKCFzaG91bGRDcmVhdGVOZXdTb3VyY2VGaWxlICYmIGNhY2hlLmhhcyhmaWxlTmFtZSkpIHtcbiAgICAgIHJldHVybiBjYWNoZS5nZXQoZmlsZU5hbWUpO1xuICAgIH1cblxuICAgIGNvbnN0IGZpbGUgPSBiYXNlR2V0U291cmNlRmlsZS5jYWxsKFxuICAgICAgaG9zdCxcbiAgICAgIGZpbGVOYW1lLFxuICAgICAgbGFuZ3VhZ2VWZXJzaW9uLFxuICAgICAgb25FcnJvcixcbiAgICAgIHRydWUsXG4gICAgICAuLi5wYXJhbWV0ZXJzLFxuICAgICk7XG5cbiAgICBpZiAoZmlsZSkge1xuICAgICAgY2FjaGUuc2V0KGZpbGVOYW1lLCBmaWxlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZTtcbiAgfTtcbn1cbiJdfQ==