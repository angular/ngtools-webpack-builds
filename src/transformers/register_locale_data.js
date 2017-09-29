"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const make_transform_1 = require("./make_transform");
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
        // Create the import node for the locale.
        const localeIdentifier = ts.createIdentifier(`__locale_${locale.replace(/-/g, '')}__`);
        const localeImportClause = ts.createImportClause(localeIdentifier, undefined);
        const localeNewImport = ts.createImportDeclaration(undefined, undefined, localeImportClause, ts.createLiteral(`@angular/common/locales/${locale}`));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), localeNewImport));
        // Create the import node for the registerLocaleData function.
        const regIdentifier = ts.createIdentifier(`registerLocaleData`);
        const regImportSpecifier = ts.createImportSpecifier(undefined, regIdentifier);
        const regNamedImport = ts.createNamedImports([regImportSpecifier]);
        const regImportClause = ts.createImportClause(undefined, regNamedImport);
        const regNewImport = ts.createImportDeclaration(undefined, undefined, regImportClause, ts.createLiteral('@angular/common'));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), regNewImport));
        // Create the register function call
        const registerFunctionCall = ts.createCall(regIdentifier, undefined, [localeIdentifier]);
        const registerFunctionStatement = ts.createStatement(registerFunctionCall);
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), registerFunctionStatement));
    });
    return ops;
}
exports.registerLocaleData = registerLocaleData;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/register_locale_data.js.map