"use strict";
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@angular-devkit/core");
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
                // If it's a file it will return false
                if (host.directoryExists && host.directoryExists(module)) {
                    const indexModule = core_1.join(module, 'index.ts');
                    if (host.fileExists(indexModule)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50cnlfcmVzb2x2ZXIuanMiLCJzb3VyY2VSb290IjoiLi8iLCJzb3VyY2VzIjpbInBhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvZW50cnlfcmVzb2x2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7QUFFSCwrQ0FBa0Q7QUFDbEQsaUNBQWlDO0FBQ2pDLHlDQUFvRDtBQUdwRCxTQUFTLDRCQUE0QixDQUFDLFFBQWdDLEVBQ2hDLFVBQWtCLEVBQ2xCLElBQXFCLEVBQ3JCLE9BQW1CO0lBQ3ZELG1CQUFtQjtJQUNuQixNQUFNLFNBQVMsR0FBRyxRQUFRLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLGdCQUFnQixDQUFDO1NBQzFFLElBQUksQ0FBQyxDQUFDLEVBQXVCLEVBQUUsRUFBRTtRQUNoQyxPQUFPLEVBQUUsQ0FBQyxJQUFJLElBQUksU0FBUyxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLFVBQVUsQ0FBQztJQUM1RCxDQUFDLENBQUMsQ0FBQztJQUNMLElBQUksU0FBUyxFQUFFO1FBQ2IsT0FBTyxRQUFRLENBQUMsUUFBUSxDQUFDO0tBQzFCO0lBRUQsZ0ZBQWdGO0lBQ2hGLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUM7U0FDekUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBNEIsQ0FBQyxDQUFDO0lBRTdDLEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxFQUFFO1FBQzFCLElBQUksQ0FBQyxJQUFJLENBQUMsZUFBZSxJQUFJLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBQyxVQUFVLENBQUMsYUFBYSxFQUFFO1lBQ3RGLFNBQVM7U0FDVjtRQUVELE1BQU0sVUFBVSxHQUFJLElBQUksQ0FBQyxlQUFvQyxDQUFDLElBQUksQ0FBQztR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a0IsQ0FBQztTQUMvQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLENBQUM7SUFFekQsSUFBSSxTQUFTLENBQUMsTUFBTSxJQUFJLENBQUMsRUFBRTtRQUN6QixPQUFPLElBQUksQ0FBQztLQUNiO0lBQ0QsTUFBTSxtQkFBbUIsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0lBQzlDLE1BQU0sTUFBTSxHQUFHLG1CQUFtQixDQUFDLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDL0UsSUFBSSxNQUFNLEVBQUU7UUFDVixPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLElBQUksbUJBQW1CLEVBQUUsQ0FBQztLQUNoRTtJQUVELDZFQUE2RTtJQUM3RSxNQUFNLElBQUksS0FBSyxDQUFDLDhEQUE4RDtVQUMxRSxpRUFBaUU7VUFDakUseUJBQXlCLENBQUMsQ0FBQztBQUNqQyxDQUFDO0FBL0JELGdFQStCQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgSW5jLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0IHsgUGF0aCwgam9pbiB9IGZyb20gJ0Bhbmd1bGFyLWRldmtpdC9jb3JlJztcbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgVHlwZVNjcmlwdEZpbGVSZWZhY3RvciB9IGZyb20gJy4vcmVmYWN0b3InO1xuXG5cbmZ1bmN0aW9uIF9yZWN1cnNpdmVTeW1ib2xFeHBvcnRMb29rdXAocmVmYWN0b3I6IFR5cGVTY3JpcHRGaWxlUmVmYWN0b3IsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN5bWJvbE5hbWU6IHN0cmluZyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9ncmFtOiB0cy5Qcm9ncmFtKTogc3RyaW5nIHwgbnVsbCB7XG4gIC8vIENoZWNrIHRoaXMgZmlsZS5cbiAgY29uc3QgaGFzU3ltYm9sID0gcmVmYWN0b3IuZmluZEFzdE5vZGVzKG51bGwsIHRzLlN5bnRheEtpbmQuQ2xhc3NEZWNsYXJhdGlvbilcbiAgICAuc29tZSgoY2Q6IHRzLkNsYXNzRGVjbGFyYXRpb24pID0+IHtcbiAgICAgIHJldHVybiBjZC5uYW1lICE9IHVuZGVmaW5lZCAmJiBjZC5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZTtcbiAgICB9KTtcbiAgaWYgKGhhc1N5bWJvbCkge1xuICAgIHJldHVybiByZWZhY3Rvci5maWxlTmFtZTtcbiAgfVxuXG4gIC8vIFdlIGZvdW5kIHRoZSBib290c3RyYXAgdmFyaWFibGUsIG5vdyB3ZSBqdXN0IG5lZWQgdG8gZ2V0IHdoZXJlIGl0J3MgaW1wb3J0ZWQuXG4gIGNvbnN0IGV4cG9ydHMgPSByZWZhY3Rvci5maW5kQXN0Tm9kZXMobnVsbCwgdHMuU3ludGF4S2luZC5FeHBvcnREZWNsYXJhdGlvbilcbiAgICAubWFwKG5vZGUgPT4gbm9kZSBhcyB0cy5FeHBvcnREZWNsYXJhdGlvbik7XG5cbiAgZm9yIChjb25zdCBkZWNsIG9mIGV4cG9ydHMpIHtcbiAgICBpZiAoIWRlY2wubW9kdWxlU3BlY2lmaWVyIHx8IGRlY2wubW9kdWxlU3BlY2lmaWVyLmtpbmQgIT09IHRzLlN5bnRheEtpbmQuU3RyaW5nTGl0ZXJhbCkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlUGF0aCA9IChkZWNsLm1vZHVsZVNwZWNpZmllciBhcyB0cy5TdHJpbmdMaXRlcmFsKS50ZXh0O1xuICAgIGNvbnN0IHJlc29sdmVkTW9kdWxlID0gdHMucmVzb2x2ZU1vZHVsZU5hbWUoXG4gICAgICBtb2R1bGVQYXRoLCByZWZhY3Rvci5maWxlTmFtZSwgcHJvZ3JhbS5nZXRDb21waWxlck9wdGlvbnMoKSwgaG9zdCk7XG4gICAgaWYgKCFyZXNvbHZlZE1vZHVsZS5yZXNvbHZlZE1vZHVsZSB8fCAhcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZSkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlID0gcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoIWRlY2wuZXhwb3J0Q2xhdXNlKSB7XG4gICAgICBjb25zdCBtb2R1bGVSZWZhY3RvciA9IG5ldyBUeXBlU2NyaXB0RmlsZVJlZmFjdG9yKG1vZHVsZSwgaG9zdCwgcHJvZ3JhbSk7XG4gICAgICBjb25zdCBtYXliZU1vZHVsZSA9IF9yZWN1cnNpdmVTeW1ib2xFeHBvcnRMb29rdXAobW9kdWxlUmVmYWN0b3IsIHN5bWJvbE5hbWUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgaWYgKG1heWJlTW9kdWxlKSB7XG4gICAgICAgIHJldHVybiBtYXliZU1vZHVsZTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGJpbmRpbmcgPSBkZWNsLmV4cG9ydENsYXVzZSBhcyB0cy5OYW1lZEV4cG9ydHM7XG4gICAgZm9yIChjb25zdCBzcGVjaWZpZXIgb2YgYmluZGluZy5lbGVtZW50cykge1xuICAgICAgaWYgKHNwZWNpZmllci5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZSkge1xuICAgICAgICAvLyBJZiBpdCdzIGEgZGlyZWN0b3J5LCBsb2FkIGl0cyBpbmRleCBhbmQgcmVjdXJzaXZlbHkgbG9va3VwLlxuICAgICAgICAvLyBJZiBpdCdzIGEgZmlsZSBpdCB3aWxsIHJldHVybiBmYWxzZVxuICAgICAgICBpZiAoaG9zdC5kaXJlY3RvcnlFeGlzdHMgJiYgaG9zdC5kaXJlY3RvcnlFeGlzdHMobW9kdWxlKSkge1xuICAgICAgICAgIGNvbnN0IGluZGV4TW9kdWxlID0gam9pbihtb2R1bGUgYXMgUGF0aCwgJ2luZGV4LnRzJyk7XG4gICAgICAgICAgaWYgKGhvc3QuZmlsZUV4aXN0cyhpbmRleE1vZHVsZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGluZGV4UmVmYWN0b3IgPSBuZXcgVHlwZVNjcmlwdEZpbGVSZWZhY3RvcihpbmRleE1vZHVsZSwgaG9zdCwgcHJvZ3JhbSk7XG4gICAgICAgICAgICBjb25zdCBtYXliZU1vZHVsZSA9IF9yZWN1cnNpdmVTeW1ib2xFeHBvcnRMb29rdXAoXG4gICAgICAgICAgICAgIGluZGV4UmVmYWN0b3IsIHN5bWJvbE5hbWUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgICAgICAgaWYgKG1heWJlTW9kdWxlKSB7XG4gICAgICAgICAgICAgIHJldHVybiBtYXliZU1vZHVsZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgdGhlIHNvdXJjZSBhbmQgdmVyaWZ5IHRoYXQgdGhlIHN5bWJvbCBpcyBhdCBsZWFzdCBhIGNsYXNzLlxuICAgICAgICBjb25zdCBzb3VyY2UgPSBuZXcgVHlwZVNjcmlwdEZpbGVSZWZhY3Rvcihtb2R1bGUsIGhvc3QsIHByb2dyYW0pO1xuICAgICAgICBjb25zdCBoYXNTeW1ib2wgPSBzb3VyY2UuZmluZEFzdE5vZGVzKG51bGwsIHRzLlN5bnRheEtpbmQuQ2xhc3NEZWNsYXJhdGlvbilcbiAgICAgICAgICAuc29tZSgoY2Q6IHRzLkNsYXNzRGVjbGFyYXRpb24pID0+IHtcbiAgICAgICAgICAgIHJldHVybiBjZC5uYW1lICE9IHVuZGVmaW5lZCAmJiBjZC5uYW1lLnRleHQgPT0gc3ltYm9sTmFtZTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBpZiAoaGFzU3ltYm9sKSB7XG4gICAgICAgICAgcmV0dXJuIG1vZHVsZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBfc3ltYm9sSW1wb3J0TG9va3VwKHJlZmFjdG9yOiBUeXBlU2NyaXB0RmlsZVJlZmFjdG9yLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzeW1ib2xOYW1lOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhvc3Q6IHRzLkNvbXBpbGVySG9zdCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvZ3JhbTogdHMuUHJvZ3JhbSk6IHN0cmluZyB8IG51bGwge1xuICAvLyBXZSBmb3VuZCB0aGUgYm9vdHN0cmFwIHZhcmlhYmxlLCBub3cgd2UganVzdCBuZWVkIHRvIGdldCB3aGVyZSBpdCdzIGltcG9ydGVkLlxuICBjb25zdCBpbXBvcnRzID0gcmVmYWN0b3IuZmluZEFzdE5vZGVzKG51bGwsIHRzLlN5bnRheEtpbmQuSW1wb3J0RGVjbGFyYXRpb24pXG4gICAgLm1hcChub2RlID0+IG5vZGUgYXMgdHMuSW1wb3J0RGVjbGFyYXRpb24pO1xuXG4gIGZvciAoY29uc3QgZGVjbCBvZiBpbXBvcnRzKSB7XG4gICAgaWYgKCFkZWNsLmltcG9ydENsYXVzZSB8fCAhZGVjbC5tb2R1bGVTcGVjaWZpZXIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZGVjbC5tb2R1bGVTcGVjaWZpZXIua2luZCAhPT0gdHMuU3ludGF4S2luZC5TdHJpbmdMaXRlcmFsKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZE1vZHVsZSA9IHRzLnJlc29sdmVNb2R1bGVOYW1lKFxuICAgICAgKGRlY2wubW9kdWxlU3BlY2lmaWVyIGFzIHRzLlN0cmluZ0xpdGVyYWwpLnRleHQsXG4gICAgICByZWZhY3Rvci5maWxlTmFtZSwgcHJvZ3JhbS5nZXRDb21waWxlck9wdGlvbnMoKSwgaG9zdCk7XG4gICAgaWYgKCFyZXNvbHZlZE1vZHVsZS5yZXNvbHZlZE1vZHVsZSB8fCAhcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbW9kdWxlID0gcmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRNb2R1bGUucmVzb2x2ZWRGaWxlTmFtZTtcbiAgICBpZiAoZGVjbC5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5nc1xuICAgICAgICAmJiBkZWNsLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzLmtpbmQgPT0gdHMuU3ludGF4S2luZC5OYW1lc3BhY2VJbXBvcnQpIHtcbiAgICAgIGNvbnN0IGJpbmRpbmcgPSBkZWNsLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzIGFzIHRzLk5hbWVzcGFjZUltcG9ydDtcbiAgICAgIGlmIChiaW5kaW5nLm5hbWUudGV4dCA9PSBzeW1ib2xOYW1lKSB7XG4gICAgICAgIC8vIFRoaXMgaXMgYSBkZWZhdWx0IGV4cG9ydC5cbiAgICAgICAgcmV0dXJuIG1vZHVsZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGRlY2wuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3NcbiAgICAgICAgICAgICAgICYmIGRlY2wuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3Mua2luZCA9PSB0cy5TeW50YXhLaW5kLk5hbWVkSW1wb3J0cykge1xuICAgICAgY29uc3QgYmluZGluZyA9IGRlY2wuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3MgYXMgdHMuTmFtZWRJbXBvcnRzO1xuICAgICAgZm9yIChjb25zdCBzcGVjaWZpZXIgb2YgYmluZGluZy5lbGVtZW50cykge1xuICAgICAgICBpZiAoc3BlY2lmaWVyLm5hbWUudGV4dCA9PSBzeW1ib2xOYW1lKSB7XG4gICAgICAgICAgLy8gQ3JlYXRlIHRoZSBzb3VyY2UgYW5kIHJlY3Vyc2l2ZWx5IGxvb2t1cCB0aGUgaW1wb3J0LlxuICAgICAgICAgIGNvbnN0IHNvdXJjZSA9IG5ldyBUeXBlU2NyaXB0RmlsZVJlZmFjdG9yKG1vZHVsZSwgaG9zdCwgcHJvZ3JhbSk7XG4gICAgICAgICAgY29uc3QgbWF5YmVNb2R1bGUgPSBfcmVjdXJzaXZlU3ltYm9sRXhwb3J0TG9va3VwKHNvdXJjZSwgc3ltYm9sTmFtZSwgaG9zdCwgcHJvZ3JhbSk7XG4gICAgICAgICAgaWYgKG1heWJlTW9kdWxlKSB7XG4gICAgICAgICAgICByZXR1cm4gbWF5YmVNb2R1bGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVFbnRyeU1vZHVsZUZyb21NYWluKG1haW5QYXRoOiBzdHJpbmcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaG9zdDogdHMuQ29tcGlsZXJIb3N0LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2dyYW06IHRzLlByb2dyYW0pOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3Qgc291cmNlID0gbmV3IFR5cGVTY3JpcHRGaWxlUmVmYWN0b3IobWFpblBhdGgsIGhvc3QsIHByb2dyYW0pO1xuXG4gIGNvbnN0IGJvb3RzdHJhcCA9IHNvdXJjZS5maW5kQXN0Tm9kZXMoc291cmNlLnNvdXJjZUZpbGUsIHRzLlN5bnRheEtpbmQuQ2FsbEV4cHJlc3Npb24sIHRydWUpXG4gICAgLm1hcChub2RlID0+IG5vZGUgYXMgdHMuQ2FsbEV4cHJlc3Npb24pXG4gICAgLmZpbHRlcihjYWxsID0+IHtcbiAgICAgIGNvbnN0IGFjY2VzcyA9IGNhbGwuZXhwcmVzc2lvbiBhcyB0cy5Qcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb247XG5cbiAgICAgIHJldHVybiBhY2Nlc3Mua2luZCA9PSB0cy5TeW50YXhLaW5kLlByb3BlcnR5QWNjZXNzRXhwcmVzc2lvblxuICAgICAgICAgICYmIGFjY2Vzcy5uYW1lLmtpbmQgPT0gdHMuU3ludGF4S2luZC5JZGVudGlmaWVyXG4gICAgICAgICAgJiYgKGFjY2Vzcy5uYW1lLnRleHQgPT0gJ2Jvb3RzdHJhcE1vZHVsZSdcbiAgICAgICAgICAgICAgfHwgYWNjZXNzLm5hbWUudGV4dCA9PSAnYm9vdHN0cmFwTW9kdWxlRmFjdG9yeScpO1xuICAgIH0pXG4gICAgLm1hcChub2RlID0+IG5vZGUuYXJndW1lbnRzWzBdIGFzIHRzLklkZW50aWZpZXIpXG4gICAgLmZpbHRlcihub2RlID0+IG5vZGUua2luZCA9PSB0cy5TeW50YXhLaW5kLklkZW50aWZpZXIpO1xuXG4gIGlmIChib290c3RyYXAubGVuZ3RoICE9IDEpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBjb25zdCBib290c3RyYXBTeW1ib2xOYW1lID0gYm9vdHN0cmFwWzBdLnRleHQ7XG4gIGNvbnN0IG1vZHVsZSA9IF9zeW1ib2xJbXBvcnRMb29rdXAoc291cmNlLCBib290c3RyYXBTeW1ib2xOYW1lLCBob3N0LCBwcm9ncmFtKTtcbiAgaWYgKG1vZHVsZSkge1xuICAgIHJldHVybiBgJHttb2R1bGUucmVwbGFjZSgvXFwudHMkLywgJycpfSMke2Jvb3RzdHJhcFN5bWJvbE5hbWV9YDtcbiAgfVxuXG4gIC8vIHNocnVnLi4uIHNvbWV0aGluZyBiYWQgaGFwcGVuZWQgYW5kIHdlIGNvdWxkbid0IGZpbmQgdGhlIGltcG9ydCBzdGF0ZW1lbnQuXG4gIHRocm93IG5ldyBFcnJvcignVHJpZWQgdG8gZmluZCBib290c3RyYXAgY29kZSwgYnV0IGNvdWxkIG5vdC4gU3BlY2lmeSBlaXRoZXIgJ1xuICAgICsgJ3N0YXRpY2FsbHkgYW5hbHl6YWJsZSBib290c3RyYXAgY29kZSBvciBwYXNzIGluIGFuIGVudHJ5TW9kdWxlICdcbiAgICArICd0byB0aGUgcGx1Z2lucyBvcHRpb25zLicpO1xufVxuIl19