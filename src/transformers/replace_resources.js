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
                const decorators = ts.getDecorators(node);
                if (!decorators || decorators.length === 0) {
                    return node;
                }
                return nodeFactory.updateClassDeclaration(node, [
                    ...decorators.map((current) => visitDecorator(nodeFactory, current, typeChecker, resourceImportDeclarations, moduleKind, inlineStyleFileExtension)),
                    ...(ts.getModifiers(node) ?? []),
                ], node.name, node.typeParameters, node.heritageClauses, node.members);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVwbGFjZV9yZXNvdXJjZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi8uLi8uLi9wYWNrYWdlcy9uZ3Rvb2xzL3dlYnBhY2svc3JjL3RyYW5zZm9ybWVycy9yZXBsYWNlX3Jlc291cmNlcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7Ozs7OztHQU1HOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUVILCtDQUFpQztBQUNqQyxnRUFBNkU7QUFFaEUsUUFBQSwyQkFBMkIsR0FBRyxZQUFZLENBQUM7QUFFeEQsU0FBZ0IsZ0JBQWdCLENBQzlCLGVBQThDLEVBQzlDLGNBQW9DLEVBQ3BDLHdCQUFpQztJQUVqQyxPQUFPLENBQUMsT0FBaUMsRUFBRSxFQUFFO1FBQzNDLE1BQU0sV0FBVyxHQUFHLGNBQWMsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sMEJBQTBCLEdBQTJCLEVBQUUsQ0FBQztRQUM5RCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxNQUFNLENBQUM7UUFDdkQsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQztRQUVwQyxNQUFNLFNBQVMsR0FBZSxDQUFDLElBQWEsRUFBRSxFQUFFO1lBQzlDLElBQUksRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO2dCQUMvQixNQUFNLFVBQVUsR0FBRyxFQUFFLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUUxQyxJQUFJLENBQUMsVUFBVSxJQUFJLFVBQVUsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFO29CQUMxQyxPQUFPLElBQUksQ0FBQztpQkFDYjtnQkFFRCxPQUFPLFdBQVcsQ0FBQyxzQkFBc0IsQ0FDdkMsSUFBSSxFQUNKO29CQUNFLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQzVCLGNBQWMsQ0FDWixXQUFXLEVBQ1gsT0FBTyxFQUNQ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Q0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLEVBQUU7WUFDekMsSUFBSSxHQUFJLFdBQVcsQ0FBQyxJQUFzQixDQUFDLElBQUksQ0FBQztZQUNoRCxNQUFNLEdBQUksV0FBVyxDQUFDLE1BQU0sQ0FBQyxlQUFpQyxDQUFDLElBQUksQ0FBQztTQUNyRTthQUFNO1lBQ0wsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUVELE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLENBQUM7S0FDekI7SUFFRCxPQUFPLElBQUksQ0FBQztBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5pbXBvcnQgeyBJbmxpbmVBbmd1bGFyUmVzb3VyY2VMb2FkZXJQYXRoIH0gZnJvbSAnLi4vbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UnO1xuXG5leHBvcnQgY29uc3QgTkdfQ09NUE9ORU5UX1JFU09VUkNFX1FVRVJZID0gJ25nUmVzb3VyY2UnO1xuXG5leHBvcnQgZnVuY3Rpb24gcmVwbGFjZVJlc291cmNlcyhcbiAgc2hvdWxkVHJhbnNmb3JtOiAoZmlsZU5hbWU6IHN0cmluZykgPT4gYm9vbGVhbixcbiAgZ2V0VHlwZUNoZWNrZXI6ICgpID0+IHRzLlR5cGVDaGVja2VyLFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5UcmFuc2Zvcm1lckZhY3Rvcnk8dHMuU291cmNlRmlsZT4ge1xuICByZXR1cm4gKGNvbnRleHQ6IHRzLlRyYW5zZm9ybWF0aW9uQ29udGV4dCkgPT4ge1xuICAgIGNvbnN0IHR5cGVDaGVja2VyID0gZ2V0VHlwZUNoZWNrZXIoKTtcbiAgICBjb25zdCByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSA9IFtdO1xuICAgIGNvbnN0IG1vZHVsZUtpbmQgPSBjb250ZXh0LmdldENvbXBpbGVyT3B0aW9ucygpLm1vZHVsZTtcbiAgICBjb25zdCBub2RlRmFjdG9yeSA9IGNvbnRleHQuZmFjdG9yeTtcblxuICAgIGNvbnN0IHZpc2l0Tm9kZTogdHMuVmlzaXRvciA9IChub2RlOiB0cy5Ob2RlKSA9PiB7XG4gICAgICBpZiAodHMuaXNDbGFzc0RlY2xhcmF0aW9uKG5vZGUpKSB7XG4gICAgICAgIGNvbnN0IGRlY29yYXRvcnMgPSB0cy5nZXREZWNvcmF0b3JzKG5vZGUpO1xuXG4gICAgICAgIGlmICghZGVjb3JhdG9ycyB8fCBkZWNvcmF0b3JzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgIHJldHVybiBub2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGVGYWN0b3J5LnVwZGF0ZUNsYXNzRGVjbGFyYXRpb24oXG4gICAgICAgICAgbm9kZSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICAuLi5kZWNvcmF0b3JzLm1hcCgoY3VycmVudCkgPT5cbiAgICAgICAgICAgICAgdmlzaXREZWNvcmF0b3IoXG4gICAgICAgICAgICAgICAgbm9kZUZhY3RvcnksXG4gICAgICAgICAgICAgICAgY3VycmVudCxcbiAgICAgICAgICAgICAgICB0eXBlQ2hlY2tlcixcbiAgICAgICAgICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgICAgICAgICBtb2R1bGVLaW5kLFxuICAgICAgICAgICAgICAgIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbixcbiAgICAgICAgICAgICAgKSxcbiAgICAgICAgICAgICksXG4gICAgICAgICAgICAuLi4odHMuZ2V0TW9kaWZpZXJzKG5vZGUpID8/IFtdKSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIG5vZGUubmFtZSxcbiAgICAgICAgICBub2RlLnR5cGVQYXJhbWV0ZXJzLFxuICAgICAgICAgIG5vZGUuaGVyaXRhZ2VDbGF1c2VzLFxuICAgICAgICAgIG5vZGUubWVtYmVycyxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIHZpc2l0Tm9kZSwgY29udGV4dCk7XG4gICAgfTtcblxuICAgIHJldHVybiAoc291cmNlRmlsZTogdHMuU291cmNlRmlsZSkgPT4ge1xuICAgICAgaWYgKCFzaG91bGRUcmFuc2Zvcm0oc291cmNlRmlsZS5maWxlTmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIHNvdXJjZUZpbGU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHVwZGF0ZWRTb3VyY2VGaWxlID0gdHMudmlzaXROb2RlKHNvdXJjZUZpbGUsIHZpc2l0Tm9kZSk7XG4gICAgICBpZiAocmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMubGVuZ3RoKSB7XG4gICAgICAgIC8vIEFkZCByZXNvdXJjZSBpbXBvcnRzXG4gICAgICAgIHJldHVybiBjb250ZXh0LmZhY3RvcnkudXBkYXRlU291cmNlRmlsZShcbiAgICAgICAgICB1cGRhdGVkU291cmNlRmlsZSxcbiAgICAgICAgICB0cy5zZXRUZXh0UmFuZ2UoXG4gICAgICAgICAgICBjb250ZXh0LmZhY3RvcnkuY3JlYXRlTm9kZUFycmF5KFtcbiAgICAgICAgICAgICAgLi4ucmVzb3VyY2VJbXBvcnREZWNsYXJhdGlvbnMsXG4gICAgICAgICAgICAgIC4uLnVwZGF0ZWRTb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgICBdKSxcbiAgICAgICAgICAgIHVwZGF0ZWRTb3VyY2VGaWxlLnN0YXRlbWVudHMsXG4gICAgICAgICAgKSxcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVwZGF0ZWRTb3VyY2VGaWxlO1xuICAgIH07XG4gIH07XG59XG5cbmZ1bmN0aW9uIHZpc2l0RGVjb3JhdG9yKFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIG5vZGU6IHRzLkRlY29yYXRvcixcbiAgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZD86IHRzLk1vZHVsZUtpbmQsXG4gIGlubGluZVN0eWxlRmlsZUV4dGVuc2lvbj86IHN0cmluZyxcbik6IHRzLkRlY29yYXRvciB7XG4gIGlmICghaXNDb21wb25lbnREZWNvcmF0b3Iobm9kZSwgdHlwZUNoZWNrZXIpKSB7XG4gICAgcmV0dXJuIG5vZGU7XG4gIH1cblxuICBpZiAoIXRzLmlzQ2FsbEV4cHJlc3Npb24obm9kZS5leHByZXNzaW9uKSkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3QgZGVjb3JhdG9yRmFjdG9yeSA9IG5vZGUuZXhwcmVzc2lvbjtcbiAgY29uc3QgYXJncyA9IGRlY29yYXRvckZhY3RvcnkuYXJndW1lbnRzO1xuICBpZiAoYXJncy5sZW5ndGggIT09IDEgfHwgIXRzLmlzT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24oYXJnc1swXSkpIHtcbiAgICAvLyBVbnN1cHBvcnRlZCBjb21wb25lbnQgbWV0YWRhdGFcbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIGNvbnN0IG9iamVjdEV4cHJlc3Npb24gPSBhcmdzWzBdIGFzIHRzLk9iamVjdExpdGVyYWxFeHByZXNzaW9uO1xuICBjb25zdCBzdHlsZVJlcGxhY2VtZW50czogdHMuRXhwcmVzc2lvbltdID0gW107XG5cbiAgLy8gdmlzaXQgYWxsIHByb3BlcnRpZXNcbiAgbGV0IHByb3BlcnRpZXMgPSB0cy52aXNpdE5vZGVzKG9iamVjdEV4cHJlc3Npb24ucHJvcGVydGllcywgKG5vZGUpID0+XG4gICAgdHMuaXNPYmplY3RMaXRlcmFsRWxlbWVudExpa2Uobm9kZSlcbiAgICAgID8gdmlzaXRDb21wb25lbnRNZXRhZGF0YShcbiAgICAgICAgICBub2RlRmFjdG9yeSxcbiAgICAgICAgICBub2RlLFxuICAgICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLFxuICAgICAgICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLFxuICAgICAgICAgIG1vZHVsZUtpbmQsXG4gICAgICAgICAgaW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9uLFxuICAgICAgICApXG4gICAgICA6IG5vZGUsXG4gICk7XG5cbiAgLy8gcmVwbGFjZSBwcm9wZXJ0aWVzIHdpdGggdXBkYXRlZCBwcm9wZXJ0aWVzXG4gIGlmIChzdHlsZVJlcGxhY2VtZW50cy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3Qgc3R5bGVQcm9wZXJ0eSA9IG5vZGVGYWN0b3J5LmNyZWF0ZVByb3BlcnR5QXNzaWdubWVudChcbiAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoJ3N0eWxlcycpLFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlQXJyYXlMaXRlcmFsRXhwcmVzc2lvbihzdHlsZVJlcGxhY2VtZW50cyksXG4gICAgKTtcblxuICAgIHByb3BlcnRpZXMgPSBub2RlRmFjdG9yeS5jcmVhdGVOb2RlQXJyYXkoWy4uLnByb3BlcnRpZXMsIHN0eWxlUHJvcGVydHldKTtcbiAgfVxuXG4gIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVEZWNvcmF0b3IoXG4gICAgbm9kZSxcbiAgICBub2RlRmFjdG9yeS51cGRhdGVDYWxsRXhwcmVzc2lvbihcbiAgICAgIGRlY29yYXRvckZhY3RvcnksXG4gICAgICBkZWNvcmF0b3JGYWN0b3J5LmV4cHJlc3Npb24sXG4gICAgICBkZWNvcmF0b3JGYWN0b3J5LnR5cGVBcmd1bWVudHMsXG4gICAgICBbbm9kZUZhY3RvcnkudXBkYXRlT2JqZWN0TGl0ZXJhbEV4cHJlc3Npb24ob2JqZWN0RXhwcmVzc2lvbiwgcHJvcGVydGllcyldLFxuICAgICksXG4gICk7XG59XG5cbmZ1bmN0aW9uIHZpc2l0Q29tcG9uZW50TWV0YWRhdGEoXG4gIG5vZGVGYWN0b3J5OiB0cy5Ob2RlRmFjdG9yeSxcbiAgbm9kZTogdHMuT2JqZWN0TGl0ZXJhbEVsZW1lbnRMaWtlLFxuICBzdHlsZVJlcGxhY2VtZW50czogdHMuRXhwcmVzc2lvbltdLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZDogdHMuTW9kdWxlS2luZCA9IHRzLk1vZHVsZUtpbmQuRVMyMDE1LFxuICBpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24/OiBzdHJpbmcsXG4pOiB0cy5PYmplY3RMaXRlcmFsRWxlbWVudExpa2UgfCB1bmRlZmluZWQge1xuICBpZiAoIXRzLmlzUHJvcGVydHlBc3NpZ25tZW50KG5vZGUpIHx8IHRzLmlzQ29tcHV0ZWRQcm9wZXJ0eU5hbWUobm9kZS5uYW1lKSkge1xuICAgIHJldHVybiBub2RlO1xuICB9XG5cbiAgY29uc3QgbmFtZSA9IG5vZGUubmFtZS50ZXh0O1xuICBzd2l0Y2ggKG5hbWUpIHtcbiAgICBjYXNlICdtb2R1bGVJZCc6XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgY2FzZSAndGVtcGxhdGVVcmwnOlxuICAgICAgY29uc3QgdXJsID0gZ2V0UmVzb3VyY2VVcmwobm9kZS5pbml0aWFsaXplcik7XG4gICAgICBpZiAoIXVybCkge1xuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW1wb3J0TmFtZSA9IGNyZWF0ZVJlc291cmNlSW1wb3J0KFxuICAgICAgICBub2RlRmFjdG9yeSxcbiAgICAgICAgdXJsLFxuICAgICAgICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucyxcbiAgICAgICAgbW9kdWxlS2luZCxcbiAgICAgICk7XG4gICAgICBpZiAoIWltcG9ydE5hbWUpIHtcbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBub2RlRmFjdG9yeS51cGRhdGVQcm9wZXJ0eUFzc2lnbm1lbnQoXG4gICAgICAgIG5vZGUsXG4gICAgICAgIG5vZGVGYWN0b3J5LmNyZWF0ZUlkZW50aWZpZXIoJ3RlbXBsYXRlJyksXG4gICAgICAgIGltcG9ydE5hbWUsXG4gICAgICApO1xuICAgIGNhc2UgJ3N0eWxlcyc6XG4gICAgY2FzZSAnc3R5bGVVcmxzJzpcbiAgICAgIGlmICghdHMuaXNBcnJheUxpdGVyYWxFeHByZXNzaW9uKG5vZGUuaW5pdGlhbGl6ZXIpKSB7XG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBpc0lubGluZVN0eWxlID0gbmFtZSA9PT0gJ3N0eWxlcyc7XG4gICAgICBjb25zdCBzdHlsZXMgPSB0cy52aXNpdE5vZGVzKG5vZGUuaW5pdGlhbGl6ZXIuZWxlbWVudHMsIChub2RlKSA9PiB7XG4gICAgICAgIGlmICghdHMuaXNTdHJpbmdMaXRlcmFsKG5vZGUpICYmICF0cy5pc05vU3Vic3RpdHV0aW9uVGVtcGxhdGVMaXRlcmFsKG5vZGUpKSB7XG4gICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgdXJsO1xuICAgICAgICBpZiAoaXNJbmxpbmVTdHlsZSkge1xuICAgICAgICAgIGlmIChpbmxpbmVTdHlsZUZpbGVFeHRlbnNpb24pIHtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBCdWZmZXIuZnJvbShub2RlLnRleHQpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICAgICAgICAgIGNvbnN0IGNvbnRhaW5pbmdGaWxlID0gbm9kZS5nZXRTb3VyY2VGaWxlKCkuZmlsZU5hbWU7XG4gICAgICAgICAgICAvLyBhcHAuY29tcG9uZW50LnRzLmNzcz9uZ1Jlc291cmNlIT0hQG5ndG9vbHMvd2VicGFjay9zcmMvbG9hZGVycy9pbmxpbmUtcmVzb3VyY2UuanM/ZGF0YT0uLi4hYXBwLmNvbXBvbmVudC50c1xuICAgICAgICAgICAgdXJsID1cbiAgICAgICAgICAgICAgYCR7Y29udGFpbmluZ0ZpbGV9LiR7aW5saW5lU3R5bGVGaWxlRXh0ZW5zaW9ufT8ke05HX0NPTVBPTkVOVF9SRVNPVVJDRV9RVUVSWX1gICtcbiAgICAgICAgICAgICAgYCE9ISR7SW5saW5lQW5ndWxhclJlc291cmNlTG9hZGVyUGF0aH0/ZGF0YT0ke2VuY29kZVVSSUNvbXBvbmVudChcbiAgICAgICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAgICApfSEke2NvbnRhaW5pbmdGaWxlfWA7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBub2RlRmFjdG9yeS5jcmVhdGVTdHJpbmdMaXRlcmFsKG5vZGUudGV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHVybCA9IGdldFJlc291cmNlVXJsKG5vZGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjcmVhdGVSZXNvdXJjZUltcG9ydChub2RlRmFjdG9yeSwgdXJsLCByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucywgbW9kdWxlS2luZCk7XG4gICAgICB9KTtcblxuICAgICAgLy8gU3R5bGVzIHNob3VsZCBiZSBwbGFjZWQgZmlyc3RcbiAgICAgIGlmIChpc0lubGluZVN0eWxlKSB7XG4gICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLnVuc2hpZnQoLi4uc3R5bGVzKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0eWxlUmVwbGFjZW1lbnRzLnB1c2goLi4uc3R5bGVzKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG5vZGU7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJlc291cmNlVXJsKG5vZGU6IHRzLk5vZGUpOiBzdHJpbmcgfCBudWxsIHtcbiAgLy8gb25seSBhbmFseXplIHN0cmluZ3NcbiAgaWYgKCF0cy5pc1N0cmluZ0xpdGVyYWwobm9kZSkgJiYgIXRzLmlzTm9TdWJzdGl0dXRpb25UZW1wbGF0ZUxpdGVyYWwobm9kZSkpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiBgJHsvXlxcLj9cXC5cXC8vLnRlc3Qobm9kZS50ZXh0KSA/ICcnIDogJy4vJ30ke25vZGUudGV4dH0/JHtOR19DT01QT05FTlRfUkVTT1VSQ0VfUVVFUll9YDtcbn1cblxuZnVuY3Rpb24gaXNDb21wb25lbnREZWNvcmF0b3Iobm9kZTogdHMuTm9kZSwgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyKTogbm9kZSBpcyB0cy5EZWNvcmF0b3Ige1xuICBpZiAoIXRzLmlzRGVjb3JhdG9yKG5vZGUpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3Qgb3JpZ2luID0gZ2V0RGVjb3JhdG9yT3JpZ2luKG5vZGUsIHR5cGVDaGVja2VyKTtcbiAgaWYgKG9yaWdpbiAmJiBvcmlnaW4ubW9kdWxlID09PSAnQGFuZ3VsYXIvY29yZScgJiYgb3JpZ2luLm5hbWUgPT09ICdDb21wb25lbnQnKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVJlc291cmNlSW1wb3J0KFxuICBub2RlRmFjdG9yeTogdHMuTm9kZUZhY3RvcnksXG4gIHVybDogc3RyaW5nLFxuICByZXNvdXJjZUltcG9ydERlY2xhcmF0aW9uczogdHMuSW1wb3J0RGVjbGFyYXRpb25bXSxcbiAgbW9kdWxlS2luZDogdHMuTW9kdWxlS2luZCxcbik6IHRzLklkZW50aWZpZXIgfCB0cy5FeHByZXNzaW9uIHtcbiAgY29uc3QgdXJsTGl0ZXJhbCA9IG5vZGVGYWN0b3J5LmNyZWF0ZVN0cmluZ0xpdGVyYWwodXJsKTtcblxuICBpZiAobW9kdWxlS2luZCA8IHRzLk1vZHVsZUtpbmQuRVMyMDE1KSB7XG4gICAgcmV0dXJuIG5vZGVGYWN0b3J5LmNyZWF0ZUNhbGxFeHByZXNzaW9uKFxuICAgICAgbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcigncmVxdWlyZScpLFxuICAgICAgW10sXG4gICAgICBbdXJsTGl0ZXJhbF0sXG4gICAgKTtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBpbXBvcnROYW1lID0gbm9kZUZhY3RvcnkuY3JlYXRlSWRlbnRpZmllcihcbiAgICAgIGBfX05HX0NMSV9SRVNPVVJDRV9fJHtyZXNvdXJjZUltcG9ydERlY2xhcmF0aW9ucy5sZW5ndGh9YCxcbiAgICApO1xuICAgIHJlc291cmNlSW1wb3J0RGVjbGFyYXRpb25zLnB1c2goXG4gICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnREZWNsYXJhdGlvbihcbiAgICAgICAgdW5kZWZpbmVkLFxuICAgICAgICBub2RlRmFjdG9yeS5jcmVhdGVJbXBvcnRDbGF1c2UoZmFsc2UsIGltcG9ydE5hbWUsIHVuZGVmaW5lZCksXG4gICAgICAgIHVybExpdGVyYWwsXG4gICAgICApLFxuICAgICk7XG5cbiAgICByZXR1cm4gaW1wb3J0TmFtZTtcbiAgfVxufVxuXG5pbnRlcmZhY2UgRGVjb3JhdG9yT3JpZ2luIHtcbiAgbmFtZTogc3RyaW5nO1xuICBtb2R1bGU6IHN0cmluZztcbn1cblxuZnVuY3Rpb24gZ2V0RGVjb3JhdG9yT3JpZ2luKFxuICBkZWNvcmF0b3I6IHRzLkRlY29yYXRvcixcbiAgdHlwZUNoZWNrZXI6IHRzLlR5cGVDaGVja2VyLFxuKTogRGVjb3JhdG9yT3JpZ2luIHwgbnVsbCB7XG4gIGlmICghdHMuaXNDYWxsRXhwcmVzc2lvbihkZWNvcmF0b3IuZXhwcmVzc2lvbikpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGxldCBpZGVudGlmaWVyOiB0cy5Ob2RlO1xuICBsZXQgbmFtZSA9ICcnO1xuXG4gIGlmICh0cy5pc1Byb3BlcnR5QWNjZXNzRXhwcmVzc2lvbihkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uKSkge1xuICAgIGlkZW50aWZpZXIgPSBkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uLmV4cHJlc3Npb247XG4gICAgbmFtZSA9IGRlY29yYXRvci5leHByZXNzaW9uLmV4cHJlc3Npb24ubmFtZS50ZXh0O1xuICB9IGVsc2UgaWYgKHRzLmlzSWRlbnRpZmllcihkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uKSkge1xuICAgIGlkZW50aWZpZXIgPSBkZWNvcmF0b3IuZXhwcmVzc2lvbi5leHByZXNzaW9uO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgLy8gTk9URTogcmVzb2x2ZXIuZ2V0UmVmZXJlbmNlZEltcG9ydERlY2xhcmF0aW9uIHdvdWxkIHdvcmsgYXMgd2VsbCBidXQgaXMgaW50ZXJuYWxcbiAgY29uc3Qgc3ltYm9sID0gdHlwZUNoZWNrZXIuZ2V0U3ltYm9sQXRMb2NhdGlvbihpZGVudGlmaWVyKTtcbiAgaWYgKHN5bWJvbCAmJiBzeW1ib2wuZGVjbGFyYXRpb25zICYmIHN5bWJvbC5kZWNsYXJhdGlvbnMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IGRlY2xhcmF0aW9uID0gc3ltYm9sLmRlY2xhcmF0aW9uc1swXTtcbiAgICBsZXQgbW9kdWxlOiBzdHJpbmc7XG5cbiAgICBpZiAodHMuaXNJbXBvcnRTcGVjaWZpZXIoZGVjbGFyYXRpb24pKSB7XG4gICAgICBuYW1lID0gKGRlY2xhcmF0aW9uLnByb3BlcnR5TmFtZSB8fCBkZWNsYXJhdGlvbi5uYW1lKS50ZXh0O1xuICAgICAgbW9kdWxlID0gKGRlY2xhcmF0aW9uLnBhcmVudC5wYXJlbnQucGFyZW50Lm1vZHVsZVNwZWNpZmllciBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgIH0gZWxzZSBpZiAodHMuaXNOYW1lc3BhY2VJbXBvcnQoZGVjbGFyYXRpb24pKSB7XG4gICAgICAvLyBVc2UgdGhlIG5hbWUgZnJvbSB0aGUgZGVjb3JhdG9yIG5hbWVzcGFjZSBwcm9wZXJ0eSBhY2Nlc3NcbiAgICAgIG1vZHVsZSA9IChkZWNsYXJhdGlvbi5wYXJlbnQucGFyZW50Lm1vZHVsZVNwZWNpZmllciBhcyB0cy5JZGVudGlmaWVyKS50ZXh0O1xuICAgIH0gZWxzZSBpZiAodHMuaXNJbXBvcnRDbGF1c2UoZGVjbGFyYXRpb24pKSB7XG4gICAgICBuYW1lID0gKGRlY2xhcmF0aW9uLm5hbWUgYXMgdHMuSWRlbnRpZmllcikudGV4dDtcbiAgICAgIG1vZHVsZSA9IChkZWNsYXJhdGlvbi5wYXJlbnQubW9kdWxlU3BlY2lmaWVyIGFzIHRzLklkZW50aWZpZXIpLnRleHQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7IG5hbWUsIG1vZHVsZSB9O1xuICB9XG5cbiAgcmV0dXJuIG51bGw7XG59XG4iXX0=