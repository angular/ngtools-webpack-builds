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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwbGFjZV9yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxnRUFBNkU7QUFFaEUsUUFBQSwyQkFBMkIsR0FBRyxZQUFZLENBQUM7QUFFeEQsU0FBZ0IsZ0JBQWdCLENBQzlCLGVBQThDLEVBQzlDLGNBQW9DLEVBQ3BDLHdCQUFpQztJQUVqQyxPQUFPLENBQUMsT0FBaUMsRUFBRSxFQUFFO1FBQzNDLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sMEJBQTBCLEdBQTJCLEVBQUUsQ0FBQztRQUM5RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxNQUFNLENBQUM7UUFDdkQsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQztRQUVwQyxNQUFNLFNBQVMsR0FBZSxDQUFDLElBQWEsRUFBRSxFQUFFO1lBQzlDLElBQUksRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUMvQixNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUN6RCxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztvQkFDbEIsQ0FBQyxDQUFDLGNBQWMsQ0FDWixXQUFXLEVBQ1gsSUFBSSxFQUNKLFdBQVcsRUFDWCwwQkFBMEIsRUFDMUIsVUFBVSxFQUNWLHdCQUF3QixDQUN6QjtvQkFDSCxDQUFDLENBQUMsSUFBSSxDQUNULENBQUM7Z0JBRUYsT0FBTyxXQUFXLENBQUMsc0JBQXNCLENB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LENBQUM7WUFDaEQsTUFBTSxHQUFJLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBaUMsQ0FBQyxJQUFJLENBQUM7U0FDckU7YUFBTTtZQUNMLE9BQU8sSUFBSSxDQUFDO1NBQ2I7UUFFRCxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDO0tBQ3pCO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBAbGljZW5zZVxuICogQ29weXJpZ2h0IEdvb2dsZSBMTEMgQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhbiBNSVQtc3R5bGUgbGljZW5zZSB0aGF0IGNhbiBiZVxuICogZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBhdCBodHRwczovL2FuZ3VsYXIuaW8vbGljZW5zZVxuICovXG5cbmltcG9ydCAqIGFzIHRzIGZyb20gJ3R5cGVzY3JpcHQnO1xuaW1wb3J0IHsgSW5saW5lQW5ndWxhclJlc291cmNlTG9hZGVyUGF0aCB9IGZyb20gJy4uL2xvYWRlcnMvaW5saW5lLXJlc291cmNlJztcblxuZXhwb3J0IGNvbnN0IE5HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWSA9ICduZ1Jlc291cmNlJztcblxuZXhwb3J0IGZ1bmN0aW9uIHJlcGxhY2VSZXNvdXJjZXMoXG4gIHNob3VsZFRyYW5zZm9ybTogKGZpbGVOYW1lOiBzdHJpbmcpID0+IGJvb2xlYW4sXG4gIGdldFR5cGVDaGVja2VyOiAoKSA9PiB0cy5UeXBlQ2hlY2tlcixcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuKTogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+IHtcbiAgcmV0dXJuIChjb250ZXh0OiB0cy5UcmFuc2Zvcm1hdGlvbkNvbnRleHQpID0+IHtcbiAgICBjb25zdCB0eXBlQ2hlY2tlciA9IGdldFR5cGVDaGVja2VyKCk7XG4gICAgY29uc3QgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10gPSBbXTtcbiAgICBjb25zdCBtb2R1bGVLaW5kID0gY29udGV4dC5nZXRDb21waWxlck9wdGlvbnMoKS5tb2R1bGU7XG4gICAgY29uc3Qgbm9kZUZhY3RvcnkgPSBjb250ZXh0LmZhY3Rvcnk7XG5cbiAgICBjb25zdCB2aXNpdE5vZGU6IHRzLlZpc2l0b3IgPSAobm9kZTogdHMuTm9kZSkgPT4ge1xuICAgICAgaWYgKHRzLmlzQ2xhc3NEZWNsYXJhdGlvbihub2RlKSkge1xuICAgICAgICBjb25zdCBkZWNvcmF0b3JzID0gdHMudmlzaXROb2Rlcyhub2RlLmRlY29yYXRvcnMsIChub2RlKSA9PlxuICAgICAgICAgIHRzLmlzRGVjb3JhdG9yKG5vZGUpXG4gICAgICAgICAgICA/IHZpc2l0RGVjb3JhdG9yKFxuICAgICAgICAgICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgICAgICAgdHlwZUNoZWNrZXIsXG4gICAgICAgICAgICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICAgICAgICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgIDogbm9kZSxcbiAgICAgICAgKTtcblxuICAgICAgICByZXR1cm4gbm9kZUZhY3RvcnkudXBkYXRlQ2xhc3NEZWNsYXJhdGlvbihcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIGRlY29yYXRvcnMsXG4gICAgICAgICAgbm9kZS5tb2RpZmllcnMsXG4gICAgICAgICAgbm9kZS5uYW1lLFxuICAgICAgICAgIG5vZGUudHlwZVBhcmFtZXRlcnMsXG4gICAgICAgICAgbm9kZS5oZXJpdGFnZUNsYXVzZXMsXG4gICAgICAgICAgbm9kZS5tZW1iZXJzLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdHMudmlzaXRFYWNoQ2hpbGQobm9kZSwgdmlzaXROb2RlLCBjb250ZXh0KTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB7XG4gICAgICBpZiAoIXNob3VsZFRyYW5zZm9ybShzb3VyY2VGaWxlLmZpbGVOYW1lKSkge1xuICAgICAgICByZXR1cm4gc291cmNlRmlsZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdXBkYXRlZFNvdXJjZUZpbGUgPSB0cy52aXNpdE5vZGUoc291cmNlRmlsZSwgdmlzaXROb2RlKTtcbiAgICAgIGlmIChyZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucy5sZW5ndGgpIHtcbiAgICAgICAgLy8gQWRkIHJlc291cmNlIGltcG9ydHNcbiAgICAgICAgcmV0dXJuIGNvbnRleHQuZmFjdG9yeS51cGRhdGVTb3VyY2VGaWxlKFxuICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLFxuICAgICAgICAgIHRzLnNldFRleHRSYW5nZShcbiAgICAgICAgICAgIGNvbnRleHQuZmFjdG9yeS5jcmVhdGVOb2RlQXJyYXkoW1xuICAgICAgICAgICAgICAuLi5yZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgICAgICAgLi4udXBkYXRlZFNvdXJjZUZpbGUuc3RhdGVtZW50cyxcbiAgICAgICAgICAgIF0pLFxuICAgICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUuc3RhdGVtZW50cyxcbiAgICAgICAgICApLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdXBkYXRlZFNvdXJjZUZpbGU7XG4gICAgfTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gdmlzaXREZWNvcmF0b3IoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgbm9kZTogdHMuRGVjb3JhdG9yLFxuICB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIsXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kPzogdHMuTW9kdWxlS2luZCxcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuKTogdHMuRGVjb3JhdG9yIHtcbiAgaWYgKCFpc0NvbXBvbmVudERlY29yYXRvcihub2RlLCB0eXBlQ2hlY2tlcikpIHtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGlmICghdHMuaXNDYWxsRXhwcmVzc2lvbihub2RlLmV4cHJlc3Npb24pKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBjb25zdCBkZWNvcmF0b3JGYWN0b3J5ID0gbm9kZS5leHByZXNzaW9uO1xuICBjb25zdCBhcmdzID0gZGVjb3JhdG9yRmFjdG9yeS5hcmd1bWVudHM7XG4gIGlmIChhcmdzLmxlbmd0aCAhPT0gMSB8fCAhdHMuaXNPYmplY3RMaXRlcmFsRXhwcmVzc2lvbihhcmdzWzBdKSkge1xuICAgIC8vIFVuc3VwcG9ydGVkIGNvbXBvbmVudCBtZXRhZGF0YVxuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3Qgb2JqZWN0RXhwcmVzc2lvbiA9IGFyZ3NbMF0gYXMgdHMuT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb247XG4gIGNvbnN0IHN0eWxlUmVwbGFjZW1lbnRzOiB0cy5FeHByZXNzaW9uW10gPSBbXTtcblxuICAvLyB2aXNpdCBhbGwgcHJvcGVydGllc1xuICBsZXQgcHJvcGVydGllcyA9IHRzLnZpc2l0Tm9kZXMob2JqZWN0RXhwcmVzc2lvbi5wcm9wZXJ0aWVzLCAobm9kZSkgPT5cbiAgICB0cy5pc09iamVjdExpdGVyYWxFbGVtZW50TGlrZShub2RlKVxuICAgICAgPyB2aXNpdENvbXBvbmVudE1ldGFkYXRhKFxuICAgICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMsXG4gICAgICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICAgIClcbiAgICAgIDogbm9kZSxcbiAgKTtcblxuICAvLyByZXBsYWNlIHByb3BlcnRpZXMgd2l0aCB1cGRhdGVkIHByb3BlcnRpZXNcbiAgaWYgKHN0eWxlUmVwbGFjZW1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBzdHlsZVByb3BlcnR5ID0gbm9kZUZhY3RvcnkuY3JlYXRlUHJvcGVydHlBc3NpZ25tZW50KFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcignc3R5bGVzJyksXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVBcnJheUxpdGVyYWxFeHByZXNzaW9uKHN0eWxlUmVwbGFjZW1lbnRzKSxcbiAgICApO1xuXG4gICAgcHJvcGVydGllcyA9IG5vZGVGYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbLi4ucHJvcGVydGllcywgc3R5bGVQcm9wZXJ0eV0pO1xuICB9XG5cbiAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZURlY29yYXRvcihcbiAgICBub2RlLFxuICAgIG5vZGVGYWN0b3J5LnVwZGF0ZUNhbGxFeHByZXNzaW9uKFxuICAgICAgZGVjb3JhdG9yRmFjdG9yeSxcbiAgICAgIGRlY29yYXRvckZhY3RvcnkuZXhwcmVzc2lvbixcbiAgICAgIGRlY29yYXRvckZhY3RvcnkudHlwZUFyZ3VtZW50cyxcbiAgICAgIFtub2RlRmFjdG9yeS51cGRhdGVPYmplY3RMaXRlcmFsRXhwcmVzc2lvbihvYmplY3RFeHByZXNzaW9uLCBwcm9wZXJ0aWVzKV0sXG4gICAgKSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gdmlzaXRDb21wb25lbnRNZXRhZGF0YShcbiAgbm9kZUZhY3Rvcnk6IHRzLk5vZGVGYWN0b3J5LFxuICBub2RlOiB0cy5PYmplY3RMaXRlcmFsRWxlbWVudExpa2UsXG4gIHN0eWxlUmVwbGFjZW1lbnRzOiB0cy5FeHByZXNzaW9uW10sXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kOiB0cy5Nb2R1bGVLaW5kID0gdHMuTW9kdWxlS2luZC5FUzIwMTUsXG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZyxcbik6IHRzLk9iamVjdExpdGVyYWxFbGVtZW50TGlrZSB8IHVuZGVmaW5lZCB7XG4gIGlmICghdHMuaXNQcm9wZXJ0eUFzc2lnbm1lbnQobm9kZSkgfHwgdHMuaXNDb21wdXRlZFByb3BlcnR5TmFtZShub2RlLm5hbWUpKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBjb25zdCBuYW1lID0gbm9kZS5uYW1lLnRleHQ7XG4gIHN3aXRjaCAobmFtZSkge1xuICAgIGNhc2UgJ21vZHVsZUlkJzpcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjYXNlICd0ZW1wbGF0ZVVybCc6XG4gICAgICBjb25zdCB1cmwgPSBnZXRSZXNvdXJjZVVybChub2RlLmluaXRpYWxpemVyKTtcbiAgICAgIGlmICghdXJsKSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbXBvcnROYW1lID0gY3JlYXRlUmVzb3VyY2VJbXBvcnQoXG4gICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICB1cmwsXG4gICAgICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgKTtcbiAgICAgIGlmICghaW1wb3J0TmFtZSkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZVByb3BlcnR5QXNzaWdubWVudChcbiAgICAgICAgbm9kZSxcbiAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcigndGVtcGxhdGUnKSxcbiAgICAgICAgaW1wb3J0TmFtZSxcbiAgICAgICk7XG4gICAgY2FzZSAnc3R5bGVzJzpcbiAgICBjYXNlICdzdHlsZVVybHMnOlxuICAgICAgaWYgKCF0cy5pc0FycmF5TGl0ZXJhbEV4cHJlc3Npb24obm9kZS5pbml0aWFsaXplcikpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzSW5saW5lU3R5bGUgPSBuYW1lID09PSAnc3R5bGVzJztcbiAgICAgIGNvbnN0IHN0eWxlcyA9IHRzLnZpc2l0Tm9kZXMobm9kZS5pbml0aWFsaXplci5lbGVtZW50cywgKG5vZGUpID0+IHtcbiAgICAgICAgaWYgKCF0cy5pc1N0cmluZ0xpdGVyYWwobm9kZSkgJiYgIXRzLmlzTm9TdWJzdGl0dXRpb25UZW1wbGF0ZUxpdGVyYWwobm9kZSkpIHtcbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCB1cmw7XG4gICAgICAgIGlmIChpc0lubGluZVN0eWxlKSB7XG4gICAgICAgICAgaWYgKGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbikge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IEJ1ZmZlci5mcm9tKG5vZGUudGV4dCkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgICAgICAgICAgY29uc3QgY29udGFpbmluZ0ZpbGUgPSBub2RlLmdldFNvdXJjZUZpbGUoKS5maWxlTmFtZTtcbiAgICAgICAgICAgIC8vIGFwcC5jb21wb25lbnQudHMuY3NzP25nUmVzb3VyY2UhPSFAbmd0b29scy93ZWJwYWNrL3NyYy9sb2FkZXJzL2lubGluZS1yZXNvdXJjZS5qcz9kYXRhPS4uLiFhcHAuY29tcG9uZW50LnRzXG4gICAgICAgICAgICB1cmwgPVxuICAgICAgICAgICAgICBgJHtjb250YWluaW5nRmlsZX0uJHtpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb259PyR7TkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZfWAgK1xuICAgICAgICAgICAgICBgIT0hJHtJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRofT9kYXRhPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFxuICAgICAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICAgICl9ISR7Y29udGFpbmluZ0ZpbGV9YDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LmNyZWF0ZVN0cmluZ0xpdGVyYWwobm9kZS50ZXh0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdXJsID0gZ2V0UmVzb3VyY2VVcmwobm9kZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXVybCkge1xuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZVJlc291cmNlSW1wb3J0KG5vZGVGYWN0b3J5LCB1cmwsIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLCBtb2R1bGVLaW5kKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTdHlsZXMgc2hvdWxkIGJlIHBsYWNlZCBmaXJzdFxuICAgICAgaWYgKGlzSW5saW5lU3R5bGUpIHtcbiAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMudW5zaGlmdCguLi5zdHlsZXMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMucHVzaCguLi5zdHlsZXMpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbm9kZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVzb3VyY2VVcmwobm9kZTogdHMuTm9kZSk6IHN0cmluZyB8IG51bGwge1xuICAvLyBvbmx5IGFuYWx5emUgc3RyaW5nc1xuICBpZiAoIXRzLmlzU3RyaW5nTGl0ZXJhbChub2RlKSAmJiAhdHMuaXNOb1N1YnN0aXR1dGlvblRlbXBsYXRlTGl0ZXJhbChub2RlKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIGAkey9eXFwuP1xcLlxcLy8udGVzdChub2RlLnRleHQpID8gJycgOiAnLi8nfSR7bm9kZS50ZXh0fT8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX1gO1xufVxuXG5mdW5jdGlvbiBpc0NvbXBvbmVudERlY29yYXRvcihub2RlOiB0cy5Ob2RlLCB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIpOiBub2RlIGlzIHRzLkRlY29yYXRvciB7XG4gIGlmICghdHMuaXNEZWNvcmF0b3Iobm9kZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBvcmlnaW4gPSBnZXREZWNvcmF0b3JPcmlnaW4obm9kZSwgdHlwZUNoZWNrZXIpO1xuICBpZiAob3JpZ2luICYmIG9yaWdpbi5tb2R1bGUgPT09ICdAYW5ndWxhci9jb3JlJyAmJiBvcmlnaW4ubmFtZSA9PT0gJ0NvbXBvbmVudCcpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUmVzb3VyY2VJbXBvcnQoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgdXJsOiBzdHJpbmcsXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kOiB0cy5Nb2R1bGVLaW5kLFxuKTogdHMuSWRlbnRpZmllciB8IHRzLkV4cHJlc3Npb24ge1xuICBjb25zdCB1cmxMaXRlcmFsID0gbm9kZUZhY3RvcnkuY3JlYXRlU3RyaW5nTGl0ZXJhbCh1cmwpO1xuXG4gIGlmIChtb2R1bGVLaW5kIDwgdHMuTW9kdWxlS2luZC5FUzIwMTUpIHtcbiAgICByZXR1cm4gbm9kZUZhY3RvcnkuY3JlYXRlQ2FsbEV4cHJlc3Npb24oXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKCdyZXF1aXJlJyksXG4gICAgICBbXSxcbiAgICAgIFt1cmxMaXRlcmFsXSxcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGltcG9ydE5hbWUgPSBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKFxuICAgICAgYF9fTkdfQ0xJX1JFU09VUkNFX18ke3Jlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLmxlbmd0aH1gLFxuICAgICk7XG4gICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMucHVzaChcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydERlY2xhcmF0aW9uKFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCxcbiAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSW1wb3J0Q2xhdXNlKGZhbHNlLCBpbXBvcnROYW1lLCB1bmRlZmluZWQpLFxuICAgICAgICB1cmxMaXRlcmFsLFxuICAgICAgKSxcbiAgICApO1xuXG4gICAgcmV0dXJuIGltcG9ydE5hbWU7XG4gIH1cbn1cblxuaW50ZXJmYWNlIERlY29yYXRvck9yaWdpbiB7XG4gIG5hbWU6IHN0cmluZztcbiAgbW9kdWxlOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIGdldERlY29yYXRvck9yaWdpbihcbiAgZGVjb3JhdG9yOiB0cy5EZWNvcmF0b3IsXG4gIHR5cGVDaGVja2VyOiB0cy5UeXBlQ2hlY2tlcixcbik6IERlY29yYXRvck9yaWdpbiB8IG51bGwge1xuICBpZiAoIXRzLmlzQ2FsbEV4cHJlc3Npb24oZGVjb3JhdG9yLmV4cHJlc3Npb24pKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBsZXQgaWRlbnRpZmllcjogdHMuTm9kZTtcbiAgbGV0IG5hbWUgPSAnJztcblxuICBpZiAodHMuaXNQcm9wZXJ0eUFjY2Vzc0V4cHJlc3Npb24oZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbikpIHtcbiAgICBpZGVudGlmaWVyID0gZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbi5leHByZXNzaW9uO1xuICAgIG5hbWUgPSBkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uLm5hbWUudGV4dDtcbiAgfSBlbHNlIGlmICh0cy5pc0lkZW50aWZpZXIoZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbikpIHtcbiAgICBpZGVudGlmaWVyID0gZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIC8vIE5PVEU6IHJlc29sdmVyLmdldFJlZmVyZW5jZWRJbXBvcnREZWNsYXJhdGlvbiB3b3VsZCB3b3JrIGFzIHdlbGwgYnV0IGlzIGludGVybmFsXG4gIGNvbnN0IHN5bWJvbCA9IHR5cGVDaGVja2VyLmdldFN5bWJvbEF0TG9jYXRpb24oaWRlbnRpZmllcik7XG4gIGlmIChzeW1ib2wgJiYgc3ltYm9sLmRlY2xhcmF0aW9ucyAmJiBzeW1ib2wuZGVjbGFyYXRpb25zLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBkZWNsYXJhdGlvbiA9IHN5bWJvbC5kZWNsYXJhdGlvbnNbMF07XG4gICAgbGV0IG1vZHVsZTogc3RyaW5nO1xuXG4gICAgaWYgKHRzLmlzSW1wb3J0U3BlY2lmaWVyKGRlY2xhcmF0aW9uKSkge1xuICAgICAgbmFtZSA9IChkZWNsYXJhdGlvbi5wcm9wZXJ0eU5hbWUgfHwgZGVjbGFyYXRpb24ubmFtZSkudGV4dDtcbiAgICAgIG1vZHVsZSA9IChkZWNsYXJhdGlvbi5wYXJlbnQucGFyZW50LnBhcmVudC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICB9IGVsc2UgaWYgKHRzLmlzTmFtZXNwYWNlSW1wb3J0KGRlY2xhcmF0aW9uKSkge1xuICAgICAgLy8gVXNlIHRoZSBuYW1lIGZyb20gdGhlIGRlY29yYXRvciBuYW1lc3BhY2UgcHJvcGVydHkgYWNjZXNzXG4gICAgICBtb2R1bGUgPSAoZGVjbGFyYXRpb24ucGFyZW50LnBhcmVudC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICB9IGVsc2UgaWYgKHRzLmlzSW1wb3J0Q2xhdXNlKGRlY2xhcmF0aW9uKSkge1xuICAgICAgbmFtZSA9IChkZWNsYXJhdGlvbi5uYW1lIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgICBtb2R1bGUgPSAoZGVjbGFyYXRpb24ucGFyZW50Lm1vZHVsZVNwZWNpZmllciBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICByZXR1cm4geyBuYW1lLCBtb2R1bGUgfTtcbiAgfVxuXG4gIHJldHVybiBudWxsO1xufVxuIl19