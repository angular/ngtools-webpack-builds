"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const fs = require("fs");
const path_1 = require("path");
const ts = require("typescript");
const refactor_1 = require("./refactor");
function _recursiveSymbolExportLookup(refactor, symbolName, host, program) {
    // Check this file.
    const hasSymbol = refactor.findAstNodes(null, ts.SyntaxKind.ClassDeclaration)
        .some((cd) => {
        return cd.name != undefined && cd.name.text == symbolName;
    });
    if (hasSymbol) {
        return refactor.fileName;
    }
    // We found the bootstrap variable, now we just need to get where it's imported.
    const exports = refactor.findAstNodes(null, ts.SyntaxKind.ExportDeclaration)
        .map(node => node);
    for (const decl of exports) {
        if (!decl.moduleSpecifier || decl.moduleSpecifier.kind !== ts.SyntaxKind.StringLiteral) {
            continue;
        }
        const modulePath = decl.moduleSpecifier.text;
        const resolvedModule = ts.resolveModuleName(modulePath, refactor.fileName, program.getCompilerOptions(), host);
        if (!resolvedModule.resolvedModule || !resolvedModule.resolvedModule.resolvedFileName) {
            return null;
        }
        const module = resolvedModule.resolvedModule.resolvedFileName;
        if (!decl.exportClause) {
            const moduleRefactor = new refactor_1.TypeScriptFileRefactor(module, host, program);
            const maybeModule = _recursiveSymbolExportLookup(moduleRefactor, symbolName, host, program);
            if (maybeModule) {
                return maybeModule;
            }
            continue;
        }
        const binding = decl.exportClause;
        for (const specifier of binding.elements) {
            if (specifier.name.text == symbolName) {
                // If it's a directory, load its index and recursively lookup.
                if (fs.statSync(module).isDirectory()) {
                    const indexModule = path_1.join(module, 'index.ts');
                    if (fs.existsSync(indexModule)) {
                        const indexRefactor = new refactor_1.TypeScriptFileRefactor(indexModule, host, program);
                        const maybeModule = _recursiveSymbolExportLookup(indexRefactor, symbolName, host, program);
                        if (maybeModule) {
                            return maybeModule;
                        }
                    }
                }
                // Create the source and verify that the symbol is at least a class.
                const source = new refactor_1.TypeScriptFileRefactor(module, host, program);
                const hasSymbol = source.findAstNodes(null, ts.SyntaxKind.ClassDeclaration)
                    .some((cd) => {
                    return cd.name != undefined && cd.name.text == symbolName;
                });
                if (hasSymbol) {
                    return module;
                }
            }
        }
    }
    return null;
}
function _symbolImportLookup(refactor, symbolName, host, program) {
    // We found the bootstrap variable, now we just need to get where it's imported.
    const imports = refactor.findAstNodes(null, ts.SyntaxKind.ImportDeclaration)
        .map(node => node);
    for (const decl of imports) {
        if (!decl.importClause || !decl.moduleSpecifier) {
            continue;
        }
        if (decl.moduleSpecifier.kind !== ts.SyntaxKind.StringLiteral) {
            continue;
        }
        const resolvedModule = ts.resolveModuleName(decl.moduleSpecifier.text, refactor.fileName, program.getCompilerOptions(), host);
        if (!resolvedModule.resolvedModule || !resolvedModule.resolvedModule.resolvedFileName) {
            continue;
        }
        const module = resolvedModule.resolvedModule.resolvedFileName;
        if (decl.importClause.namedBindings
            && decl.importClause.namedBindings.kind == ts.SyntaxKind.NamespaceImport) {
            const binding = decl.importClause.namedBindings;
            if (binding.name.text == symbolName) {
                // This is a default export.
                return module;
            }
        }
        else if (decl.importClause.namedBindings
            && decl.importClause.namedBindings.kind == ts.SyntaxKind.NamedImports) {
            const binding = decl.importClause.namedBindings;
            for (const specifier of binding.elements) {
                if (specifier.name.text == symbolName) {
                    // Create the source and recursively lookup the import.
                    const source = new refactor_1.TypeScriptFileRefactor(module, host, program);
                    const maybeModule = _recursiveSymbolExportLookup(source, symbolName, host, program);
                    if (maybeModule) {
                        return maybeModule;
                    }
                }
            }
        }
    }
    return null;
}
function resolveEntryModuleFromMain(mainPath, host, program) {
    const source = new refactor_1.TypeScriptFileRefactor(mainPath, host, program);
    const bootstrap = source.findAstNodes(source.sourceFile, ts.SyntaxKind.CallExpression, true)
        .map(node => node)
        .filter(call => {
        const access = call.expression;
        return access.kind == ts.SyntaxKind.PropertyAccessExpression
            && access.name.kind == ts.SyntaxKind.Identifier
            && (access.name.text == 'bootstrapModule'
                || access.name.text == 'bootstrapModuleFactory');
    })
        .map(node => node.arguments[0])
        .filter(node => node.kind == ts.SyntaxKind.Identifier);
    if (bootstrap.length != 1) {
        return null;
    }
    const bootstrapSymbolName = bootstrap[0].text;
    const module = _symbolImportLookup(source, bootstrapSymbolName, host, program);
    if (module) {
        return `${module.replace(/\.ts$/, '')}#${bootstrapSymbolName}`;
    }
    // shrug... something bad happened and we couldn't find the import statement.
    throw new Error('Tried to find bootstrap code, but could not. Specify either '
        + 'statically analyzable bootstrap code or pass in an entryModule '
        + 'to the plugins options.');
}
exports.resolveEntryModuleFromMain = resolveEntryModuleFromMain;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50cnlfcmVzb2x2ZXIuanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvZW50cnlfcmVzb2x2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7Ozs7O0dBTUc7QUFDSCx5QkFBeUI7QUFDekIsK0JBQTRCO0FBQzVCLGlDQUFpQztBQUNqQyx5Q0FBb0Q7QUFHcEQsU0FBUyw0QkFBNEIsQ0FBQyxRQUFnQyxFQUNoQyxVQUFrQixFQUNsQixJQUFxQixFQUNyQixPQUFtQjtJQUN2RCxtQkFBbUI7SUFDbkIsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQztTQUMxRSxJQUFJLENBQUMsQ0FBQyxFQUF1QixFQUFFLEVBQUU7UUFDaEMsT0FBTyxFQUFFLENBQUMsSUFBSSxJQUFJLFNBQVMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxVQUFVLENBQUM7SUFDNUQsQ0FBQyxDQUFDLENBQUM7SUFDTCxJQUFJLFNBQVMsRUFBRTtRQUNiLE9BQU8sUUFBUSxDQUFDLFFBQVEsQ0FBQztLQUMxQjtJQUVELGdGQUFnRjtJQUNoRixNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLGlCQUFpQixDQUFDO1NBQ3pFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQTRCLENBQUMsQ0FBQztJQUU3QyxLQUFLLE1BQU0sSUFBSSxJQUFJLE9BQU8sRUFBRTtRQUMxQixJQUFJLENBQUMsSUFBSSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDLElBQUksS0FBSyxFQUFFLENBQUMsVUFBVSxDQUFDLGFBQWEsRUFBRTtZQUN0RixTQUFTO1NBQ1Y7UUFFRCxNQUFNLFVBQVUsR0FBSSxJQUFJLENBQUMsZUFBb0MsQ0FB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QztTQUMvQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7SUFFekQsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTtRQUN6QixPQUFPLElBQUksQ0FBQztLQUNiO0lBQ0QsTUFBTSxtQkFBbUIsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0lBQzlDLE1BQU0sTUFBTSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDL0UsSUFBSSxNQUFNLEVBQUU7UUFDVixPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLElBQUksbUJBQW1CLEVBQUUsQ0FBQztLQUNoRTtJQUVELDZFQUE2RTtJQUM3RSxNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RDtVQUMxRSxpRUFBaUU7VUFDakUseUJBQXlCLENBQUMsQ0FBQztBQUNqQyxDQUFDO0FBL0JELGdFQStCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCB7IGpvaW4gfSBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgVHlwZVNjcmlwdEZpbGVSZWZhY3RvciB9IGZyb20gJy4vcmVmYWN0b3InO1xuXG5cbmZ1bmN0aW9uIF9yZWN1cnNpdmVTeW1ib2xFeHBvcnRMb29rdXAocmVmYWN0b3I6IFR5cGVTY3JpcHRGaWxlUmVmYWN0b3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN5bWJvbE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9ncmFtOiB0cy5Qcm9ncmFtKTogc3RyaW5nIHwgbnVsbCB7XG4gIC8vIENoZWNrIHRoaXMgZmlsZS5cbiAgY29uc3QgaGFzU3ltYm9sID0gcmVmYWN0b3IuZmluZEFzdE5vZGVzKG51bGwsIHRzLlN5bnRheEtpbmQuQ2xhc3NEZWNsYXJhdGlvbilcbiAgICAuc29tZSgoY2Q6IHRzLkNsYXNzRGVjbGFyYXRpb24pID0+IHtcbiAgICAgIHJldHVybiBjZC5uYW1lICE9IHVuZGVmaW5lZCAmJiBjZC5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZTtcbiAgICB9KTtcbiAgaWYgKGhhc1N5bWJvbCkge1xuICAgIHJldHVybiByZWZhY3Rvci5maWxlTmFtZTtcbiAgfVxuXG4gIC8vIFdlIGZvdW5kIHRoZSBib290c3RyYXAgdmFyaWFibGUsIG5vdyB3ZSBqdXN0IG5lZWQgdG8gZ2V0IHdoZXJlIGl0J3MgaW1wb3J0ZWQuXG4gIGNvbnN0IGV4cG9ydHMgPSByZWZhY3Rvci5maW5kQXN0Tm9kZXMobnVsbCwgdHMuU3ludGF4S2luZC5FeHBvcnREZWNsYXJhdGlvbilcbiAgICAubWFwKG5vZGUgPT4gbm9kZSBhcyB0cy5FeHBvcnREZWNsYXJhdGlvbik7XG5cbiAgZm9yIChjb25zdCBkZWNsIG9mIGV4cG9ydHMpIHtcbiAgICBpZiAoIWRlY2wubW9kdWxlU3BlY2lmaWVyIHx8IGRlY2wubW9kdWxlU3BlY2lmaWVyLmtpbmQgIT09IHRzLlN5bnRheEtpbmQuU3RyaW5nTGl0ZXJhbCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlUGF0aCA9IChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgIGNvbnN0IHJlc29sdmVkTW9kdWxlID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUoXG4gICAgICBtb2R1bGVQYXRoLCByZWZhY3Rvci5maWxlTmFtZSwgcHJvZ3JhbS5nZXRDb21waWxlck9wdGlvbnMoKSwgaG9zdCk7XG4gICAgaWYgKCFyZXNvbHZlZE1vZHVsZS5yZXNvbHZlZE1vZHVsZSB8fCAhcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlID0gcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoIWRlY2wuZXhwb3J0Q2xhdXNlKSB7XG4gICAgICBjb25zdCBtb2R1bGVSZWZhY3RvciA9IG5ldyBUeXBlU2NyaXB0RmlsZVJlZmFjdG9yKG1vZHVsZSwgaG9zdCwgcHJvZ3JhbSk7XG4gICAgICBjb25zdCBtYXliZU1vZHVsZSA9IF9yZWN1cnNpdmVTeW1ib2xFeHBvcnRMb29rdXAobW9kdWxlUmVmYWN0b3IsIHN5bWJvbE5hbWUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgaWYgKG1heWJlTW9kdWxlKSB7XG4gICAgICAgIHJldHVybiBtYXliZU1vZHVsZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGJpbmRpbmcgPSBkZWNsLmV4cG9ydENsYXVzZSBhcyB0cy5OYW1lZEV4cG9ydHM7XG4gICAgZm9yIChjb25zdCBzcGVjaWZpZXIgb2YgYmluZGluZy5lbGVtZW50cykge1xuICAgICAgaWYgKHNwZWNpZmllci5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZSkge1xuICAgICAgICAvLyBJZiBpdCdzIGEgZGlyZWN0b3J5LCBsb2FkIGl0cyBpbmRleCBhbmQgcmVjdXJzaXZlbHkgbG9va3VwLlxuICAgICAgICBpZiAoZnMuc3RhdFN5bmMobW9kdWxlKS5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgY29uc3QgaW5kZXhNb2R1bGUgPSBqb2luKG1vZHVsZSwgJ2luZGV4LnRzJyk7XG4gICAgICAgICAgaWYgKGZzLmV4aXN0c1N5bmMoaW5kZXhNb2R1bGUpKSB7XG4gICAgICAgICAgICBjb25zdCBpbmRleFJlZmFjdG9yID0gbmV3IFR5cGVTY3JpcHRGaWxlUmVmYWN0b3IoaW5kZXhNb2R1bGUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgICAgICAgY29uc3QgbWF5YmVNb2R1bGUgPSBfcmVjdXJzaXZlU3ltYm9sRXhwb3J0TG9va3VwKFxuICAgICAgICAgICAgICBpbmRleFJlZmFjdG9yLCBzeW1ib2xOYW1lLCBob3N0LCBwcm9ncmFtKTtcbiAgICAgICAgICAgIGlmIChtYXliZU1vZHVsZSkge1xuICAgICAgICAgICAgICByZXR1cm4gbWF5YmVNb2R1bGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIHRoZSBzb3VyY2UgYW5kIHZlcmlmeSB0aGF0IHRoZSBzeW1ib2wgaXMgYXQgbGVhc3QgYSBjbGFzcy5cbiAgICAgICAgY29uc3Qgc291cmNlID0gbmV3IFR5cGVTY3JpcHRGaWxlUmVmYWN0b3IobW9kdWxlLCBob3N0LCBwcm9ncmFtKTtcbiAgICAgICAgY29uc3QgaGFzU3ltYm9sID0gc291cmNlLmZpbmRBc3ROb2RlcyhudWxsLCB0cy5TeW50YXhLaW5kLkNsYXNzRGVjbGFyYXRpb24pXG4gICAgICAgICAgLnNvbWUoKGNkOiB0cy5DbGFzc0RlY2xhcmF0aW9uKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gY2QubmFtZSAhPSB1bmRlZmluZWQgJiYgY2QubmFtZS50ZXh0ID09IHN5bWJvbE5hbWU7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGhhc1N5bWJvbCkge1xuICAgICAgICAgIHJldHVybiBtb2R1bGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gX3N5bWJvbEltcG9ydExvb2t1cChyZWZhY3RvcjogVHlwZVNjcmlwdEZpbGVSZWZhY3RvcixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3ltYm9sTmFtZTogc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBob3N0OiB0cy5Db21waWxlckhvc3QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2dyYW06IHRzLlByb2dyYW0pOiBzdHJpbmcgfCBudWxsIHtcbiAgLy8gV2UgZm91bmQgdGhlIGJvb3RzdHJhcCB2YXJpYWJsZSwgbm93IHdlIGp1c3QgbmVlZCB0byBnZXQgd2hlcmUgaXQncyBpbXBvcnRlZC5cbiAgY29uc3QgaW1wb3J0cyA9IHJlZmFjdG9yLmZpbmRBc3ROb2RlcyhudWxsLCB0cy5TeW50YXhLaW5kLkltcG9ydERlY2xhcmF0aW9uKVxuICAgIC5tYXAobm9kZSA9PiBub2RlIGFzIHRzLkltcG9ydERlY2xhcmF0aW9uKTtcblxuICBmb3IgKGNvbnN0IGRlY2wgb2YgaW1wb3J0cykge1xuICAgIGlmICghZGVjbC5pbXBvcnRDbGF1c2UgfHwgIWRlY2wubW9kdWxlU3BlY2lmaWVyKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGRlY2wubW9kdWxlU3BlY2lmaWVyLmtpbmQgIT09IHRzLlN5bnRheEtpbmQuU3RyaW5nTGl0ZXJhbCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgcmVzb2x2ZWRNb2R1bGUgPSB0cy5yZXNvbHZlTW9kdWxlTmFtZShcbiAgICAgIChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0LFxuICAgICAgcmVmYWN0b3IuZmlsZU5hbWUsIHByb2dyYW0uZ2V0Q29tcGlsZXJPcHRpb25zKCksIGhvc3QpO1xuICAgIGlmICghcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUgfHwgIXJlc29sdmVkTW9kdWxlLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWUpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG1vZHVsZSA9IHJlc29sdmVkTW9kdWxlLnJlc29sdmVkTW9kdWxlLnJlc29sdmVkRmlsZU5hbWU7XG4gICAgaWYgKGRlY2wuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3NcbiAgICAgICAgJiYgZGVjbC5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5ncy5raW5kID09IHRzLlN5bnRheEtpbmQuTmFtZXNwYWNlSW1wb3J0KSB7XG4gICAgICBjb25zdCBiaW5kaW5nID0gZGVjbC5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5ncyBhcyB0cy5OYW1lc3BhY2VJbXBvcnQ7XG4gICAgICBpZiAoYmluZGluZy5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZSkge1xuICAgICAgICAvLyBUaGlzIGlzIGEgZGVmYXVsdCBleHBvcnQuXG4gICAgICAgIHJldHVybiBtb2R1bGU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChkZWNsLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzXG4gICAgICAgICAgICAgICAmJiBkZWNsLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzLmtpbmQgPT0gdHMuU3ludGF4S2luZC5OYW1lZEltcG9ydHMpIHtcbiAgICAgIGNvbnN0IGJpbmRpbmcgPSBkZWNsLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzIGFzIHRzLk5hbWVkSW1wb3J0cztcbiAgICAgIGZvciAoY29uc3Qgc3BlY2lmaWVyIG9mIGJpbmRpbmcuZWxlbWVudHMpIHtcbiAgICAgICAgaWYgKHNwZWNpZmllci5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZSkge1xuICAgICAgICAgIC8vIENyZWF0ZSB0aGUgc291cmNlIGFuZCByZWN1cnNpdmVseSBsb29rdXAgdGhlIGltcG9ydC5cbiAgICAgICAgICBjb25zdCBzb3VyY2UgPSBuZXcgVHlwZVNjcmlwdEZpbGVSZWZhY3Rvcihtb2R1bGUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgICAgIGNvbnN0IG1heWJlTW9kdWxlID0gX3JlY3Vyc2l2ZVN5bWJvbEV4cG9ydExvb2t1cChzb3VyY2UsIHN5bWJvbE5hbWUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgICAgIGlmIChtYXliZU1vZHVsZSkge1xuICAgICAgICAgICAgcmV0dXJuIG1heWJlTW9kdWxlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZlRW50cnlNb2R1bGVGcm9tTWFpbihtYWluUGF0aDogc3RyaW5nLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9ncmFtOiB0cy5Qcm9ncmFtKTogc3RyaW5nIHwgbnVsbCB7XG4gIGNvbnN0IHNvdXJjZSA9IG5ldyBUeXBlU2NyaXB0RmlsZVJlZmFjdG9yKG1haW5QYXRoLCBob3N0LCBwcm9ncmFtKTtcblxuICBjb25zdCBib290c3RyYXAgPSBzb3VyY2UuZmluZEFzdE5vZGVzKHNvdXJjZS5zb3VyY2VGaWxlLCB0cy5TeW50YXhLaW5kLkNhbGxFeHByZXNzaW9uLCB0cnVlKVxuICAgIC5tYXAobm9kZSA9PiBub2RlIGFzIHRzLkNhbGxFeHByZXNzaW9uKVxuICAgIC5maWx0ZXIoY2FsbCA9PiB7XG4gICAgICBjb25zdCBhY2Nlc3MgPSBjYWxsLmV4cHJlc3Npb24gYXMgdHMuUHJvcGVydHlBY2Nlc3NFeHByZXNzaW9uO1xuXG4gICAgICByZXR1cm4gYWNjZXNzLmtpbmQgPT0gdHMuU3ludGF4S2luZC5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb25cbiAgICAgICAgICAmJiBhY2Nlc3MubmFtZS5raW5kID09IHRzLlN5bnRheEtpbmQuSWRlbnRpZmllclxuICAgICAgICAgICYmIChhY2Nlc3MubmFtZS50ZXh0ID09ICdib290c3RyYXBNb2R1bGUnXG4gICAgICAgICAgICAgIHx8IGFjY2Vzcy5uYW1lLnRleHQgPT0gJ2Jvb3RzdHJhcE1vZHVsZUZhY3RvcnknKTtcbiAgICB9KVxuICAgIC5tYXAobm9kZSA9PiBub2RlLmFyZ3VtZW50c1swXSBhcyB0cy5JZGVudGlmaWVyKVxuICAgIC5maWx0ZXIobm9kZSA9PiBub2RlLmtpbmQgPT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyKTtcblxuICBpZiAoYm9vdHN0cmFwLmxlbmd0aCAhPSAxKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgY29uc3QgYm9vdHN0cmFwU3ltYm9sTmFtZSA9IGJvb3RzdHJhcFswXS50ZXh0O1xuICBjb25zdCBtb2R1bGUgPSBfc3ltYm9sSW1wb3J0TG9va3VwKHNvdXJjZSwgYm9vdHN0cmFwU3ltYm9sTmFtZSwgaG9zdCwgcHJvZ3JhbSk7XG4gIGlmIChtb2R1bGUpIHtcbiAgICByZXR1cm4gYCR7bW9kdWxlLnJlcGxhY2UoL1xcLnRzJC8sICcnKX0jJHtib290c3RyYXBTeW1ib2xOYW1lfWA7XG4gIH1cblxuICAvLyBzaHJ1Zy4uLiBzb21ldGhpbmcgYmFkIGhhcHBlbmVkIGFuZCB3ZSBjb3VsZG4ndCBmaW5kIHRoZSBpbXBvcnQgc3RhdGVtZW50LlxuICB0aHJvdyBuZXcgRXJyb3IoJ1RyaWVkIHRvIGZpbmQgYm9vdHN0cmFwIGNvZGUsIGJ1dCBjb3VsZCBub3QuIFNwZWNpZnkgZWl0aGVyICdcbiAgICArICdzdGF0aWNhbGx5IGFuYWx5emFibGUgYm9vdHN0cmFwIGNvZGUgb3IgcGFzcyBpbiBhbiBlbnRyeU1vZHVsZSAnXG4gICAgKyAndG8gdGhlIHBsdWdpbnMgb3B0aW9ucy4nKTtcbn1cbiJdfQ==