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
exports.getResourceUrl = exports.replaceResources = exports.NG_COMPONENT_RESOURCE_QUERY = void 0;
const ts = __importStar(require("typescript"));
const inline_resource_1 = require("../loaders/inline-resource");
exports.NG_COMPONENT_RESOURCE_QUERY = 'ngResource';
function replaceResources(shouldTransform, getTypeChecker, inlineStyleFileExtension) {
    return (context) => {
        const typeChecker = getTypeChecker();
        const resourceImportDeclarations = [];
        const moduleKind = context.getCompilerOptions().module;
        const nodeFactory = context.factory;
        const visitNode = (node) => {
            if (ts.isClassDeclaration(node)) {
                const decorators = ts.visitNodes(node.decorators, (node) => ts.isDecorator(node)
                    ? visitDecorator(nodeFactory, node, typeChecker, resourceImportDeclarations, moduleKind, inlineStyleFileExtension)
                    : node);
                return nodeFactory.updateClassDeclaration(node, decorators, node.modifiers, node.name, node.typeParameters, node.heritageClauses, node.members);
            }
            return ts.visitEachChild(node, visitNode, context);
        };
        return (sourceFile) => {
            if (!shouldTransform(sourceFile.fileName)) {
                return sourceFile;
            }
            const updatedSourceFile = ts.visitNode(sourceFile, visitNode);
            if (resourceImportDeclarations.length) {
                // Add resource imports
                return context.factory.updateSourceFile(updatedSourceFile, ts.setTextRange(context.factory.createNodeArray([
                    ...resourceImportDeclarations,
                    ...updatedSourceFile.statements,
                ]), updatedSourceFile.statements));
            }
            return updatedSourceFile;
        };
    };
}
exports.replaceResources = replaceResources;
function visitDecorator(nodeFactory, node, typeChecker, resourceImportDeclarations, moduleKind, inlineStyleFileExtension) {
    if (!isComponentDecorator(node, typeChecker)) {
        return node;
    }
    if (!ts.isCallExpression(node.expression)) {
        return node;
    }
    const decoratorFactory = node.expression;
    const args = decoratorFactory.arguments;
    if (args.length !== 1 || !ts.isObjectLiteralExpression(args[0])) {
        // Unsupported component metadata
        return node;
    }
    const objectExpression = args[0];
    const styleReplacements = [];
    // visit all properties
    let properties = ts.visitNodes(objectExpression.properties, (node) => ts.isObjectLiteralElementLike(node)
        ? visitComponentMetadata(nodeFactory, node, styleReplacements, resourceImportDeclarations, moduleKind, inlineStyleFileExtension)
        : node);
    // replace properties with updated properties
    if (styleReplacements.length > 0) {
        const styleProperty = nodeFactory.createPropertyAssignment(nodeFactory.createIdentifier('styles'), nodeFactory.createArrayLiteralExpression(styleReplacements));
        properties = nodeFactory.createNodeArray([...properties, styleProperty]);
    }
    return nodeFactory.updateDecorator(node, nodeFactory.updateCallExpression(decoratorFactory, decoratorFactory.expression, decoratorFactory.typeArguments, [nodeFactory.updateObjectLiteralExpression(objectExpression, properties)]));
}
function visitComponentMetadata(nodeFactory, node, styleReplacements, resourceImportDeclarations, moduleKind = ts.ModuleKind.ES2015, inlineStyleFileExtension) {
    if (!ts.isPropertyAssignment(node) || ts.isComputedPropertyName(node.name)) {
        return node;
    }
    const name = node.name.text;
    switch (name) {
        case 'moduleId':
            return undefined;
        case 'templateUrl':
            const url = getResourceUrl(node.initializer);
            if (!url) {
                return node;
            }
            const importName = createResourceImport(nodeFactory, url, resourceImportDeclarations, moduleKind);
            if (!importName) {
                return node;
            }
            return nodeFactory.updatePropertyAssignment(node, nodeFactory.createIdentifier('template'), importName);
        case 'styles':
        case 'styleUrls':
            if (!ts.isArrayLiteralExpression(node.initializer)) {
                return node;
            }
            const isInlineStyle = name === 'styles';
            const styles = ts.visitNodes(node.initializer.elements, (node) => {
                if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
                    return node;
                }
                let url;
                if (isInlineStyle) {
                    if (inlineStyleFileExtension) {
                        const data = Buffer.from(node.text).toString('base64');
                        const containingFile = node.getSourceFile().fileName;
                        // app.component.ts.css?ngResource!=!@ngtools/webpack/src/loaders/inline-resource.js?data=...!app.component.ts
                        url =
                            `${containingFile}.${inlineStyleFileExtension}?${exports.NG_COMPONENT_RESOURCE_QUERY}` +
                                `!=!${inline_resource_1.InlineAngularResourceLoaderPath}?data=${encodeURIComponent(data)}!${containingFile}`;
                    }
                    else {
                        return nodeFactory.createStringLiteral(node.text);
                    }
                }
                else {
                    url = getResourceUrl(node);
                }
                if (!url) {
                    return node;
                }
                return createResourceImport(nodeFactory, url, resourceImportDeclarations, moduleKind);
            });
            // Styles should be placed first
            if (isInlineStyle) {
                styleReplacements.unshift(...styles);
            }
            else {
                styleReplacements.push(...styles);
            }
            return undefined;
        default:
            return node;
    }
}
function getResourceUrl(node) {
    // only analyze strings
    if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) {
        return null;
    }
    return `${/^\.?\.\//.test(node.text) ? '' : './'}${node.text}?${exports.NG_COMPONENT_RESOURCE_QUERY}`;
}
exports.getResourceUrl = getResourceUrl;
function isComponentDecorator(node, typeChecker) {
    if (!ts.isDecorator(node)) {
        return false;
    }
    const origin = getDecoratorOrigin(node, typeChecker);
    if (origin && origin.module === '@angular/core' && origin.name === 'Component') {
        return true;
    }
    return false;
}
function createResourceImport(nodeFactory, url, resourceImportDeclarations, moduleKind) {
    const urlLiteral = nodeFactory.createStringLiteral(url);
    if (moduleKind < ts.ModuleKind.ES2015) {
        return nodeFactory.createCallExpression(nodeFactory.createIdentifier('require'), [], [urlLiteral]);
    }
    else {
        const importName = nodeFactory.createIdentifier(`__NG_CLI_RESOURCE__${resourceImportDeclarations.length}`);
        resourceImportDeclarations.push(nodeFactory.createImportDeclaration(undefined, undefined, nodeFactory.createImportClause(false, importName, undefined), urlLiteral));
        return importName;
    }
}
function getDecoratorOrigin(decorator, typeChecker) {
    if (!ts.isCallExpression(decorator.expression)) {
        return null;
    }
    let identifier;
    let name = '';
    if (ts.isPropertyAccessExpression(decorator.expression.expression)) {
        identifier = decorator.expression.expression.expression;
        name = decorator.expression.expression.name.text;
    }
    else if (ts.isIdentifier(decorator.expression.expression)) {
        identifier = decorator.expression.expression;
    }
    else {
        return null;
    }
    // NOTE: resolver.getReferencedImportDeclaration would work as well but is internal
    const symbol = typeChecker.getSymbolAtLocation(identifier);
    if (symbol && symbol.declarations && symbol.declarations.length > 0) {
        const declaration = symbol.declarations[0];
        let module;
        if (ts.isImportSpecifier(declaration)) {
            name = (declaration.propertyName || declaration.name).text;
            module = declaration.parent.parent.parent.moduleSpecifier.text;
        }
        else if (ts.isNamespaceImport(declaration)) {
            // Use the name from the decorator namespace property access
            module = declaration.parent.parent.moduleSpecifier.text;
        }
        else if (ts.isImportClause(declaration)) {
            name = declaration.name.text;
            module = declaration.parent.moduleSpecifier.text;
        }
        else {
            return null;
        }
        return { name, module };
    }
    return null;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwbGFjZV9yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsK0NBQWlDO0FBQ2pDLGdFQUE2RTtBQUVoRSxRQUFBLDJCQUEyQixHQUFHLFlBQVksQ0FBQztBQUV4RCxTQUFnQixnQkFBZ0IsQ0FDOUIsZUFBOEMsRUFDOUMsY0FBb0MsRUFDcEMsd0JBQWlDO0lBRWpDLE9BQU8sQ0FBQyxPQUFpQyxFQUFFLEVBQUU7UUFDM0MsTUFBTSxXQUFXLEdBQUcsY0FBYyxFQUFFLENBQUM7UUFDckMsTUFBTSwwQkFBMEIsR0FBMkIsRUFBRSxDQUFDO1FBQzlELE1BQU0sVUFBVSxHQUFHLE9BQU8sQ0FBQyxrQkFBa0IsRUFBRSxDQUFDLE1BQU0sQ0FBQztRQUN2RCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDO1FBRXBDLE1BQU0sU0FBUyxHQUFlLENBQUMsSUFBYSxFQUFFLEVBQUU7WUFDOUMsSUFBSSxFQUFFLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLEVBQUU7Z0JBQy9CLE1BQU0sVUFBVSxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFLENBQ3pELEVBQUUsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO29CQUNsQixDQUFDLENBQUMsY0FBYyxDQUNaLFdBQVcsRUFDWCxJQUFJLEVBQ0osV0FBVyxFQUNYLDBCQUEwQixFQUMxQixVQUFVLEVBQ1Ysd0JBQXdCLENBQ3pCO29CQUNILENBQUMsQ0FBQyxJQUFJLENBQ1QsQ0FBQztnQkFFRixPQUFPLFdBQVcsQ0FBQyxzQkFBc0IsQ0FDdkMsSUFBSSxFQUNKLFVBQVUsRUFDVixJQUFJLENBQUMsU0FBUyxFQUNkLElBQUksQ0FBQyxJQUFJLEVBQ1QsSUFBSSxDQUFDLGNBQWMsRUFDbkIsSUFBSSxDQUFDLGVBQWUsRUFDcEIsSUFBSSxDQUFDLE9BQU8sQ0FDYixDQUFDO2FBQ0g7WUFFRCxPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNyRCxDQUFDLENBQUM7UUFFRixPQUFPLENBQUMsVUFBeUIsRUFBRSxFQUFFO1lBQ25DLElBQUksQ0FBQyxlQUFlLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxFQUFFO2dCQUN6QyxPQUFPLFVBQVUsQ0FBQzthQUNuQjtZQUVELE1BQU0saUJBQWlCLEdBQUcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUM7WUFDOUQsSUFBSSwwQkFBMEIsQ0FBQyxNQUFNLEVBQUU7Z0JBQ3JDLHVCQUF1QjtnQkFDdkIsT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUNyQyxpQkFBaUIsRUFDakIsRUFBRSxDQUFDLFlBQVksQ0FDYixPQUFPLENBQUMsT0FBTyxDQUFDLGVBQWUsQ0FBQztvQkFDOUIsR0FBRywwQkFBMEI7b0JBQzdCLEdBQUcsaUJBQWlCLENBQUMsVUFBVTtpQkFDaEMsQ0FBQyxFQUNGLGlCQUFpQixDQUFDLFVBQVUsQ0FDN0IsQ0FDRixDQUFDO2FBQ0g7WUFFRCxPQUFPLGlCQUFpQixDQUFDO1FBQzNCLENBQUMsQ0FBQztJQUNKLENBQUMsQ0FBQztBQUNKLENBQUM7QUEvREQsNENBK0RDO0FBRUQsU0FBUyxjQUFjLENBQ3JCLFdBQTJCLEVBQzNCLElBQWtCLEVBQ2xCLFdBQTJCLEVBQzNCLDBCQUFrRCxFQUNsRCxVQUEwQixFQUMxQix3QkFBaUM7SUFFakMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxXQUFXLENBQUMsRUFBRTtRQUM1QyxPQUFPLElBQUksQ0FBQztLQUNiO0lBRUQsSUFBSSxDQUFDLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUU7UUFDekMsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQztJQUN6QyxNQUFNLElBQUksR0FBRyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUM7SUFDeEMsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyx5QkFBeUIsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRTtRQUMvRCxpQ0FBaUM7UUFDakMsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBK0IsQ0FBQztJQUMvRCxNQUFNLGlCQUFpQixHQUFvQixFQUFFLENBQUM7SUFFOUMsdUJBQXVCO0lBQ3ZCLElBQUksVUFBVSxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxFQUFFLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FDbkUsRUFBRSxDQUFDLDBCQUEwQixDQUFDLElBQUksQ0FBQztRQUNqQyxDQUFDLENBQUMsc0JBQXNCLENBQ3BCLFdBQVcsRUFDWCxJQUFJLEVBQ0osaUJBQWlCLEVBQ2pCLDBCQUEwQixFQUMxQixVQUFVLEVBQ1Ysd0JBQXdCLENBQ3pCO1FBQ0gsQ0FBQyxDQUFDLElBQUksQ0FDVCxDQUFDO0lBRUYsNkNBQTZDO0lBQzdDLElBQUksaUJBQWlCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtRQUNoQyxNQUFNLGFBQWEsR0FBRyxXQUFXLENBQUMsd0JBQXdCLENBQ3hELFdBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsRUFDdEMsV0FBVyxDQUFDLDRCQUE0QixDQUFDLGlCQUFpQixDQUFDLENBQzVELENBQUM7UUFFRixVQUFVLEdBQUcsV0FBVyxDQUFDLGVBQWUsQ0FBQyxDQUFDLEdBQUcsVUFBVSxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUM7S0FDMUU7SUFFRCxPQUFPLFdBQVcsQ0FBQyxlQUFlLENBQ2hDLElBQUksRUFDSixXQUFXLENBQUMsb0JBQW9CLENBQzlCLGdCQUFnQixFQUNoQixnQkFBZ0IsQ0FBQyxVQUFVLEVBQzNCLGdCQUFnQixDQUFDLGFBQWEsRUFDOUIsQ0FBQyxXQUFXLENBQUMsNkJBQTZCLENBQUMsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FDMUUsQ0FDRixDQUFDO0FBQ0osQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQzdCLFdBQTJCLEVBQzNCLElBQWlDLEVBQ2pDLGlCQUFrQyxFQUNsQywwQkFBa0QsRUFDbEQsYUFBNEIsRUFBRSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQ2hELHdCQUFpQztJQUVqQyxJQUFJLENBQUMsRUFBRSxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUU7UUFDMUUsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzVCLFFBQVEsSUFBSSxFQUFFO1FBQ1osS0FBSyxVQUFVO1lBQ2IsT0FBTyxTQUFTLENBQUM7UUFFbkIsS0FBSyxhQUFhO1lBQ2hCLE1BQU0sR0FBRyxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDN0MsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDUixPQUFPLElBQUksQ0FBQzthQUNiO1lBRUQsTUFBTSxVQUFVLEdBQUcsb0JBQW9CLENBQ3JDLFdBQVcsRUFDWCxHQUFHLEVBQ0gsMEJBQTBCLEVBQzFCLFVBQVUsQ0FDWCxDQUFDO1lBQ0YsSUFBSSxDQUFDLFVBQVUsRUFBRTtnQkFDZixPQUFPLElBQUksQ0FBQzthQUNiO1lBRUQsT0FBTyxXQUFXLENBQUMsd0JBQXdCLENBQ3pDLElBQUksRUFDSixXQUFXLENBQUMsZ0JBQWdCLENBQUMsVUFBVSxDQUFDLEVBQ3hDLFVBQVUsQ0FDWCxDQUFDO1FBQ0osS0FBSyxRQUFRLENBQUM7UUFDZCxLQUFLLFdBQVc7WUFDZCxJQUFJLENBQUMsRUFBRSxDQUFDLHdCQUF3QixDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsRUFBRTtnQkFDbEQsT0FBTyxJQUFJLENBQUM7YUFDYjtZQUVELE1BQU0sYUFBYSxHQUFHLElBQUksS0FBSyxRQUFRLENBQUM7WUFDeEMsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxDQUFDLElBQUksRUFBRSxFQUFFO2dCQUMvRCxJQUFJLENBQUMsRUFBRSxDQUFDLGVBQWUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQywrQkFBK0IsQ0FBQyxJQUFJLENBQUMsRUFBRTtvQkFDMUUsT0FBTyxJQUFJLENBQUM7aUJBQ2I7Z0JBRUQsSUFBSSxHQUFHLENBQUM7Z0JBQ1IsSUFBSSxhQUFhLEVBQUU7b0JBQ2pCLElBQUksd0JBQXdCLEVBQUU7d0JBQzVCLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQzt3QkFDdkQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDLFFBQVEsQ0FBQzt3QkFDckQsOEdBQThHO3dCQUM5RyxHQUFHOzRCQUNELEdBQUcsY0FBYyxJQUFJLHdCQUF3QixJQUFJLG1DQUEyQixFQUFFO2dDQUM5RSxNQUFNLGlEQUErQixTQUFTLGtCQUFrQixDQUM5RCxJQUFJLENBQ0wsSUFBSSxjQUFjLEVBQUUsQ0FBQztxQkFDekI7eUJBQU07d0JBQ0wsT0FBTyxXQUFXLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO3FCQUNuRDtpQkFDRjtxQkFBTTtvQkFDTCxHQUFHLEdBQUcsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO2lCQUM1QjtnQkFFRCxJQUFJLENBQUMsR0FBRyxFQUFFO29CQUNSLE9BQU8sSUFBSSxDQUFDO2lCQUNiO2dCQUVELE9BQU8sb0JBQW9CLENBQUMsV0FBVyxFQUFFLEdBQUcsRUFBRSwwQkFBMEIsRUFBRSxVQUFVLENBQUMsQ0FBQztZQUN4RixDQUFDLENBQUMsQ0FBQztZQUVILGdDQUFnQztZQUNoQyxJQUFJLGFBQWEsRUFBRTtnQkFDakIsaUJBQWlCLENBQUMsT0FBTyxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUM7YUFDdEM7aUJBQU07Z0JBQ0wsaUJBQWlCLENBQUMsSUFBSSxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUM7YUFDbkM7WUFFRCxPQUFPLFNBQVMsQ0FBQztRQUNuQjtZQUNFLE9BQU8sSUFBSSxDQUFDO0tBQ2Y7QUFDSCxDQUFDO0FBRUQsU0FBZ0IsY0FBYyxDQUFDLElBQWE7SUFDMUMsdUJBQXVCO0lBQ3ZCLElBQUksQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLCtCQUErQixDQUFDLElBQUksQ0FBQyxFQUFFO1FBQzFFLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFRCxPQUFPLEdBQUcsVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxJQUFJLElBQUksbUNBQTJCLEVBQUUsQ0FBQztBQUNoRyxDQUFDO0FBUEQsd0NBT0M7QUFFRCxTQUFTLG9CQUFvQixDQUFDLElBQWEsRUFBRSxXQUEyQjtJQUN0RSxJQUFJLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUN6QixPQUFPLEtBQUssQ0FBQztLQUNkO0lBRUQsTUFBTSxNQUFNLEdBQUcsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBQ3JELElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssZUFBZSxJQUFJLE1BQU0sQ0FBQyxJQUFJLEtBQUssV0FBVyxFQUFFO1FBQzlFLE9BQU8sSUFBSSxDQUFDO0tBQ2I7SUFFRCxPQUFPLEtBQUssQ0FBQztBQUNmLENBQUM7QUFFRCxTQUFTLG9CQUFvQixDQUMzQixXQUEyQixFQUMzQixHQUFXLEVBQ1gsMEJBQWtELEVBQ2xELFVBQXlCO0lBRXpCLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUV4RCxJQUFJLFVBQVUsR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRTtRQUNyQyxPQUFPLFdBQVcsQ0FBQyxvQkFBb0IsQ0FDckMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLFNBQVMsQ0FBQyxFQUN2QyxFQUFFLEVBQ0YsQ0FBQyxVQUFVLENBQUMsQ0FDYixDQUFDO0tBQ0g7U0FBTTtRQUNMLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxnQkFBZ0IsQ0FDN0Msc0JBQXNCLDBCQUEwQixDQUFDLE1BQU0sRUFBRSxDQUMxRCxDQUFDO1FBQ0YsMEJBQTBCLENBQUMsSUFBSSxDQUM3QixXQUFXLENBQUMsdUJBQXVCLENBQ2pDLFNBQVMsRUFDVCxTQUFTLEVBQ1QsV0FBVyxDQUFDLGtCQUFrQixDQUFDLEtBQUssRUFBRSxVQUFVLEVBQUUsU0FBUyxDQUFDLEVBQzVELFVBQVUsQ0FDWCxDQUNGLENBQUM7UUFFRixPQUFPLFVBQVUsQ0FBQztLQUNuQjtBQUNILENBQUM7QUFPRCxTQUFTLGtCQUFrQixDQUN6QixTQUF1QixFQUN2QixXQUEyQjtJQUUzQixJQUFJLENBQUMsRUFBRSxDQUFDLGdCQUFnQixDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsRUFBRTtRQUM5QyxPQUFPLElBQUksQ0FBQztLQUNiO0lBRUQsSUFBSSxVQUFtQixDQUFDO0lBQ3hCLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUVkLElBQUksRUFBRSxDQUFDLDBCQUEwQixDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLEVBQUU7UUFDbEUsVUFBVSxHQUFHLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQztRQUN4RCxJQUFJLEdBQUcsU0FBUyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztLQUNsRDtTQUFNLElBQUksRUFBRSxDQUFDLFlBQVksQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQzNELFVBQVUsR0FBRyxTQUFTLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQztLQUM5QztTQUFNO1FBQ0wsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUVELG1GQUFtRjtJQUNuRixNQUFNLE1BQU0sR0FBRyxXQUFXLENBQUMsbUJBQW1CLENBQUMsVUFBVSxDQUFDLENBQUM7SUFDM0QsSUFBSSxNQUFNLElBQUksTUFBTSxDQUFDLFlBQVksSUFBSSxNQUFNLENBQUMsWUFBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7UUFDbkUsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMzQyxJQUFJLE1BQWMsQ0FBQztRQUVuQixJQUFJLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxXQUFXLENBQUMsRUFBRTtZQUNyQyxJQUFJLEdBQUcsQ0FBQyxXQUFXLENBQUMsWUFBWSxJQUFJLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUM7WUFDM0QsTUFBTSxHQUFJLFdBQVcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxlQUFpQyxDQUFDLElBQUksQ0FBQztTQUNuRjthQUFNLElBQUksRUFBRSxDQUFDLGlCQUFpQixDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQzVDLDREQUE0RDtZQUM1RCxNQUFNLEdBQUksV0FBVyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsZUFBaUMsQ0FBQyxJQUFJLENBQUM7U0FDNUU7YUFBTSxJQUFJLEVBQUUsQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLEVBQUU7WUFDekMsSUFBSSxHQUFJLFdBQVcsQ0FBQyxJQUFzQixDQUFDLElBQUksQ0FBQztZQUNoRCxNQUFNLEdBQUksV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFpQyxDQUFDLElBQUksQ0FBQztTQUNyRTthQUFNO1lBQ0wsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUVELE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUM7S0FDekI7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRoIH0gZnJvbSAnLi4vbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UnO1xuXG5leHBvcnQgY29uc3QgTkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZID0gJ25nUmVzb3VyY2UnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVwbGFjZVJlc291cmNlcyhcbiAgc2hvdWxkVHJhbnNmb3JtOiAoZmlsZU5hbWU6IHN0cmluZykgPT4gYm9vbGVhbixcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT4ge1xuICByZXR1cm4gKGNvbnRleHQ6IHRzLlRyYW5zZm9ybWF0aW9uQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHR5cGVDaGVja2VyID0gZ2V0VHlwZUNoZWNrZXIoKTtcbiAgICBjb25zdCByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSA9IFtdO1xuICAgIGNvbnN0IG1vZHVsZUtpbmQgPSBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLm1vZHVsZTtcbiAgICBjb25zdCBub2RlRmFjdG9yeSA9IGNvbnRleHQuZmFjdG9yeTtcblxuICAgIGNvbnN0IHZpc2l0Tm9kZTogdHMuVmlzaXRvciA9IChub2RlOiB0cy5Ob2RlKSA9PiB7XG4gICAgICBpZiAodHMuaXNDbGFzc0RlY2xhcmF0aW9uKG5vZGUpKSB7XG4gICAgICAgIGNvbnN0IGRlY29yYXRvcnMgPSB0cy52aXNpdE5vZGVzKG5vZGUuZGVjb3JhdG9ycywgKG5vZGUpID0+XG4gICAgICAgICAgdHMuaXNEZWNvcmF0b3Iobm9kZSlcbiAgICAgICAgICAgID8gdmlzaXREZWNvcmF0b3IoXG4gICAgICAgICAgICAgICAgbm9kZUZhY3RvcnksXG4gICAgICAgICAgICAgICAgbm9kZSxcbiAgICAgICAgICAgICAgICB0eXBlQ2hlY2tlcixcbiAgICAgICAgICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgICAgICAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgOiBub2RlLFxuICAgICAgICApO1xuXG4gICAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVDbGFzc0RlY2xhcmF0aW9uKFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgZGVjb3JhdG9ycyxcbiAgICAgICAgICBub2RlLm1vZGlmaWVycyxcbiAgICAgICAgICBub2RlLm5hbWUsXG4gICAgICAgICAgbm9kZS50eXBlUGFyYW1ldGVycyxcbiAgICAgICAgICBub2RlLmhlcml0YWdlQ2xhdXNlcyxcbiAgICAgICAgICBub2RlLm1lbWJlcnMsXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdE5vZGUsIGNvbnRleHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGlmICghc2hvdWxkVHJhbnNmb3JtKHNvdXJjZUZpbGUuZmlsZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiBzb3VyY2VGaWxlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0Tm9kZShzb3VyY2VGaWxlLCB2aXNpdE5vZGUpO1xuICAgICAgaWYgKHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLmxlbmd0aCkge1xuICAgICAgICAvLyBBZGQgcmVzb3VyY2UgaW1wb3J0c1xuICAgICAgICByZXR1cm4gY29udGV4dC5mYWN0b3J5LnVwZGF0ZVNvdXJjZUZpbGUoXG4gICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgdHMuc2V0VGV4dFJhbmdlKFxuICAgICAgICAgICAgY29udGV4dC5mYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbXG4gICAgICAgICAgICAgIC4uLnJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICAgICAgICAuLi51cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICAgXSksXG4gICAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB1cGRhdGVkU291cmNlRmlsZTtcbiAgICB9O1xuICB9O1xufVxuXG5mdW5jdGlvbiB2aXNpdERlY29yYXRvcihcbiAgbm9kZUZhY3Rvcnk6IHRzLk5vZGVGYWN0b3J5LFxuICBub2RlOiB0cy5EZWNvcmF0b3IsXG4gIHR5cGVDaGVja2VyOiB0cy5UeXBlQ2hlY2tlcixcbiAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10sXG4gIG1vZHVsZUtpbmQ/OiB0cy5Nb2R1bGVLaW5kLFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5EZWNvcmF0b3Ige1xuICBpZiAoIWlzQ29tcG9uZW50RGVjb3JhdG9yKG5vZGUsIHR5cGVDaGVja2VyKSkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgaWYgKCF0cy5pc0NhbGxFeHByZXNzaW9uKG5vZGUuZXhwcmVzc2lvbikpIHtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGNvbnN0IGRlY29yYXRvckZhY3RvcnkgPSBub2RlLmV4cHJlc3Npb247XG4gIGNvbnN0IGFyZ3MgPSBkZWNvcmF0b3JGYWN0b3J5LmFyZ3VtZW50cztcbiAgaWYgKGFyZ3MubGVuZ3RoICE9PSAxIHx8ICF0cy5pc09iamVjdExpdGVyYWxFeHByZXNzaW9uKGFyZ3NbMF0pKSB7XG4gICAgLy8gVW5zdXBwb3J0ZWQgY29tcG9uZW50IG1ldGFkYXRhXG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBjb25zdCBvYmplY3RFeHByZXNzaW9uID0gYXJnc1swXSBhcyB0cy5PYmplY3RMaXRlcmFsRXhwcmVzc2lvbjtcbiAgY29uc3Qgc3R5bGVSZXBsYWNlbWVudHM6IHRzLkV4cHJlc3Npb25bXSA9IFtdO1xuXG4gIC8vIHZpc2l0IGFsbCBwcm9wZXJ0aWVzXG4gIGxldCBwcm9wZXJ0aWVzID0gdHMudmlzaXROb2RlcyhvYmplY3RFeHByZXNzaW9uLnByb3BlcnRpZXMsIChub2RlKSA9PlxuICAgIHRzLmlzT2JqZWN0TGl0ZXJhbEVsZW1lbnRMaWtlKG5vZGUpXG4gICAgICA/IHZpc2l0Q29tcG9uZW50TWV0YWRhdGEoXG4gICAgICAgICAgbm9kZUZhY3RvcnksXG4gICAgICAgICAgbm9kZSxcbiAgICAgICAgICBzdHlsZVJlcGxhY2VtZW50cyxcbiAgICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgICAgKVxuICAgICAgOiBub2RlLFxuICApO1xuXG4gIC8vIHJlcGxhY2UgcHJvcGVydGllcyB3aXRoIHVwZGF0ZWQgcHJvcGVydGllc1xuICBpZiAoc3R5bGVSZXBsYWNlbWVudHMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHN0eWxlUHJvcGVydHkgPSBub2RlRmFjdG9yeS5jcmVhdGVQcm9wZXJ0eUFzc2lnbm1lbnQoXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKCdzdHlsZXMnKSxcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUFycmF5TGl0ZXJhbEV4cHJlc3Npb24oc3R5bGVSZXBsYWNlbWVudHMpLFxuICAgICk7XG5cbiAgICBwcm9wZXJ0aWVzID0gbm9kZUZhY3RvcnkuY3JlYXRlTm9kZUFycmF5KFsuLi5wcm9wZXJ0aWVzLCBzdHlsZVByb3BlcnR5XSk7XG4gIH1cblxuICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlRGVjb3JhdG9yKFxuICAgIG5vZGUsXG4gICAgbm9kZUZhY3RvcnkudXBkYXRlQ2FsbEV4cHJlc3Npb24oXG4gICAgICBkZWNvcmF0b3JGYWN0b3J5LFxuICAgICAgZGVjb3JhdG9yRmFjdG9yeS5leHByZXNzaW9uLFxuICAgICAgZGVjb3JhdG9yRmFjdG9yeS50eXBlQXJndW1lbnRzLFxuICAgICAgW25vZGVGYWN0b3J5LnVwZGF0ZU9iamVjdExpdGVyYWxFeHByZXNzaW9uKG9iamVjdEV4cHJlc3Npb24sIHByb3BlcnRpZXMpXSxcbiAgICApLFxuICApO1xufVxuXG5mdW5jdGlvbiB2aXNpdENvbXBvbmVudE1ldGFkYXRhKFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIG5vZGU6IHRzLk9iamVjdExpdGVyYWxFbGVtZW50TGlrZSxcbiAgc3R5bGVSZXBsYWNlbWVudHM6IHRzLkV4cHJlc3Npb25bXSxcbiAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10sXG4gIG1vZHVsZUtpbmQ6IHRzLk1vZHVsZUtpbmQgPSB0cy5Nb2R1bGVLaW5kLkVTMjAxNSxcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuKTogdHMuT2JqZWN0TGl0ZXJhbEVsZW1lbnRMaWtlIHwgdW5kZWZpbmVkIHtcbiAgaWYgKCF0cy5pc1Byb3BlcnR5QXNzaWdubWVudChub2RlKSB8fCB0cy5pc0NvbXB1dGVkUHJvcGVydHlOYW1lKG5vZGUubmFtZSkpIHtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGNvbnN0IG5hbWUgPSBub2RlLm5hbWUudGV4dDtcbiAgc3dpdGNoIChuYW1lKSB7XG4gICAgY2FzZSAnbW9kdWxlSWQnOlxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcblxuICAgIGNhc2UgJ3RlbXBsYXRlVXJsJzpcbiAgICAgIGNvbnN0IHVybCA9IGdldFJlc291cmNlVXJsKG5vZGUuaW5pdGlhbGl6ZXIpO1xuICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGltcG9ydE5hbWUgPSBjcmVhdGVSZXNvdXJjZUltcG9ydChcbiAgICAgICAgbm9kZUZhY3RvcnksXG4gICAgICAgIHVybCxcbiAgICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgIG1vZHVsZUtpbmQsXG4gICAgICApO1xuICAgICAgaWYgKCFpbXBvcnROYW1lKSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlUHJvcGVydHlBc3NpZ25tZW50KFxuICAgICAgICBub2RlLFxuICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKCd0ZW1wbGF0ZScpLFxuICAgICAgICBpbXBvcnROYW1lLFxuICAgICAgKTtcbiAgICBjYXNlICdzdHlsZXMnOlxuICAgIGNhc2UgJ3N0eWxlVXJscyc6XG4gICAgICBpZiAoIXRzLmlzQXJyYXlMaXRlcmFsRXhwcmVzc2lvbihub2RlLmluaXRpYWxpemVyKSkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaXNJbmxpbmVTdHlsZSA9IG5hbWUgPT09ICdzdHlsZXMnO1xuICAgICAgY29uc3Qgc3R5bGVzID0gdHMudmlzaXROb2Rlcyhub2RlLmluaXRpYWxpemVyLmVsZW1lbnRzLCAobm9kZSkgPT4ge1xuICAgICAgICBpZiAoIXRzLmlzU3RyaW5nTGl0ZXJhbChub2RlKSAmJiAhdHMuaXNOb1N1YnN0aXR1dGlvblRlbXBsYXRlTGl0ZXJhbChub2RlKSkge1xuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHVybDtcbiAgICAgICAgaWYgKGlzSW5saW5lU3R5bGUpIHtcbiAgICAgICAgICBpZiAoaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gQnVmZmVyLmZyb20obm9kZS50ZXh0KS50b1N0cmluZygnYmFzZTY0Jyk7XG4gICAgICAgICAgICBjb25zdCBjb250YWluaW5nRmlsZSA9IG5vZGUuZ2V0U291cmNlRmlsZSgpLmZpbGVOYW1lO1xuICAgICAgICAgICAgLy8gYXBwLmNvbXBvbmVudC50cy5jc3M/bmdSZXNvdXJjZSE9IUBuZ3Rvb2xzL3dlYnBhY2svc3JjL2xvYWRlcnMvaW5saW5lLXJlc291cmNlLmpzP2RhdGE9Li4uIWFwcC5jb21wb25lbnQudHNcbiAgICAgICAgICAgIHVybCA9XG4gICAgICAgICAgICAgIGAke2NvbnRhaW5pbmdGaWxlfS4ke2lubGluZVN0eWxlRmlsZUV4dGVuc2lvbn0/JHtOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUll9YCArXG4gICAgICAgICAgICAgIGAhPSEke0lubGluZUFuZ3VsYXJSZXNvdXJjZUxvYWRlclBhdGh9P2RhdGE9JHtlbmNvZGVVUklDb21wb25lbnQoXG4gICAgICAgICAgICAgICAgZGF0YSxcbiAgICAgICAgICAgICAgKX0hJHtjb250YWluaW5nRmlsZX1gO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gbm9kZUZhY3RvcnkuY3JlYXRlU3RyaW5nTGl0ZXJhbChub2RlLnRleHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB1cmwgPSBnZXRSZXNvdXJjZVVybChub2RlKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdXJsKSB7XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY3JlYXRlUmVzb3VyY2VJbXBvcnQobm9kZUZhY3RvcnksIHVybCwgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsIG1vZHVsZUtpbmQpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFN0eWxlcyBzaG91bGQgYmUgcGxhY2VkIGZpcnN0XG4gICAgICBpZiAoaXNJbmxpbmVTdHlsZSkge1xuICAgICAgICBzdHlsZVJlcGxhY2VtZW50cy51bnNoaWZ0KC4uLnN0eWxlcyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdHlsZVJlcGxhY2VtZW50cy5wdXNoKC4uLnN0eWxlcyk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBub2RlO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXNvdXJjZVVybChub2RlOiB0cy5Ob2RlKTogc3RyaW5nIHwgbnVsbCB7XG4gIC8vIG9ubHkgYW5hbHl6ZSBzdHJpbmdzXG4gIGlmICghdHMuaXNTdHJpbmdMaXRlcmFsKG5vZGUpICYmICF0cy5pc05vU3Vic3RpdHV0aW9uVGVtcGxhdGVMaXRlcmFsKG5vZGUpKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICByZXR1cm4gYCR7L15cXC4/XFwuXFwvLy50ZXN0KG5vZGUudGV4dCkgPyAnJyA6ICcuLyd9JHtub2RlLnRleHR9PyR7TkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZfWA7XG59XG5cbmZ1bmN0aW9uIGlzQ29tcG9uZW50RGVjb3JhdG9yKG5vZGU6IHRzLk5vZGUsIHR5cGVDaGVja2VyOiB0cy5UeXBlQ2hlY2tlcik6IG5vZGUgaXMgdHMuRGVjb3JhdG9yIHtcbiAgaWYgKCF0cy5pc0RlY29yYXRvcihub2RlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG9yaWdpbiA9IGdldERlY29yYXRvck9yaWdpbihub2RlLCB0eXBlQ2hlY2tlcik7XG4gIGlmIChvcmlnaW4gJiYgb3JpZ2luLm1vZHVsZSA9PT0gJ0Bhbmd1bGFyL2NvcmUnICYmIG9yaWdpbi5uYW1lID09PSAnQ29tcG9uZW50Jykge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVSZXNvdXJjZUltcG9ydChcbiAgbm9kZUZhY3Rvcnk6IHRzLk5vZGVGYWN0b3J5LFxuICB1cmw6IHN0cmluZyxcbiAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10sXG4gIG1vZHVsZUtpbmQ6IHRzLk1vZHVsZUtpbmQsXG4pOiB0cy5JZGVudGlmaWVyIHwgdHMuRXhwcmVzc2lvbiB7XG4gIGNvbnN0IHVybExpdGVyYWwgPSBub2RlRmFjdG9yeS5jcmVhdGVTdHJpbmdMaXRlcmFsKHVybCk7XG5cbiAgaWYgKG1vZHVsZUtpbmQgPCB0cy5Nb2R1bGVLaW5kLkVTMjAxNSkge1xuICAgIHJldHVybiBub2RlRmFjdG9yeS5jcmVhdGVDYWxsRXhwcmVzc2lvbihcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoJ3JlcXVpcmUnKSxcbiAgICAgIFtdLFxuICAgICAgW3VybExpdGVyYWxdLFxuICAgICk7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgaW1wb3J0TmFtZSA9IG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoXG4gICAgICBgX19OR19DTElfUkVTT1VSQ0VfXyR7cmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMubGVuZ3RofWAsXG4gICAgKTtcbiAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucy5wdXNoKFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSW1wb3J0RGVjbGFyYXRpb24oXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnRDbGF1c2UoZmFsc2UsIGltcG9ydE5hbWUsIHVuZGVmaW5lZCksXG4gICAgICAgIHVybExpdGVyYWwsXG4gICAgICApLFxuICAgICk7XG5cbiAgICByZXR1cm4gaW1wb3J0TmFtZTtcbiAgfVxufVxuXG5pbnRlcmZhY2UgRGVjb3JhdG9yT3JpZ2luIHtcbiAgbmFtZTogc3RyaW5nO1xuICBtb2R1bGU6IHN0cmluZztcbn1cblxuZnVuY3Rpb24gZ2V0RGVjb3JhdG9yT3JpZ2luKFxuICBkZWNvcmF0b3I6IHRzLkRlY29yYXRvcixcbiAgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyLFxuKTogRGVjb3JhdG9yT3JpZ2luIHwgbnVsbCB7XG4gIGlmICghdHMuaXNDYWxsRXhwcmVzc2lvbihkZWNvcmF0b3IuZXhwcmVzc2lvbikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGxldCBpZGVudGlmaWVyOiB0cy5Ob2RlO1xuICBsZXQgbmFtZSA9ICcnO1xuXG4gIGlmICh0cy5pc1Byb3BlcnR5QWNjZXNzRXhwcmVzc2lvbihkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uKSkge1xuICAgIGlkZW50aWZpZXIgPSBkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uLmV4cHJlc3Npb247XG4gICAgbmFtZSA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24ubmFtZS50ZXh0O1xuICB9IGVsc2UgaWYgKHRzLmlzSWRlbnRpZmllcihkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uKSkge1xuICAgIGlkZW50aWZpZXIgPSBkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gTk9URTogcmVzb2x2ZXIuZ2V0UmVmZXJlbmNlZEltcG9ydERlY2xhcmF0aW9uIHdvdWxkIHdvcmsgYXMgd2VsbCBidXQgaXMgaW50ZXJuYWxcbiAgY29uc3Qgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U3ltYm9sQXRMb2NhdGlvbihpZGVudGlmaWVyKTtcbiAgaWYgKHN5bWJvbCAmJiBzeW1ib2wuZGVjbGFyYXRpb25zICYmIHN5bWJvbC5kZWNsYXJhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGRlY2xhcmF0aW9uID0gc3ltYm9sLmRlY2xhcmF0aW9uc1swXTtcbiAgICBsZXQgbW9kdWxlOiBzdHJpbmc7XG5cbiAgICBpZiAodHMuaXNJbXBvcnRTcGVjaWZpZXIoZGVjbGFyYXRpb24pKSB7XG4gICAgICBuYW1lID0gKGRlY2xhcmF0aW9uLnByb3BlcnR5TmFtZSB8fCBkZWNsYXJhdGlvbi5uYW1lKS50ZXh0O1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5wYXJlbnQucGFyZW50Lm1vZHVsZVNwZWNpZmllciBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgIH0gZWxzZSBpZiAodHMuaXNOYW1lc3BhY2VJbXBvcnQoZGVjbGFyYXRpb24pKSB7XG4gICAgICAvLyBVc2UgdGhlIG5hbWUgZnJvbSB0aGUgZGVjb3JhdG9yIG5hbWVzcGFjZSBwcm9wZXJ0eSBhY2Nlc3NcbiAgICAgIG1vZHVsZSA9IChkZWNsYXJhdGlvbi5wYXJlbnQucGFyZW50Lm1vZHVsZVNwZWNpZmllciBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgIH0gZWxzZSBpZiAodHMuaXNJbXBvcnRDbGF1c2UoZGVjbGFyYXRpb24pKSB7XG4gICAgICBuYW1lID0gKGRlY2xhcmF0aW9uLm5hbWUgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICAgIG1vZHVsZSA9IChkZWNsYXJhdGlvbi5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7IG5hbWUsIG1vZHVsZSB9O1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG4iXX0=