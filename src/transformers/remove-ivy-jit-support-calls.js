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
exports.removeIvyJitSupportCalls = void 0;
const ts = __importStar(require("typescript"));
const elide_imports_1 = require("./elide_imports");
function removeIvyJitSupportCalls(classMetadata, ngModuleScope, getTypeChecker) {
    return (context) => {
        const removedNodes = [];
        const visitNode = (node) => {
            const innerExpression = ts.isExpressionStatement(node) ? getIifeExpression(node) : null;
            if (innerExpression) {
                if (ngModuleScope &&
                    ts.isBinaryExpression(innerExpression) &&
                    isIvyPrivateCallExpression(innerExpression.right, 'ɵɵsetNgModuleScope')) {
                    removedNodes.push(innerExpression);
                    return undefined;
                }
                if (classMetadata) {
                    const expression = ts.isBinaryExpression(innerExpression)
                        ? innerExpression.right
                        : innerExpression;
                    if (isIvyPrivateCallExpression(expression, 'ɵsetClassMetadata') ||
                        isIvyPrivateCallExpression(expression, 'ɵsetClassMetadataAsync')) {
                        removedNodes.push(innerExpression);
                        return undefined;
                    }
                }
            }
            return ts.visitEachChild(node, visitNode, context);
        };
        return (sourceFile) => {
            let updatedSourceFile = ts.visitEachChild(sourceFile, visitNode, context);
            if (removedNodes.length > 0) {
                // Remove any unused imports
                const importRemovals = (0, elide_imports_1.elideImports)(updatedSourceFile, removedNodes, getTypeChecker, context.getCompilerOptions());
                if (importRemovals.size > 0) {
                    updatedSourceFile = ts.visitEachChild(updatedSourceFile, function visitForRemoval(node) {
                        return importRemovals.has(node)
                            ? undefined
                            : ts.visitEachChild(node, visitForRemoval, context);
                    }, context);
                }
            }
            return updatedSourceFile;
        };
    };
}
exports.removeIvyJitSupportCalls = removeIvyJitSupportCalls;
// Each Ivy private call expression is inside an IIFE
function getIifeExpression(exprStmt) {
    const expression = exprStmt.expression;
    if (!expression || !ts.isCallExpression(expression) || expression.arguments.length !== 0) {
        return null;
    }
    const parenExpr = expression;
    if (!ts.isParenthesizedExpression(parenExpr.expression)) {
        return null;
    }
    const funExpr = parenExpr.expression.expression;
    if (!ts.isFunctionExpression(funExpr) && !ts.isArrowFunction(funExpr)) {
        return null;
    }
    if (!ts.isBlock(funExpr.body)) {
        return funExpr.body;
    }
    const innerStmts = funExpr.body.statements;
    if (innerStmts.length !== 1) {
        return null;
    }
    const innerExprStmt = innerStmts[0];
    if (!ts.isExpressionStatement(innerExprStmt)) {
        return null;
    }
    return innerExprStmt.expression;
}
function isIvyPrivateCallExpression(expression, name) {
    // Now we're in the IIFE and have the inner expression statement. We can check if it matches
    // a private Ivy call.
    if (!ts.isCallExpression(expression)) {
        return false;
    }
    const propAccExpr = expression.expression;
    if (!ts.isPropertyAccessExpression(propAccExpr)) {
        return false;
    }
    if (propAccExpr.name.text !== name) {
        return false;
    }
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVtb3ZlLWl2eS1qaXQtc3VwcG9ydC1jYWxscy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdHJhbnNmb3JtZXJzL3JlbW92ZS1pdnktaml0LXN1cHBvcnQtY2FsbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCwrQ0FBaUM7QUFDakMsbURBQStDO0FBRS9DLFNBQWdCLHdCQUF3QixDQUN0QyxhQUFzQixFQUN0QixhQUFzQixFQUN0QixjQUFvQztJQUVwQyxPQUFPLENBQUMsT0FBaUMsRUFBRSxFQUFFO1FBQzNDLE1BQU0sWUFBWSxHQUFjLEVBQUUsQ0FBQztRQUVuQyxNQUFNLFNBQVMsR0FBZSxDQUFDLElBQWEsRUFBRSxFQUFFO1lBQzlDLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztZQUN4RixJQUFJLGVBQWUsRUFBRTtnQkFDbkIsSUFDRSxhQUFhO29CQUNiLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxlQUFlLENBQUM7b0JBQ3RDLDBCQUEwQixDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsb0JBQW9CLENBQUMsRUFDdkU7b0JBQ0EsWUFBWSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztvQkFFbkMsT0FBTyxTQUFTLENBQUM7aUJBQ2xCO2dCQUVELElBQUksYUFBYSxFQUFFO29CQUNqQixNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUMsa0JBQWtCLENBQUMsZUFBZSxDQUFDO3dCQUN2RCxDQUFDLENBQUMsZUFBZSxDQUFDLEtBQUs7d0JBQ3ZCLENBQUMsQ0FBQyxlQUFlLENBQUM7b0JBQ3BCLElBQ0UsMEJBQTBC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LDRGQUE0RjtJQUM1RixzQkFBc0I7SUFDdEIsSUFBSSxDQUFDLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsRUFBRTtRQUNwQyxPQUFPLEtBQUssQ0FBQztLQUNkO0lBRUQsTUFBTSxXQUFXLEdBQUcsVUFBVSxDQUFDLFVBQVUsQ0FBQztJQUMxQyxJQUFJLENBQUMsRUFBRSxDQUFDLDBCQUEwQixDQUFDLFdBQVcsQ0FBQyxFQUFFO1FBQy9DLE9BQU8sS0FBSyxDQUFDO0tBQ2Q7SUFFRCxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLElBQUksRUFBRTtRQUNsQyxPQUFPLEtBQUssQ0FBQztLQUNkO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgZWxpZGVJbXBvcnRzIH0gZnJvbSAnLi9lbGlkZV9pbXBvcnRzJztcblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUl2eUppdFN1cHBvcnRDYWxscyhcbiAgY2xhc3NNZXRhZGF0YTogYm9vbGVhbixcbiAgbmdNb2R1bGVTY29wZTogYm9vbGVhbixcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuKTogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+IHtcbiAgcmV0dXJuIChjb250ZXh0OiB0cy5UcmFuc2Zvcm1hdGlvbkNvbnRleHQpID0+IHtcbiAgICBjb25zdCByZW1vdmVkTm9kZXM6IHRzLk5vZGVbXSA9IFtdO1xuXG4gICAgY29uc3QgdmlzaXROb2RlOiB0cy5WaXNpdG9yID0gKG5vZGU6IHRzLk5vZGUpID0+IHtcbiAgICAgIGNvbnN0IGlubmVyRXhwcmVzc2lvbiA9IHRzLmlzRXhwcmVzc2lvblN0YXRlbWVudChub2RlKSA/IGdldElpZmVFeHByZXNzaW9uKG5vZGUpIDogbnVsbDtcbiAgICAgIGlmIChpbm5lckV4cHJlc3Npb24pIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIG5nTW9kdWxlU2NvcGUgJiZcbiAgICAgICAgICB0cy5pc0JpbmFyeUV4cHJlc3Npb24oaW5uZXJFeHByZXNzaW9uKSAmJlxuICAgICAgICAgIGlzSXZ5UHJpdmF0ZUNhbGxFeHByZXNzaW9uKGlubmVyRXhwcmVzc2lvbi5yaWdodCwgJ8m1ybVzZXROZ01vZHVsZVNjb3BlJylcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmVtb3ZlZE5vZGVzLnB1c2goaW5uZXJFeHByZXNzaW9uKTtcblxuICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2xhc3NNZXRhZGF0YSkge1xuICAgICAgICAgIGNvbnN0IGV4cHJlc3Npb24gPSB0cy5pc0JpbmFyeUV4cHJlc3Npb24oaW5uZXJFeHByZXNzaW9uKVxuICAgICAgICAgICAgPyBpbm5lckV4cHJlc3Npb24ucmlnaHRcbiAgICAgICAgICAgIDogaW5uZXJFeHByZXNzaW9uO1xuICAgICAgICAgIGlmIChcbiAgICAgICAgICAgIGlzSXZ5UHJpdmF0ZUNhbGxFeHByZXNzaW9uKGV4cHJlc3Npb24sICfJtXNldENsYXNzTWV0YWRhdGEnKSB8fFxuICAgICAgICAgICAgaXNJdnlQcml2YXRlQ2FsbEV4cHJlc3Npb24oZXhwcmVzc2lvbiwgJ8m1c2V0Q2xhc3NNZXRhZGF0YUFzeW5jJylcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIHJlbW92ZWROb2Rlcy5wdXNoKGlubmVyRXhwcmVzc2lvbik7XG5cbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdE5vZGUsIGNvbnRleHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGxldCB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKHNvdXJjZUZpbGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG5cbiAgICAgIGlmIChyZW1vdmVkTm9kZXMubGVuZ3RoID4gMCkge1xuICAgICAgICAvLyBSZW1vdmUgYW55IHVudXNlZCBpbXBvcnRzXG4gICAgICAgIGNvbnN0IGltcG9ydFJlbW92YWxzID0gZWxpZGVJbXBvcnRzKFxuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLFxuICAgICAgICAgIHJlbW92ZWROb2RlcyxcbiAgICAgICAgICBnZXRUeXBlQ2hlY2tlcixcbiAgICAgICAgICBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLFxuICAgICAgICApO1xuICAgICAgICBpZiAoaW1wb3J0UmVtb3ZhbHMuc2l6ZSA+IDApIHtcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKFxuICAgICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgICBmdW5jdGlvbiB2aXNpdEZvclJlbW92YWwobm9kZSk6IHRzLk5vZGUgfCB1bmRlZmluZWQge1xuICAgICAgICAgICAgICByZXR1cm4gaW1wb3J0UmVtb3ZhbHMuaGFzKG5vZGUpXG4gICAgICAgICAgICAgICAgPyB1bmRlZmluZWRcbiAgICAgICAgICAgICAgICA6IHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIHZpc2l0Rm9yUmVtb3ZhbCwgY29udGV4dCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB1cGRhdGVkU291cmNlRmlsZTtcbiAgICB9O1xuICB9O1xufVxuXG4vLyBFYWNoIEl2eSBwcml2YXRlIGNhbGwgZXhwcmVzc2lvbiBpcyBpbnNpZGUgYW4gSUlGRVxuZnVuY3Rpb24gZ2V0SWlmZUV4cHJlc3Npb24oZXhwclN0bXQ6IHRzLkV4cHJlc3Npb25TdGF0ZW1lbnQpOiBudWxsIHwgdHMuRXhwcmVzc2lvbiB7XG4gIGNvbnN0IGV4cHJlc3Npb24gPSBleHByU3RtdC5leHByZXNzaW9uO1xuICBpZiAoIWV4cHJlc3Npb24gfHwgIXRzLmlzQ2FsbEV4cHJlc3Npb24oZXhwcmVzc2lvbikgfHwgZXhwcmVzc2lvbi5hcmd1bWVudHMubGVuZ3RoICE9PSAwKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBwYXJlbkV4cHIgPSBleHByZXNzaW9uO1xuICBpZiAoIXRzLmlzUGFyZW50aGVzaXplZEV4cHJlc3Npb24ocGFyZW5FeHByLmV4cHJlc3Npb24pKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBmdW5FeHByID0gcGFyZW5FeHByLmV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgaWYgKCF0cy5pc0Z1bmN0aW9uRXhwcmVzc2lvbihmdW5FeHByKSAmJiAhdHMuaXNBcnJvd0Z1bmN0aW9uKGZ1bkV4cHIpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBpZiAoIXRzLmlzQmxvY2soZnVuRXhwci5ib2R5KSkge1xuICAgIHJldHVybiBmdW5FeHByLmJvZHk7XG4gIH1cblxuICBjb25zdCBpbm5lclN0bXRzID0gZnVuRXhwci5ib2R5LnN0YXRlbWVudHM7XG4gIGlmIChpbm5lclN0bXRzLmxlbmd0aCAhPT0gMSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgaW5uZXJFeHByU3RtdCA9IGlubmVyU3RtdHNbMF07XG4gIGlmICghdHMuaXNFeHByZXNzaW9uU3RhdGVtZW50KGlubmVyRXhwclN0bXQpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4gaW5uZXJFeHByU3RtdC5leHByZXNzaW9uO1xufVxuXG5mdW5jdGlvbiBpc0l2eVByaXZhdGVDYWxsRXhwcmVzc2lvbihleHByZXNzaW9uOiB0cy5FeHByZXNzaW9uLCBuYW1lOiBzdHJpbmcpIHtcbiAgLy8gTm93IHdlJ3JlIGluIHRoZSBJSUZFIGFuZCBoYXZlIHRoZSBpbm5lciBleHByZXNzaW9uIHN0YXRlbWVudC4gV2UgY2FuIGNoZWNrIGlmIGl0IG1hdGNoZXNcbiAgLy8gYSBwcml2YXRlIEl2eSBjYWxsLlxuICBpZiAoIXRzLmlzQ2FsbEV4cHJlc3Npb24oZXhwcmVzc2lvbikpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBwcm9wQWNjRXhwciA9IGV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgaWYgKCF0cy5pc1Byb3BlcnR5QWNjZXNzRXhwcmVzc2lvbihwcm9wQWNjRXhwcikpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAocHJvcEFjY0V4cHIubmFtZS50ZXh0ICE9PSBuYW1lKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59XG4iXX0=