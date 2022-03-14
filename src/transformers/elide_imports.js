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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxpZGVfaW1wb3J0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdHJhbnNmb3JtZXJzL2VsaWRlX2ltcG9ydHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwrQ0FBaUM7QUFFakMsOERBQThEO0FBQzlELHdFQUF3RTtBQUN4RSxpRkFBaUY7QUFDakYsa0dBQWtHO0FBQ2xHLHFDQUFxQztBQUNyQyxpRkFBaUY7QUFDakYsU0FBZ0IsWUFBWSxDQUMxQixVQUF5QixFQUN6QixZQUF1QixFQUN2QixjQUFvQyxFQUNwQyxlQUFtQztJQUVuQyxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFXLENBQUM7SUFFOUMsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtRQUM3QixPQUFPLGtCQUFrQixDQUFDO0tBQzNCO0lBRUQsTUFBTSxXQUFXLEdBQUcsY0FBYyxFQUFFLENBQUM7SUFFckMsMkNBQTJDO0lBQzNDLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxFQUFhLENBQUM7SUFDekMsTUFBTSxPQUFPLEdBQTJCLEVBQUUsQ0FBQztJQUUzQyxFQUFFLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxTQUFTLEtBQUssQ0FBQyxJQUFJOztRQUM3QyxzQkFBc0I7UUFDdEIsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFO1lBQy9CLE9BQU87U0FDUjtRQUVELDZDQUE2QztRQUM3QywwREFBMEQ7UUFDMUQscURBQXFEO1FBQ3JELElBQUksRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsRUFBRTtZQUMvRSxPQUFPO1NBQ1I7UUFFRCx5QkFB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R0FBRyxDQUFDLENBQUM7Z0JBQzVCLFlBQVksSUFBSSxhQUFhLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQztnQkFFOUMsS0FBSyxNQUFNLFNBQVMsSUFBSSxhQUFhLENBQUMsUUFBUSxFQUFFO29CQUM5QyxJQUFJLFFBQVEsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUU7d0JBQzVCLG1CQUFtQixFQUFFLENBQUM7d0JBQ3RCLG9GQUFvRjt3QkFDcEYsTUFBTSxZQUFZLEdBQ2hCLFlBQVksS0FBSyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO3dCQUV0RSxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7cUJBQzFDO2lCQUNGO2FBQ0Y7WUFFRCwyQkFBMkI7WUFDM0IsSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRTtnQkFDMUIsWUFBWSxFQUFFLENBQUM7Z0JBRWYsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDcEMscUJBQXFCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUM7aUJBQ3BEO2FBQ0Y7WUFFRCxJQUFJLHFCQUFxQixDQUFDLE1BQU0sS0FBSyxZQUFZLEVBQUU7Z0JBQ2pELGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQzthQUM5QjtpQkFBTTtnQkFDTCxLQUFLLE1BQU0sb0JBQW9CLElBQUkscUJBQXFCLEVBQUU7b0JBQ3hELGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO2lCQUM5QzthQUNGO1NBQ0Y7S0FDRjtJQUVELE9BQU8sa0JBQWtCLENBQUM7QUFDNUIsQ0FBQztBQTFLRCxvQ0EwS0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5cbi8vIFJlbW92ZSBpbXBvcnRzIGZvciB3aGljaCBhbGwgaWRlbnRpZmllcnMgaGF2ZSBiZWVuIHJlbW92ZWQuXG4vLyBOZWVkcyB0eXBlIGNoZWNrZXIsIGFuZCB3b3JrcyBldmVuIGlmIGl0J3Mgbm90IHRoZSBmaXJzdCB0cmFuc2Zvcm1lci5cbi8vIFdvcmtzIGJ5IHJlbW92aW5nIGltcG9ydHMgZm9yIHN5bWJvbHMgd2hvc2UgaWRlbnRpZmllcnMgaGF2ZSBhbGwgYmVlbiByZW1vdmVkLlxuLy8gRG9lc24ndCB1c2UgdGhlIGBzeW1ib2wuZGVjbGFyYXRpb25zYCBiZWNhdXNlIHRoYXQgcHJldmlvdXMgdHJhbnNmb3JtcyBtaWdodCBoYXZlIHJlbW92ZWQgbm9kZXNcbi8vIGJ1dCB0aGUgdHlwZSBjaGVja2VyIGRvZXNuJ3Qga25vdy5cbi8vIFNlZSBodHRwczovL2dpdGh1Yi5jb20vTWljcm9zb2Z0L1R5cGVTY3JpcHQvaXNzdWVzLzE3NTUyIGZvciBtb3JlIGluZm9ybWF0aW9uLlxuZXhwb3J0IGZ1bmN0aW9uIGVsaWRlSW1wb3J0cyhcbiAgc291cmNlRmlsZTogdHMuU291cmNlRmlsZSxcbiAgcmVtb3ZlZE5vZGVzOiB0cy5Ob2RlW10sXG4gIGdldFR5cGVDaGVja2VyOiAoKSA9PiB0cy5UeXBlQ2hlY2tlcixcbiAgY29tcGlsZXJPcHRpb25zOiB0cy5Db21waWxlck9wdGlvbnMsXG4pOiBTZXQ8dHMuTm9kZT4ge1xuICBjb25zdCBpbXBvcnROb2RlUmVtb3ZhbHMgPSBuZXcgU2V0PHRzLk5vZGU+KCk7XG5cbiAgaWYgKHJlbW92ZWROb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gaW1wb3J0Tm9kZVJlbW92YWxzO1xuICB9XG5cbiAgY29uc3QgdHlwZUNoZWNrZXIgPSBnZXRUeXBlQ2hlY2tlcigpO1xuXG4gIC8vIENvbGxlY3QgYWxsIGltcG9ydHMgYW5kIHVzZWQgaWRlbnRpZmllcnNcbiAgY29uc3QgdXNlZFN5bWJvbHMgPSBuZXcgU2V0PHRzLlN5bWJvbD4oKTtcbiAgY29uc3QgaW1wb3J0czogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSA9IFtdO1xuXG4gIHRzLmZvckVhY2hDaGlsZChzb3VyY2VGaWxlLCBmdW5jdGlvbiB2aXNpdChub2RlKSB7XG4gICAgLy8gU2tpcCByZW1vdmVkIG5vZGVzLlxuICAgIGlmIChyZW1vdmVkTm9kZXMuaW5jbHVkZXMobm9kZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25zaWRlciB0eXBlcyBmb3IgJ2ltcGxlbWVudHMnIGFzIHVudXNlZC5cbiAgICAvLyBBIEhlcml0YWdlQ2xhdXNlIHRva2VuIGNhbiBhbHNvIGJlIGFuICdBYnN0cmFjdEtleXdvcmQnXG4gICAgLy8gd2hpY2ggaW4gdGhhdCBjYXNlIHdlIHNob3VsZCBub3QgZWxpZGUgdGhlIGltcG9ydC5cbiAgICBpZiAodHMuaXNIZXJpdGFnZUNsYXVzZShub2RlKSAmJiBub2RlLnRva2VuID09PSB0cy5TeW50YXhLaW5kLkltcGxlbWVudHNLZXl3b3JkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUmVjb3JkIGltcG9ydCBhbmQgc2tpcFxuICAgIGlmICh0cy5pc0ltcG9ydERlY2xhcmF0aW9uKG5vZGUpKSB7XG4gICAgICBpZiAoIW5vZGUuaW1wb3J0Q2xhdXNlPy5pc1R5cGVPbmx5KSB7XG4gICAgICAgIGltcG9ydHMucHVzaChub2RlKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGxldCBzeW1ib2w6IHRzLlN5bWJvbCB8IHVuZGVmaW5lZDtcbiAgICBpZiAodHMuaXNUeXBlUmVmZXJlbmNlTm9kZShub2RlKSkge1xuICAgICAgaWYgKCFjb21waWxlck9wdGlvbnMuZW1pdERlY29yYXRvck1ldGFkYXRhKSB7XG4gICAgICAgIC8vIFNraXAgYW5kIG1hcmsgYXMgdW51c2VkIGlmIGVtaXREZWNvcmF0b3JNZXRhZGF0YSBpcyBkaXNhYmxlZC5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudDtcbiAgICAgIGxldCBpc1R5cGVSZWZlcmVuY2VGb3JEZWNvcmF0b3JlZE5vZGUgPSBmYWxzZTtcblxuICAgICAgc3dpdGNoIChwYXJlbnQua2luZCkge1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuR2V0QWNjZXNzb3I6XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5Qcm9wZXJ0eURlY2xhcmF0aW9uOlxuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuTWV0aG9kRGVjbGFyYXRpb246XG4gICAgICAgICAgaXNUeXBlUmVmZXJlbmNlRm9yRGVjb3JhdG9yZWROb2RlID0gISFwYXJlbnQuZGVjb3JhdG9ycz8ubGVuZ3RoO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuUGFyYW1ldGVyOlxuICAgICAgICAgIC8vIC0gQSBjb25zdHJ1Y3RvciBwYXJhbWV0ZXIgY2FuIGJlIGRlY29yYXRlZCBvciB0aGUgY2xhc3MgaXRzZWxmIGlzIGRlY29yYXRlZC5cbiAgICAgICAgICAvLyAtIFRoZSBwYXJlbnQgb2YgdGhlIHBhcmFtZXRlciBpcyBkZWNvcmF0ZWQgZXhhbXBsZSBhIG1ldGhvZCBkZWNsYXJhdGlvbiBvciBhIHNldCBhY2Nlc3Nvci5cbiAgICAgICAgICAvLyBJbiBhbGwgY2FzZXMgd2UgbmVlZCB0aGUgdHlwZSByZWZlcmVuY2Ugbm90IHRvIGJlIGVsaWRlZC5cbiAgICAgICAgICBpc1R5cGVSZWZlcmVuY2VGb3JEZWNvcmF0b3JlZE5vZGUgPSAhIShcbiAgICAgICAgICAgIHBhcmVudC5kZWNvcmF0b3JzPy5sZW5ndGggfHxcbiAgICAgICAgICAgICh0cy5pc1NldEFjY2Vzc29yKHBhcmVudC5wYXJlbnQpICYmICEhcGFyZW50LnBhcmVudC5kZWNvcmF0b3JzPy5sZW5ndGgpIHx8XG4gICAgICAgICAgICAodHMuaXNDb25zdHJ1Y3RvckRlY2xhcmF0aW9uKHBhcmVudC5wYXJlbnQpICYmXG4gICAgICAgICAgICAgICEhcGFyZW50LnBhcmVudC5wYXJlbnQuZGVjb3JhdG9ycz8ubGVuZ3RoKVxuICAgICAgICAgICk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGlmIChpc1R5cGVSZWZlcmVuY2VGb3JEZWNvcmF0b3JlZE5vZGUpIHtcbiAgICAgICAgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U3ltYm9sQXRMb2NhdGlvbihub2RlLnR5cGVOYW1lKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgc3dpdGNoIChub2RlLmtpbmQpIHtcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLklkZW50aWZpZXI6XG4gICAgICAgICAgY29uc3QgcGFyZW50ID0gbm9kZS5wYXJlbnQ7XG4gICAgICAgICAgaWYgKHBhcmVudCAmJiB0cy5pc1Nob3J0aGFuZFByb3BlcnR5QXNzaWdubWVudChwYXJlbnQpKSB7XG4gICAgICAgICAgICBjb25zdCBzaG9ydGhhbmRTeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTaG9ydGhhbmRBc3NpZ25tZW50VmFsdWVTeW1ib2wocGFyZW50KTtcbiAgICAgICAgICAgIGlmIChzaG9ydGhhbmRTeW1ib2wpIHtcbiAgICAgICAgICAgICAgc3ltYm9sID0gc2hvcnRoYW5kU3ltYm9sO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKG5vZGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSB0cy5TeW50YXhLaW5kLkV4cG9ydFNwZWNpZmllcjpcbiAgICAgICAgICBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRFeHBvcnRTcGVjaWZpZXJMb2NhbFRhcmdldFN5bWJvbChub2RlIGFzIHRzLkV4cG9ydFNwZWNpZmllcik7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5TaG9ydGhhbmRQcm9wZXJ0eUFzc2lnbm1lbnQ6XG4gICAgICAgICAgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U2hvcnRoYW5kQXNzaWdubWVudFZhbHVlU3ltYm9sKG5vZGUpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzeW1ib2wpIHtcbiAgICAgIHVzZWRTeW1ib2xzLmFkZChzeW1ib2wpO1xuICAgIH1cblxuICAgIHRzLmZvckVhY2hDaGlsZChub2RlLCB2aXNpdCk7XG4gIH0pO1xuXG4gIGlmIChpbXBvcnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBpbXBvcnROb2RlUmVtb3ZhbHM7XG4gIH1cblxuICBjb25zdCBpc1VudXNlZCA9IChub2RlOiB0cy5JZGVudGlmaWVyKSA9PiB7XG4gICAgLy8gRG8gbm90IHJlbW92ZSBKU1ggZmFjdG9yeSBpbXBvcnRzXG4gICAgaWYgKG5vZGUudGV4dCA9PT0gY29tcGlsZXJPcHRpb25zLmpzeEZhY3RvcnkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBjb25zdCBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKG5vZGUpO1xuXG4gICAgcmV0dXJuIHN5bWJvbCAmJiAhdXNlZFN5bWJvbHMuaGFzKHN5bWJvbCk7XG4gIH07XG5cbiAgZm9yIChjb25zdCBub2RlIG9mIGltcG9ydHMpIHtcbiAgICBpZiAoIW5vZGUuaW1wb3J0Q2xhdXNlKSB7XG4gICAgICAvLyBcImltcG9ydCAnYWJjJztcIlxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbmFtZWRCaW5kaW5ncyA9IG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWVkQmluZGluZ3M7XG5cbiAgICBpZiAobmFtZWRCaW5kaW5ncyAmJiB0cy5pc05hbWVzcGFjZUltcG9ydChuYW1lZEJpbmRpbmdzKSkge1xuICAgICAgLy8gXCJpbXBvcnQgKiBhcyBYWVogZnJvbSAnYWJjJztcIlxuICAgICAgaWYgKGlzVW51c2VkKG5hbWVkQmluZGluZ3MubmFtZSkpIHtcbiAgICAgICAgaW1wb3J0Tm9kZVJlbW92YWxzLmFkZChub2RlKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3BlY2lmaWVyTm9kZVJlbW92YWxzID0gW107XG4gICAgICBsZXQgY2xhdXNlc0NvdW50ID0gMDtcblxuICAgICAgLy8gXCJpbXBvcnQgeyBYWVosIC4uLiB9IGZyb20gJ2FiYyc7XCJcbiAgICAgIGlmIChuYW1lZEJpbmRpbmdzICYmIHRzLmlzTmFtZWRJbXBvcnRzKG5hbWVkQmluZGluZ3MpKSB7XG4gICAgICAgIGxldCByZW1vdmVkQ2xhdXNlc0NvdW50ID0gMDtcbiAgICAgICAgY2xhdXNlc0NvdW50ICs9IG5hbWVkQmluZGluZ3MuZWxlbWVudHMubGVuZ3RoO1xuXG4gICAgICAgIGZvciAoY29uc3Qgc3BlY2lmaWVyIG9mIG5hbWVkQmluZGluZ3MuZWxlbWVudHMpIHtcbiAgICAgICAgICBpZiAoaXNVbnVzZWQoc3BlY2lmaWVyLm5hbWUpKSB7XG4gICAgICAgICAgICByZW1vdmVkQ2xhdXNlc0NvdW50Kys7XG4gICAgICAgICAgICAvLyBpbiBjYXNlIHdlIGRvbid0IGhhdmUgYW55IG1vcmUgbmFtZWRJbXBvcnRzIHdlIHNob3VsZCByZW1vdmUgdGhlIHBhcmVudCBpZSB0aGUge31cbiAgICAgICAgICAgIGNvbnN0IG5vZGVUb1JlbW92ZSA9XG4gICAgICAgICAgICAgIGNsYXVzZXNDb3VudCA9PT0gcmVtb3ZlZENsYXVzZXNDb3VudCA/IHNwZWNpZmllci5wYXJlbnQgOiBzcGVjaWZpZXI7XG5cbiAgICAgICAgICAgIHNwZWNpZmllck5vZGVSZW1vdmFscy5wdXNoKG5vZGVUb1JlbW92ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFwiaW1wb3J0IFhZWiBmcm9tICdhYmMnO1wiXG4gICAgICBpZiAobm9kZS5pbXBvcnRDbGF1c2UubmFtZSkge1xuICAgICAgICBjbGF1c2VzQ291bnQrKztcblxuICAgICAgICBpZiAoaXNVbnVzZWQobm9kZS5pbXBvcnRDbGF1c2UubmFtZSkpIHtcbiAgICAgICAgICBzcGVjaWZpZXJOb2RlUmVtb3ZhbHMucHVzaChub2RlLmltcG9ydENsYXVzZS5uYW1lKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3BlY2lmaWVyTm9kZVJlbW92YWxzLmxlbmd0aCA9PT0gY2xhdXNlc0NvdW50KSB7XG4gICAgICAgIGltcG9ydE5vZGVSZW1vdmFscy5hZGQobm9kZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHNwZWNpZmllck5vZGVSZW1vdmFsIG9mIHNwZWNpZmllck5vZGVSZW1vdmFscykge1xuICAgICAgICAgIGltcG9ydE5vZGVSZW1vdmFscy5hZGQoc3BlY2lmaWVyTm9kZVJlbW92YWwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGltcG9ydE5vZGVSZW1vdmFscztcbn1cbiJdfQ==