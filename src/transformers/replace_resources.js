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
/** Whether the current version of TypeScript is after 4.8. */
const IS_TS_48 = isAfterVersion(4, 8);
function replaceResources(shouldTransform, getTypeChecker, inlineStyleFileExtension) {
    return (context) => {
        const typeChecker = getTypeChecker();
        const resourceImportDeclarations = [];
        const moduleKind = context.getCompilerOptions().module;
        const nodeFactory = context.factory;
        const visitNode = (node) => {
            if (ts.isClassDeclaration(node)) {
                return visitClassDeclaration(nodeFactory, typeChecker, node, resourceImportDeclarations, moduleKind, inlineStyleFileExtension);
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
/**
 * Replaces the resources inside of a `ClassDeclaration`. This is a backwards-compatibility layer
 * to support TypeScript versions older than 4.8 where the decorators of a node were in a separate
 * array, rather than being part of its `modifiers` array.
 *
 * TODO: remove this function and use the `NodeFactory` directly once support for TypeScript
 * 4.6 and 4.7 has been dropped.
 */
function visitClassDeclaration(nodeFactory, typeChecker, node, resourceImportDeclarations, moduleKind, inlineStyleFileExtension) {
    var _a;
    let decorators;
    let modifiers;
    if (IS_TS_48) {
        (_a = node.modifiers) === null || _a === void 0 ? void 0 : _a.forEach((modifier) => {
            if (ts.isDecorator(modifier)) {
                decorators !== null && decorators !== void 0 ? decorators : (decorators = []);
                decorators.push(modifier);
            }
            else {
                modifiers = modifiers !== null && modifiers !== void 0 ? modifiers : (modifiers = []);
                modifiers.push(modifier);
            }
        });
    }
    else {
        decorators = node.decorators;
        modifiers = node.modifiers;
    }
    if (!decorators || decorators.length === 0) {
        return node;
    }
    decorators = decorators.map((current) => visitDecorator(nodeFactory, current, typeChecker, resourceImportDeclarations, moduleKind, inlineStyleFileExtension));
    return IS_TS_48
        ? nodeFactory.updateClassDeclaration(node, [...decorators, ...(modifiers !== null && modifiers !== void 0 ? modifiers : [])], node.name, node.typeParameters, node.heritageClauses, node.members)
        : nodeFactory.updateClassDeclaration(node, decorators, modifiers, node.name, node.typeParameters, node.heritageClauses, node.members);
}
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
/** Checks if the current version of TypeScript is after the specified major/minor versions. */
function isAfterVersion(targetMajor, targetMinor) {
    const [major, minor] = ts.versionMajorMinor.split('.').map((part) => parseInt(part));
    if (major < targetMajor) {
        return false;
    }
    else if (major > targetMajor) {
        return true;
    }
    else {
        return minor >= targetMinor;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwbGFjZV9yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxnRUFBNkU7QUFFaEUsUUFBQSwyQkFBMkIsR0FBRyxZQUFZLENBQUM7QUFFeEQsOERBQThEO0FBQzlELE1BQU0sUUFBUSxHQUFHLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFFdEMsU0FBZ0IsZ0JBQWdCLENBQzlCLGVBQThDLEVBQzlDLGNBQW9DLEVBQ3BDLHdCQUFpQztJQUVqQyxPQUFPLENBQUMsT0FBaUMsRUFBRSxFQUFFO1FBQzNDLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sMEJBQTBCLEdBQTJCLEVBQUUsQ0FBQztRQUM5RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxNQUFNLENBQUM7UUFDdkQsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQztRQUVwQyxNQUFNLFNBQVMsR0FBZSxDQUFDLElBQWEsRUFBRSxFQUFFO1lBQzlDLElBQUksRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUMvQixPQUFPLHFCQUFxQixDQUMxQixXQUFXLEVBQ1gsV0FBVyxFQUNYLElBQUksRUFDSiwwQkFBMEIsRUFDMUIsVUFBVSxFQUNWLHdCQUF3QixDQUN6QixDQUFDO2FBQ0g7WUFFRCxPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNyRCxDQUFDLENBQUM7UUFFRixPQUFPLENBQUMsVUFBeUIs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QUksQ0FBQztTQUM1RTthQUFNLElBQUksRUFBRSxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUMsRUFBRTtZQUN6QyxJQUFJLEdBQUksV0FBVyxDQUFDLElBQXNCLENBQUMsSUFBSSxDQUFDO1lBQ2hELE1BQU0sR0FBSSxXQUFXLENBQUMsTUFBTSxDQUFDLGVBQWlDLENBQUMsSUFBSSxDQUFDO1NBQ3JFO2FBQU07WUFDTCxPQUFPLElBQUksQ0FBQztTQUNiO1FBRUQsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsQ0FBQztLQUN6QjtJQUVELE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVELCtGQUErRjtBQUMvRixTQUFTLGNBQWMsQ0FBQyxXQUFtQixFQUFFLFdBQW1CO0lBQzlELE1BQU0sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBRXJGLElBQUksS0FBSyxHQUFHLFdBQVcsRUFBRTtRQUN2QixPQUFPLEtBQUssQ0FBQztLQUNkO1NBQU0sSUFBSSxLQUFLLEdBQUcsV0FBVyxFQUFFO1FBQzlCLE9BQU8sSUFBSSxDQUFDO0tBQ2I7U0FBTTtRQUNMLE9BQU8sS0FBSyxJQUFJLFdBQVcsQ0FBQztLQUM3QjtBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRoIH0gZnJvbSAnLi4vbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UnO1xuXG5leHBvcnQgY29uc3QgTkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZID0gJ25nUmVzb3VyY2UnO1xuXG4vKiogV2hldGhlciB0aGUgY3VycmVudCB2ZXJzaW9uIG9mIFR5cGVTY3JpcHQgaXMgYWZ0ZXIgNC44LiAqL1xuY29uc3QgSVNfVFNfNDggPSBpc0FmdGVyVmVyc2lvbig0LCA4KTtcblxuZXhwb3J0IGZ1bmN0aW9uIHJlcGxhY2VSZXNvdXJjZXMoXG4gIHNob3VsZFRyYW5zZm9ybTogKGZpbGVOYW1lOiBzdHJpbmcpID0+IGJvb2xlYW4sXG4gIGdldFR5cGVDaGVja2VyOiAoKSA9PiB0cy5UeXBlQ2hlY2tlcixcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuKTogdHMuVHJhbnNmb3JtZXJGYWN0b3J5PHRzLlNvdXJjZUZpbGU+IHtcbiAgcmV0dXJuIChjb250ZXh0OiB0cy5UcmFuc2Zvcm1hdGlvbkNvbnRleHQpID0+IHtcbiAgICBjb25zdCB0eXBlQ2hlY2tlciA9IGdldFR5cGVDaGVja2VyKCk7XG4gICAgY29uc3QgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10gPSBbXTtcbiAgICBjb25zdCBtb2R1bGVLaW5kID0gY29udGV4dC5nZXRDb21waWxlck9wdGlvbnMoKS5tb2R1bGU7XG4gICAgY29uc3Qgbm9kZUZhY3RvcnkgPSBjb250ZXh0LmZhY3Rvcnk7XG5cbiAgICBjb25zdCB2aXNpdE5vZGU6IHRzLlZpc2l0b3IgPSAobm9kZTogdHMuTm9kZSkgPT4ge1xuICAgICAgaWYgKHRzLmlzQ2xhc3NEZWNsYXJhdGlvbihub2RlKSkge1xuICAgICAgICByZXR1cm4gdmlzaXRDbGFzc0RlY2xhcmF0aW9uKFxuICAgICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICAgIHR5cGVDaGVja2VyLFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB0cy52aXNpdEVhY2hDaGlsZChub2RlLCB2aXNpdE5vZGUsIGNvbnRleHQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gKHNvdXJjZUZpbGU6IHRzLlNvdXJjZUZpbGUpID0+IHtcbiAgICAgIGlmICghc2hvdWxkVHJhbnNmb3JtKHNvdXJjZUZpbGUuZmlsZU5hbWUpKSB7XG4gICAgICAgIHJldHVybiBzb3VyY2VGaWxlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB1cGRhdGVkU291cmNlRmlsZSA9IHRzLnZpc2l0Tm9kZShzb3VyY2VGaWxlLCB2aXNpdE5vZGUpO1xuICAgICAgaWYgKHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLmxlbmd0aCkge1xuICAgICAgICAvLyBBZGQgcmVzb3VyY2UgaW1wb3J0c1xuICAgICAgICByZXR1cm4gY29udGV4dC5mYWN0b3J5LnVwZGF0ZVNvdXJjZUZpbGUoXG4gICAgICAgICAgdXBkYXRlZFNvdXJjZUZpbGUsXG4gICAgICAgICAgdHMuc2V0VGV4dFJhbmdlKFxuICAgICAgICAgICAgY29udGV4dC5mYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbXG4gICAgICAgICAgICAgIC4uLnJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICAgICAgICAuLi51cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICAgXSksXG4gICAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZS5zdGF0ZW1lbnRzLFxuICAgICAgICAgICksXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiB1cGRhdGVkU291cmNlRmlsZTtcbiAgICB9O1xuICB9O1xufVxuXG4vKipcbiAqIFJlcGxhY2VzIHRoZSByZXNvdXJjZXMgaW5zaWRlIG9mIGEgYENsYXNzRGVjbGFyYXRpb25gLiBUaGlzIGlzIGEgYmFja3dhcmRzLWNvbXBhdGliaWxpdHkgbGF5ZXJcbiAqIHRvIHN1cHBvcnQgVHlwZVNjcmlwdCB2ZXJzaW9ucyBvbGRlciB0aGFuIDQuOCB3aGVyZSB0aGUgZGVjb3JhdG9ycyBvZiBhIG5vZGUgd2VyZSBpbiBhIHNlcGFyYXRlXG4gKiBhcnJheSwgcmF0aGVyIHRoYW4gYmVpbmcgcGFydCBvZiBpdHMgYG1vZGlmaWVyc2AgYXJyYXkuXG4gKlxuICogVE9ETzogcmVtb3ZlIHRoaXMgZnVuY3Rpb24gYW5kIHVzZSB0aGUgYE5vZGVGYWN0b3J5YCBkaXJlY3RseSBvbmNlIHN1cHBvcnQgZm9yIFR5cGVTY3JpcHRcbiAqIDQuNiBhbmQgNC43IGhhcyBiZWVuIGRyb3BwZWQuXG4gKi9cbmZ1bmN0aW9uIHZpc2l0Q2xhc3NEZWNsYXJhdGlvbihcbiAgbm9kZUZhY3Rvcnk6IHRzLk5vZGVGYWN0b3J5LFxuICB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIsXG4gIG5vZGU6IHRzLkNsYXNzRGVjbGFyYXRpb24sXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kOiB0cy5Nb2R1bGVLaW5kIHwgdW5kZWZpbmVkLFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb246IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IHRzLkNsYXNzRGVjbGFyYXRpb24ge1xuICBsZXQgZGVjb3JhdG9yczogdHMuRGVjb3JhdG9yW10gfCB1bmRlZmluZWQ7XG4gIGxldCBtb2RpZmllcnM6IHRzLk1vZGlmaWVyW10gfCB1bmRlZmluZWQ7XG5cbiAgaWYgKElTX1RTXzQ4KSB7XG4gICAgbm9kZS5tb2RpZmllcnM/LmZvckVhY2goKG1vZGlmaWVyKSA9PiB7XG4gICAgICBpZiAodHMuaXNEZWNvcmF0b3IobW9kaWZpZXIpKSB7XG4gICAgICAgIGRlY29yYXRvcnMgPz89IFtdO1xuICAgICAgICBkZWNvcmF0b3JzLnB1c2gobW9kaWZpZXIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbW9kaWZpZXJzID0gbW9kaWZpZXJzID8/PSBbXTtcbiAgICAgICAgbW9kaWZpZXJzLnB1c2gobW9kaWZpZXIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGRlY29yYXRvcnMgPSBub2RlLmRlY29yYXRvcnMgYXMgdW5rbm93biBhcyB0cy5EZWNvcmF0b3JbXTtcbiAgICBtb2RpZmllcnMgPSBub2RlLm1vZGlmaWVycyBhcyB1bmtub3duIGFzIHRzLk1vZGlmaWVyW107XG4gIH1cblxuICBpZiAoIWRlY29yYXRvcnMgfHwgZGVjb3JhdG9ycy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGRlY29yYXRvcnMgPSBkZWNvcmF0b3JzLm1hcCgoY3VycmVudCkgPT5cbiAgICB2aXNpdERlY29yYXRvcihcbiAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgY3VycmVudCxcbiAgICAgIHR5cGVDaGVja2VyLFxuICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICBtb2R1bGVLaW5kLFxuICAgICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uLFxuICAgICksXG4gICk7XG5cbiAgcmV0dXJuIElTX1RTXzQ4XG4gICAgPyBub2RlRmFjdG9yeS51cGRhdGVDbGFzc0RlY2xhcmF0aW9uKFxuICAgICAgICBub2RlLFxuICAgICAgICBbLi4uZGVjb3JhdG9ycywgLi4uKG1vZGlmaWVycyA/PyBbXSldLFxuICAgICAgICBub2RlLm5hbWUsXG4gICAgICAgIG5vZGUudHlwZVBhcmFtZXRlcnMsXG4gICAgICAgIG5vZGUuaGVyaXRhZ2VDbGF1c2VzLFxuICAgICAgICBub2RlLm1lbWJlcnMsXG4gICAgICApXG4gICAgOiBub2RlRmFjdG9yeS51cGRhdGVDbGFzc0RlY2xhcmF0aW9uKFxuICAgICAgICBub2RlLFxuICAgICAgICBkZWNvcmF0b3JzLFxuICAgICAgICBtb2RpZmllcnMsXG4gICAgICAgIG5vZGUubmFtZSxcbiAgICAgICAgbm9kZS50eXBlUGFyYW1ldGVycyxcbiAgICAgICAgbm9kZS5oZXJpdGFnZUNsYXVzZXMsXG4gICAgICAgIG5vZGUubWVtYmVycyxcbiAgICAgICk7XG59XG5cbmZ1bmN0aW9uIHZpc2l0RGVjb3JhdG9yKFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIG5vZGU6IHRzLkRlY29yYXRvcixcbiAgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZD86IHRzLk1vZHVsZUtpbmQsXG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZyxcbik6IHRzLkRlY29yYXRvciB7XG4gIGlmICghaXNDb21wb25lbnREZWNvcmF0b3Iobm9kZSwgdHlwZUNoZWNrZXIpKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBpZiAoIXRzLmlzQ2FsbEV4cHJlc3Npb24obm9kZS5leHByZXNzaW9uKSkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3QgZGVjb3JhdG9yRmFjdG9yeSA9IG5vZGUuZXhwcmVzc2lvbjtcbiAgY29uc3QgYXJncyA9IGRlY29yYXRvckZhY3RvcnkuYXJndW1lbnRzO1xuICBpZiAoYXJncy5sZW5ndGggIT09IDEgfHwgIXRzLmlzT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24oYXJnc1swXSkpIHtcbiAgICAvLyBVbnN1cHBvcnRlZCBjb21wb25lbnQgbWV0YWRhdGFcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGNvbnN0IG9iamVjdEV4cHJlc3Npb24gPSBhcmdzWzBdIGFzIHRzLk9iamVjdExpdGVyYWxFeHByZXNzaW9uO1xuICBjb25zdCBzdHlsZVJlcGxhY2VtZW50czogdHMuRXhwcmVzc2lvbltdID0gW107XG5cbiAgLy8gdmlzaXQgYWxsIHByb3BlcnRpZXNcbiAgbGV0IHByb3BlcnRpZXMgPSB0cy52aXNpdE5vZGVzKG9iamVjdEV4cHJlc3Npb24ucHJvcGVydGllcywgKG5vZGUpID0+XG4gICAgdHMuaXNPYmplY3RMaXRlcmFsRWxlbWVudExpa2Uobm9kZSlcbiAgICAgID8gdmlzaXRDb21wb25lbnRNZXRhZGF0YShcbiAgICAgICAgICBub2RlRmFjdG9yeSxcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLFxuICAgICAgICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICAgIG1vZHVsZUtpbmQsXG4gICAgICAgICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uLFxuICAgICAgICApXG4gICAgICA6IG5vZGUsXG4gICk7XG5cbiAgLy8gcmVwbGFjZSBwcm9wZXJ0aWVzIHdpdGggdXBkYXRlZCBwcm9wZXJ0aWVzXG4gIGlmIChzdHlsZVJlcGxhY2VtZW50cy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3Qgc3R5bGVQcm9wZXJ0eSA9IG5vZGVGYWN0b3J5LmNyZWF0ZVByb3BlcnR5QXNzaWdubWVudChcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoJ3N0eWxlcycpLFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlQXJyYXlMaXRlcmFsRXhwcmVzc2lvbihzdHlsZVJlcGxhY2VtZW50cyksXG4gICAgKTtcblxuICAgIHByb3BlcnRpZXMgPSBub2RlRmFjdG9yeS5jcmVhdGVOb2RlQXJyYXkoWy4uLnByb3BlcnRpZXMsIHN0eWxlUHJvcGVydHldKTtcbiAgfVxuXG4gIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVEZWNvcmF0b3IoXG4gICAgbm9kZSxcbiAgICBub2RlRmFjdG9yeS51cGRhdGVDYWxsRXhwcmVzc2lvbihcbiAgICAgIGRlY29yYXRvckZhY3RvcnksXG4gICAgICBkZWNvcmF0b3JGYWN0b3J5LmV4cHJlc3Npb24sXG4gICAgICBkZWNvcmF0b3JGYWN0b3J5LnR5cGVBcmd1bWVudHMsXG4gICAgICBbbm9kZUZhY3RvcnkudXBkYXRlT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24ob2JqZWN0RXhwcmVzc2lvbiwgcHJvcGVydGllcyldLFxuICAgICksXG4gICk7XG59XG5cbmZ1bmN0aW9uIHZpc2l0Q29tcG9uZW50TWV0YWRhdGEoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgbm9kZTogdHMuT2JqZWN0TGl0ZXJhbEVsZW1lbnRMaWtlLFxuICBzdHlsZVJlcGxhY2VtZW50czogdHMuRXhwcmVzc2lvbltdLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZDogdHMuTW9kdWxlS2luZCA9IHRzLk1vZHVsZUtpbmQuRVMyMDE1LFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5PYmplY3RMaXRlcmFsRWxlbWVudExpa2UgfCB1bmRlZmluZWQge1xuICBpZiAoIXRzLmlzUHJvcGVydHlBc3NpZ25tZW50KG5vZGUpIHx8IHRzLmlzQ29tcHV0ZWRQcm9wZXJ0eU5hbWUobm9kZS5uYW1lKSkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3QgbmFtZSA9IG5vZGUubmFtZS50ZXh0O1xuICBzd2l0Y2ggKG5hbWUpIHtcbiAgICBjYXNlICdtb2R1bGVJZCc6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgY2FzZSAndGVtcGxhdGVVcmwnOlxuICAgICAgY29uc3QgdXJsID0gZ2V0UmVzb3VyY2VVcmwobm9kZS5pbml0aWFsaXplcik7XG4gICAgICBpZiAoIXVybCkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW1wb3J0TmFtZSA9IGNyZWF0ZVJlc291cmNlSW1wb3J0KFxuICAgICAgICBub2RlRmFjdG9yeSxcbiAgICAgICAgdXJsLFxuICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICk7XG4gICAgICBpZiAoIWltcG9ydE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVQcm9wZXJ0eUFzc2lnbm1lbnQoXG4gICAgICAgIG5vZGUsXG4gICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoJ3RlbXBsYXRlJyksXG4gICAgICAgIGltcG9ydE5hbWUsXG4gICAgICApO1xuICAgIGNhc2UgJ3N0eWxlcyc6XG4gICAgY2FzZSAnc3R5bGVVcmxzJzpcbiAgICAgIGlmICghdHMuaXNBcnJheUxpdGVyYWxFeHByZXNzaW9uKG5vZGUuaW5pdGlhbGl6ZXIpKSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0lubGluZVN0eWxlID0gbmFtZSA9PT0gJ3N0eWxlcyc7XG4gICAgICBjb25zdCBzdHlsZXMgPSB0cy52aXNpdE5vZGVzKG5vZGUuaW5pdGlhbGl6ZXIuZWxlbWVudHMsIChub2RlKSA9PiB7XG4gICAgICAgIGlmICghdHMuaXNTdHJpbmdMaXRlcmFsKG5vZGUpICYmICF0cy5pc05vU3Vic3RpdHV0aW9uVGVtcGxhdGVMaXRlcmFsKG5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgdXJsO1xuICAgICAgICBpZiAoaXNJbmxpbmVTdHlsZSkge1xuICAgICAgICAgIGlmIChpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24pIHtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBCdWZmZXIuZnJvbShub2RlLnRleHQpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5pbmdGaWxlID0gbm9kZS5nZXRTb3VyY2VGaWxlKCkuZmlsZU5hbWU7XG4gICAgICAgICAgICAvLyBhcHAuY29tcG9uZW50LnRzLmNzcz9uZ1Jlc291cmNlIT0hQG5ndG9vbHMvd2VicGFjay9zcmMvbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UuanM/ZGF0YT0uLi4hYXBwLmNvbXBvbmVudC50c1xuICAgICAgICAgICAgdXJsID1cbiAgICAgICAgICAgICAgYCR7Y29udGFpbmluZ0ZpbGV9LiR7aW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9ufT8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX1gICtcbiAgICAgICAgICAgICAgYCE9ISR7SW5saW5lQW5ndWxhclJlc291cmNlTG9hZGVyUGF0aH0/ZGF0YT0ke2VuY29kZVVSSUNvbXBvbmVudChcbiAgICAgICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgICApfSEke2NvbnRhaW5pbmdGaWxlfWA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBub2RlRmFjdG9yeS5jcmVhdGVTdHJpbmdMaXRlcmFsKG5vZGUudGV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHVybCA9IGdldFJlc291cmNlVXJsKG5vZGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjcmVhdGVSZXNvdXJjZUltcG9ydChub2RlRmFjdG9yeSwgdXJsLCByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucywgbW9kdWxlS2luZCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3R5bGVzIHNob3VsZCBiZSBwbGFjZWQgZmlyc3RcbiAgICAgIGlmIChpc0lubGluZVN0eWxlKSB7XG4gICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLnVuc2hpZnQoLi4uc3R5bGVzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLnB1c2goLi4uc3R5bGVzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG5vZGU7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlc291cmNlVXJsKG5vZGU6IHRzLk5vZGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgLy8gb25seSBhbmFseXplIHN0cmluZ3NcbiAgaWYgKCF0cy5pc1N0cmluZ0xpdGVyYWwobm9kZSkgJiYgIXRzLmlzTm9TdWJzdGl0dXRpb25UZW1wbGF0ZUxpdGVyYWwobm9kZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiBgJHsvXlxcLj9cXC5cXC8vLnRlc3Qobm9kZS50ZXh0KSA/ICcnIDogJy4vJ30ke25vZGUudGV4dH0/JHtOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUll9YDtcbn1cblxuZnVuY3Rpb24gaXNDb21wb25lbnREZWNvcmF0b3Iobm9kZTogdHMuTm9kZSwgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyKTogbm9kZSBpcyB0cy5EZWNvcmF0b3Ige1xuICBpZiAoIXRzLmlzRGVjb3JhdG9yKG5vZGUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3Qgb3JpZ2luID0gZ2V0RGVjb3JhdG9yT3JpZ2luKG5vZGUsIHR5cGVDaGVja2VyKTtcbiAgaWYgKG9yaWdpbiAmJiBvcmlnaW4ubW9kdWxlID09PSAnQGFuZ3VsYXIvY29yZScgJiYgb3JpZ2luLm5hbWUgPT09ICdDb21wb25lbnQnKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVJlc291cmNlSW1wb3J0KFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIHVybDogc3RyaW5nLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZDogdHMuTW9kdWxlS2luZCxcbik6IHRzLklkZW50aWZpZXIgfCB0cy5FeHByZXNzaW9uIHtcbiAgY29uc3QgdXJsTGl0ZXJhbCA9IG5vZGVGYWN0b3J5LmNyZWF0ZVN0cmluZ0xpdGVyYWwodXJsKTtcblxuICBpZiAobW9kdWxlS2luZCA8IHRzLk1vZHVsZUtpbmQuRVMyMDE1KSB7XG4gICAgcmV0dXJuIG5vZGVGYWN0b3J5LmNyZWF0ZUNhbGxFeHByZXNzaW9uKFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcigncmVxdWlyZScpLFxuICAgICAgW10sXG4gICAgICBbdXJsTGl0ZXJhbF0sXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBpbXBvcnROYW1lID0gbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcihcbiAgICAgIGBfX05HX0NMSV9SRVNPVVJDRV9fJHtyZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucy5sZW5ndGh9YCxcbiAgICApO1xuICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLnB1c2goXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnREZWNsYXJhdGlvbihcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydENsYXVzZShmYWxzZSwgaW1wb3J0TmFtZSwgdW5kZWZpbmVkKSxcbiAgICAgICAgdXJsTGl0ZXJhbCxcbiAgICAgICksXG4gICAgKTtcblxuICAgIHJldHVybiBpbXBvcnROYW1lO1xuICB9XG59XG5cbmludGVyZmFjZSBEZWNvcmF0b3JPcmlnaW4ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG1vZHVsZTogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBnZXREZWNvcmF0b3JPcmlnaW4oXG4gIGRlY29yYXRvcjogdHMuRGVjb3JhdG9yLFxuICB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIsXG4pOiBEZWNvcmF0b3JPcmlnaW4gfCBudWxsIHtcbiAgaWYgKCF0cy5pc0NhbGxFeHByZXNzaW9uKGRlY29yYXRvci5leHByZXNzaW9uKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgbGV0IGlkZW50aWZpZXI6IHRzLk5vZGU7XG4gIGxldCBuYW1lID0gJyc7XG5cbiAgaWYgKHRzLmlzUHJvcGVydHlBY2Nlc3NFeHByZXNzaW9uKGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24pKSB7XG4gICAgaWRlbnRpZmllciA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgICBuYW1lID0gZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbi5uYW1lLnRleHQ7XG4gIH0gZWxzZSBpZiAodHMuaXNJZGVudGlmaWVyKGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24pKSB7XG4gICAgaWRlbnRpZmllciA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb247XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBOT1RFOiByZXNvbHZlci5nZXRSZWZlcmVuY2VkSW1wb3J0RGVjbGFyYXRpb24gd291bGQgd29yayBhcyB3ZWxsIGJ1dCBpcyBpbnRlcm5hbFxuICBjb25zdCBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKGlkZW50aWZpZXIpO1xuICBpZiAoc3ltYm9sICYmIHN5bWJvbC5kZWNsYXJhdGlvbnMgJiYgc3ltYm9sLmRlY2xhcmF0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgZGVjbGFyYXRpb24gPSBzeW1ib2wuZGVjbGFyYXRpb25zWzBdO1xuICAgIGxldCBtb2R1bGU6IHN0cmluZztcblxuICAgIGlmICh0cy5pc0ltcG9ydFNwZWNpZmllcihkZWNsYXJhdGlvbikpIHtcbiAgICAgIG5hbWUgPSAoZGVjbGFyYXRpb24ucHJvcGVydHlOYW1lIHx8IGRlY2xhcmF0aW9uLm5hbWUpLnRleHQ7XG4gICAgICBtb2R1bGUgPSAoZGVjbGFyYXRpb24ucGFyZW50LnBhcmVudC5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIGlmICh0cy5pc05hbWVzcGFjZUltcG9ydChkZWNsYXJhdGlvbikpIHtcbiAgICAgIC8vIFVzZSB0aGUgbmFtZSBmcm9tIHRoZSBkZWNvcmF0b3IgbmFtZXNwYWNlIHByb3BlcnR5IGFjY2Vzc1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIGlmICh0cy5pc0ltcG9ydENsYXVzZShkZWNsYXJhdGlvbikpIHtcbiAgICAgIG5hbWUgPSAoZGVjbGFyYXRpb24ubmFtZSBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbmFtZSwgbW9kdWxlIH07XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIENoZWNrcyBpZiB0aGUgY3VycmVudCB2ZXJzaW9uIG9mIFR5cGVTY3JpcHQgaXMgYWZ0ZXIgdGhlIHNwZWNpZmllZCBtYWpvci9taW5vciB2ZXJzaW9ucy4gKi9cbmZ1bmN0aW9uIGlzQWZ0ZXJWZXJzaW9uKHRhcmdldE1ham9yOiBudW1iZXIsIHRhcmdldE1pbm9yOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgW21ham9yLCBtaW5vcl0gPSB0cy52ZXJzaW9uTWFqb3JNaW5vci5zcGxpdCgnLicpLm1hcCgocGFydCkgPT4gcGFyc2VJbnQocGFydCkpO1xuXG4gIGlmIChtYWpvciA8IHRhcmdldE1ham9yKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2UgaWYgKG1ham9yID4gdGFyZ2V0TWFqb3IpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbWlub3IgPj0gdGFyZ2V0TWlub3I7XG4gIH1cbn1cbiJdfQ==