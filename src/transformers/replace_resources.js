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
        resourceImportDeclarations.push(nodeFactory.createImportDeclaration(undefined, nodeFactory.createImportClause(false, importName, undefined), urlLiteral));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwbGFjZV9yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxnRUFBNkU7QUFFaEUsUUFBQSwyQkFBMkIsR0FBRyxZQUFZLENBQUM7QUFFeEQsOERBQThEO0FBQzlELE1BQU0sUUFBUSxHQUFHLGNBQWMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFFdEMsU0FBZ0IsZ0JBQWdCLENBQzlCLGVBQThDLEVBQzlDLGNBQW9DLEVBQ3BDLHdCQUFpQztJQUVqQyxPQUFPLENBQUMsT0FBaUMsRUFBRSxFQUFFO1FBQzNDLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sMEJBQTBCLEdBQTJCLEVBQUUsQ0FBQztRQUM5RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxNQUFNLENBQUM7UUFDdkQsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQztRQUVwQyxNQUFNLFNBQVMsR0FBZSxDQUFDLElBQWEsRUFBRSxFQUFFO1lBQzlDLElBQUksRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUMvQixPQUFPLHFCQUFxQixDQUMxQixXQUFXLEVBQ1gsV0FBVyxFQUNYLElBQUksRUFDSiwwQkFBMEIsRUFDMUIsVUFBVSxFQUNWLHdCQUF3QixDQUN6QixDQUFDO2FBQ0g7WUFFRCxPQUFPLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztRQUNyRCxDQUFDLENBQUM7UUFFRixPQUFPLENBQUMsVUFBeUIs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QzVFO2FBQU0sSUFBSSxFQUFFLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxFQUFFO1lBQ3pDLElBQUksR0FBSSxXQUFXLENBQUMsSUFBc0IsQ0FBQyxJQUFJLENBQUM7WUFDaEQsTUFBTSxHQUFJLFdBQVcsQ0FBQyxNQUFNLENBQUMsZUFBaUMsQ0FBQyxJQUFJLENBQUM7U0FDckU7YUFBTTtZQUNMLE9BQU8sSUFBSSxDQUFDO1NBQ2I7UUFFRCxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDO0tBQ3pCO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDZCxDQUFDO0FBRUQsK0ZBQStGO0FBQy9GLFNBQVMsY0FBYyxDQUFDLFdBQW1CLEVBQUUsV0FBbUI7SUFDOUQsTUFBTSxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFFckYsSUFBSSxLQUFLLEdBQUcsV0FBVyxFQUFFO1FBQ3ZCLE9BQU8sS0FBSyxDQUFDO0tBQ2Q7U0FBTSxJQUFJLEtBQUssR0FBRyxXQUFXLEVBQUU7UUFDOUIsT0FBTyxJQUFJLENBQUM7S0FDYjtTQUFNO1FBQ0wsT0FBTyxLQUFLLElBQUksV0FBVyxDQUFDO0tBQzdCO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQGxpY2Vuc2VcbiAqIENvcHlyaWdodCBHb29nbGUgTExDIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYW4gTUlULXN0eWxlIGxpY2Vuc2UgdGhhdCBjYW4gYmVcbiAqIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgYXQgaHR0cHM6Ly9hbmd1bGFyLmlvL2xpY2Vuc2VcbiAqL1xuXG5pbXBvcnQgKiBhcyB0cyBmcm9tICd0eXBlc2NyaXB0JztcbmltcG9ydCB7IElubGluZUFuZ3VsYXJSZXNvdXJjZUxvYWRlclBhdGggfSBmcm9tICcuLi9sb2FkZXJzL2lubGluZS1yZXNvdXJjZSc7XG5cbmV4cG9ydCBjb25zdCBOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUlkgPSAnbmdSZXNvdXJjZSc7XG5cbi8qKiBXaGV0aGVyIHRoZSBjdXJyZW50IHZlcnNpb24gb2YgVHlwZVNjcmlwdCBpcyBhZnRlciA0LjguICovXG5jb25zdCBJU19UU180OCA9IGlzQWZ0ZXJWZXJzaW9uKDQsIDgpO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVwbGFjZVJlc291cmNlcyhcbiAgc2hvdWxkVHJhbnNmb3JtOiAoZmlsZU5hbWU6IHN0cmluZykgPT4gYm9vbGVhbixcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT4ge1xuICByZXR1cm4gKGNvbnRleHQ6IHRzLlRyYW5zZm9ybWF0aW9uQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHR5cGVDaGVja2VyID0gZ2V0VHlwZUNoZWNrZXIoKTtcbiAgICBjb25zdCByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSA9IFtdO1xuICAgIGNvbnN0IG1vZHVsZUtpbmQgPSBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLm1vZHVsZTtcbiAgICBjb25zdCBub2RlRmFjdG9yeSA9IGNvbnRleHQuZmFjdG9yeTtcblxuICAgIGNvbnN0IHZpc2l0Tm9kZTogdHMuVmlzaXRvciA9IChub2RlOiB0cy5Ob2RlKSA9PiB7XG4gICAgICBpZiAodHMuaXNDbGFzc0RlY2xhcmF0aW9uKG5vZGUpKSB7XG4gICAgICAgIHJldHVybiB2aXNpdENsYXNzRGVjbGFyYXRpb24oXG4gICAgICAgICAgbm9kZUZhY3RvcnksXG4gICAgICAgICAgdHlwZUNoZWNrZXIsXG4gICAgICAgICAgbm9kZSxcbiAgICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG4gICAgfTtcblxuICAgIHJldHVybiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgaWYgKCFzaG91bGRUcmFuc2Zvcm0oc291cmNlRmlsZS5maWxlTmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHNvdXJjZUZpbGU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXROb2RlKHNvdXJjZUZpbGUsIHZpc2l0Tm9kZSk7XG4gICAgICBpZiAocmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIEFkZCByZXNvdXJjZSBpbXBvcnRzXG4gICAgICAgIHJldHVybiBjb250ZXh0LmZhY3RvcnkudXBkYXRlU291cmNlRmlsZShcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICB0cy5zZXRUZXh0UmFuZ2UoXG4gICAgICAgICAgICBjb250ZXh0LmZhY3RvcnkuY3JlYXRlTm9kZUFycmF5KFtcbiAgICAgICAgICAgICAgLi4ucmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgICAgIC4uLnVwZGF0ZWRTb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVwZGF0ZWRTb3VyY2VGaWxlO1xuICAgIH07XG4gIH07XG59XG5cbi8qKlxuICogUmVwbGFjZXMgdGhlIHJlc291cmNlcyBpbnNpZGUgb2YgYSBgQ2xhc3NEZWNsYXJhdGlvbmAuIFRoaXMgaXMgYSBiYWNrd2FyZHMtY29tcGF0aWJpbGl0eSBsYXllclxuICogdG8gc3VwcG9ydCBUeXBlU2NyaXB0IHZlcnNpb25zIG9sZGVyIHRoYW4gNC44IHdoZXJlIHRoZSBkZWNvcmF0b3JzIG9mIGEgbm9kZSB3ZXJlIGluIGEgc2VwYXJhdGVcbiAqIGFycmF5LCByYXRoZXIgdGhhbiBiZWluZyBwYXJ0IG9mIGl0cyBgbW9kaWZpZXJzYCBhcnJheS5cbiAqXG4gKiBUT0RPOiByZW1vdmUgdGhpcyBmdW5jdGlvbiBhbmQgdXNlIHRoZSBgTm9kZUZhY3RvcnlgIGRpcmVjdGx5IG9uY2Ugc3VwcG9ydCBmb3IgVHlwZVNjcmlwdFxuICogNC42IGFuZCA0LjcgaGFzIGJlZW4gZHJvcHBlZC5cbiAqL1xuZnVuY3Rpb24gdmlzaXRDbGFzc0RlY2xhcmF0aW9uKFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIHR5cGVDaGVja2VyOiB0cy5UeXBlQ2hlY2tlcixcbiAgbm9kZTogdHMuQ2xhc3NEZWNsYXJhdGlvbixcbiAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnM6IHRzLkltcG9ydERlY2xhcmF0aW9uW10sXG4gIG1vZHVsZUtpbmQ6IHRzLk1vZHVsZUtpbmQgfCB1bmRlZmluZWQsXG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuKTogdHMuQ2xhc3NEZWNsYXJhdGlvbiB7XG4gIGxldCBkZWNvcmF0b3JzOiB0cy5EZWNvcmF0b3JbXSB8IHVuZGVmaW5lZDtcbiAgbGV0IG1vZGlmaWVyczogdHMuTW9kaWZpZXJbXSB8IHVuZGVmaW5lZDtcblxuICBpZiAoSVNfVFNfNDgpIHtcbiAgICBub2RlLm1vZGlmaWVycz8uZm9yRWFjaCgobW9kaWZpZXIpID0+IHtcbiAgICAgIGlmICh0cy5pc0RlY29yYXRvcihtb2RpZmllcikpIHtcbiAgICAgICAgZGVjb3JhdG9ycyA/Pz0gW107XG4gICAgICAgIGRlY29yYXRvcnMucHVzaChtb2RpZmllcik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtb2RpZmllcnMgPSBtb2RpZmllcnMgPz89IFtdO1xuICAgICAgICBtb2RpZmllcnMucHVzaChtb2RpZmllcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgZGVjb3JhdG9ycyA9IG5vZGUuZGVjb3JhdG9ycyBhcyB1bmtub3duIGFzIHRzLkRlY29yYXRvcltdO1xuICAgIG1vZGlmaWVycyA9IG5vZGUubW9kaWZpZXJzIGFzIHVua25vd24gYXMgdHMuTW9kaWZpZXJbXTtcbiAgfVxuXG4gIGlmICghZGVjb3JhdG9ycyB8fCBkZWNvcmF0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgZGVjb3JhdG9ycyA9IGRlY29yYXRvcnMubWFwKChjdXJyZW50KSA9PlxuICAgIHZpc2l0RGVjb3JhdG9yKFxuICAgICAgbm9kZUZhY3RvcnksXG4gICAgICBjdXJyZW50LFxuICAgICAgdHlwZUNoZWNrZXIsXG4gICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgIG1vZHVsZUtpbmQsXG4gICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgKSxcbiAgKTtcblxuICByZXR1cm4gSVNfVFNfNDhcbiAgICA/IG5vZGVGYWN0b3J5LnVwZGF0ZUNsYXNzRGVjbGFyYXRpb24oXG4gICAgICAgIG5vZGUsXG4gICAgICAgIFsuLi5kZWNvcmF0b3JzLCAuLi4obW9kaWZpZXJzID8/IFtdKV0sXG4gICAgICAgIG5vZGUubmFtZSxcbiAgICAgICAgbm9kZS50eXBlUGFyYW1ldGVycyxcbiAgICAgICAgbm9kZS5oZXJpdGFnZUNsYXVzZXMsXG4gICAgICAgIG5vZGUubWVtYmVycyxcbiAgICAgIClcbiAgICA6IG5vZGVGYWN0b3J5LnVwZGF0ZUNsYXNzRGVjbGFyYXRpb24oXG4gICAgICAgIG5vZGUsXG4gICAgICAgIGRlY29yYXRvcnMsXG4gICAgICAgIG1vZGlmaWVycyxcbiAgICAgICAgbm9kZS5uYW1lLFxuICAgICAgICBub2RlLnR5cGVQYXJhbWV0ZXJzLFxuICAgICAgICBub2RlLmhlcml0YWdlQ2xhdXNlcyxcbiAgICAgICAgbm9kZS5tZW1iZXJzLFxuICAgICAgKTtcbn1cblxuZnVuY3Rpb24gdmlzaXREZWNvcmF0b3IoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgbm9kZTogdHMuRGVjb3JhdG9yLFxuICB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIsXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kPzogdHMuTW9kdWxlS2luZCxcbiAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uPzogc3RyaW5nLFxuKTogdHMuRGVjb3JhdG9yIHtcbiAgaWYgKCFpc0NvbXBvbmVudERlY29yYXRvcihub2RlLCB0eXBlQ2hlY2tlcikpIHtcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGlmICghdHMuaXNDYWxsRXhwcmVzc2lvbihub2RlLmV4cHJlc3Npb24pKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBjb25zdCBkZWNvcmF0b3JGYWN0b3J5ID0gbm9kZS5leHByZXNzaW9uO1xuICBjb25zdCBhcmdzID0gZGVjb3JhdG9yRmFjdG9yeS5hcmd1bWVudHM7XG4gIGlmIChhcmdzLmxlbmd0aCAhPT0gMSB8fCAhdHMuaXNPYmplY3RMaXRlcmFsRXhwcmVzc2lvbihhcmdzWzBdKSkge1xuICAgIC8vIFVuc3VwcG9ydGVkIGNvbXBvbmVudCBtZXRhZGF0YVxuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3Qgb2JqZWN0RXhwcmVzc2lvbiA9IGFyZ3NbMF0gYXMgdHMuT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb247XG4gIGNvbnN0IHN0eWxlUmVwbGFjZW1lbnRzOiB0cy5FeHByZXNzaW9uW10gPSBbXTtcblxuICAvLyB2aXNpdCBhbGwgcHJvcGVydGllc1xuICBsZXQgcHJvcGVydGllcyA9IHRzLnZpc2l0Tm9kZXMob2JqZWN0RXhwcmVzc2lvbi5wcm9wZXJ0aWVzLCAobm9kZSkgPT5cbiAgICB0cy5pc09iamVjdExpdGVyYWxFbGVtZW50TGlrZShub2RlKVxuICAgICAgPyB2aXNpdENvbXBvbmVudE1ldGFkYXRhKFxuICAgICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICAgIG5vZGUsXG4gICAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMsXG4gICAgICAgICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICAgICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24sXG4gICAgICAgIClcbiAgICAgIDogbm9kZSxcbiAgKTtcblxuICAvLyByZXBsYWNlIHByb3BlcnRpZXMgd2l0aCB1cGRhdGVkIHByb3BlcnRpZXNcbiAgaWYgKHN0eWxlUmVwbGFjZW1lbnRzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBzdHlsZVByb3BlcnR5ID0gbm9kZUZhY3RvcnkuY3JlYXRlUHJvcGVydHlBc3NpZ25tZW50KFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcignc3R5bGVzJyksXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVBcnJheUxpdGVyYWxFeHByZXNzaW9uKHN0eWxlUmVwbGFjZW1lbnRzKSxcbiAgICApO1xuXG4gICAgcHJvcGVydGllcyA9IG5vZGVGYWN0b3J5LmNyZWF0ZU5vZGVBcnJheShbLi4ucHJvcGVydGllcywgc3R5bGVQcm9wZXJ0eV0pO1xuICB9XG5cbiAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZURlY29yYXRvcihcbiAgICBub2RlLFxuICAgIG5vZGVGYWN0b3J5LnVwZGF0ZUNhbGxFeHByZXNzaW9uKFxuICAgICAgZGVjb3JhdG9yRmFjdG9yeSxcbiAgICAgIGRlY29yYXRvckZhY3RvcnkuZXhwcmVzc2lvbixcbiAgICAgIGRlY29yYXRvckZhY3RvcnkudHlwZUFyZ3VtZW50cyxcbiAgICAgIFtub2RlRmFjdG9yeS51cGRhdGVPYmplY3RMaXRlcmFsRXhwcmVzc2lvbihvYmplY3RFeHByZXNzaW9uLCBwcm9wZXJ0aWVzKV0sXG4gICAgKSxcbiAgKTtcbn1cblxuZnVuY3Rpb24gdmlzaXRDb21wb25lbnRNZXRhZGF0YShcbiAgbm9kZUZhY3Rvcnk6IHRzLk5vZGVGYWN0b3J5LFxuICBub2RlOiB0cy5PYmplY3RMaXRlcmFsRWxlbWVudExpa2UsXG4gIHN0eWxlUmVwbGFjZW1lbnRzOiB0cy5FeHByZXNzaW9uW10sXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kOiB0cy5Nb2R1bGVLaW5kID0gdHMuTW9kdWxlS2luZC5FUzIwMTUsXG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZyxcbik6IHRzLk9iamVjdExpdGVyYWxFbGVtZW50TGlrZSB8IHVuZGVmaW5lZCB7XG4gIGlmICghdHMuaXNQcm9wZXJ0eUFzc2lnbm1lbnQobm9kZSkgfHwgdHMuaXNDb21wdXRlZFByb3BlcnR5TmFtZShub2RlLm5hbWUpKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBjb25zdCBuYW1lID0gbm9kZS5uYW1lLnRleHQ7XG4gIHN3aXRjaCAobmFtZSkge1xuICAgIGNhc2UgJ21vZHVsZUlkJzpcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG5cbiAgICBjYXNlICd0ZW1wbGF0ZVVybCc6XG4gICAgICBjb25zdCB1cmwgPSBnZXRSZXNvdXJjZVVybChub2RlLmluaXRpYWxpemVyKTtcbiAgICAgIGlmICghdXJsKSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpbXBvcnROYW1lID0gY3JlYXRlUmVzb3VyY2VJbXBvcnQoXG4gICAgICAgIG5vZGVGYWN0b3J5LFxuICAgICAgICB1cmwsXG4gICAgICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgKTtcbiAgICAgIGlmICghaW1wb3J0TmFtZSkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZVByb3BlcnR5QXNzaWdubWVudChcbiAgICAgICAgbm9kZSxcbiAgICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcigndGVtcGxhdGUnKSxcbiAgICAgICAgaW1wb3J0TmFtZSxcbiAgICAgICk7XG4gICAgY2FzZSAnc3R5bGVzJzpcbiAgICBjYXNlICdzdHlsZVVybHMnOlxuICAgICAgaWYgKCF0cy5pc0FycmF5TGl0ZXJhbEV4cHJlc3Npb24obm9kZS5pbml0aWFsaXplcikpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlzSW5saW5lU3R5bGUgPSBuYW1lID09PSAnc3R5bGVzJztcbiAgICAgIGNvbnN0IHN0eWxlcyA9IHRzLnZpc2l0Tm9kZXMobm9kZS5pbml0aWFsaXplci5lbGVtZW50cywgKG5vZGUpID0+IHtcbiAgICAgICAgaWYgKCF0cy5pc1N0cmluZ0xpdGVyYWwobm9kZSkgJiYgIXRzLmlzTm9TdWJzdGl0dXRpb25UZW1wbGF0ZUxpdGVyYWwobm9kZSkpIHtcbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCB1cmw7XG4gICAgICAgIGlmIChpc0lubGluZVN0eWxlKSB7XG4gICAgICAgICAgaWYgKGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbikge1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IEJ1ZmZlci5mcm9tKG5vZGUudGV4dCkudG9TdHJpbmcoJ2Jhc2U2NCcpO1xuICAgICAgICAgICAgY29uc3QgY29udGFpbmluZ0ZpbGUgPSBub2RlLmdldFNvdXJjZUZpbGUoKS5maWxlTmFtZTtcbiAgICAgICAgICAgIC8vIGFwcC5jb21wb25lbnQudHMuY3NzP25nUmVzb3VyY2UhPSFAbmd0b29scy93ZWJwYWNrL3NyYy9sb2FkZXJzL2lubGluZS1yZXNvdXJjZS5qcz9kYXRhPS4uLiFhcHAuY29tcG9uZW50LnRzXG4gICAgICAgICAgICB1cmwgPVxuICAgICAgICAgICAgICBgJHtjb250YWluaW5nRmlsZX0uJHtpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb259PyR7TkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZfWAgK1xuICAgICAgICAgICAgICBgIT0hJHtJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRofT9kYXRhPSR7ZW5jb2RlVVJJQ29tcG9uZW50KFxuICAgICAgICAgICAgICAgIGRhdGEsXG4gICAgICAgICAgICAgICl9ISR7Y29udGFpbmluZ0ZpbGV9YDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LmNyZWF0ZVN0cmluZ0xpdGVyYWwobm9kZS50ZXh0KTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdXJsID0gZ2V0UmVzb3VyY2VVcmwobm9kZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXVybCkge1xuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZVJlc291cmNlSW1wb3J0KG5vZGVGYWN0b3J5LCB1cmwsIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLCBtb2R1bGVLaW5kKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBTdHlsZXMgc2hvdWxkIGJlIHBsYWNlZCBmaXJzdFxuICAgICAgaWYgKGlzSW5saW5lU3R5bGUpIHtcbiAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMudW5zaGlmdCguLi5zdHlsZXMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3R5bGVSZXBsYWNlbWVudHMucHVzaCguLi5zdHlsZXMpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbm9kZTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVzb3VyY2VVcmwobm9kZTogdHMuTm9kZSk6IHN0cmluZyB8IG51bGwge1xuICAvLyBvbmx5IGFuYWx5emUgc3RyaW5nc1xuICBpZiAoIXRzLmlzU3RyaW5nTGl0ZXJhbChub2RlKSAmJiAhdHMuaXNOb1N1YnN0aXR1dGlvblRlbXBsYXRlTGl0ZXJhbChub2RlKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcmV0dXJuIGAkey9eXFwuP1xcLlxcLy8udGVzdChub2RlLnRleHQpID8gJycgOiAnLi8nfSR7bm9kZS50ZXh0fT8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX1gO1xufVxuXG5mdW5jdGlvbiBpc0NvbXBvbmVudERlY29yYXRvcihub2RlOiB0cy5Ob2RlLCB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIpOiBub2RlIGlzIHRzLkRlY29yYXRvciB7XG4gIGlmICghdHMuaXNEZWNvcmF0b3Iobm9kZSkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBjb25zdCBvcmlnaW4gPSBnZXREZWNvcmF0b3JPcmlnaW4obm9kZSwgdHlwZUNoZWNrZXIpO1xuICBpZiAob3JpZ2luICYmIG9yaWdpbi5tb2R1bGUgPT09ICdAYW5ndWxhci9jb3JlJyAmJiBvcmlnaW4ubmFtZSA9PT0gJ0NvbXBvbmVudCcpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlUmVzb3VyY2VJbXBvcnQoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgdXJsOiBzdHJpbmcsXG4gIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zOiB0cy5JbXBvcnREZWNsYXJhdGlvbltdLFxuICBtb2R1bGVLaW5kOiB0cy5Nb2R1bGVLaW5kLFxuKTogdHMuSWRlbnRpZmllciB8IHRzLkV4cHJlc3Npb24ge1xuICBjb25zdCB1cmxMaXRlcmFsID0gbm9kZUZhY3RvcnkuY3JlYXRlU3RyaW5nTGl0ZXJhbCh1cmwpO1xuXG4gIGlmIChtb2R1bGVLaW5kIDwgdHMuTW9kdWxlS2luZC5FUzIwMTUpIHtcbiAgICByZXR1cm4gbm9kZUZhY3RvcnkuY3JlYXRlQ2FsbEV4cHJlc3Npb24oXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKCdyZXF1aXJlJyksXG4gICAgICBbXSxcbiAgICAgIFt1cmxMaXRlcmFsXSxcbiAgICApO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IGltcG9ydE5hbWUgPSBub2RlRmFjdG9yeS5jcmVhdGVJZGVudGlmaWVyKFxuICAgICAgYF9fTkdfQ0xJX1JFU09VUkNFX18ke3Jlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLmxlbmd0aH1gLFxuICAgICk7XG4gICAgcmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMucHVzaChcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydERlY2xhcmF0aW9uKFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUltcG9ydENsYXVzZShmYWxzZSwgaW1wb3J0TmFtZSwgdW5kZWZpbmVkKSxcbiAgICAgICAgdXJsTGl0ZXJhbCxcbiAgICAgICksXG4gICAgKTtcblxuICAgIHJldHVybiBpbXBvcnROYW1lO1xuICB9XG59XG5cbmludGVyZmFjZSBEZWNvcmF0b3JPcmlnaW4ge1xuICBuYW1lOiBzdHJpbmc7XG4gIG1vZHVsZTogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBnZXREZWNvcmF0b3JPcmlnaW4oXG4gIGRlY29yYXRvcjogdHMuRGVjb3JhdG9yLFxuICB0eXBlQ2hlY2tlcjogdHMuVHlwZUNoZWNrZXIsXG4pOiBEZWNvcmF0b3JPcmlnaW4gfCBudWxsIHtcbiAgaWYgKCF0cy5pc0NhbGxFeHByZXNzaW9uKGRlY29yYXRvci5leHByZXNzaW9uKSkge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgbGV0IGlkZW50aWZpZXI6IHRzLk5vZGU7XG4gIGxldCBuYW1lID0gJyc7XG5cbiAgaWYgKHRzLmlzUHJvcGVydHlBY2Nlc3NFeHByZXNzaW9uKGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24pKSB7XG4gICAgaWRlbnRpZmllciA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24uZXhwcmVzc2lvbjtcbiAgICBuYW1lID0gZGVjb3JhdG9yLmV4cHJlc3Npb24uZXhwcmVzc2lvbi5uYW1lLnRleHQ7XG4gIH0gZWxzZSBpZiAodHMuaXNJZGVudGlmaWVyKGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24pKSB7XG4gICAgaWRlbnRpZmllciA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb247XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICAvLyBOT1RFOiByZXNvbHZlci5nZXRSZWZlcmVuY2VkSW1wb3J0RGVjbGFyYXRpb24gd291bGQgd29yayBhcyB3ZWxsIGJ1dCBpcyBpbnRlcm5hbFxuICBjb25zdCBzeW1ib2wgPSB0eXBlQ2hlY2tlci5nZXRTeW1ib2xBdExvY2F0aW9uKGlkZW50aWZpZXIpO1xuICBpZiAoc3ltYm9sICYmIHN5bWJvbC5kZWNsYXJhdGlvbnMgJiYgc3ltYm9sLmRlY2xhcmF0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgZGVjbGFyYXRpb24gPSBzeW1ib2wuZGVjbGFyYXRpb25zWzBdO1xuICAgIGxldCBtb2R1bGU6IHN0cmluZztcblxuICAgIGlmICh0cy5pc0ltcG9ydFNwZWNpZmllcihkZWNsYXJhdGlvbikpIHtcbiAgICAgIG5hbWUgPSAoZGVjbGFyYXRpb24ucHJvcGVydHlOYW1lIHx8IGRlY2xhcmF0aW9uLm5hbWUpLnRleHQ7XG4gICAgICBtb2R1bGUgPSAoZGVjbGFyYXRpb24ucGFyZW50LnBhcmVudC5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIGlmICh0cy5pc05hbWVzcGFjZUltcG9ydChkZWNsYXJhdGlvbikpIHtcbiAgICAgIC8vIFVzZSB0aGUgbmFtZSBmcm9tIHRoZSBkZWNvcmF0b3IgbmFtZXNwYWNlIHByb3BlcnR5IGFjY2Vzc1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIGlmICh0cy5pc0ltcG9ydENsYXVzZShkZWNsYXJhdGlvbikpIHtcbiAgICAgIG5hbWUgPSAoZGVjbGFyYXRpb24ubmFtZSBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5tb2R1bGVTcGVjaWZpZXIgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHsgbmFtZSwgbW9kdWxlIH07XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuLyoqIENoZWNrcyBpZiB0aGUgY3VycmVudCB2ZXJzaW9uIG9mIFR5cGVTY3JpcHQgaXMgYWZ0ZXIgdGhlIHNwZWNpZmllZCBtYWpvci9taW5vciB2ZXJzaW9ucy4gKi9cbmZ1bmN0aW9uIGlzQWZ0ZXJWZXJzaW9uKHRhcmdldE1ham9yOiBudW1iZXIsIHRhcmdldE1pbm9yOiBudW1iZXIpOiBib29sZWFuIHtcbiAgY29uc3QgW21ham9yLCBtaW5vcl0gPSB0cy52ZXJzaW9uTWFqb3JNaW5vci5zcGxpdCgnLicpLm1hcCgocGFydCkgPT4gcGFyc2VJbnQocGFydCkpO1xuXG4gIGlmIChtYWpvciA8IHRhcmdldE1ham9yKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9IGVsc2UgaWYgKG1ham9yID4gdGFyZ2V0TWFqb3IpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gbWlub3IgPj0gdGFyZ2V0TWlub3I7XG4gIH1cbn1cbiJdfQ==