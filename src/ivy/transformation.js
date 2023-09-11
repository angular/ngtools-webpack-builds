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
const find_image_domains_1 = require("../transformers/find_image_domains");
const remove_ivy_jit_support_calls_1 = require("../transformers/remove-ivy-jit-support-calls");
const replace_resources_1 = require("../transformers/replace_resources");
function createAotTransformers(builder, options, imageDomains) {
    const getTypeChecker = () => builder.getProgram().getTypeChecker();
    const transformers = {
        before: [(0, find_image_domains_1.findImageDomains)(imageDomains), replaceBootstrap(getTypeChecker)],
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
/**
 * The name of the Angular platform that should be replaced within
 * bootstrap call expressions to support AOT.
 */
const PLATFORM_BROWSER_DYNAMIC_NAME = 'platformBrowserDynamic';
function replaceBootstrap(getTypeChecker) {
    return (context) => {
        let bootstrapImport;
        let bootstrapNamespace;
        const replacedNodes = [];
        const nodeFactory = context.factory;
        const visitNode = (node) => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
                const target = node.expression;
                if (target.text === PLATFORM_BROWSER_DYNAMIC_NAME) {
                    if (!bootstrapNamespace) {
                        bootstrapNamespace = nodeFactory.createUniqueName('__NgCli_bootstrap_');
                        bootstrapImport = nodeFactory.createImportDeclaration(undefined, nodeFactory.createImportClause(false, undefined, nodeFactory.createNamespaceImport(bootstrapNamespace)), nodeFactory.createStringLiteral('@angular/platform-browser'));
                    }
                    replacedNodes.push(target);
                    return nodeFactory.updateCallExpression(node, nodeFactory.createPropertyAccessExpression(bootstrapNamespace, 'platformBrowser'), node.typeArguments, node.arguments);
                }
            }
            return ts.visitEachChild(node, visitNode, context);
        };
        return (sourceFile) => {
            if (!sourceFile.text.includes(PLATFORM_BROWSER_DYNAMIC_NAME)) {
                return sourceFile;
            }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS90cmFuc2Zvcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxpRUFBNkQ7QUFDN0QsMkVBQXNFO0FBQ3RFLCtGQUF3RjtBQUN4Rix5RUFBcUU7QUFFckUsU0FBZ0IscUJBQXFCLENBQ25DLE9BQTBCLEVBQzFCLE9BQXFFLEVBQ3JFLFlBQXlCO0lBRXpCLE1BQU0sY0FBYyxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJQUNuRSxNQUFNLFlBQVksR0FBMEI7UUFDMUMsTUFBTSxFQUFFLENBQUMsSUFBQSxxQ0FBZ0IsRUFBQyxZQUFZLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUMxRSxLQUFLLEVBQUUsRUFBRTtLQUNWLENBQUM7SUFFRixNQUFNLG1CQUFtQixHQUFHLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDO0lBQ3ZELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUM7SUFDdkQsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsRUFBRTtRQUM5QyxvRUFBb0U7UUFDcEUsWUFBWSxDQUFDLE1BQU8sQ0FBQyxJQUFJLENBQ3ZCLElBQUEsdURBQXdCLEVBQUMsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxDQUFDLENBQ25GLENBQUM7S0FDSDtJQUVELE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUM7QUFyQkQsc0RBcUJDO0FBRUQsU0FBZ0IscUJBQXFCLENBQ25DLE9BQTBCLEVBQzFCLFdBQW1ELEVBQ25ELE9BRUM7SUFFRCxNQUFNLGNBQWMs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TyxpQkFBaUIsQ0FBQzthQUMxQjtRQUNILENBQUMsQ0FBQztJQUNKLENBQUMsQ0FBQztBQUNKLENBQUM7QUEzRUQsNENBMkVDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgZWxpZGVJbXBvcnRzIH0gZnJvbSAnLi4vdHJhbnNmb3JtZXJzL2VsaWRlX2ltcG9ydHMnO1xuaW1wb3J0IHsgZmluZEltYWdlRG9tYWlucyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9maW5kX2ltYWdlX2RvbWFpbnMnO1xuaW1wb3J0IHsgcmVtb3ZlSXZ5Sml0U3VwcG9ydENhbGxzIH0gZnJvbSAnLi4vdHJhbnNmb3JtZXJzL3JlbW92ZS1pdnktaml0LXN1cHBvcnQtY2FsbHMnO1xuaW1wb3J0IHsgcmVwbGFjZVJlc291cmNlcyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcyc7XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBb3RUcmFuc2Zvcm1lcnMoXG4gIGJ1aWxkZXI6IHRzLkJ1aWxkZXJQcm9ncmFtLFxuICBvcHRpb25zOiB7IGVtaXRDbGFzc01ldGFkYXRhPzogYm9vbGVhbjsgZW1pdE5nTW9kdWxlU2NvcGU/OiBib29sZWFuIH0sXG4gIGltYWdlRG9tYWluczogU2V0PHN0cmluZz4sXG4pOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMge1xuICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+IGJ1aWxkZXIuZ2V0UHJvZ3JhbSgpLmdldFR5cGVDaGVja2VyKCk7XG4gIGNvbnN0IHRyYW5zZm9ybWVyczogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzID0ge1xuICAgIGJlZm9yZTogW2ZpbmRJbWFnZURvbWFpbnMoaW1hZ2VEb21haW5zKSwgcmVwbGFjZUJvb3RzdHJhcChnZXRUeXBlQ2hlY2tlcildLFxuICAgIGFmdGVyOiBbXSxcbiAgfTtcblxuICBjb25zdCByZW1vdmVDbGFzc01ldGFkYXRhID0gIW9wdGlvbnMuZW1pdENsYXNzTWV0YWRhdGE7XG4gIGNvbnN0IHJlbW92ZU5nTW9kdWxlU2NvcGUgPSAhb3B0aW9ucy5lbWl0TmdNb2R1bGVTY29wZTtcbiAgaWYgKHJlbW92ZUNsYXNzTWV0YWRhdGEgfHwgcmVtb3ZlTmdNb2R1bGVTY29wZSkge1xuICAgIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tbm9uLW51bGwtYXNzZXJ0aW9uXG4gICAgdHJhbnNmb3JtZXJzLmJlZm9yZSEucHVzaChcbiAgICAgIHJlbW92ZUl2eUppdFN1cHBvcnRDYWxscyhyZW1vdmVDbGFzc01ldGFkYXRhLCByZW1vdmVOZ01vZHVsZVNjb3BlLCBnZXRUeXBlQ2hlY2tlciksXG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiB0cmFuc2Zvcm1lcnM7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVKaXRUcmFuc2Zvcm1lcnMoXG4gIGJ1aWxkZXI6IHRzLkJ1aWxkZXJQcm9ncmFtLFxuICBjb21waWxlckNsaTogdHlwZW9mIGltcG9ydCgnQGFuZ3VsYXIvY29tcGlsZXItY2xpJyksXG4gIG9wdGlvbnM6IHtcbiAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmc7XG4gIH0sXG4pOiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMge1xuICBjb25zdCBnZXRUeXBlQ2hlY2tlciA9ICgpID0+IGJ1aWxkZXIuZ2V0UHJvZ3JhbSgpLmdldFR5cGVDaGVja2VyKCk7XG5cbiAgcmV0dXJuIHtcbiAgICBiZWZvcmU6IFtcbiAgICAgIHJlcGxhY2VSZXNvdXJjZXMoKCkgPT4gdHJ1ZSwgZ2V0VHlwZUNoZWNrZXIsIG9wdGlvbnMuaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uKSxcbiAgICAgIGNvbXBpbGVyQ2xpLmNvbnN0cnVjdG9yUGFyYW1ldGVyc0Rvd25sZXZlbFRyYW5zZm9ybShidWlsZGVyLmdldFByb2dyYW0oKSksXG4gICAgXSxcbiAgfTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1lcmdlVHJhbnNmb3JtZXJzKFxuICBmaXJzdDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzLFxuICBzZWNvbmQ6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyxcbik6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyB7XG4gIGNvbnN0IHJlc3VsdDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzID0ge307XG5cbiAgaWYgKGZpcnN0LmJlZm9yZSB8fCBzZWNvbmQuYmVmb3JlKSB7XG4gICAgcmVzdWx0LmJlZm9yZSA9IFsuLi4oZmlyc3QuYmVmb3JlIHx8IFtdKSwgLi4uKHNlY29uZC5iZWZvcmUgfHwgW10pXTtcbiAgfVxuXG4gIGlmIChmaXJzdC5hZnRlciB8fCBzZWNvbmQuYWZ0ZXIpIHtcbiAgICByZXN1bHQuYWZ0ZXIgPSBbLi4uKGZpcnN0LmFmdGVyIHx8IFtdKSwgLi4uKHNlY29uZC5hZnRlciB8fCBbXSldO1xuICB9XG5cbiAgaWYgKGZpcnN0LmFmdGVyRGVjbGFyYXRpb25zIHx8IHNlY29uZC5hZnRlckRlY2xhcmF0aW9ucykge1xuICAgIHJlc3VsdC5hZnRlckRlY2xhcmF0aW9ucyA9IFtcbiAgICAgIC4uLihmaXJzdC5hZnRlckRlY2xhcmF0aW9ucyB8fCBbXSksXG4gICAgICAuLi4oc2Vjb25kLmFmdGVyRGVjbGFyYXRpb25zIHx8IFtdKSxcbiAgICBdO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyoqXG4gKiBUaGUgbmFtZSBvZiB0aGUgQW5ndWxhciBwbGF0Zm9ybSB0aGF0IHNob3VsZCBiZSByZXBsYWNlZCB3aXRoaW5cbiAqIGJvb3RzdHJhcCBjYWxsIGV4cHJlc3Npb25zIHRvIHN1cHBvcnQgQU9ULlxuICovXG5jb25zdCBQTEFURk9STV9CUk9XU0VSX0RZTkFNSUNfTkFNRSA9ICdwbGF0Zm9ybUJyb3dzZXJEeW5hbWljJztcblxuZXhwb3J0IGZ1bmN0aW9uIHJlcGxhY2VCb290c3RyYXAoXG4gIGdldFR5cGVDaGVja2VyOiAoKSA9PiB0cy5UeXBlQ2hlY2tlcixcbik6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPiB7XG4gIHJldHVybiAoY29udGV4dDogdHMuVHJhbnNmb3JtYXRpb25Db250ZXh0KSA9PiB7XG4gICAgbGV0IGJvb3RzdHJhcEltcG9ydDogdHMuSW1wb3J0RGVjbGFyYXRpb24gfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJvb3RzdHJhcE5hbWVzcGFjZTogdHMuSWRlbnRpZmllciB8IHVuZGVmaW5lZDtcbiAgICBjb25zdCByZXBsYWNlZE5vZGVzOiB0cy5Ob2RlW10gPSBbXTtcbiAgICBjb25zdCBub2RlRmFjdG9yeSA9IGNvbnRleHQuZmFjdG9yeTtcblxuICAgIGNvbnN0IHZpc2l0Tm9kZTogdHMuVmlzaXRvciA9IChub2RlOiB0cy5Ob2RlKSA9PiB7XG4gICAgICBpZiAodHMuaXNDYWxsRXhwcmVzc2lvbihub2RlKSAmJiB0cy5pc0lkZW50aWZpZXIobm9kZS5leHByZXNzaW9uKSkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBub2RlLmV4cHJlc3Npb247XG4gICAgICAgIGlmICh0YXJnZXQudGV4dCA9PT0gUExBVEZPUk1fQlJPV1NFUl9EWU5BTUlDX05BTUUpIHtcbiAgICAgICAgICBpZiAoIWJvb3RzdHJhcE5hbWVzcGFjZSkge1xuICAgICAgICAgICAgYm9vdHN0cmFwTmFtZXNwYWNlID0gbm9kZUZhY3RvcnkuY3JlYXRlVW5pcXVlTmFtZSgnX19OZ0NsaV9ib290c3RyYXBfJyk7XG4gICAgICAgICAgICBib290c3RyYXBJbXBvcnQgPSBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnREZWNsYXJhdGlvbihcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnRDbGF1c2UoXG4gICAgICAgICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZU5hbWVzcGFjZUltcG9ydChib290c3RyYXBOYW1lc3BhY2UpLFxuICAgICAgICAgICAgICApLFxuICAgICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVTdHJpbmdMaXRlcmFsKCdAYW5ndWxhci9wbGF0Zm9ybS1icm93c2VyJyksXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXBsYWNlZE5vZGVzLnB1c2godGFyZ2V0KTtcblxuICAgICAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVDYWxsRXhwcmVzc2lvbihcbiAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVQcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24oYm9vdHN0cmFwTmFtZXNwYWNlLCAncGxhdGZvcm1Ccm93c2VyJyksXG4gICAgICAgICAgICBub2RlLnR5cGVBcmd1bWVudHMsXG4gICAgICAgICAgICBub2RlLmFyZ3VtZW50cyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdE5vZGUsIGNvbnRleHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGlmICghc291cmNlRmlsZS50ZXh0LmluY2x1ZGVzKFBMQVRGT1JNX0JST1dTRVJfRFlOQU1JQ19OQU1FKSkge1xuICAgICAgICByZXR1cm4gc291cmNlRmlsZTtcbiAgICAgIH1cblxuICAgICAgbGV0IHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoc291cmNlRmlsZSwgdmlzaXROb2RlLCBjb250ZXh0KTtcblxuICAgICAgaWYgKGJvb3RzdHJhcEltcG9ydCkge1xuICAgICAgICAvLyBSZW1vdmUgYW55IHVudXNlZCBwbGF0Zm9ybSBicm93c2VyIGR5bmFtaWMgaW1wb3J0c1xuICAgICAgICBjb25zdCByZW1vdmFscyA9IGVsaWRlSW1wb3J0cyhcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICByZXBsYWNlZE5vZGVzLFxuICAgICAgICAgIGdldFR5cGVDaGVja2VyLFxuICAgICAgICAgIGNvbnRleHQuZ2V0Q29tcGlsZXJPcHRpb25zKCksXG4gICAgICAgICk7XG4gICAgICAgIGlmIChyZW1vdmFscy5zaXplID4gMCkge1xuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoXG4gICAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICAgIChub2RlKSA9PiAocmVtb3ZhbHMuaGFzKG5vZGUpID8gdW5kZWZpbmVkIDogbm9kZSksXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgbmV3IHBsYXRmb3JtIGJyb3dzZXIgaW1wb3J0XG4gICAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVTb3VyY2VGaWxlKFxuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLFxuICAgICAgICAgIHRzLnNldFRleHRSYW5nZShcbiAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbYm9vdHN0cmFwSW1wb3J0LCAuLi51cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzXSksXG4gICAgICAgICAgICBzb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB1cGRhdGVkU291cmNlRmlsZTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xufVxuIl19