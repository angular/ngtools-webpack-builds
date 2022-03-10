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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaG9zdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvaXZ5L2hvc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFJSCxtQ0FBb0M7QUFDcEMsMkNBQTZCO0FBQzdCLCtDQUFpQztBQUdqQyxtQ0FBd0M7QUFFeEMsU0FBZ0Isd0JBQXdCLENBQ3RDLElBQXFCLEVBQ3JCLGNBQXFDLEVBQ3JDLFVBR0ksRUFBRTtJQUVOLE1BQU0sWUFBWSxHQUFHLElBQW9CLENBQUM7SUFFMUMsWUFBWSxDQUFDLFlBQVksR0FBRyxVQUFVLFFBQWdCO1FBQ3BELE1BQU0sUUFBUSxHQUFHLElBQUEscUJBQWEsRUFBQyxRQUFRLENBQUMsQ0FBQztRQUV6QyxJQUNFLE9BQU8sQ0FBQyxxQkFBcUI7WUFDN0IsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxJQUFJLFFBQVEsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUMsRUFDekQ7WUFDQSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3hDLElBQUksT0FBTyxLQUFLLFNBQVMsRUFBRTtnQkFDekIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsR0FBRyxRQUFRLENBQUMsQ0FBQzthQUNyRTtZQUVELGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBRTFELE9BQU8sT0FBTyxDQUFDO1NBQ2hCO2FBQU07WUFDTCxPQUFPLGNBQWMsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7U0FDckM7SUFDSCxDQUFDLENBQUM7SUFFRixZQUFZLENBQUMsc0JBQXNCLEdBQUcsVUFBVSxZQUFvQixFQUFFLGNBQXNCO1FBQzFGLE9BQU8s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QWEsR0FBRyxVQUNuQixRQUFRLEVBQ1IsZUFBZSxFQUNmLE9BQU8sRUFDUCx5QkFBeUIsRUFDekIsR0FBRyxVQUFVO1FBRWIsSUFBSSxDQUFDLHlCQUF5QixJQUFJLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLEVBQUU7WUFDckQsT0FBTyxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1NBQzVCO1FBRUQsTUFBTSxJQUFJLEdBQUcsaUJBQWlCLENBQUMsSUFBSSxDQUNqQyxJQUFJLEVBQ0osUUFBUSxFQUNSLGVBQWUsRUFDZixPQUFPLEVBQ1AsSUFBSSxFQUNKLEdBQUcsVUFBVSxDQUNkLENBQUM7UUFFRixJQUFJLElBQUksRUFBRTtZQUNSLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDO1NBQzNCO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDLENBQUM7QUFDSixDQUFDO0FBL0JELHdEQStCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG4vKiBlc2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvdW5ib3VuZC1tZXRob2QgKi9cbmltcG9ydCB0eXBlIHsgQ29tcGlsZXJIb3N0IH0gZnJvbSAnQGFuZ3VsYXIvY29tcGlsZXItY2xpJztcbmltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgTmdjY1Byb2Nlc3NvciB9IGZyb20gJy4uL25nY2NfcHJvY2Vzc29yJztcbmltcG9ydCB7IFdlYnBhY2tSZXNvdXJjZUxvYWRlciB9IGZyb20gJy4uL3Jlc291cmNlX2xvYWRlcic7XG5pbXBvcnQgeyBub3JtYWxpemVQYXRoIH0gZnJvbSAnLi9wYXRocyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBhdWdtZW50SG9zdFdpdGhSZXNvdXJjZXMoXG4gIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgcmVzb3VyY2VMb2FkZXI6IFdlYnBhY2tSZXNvdXJjZUxvYWRlcixcbiAgb3B0aW9uczoge1xuICAgIGRpcmVjdFRlbXBsYXRlTG9hZGluZz86IGJvb2xlYW47XG4gICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nO1xuICB9ID0ge30sXG4pIHtcbiAgY29uc3QgcmVzb3VyY2VIb3N0ID0gaG9zdCBhcyBDb21waWxlckhvc3Q7XG5cbiAgcmVzb3VyY2VIb3N0LnJlYWRSZXNvdXJjZSA9IGZ1bmN0aW9uIChmaWxlTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3QgZmlsZVBhdGggPSBub3JtYWxpemVQYXRoKGZpbGVOYW1lKTtcblxuICAgIGlmIChcbiAgICAgIG9wdGlvbnMuZGlyZWN0VGVtcGxhdGVMb2FkaW5nICYmXG4gICAgICAoZmlsZVBhdGguZW5kc1dpdGgoJy5odG1sJykgfHwgZmlsZVBhdGguZW5kc1dpdGgoJy5zdmcnKSlcbiAgICApIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSB0aGlzLnJlYWRGaWxlKGZpbGVQYXRoKTtcbiAgICAgIGlmIChjb250ZW50ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmFibGUgdG8gbG9jYXRlIGNvbXBvbmVudCByZXNvdXJjZTogJyArIGZpbGVOYW1lKTtcbiAgICAgIH1cblxuICAgICAgcmVzb3VyY2VMb2FkZXIuc2V0QWZmZWN0ZWRSZXNvdXJjZXMoZmlsZVBhdGgsIFtmaWxlUGF0aF0pO1xuXG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHJlc291cmNlTG9hZGVyLmdldChmaWxlUGF0aCk7XG4gICAgfVxuICB9O1xuXG4gIHJlc291cmNlSG9zdC5yZXNvdXJjZU5hbWVUb0ZpbGVOYW1lID0gZnVuY3Rpb24gKHJlc291cmNlTmFtZTogc3RyaW5nLCBjb250YWluaW5nRmlsZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHBhdGguam9pbihwYXRoLmRpcm5hbWUoY29udGFpbmluZ0ZpbGUpLCByZXNvdXJjZU5hbWUpO1xuICB9O1xuXG4gIHJlc291cmNlSG9zdC5nZXRNb2RpZmllZFJlc291cmNlRmlsZXMgPSBmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHJlc291cmNlTG9hZGVyLmdldE1vZGlmaWVkUmVzb3VyY2VGaWxlcygpO1xuICB9O1xuXG4gIHJlc291cmNlSG9zdC50cmFuc2Zvcm1SZXNvdXJjZSA9IGFzeW5jIGZ1bmN0aW9uIChkYXRhLCBjb250ZXh0KSB7XG4gICAgLy8gT25seSBpbmxpbmUgc3R5bGUgcmVzb3VyY2VzIGFyZSBzdXBwb3J0ZWQgY3VycmVudGx5XG4gICAgaWYgKGNvbnRleHQucmVzb3VyY2VGaWxlIHx8IGNvbnRleHQudHlwZSAhPT0gJ3N0eWxlJykge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgaWYgKG9wdGlvbnMuaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uKSB7XG4gICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgcmVzb3VyY2VMb2FkZXIucHJvY2VzcyhcbiAgICAgICAgZGF0YSxcbiAgICAgICAgb3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICAgIGNvbnRleHQudHlwZSxcbiAgICAgICAgY29udGV4dC5jb250YWluaW5nRmlsZSxcbiAgICAgICk7XG5cbiAgICAgIHJldHVybiB7IGNvbnRlbnQgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfTtcbn1cblxuZnVuY3Rpb24gYXVnbWVudFJlc29sdmVNb2R1bGVOYW1lcyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICByZXNvbHZlZE1vZHVsZU1vZGlmaWVyOiAoXG4gICAgcmVzb2x2ZWRNb2R1bGU6IHRzLlJlc29sdmVkTW9kdWxlIHwgdW5kZWZpbmVkLFxuICAgIG1vZHVsZU5hbWU6IHN0cmluZyxcbiAgKSA9PiB0cy5SZXNvbHZlZE1vZHVsZSB8IHVuZGVmaW5lZCxcbiAgbW9kdWxlUmVzb2x1dGlvbkNhY2hlPzogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuKTogdm9pZCB7XG4gIGlmIChob3N0LnJlc29sdmVNb2R1bGVOYW1lcykge1xuICAgIGNvbnN0IGJhc2VSZXNvbHZlTW9kdWxlTmFtZXMgPSBob3N0LnJlc29sdmVNb2R1bGVOYW1lcztcbiAgICBob3N0LnJlc29sdmVNb2R1bGVOYW1lcyA9IGZ1bmN0aW9uIChtb2R1bGVOYW1lczogc3RyaW5nW10sIC4uLnBhcmFtZXRlcnMpIHtcbiAgICAgIHJldHVybiBtb2R1bGVOYW1lcy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYmFzZVJlc29sdmVNb2R1bGVOYW1lcy5jYWxsKGhvc3QsIFtuYW1lXSwgLi4ucGFyYW1ldGVycyk7XG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkTW9kdWxlTW9kaWZpZXIocmVzdWx0WzBdLCBuYW1lKTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgaG9zdC5yZXNvbHZlTW9kdWxlTmFtZXMgPSBmdW5jdGlvbiAoXG4gICAgICBtb2R1bGVOYW1lczogc3RyaW5nW10sXG4gICAgICBjb250YWluaW5nRmlsZTogc3RyaW5nLFxuICAgICAgX3JldXNlZE5hbWVzOiBzdHJpbmdbXSB8IHVuZGVmaW5lZCxcbiAgICAgIHJlZGlyZWN0ZWRSZWZlcmVuY2U6IHRzLlJlc29sdmVkUHJvamVjdFJlZmVyZW5jZSB8IHVuZGVmaW5lZCxcbiAgICAgIG9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbiAgICApIHtcbiAgICAgIHJldHVybiBtb2R1bGVOYW1lcy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUoXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb250YWluaW5nRmlsZSxcbiAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgIGhvc3QsXG4gICAgICAgICAgbW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuICAgICAgICAgIHJlZGlyZWN0ZWRSZWZlcmVuY2UsXG4gICAgICAgICkucmVzb2x2ZWRNb2R1bGU7XG5cbiAgICAgICAgcmV0dXJuIHJlc29sdmVkTW9kdWxlTW9kaWZpZXIocmVzdWx0LCBuYW1lKTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBBdWdtZW50cyBhIFR5cGVTY3JpcHQgQ29tcGlsZXIgSG9zdCdzIHJlc29sdmVNb2R1bGVOYW1lcyBmdW5jdGlvbiB0byBjb2xsZWN0IGRlcGVuZGVuY2llc1xuICogb2YgdGhlIGNvbnRhaW5pbmcgZmlsZSBwYXNzZWQgdG8gdGhlIHJlc29sdmVNb2R1bGVOYW1lcyBmdW5jdGlvbi4gVGhpcyBwcm9jZXNzIGFzc3VtZXNcbiAqIHRoYXQgY29uc3VtZXJzIG9mIHRoZSBDb21waWxlciBIb3N0IHdpbGwgb25seSBjYWxsIHJlc29sdmVNb2R1bGVOYW1lcyB3aXRoIG1vZHVsZXMgdGhhdCBhcmVcbiAqIGFjdHVhbGx5IHByZXNlbnQgaW4gYSBjb250YWluaW5nIGZpbGUuXG4gKiBUaGlzIHByb2Nlc3MgaXMgYSB3b3JrYXJvdW5kIGZvciBnYXRoZXJpbmcgYSBUeXBlU2NyaXB0IFNvdXJjZUZpbGUncyBkZXBlbmRlbmNpZXMgYXMgdGhlcmVcbiAqIGlzIG5vIGN1cnJlbnRseSBleHBvc2VkIHB1YmxpYyBtZXRob2QgdG8gZG8gc28uIEEgQnVpbGRlclByb2dyYW0gZG9lcyBoYXZlIGEgYGdldEFsbERlcGVuZGVuY2llc2BcbiAqIGZ1bmN0aW9uLiBIb3dldmVyLCB0aGF0IGZ1bmN0aW9uIHJldHVybnMgYWxsIHRyYW5zaXRpdmUgZGVwZW5kZW5jaWVzIGFzIHdlbGwgd2hpY2ggY2FuIGNhdXNlXG4gKiBleGNlc3NpdmUgV2VicGFjayByZWJ1aWxkcy5cbiAqXG4gKiBAcGFyYW0gaG9zdCBUaGUgQ29tcGlsZXJIb3N0IHRvIGF1Z21lbnQuXG4gKiBAcGFyYW0gZGVwZW5kZW5jaWVzIEEgTWFwIHdoaWNoIHdpbGwgYmUgdXNlZCB0byBzdG9yZSBmaWxlIGRlcGVuZGVuY2llcy5cbiAqIEBwYXJhbSBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUgQW4gb3B0aW9uYWwgcmVzb2x1dGlvbiBjYWNoZSB0byB1c2Ugd2hlbiB0aGUgaG9zdCByZXNvbHZlcyBhIG1vZHVsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aERlcGVuZGVuY3lDb2xsZWN0aW9uKFxuICBob3N0OiB0cy5Db21waWxlckhvc3QsXG4gIGRlcGVuZGVuY2llczogTWFwPHN0cmluZywgU2V0PHN0cmluZz4+LFxuICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGU/OiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4pOiB2b2lkIHtcbiAgaWYgKGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzKSB7XG4gICAgY29uc3QgYmFzZVJlc29sdmVNb2R1bGVOYW1lcyA9IGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzO1xuICAgIGhvc3QucmVzb2x2ZU1vZHVsZU5hbWVzID0gZnVuY3Rpb24gKFxuICAgICAgbW9kdWxlTmFtZXM6IHN0cmluZ1tdLFxuICAgICAgY29udGFpbmluZ0ZpbGU6IHN0cmluZyxcbiAgICAgIC4uLnBhcmFtZXRlcnNcbiAgICApIHtcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBiYXNlUmVzb2x2ZU1vZHVsZU5hbWVzLmNhbGwoaG9zdCwgbW9kdWxlTmFtZXMsIGNvbnRhaW5pbmdGaWxlLCAuLi5wYXJhbWV0ZXJzKTtcblxuICAgICAgY29uc3QgY29udGFpbmluZ0ZpbGVQYXRoID0gbm9ybWFsaXplUGF0aChjb250YWluaW5nRmlsZSk7XG4gICAgICBmb3IgKGNvbnN0IHJlc3VsdCBvZiByZXN1bHRzKSB7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICBjb25zdCBjb250YWluaW5nRmlsZURlcGVuZGVuY2llcyA9IGRlcGVuZGVuY2llcy5nZXQoY29udGFpbmluZ0ZpbGVQYXRoKTtcbiAgICAgICAgICBpZiAoY29udGFpbmluZ0ZpbGVEZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgICAgIGNvbnRhaW5pbmdGaWxlRGVwZW5kZW5jaWVzLmFkZChyZXN1bHQucmVzb2x2ZWRGaWxlTmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlcGVuZGVuY2llcy5zZXQoY29udGFpbmluZ0ZpbGVQYXRoLCBuZXcgU2V0KFtyZXN1bHQucmVzb2x2ZWRGaWxlTmFtZV0pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICBob3N0LnJlc29sdmVNb2R1bGVOYW1lcyA9IGZ1bmN0aW9uIChcbiAgICAgIG1vZHVsZU5hbWVzOiBzdHJpbmdbXSxcbiAgICAgIGNvbnRhaW5pbmdGaWxlOiBzdHJpbmcsXG4gICAgICBfcmV1c2VkTmFtZXM6IHN0cmluZ1tdIHwgdW5kZWZpbmVkLFxuICAgICAgcmVkaXJlY3RlZFJlZmVyZW5jZTogdHMuUmVzb2x2ZWRQcm9qZWN0UmVmZXJlbmNlIHwgdW5kZWZpbmVkLFxuICAgICAgb3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuICAgICkge1xuICAgICAgcmV0dXJuIG1vZHVsZU5hbWVzLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbnRhaW5pbmdGaWxlLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgaG9zdCxcbiAgICAgICAgICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4gICAgICAgICAgcmVkaXJlY3RlZFJlZmVyZW5jZSxcbiAgICAgICAgKS5yZXNvbHZlZE1vZHVsZTtcblxuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgY29uc3QgY29udGFpbmluZ0ZpbGVQYXRoID0gbm9ybWFsaXplUGF0aChjb250YWluaW5nRmlsZSk7XG4gICAgICAgICAgY29uc3QgY29udGFpbmluZ0ZpbGVEZXBlbmRlbmNpZXMgPSBkZXBlbmRlbmNpZXMuZ2V0KGNvbnRhaW5pbmdGaWxlUGF0aCk7XG4gICAgICAgICAgaWYgKGNvbnRhaW5pbmdGaWxlRGVwZW5kZW5jaWVzKSB7XG4gICAgICAgICAgICBjb250YWluaW5nRmlsZURlcGVuZGVuY2llcy5hZGQocmVzdWx0LnJlc29sdmVkRmlsZU5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZXBlbmRlbmNpZXMuc2V0KGNvbnRhaW5pbmdGaWxlUGF0aCwgbmV3IFNldChbcmVzdWx0LnJlc29sdmVkRmlsZU5hbWVdKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aE5nY2MoXG4gIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgbmdjYzogTmdjY1Byb2Nlc3NvcixcbiAgbW9kdWxlUmVzb2x1dGlvbkNhY2hlPzogdHMuTW9kdWxlUmVzb2x1dGlvbkNhY2hlLFxuKTogdm9pZCB7XG4gIGF1Z21lbnRSZXNvbHZlTW9kdWxlTmFtZXMoXG4gICAgaG9zdCxcbiAgICAocmVzb2x2ZWRNb2R1bGUsIG1vZHVsZU5hbWUpID0+IHtcbiAgICAgIGlmIChyZXNvbHZlZE1vZHVsZSAmJiBuZ2NjKSB7XG4gICAgICAgIG5nY2MucHJvY2Vzc01vZHVsZShtb2R1bGVOYW1lLCByZXNvbHZlZE1vZHVsZSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXNvbHZlZE1vZHVsZTtcbiAgICB9LFxuICAgIG1vZHVsZVJlc29sdXRpb25DYWNoZSxcbiAgKTtcblxuICBpZiAoaG9zdC5yZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMpIHtcbiAgICBjb25zdCBiYXNlUmVzb2x2ZVR5cGVSZWZlcmVuY2VEaXJlY3RpdmVzID0gaG9zdC5yZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXM7XG4gICAgaG9zdC5yZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMgPSBmdW5jdGlvbiAobmFtZXM6IHN0cmluZ1tdLCAuLi5wYXJhbWV0ZXJzKSB7XG4gICAgICByZXR1cm4gbmFtZXMubWFwKChuYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGJhc2VSZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMuY2FsbChob3N0LCBbbmFtZV0sIC4uLnBhcmFtZXRlcnMpO1xuXG4gICAgICAgIGlmIChyZXN1bHRbMF0gJiYgbmdjYykge1xuICAgICAgICAgIG5nY2MucHJvY2Vzc01vZHVsZShuYW1lLCByZXN1bHRbMF0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlc3VsdFswXTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgaG9zdC5yZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZXMgPSBmdW5jdGlvbiAoXG4gICAgICBtb2R1bGVOYW1lczogc3RyaW5nW10sXG4gICAgICBjb250YWluaW5nRmlsZTogc3RyaW5nLFxuICAgICAgcmVkaXJlY3RlZFJlZmVyZW5jZTogdHMuUmVzb2x2ZWRQcm9qZWN0UmVmZXJlbmNlIHwgdW5kZWZpbmVkLFxuICAgICAgb3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuICAgICkge1xuICAgICAgcmV0dXJuIG1vZHVsZU5hbWVzLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZXN1bHQgPSB0cy5yZXNvbHZlVHlwZVJlZmVyZW5jZURpcmVjdGl2ZShcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbnRhaW5pbmdGaWxlLFxuICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgaG9zdCxcbiAgICAgICAgICByZWRpcmVjdGVkUmVmZXJlbmNlLFxuICAgICAgICApLnJlc29sdmVkVHlwZVJlZmVyZW5jZURpcmVjdGl2ZTtcblxuICAgICAgICBpZiAocmVzdWx0ICYmIG5nY2MpIHtcbiAgICAgICAgICBuZ2NjLnByb2Nlc3NNb2R1bGUobmFtZSwgcmVzdWx0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9KTtcbiAgICB9O1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhdWdtZW50SG9zdFdpdGhSZXBsYWNlbWVudHMoXG4gIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgcmVwbGFjZW1lbnRzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICBtb2R1bGVSZXNvbHV0aW9uQ2FjaGU/OiB0cy5Nb2R1bGVSZXNvbHV0aW9uQ2FjaGUsXG4pOiB2b2lkIHtcbiAgaWYgKE9iamVjdC5rZXlzKHJlcGxhY2VtZW50cykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgbm9ybWFsaXplZFJlcGxhY2VtZW50czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhyZXBsYWNlbWVudHMpKSB7XG4gICAgbm9ybWFsaXplZFJlcGxhY2VtZW50c1tub3JtYWxpemVQYXRoKGtleSldID0gbm9ybWFsaXplUGF0aCh2YWx1ZSk7XG4gIH1cblxuICBjb25zdCB0cnlSZXBsYWNlID0gKHJlc29sdmVkTW9kdWxlOiB0cy5SZXNvbHZlZE1vZHVsZSB8IHVuZGVmaW5lZCkgPT4ge1xuICAgIGNvbnN0IHJlcGxhY2VtZW50ID0gcmVzb2x2ZWRNb2R1bGUgJiYgbm9ybWFsaXplZFJlcGxhY2VtZW50c1tyZXNvbHZlZE1vZHVsZS5yZXNvbHZlZEZpbGVOYW1lXTtcbiAgICBpZiAocmVwbGFjZW1lbnQpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHJlc29sdmVkRmlsZU5hbWU6IHJlcGxhY2VtZW50LFxuICAgICAgICBpc0V4dGVybmFsTGlicmFyeUltcG9ydDogL1svXFxcXF1ub2RlX21vZHVsZXNbL1xcXFxdLy50ZXN0KHJlcGxhY2VtZW50KSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiByZXNvbHZlZE1vZHVsZTtcbiAgICB9XG4gIH07XG5cbiAgYXVnbWVudFJlc29sdmVNb2R1bGVOYW1lcyhob3N0LCB0cnlSZXBsYWNlLCBtb2R1bGVSZXNvbHV0aW9uQ2FjaGUpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXVnbWVudEhvc3RXaXRoU3Vic3RpdHV0aW9ucyhcbiAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICBzdWJzdGl0dXRpb25zOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuKTogdm9pZCB7XG4gIGNvbnN0IHJlZ2V4U3Vic3RpdHV0aW9uczogW1JlZ0V4cCwgc3RyaW5nXVtdID0gW107XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHN1YnN0aXR1dGlvbnMpKSB7XG4gICAgcmVnZXhTdWJzdGl0dXRpb25zLnB1c2goW25ldyBSZWdFeHAoYFxcXFxiJHtrZXl9XFxcXGJgLCAnZycpLCB2YWx1ZV0pO1xuICB9XG5cbiAgaWYgKHJlZ2V4U3Vic3RpdHV0aW9ucy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBiYXNlUmVhZEZpbGUgPSBob3N0LnJlYWRGaWxlO1xuICBob3N0LnJlYWRGaWxlID0gZnVuY3Rpb24gKC4uLnBhcmFtZXRlcnMpIHtcbiAgICBsZXQgZmlsZTogc3RyaW5nIHwgdW5kZWZpbmVkID0gYmFzZVJlYWRGaWxlLmNhbGwoaG9zdCwgLi4ucGFyYW1ldGVycyk7XG4gICAgaWYgKGZpbGUpIHtcbiAgICAgIGZvciAoY29uc3QgZW50cnkgb2YgcmVnZXhTdWJzdGl0dXRpb25zKSB7XG4gICAgICAgIGZpbGUgPSBmaWxlLnJlcGxhY2UoZW50cnlbMF0sIGVudHJ5WzFdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmlsZTtcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aFZlcnNpb25pbmcoaG9zdDogdHMuQ29tcGlsZXJIb3N0KTogdm9pZCB7XG4gIGNvbnN0IGJhc2VHZXRTb3VyY2VGaWxlID0gaG9zdC5nZXRTb3VyY2VGaWxlO1xuICBob3N0LmdldFNvdXJjZUZpbGUgPSBmdW5jdGlvbiAoLi4ucGFyYW1ldGVycykge1xuICAgIGNvbnN0IGZpbGU6ICh0cy5Tb3VyY2VGaWxlICYgeyB2ZXJzaW9uPzogc3RyaW5nIH0pIHwgdW5kZWZpbmVkID0gYmFzZUdldFNvdXJjZUZpbGUuY2FsbChcbiAgICAgIGhvc3QsXG4gICAgICAuLi5wYXJhbWV0ZXJzLFxuICAgICk7XG4gICAgaWYgKGZpbGUgJiYgZmlsZS52ZXJzaW9uID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGZpbGUudmVyc2lvbiA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShmaWxlLnRleHQpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGU7XG4gIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhdWdtZW50UHJvZ3JhbVdpdGhWZXJzaW9uaW5nKHByb2dyYW06IHRzLlByb2dyYW0pOiB2b2lkIHtcbiAgY29uc3QgYmFzZUdldFNvdXJjZUZpbGVzID0gcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcztcbiAgcHJvZ3JhbS5nZXRTb3VyY2VGaWxlcyA9IGZ1bmN0aW9uICguLi5wYXJhbWV0ZXJzKSB7XG4gICAgY29uc3QgZmlsZXM6IHJlYWRvbmx5ICh0cy5Tb3VyY2VGaWxlICYgeyB2ZXJzaW9uPzogc3RyaW5nIH0pW10gPSBiYXNlR2V0U291cmNlRmlsZXMoXG4gICAgICAuLi5wYXJhbWV0ZXJzLFxuICAgICk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIGlmIChmaWxlLnZlcnNpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBmaWxlLnZlcnNpb24gPSBjcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoZmlsZS50ZXh0KS5kaWdlc3QoJ2hleCcpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmaWxlcztcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGF1Z21lbnRIb3N0V2l0aENhY2hpbmcoXG4gIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgY2FjaGU6IE1hcDxzdHJpbmcsIHRzLlNvdXJjZUZpbGU+LFxuKTogdm9pZCB7XG4gIGNvbnN0IGJhc2VHZXRTb3VyY2VGaWxlID0gaG9zdC5nZXRTb3VyY2VGaWxlO1xuICBob3N0LmdldFNvdXJjZUZpbGUgPSBmdW5jdGlvbiAoXG4gICAgZmlsZU5hbWUsXG4gICAgbGFuZ3VhZ2VWZXJzaW9uLFxuICAgIG9uRXJyb3IsXG4gICAgc2hvdWxkQ3JlYXRlTmV3U291cmNlRmlsZSxcbiAgICAuLi5wYXJhbWV0ZXJzXG4gICkge1xuICAgIGlmICghc2hvdWxkQ3JlYXRlTmV3U291cmNlRmlsZSAmJiBjYWNoZS5oYXMoZmlsZU5hbWUpKSB7XG4gICAgICByZXR1cm4gY2FjaGUuZ2V0KGZpbGVOYW1lKTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gYmFzZUdldFNvdXJjZUZpbGUuY2FsbChcbiAgICAgIGhvc3QsXG4gICAgICBmaWxlTmFtZSxcbiAgICAgIGxhbmd1YWdlVmVyc2lvbixcbiAgICAgIG9uRXJyb3IsXG4gICAgICB0cnVlLFxuICAgICAgLi4ucGFyYW1ldGVycyxcbiAgICApO1xuXG4gICAgaWYgKGZpbGUpIHtcbiAgICAgIGNhY2hlLnNldChmaWxlTmFtZSwgZmlsZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZpbGU7XG4gIH07XG59XG4iXX0=