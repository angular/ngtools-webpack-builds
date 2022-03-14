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
exports.replaceBootstrap = exports.mergeTransformers = exports.createJitTransformers = exports.createAotTransformers = void 0;
const ts = __importStar(require("typescript"));
const elide_imports_1 = require("../transformers/elide_imports");
const remove_ivy_jit_support_calls_1 = require("../transformers/remove-ivy-jit-support-calls");
const replace_resources_1 = require("../transformers/replace_resources");
function createAotTransformers(builder, options) {
    const getTypeChecker = () => builder.getProgram().getTypeChecker();
    const transformers = {
        before: [replaceBootstrap(getTypeChecker)],
        after: [],
    };
    const removeClassMetadata = !options.emitClassMetadata;
    const removeNgModuleScope = !options.emitNgModuleScope;
    if (removeClassMetadata || removeNgModuleScope) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        transformers.before.push((0, remove_ivy_jit_support_calls_1.removeIvyJitSupportCalls)(removeClassMetadata, removeNgModuleScope, getTypeChecker));
    }
    return transformers;
}
exports.createAotTransformers = createAotTransformers;
function createJitTransformers(builder, compilerCli, options) {
    const getTypeChecker = () => builder.getProgram().getTypeChecker();
    return {
        before: [
            (0, replace_resources_1.replaceResources)(() => true, getTypeChecker, options.inlineStyleFileExtension),
            compilerCli.constructorParametersDownlevelTransform(builder.getProgram()),
        ],
    };
}
exports.createJitTransformers = createJitTransformers;
function mergeTransformers(first, second) {
    const result = {};
    if (first.before || second.before) {
        result.before = [...(first.before || []), ...(second.before || [])];
    }
    if (first.after || second.after) {
        result.after = [...(first.after || []), ...(second.after || [])];
    }
    if (first.afterDeclarations || second.afterDeclarations) {
        result.afterDeclarations = [
            ...(first.afterDeclarations || []),
            ...(second.afterDeclarations || []),
        ];
    }
    return result;
}
exports.mergeTransformers = mergeTransformers;
function replaceBootstrap(getTypeChecker) {
    return (context) => {
        let bootstrapImport;
        let bootstrapNamespace;
        const replacedNodes = [];
        const nodeFactory = context.factory;
        const visitNode = (node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                const target = node.expression;
                if (target.text === 'platformBrowserDynamic') {
                    if (!bootstrapNamespace) {
                        bootstrapNamespace = nodeFactory.createUniqueName('__NgCli_bootstrap_');
                        bootstrapImport = nodeFactory.createImportDeclaration(undefined, undefined, nodeFactory.createImportClause(false, undefined, nodeFactory.createNamespaceImport(bootstrapNamespace)), nodeFactory.createStringLiteral('@angular/platform-browser'));
                    }
                    replacedNodes.push(target);
                    return nodeFactory.updateCallExpression(node, nodeFactory.createPropertyAccessExpression(bootstrapNamespace, 'platformBrowser'), node.typeArguments, node.arguments);
                }
            }
            return ts.visitEachChild(node, visitNode, context);
        };
        return (sourceFile) => {
            let updatedSourceFile = ts.visitEachChild(sourceFile, visitNode, context);
            if (bootstrapImport) {
                // Remove any unused platform browser dynamic imports
                const removals = (0, elide_imports_1.elideImports)(updatedSourceFile, replacedNodes, getTypeChecker, context.getCompilerOptions());
                if (removals.size > 0) {
                    updatedSourceFile = ts.visitEachChild(updatedSourceFile, (node) => (removals.has(node) ? undefined : node), context);
                }
                // Add new platform browser import
                return nodeFactory.updateSourceFile(updatedSourceFile, ts.setTextRange(nodeFactory.createNodeArray([bootstrapImport, ...updatedSourceFile.statements]), sourceFile.statements));
            }
            else {
                return updatedSourceFile;
            }
        };
    };
}
exports.replaceBootstrap = replaceBootstrap;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS90cmFuc2Zvcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxpRUFBNkQ7QUFDN0QsK0ZBQXdGO0FBQ3hGLHlFQUFxRTtBQUVyRSxTQUFnQixxQkFBcUIsQ0FDbkMsT0FBMEIsRUFDMUIsT0FBcUU7SUFFckUsTUFBTSxjQUFjLEdBQUcsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFDO0lBQ25FLE1BQU0sWUFBWSxHQUEwQjtRQUMxQyxNQUFNLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUMxQyxLQUFLLEVBQUUsRUFBRTtLQUNWLENBQUM7SUFFRixNQUFNLG1CQUFtQixHQUFHLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDO0lBQ3ZELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUM7SUFDdkQsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsRUFBRTtRQUM5QyxvRUFBb0U7UUFDcEUsWUFBWSxDQUFDLE1BQU8sQ0FBQyxJQUFJLENBQ3ZCLElBQUEsdURBQXdCLEVBQUMsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxDQUFDLENBQ25GLENBQUM7S0FDSDtJQUVELE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUM7QUFwQkQsc0RBb0JDO0FBRUQsU0FBZ0IscUJBQXFCLENBQ25DLE9BQTBCLEVBQzFCLFdBQW1ELEVBQ25ELE9BRUM7SUFFRCxNQUFNLGNBQWMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsY0FBYyxFQUFFLENB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RUFBRSxPQUFPLENBQUMsQ0FBQztRQUNyRCxDQUFDLENBQUM7UUFFRixPQUFPLENBQUMsVUFBeUIsRUFBRSxFQUFFO1lBQ25DLElBQUksaUJBQWlCLEdBQUcsRUFBRSxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRTFFLElBQUksZUFBZSxFQUFFO2dCQUNuQixxREFBcUQ7Z0JBQ3JELE1BQU0sUUFBUSxHQUFHLElBQUEsNEJBQVksRUFDM0IsaUJBQWlCLEVBQ2pCLGFBQWEsRUFDYixjQUFjLEVBQ2QsT0FBTyxDQUFDLGtCQUFrQixFQUFFLENBQzdCLENBQUM7Z0JBQ0YsSUFBSSxRQUFRLENBQUMsSUFBSSxHQUFHLENBQUMsRUFBRTtvQkFDckIsaUJBQWlCLEdBQUcsRUFBRSxDQUFDLGNBQWMsQ0FDbkMsaUJBQWlCLEVBQ2pCLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQ2pELE9BQU8sQ0FDUixDQUFDO2lCQUNIO2dCQUVELGtDQUFrQztnQkFDbEMsT0FBTyxXQUFXLENBQUMsZ0JBQWdCLENBQ2pDLGlCQUFpQixFQUNqQixFQUFFLENBQUMsWUFBWSxDQUNiLFdBQVcsQ0FBQyxlQUFlLENBQUMsQ0FBQyxlQUFlLEVBQUUsR0FBRyxpQkFBaUIsQ0FBQyxVQUFVLENBQUMsQ0FBQyxFQUMvRSxVQUFVLENBQUMsVUFBVSxDQUN0QixDQUNGLENBQUM7YUFDSDtpQkFBTTtnQkFDTCxPQUFPLGlCQUFpQixDQUFDO2FBQzFCO1FBQ0gsQ0FBQyxDQUFDO0lBQ0osQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQXhFRCw0Q0F3RUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBlbGlkZUltcG9ydHMgfSBmcm9tICcuLi90cmFuc2Zvcm1lcnMvZWxpZGVfaW1wb3J0cyc7XG5pbXBvcnQgeyByZW1vdmVJdnlKaXRTdXBwb3J0Q2FsbHMgfSBmcm9tICcuLi90cmFuc2Zvcm1lcnMvcmVtb3ZlLWl2eS1qaXQtc3VwcG9ydC1jYWxscyc7XG5pbXBvcnQgeyByZXBsYWNlUmVzb3VyY2VzIH0gZnJvbSAnLi4vdHJhbnNmb3JtZXJzL3JlcGxhY2VfcmVzb3VyY2VzJztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUFvdFRyYW5zZm9ybWVycyhcbiAgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0sXG4gIG9wdGlvbnM6IHsgZW1pdENsYXNzTWV0YWRhdGE/OiBib29sZWFuOyBlbWl0TmdNb2R1bGVTY29wZT86IGJvb2xlYW4gfSxcbik6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyB7XG4gIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gYnVpbGRlci5nZXRQcm9ncmFtKCkuZ2V0VHlwZUNoZWNrZXIoKTtcbiAgY29uc3QgdHJhbnNmb3JtZXJzOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMgPSB7XG4gICAgYmVmb3JlOiBbcmVwbGFjZUJvb3RzdHJhcChnZXRUeXBlQ2hlY2tlcildLFxuICAgIGFmdGVyOiBbXSxcbiAgfTtcblxuICBjb25zdCByZW1vdmVDbGFzc01ldGFkYXRhID0gIW9wdGlvbnMuZW1pdENsYXNzTWV0YWRhdGE7XG4gIGNvbnN0IHJlbW92ZU5nTW9kdWxlU2NvcGUgPSAhb3B0aW9ucy5lbWl0TmdNb2R1bGVTY29wZTtcbiAgaWYgKHJlbW92ZUNsYXNzTWV0YWRhdGEgfHwgcmVtb3ZlTmdNb2R1bGVTY29wZSkge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgdHJhbnNmb3JtZXJzLmJlZm9yZSEucHVzaChcbiAgICAgIHJlbW92ZUl2eUppdFN1cHBvcnRDYWxscyhyZW1vdmVDbGFzc01ldGFkYXRhLCByZW1vdmVOZ01vZHVsZVNjb3BlLCBnZXRUeXBlQ2hlY2tlciksXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB0cmFuc2Zvcm1lcnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMoXG4gIGJ1aWxkZXI6IHRzLkJ1aWxkZXJQcm9ncmFtLFxuICBjb21waWxlckNsaTogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyksXG4gIG9wdGlvbnM6IHtcbiAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmc7XG4gIH0sXG4pOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMge1xuICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+IGJ1aWxkZXIuZ2V0UHJvZ3JhbSgpLmdldFR5cGVDaGVja2VyKCk7XG5cbiAgcmV0dXJuIHtcbiAgICBiZWZvcmU6IFtcbiAgICAgIHJlcGxhY2VSZXNvdXJjZXMoKCkgPT4gdHJ1ZSwgZ2V0VHlwZUNoZWNrZXIsIG9wdGlvbnMuaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uKSxcbiAgICAgIGNvbXBpbGVyQ2xpLmNvbnN0cnVjdG9yUGFyYW1ldGVyc0Rvd25sZXZlbFRyYW5zZm9ybShidWlsZGVyLmdldFByb2dyYW0oKSksXG4gICAgXSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlVHJhbnNmb3JtZXJzKFxuICBmaXJzdDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzLFxuICBzZWNvbmQ6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyxcbik6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyB7XG4gIGNvbnN0IHJlc3VsdDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzID0ge307XG5cbiAgaWYgKGZpcnN0LmJlZm9yZSB8fCBzZWNvbmQuYmVmb3JlKSB7XG4gICAgcmVzdWx0LmJlZm9yZSA9IFsuLi4oZmlyc3QuYmVmb3JlIHx8IFtdKSwgLi4uKHNlY29uZC5iZWZvcmUgfHwgW10pXTtcbiAgfVxuXG4gIGlmIChmaXJzdC5hZnRlciB8fCBzZWNvbmQuYWZ0ZXIpIHtcbiAgICByZXN1bHQuYWZ0ZXIgPSBbLi4uKGZpcnN0LmFmdGVyIHx8IFtdKSwgLi4uKHNlY29uZC5hZnRlciB8fCBbXSldO1xuICB9XG5cbiAgaWYgKGZpcnN0LmFmdGVyRGVjbGFyYXRpb25zIHx8IHNlY29uZC5hZnRlckRlY2xhcmF0aW9ucykge1xuICAgIHJlc3VsdC5hZnRlckRlY2xhcmF0aW9ucyA9IFtcbiAgICAgIC4uLihmaXJzdC5hZnRlckRlY2xhcmF0aW9ucyB8fCBbXSksXG4gICAgICAuLi4oc2Vjb25kLmFmdGVyRGVjbGFyYXRpb25zIHx8IFtdKSxcbiAgICBdO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlcGxhY2VCb290c3RyYXAoXG4gIGdldFR5cGVDaGVja2VyOiAoKSA9PiB0cy5UeXBlQ2hlY2tlcixcbik6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPiB7XG4gIHJldHVybiAoY29udGV4dDogdHMuVHJhbnNmb3JtYXRpb25Db250ZXh0KSA9PiB7XG4gICAgbGV0IGJvb3RzdHJhcEltcG9ydDogdHMuSW1wb3J0RGVjbGFyYXRpb24gfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJvb3RzdHJhcE5hbWVzcGFjZTogdHMuSWRlbnRpZmllciB8IHVuZGVmaW5lZDtcbiAgICBjb25zdCByZXBsYWNlZE5vZGVzOiB0cy5Ob2RlW10gPSBbXTtcbiAgICBjb25zdCBub2RlRmFjdG9yeSA9IGNvbnRleHQuZmFjdG9yeTtcblxuICAgIGNvbnN0IHZpc2l0Tm9kZTogdHMuVmlzaXRvciA9IChub2RlOiB0cy5Ob2RlKSA9PiB7XG4gICAgICBpZiAodHMuaXNDYWxsRXhwcmVzc2lvbihub2RlKSAmJiB0cy5pc0lkZW50aWZpZXIobm9kZS5leHByZXNzaW9uKSkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBub2RlLmV4cHJlc3Npb247XG4gICAgICAgIGlmICh0YXJnZXQudGV4dCA9PT0gJ3BsYXRmb3JtQnJvd3NlckR5bmFtaWMnKSB7XG4gICAgICAgICAgaWYgKCFib290c3RyYXBOYW1lc3BhY2UpIHtcbiAgICAgICAgICAgIGJvb3RzdHJhcE5hbWVzcGFjZSA9IG5vZGVGYWN0b3J5LmNyZWF0ZVVuaXF1ZU5hbWUoJ19fTmdDbGlfYm9vdHN0cmFwXycpO1xuICAgICAgICAgICAgYm9vdHN0cmFwSW1wb3J0ID0gbm9kZUZhY3RvcnkuY3JlYXRlSW1wb3J0RGVjbGFyYXRpb24oXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnRDbGF1c2UoXG4gICAgICAgICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZU5hbWVzcGFjZUltcG9ydChib290c3RyYXBOYW1lc3BhY2UpLFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVTdHJpbmdMaXRlcmFsKCdAYW5ndWxhci9wbGF0Zm9ybS1icm93c2VyJyksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXBsYWNlZE5vZGVzLnB1c2godGFyZ2V0KTtcblxuICAgICAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVDYWxsRXhwcmVzc2lvbihcbiAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVQcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24oYm9vdHN0cmFwTmFtZXNwYWNlLCAncGxhdGZvcm1Ccm93c2VyJyksXG4gICAgICAgICAgICBub2RlLnR5cGVBcmd1bWVudHMsXG4gICAgICAgICAgICBub2RlLmFyZ3VtZW50cyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdE5vZGUsIGNvbnRleHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGxldCB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKHNvdXJjZUZpbGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG5cbiAgICAgIGlmIChib290c3RyYXBJbXBvcnQpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGFueSB1bnVzZWQgcGxhdGZvcm0gYnJvd3NlciBkeW5hbWljIGltcG9ydHNcbiAgICAgICAgY29uc3QgcmVtb3ZhbHMgPSBlbGlkZUltcG9ydHMoXG4gICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgcmVwbGFjZWROb2RlcyxcbiAgICAgICAgICBnZXRUeXBlQ2hlY2tlcixcbiAgICAgICAgICBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLFxuICAgICAgICApO1xuICAgICAgICBpZiAocmVtb3ZhbHMuc2l6ZSA+IDApIHtcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKFxuICAgICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgICAobm9kZSkgPT4gKHJlbW92YWxzLmhhcyhub2RlKSA/IHVuZGVmaW5lZCA6IG5vZGUpLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIG5ldyBwbGF0Zm9ybSBicm93c2VyIGltcG9ydFxuICAgICAgICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlU291cmNlRmlsZShcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICB0cy5zZXRUZXh0UmFuZ2UoXG4gICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVOb2RlQXJyYXkoW2Jvb3RzdHJhcEltcG9ydCwgLi4udXBkYXRlZFNvdXJjZUZpbGUuc3RhdGVtZW50c10pLFxuICAgICAgICAgICAgc291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdXBkYXRlZFNvdXJjZUZpbGU7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcbn1cbiJdfQ==