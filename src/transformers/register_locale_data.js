"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ignoreDep typescript
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const make_transform_1 = require("./make_transform");
const insert_import_1 = require("./insert_import");
function registerLocaleData(sourceFile, entryModule, locale) {
    const ops = [];
    // Find all identifiers using the entry module class name.
    const entryModuleIdentifiers = ast_helpers_1.findAstNodes(null, sourceFile, ts.SyntaxKind.Identifier, true)
        .filter(identifier => identifier.getText() === entryModule.className);
    if (entryModuleIdentifiers.length === 0) {
        return [];
    }
    // Find the bootstrap call
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
        const firstNode = ast_helpers_1.getFirstNode(sourceFile);
        // Create the import node for the locale.
        const localeNamespaceId = ts.createUniqueName('__NgCli_locale_');
        ops.push(...insert_import_1.insertStarImport(sourceFile, localeNamespaceId, `@angular/common/locales/${locale}`, firstNode, true));
        // Create the import node for the registerLocaleData function.
        const regIdentifier = ts.createIdentifier(`registerLocaleData`);
        const regNamespaceId = ts.createUniqueName('__NgCli_locale_');
        ops.push(...insert_import_1.insertStarImport(sourceFile, regNamespaceId, '@angular/common', firstNode, true));
        // Create the register function call
        const registerFunctionCall = ts.createCall(ts.createPropertyAccess(regNamespaceId, regIdentifier), undefined, [ts.createPropertyAccess(localeNamespaceId, 'default')]);
        const registerFunctionStatement = ts.createStatement(registerFunctionCall);
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, firstNode, registerFunctionStatement));
    });
    return ops;
}
exports.registerLocaleData = registerLocaleData;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/register_locale_data.js.map