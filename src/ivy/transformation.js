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
                        bootstrapImport = nodeFactory.createImportDeclaration(undefined, undefined, nodeFactory.createImportClause(false, undefined, nodeFactory.createNamespaceImport(bootstrapNamespace)), nodeFactory.createStringLiteral('@angular/platform-browser'));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS90cmFuc2Zvcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxpRUFBNkQ7QUFDN0QsK0ZBQXdGO0FBQ3hGLHlFQUFxRTtBQUVyRSxTQUFnQixxQkFBcUIsQ0FDbkMsT0FBMEIsRUFDMUIsT0FBcUU7SUFFckUsTUFBTSxjQUFjLEdBQUcsR0FBRyxFQUFFLENBQUMsT0FBTyxDQUFDLFVBQVUsRUFBRSxDQUFDLGNBQWMsRUFBRSxDQUFDO0lBQ25FLE1BQU0sWUFBWSxHQUEwQjtRQUMxQyxNQUFNLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUMxQyxLQUFLLEVBQUUsRUFBRTtLQUNWLENBQUM7SUFFRixNQUFNLG1CQUFtQixHQUFHLENBQUMsT0FBTyxDQUFDLGlCQUFpQixDQUFDO0lBQ3ZELE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUM7SUFDdkQsSUFBSSxtQkFBbUIsSUFBSSxtQkFBbUIsRUFBRTtRQUM5QyxvRUFBb0U7UUFDcEUsWUFBWSxDQUFDLE1BQU8sQ0FBQyxJQUFJLENBQ3ZCLElBQUEsdURBQXdCLEVBQUMsbUJBQW1CLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxDQUFDLENBQ25GLENBQUM7S0FDSDtJQUVELE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUM7QUFwQkQsc0RBb0JDO0FBRUQsU0FBZ0IscUJBQXFCLENBQ25DLE9BQTBCLEVBQzFCLFdBQW1ELEVBQ25ELE9BRUM7SUFFRCxNQUFNLGNBQWMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsY0FBYyxFQUFFLENBQUM7SUFFbkUsT0FBTztRQUNMLE1BQU0sRUFBRTtZQUNOLElBQUEsb0NBQWdCLEVBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxPQUFPLENBQUMsd0JBQXdCLENBQUM7WUFDOUUsV0FBVyxDQUFDLHVDQUF1QyxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsQ0FBQztTQUMxRTtLQUNGLENBQUM7QUFDSixDQUFDO0FBZkQsc0RBZUM7QUFFRCxTQUFnQixpQkFBaUIsQ0FDL0IsS0FBNEIsRUFDNUIsTUFBNkI7SUFFN0IsTUFBTSxNQUFNLEdBQTBCLEVBQUUsQ0FBQztJQUV6QyxJQUFJLEtBQUssQ0FBQyxNQUFNLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRTtRQUNqQyxNQUFNLENBQUMsTUFBTSxHQUFHLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQztLQUNyRTtJQUVELElBQUksS0FBSyxDQUFDLEtBQUssSUFBSSxNQUFNLENBQUMsS0FBSyxFQUFFO1FBQy9CLE1BQU0sQ0FBQyxLQUFLLEdBQUcsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO0tBQ2xFO0lBRUQsSUFBSSxLQUFLLENBQUMsaUJBQWlCLElBQUksTUFBTSxDQUFDLGlCQUFpQixFQUFFO1FBQ3ZELE1BQU0sQ0FBQyxpQkFBaUIsR0FBRztZQUN6QixHQUFHLENBQUMsS0FBSyxDQUFDLGlCQUFpQixJQUFJLEVBQUUsQ0FBQztZQUNsQyxHQUFHLENBQUMsTUFBTSxDQUFDLGlCQUFpQixJQUFJLEVBQUUsQ0FBQztTQUNwQyxDQUFDO0tBQ0g7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDO0FBdEJELDhDQXNCQztBQUVEOzs7R0FHRztBQUNILE1BQU0sNkJBQTZCLEdBQUcsd0JBQXdCLENBQUM7QUFFL0QsU0FBZ0IsZ0JBQWdCLENBQzlCLGNBQW9DO0lBRXBDLE9BQU8sQ0FBQyxPQUFpQyxFQUFFLEVBQUU7UUFDM0MsSUFBSSxlQUFpRCxDQUFDO1FBQ3RELElBQUksa0JBQTZDLENBQUM7UUFDbEQsTUFBTSxhQUFhLEdBQWMsRUFBRSxDQUFDO1FBQ3BDLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUM7UUFFcEMsTUFBTSxTQUFTLEdBQWUsQ0FBQyxJQUFhLEVBQUUsRUFBRTtZQUM5QyxJQUFJLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxVQUFVLENBQUMsRUFBRTtnQkFDakUsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFDL0IsSUFBSSxNQUFNLENBQUMsSUFBSSxLQUFLLDZCQUE2QixFQUFFO29CQUNqRCxJQUFJLENBQUMsa0JBQWtCLEVBQUU7d0JBQ3ZCLGtCQUFrQixHQUFHLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO3dCQUN4RSxlQUFlLEdBQUcsV0FBVyxDQUFDLHVCQUF1QixDQUNuRCxTQUFTLEVBQ1QsU0FBUyxFQUNULFdBQVcsQ0FBQyxrQkFBa0IsQ0FDNUIsS0FBSyxFQUNMLFNBQVMsRUFDVCxXQUFXLENBQUMscUJBQXFCLENBQUMsa0JBQWtCLENBQUMsQ0FDdEQsRUFDRCxXQUFXLENBQUMsbUJBQW1CLENBQUMsMkJBQTJCLENBQUMsQ0FDN0QsQ0FBQztxQkFDSDtvQkFDRCxhQUFhLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUUzQixPQUFPLFdBQVcsQ0FBQyxvQkFBb0IsQ0FDckMsSUFBSSxFQUNKLFdBQVcsQ0FBQyw4QkFBOEIsQ0FBQyxrQkFBa0IsRUFBRSxpQkFBaUIsQ0FBQyxFQUNqRixJQUFJLENBQUMsYUFBYSxFQUNsQixJQUFJLENBQUMsU0FBUyxDQUNmLENBQUM7aUJBQ0g7YUFDRjtZQUVELE9BQU8sRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQ3JELENBQUMsQ0FBQztRQUVGLE9BQU8sQ0FBQyxVQUF5QixFQUFFLEVBQUU7WUFDbkMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLDZCQUE2QixDQUFDLEVBQUU7Z0JBQzVELE9BQU8sVUFBVSxDQUFDO2FBQ25CO1lBRUQsSUFBSSxpQkFBaUIsR0FBRyxFQUFFLENBQUMsY0FBYyxDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFMUUsSUFBSSxlQUFlLEVBQUU7Z0JBQ25CLHFEQUFxRDtnQkFDckQsTUFBTSxRQUFRLEdBQUcsSUFBQSw0QkFBWSxFQUMzQixpQkFBaUIsRUFDakIsYUFBYSxFQUNiLGNBQWMsRUFDZCxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FDN0IsQ0FBQztnQkFDRixJQUFJLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxFQUFFO29CQUNyQixpQkFBaUIsR0FBRyxFQUFFLENBQUMsY0FBYyxDQUNuQyxpQkFBaUIsRUFDakIsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFDakQsT0FBTyxDQUNSLENBQUM7aUJBQ0g7Z0JBRUQsa0NBQWtDO2dCQUNsQyxPQUFPLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FDakMsaUJBQWlCLEVBQ2pCLEVBQUUsQ0FBQyxZQUFZLENBQ2IsV0FBVyxDQUFDLGVBQWUsQ0FBQyxDQUFDLGVBQWUsRUFBRSxHQUFHLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQy9FLFVBQVUsQ0FBQyxVQUFVLENBQ3RCLENBQ0YsQ0FBQzthQUNIO2lCQUFNO2dCQUNMLE9BQU8saUJBQWlCLENBQUM7YUFDMUI7UUFDSCxDQUFDLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBNUVELDRDQTRFQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IGVsaWRlSW1wb3J0cyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9lbGlkZV9pbXBvcnRzJztcbmltcG9ydCB7IHJlbW92ZUl2eUppdFN1cHBvcnRDYWxscyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9yZW1vdmUtaXZ5LWppdC1zdXBwb3J0LWNhbGxzJztcbmltcG9ydCB7IHJlcGxhY2VSZXNvdXJjZXMgfSBmcm9tICcuLi90cmFuc2Zvcm1lcnMvcmVwbGFjZV9yZXNvdXJjZXMnO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQW90VHJhbnNmb3JtZXJzKFxuICBidWlsZGVyOiB0cy5CdWlsZGVyUHJvZ3JhbSxcbiAgb3B0aW9uczogeyBlbWl0Q2xhc3NNZXRhZGF0YT86IGJvb2xlYW47IGVtaXROZ01vZHVsZVNjb3BlPzogYm9vbGVhbiB9LFxuKTogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzIHtcbiAgY29uc3QgZ2V0VHlwZUNoZWNrZXIgPSAoKSA9PiBidWlsZGVyLmdldFByb2dyYW0oKS5nZXRUeXBlQ2hlY2tlcigpO1xuICBjb25zdCB0cmFuc2Zvcm1lcnM6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyA9IHtcbiAgICBiZWZvcmU6IFtyZXBsYWNlQm9vdHN0cmFwKGdldFR5cGVDaGVja2VyKV0sXG4gICAgYWZ0ZXI6IFtdLFxuICB9O1xuXG4gIGNvbnN0IHJlbW92ZUNsYXNzTWV0YWRhdGEgPSAhb3B0aW9ucy5lbWl0Q2xhc3NNZXRhZGF0YTtcbiAgY29uc3QgcmVtb3ZlTmdNb2R1bGVTY29wZSA9ICFvcHRpb25zLmVtaXROZ01vZHVsZVNjb3BlO1xuICBpZiAocmVtb3ZlQ2xhc3NNZXRhZGF0YSB8fCByZW1vdmVOZ01vZHVsZVNjb3BlKSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICB0cmFuc2Zvcm1lcnMuYmVmb3JlIS5wdXNoKFxuICAgICAgcmVtb3ZlSXZ5Sml0U3VwcG9ydENhbGxzKHJlbW92ZUNsYXNzTWV0YWRhdGEsIHJlbW92ZU5nTW9kdWxlU2NvcGUsIGdldFR5cGVDaGVja2VyKSxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHRyYW5zZm9ybWVycztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUppdFRyYW5zZm9ybWVycyhcbiAgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0sXG4gIGNvbXBpbGVyQ2xpOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKSxcbiAgb3B0aW9uczoge1xuICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZztcbiAgfSxcbik6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyB7XG4gIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gYnVpbGRlci5nZXRQcm9ncmFtKCkuZ2V0VHlwZUNoZWNrZXIoKTtcblxuICByZXR1cm4ge1xuICAgIGJlZm9yZTogW1xuICAgICAgcmVwbGFjZVJlc291cmNlcygoKSA9PiB0cnVlLCBnZXRUeXBlQ2hlY2tlciwgb3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24pLFxuICAgICAgY29tcGlsZXJDbGkuY29uc3RydWN0b3JQYXJhbWV0ZXJzRG93bmxldmVsVHJhbnNmb3JtKGJ1aWxkZXIuZ2V0UHJvZ3JhbSgpKSxcbiAgICBdLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VUcmFuc2Zvcm1lcnMoXG4gIGZpcnN0OiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMsXG4gIHNlY29uZDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzLFxuKTogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzIHtcbiAgY29uc3QgcmVzdWx0OiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMgPSB7fTtcblxuICBpZiAoZmlyc3QuYmVmb3JlIHx8IHNlY29uZC5iZWZvcmUpIHtcbiAgICByZXN1bHQuYmVmb3JlID0gWy4uLihmaXJzdC5iZWZvcmUgfHwgW10pLCAuLi4oc2Vjb25kLmJlZm9yZSB8fCBbXSldO1xuICB9XG5cbiAgaWYgKGZpcnN0LmFmdGVyIHx8IHNlY29uZC5hZnRlcikge1xuICAgIHJlc3VsdC5hZnRlciA9IFsuLi4oZmlyc3QuYWZ0ZXIgfHwgW10pLCAuLi4oc2Vjb25kLmFmdGVyIHx8IFtdKV07XG4gIH1cblxuICBpZiAoZmlyc3QuYWZ0ZXJEZWNsYXJhdGlvbnMgfHwgc2Vjb25kLmFmdGVyRGVjbGFyYXRpb25zKSB7XG4gICAgcmVzdWx0LmFmdGVyRGVjbGFyYXRpb25zID0gW1xuICAgICAgLi4uKGZpcnN0LmFmdGVyRGVjbGFyYXRpb25zIHx8IFtdKSxcbiAgICAgIC4uLihzZWNvbmQuYWZ0ZXJEZWNsYXJhdGlvbnMgfHwgW10pLFxuICAgIF07XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIFRoZSBuYW1lIG9mIHRoZSBBbmd1bGFyIHBsYXRmb3JtIHRoYXQgc2hvdWxkIGJlIHJlcGxhY2VkIHdpdGhpblxuICogYm9vdHN0cmFwIGNhbGwgZXhwcmVzc2lvbnMgdG8gc3VwcG9ydCBBT1QuXG4gKi9cbmNvbnN0IFBMQVRGT1JNX0JST1dTRVJfRFlOQU1JQ19OQU1FID0gJ3BsYXRmb3JtQnJvd3NlckR5bmFtaWMnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVwbGFjZUJvb3RzdHJhcChcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuKTogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+IHtcbiAgcmV0dXJuIChjb250ZXh0OiB0cy5UcmFuc2Zvcm1hdGlvbkNvbnRleHQpID0+IHtcbiAgICBsZXQgYm9vdHN0cmFwSW1wb3J0OiB0cy5JbXBvcnREZWNsYXJhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICBsZXQgYm9vdHN0cmFwTmFtZXNwYWNlOiB0cy5JZGVudGlmaWVyIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IHJlcGxhY2VkTm9kZXM6IHRzLk5vZGVbXSA9IFtdO1xuICAgIGNvbnN0IG5vZGVGYWN0b3J5ID0gY29udGV4dC5mYWN0b3J5O1xuXG4gICAgY29uc3QgdmlzaXROb2RlOiB0cy5WaXNpdG9yID0gKG5vZGU6IHRzLk5vZGUpID0+IHtcbiAgICAgIGlmICh0cy5pc0NhbGxFeHByZXNzaW9uKG5vZGUpICYmIHRzLmlzSWRlbnRpZmllcihub2RlLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IG5vZGUuZXhwcmVzc2lvbjtcbiAgICAgICAgaWYgKHRhcmdldC50ZXh0ID09PSBQTEFURk9STV9CUk9XU0VSX0RZTkFNSUNfTkFNRSkge1xuICAgICAgICAgIGlmICghYm9vdHN0cmFwTmFtZXNwYWNlKSB7XG4gICAgICAgICAgICBib290c3RyYXBOYW1lc3BhY2UgPSBub2RlRmFjdG9yeS5jcmVhdGVVbmlxdWVOYW1lKCdfX05nQ2xpX2Jvb3RzdHJhcF8nKTtcbiAgICAgICAgICAgIGJvb3RzdHJhcEltcG9ydCA9IG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydERlY2xhcmF0aW9uKFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSW1wb3J0Q2xhdXNlKFxuICAgICAgICAgICAgICAgIGZhbHNlLFxuICAgICAgICAgICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVOYW1lc3BhY2VJbXBvcnQoYm9vdHN0cmFwTmFtZXNwYWNlKSxcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlU3RyaW5nTGl0ZXJhbCgnQGFuZ3VsYXIvcGxhdGZvcm0tYnJvd3NlcicpLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVwbGFjZWROb2Rlcy5wdXNoKHRhcmdldCk7XG5cbiAgICAgICAgICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlQ2FsbEV4cHJlc3Npb24oXG4gICAgICAgICAgICBub2RlLFxuICAgICAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlUHJvcGVydHlBY2Nlc3NFeHByZXNzaW9uKGJvb3RzdHJhcE5hbWVzcGFjZSwgJ3BsYXRmb3JtQnJvd3NlcicpLFxuICAgICAgICAgICAgbm9kZS50eXBlQXJndW1lbnRzLFxuICAgICAgICAgICAgbm9kZS5hcmd1bWVudHMsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHMudmlzaXRFYWNoQ2hpbGQobm9kZSwgdmlzaXROb2RlLCBjb250ZXh0KTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB7XG4gICAgICBpZiAoIXNvdXJjZUZpbGUudGV4dC5pbmNsdWRlcyhQTEFURk9STV9CUk9XU0VSX0RZTkFNSUNfTkFNRSkpIHtcbiAgICAgICAgcmV0dXJuIHNvdXJjZUZpbGU7XG4gICAgICB9XG5cbiAgICAgIGxldCB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKHNvdXJjZUZpbGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG5cbiAgICAgIGlmIChib290c3RyYXBJbXBvcnQpIHtcbiAgICAgICAgLy8gUmVtb3ZlIGFueSB1bnVzZWQgcGxhdGZvcm0gYnJvd3NlciBkeW5hbWljIGltcG9ydHNcbiAgICAgICAgY29uc3QgcmVtb3ZhbHMgPSBlbGlkZUltcG9ydHMoXG4gICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgcmVwbGFjZWROb2RlcyxcbiAgICAgICAgICBnZXRUeXBlQ2hlY2tlcixcbiAgICAgICAgICBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLFxuICAgICAgICApO1xuICAgICAgICBpZiAocmVtb3ZhbHMuc2l6ZSA+IDApIHtcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0RWFjaENoaWxkKFxuICAgICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgICAobm9kZSkgPT4gKHJlbW92YWxzLmhhcyhub2RlKSA/IHVuZGVmaW5lZCA6IG5vZGUpLFxuICAgICAgICAgICAgY29udGV4dCxcbiAgICAgICAgICApO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQWRkIG5ldyBwbGF0Zm9ybSBicm93c2VyIGltcG9ydFxuICAgICAgICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlU291cmNlRmlsZShcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICB0cy5zZXRUZXh0UmFuZ2UoXG4gICAgICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVOb2RlQXJyYXkoW2Jvb3RzdHJhcEltcG9ydCwgLi4udXBkYXRlZFNvdXJjZUZpbGUuc3RhdGVtZW50c10pLFxuICAgICAgICAgICAgc291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdXBkYXRlZFNvdXJjZUZpbGU7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcbn1cbiJdfQ==