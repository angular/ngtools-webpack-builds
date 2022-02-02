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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHJhbnNmb3JtYXRpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL2l2eS90cmFuc2Zvcm1hdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsK0NBQWlDO0FBQ2pDLGlFQUE2RDtBQUM3RCwrRkFBd0Y7QUFDeEYseUVBQXFFO0FBRXJFLFNBQWdCLHFCQUFxQixDQUNuQyxPQUEwQixFQUMxQixPQUFxRTtJQUVyRSxNQUFNLGNBQWMsR0FBRyxHQUFHLEVBQUUsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUMsY0FBYyxFQUFFLENBQUM7SUFDbkUsTUFBTSxZQUFZLEdBQTBCO1FBQzFDLE1BQU0sRUFBRSxDQUFDLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBQzFDLEtBQUssRUFBRSxFQUFFO0tBQ1YsQ0FBQztJQUVGLE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxPQUFPLENBQUMsaUJBQWlCLENBQUM7SUFDdkQsTUFBTSxtQkFBbUIsR0FBRyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztJQUN2RCxJQUFJLG1CQUFtQixJQUFJLG1CQUFtQixFQUFFO1FBQzlDLG9FQUFvRTtRQUNwRSxZQUFZLENBQUMsTUFBTyxDQUFDLElBQUksQ0FDdkIsSUFBQSx1REFBd0IsRUFBQyxtQkFBbUIsRUFBRSxtQkFBbUIsRUFBRSxjQUFjLENBQUMsQ0FDbkYsQ0FBQztLQUNIO0lBRUQsT0FBTyxZQUFZLENBQUM7QUFDdEIsQ0FBQztBQXBCRCxzREFvQkM7QUFFRCxTQUFnQixxQkFBcUIsQ0FDbkMsT0FBMEIsRUFDMUIsV0FBbUQsRUFDbkQsT0FFQztJQUVELE1BQU0sY0FBYyxHQUFHLEdBQUcsRUFBRSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJ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LE9BQU8sQ0FBQyxDQUFDO1FBQ3JELENBQUMsQ0FBQztRQUVGLE9BQU8sQ0FBQyxVQUF5QixFQUFFLEVBQUU7WUFDbkMsSUFBSSxpQkFBaUIsR0FBRyxFQUFFLENBQUMsY0FBYyxDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFMUUsSUFBSSxlQUFlLEVBQUU7Z0JBQ25CLHFEQUFxRDtnQkFDckQsTUFBTSxRQUFRLEdBQUcsSUFBQSw0QkFBWSxFQUMzQixpQkFBaUIsRUFDakIsYUFBYSxFQUNiLGNBQWMsRUFDZCxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FDN0IsQ0FBQztnQkFDRixJQUFJLFFBQVEsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxFQUFFO29CQUNyQixpQkFBaUIsR0FBRyxFQUFFLENBQUMsY0FBYyxDQUNuQyxpQkFBaUIsRUFDakIsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFDakQsT0FBTyxDQUNSLENBQUM7aUJBQ0g7Z0JBRUQsa0NBQWtDO2dCQUNsQyxPQUFPLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FDakMsaUJBQWlCLEVBQ2pCLEVBQUUsQ0FBQyxZQUFZLENBQ2IsV0FBVyxDQUFDLGVBQWUsQ0FBQyxDQUFDLGVBQWUsRUFBRSxHQUFHLGlCQUFpQixDQUFDLFVBQVUsQ0FBQyxDQUFDLEVBQy9FLFVBQVUsQ0FBQyxVQUFVLENBQ3RCLENBQ0YsQ0FBQzthQUNIO2lCQUFNO2dCQUNMLE9BQU8saUJBQWlCLENBQUM7YUFDMUI7UUFDSCxDQUFDLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBeEVELDRDQXdFQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IGVsaWRlSW1wb3J0cyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9lbGlkZV9pbXBvcnRzJztcbmltcG9ydCB7IHJlbW92ZUl2eUppdFN1cHBvcnRDYWxscyB9IGZyb20gJy4uL3RyYW5zZm9ybWVycy9yZW1vdmUtaXZ5LWppdC1zdXBwb3J0LWNhbGxzJztcbmltcG9ydCB7IHJlcGxhY2VSZXNvdXJjZXMgfSBmcm9tICcuLi90cmFuc2Zvcm1lcnMvcmVwbGFjZV9yZXNvdXJjZXMnO1xuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQW90VHJhbnNmb3JtZXJzKFxuICBidWlsZGVyOiB0cy5CdWlsZGVyUHJvZ3JhbSxcbiAgb3B0aW9uczogeyBlbWl0Q2xhc3NNZXRhZGF0YT86IGJvb2xlYW47IGVtaXROZ01vZHVsZVNjb3BlPzogYm9vbGVhbiB9LFxuKTogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzIHtcbiAgY29uc3QgZ2V0VHlwZUNoZWNrZXIgPSAoKSA9PiBidWlsZGVyLmdldFByb2dyYW0oKS5nZXRUeXBlQ2hlY2tlcigpO1xuICBjb25zdCB0cmFuc2Zvcm1lcnM6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyA9IHtcbiAgICBiZWZvcmU6IFtyZXBsYWNlQm9vdHN0cmFwKGdldFR5cGVDaGVja2VyKV0sXG4gICAgYWZ0ZXI6IFtdLFxuICB9O1xuXG4gIGNvbnN0IHJlbW92ZUNsYXNzTWV0YWRhdGEgPSAhb3B0aW9ucy5lbWl0Q2xhc3NNZXRhZGF0YTtcbiAgY29uc3QgcmVtb3ZlTmdNb2R1bGVTY29wZSA9ICFvcHRpb25zLmVtaXROZ01vZHVsZVNjb3BlO1xuICBpZiAocmVtb3ZlQ2xhc3NNZXRhZGF0YSB8fCByZW1vdmVOZ01vZHVsZVNjb3BlKSB7XG4gICAgLy8gZXNsaW50LWRpc2FibGUtbmV4dC1saW5lIEB0eXBlc2NyaXB0LWVzbGludC9uby1ub24tbnVsbC1hc3NlcnRpb25cbiAgICB0cmFuc2Zvcm1lcnMuYmVmb3JlIS5wdXNoKFxuICAgICAgcmVtb3ZlSXZ5Sml0U3VwcG9ydENhbGxzKHJlbW92ZUNsYXNzTWV0YWRhdGEsIHJlbW92ZU5nTW9kdWxlU2NvcGUsIGdldFR5cGVDaGVja2VyKSxcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHRyYW5zZm9ybWVycztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUppdFRyYW5zZm9ybWVycyhcbiAgYnVpbGRlcjogdHMuQnVpbGRlclByb2dyYW0sXG4gIGNvbXBpbGVyQ2xpOiB0eXBlb2YgaW1wb3J0KCdAYW5ndWxhci9jb21waWxlci1jbGknKSxcbiAgb3B0aW9uczoge1xuICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZztcbiAgfSxcbik6IHRzLkN1c3RvbVRyYW5zZm9ybWVycyB7XG4gIGNvbnN0IGdldFR5cGVDaGVja2VyID0gKCkgPT4gYnVpbGRlci5nZXRQcm9ncmFtKCkuZ2V0VHlwZUNoZWNrZXIoKTtcblxuICByZXR1cm4ge1xuICAgIGJlZm9yZTogW1xuICAgICAgcmVwbGFjZVJlc291cmNlcygoKSA9PiB0cnVlLCBnZXRUeXBlQ2hlY2tlciwgb3B0aW9ucy5pbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24pLFxuICAgICAgY29tcGlsZXJDbGkuY29uc3RydWN0b3JQYXJhbWV0ZXJzRG93bmxldmVsVHJhbnNmb3JtKGJ1aWxkZXIuZ2V0UHJvZ3JhbSgpKSxcbiAgICBdLFxuICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VUcmFuc2Zvcm1lcnMoXG4gIGZpcnN0OiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMsXG4gIHNlY29uZDogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzLFxuKTogdHMuQ3VzdG9tVHJhbnNmb3JtZXJzIHtcbiAgY29uc3QgcmVzdWx0OiB0cy5DdXN0b21UcmFuc2Zvcm1lcnMgPSB7fTtcblxuICBpZiAoZmlyc3QuYmVmb3JlIHx8IHNlY29uZC5iZWZvcmUpIHtcbiAgICByZXN1bHQuYmVmb3JlID0gWy4uLihmaXJzdC5iZWZvcmUgfHwgW10pLCAuLi4oc2Vjb25kLmJlZm9yZSB8fCBbXSldO1xuICB9XG5cbiAgaWYgKGZpcnN0LmFmdGVyIHx8IHNlY29uZC5hZnRlcikge1xuICAgIHJlc3VsdC5hZnRlciA9IFsuLi4oZmlyc3QuYWZ0ZXIgfHwgW10pLCAuLi4oc2Vjb25kLmFmdGVyIHx8IFtdKV07XG4gIH1cblxuICBpZiAoZmlyc3QuYWZ0ZXJEZWNsYXJhdGlvbnMgfHwgc2Vjb25kLmFmdGVyRGVjbGFyYXRpb25zKSB7XG4gICAgcmVzdWx0LmFmdGVyRGVjbGFyYXRpb25zID0gW1xuICAgICAgLi4uKGZpcnN0LmFmdGVyRGVjbGFyYXRpb25zIHx8IFtdKSxcbiAgICAgIC4uLihzZWNvbmQuYWZ0ZXJEZWNsYXJhdGlvbnMgfHwgW10pLFxuICAgIF07XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVwbGFjZUJvb3RzdHJhcChcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuKTogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+IHtcbiAgcmV0dXJuIChjb250ZXh0OiB0cy5UcmFuc2Zvcm1hdGlvbkNvbnRleHQpID0+IHtcbiAgICBsZXQgYm9vdHN0cmFwSW1wb3J0OiB0cy5JbXBvcnREZWNsYXJhdGlvbiB8IHVuZGVmaW5lZDtcbiAgICBsZXQgYm9vdHN0cmFwTmFtZXNwYWNlOiB0cy5JZGVudGlmaWVyIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IHJlcGxhY2VkTm9kZXM6IHRzLk5vZGVbXSA9IFtdO1xuICAgIGNvbnN0IG5vZGVGYWN0b3J5ID0gY29udGV4dC5mYWN0b3J5O1xuXG4gICAgY29uc3QgdmlzaXROb2RlOiB0cy5WaXNpdG9yID0gKG5vZGU6IHRzLk5vZGUpID0+IHtcbiAgICAgIGlmICh0cy5pc0NhbGxFeHByZXNzaW9uKG5vZGUpICYmIHRzLmlzSWRlbnRpZmllcihub2RlLmV4cHJlc3Npb24pKSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IG5vZGUuZXhwcmVzc2lvbjtcbiAgICAgICAgaWYgKHRhcmdldC50ZXh0ID09PSAncGxhdGZvcm1Ccm93c2VyRHluYW1pYycpIHtcbiAgICAgICAgICBpZiAoIWJvb3RzdHJhcE5hbWVzcGFjZSkge1xuICAgICAgICAgICAgYm9vdHN0cmFwTmFtZXNwYWNlID0gbm9kZUZhY3RvcnkuY3JlYXRlVW5pcXVlTmFtZSgnX19OZ0NsaV9ib290c3RyYXBfJyk7XG4gICAgICAgICAgICBib290c3RyYXBJbXBvcnQgPSBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnREZWNsYXJhdGlvbihcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydENsYXVzZShcbiAgICAgICAgICAgICAgICBmYWxzZSxcbiAgICAgICAgICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgICAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlTmFtZXNwYWNlSW1wb3J0KGJvb3RzdHJhcE5hbWVzcGFjZSksXG4gICAgICAgICAgICAgICksXG4gICAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZVN0cmluZ0xpdGVyYWwoJ0Bhbmd1bGFyL3BsYXRmb3JtLWJyb3dzZXInKSxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlcGxhY2VkTm9kZXMucHVzaCh0YXJnZXQpO1xuXG4gICAgICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZUNhbGxFeHByZXNzaW9uKFxuICAgICAgICAgICAgbm9kZSxcbiAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZVByb3BlcnR5QWNjZXNzRXhwcmVzc2lvbihib290c3RyYXBOYW1lc3BhY2UsICdwbGF0Zm9ybUJyb3dzZXInKSxcbiAgICAgICAgICAgIG5vZGUudHlwZUFyZ3VtZW50cyxcbiAgICAgICAgICAgIG5vZGUuYXJndW1lbnRzLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG4gICAgfTtcblxuICAgIHJldHVybiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgbGV0IHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoc291cmNlRmlsZSwgdmlzaXROb2RlLCBjb250ZXh0KTtcblxuICAgICAgaWYgKGJvb3RzdHJhcEltcG9ydCkge1xuICAgICAgICAvLyBSZW1vdmUgYW55IHVudXNlZCBwbGF0Zm9ybSBicm93c2VyIGR5bmFtaWMgaW1wb3J0c1xuICAgICAgICBjb25zdCByZW1vdmFscyA9IGVsaWRlSW1wb3J0cyhcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICByZXBsYWNlZE5vZGVzLFxuICAgICAgICAgIGdldFR5cGVDaGVja2VyLFxuICAgICAgICAgIGNvbnRleHQuZ2V0Q29tcGlsZXJPcHRpb25zKCksXG4gICAgICAgICk7XG4gICAgICAgIGlmIChyZW1vdmFscy5zaXplID4gMCkge1xuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXRFYWNoQ2hpbGQoXG4gICAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICAgIChub2RlKSA9PiAocmVtb3ZhbHMuaGFzKG5vZGUpID8gdW5kZWZpbmVkIDogbm9kZSksXG4gICAgICAgICAgICBjb250ZXh0LFxuICAgICAgICAgICk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBBZGQgbmV3IHBsYXRmb3JtIGJyb3dzZXIgaW1wb3J0XG4gICAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVTb3VyY2VGaWxlKFxuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLFxuICAgICAgICAgIHRzLnNldFRleHRSYW5nZShcbiAgICAgICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbYm9vdHN0cmFwSW1wb3J0LCAuLi51cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzXSksXG4gICAgICAgICAgICBzb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB1cGRhdGVkU291cmNlRmlsZTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xufVxuIl19