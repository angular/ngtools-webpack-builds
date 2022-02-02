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
exports.elideImports = void 0;
const ts = __importStar(require("typescript"));
// Remove imports for which all identifiers have been removed.
// Needs type checker, and works even if it's not the first transformer.
// Works by removing imports for symbols whose identifiers have all been removed.
// Doesn't use the `symbol.declarations` because that previous transforms might have removed nodes
// but the type checker doesn't know.
// See https://github.com/Microsoft/TypeScript/issues/17552 for more information.
function elideImports(sourceFile, removedNodes, getTypeChecker, compilerOptions) {
    const importNodeRemovals = new Set();
    if (removedNodes.length === 0) {
        return importNodeRemovals;
    }
    const typeChecker = getTypeChecker();
    // Collect all imports and used identifiers
    const usedSymbols = new Set();
    const imports = [];
    ts.forEachChild(sourceFile, function visit(node) {
        var _a, _b, _c, _d, _e;
        // Skip removed nodes.
        if (removedNodes.includes(node)) {
            return;
        }
        // Consider types for 'implements' as unused.
        // A HeritageClause token can also be an 'AbstractKeyword'
        // which in that case we should not elide the import.
        if (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword) {
            return;
        }
        // Record import and skip
        if (ts.isImportDeclaration(node)) {
            if (!((_a = node.importClause) === null || _a === void 0 ? void 0 : _a.isTypeOnly)) {
                imports.push(node);
            }
            return;
        }
        let symbol;
        if (ts.isTypeReferenceNode(node)) {
            if (!compilerOptions.emitDecoratorMetadata) {
                // Skip and mark as unused if emitDecoratorMetadata is disabled.
                return;
            }
            const parent = node.parent;
            let isTypeReferenceForDecoratoredNode = false;
            switch (parent.kind) {
                case ts.SyntaxKind.GetAccessor:
                case ts.SyntaxKind.PropertyDeclaration:
                case ts.SyntaxKind.MethodDeclaration:
                    isTypeReferenceForDecoratoredNode = !!((_b = parent.decorators) === null || _b === void 0 ? void 0 : _b.length);
                    break;
                case ts.SyntaxKind.Parameter:
                    // - A constructor parameter can be decorated or the class itself is decorated.
                    // - The parent of the parameter is decorated example a method declaration or a set accessor.
                    // In all cases we need the type reference not to be elided.
                    isTypeReferenceForDecoratoredNode = !!(((_c = parent.decorators) === null || _c === void 0 ? void 0 : _c.length) ||
                        (ts.isSetAccessor(parent.parent) && !!((_d = parent.parent.decorators) === null || _d === void 0 ? void 0 : _d.length)) ||
                        (ts.isConstructorDeclaration(parent.parent) &&
                            !!((_e = parent.parent.parent.decorators) === null || _e === void 0 ? void 0 : _e.length)));
                    break;
            }
            if (isTypeReferenceForDecoratoredNode) {
                symbol = typeChecker.getSymbolAtLocation(node.typeName);
            }
        }
        else {
            switch (node.kind) {
                case ts.SyntaxKind.Identifier:
                    const parent = node.parent;
                    if (parent && ts.isShorthandPropertyAssignment(parent)) {
                        const shorthandSymbol = typeChecker.getShorthandAssignmentValueSymbol(parent);
                        if (shorthandSymbol) {
                            symbol = shorthandSymbol;
                        }
                    }
                    else {
                        symbol = typeChecker.getSymbolAtLocation(node);
                    }
                    break;
                case ts.SyntaxKind.ExportSpecifier:
                    symbol = typeChecker.getExportSpecifierLocalTargetSymbol(node);
                    break;
                case ts.SyntaxKind.ShorthandPropertyAssignment:
                    symbol = typeChecker.getShorthandAssignmentValueSymbol(node);
                    break;
            }
        }
        if (symbol) {
            usedSymbols.add(symbol);
        }
        ts.forEachChild(node, visit);
    });
    if (imports.length === 0) {
        return importNodeRemovals;
    }
    const isUnused = (node) => {
        // Do not remove JSX factory imports
        if (node.text === compilerOptions.jsxFactory) {
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
        const namedBindings = node.importClause.namedBindings;
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
            // "import * as XYZ from 'abc';"
            if (isUnused(namedBindings.name)) {
                importNodeRemovals.add(node);
            }
        }
        else {
            const specifierNodeRemovals = [];
            let clausesCount = 0;
            // "import { XYZ, ... } from 'abc';"
            if (namedBindings && ts.isNamedImports(namedBindings)) {
                let removedClausesCount = 0;
                clausesCount += namedBindings.elements.length;
                for (const specifier of namedBindings.elements) {
                    if (isUnused(specifier.name)) {
                        removedClausesCount++;
                        // in case we don't have any more namedImports we should remove the parent ie the {}
                        const nodeToRemove = clausesCount === removedClausesCount ? specifier.parent : specifier;
                        specifierNodeRemovals.push(nodeToRemove);
                    }
                }
            }
            // "import XYZ from 'abc';"
            if (node.importClause.name) {
                clausesCount++;
                if (isUnused(node.importClause.name)) {
                    specifierNodeRemovals.push(node.importClause.name);
                }
            }
            if (specifierNodeRemovals.length === clausesCount) {
                importNodeRemovals.add(node);
            }
            else {
                for (const specifierNodeRemoval of specifierNodeRemovals) {
                    importNodeRemovals.add(specifierNodeRemoval);
                }
            }
        }
    }
    return importNodeRemovals;
}
exports.elideImports = elideImports;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxpZGVfaW1wb3J0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdHJhbnNmb3JtZXJzL2VsaWRlX2ltcG9ydHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUVqQyw4REFBOEQ7QUFDOUQsd0VBQXdFO0FBQ3hFLGlGQUFpRjtBQUNqRixrR0FBa0c7QUFDbEcscUNBQXFDO0FBQ3JDLGlGQUFpRjtBQUNqRixTQUFnQixZQUFZLENBQzFCLFVBQXlCLEVBQ3pCLFlBQXVCLEVBQ3ZCLGNBQW9DLEVBQ3BDLGVBQW1DO0lBRW5DLE1BQU0sa0JBQWtCLEdBQUcsSUFBSSxHQUFHLEVBQVcsQ0FBQztJQUU5QyxJQUFJLFlBQVksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO1FBQzdCLE9BQU8sa0JBQWtCLENBQUM7S0FDM0I7SUFFRCxNQUFNLFdBQVcsR0FBRyxjQUFjLEVBQUUsQ0FBQztJQUVyQywyQ0FBMkM7SUFDM0MsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQWEsQ0FBQztJQUN6QyxNQUFNLE9BQU8sR0FBMkIsRUFBRSxDQUFDO0lBRTNDLEVBQUUsQ0FBQyxZQUFZLENBQUMsVUFBVSxFQUFFLFNBQVMsS0FBSyxDQUFDLElBQUk7O1FBQzdDLHNCQUFzQjtRQUN0QixJQUFJLFlBQVksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDL0IsT0FBTztTQUNSO1FBRUQsNkNBQTZDO1FBQzdDLDBEQUEwRDtRQUMxRCxxREFBcUQ7UUFDckQsSUFBSSxFQUFFLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLEtBQUssS0FBSyxFQUFFLENBQUMsVUFBVSxDQUFDLGlCQUFpQixFQUFFO1lBQy9FLE9BQU87U0FDUjtRQUVELHlCQUF5QjtR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LENBQUMsQ0FBQztnQkFDNUIsWUFBWSxJQUFJLGFBQWEsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDO2dCQUU5QyxLQUFLLE1BQU0sU0FBUyxJQUFJLGFBQWEsQ0FBQyxRQUFRLEVBQUU7b0JBQzlDLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsRUFBRTt3QkFDNUIsbUJBQW1CLEVBQUUsQ0FBQzt3QkFDdEIsb0ZBQW9GO3dCQUNwRixNQUFNLFlBQVksR0FDaEIsWUFBWSxLQUFLLG1CQUFtQixDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7d0JBRXRFLHFCQUFxQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQztxQkFDMUM7aUJBQ0Y7YUFDRjtZQUVELDJCQUEyQjtZQUMzQixJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFO2dCQUMxQixZQUFZLEVBQUUsQ0FBQztnQkFFZixJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxFQUFFO29CQUNwQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztpQkFDcEQ7YUFDRjtZQUVELElBQUkscUJBQXFCLENBQUMsTUFBTSxLQUFLLFlBQVksRUFBRTtnQkFDakQsa0JBQWtCLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO2FBQzlCO2lCQUFNO2dCQUNMLEtBQUssTUFBTSxvQkFBb0IsSUFBSSxxQkFBcUIsRUFBRTtvQkFDeEQsa0JBQWtCLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUM7aUJBQzlDO2FBQ0Y7U0FDRjtLQUNGO0lBRUQsT0FBTyxrQkFBa0IsQ0FBQztBQUM1QixDQUFDO0FBMUtELG9DQTBLQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcblxuLy8gUmVtb3ZlIGltcG9ydHMgZm9yIHdoaWNoIGFsbCBpZGVudGlmaWVycyBoYXZlIGJlZW4gcmVtb3ZlZC5cbi8vIE5lZWRzIHR5cGUgY2hlY2tlciwgYW5kIHdvcmtzIGV2ZW4gaWYgaXQncyBub3QgdGhlIGZpcnN0IHRyYW5zZm9ybWVyLlxuLy8gV29ya3MgYnkgcmVtb3ZpbmcgaW1wb3J0cyBmb3Igc3ltYm9scyB3aG9zZSBpZGVudGlmaWVycyBoYXZlIGFsbCBiZWVuIHJlbW92ZWQuXG4vLyBEb2Vzbid0IHVzZSB0aGUgYHN5bWJvbC5kZWNsYXJhdGlvbnNgIGJlY2F1c2UgdGhhdCBwcmV2aW91cyB0cmFuc2Zvcm1zIG1pZ2h0IGhhdmUgcmVtb3ZlZCBub2Rlc1xuLy8gYnV0IHRoZSB0eXBlIGNoZWNrZXIgZG9lc24ndCBrbm93LlxuLy8gU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9NaWNyb3NvZnQvVHlwZVNjcmlwdC9pc3N1ZXMvMTc1NTIgZm9yIG1vcmUgaW5mb3JtYXRpb24uXG5leHBvcnQgZnVuY3Rpb24gZWxpZGVJbXBvcnRzKFxuICBzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlLFxuICByZW1vdmVkTm9kZXM6IHRzLk5vZGVbXSxcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuICBjb21waWxlck9wdGlvbnM6IHRzLkNvbXBpbGVyT3B0aW9ucyxcbik6IFNldDx0cy5Ob2RlPiB7XG4gIGNvbnN0IGltcG9ydE5vZGVSZW1vdmFscyA9IG5ldyBTZXQ8dHMuTm9kZT4oKTtcblxuICBpZiAocmVtb3ZlZE5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBpbXBvcnROb2RlUmVtb3ZhbHM7XG4gIH1cblxuICBjb25zdCB0eXBlQ2hlY2tlciA9IGdldFR5cGVDaGVja2VyKCk7XG5cbiAgLy8gQ29sbGVjdCBhbGwgaW1wb3J0cyBhbmQgdXNlZCBpZGVudGlmaWVyc1xuICBjb25zdCB1c2VkU3ltYm9scyA9IG5ldyBTZXQ8dHMuU3ltYm9sPigpO1xuICBjb25zdCBpbXBvcnRzOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdID0gW107XG5cbiAgdHMuZm9yRWFjaENoaWxkKHNvdXJjZUZpbGUsIGZ1bmN0aW9uIHZpc2l0KG5vZGUpIHtcbiAgICAvLyBTa2lwIHJlbW92ZWQgbm9kZXMuXG4gICAgaWYgKHJlbW92ZWROb2Rlcy5pbmNsdWRlcyhub2RlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENvbnNpZGVyIHR5cGVzIGZvciAnaW1wbGVtZW50cycgYXMgdW51c2VkLlxuICAgIC8vIEEgSGVyaXRhZ2VDbGF1c2UgdG9rZW4gY2FuIGFsc28gYmUgYW4gJ0Fic3RyYWN0S2V5d29yZCdcbiAgICAvLyB3aGljaCBpbiB0aGF0IGNhc2Ugd2Ugc2hvdWxkIG5vdCBlbGlkZSB0aGUgaW1wb3J0LlxuICAgIGlmICh0cy5pc0hlcml0YWdlQ2xhdXNlKG5vZGUpICYmIG5vZGUudG9rZW4gPT09IHRzLlN5bnRheEtpbmQuSW1wbGVtZW50c0tleXdvcmQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBSZWNvcmQgaW1wb3J0IGFuZCBza2lwXG4gICAgaWYgKHRzLmlzSW1wb3J0RGVjbGFyYXRpb24obm9kZSkpIHtcbiAgICAgIGlmICghbm9kZS5pbXBvcnRDbGF1c2U/LmlzVHlwZU9ubHkpIHtcbiAgICAgICAgaW1wb3J0cy5wdXNoKG5vZGUpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IHN5bWJvbDogdHMuU3ltYm9sIHwgdW5kZWZpbmVkO1xuICAgIGlmICh0cy5pc1R5cGVSZWZlcmVuY2VOb2RlKG5vZGUpKSB7XG4gICAgICBpZiAoIWNvbXBpbGVyT3B0aW9ucy5lbWl0RGVjb3JhdG9yTWV0YWRhdGEpIHtcbiAgICAgICAgLy8gU2tpcCBhbmQgbWFyayBhcyB1bnVzZWQgaWYgZW1pdERlY29yYXRvck1ldGFkYXRhIGlzIGRpc2FibGVkLlxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50O1xuICAgICAgbGV0IGlzVHlwZVJlZmVyZW5jZUZvckRlY29yYXRvcmVkTm9kZSA9IGZhbHNlO1xuXG4gICAgICBzd2l0Y2ggKHBhcmVudC5raW5kKSB7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5HZXRBY2Nlc3NvcjpcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLlByb3BlcnR5RGVjbGFyYXRpb246XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5NZXRob2REZWNsYXJhdGlvbjpcbiAgICAgICAgICBpc1R5cGVSZWZlcmVuY2VGb3JEZWNvcmF0b3JlZE5vZGUgPSAhIXBhcmVudC5kZWNvcmF0b3JzPy5sZW5ndGg7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5QYXJhbWV0ZXI6XG4gICAgICAgICAgLy8gLSBBIGNvbnN0cnVjdG9yIHBhcmFtZXRlciBjYW4gYmUgZGVjb3JhdGVkIG9yIHRoZSBjbGFzcyBpdHNlbGYgaXMgZGVjb3JhdGVkLlxuICAgICAgICAgIC8vIC0gVGhlIHBhcmVudCBvZiB0aGUgcGFyYW1ldGVyIGlzIGRlY29yYXRlZCBleGFtcGxlIGEgbWV0aG9kIGRlY2xhcmF0aW9uIG9yIGEgc2V0IGFjY2Vzc29yLlxuICAgICAgICAgIC8vIEluIGFsbCBjYXNlcyB3ZSBuZWVkIHRoZSB0eXBlIHJlZmVyZW5jZSBub3QgdG8gYmUgZWxpZGVkLlxuICAgICAgICAgIGlzVHlwZVJlZmVyZW5jZUZvckRlY29yYXRvcmVkTm9kZSA9ICEhKFxuICAgICAgICAgICAgcGFyZW50LmRlY29yYXRvcnM/Lmxlbmd0aCB8fFxuICAgICAgICAgICAgKHRzLmlzU2V0QWNjZXNzb3IocGFyZW50LnBhcmVudCkgJiYgISFwYXJlbnQucGFyZW50LmRlY29yYXRvcnM/Lmxlbmd0aCkgfHxcbiAgICAgICAgICAgICh0cy5pc0NvbnN0cnVjdG9yRGVjbGFyYXRpb24ocGFyZW50LnBhcmVudCkgJiZcbiAgICAgICAgICAgICAgISFwYXJlbnQucGFyZW50LnBhcmVudC5kZWNvcmF0b3JzPy5sZW5ndGgpXG4gICAgICAgICAgKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKGlzVHlwZVJlZmVyZW5jZUZvckRlY29yYXRvcmVkTm9kZSkge1xuICAgICAgICBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKG5vZGUudHlwZU5hbWUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBzd2l0Y2ggKG5vZGUua2luZCkge1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuSWRlbnRpZmllcjpcbiAgICAgICAgICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgICAgICAgICBpZiAocGFyZW50ICYmIHRzLmlzU2hvcnRoYW5kUHJvcGVydHlBc3NpZ25tZW50KHBhcmVudCkpIHtcbiAgICAgICAgICAgIGNvbnN0IHNob3J0aGFuZFN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFNob3J0aGFuZEFzc2lnbm1lbnRWYWx1ZVN5bWJvbChwYXJlbnQpO1xuICAgICAgICAgICAgaWYgKHNob3J0aGFuZFN5bWJvbCkge1xuICAgICAgICAgICAgICBzeW1ib2wgPSBzaG9ydGhhbmRTeW1ib2w7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFN5bWJvbEF0TG9jYXRpb24obm9kZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuRXhwb3J0U3BlY2lmaWVyOlxuICAgICAgICAgIHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldEV4cG9ydFNwZWNpZmllckxvY2FsVGFyZ2V0U3ltYm9sKG5vZGUgYXMgdHMuRXhwb3J0U3BlY2lmaWVyKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLlNob3J0aGFuZFByb3BlcnR5QXNzaWdubWVudDpcbiAgICAgICAgICBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTaG9ydGhhbmRBc3NpZ25tZW50VmFsdWVTeW1ib2wobm9kZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHN5bWJvbCkge1xuICAgICAgdXNlZFN5bWJvbHMuYWRkKHN5bWJvbCk7XG4gICAgfVxuXG4gICAgdHMuZm9yRWFjaENoaWxkKG5vZGUsIHZpc2l0KTtcbiAgfSk7XG5cbiAgaWYgKGltcG9ydHMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGltcG9ydE5vZGVSZW1vdmFscztcbiAgfVxuXG4gIGNvbnN0IGlzVW51c2VkID0gKG5vZGU6IHRzLklkZW50aWZpZXIpID0+IHtcbiAgICAvLyBEbyBub3QgcmVtb3ZlIEpTWCBmYWN0b3J5IGltcG9ydHNcbiAgICBpZiAobm9kZS50ZXh0ID09PSBjb21waWxlck9wdGlvbnMuanN4RmFjdG9yeSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGNvbnN0IHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFN5bWJvbEF0TG9jYXRpb24obm9kZSk7XG5cbiAgICByZXR1cm4gc3ltYm9sICYmICF1c2VkU3ltYm9scy5oYXMoc3ltYm9sKTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IG5vZGUgb2YgaW1wb3J0cykge1xuICAgIGlmICghbm9kZS5pbXBvcnRDbGF1c2UpIHtcbiAgICAgIC8vIFwiaW1wb3J0ICdhYmMnO1wiXG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lZEJpbmRpbmdzID0gbm9kZS5pbXBvcnRDbGF1c2UubmFtZWRCaW5kaW5ncztcblxuICAgIGlmIChuYW1lZEJpbmRpbmdzICYmIHRzLmlzTmFtZXNwYWNlSW1wb3J0KG5hbWVkQmluZGluZ3MpKSB7XG4gICAgICAvLyBcImltcG9ydCAqIGFzIFhZWiBmcm9tICdhYmMnO1wiXG4gICAgICBpZiAoaXNVbnVzZWQobmFtZWRCaW5kaW5ncy5uYW1lKSkge1xuICAgICAgICBpbXBvcnROb2RlUmVtb3ZhbHMuYWRkKG5vZGUpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzcGVjaWZpZXJOb2RlUmVtb3ZhbHMgPSBbXTtcbiAgICAgIGxldCBjbGF1c2VzQ291bnQgPSAwO1xuXG4gICAgICAvLyBcImltcG9ydCB7IFhZWiwgLi4uIH0gZnJvbSAnYWJjJztcIlxuICAgICAgaWYgKG5hbWVkQmluZGluZ3MgJiYgdHMuaXNOYW1lZEltcG9ydHMobmFtZWRCaW5kaW5ncykpIHtcbiAgICAgICAgbGV0IHJlbW92ZWRDbGF1c2VzQ291bnQgPSAwO1xuICAgICAgICBjbGF1c2VzQ291bnQgKz0gbmFtZWRCaW5kaW5ncy5lbGVtZW50cy5sZW5ndGg7XG5cbiAgICAgICAgZm9yIChjb25zdCBzcGVjaWZpZXIgb2YgbmFtZWRCaW5kaW5ncy5lbGVtZW50cykge1xuICAgICAgICAgIGlmIChpc1VudXNlZChzcGVjaWZpZXIubmFtZSkpIHtcbiAgICAgICAgICAgIHJlbW92ZWRDbGF1c2VzQ291bnQrKztcbiAgICAgICAgICAgIC8vIGluIGNhc2Ugd2UgZG9uJ3QgaGF2ZSBhbnkgbW9yZSBuYW1lZEltcG9ydHMgd2Ugc2hvdWxkIHJlbW92ZSB0aGUgcGFyZW50IGllIHRoZSB7fVxuICAgICAgICAgICAgY29uc3Qgbm9kZVRvUmVtb3ZlID1cbiAgICAgICAgICAgICAgY2xhdXNlc0NvdW50ID09PSByZW1vdmVkQ2xhdXNlc0NvdW50ID8gc3BlY2lmaWVyLnBhcmVudCA6IHNwZWNpZmllcjtcblxuICAgICAgICAgICAgc3BlY2lmaWVyTm9kZVJlbW92YWxzLnB1c2gobm9kZVRvUmVtb3ZlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gXCJpbXBvcnQgWFlaIGZyb20gJ2FiYyc7XCJcbiAgICAgIGlmIChub2RlLmltcG9ydENsYXVzZS5uYW1lKSB7XG4gICAgICAgIGNsYXVzZXNDb3VudCsrO1xuXG4gICAgICAgIGlmIChpc1VudXNlZChub2RlLmltcG9ydENsYXVzZS5uYW1lKSkge1xuICAgICAgICAgIHNwZWNpZmllck5vZGVSZW1vdmFscy5wdXNoKG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChzcGVjaWZpZXJOb2RlUmVtb3ZhbHMubGVuZ3RoID09PSBjbGF1c2VzQ291bnQpIHtcbiAgICAgICAgaW1wb3J0Tm9kZVJlbW92YWxzLmFkZChub2RlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3Qgc3BlY2lmaWVyTm9kZVJlbW92YWwgb2Ygc3BlY2lmaWVyTm9kZVJlbW92YWxzKSB7XG4gICAgICAgICAgaW1wb3J0Tm9kZVJlbW92YWxzLmFkZChzcGVjaWZpZXJOb2RlUmVtb3ZhbCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gaW1wb3J0Tm9kZVJlbW92YWxzO1xufVxuIl19