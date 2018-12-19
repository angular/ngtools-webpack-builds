"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
const ts = require("typescript");
const interfaces_1 = require("./interfaces");
// Remove imports for which all identifiers have been removed.
// Needs type checker, and works even if it's not the first transformer.
// Works by removing imports for symbols whose identifiers have all been removed.
// Doesn't use the `symbol.declarations` because that previous transforms might have removed nodes
// but the type checker doesn't know.
// See https://github.com/Microsoft/TypeScript/issues/17552 for more information.
function elideImports(sourceFile, removedNodes, getTypeChecker) {
    const ops = [];
    if (removedNodes.length === 0) {
        return [];
    }
    const typeChecker = getTypeChecker();
    // Collect all imports and used identifiers
    const specialCaseNames = new Set();
    const usedSymbols = new Set();
    const imports = [];
    ts.forEachChild(sourceFile, function visit(node) {
        // Skip removed nodes
        if (removedNodes.includes(node)) {
            return;
        }
        // Record import and skip
        if (ts.isImportDeclaration(node)) {
            imports.push(node);
            return;
        }
        if (ts.isIdentifier(node)) {
            const symbol = typeChecker.getSymbolAtLocation(node);
            if (symbol) {
                usedSymbols.add(symbol);
            }
        }
        else if (ts.isExportSpecifier(node)) {
            // Export specifiers return the non-local symbol from the above
            // so check the name string instead
            specialCaseNames.add((node.propertyName || node.name).text);
            return;
        }
        else if (ts.isShorthandPropertyAssignment(node)) {
            // Shorthand property assignments return the object property's symbol not the import's
            specialCaseNames.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    });
    if (imports.length === 0) {
        return [];
    }
    const isUnused = (node) => {
        if (specialCaseNames.has(node.text)) {
            return false;
        }
        const symbol = typeChecker.getSymbolAtLocation(node);
        return symbol && !usedSymbols.has(symbol);
    };
    for (const node of imports) {
        if (!node.importClause) {
            // "import 'abc';"
            continue;
        }
        if (node.importClause.name) {
            // "import XYZ from 'abc';"
            if (isUnused(node.importClause.name)) {
                ops.push(new interfaces_1.RemoveNodeOperation(sourceFile, node));
            }
        }
        else if (node.importClause.namedBindings
            && ts.isNamespaceImport(node.importClause.namedBindings)) {
            // "import * as XYZ from 'abc';"
            if (isUnused(node.importClause.namedBindings.name)) {
                ops.push(new interfaces_1.RemoveNodeOperation(sourceFile, node));
            }
        }
        else if (node.importClause.namedBindings
            && ts.isNamedImports(node.importClause.namedBindings)) {
            // "import { XYZ, ... } from 'abc';"
            const specifierOps = [];
            for (const specifier of node.importClause.namedBindings.elements) {
                if (isUnused(specifier.name)) {
                    specifierOps.push(new interfaces_1.RemoveNodeOperation(sourceFile, specifier));
                }
            }
            if (specifierOps.length === node.importClause.namedBindings.elements.length) {
                ops.push(new interfaces_1.RemoveNodeOperation(sourceFile, node));
            }
            else {
                ops.push(...specifierOps);
            }
        }
    }
    return ops;
}
exports.elideImports = elideImports;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxpZGVfaW1wb3J0cy5qcyIsInNvdXJjZVJvb3QiOiIuLyIsInNvdXJjZXMiOlsicGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy90cmFuc2Zvcm1lcnMvZWxpZGVfaW1wb3J0cy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOzs7Ozs7R0FNRztBQUNILGlDQUFpQztBQUNqQyw2Q0FBdUU7QUFHdkUsOERBQThEO0FBQzlELHdFQUF3RTtBQUN4RSxpRkFBaUY7QUFDakYsa0dBQWtHO0FBQ2xHLHFDQUFxQztBQUNyQyxpRkFBaUY7QUFDakYsU0FBZ0IsWUFBWSxDQUMxQixVQUF5QixFQUN6QixZQUF1QixFQUN2QixjQUFvQztJQUVwQyxNQUFNLEdBQUcsR0FBeUIsRUFBRSxDQUFDO0lBRXJDLElBQUksWUFBWSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUU7UUFDN0IsT0FBTyxFQUFFLENBQUM7S0FDWDtJQUVELE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxDQUFDO0lBRXJDLDJDQUEyQztJQUMzQyxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxFQUFVLENBQUM7SUFDM0MsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQWEsQ0FBQztJQUN6QyxNQUFNLE9BQU8sR0FBRyxFQUE0QixDQUFDO0lBQzdDLEVBQUUsQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLFNBQVMsS0FBSyxDQUFDLElBQUk7UUFDN0MscUJBQXFCO1FBQ3JCLElBQUksWUFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRTtZQUMvQixPQUFPO1NBQ1I7UUFFRCx5QkFBeUI7UUFDekIsSUFBSSxFQUFFLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDaEMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUVuQixPQUFPO1NBQ1I7UUFFRCxJQUFJLEVBQUUsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDekIsTUFBTSxNQUFNLEdB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RSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksZ0NBQW1CLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7YUFDckQ7aUJBQU07Z0JBQ0wsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLFlBQVksQ0FBQyxDQUFDO2FBQzNCO1NBQ0Y7S0FDRjtJQUVELE9BQU8sR0FBRyxDQUFDO0FBQ2IsQ0FBQztBQW5HRCxvQ0FtR0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIEluYy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IFJlbW92ZU5vZGVPcGVyYXRpb24sIFRyYW5zZm9ybU9wZXJhdGlvbiB9IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5cblxuLy8gUmVtb3ZlIGltcG9ydHMgZm9yIHdoaWNoIGFsbCBpZGVudGlmaWVycyBoYXZlIGJlZW4gcmVtb3ZlZC5cbi8vIE5lZWRzIHR5cGUgY2hlY2tlciwgYW5kIHdvcmtzIGV2ZW4gaWYgaXQncyBub3QgdGhlIGZpcnN0IHRyYW5zZm9ybWVyLlxuLy8gV29ya3MgYnkgcmVtb3ZpbmcgaW1wb3J0cyBmb3Igc3ltYm9scyB3aG9zZSBpZGVudGlmaWVycyBoYXZlIGFsbCBiZWVuIHJlbW92ZWQuXG4vLyBEb2Vzbid0IHVzZSB0aGUgYHN5bWJvbC5kZWNsYXJhdGlvbnNgIGJlY2F1c2UgdGhhdCBwcmV2aW91cyB0cmFuc2Zvcm1zIG1pZ2h0IGhhdmUgcmVtb3ZlZCBub2Rlc1xuLy8gYnV0IHRoZSB0eXBlIGNoZWNrZXIgZG9lc24ndCBrbm93LlxuLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9NaWNyb3NvZnQvVHlwZVNjcmlwdC9pc3N1ZXMvMTc1NTIgZm9yIG1vcmUgaW5mb3JtYXRpb24uXG5leHBvcnQgZnVuY3Rpb24gZWxpZGVJbXBvcnRzKFxuICBzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlLFxuICByZW1vdmVkTm9kZXM6IHRzLk5vZGVbXSxcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuKTogVHJhbnNmb3JtT3BlcmF0aW9uW10ge1xuICBjb25zdCBvcHM6IFRyYW5zZm9ybU9wZXJhdGlvbltdID0gW107XG5cbiAgaWYgKHJlbW92ZWROb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCB0eXBlQ2hlY2tlciA9IGdldFR5cGVDaGVja2VyKCk7XG5cbiAgLy8gQ29sbGVjdCBhbGwgaW1wb3J0cyBhbmQgdXNlZCBpZGVudGlmaWVyc1xuICBjb25zdCBzcGVjaWFsQ2FzZU5hbWVzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHVzZWRTeW1ib2xzID0gbmV3IFNldDx0cy5TeW1ib2w+KCk7XG4gIGNvbnN0IGltcG9ydHMgPSBbXSBhcyB0cy5JbXBvcnREZWNsYXJhdGlvbltdO1xuICB0cy5mb3JFYWNoQ2hpbGQoc291cmNlRmlsZSwgZnVuY3Rpb24gdmlzaXQobm9kZSkge1xuICAgIC8vIFNraXAgcmVtb3ZlZCBub2Rlc1xuICAgIGlmIChyZW1vdmVkTm9kZXMuaW5jbHVkZXMobm9kZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBSZWNvcmQgaW1wb3J0IGFuZCBza2lwXG4gICAgaWYgKHRzLmlzSW1wb3J0RGVjbGFyYXRpb24obm9kZSkpIHtcbiAgICAgIGltcG9ydHMucHVzaChub2RlKTtcblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0cy5pc0lkZW50aWZpZXIobm9kZSkpIHtcbiAgICAgIGNvbnN0IHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFN5bWJvbEF0TG9jYXRpb24obm9kZSk7XG4gICAgICBpZiAoc3ltYm9sKSB7XG4gICAgICAgIHVzZWRTeW1ib2xzLmFkZChzeW1ib2wpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHMuaXNFeHBvcnRTcGVjaWZpZXIobm9kZSkpIHtcbiAgICAgIC8vIEV4cG9ydCBzcGVjaWZpZXJzIHJldHVybiB0aGUgbm9uLWxvY2FsIHN5bWJvbCBmcm9tIHRoZSBhYm92ZVxuICAgICAgLy8gc28gY2hlY2sgdGhlIG5hbWUgc3RyaW5nIGluc3RlYWRcbiAgICAgIHNwZWNpYWxDYXNlTmFtZXMuYWRkKChub2RlLnByb3BlcnR5TmFtZSB8fCBub2RlLm5hbWUpLnRleHQpO1xuXG4gICAgICByZXR1cm47XG4gICAgfSBlbHNlIGlmICh0cy5pc1Nob3J0aGFuZFByb3BlcnR5QXNzaWdubWVudChub2RlKSkge1xuICAgICAgLy8gU2hvcnRoYW5kIHByb3BlcnR5IGFzc2lnbm1lbnRzIHJldHVybiB0aGUgb2JqZWN0IHByb3BlcnR5J3Mgc3ltYm9sIG5vdCB0aGUgaW1wb3J0J3NcbiAgICAgIHNwZWNpYWxDYXNlTmFtZXMuYWRkKG5vZGUubmFtZS50ZXh0KTtcbiAgICB9XG5cbiAgICB0cy5mb3JFYWNoQ2hpbGQobm9kZSwgdmlzaXQpO1xuICB9KTtcblxuICBpZiAoaW1wb3J0cy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCBpc1VudXNlZCA9IChub2RlOiB0cy5JZGVudGlmaWVyKSA9PiB7XG4gICAgaWYgKHNwZWNpYWxDYXNlTmFtZXMuaGFzKG5vZGUudGV4dCkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKG5vZGUpO1xuXG4gICAgcmV0dXJuIHN5bWJvbCAmJiAhdXNlZFN5bWJvbHMuaGFzKHN5bWJvbCk7XG4gIH07XG5cbiAgZm9yIChjb25zdCBub2RlIG9mIGltcG9ydHMpIHtcbiAgICBpZiAoIW5vZGUuaW1wb3J0Q2xhdXNlKSB7XG4gICAgICAvLyBcImltcG9ydCAnYWJjJztcIlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWUpIHtcbiAgICAgIC8vIFwiaW1wb3J0IFhZWiBmcm9tICdhYmMnO1wiXG4gICAgICBpZiAoaXNVbnVzZWQobm9kZS5pbXBvcnRDbGF1c2UubmFtZSkpIHtcbiAgICAgICAgb3BzLnB1c2gobmV3IFJlbW92ZU5vZGVPcGVyYXRpb24oc291cmNlRmlsZSwgbm9kZSkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobm9kZS5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5nc1xuICAgICAgICAgICAgICAgJiYgdHMuaXNOYW1lc3BhY2VJbXBvcnQobm9kZS5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5ncykpIHtcbiAgICAgIC8vIFwiaW1wb3J0ICogYXMgWFlaIGZyb20gJ2FiYyc7XCJcbiAgICAgIGlmIChpc1VudXNlZChub2RlLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzLm5hbWUpKSB7XG4gICAgICAgIG9wcy5wdXNoKG5ldyBSZW1vdmVOb2RlT3BlcmF0aW9uKHNvdXJjZUZpbGUsIG5vZGUpKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3NcbiAgICAgICAgICAgICAgICYmIHRzLmlzTmFtZWRJbXBvcnRzKG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3MpKSB7XG4gICAgICAvLyBcImltcG9ydCB7IFhZWiwgLi4uIH0gZnJvbSAnYWJjJztcIlxuICAgICAgY29uc3Qgc3BlY2lmaWVyT3BzID0gW107XG4gICAgICBmb3IgKGNvbnN0IHNwZWNpZmllciBvZiBub2RlLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzLmVsZW1lbnRzKSB7XG4gICAgICAgIGlmIChpc1VudXNlZChzcGVjaWZpZXIubmFtZSkpIHtcbiAgICAgICAgICBzcGVjaWZpZXJPcHMucHVzaChuZXcgUmVtb3ZlTm9kZU9wZXJhdGlvbihzb3VyY2VGaWxlLCBzcGVjaWZpZXIpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3BlY2lmaWVyT3BzLmxlbmd0aCA9PT0gbm9kZS5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5ncy5lbGVtZW50cy5sZW5ndGgpIHtcbiAgICAgICAgb3BzLnB1c2gobmV3IFJlbW92ZU5vZGVPcGVyYXRpb24oc291cmNlRmlsZSwgbm9kZSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3BzLnB1c2goLi4uc3BlY2lmaWVyT3BzKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gb3BzO1xufVxuIl19