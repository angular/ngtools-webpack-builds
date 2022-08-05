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
        var _a;
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
        if (!ts.isTypeReferenceNode(node)) {
            let symbol;
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
            if (symbol) {
                usedSymbols.add(symbol);
            }
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
                    if (specifier.isTypeOnly || isUnused(specifier.name)) {
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
                if (node.importClause.isTypeOnly || isUnused(node.importClause.name)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWxpZGVfaW1wb3J0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdHJhbnNmb3JtZXJzL2VsaWRlX2ltcG9ydHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwrQ0FBaUM7QUFFakMsOERBQThEO0FBQzlELHdFQUF3RTtBQUN4RSxpRkFBaUY7QUFDakYsa0dBQWtHO0FBQ2xHLHFDQUFxQztBQUNyQyxpRkFBaUY7QUFDakYsU0FBZ0IsWUFBWSxDQUMxQixVQUF5QixFQUN6QixZQUF1QixFQUN2QixjQUFvQyxFQUNwQyxlQUFtQztJQUVuQyxNQUFNLGtCQUFrQixHQUFHLElBQUksR0FBRyxFQUFXLENBQUM7SUFFOUMsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRTtRQUM3QixPQUFPLGtCQUFrQixDQUFDO0tBQzNCO0lBRUQsTUFBTSxXQUFXLEdBQUcsY0FBYyxFQUFFLENBQUM7SUFFckMsMkNBQTJDO0lBQzNDLE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxFQUFhLENBQUM7SUFDekMsTUFBTSxPQUFPLEdBQTJCLEVBQUUsQ0FBQztJQUUzQyxFQUFFLENBQUMsWUFBWSxDQUFDLFVBQVUsRUFBRSxTQUFTLEtBQUssQ0FBQyxJQUFJOztRQUM3QyxzQkFBc0I7UUFDdEIsSUFBSSxZQUFZLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFO1lBQy9CLE9BQU87U0FDUjtRQUVELDZDQUE2QztRQUM3QywwREFBMEQ7UUFDMUQscURBQXFEO1FBQ3JELElBQUksRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssRUFBRSxDQUFDLFVBQVUsQ0FBQyxpQkFBaUIsRUFBRTtZQUMvRSxPQUFPO1NBQ1I7UUFFRCx5QkFB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ZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuXG4vLyBSZW1vdmUgaW1wb3J0cyBmb3Igd2hpY2ggYWxsIGlkZW50aWZpZXJzIGhhdmUgYmVlbiByZW1vdmVkLlxuLy8gTmVlZHMgdHlwZSBjaGVja2VyLCBhbmQgd29ya3MgZXZlbiBpZiBpdCdzIG5vdCB0aGUgZmlyc3QgdHJhbnNmb3JtZXIuXG4vLyBXb3JrcyBieSByZW1vdmluZyBpbXBvcnRzIGZvciBzeW1ib2xzIHdob3NlIGlkZW50aWZpZXJzIGhhdmUgYWxsIGJlZW4gcmVtb3ZlZC5cbi8vIERvZXNuJ3QgdXNlIHRoZSBgc3ltYm9sLmRlY2xhcmF0aW9uc2AgYmVjYXVzZSB0aGF0IHByZXZpb3VzIHRyYW5zZm9ybXMgbWlnaHQgaGF2ZSByZW1vdmVkIG5vZGVzXG4vLyBidXQgdGhlIHR5cGUgY2hlY2tlciBkb2Vzbid0IGtub3cuXG4vLyBTZWUgaHR0cHM6Ly9naXRodWIuY29tL01pY3Jvc29mdC9UeXBlU2NyaXB0L2lzc3Vlcy8xNzU1MiBmb3IgbW9yZSBpbmZvcm1hdGlvbi5cbmV4cG9ydCBmdW5jdGlvbiBlbGlkZUltcG9ydHMoXG4gIHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUsXG4gIHJlbW92ZWROb2RlczogdHMuTm9kZVtdLFxuICBnZXRUeXBlQ2hlY2tlcjogKCkgPT4gdHMuVHlwZUNoZWNrZXIsXG4gIGNvbXBpbGVyT3B0aW9uczogdHMuQ29tcGlsZXJPcHRpb25zLFxuKTogU2V0PHRzLk5vZGU+IHtcbiAgY29uc3QgaW1wb3J0Tm9kZVJlbW92YWxzID0gbmV3IFNldDx0cy5Ob2RlPigpO1xuXG4gIGlmIChyZW1vdmVkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGltcG9ydE5vZGVSZW1vdmFscztcbiAgfVxuXG4gIGNvbnN0IHR5cGVDaGVja2VyID0gZ2V0VHlwZUNoZWNrZXIoKTtcblxuICAvLyBDb2xsZWN0IGFsbCBpbXBvcnRzIGFuZCB1c2VkIGlkZW50aWZpZXJzXG4gIGNvbnN0IHVzZWRTeW1ib2xzID0gbmV3IFNldDx0cy5TeW1ib2w+KCk7XG4gIGNvbnN0IGltcG9ydHM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10gPSBbXTtcblxuICB0cy5mb3JFYWNoQ2hpbGQoc291cmNlRmlsZSwgZnVuY3Rpb24gdmlzaXQobm9kZSkge1xuICAgIC8vIFNraXAgcmVtb3ZlZCBub2Rlcy5cbiAgICBpZiAocmVtb3ZlZE5vZGVzLmluY2x1ZGVzKG5vZGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQ29uc2lkZXIgdHlwZXMgZm9yICdpbXBsZW1lbnRzJyBhcyB1bnVzZWQuXG4gICAgLy8gQSBIZXJpdGFnZUNsYXVzZSB0b2tlbiBjYW4gYWxzbyBiZSBhbiAnQWJzdHJhY3RLZXl3b3JkJ1xuICAgIC8vIHdoaWNoIGluIHRoYXQgY2FzZSB3ZSBzaG91bGQgbm90IGVsaWRlIHRoZSBpbXBvcnQuXG4gICAgaWYgKHRzLmlzSGVyaXRhZ2VDbGF1c2Uobm9kZSkgJiYgbm9kZS50b2tlbiA9PT0gdHMuU3ludGF4S2luZC5JbXBsZW1lbnRzS2V5d29yZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFJlY29yZCBpbXBvcnQgYW5kIHNraXBcbiAgICBpZiAodHMuaXNJbXBvcnREZWNsYXJhdGlvbihub2RlKSkge1xuICAgICAgaWYgKCFub2RlLmltcG9ydENsYXVzZT8uaXNUeXBlT25seSkge1xuICAgICAgICBpbXBvcnRzLnB1c2gobm9kZSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRzLmlzVHlwZVJlZmVyZW5jZU5vZGUobm9kZSkpIHtcbiAgICAgIGxldCBzeW1ib2w6IHRzLlN5bWJvbCB8IHVuZGVmaW5lZDtcbiAgICAgIHN3aXRjaCAobm9kZS5raW5kKSB7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5JZGVudGlmaWVyOlxuICAgICAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50O1xuICAgICAgICAgIGlmIChwYXJlbnQgJiYgdHMuaXNTaG9ydGhhbmRQcm9wZXJ0eUFzc2lnbm1lbnQocGFyZW50KSkge1xuICAgICAgICAgICAgY29uc3Qgc2hvcnRoYW5kU3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U2hvcnRoYW5kQXNzaWdubWVudFZhbHVlU3ltYm9sKHBhcmVudCk7XG4gICAgICAgICAgICBpZiAoc2hvcnRoYW5kU3ltYm9sKSB7XG4gICAgICAgICAgICAgIHN5bWJvbCA9IHNob3J0aGFuZFN5bWJvbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U3ltYm9sQXRMb2NhdGlvbihub2RlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgdHMuU3ludGF4S2luZC5FeHBvcnRTcGVjaWZpZXI6XG4gICAgICAgICAgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0RXhwb3J0U3BlY2lmaWVyTG9jYWxUYXJnZXRTeW1ib2wobm9kZSBhcyB0cy5FeHBvcnRTcGVjaWZpZXIpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIHRzLlN5bnRheEtpbmQuU2hvcnRoYW5kUHJvcGVydHlBc3NpZ25tZW50OlxuICAgICAgICAgIHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFNob3J0aGFuZEFzc2lnbm1lbnRWYWx1ZVN5bWJvbChub2RlKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgaWYgKHN5bWJvbCkge1xuICAgICAgICB1c2VkU3ltYm9scy5hZGQoc3ltYm9sKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cy5mb3JFYWNoQ2hpbGQobm9kZSwgdmlzaXQpO1xuICB9KTtcblxuICBpZiAoaW1wb3J0cy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gaW1wb3J0Tm9kZVJlbW92YWxzO1xuICB9XG5cbiAgY29uc3QgaXNVbnVzZWQgPSAobm9kZTogdHMuSWRlbnRpZmllcikgPT4ge1xuICAgIC8vIERvIG5vdCByZW1vdmUgSlNYIGZhY3RvcnkgaW1wb3J0c1xuICAgIGlmIChub2RlLnRleHQgPT09IGNvbXBpbGVyT3B0aW9ucy5qc3hGYWN0b3J5KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgY29uc3Qgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U3ltYm9sQXRMb2NhdGlvbihub2RlKTtcblxuICAgIHJldHVybiBzeW1ib2wgJiYgIXVzZWRTeW1ib2xzLmhhcyhzeW1ib2wpO1xuICB9O1xuXG4gIGZvciAoY29uc3Qgbm9kZSBvZiBpbXBvcnRzKSB7XG4gICAgaWYgKCFub2RlLmltcG9ydENsYXVzZSkge1xuICAgICAgLy8gXCJpbXBvcnQgJ2FiYyc7XCJcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IG5hbWVkQmluZGluZ3MgPSBub2RlLmltcG9ydENsYXVzZS5uYW1lZEJpbmRpbmdzO1xuXG4gICAgaWYgKG5hbWVkQmluZGluZ3MgJiYgdHMuaXNOYW1lc3BhY2VJbXBvcnQobmFtZWRCaW5kaW5ncykpIHtcbiAgICAgIC8vIFwiaW1wb3J0ICogYXMgWFlaIGZyb20gJ2FiYyc7XCJcbiAgICAgIGlmIChpc1VudXNlZChuYW1lZEJpbmRpbmdzLm5hbWUpKSB7XG4gICAgICAgIGltcG9ydE5vZGVSZW1vdmFscy5hZGQobm9kZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHNwZWNpZmllck5vZGVSZW1vdmFscyA9IFtdO1xuICAgICAgbGV0IGNsYXVzZXNDb3VudCA9IDA7XG5cbiAgICAgIC8vIFwiaW1wb3J0IHsgWFlaLCAuLi4gfSBmcm9tICdhYmMnO1wiXG4gICAgICBpZiAobmFtZWRCaW5kaW5ncyAmJiB0cy5pc05hbWVkSW1wb3J0cyhuYW1lZEJpbmRpbmdzKSkge1xuICAgICAgICBsZXQgcmVtb3ZlZENsYXVzZXNDb3VudCA9IDA7XG4gICAgICAgIGNsYXVzZXNDb3VudCArPSBuYW1lZEJpbmRpbmdzLmVsZW1lbnRzLmxlbmd0aDtcblxuICAgICAgICBmb3IgKGNvbnN0IHNwZWNpZmllciBvZiBuYW1lZEJpbmRpbmdzLmVsZW1lbnRzKSB7XG4gICAgICAgICAgaWYgKHNwZWNpZmllci5pc1R5cGVPbmx5IHx8IGlzVW51c2VkKHNwZWNpZmllci5uYW1lKSkge1xuICAgICAgICAgICAgcmVtb3ZlZENsYXVzZXNDb3VudCsrO1xuICAgICAgICAgICAgLy8gaW4gY2FzZSB3ZSBkb24ndCBoYXZlIGFueSBtb3JlIG5hbWVkSW1wb3J0cyB3ZSBzaG91bGQgcmVtb3ZlIHRoZSBwYXJlbnQgaWUgdGhlIHt9XG4gICAgICAgICAgICBjb25zdCBub2RlVG9SZW1vdmUgPVxuICAgICAgICAgICAgICBjbGF1c2VzQ291bnQgPT09IHJlbW92ZWRDbGF1c2VzQ291bnQgPyBzcGVjaWZpZXIucGFyZW50IDogc3BlY2lmaWVyO1xuXG4gICAgICAgICAgICBzcGVjaWZpZXJOb2RlUmVtb3ZhbHMucHVzaChub2RlVG9SZW1vdmUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBcImltcG9ydCBYWVogZnJvbSAnYWJjJztcIlxuICAgICAgaWYgKG5vZGUuaW1wb3J0Q2xhdXNlLm5hbWUpIHtcbiAgICAgICAgY2xhdXNlc0NvdW50Kys7XG5cbiAgICAgICAgaWYgKG5vZGUuaW1wb3J0Q2xhdXNlLmlzVHlwZU9ubHkgfHwgaXNVbnVzZWQobm9kZS5pbXBvcnRDbGF1c2UubmFtZSkpIHtcbiAgICAgICAgICBzcGVjaWZpZXJOb2RlUmVtb3ZhbHMucHVzaChub2RlLmltcG9ydENsYXVzZS5uYW1lKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoc3BlY2lmaWVyTm9kZVJlbW92YWxzLmxlbmd0aCA9PT0gY2xhdXNlc0NvdW50KSB7XG4gICAgICAgIGltcG9ydE5vZGVSZW1vdmFscy5hZGQobm9kZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IHNwZWNpZmllck5vZGVSZW1vdmFsIG9mIHNwZWNpZmllck5vZGVSZW1vdmFscykge1xuICAgICAgICAgIGltcG9ydE5vZGVSZW1vdmFscy5hZGQoc3BlY2lmaWVyTm9kZVJlbW92YWwpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGltcG9ydE5vZGVSZW1vdmFscztcbn1cbiJdfQ==