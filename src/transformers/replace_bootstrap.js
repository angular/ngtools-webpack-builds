"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ignoreDep typescript
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const insert_import_1 = require("./insert_import");
const remove_import_1 = require("./remove_import");
const make_transform_1 = require("./make_transform");
function replaceBootstrap(sourceFile, entryModule) {
    const ops = [];
    // Find all identifiers using the entry module class name.
    const entryModuleIdentifiers = ast_helpers_1.findAstNodes(null, sourceFile, ts.SyntaxKind.Identifier, true)
        .filter(identifier => identifier.getText() === entryModule.className);
    if (entryModuleIdentifiers.length === 0) {
        return [];
    }
    // Get the module path from the import.
    let modulePath;
    entryModuleIdentifiers.forEach((entryModuleIdentifier) => {
        // TODO: only supports `import {A, B, C} from 'modulePath'` atm, add other import support later.
        if (entryModuleIdentifier.parent.kind !== ts.SyntaxKind.ImportSpecifier) {
            return;
        }
        const importSpec = entryModuleIdentifier.parent;
        const moduleSpecifier = importSpec.parent.parent.parent.moduleSpecifier;
        if (moduleSpecifier.kind !== ts.SyntaxKind.StringLiteral) {
            return;
        }
        modulePath = moduleSpecifier.text;
    });
    if (!modulePath) {
        return [];
    }
    // Find the bootstrap calls.
    const removedEntryModuleIdentifiers = [];
    const removedPlatformBrowserDynamicIdentifier = [];
    entryModuleIdentifiers.forEach(entryModuleIdentifier => {
        // Figure out if it's a `platformBrowserDynamic().bootstrapModule(AppModule)` call.
        if (!(entryModuleIdentifier.parent
            && entryModuleIdentifier.parent.kind === ts.SyntaxKind.CallExpression)) {
            return;
        }
        const callExpr = entryModuleIdentifier.parent;
        if (callExpr.expression.kind !== ts.SyntaxKind.PropertyAccessExpression) {
            return;
        }
        const propAccessExpr = callExpr.expression;
        if (propAccessExpr.name.text !== 'bootstrapModule'
            || propAccessExpr.expression.kind !== ts.SyntaxKind.CallExpression) {
            return;
        }
        const bootstrapModuleIdentifier = propAccessExpr.name;
        const innerCallExpr = propAccessExpr.expression;
        if (!(innerCallExpr.expression.kind === ts.SyntaxKind.Identifier
            && innerCallExpr.expression.text === 'platformBrowserDynamic')) {
            return;
        }
        const platformBrowserDynamicIdentifier = innerCallExpr.expression;
        const idPlatformBrowser = ts.createUniqueName('__NgCli_bootstrap_');
        const idNgFactory = ts.createUniqueName('__NgCli_bootstrap_');
        // Add the transform operations.
        const factoryClassName = entryModule.className + 'NgFactory';
        const factoryModulePath = modulePath + '.ngfactory';
        ops.push(
        // Replace the entry module import.
        ...insert_import_1.insertStarImport(sourceFile, idNgFactory, factoryModulePath), new make_transform_1.ReplaceNodeOperation(sourceFile, entryModuleIdentifier, ts.createPropertyAccess(idNgFactory, ts.createIdentifier(factoryClassName))), 
        // Replace the platformBrowserDynamic import.
        ...insert_import_1.insertStarImport(sourceFile, idPlatformBrowser, '@angular/platform-browser'), new make_transform_1.ReplaceNodeOperation(sourceFile, platformBrowserDynamicIdentifier, ts.createPropertyAccess(idPlatformBrowser, 'platformBrowser')), new make_transform_1.ReplaceNodeOperation(sourceFile, bootstrapModuleIdentifier, ts.createIdentifier('bootstrapModuleFactory')));
        // Save the import identifiers that we replaced for removal.
        removedEntryModuleIdentifiers.push(entryModuleIdentifier);
        removedPlatformBrowserDynamicIdentifier.push(platformBrowserDynamicIdentifier);
    });
    // Now that we know all the import identifiers we removed, we can remove the import.
    ops.push(...remove_import_1.removeImport(sourceFile, removedEntryModuleIdentifiers), ...remove_import_1.removeImport(sourceFile, removedPlatformBrowserDynamicIdentifier));
    return ops;
}
exports.replaceBootstrap = replaceBootstrap;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/replace_bootstrap.js.map