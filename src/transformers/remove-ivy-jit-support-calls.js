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
exports.removeIvyJitSupportCalls = void 0;
const ts = __importStar(require("typescript"));
const elide_imports_1 = require("./elide_imports");
function removeIvyJitSupportCalls(classMetadata, ngModuleScope, getTypeChecker) {
    return (context) => {
        const removedNodes = [];
        const visitNode = (node) => {
            const innerStatement = ts.isExpressionStatement(node) && getIifeStatement(node);
            if (innerStatement) {
                if (ngModuleScope &&
                    ts.isBinaryExpression(innerStatement.expression) &&
                    isIvyPrivateCallExpression(innerStatement.expression.right, 'ɵɵsetNgModuleScope')) {
                    removedNodes.push(innerStatement);
                    return undefined;
                }
                if (classMetadata) {
                    const expression = ts.isBinaryExpression(innerStatement.expression)
                        ? innerStatement.expression.right
                        : innerStatement.expression;
                    if (isIvyPrivateCallExpression(expression, 'ɵsetClassMetadata')) {
                        removedNodes.push(innerStatement);
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
function getIifeStatement(exprStmt) {
    const expression = exprStmt.expression;
    if (!expression || !ts.isCallExpression(expression) || expression.arguments.length !== 0) {
        return null;
    }
    const parenExpr = expression;
    if (!ts.isParenthesizedExpression(parenExpr.expression)) {
        return null;
    }
    const funExpr = parenExpr.expression.expression;
    if (!ts.isFunctionExpression(funExpr)) {
        return null;
    }
    const innerStmts = funExpr.body.statements;
    if (innerStmts.length !== 1) {
        return null;
    }
    const innerExprStmt = innerStmts[0];
    if (!ts.isExpressionStatement(innerExprStmt)) {
        return null;
    }
    return innerExprStmt;
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
    if (propAccExpr.name.text != name) {
        return false;
    }
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVtb3ZlLWl2eS1qaXQtc3VwcG9ydC1jYWxscy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uLy4uLy4uLy4uL3BhY2thZ2VzL25ndG9vbHMvd2VicGFjay9zcmMvdHJhbnNmb3JtZXJzL3JlbW92ZS1pdnktaml0LXN1cHBvcnQtY2FsbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7Ozs7R0FNRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxtREFBK0M7QUFFL0MsU0FBZ0Isd0JBQXdCLENBQ3RDLGFBQXNCLEVBQ3RCLGFBQXNCLEVBQ3RCLGNBQW9DO0lBRXBDLE9BQU8sQ0FBQyxPQUFpQyxFQUFFLEVBQUU7UUFDM0MsTUFBTSxZQUFZLEdBQWMsRUFBRSxDQUFDO1FBRW5DLE1BQU0sU0FBUyxHQUFlLENBQUMsSUFBYSxFQUFFLEVBQUU7WUFDOUMsTUFBTSxjQUFjLEdBQUcsRUFBRSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxJQUFJLGdCQUFnQixDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ2hGLElBQUksY0FBYyxFQUFFO2dCQUNsQixJQUNFLGFBQWE7b0JBQ2IsRUFBRSxDQUFDLGtCQUFrQixDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUM7b0JBQ2hELDBCQUEwQixDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsS0FBSyxFQUFFLG9CQUFvQixDQUFDLEVBQ2pGO29CQUNBLFlBQVksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7b0JBRWxDLE9BQU8sU0FBUyxDQUFDO2lCQUNsQjtnQkFFRCxJQUFJLGFBQWEsRUFBRTtvQkFDakIsTUFBTSxVQUFVLEdBQUcsRUFBRSxDQUFDLGtCQUFrQixDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUM7d0JBQ2pFLENBQUMsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLEtBQUs7d0JBQ2pDLENBQUMsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDO29C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LENBQUMsV0FBVyxDQUFDLEVBQUU7UUFDL0MsT0FBTyxLQUFLLENBQUM7S0FDZDtJQUVELElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxFQUFFO1FBQ2pDLE9BQU8sS0FBSyxDQUFDO0tBQ2Q7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBlbGlkZUltcG9ydHMgfSBmcm9tICcuL2VsaWRlX2ltcG9ydHMnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlSXZ5Sml0U3VwcG9ydENhbGxzKFxuICBjbGFzc01ldGFkYXRhOiBib29sZWFuLFxuICBuZ01vZHVsZVNjb3BlOiBib29sZWFuLFxuICBnZXRUeXBlQ2hlY2tlcjogKCkgPT4gdHMuVHlwZUNoZWNrZXIsXG4pOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT4ge1xuICByZXR1cm4gKGNvbnRleHQ6IHRzLlRyYW5zZm9ybWF0aW9uQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHJlbW92ZWROb2RlczogdHMuTm9kZVtdID0gW107XG5cbiAgICBjb25zdCB2aXNpdE5vZGU6IHRzLlZpc2l0b3IgPSAobm9kZTogdHMuTm9kZSkgPT4ge1xuICAgICAgY29uc3QgaW5uZXJTdGF0ZW1lbnQgPSB0cy5pc0V4cHJlc3Npb25TdGF0ZW1lbnQobm9kZSkgJiYgZ2V0SWlmZVN0YXRlbWVudChub2RlKTtcbiAgICAgIGlmIChpbm5lclN0YXRlbWVudCkge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgbmdNb2R1bGVTY29wZSAmJlxuICAgICAgICAgIHRzLmlzQmluYXJ5RXhwcmVzc2lvbihpbm5lclN0YXRlbWVudC5leHByZXNzaW9uKSAmJlxuICAgICAgICAgIGlzSXZ5UHJpdmF0ZUNhbGxFeHByZXNzaW9uKGlubmVyU3RhdGVtZW50LmV4cHJlc3Npb24ucmlnaHQsICfJtcm1c2V0TmdNb2R1bGVTY29wZScpXG4gICAgICAgICkge1xuICAgICAgICAgIHJlbW92ZWROb2Rlcy5wdXNoKGlubmVyU3RhdGVtZW50KTtcblxuICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2xhc3NNZXRhZGF0YSkge1xuICAgICAgICAgIGNvbnN0IGV4cHJlc3Npb24gPSB0cy5pc0JpbmFyeUV4cHJlc3Npb24oaW5uZXJTdGF0ZW1lbnQuZXhwcmVzc2lvbilcbiAgICAgICAgICAgID8gaW5uZXJTdGF0ZW1lbnQuZXhwcmVzc2lvbi5yaWdodFxuICAgICAgICAgICAgOiBpbm5lclN0YXRlbWVudC5leHByZXNzaW9uO1xuICAgICAgICAgIGlmIChpc0l2eVByaXZhdGVDYWxsRXhwcmVzc2lvbihleHByZXNzaW9uLCAnybVzZXRDbGFzc01ldGFkYXRhJykpIHtcbiAgICAgICAgICAgIHJlbW92ZWROb2Rlcy5wdXNoKGlubmVyU3RhdGVtZW50KTtcblxuICAgICAgICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG4gICAgfTtcblxuICAgIHJldHVybiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgbGV0IHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoc291cmNlRmlsZSwgdmlzaXROb2RlLCBjb250ZXh0KTtcblxuICAgICAgaWYgKHJlbW92ZWROb2Rlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIC8vIFJlbW92ZSBhbnkgdW51c2VkIGltcG9ydHNcbiAgICAgICAgY29uc3QgaW1wb3J0UmVtb3ZhbHMgPSBlbGlkZUltcG9ydHMoXG4gICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgcmVtb3ZlZE5vZGVzLFxuICAgICAgICAgIGdldFR5cGVDaGVja2VyLFxuICAgICAgICAgIGNvbnRleHQuZ2V0Q29tcGlsZXJPcHRpb25zKCksXG4gICAgICAgICk7XG4gICAgICAgIGlmIChpbXBvcnRSZW1vdmFscy5zaXplID4gMCkge1xuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoXG4gICAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICAgIGZ1bmN0aW9uIHZpc2l0Rm9yUmVtb3ZhbChub2RlKTogdHMuTm9kZSB8IHVuZGVmaW5lZCB7XG4gICAgICAgICAgICAgIHJldHVybiBpbXBvcnRSZW1vdmFscy5oYXMobm9kZSlcbiAgICAgICAgICAgICAgICA/IHVuZGVmaW5lZFxuICAgICAgICAgICAgICAgIDogdHMudmlzaXRFYWNoQ2hpbGQobm9kZSwgdmlzaXRGb3JSZW1vdmFsLCBjb250ZXh0KTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVwZGF0ZWRTb3VyY2VGaWxlO1xuICAgIH07XG4gIH07XG59XG5cbi8vIEVhY2ggSXZ5IHByaXZhdGUgY2FsbCBleHByZXNzaW9uIGlzIGluc2lkZSBhbiBJSUZFXG5mdW5jdGlvbiBnZXRJaWZlU3RhdGVtZW50KGV4cHJTdG10OiB0cy5FeHByZXNzaW9uU3RhdGVtZW50KTogbnVsbCB8IHRzLkV4cHJlc3Npb25TdGF0ZW1lbnQge1xuICBjb25zdCBleHByZXNzaW9uID0gZXhwclN0bXQuZXhwcmVzc2lvbjtcbiAgaWYgKCFleHByZXNzaW9uIHx8ICF0cy5pc0NhbGxFeHByZXNzaW9uKGV4cHJlc3Npb24pIHx8IGV4cHJlc3Npb24uYXJndW1lbnRzLmxlbmd0aCAhPT0gMCkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgcGFyZW5FeHByID0gZXhwcmVzc2lvbjtcbiAgaWYgKCF0cy5pc1BhcmVudGhlc2l6ZWRFeHByZXNzaW9uKHBhcmVuRXhwci5leHByZXNzaW9uKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3QgZnVuRXhwciA9IHBhcmVuRXhwci5leHByZXNzaW9uLmV4cHJlc3Npb247XG4gIGlmICghdHMuaXNGdW5jdGlvbkV4cHJlc3Npb24oZnVuRXhwcikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IGlubmVyU3RtdHMgPSBmdW5FeHByLmJvZHkuc3RhdGVtZW50cztcbiAgaWYgKGlubmVyU3RtdHMubGVuZ3RoICE9PSAxKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBpbm5lckV4cHJTdG10ID0gaW5uZXJTdG10c1swXTtcbiAgaWYgKCF0cy5pc0V4cHJlc3Npb25TdGF0ZW1lbnQoaW5uZXJFeHByU3RtdCkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiBpbm5lckV4cHJTdG10O1xufVxuXG5mdW5jdGlvbiBpc0l2eVByaXZhdGVDYWxsRXhwcmVzc2lvbihleHByZXNzaW9uOiB0cy5FeHByZXNzaW9uLCBuYW1lOiBzdHJpbmcpIHtcbiAgLy8gTm93IHdlJ3JlIGluIHRoZSBJSUZFIGFuZCBoYXZlIHRoZSBpbm5lciBleHByZXNzaW9uIHN0YXRlbWVudC4gV2UgY2FuIGNoZWNrIGlmIGl0IG1hdGNoZXNcbiAgLy8gYSBwcml2YXRlIEl2eSBjYWxsLlxuICBpZiAoIXRzLmlzQ2FsbEV4cHJlc3Npb24oZXhwcmVzc2lvbikpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBwcm9wQWNjRXhwciA9IGV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgaWYgKCF0cy5pc1Byb3BlcnR5QWNjZXNzRXhwcmVzc2lvbihwcm9wQWNjRXhwcikpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBpZiAocHJvcEFjY0V4cHIubmFtZS50ZXh0ICE9IG5hbWUpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cbiJdfQ==