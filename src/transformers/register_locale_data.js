"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
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
        // get the path of the common module
        const commonPath = path.dirname(require.resolve('@angular/common/package.json'));
        // check if the locale file exists
        if (!fs.existsSync(path.resolve(commonPath, 'locales', `${locale}.js`))) {
            // check for an alternative locale (if the locale id was badly formatted)
            const locales = fs.readdirSync(path.resolve(commonPath, 'locales'))
                .filter(file => file.endsWith('.js'))
                .map(file => file.replace('.js', ''));
            let newLocale;
            const normalizedLocale = locale.toLowerCase().replace(/_/g, '-');
            for (const l of locales) {
                if (l.toLowerCase() === normalizedLocale) {
                    newLocale = l;
                    break;
                }
            }
            if (newLocale) {
                locale = newLocale;
            }
            else {
                // check for a parent locale
                const parentLocale = normalizedLocale.split('-')[0];
                if (locales.indexOf(parentLocale) !== -1) {
                    locale = parentLocale;
                }
                else {
                    throw new Error(`Unable to load the locale data file "@angular/common/locales/${locale}", ` +
                        `please check that "${locale}" is a valid locale id.`);
                }
            }
        }
        // Create the import node for the locale.
        const localeIdentifier = ts.createIdentifier(`__locale_${locale.replace(/-/g, '')}__`);
        const localeImportClause = ts.createImportClause(localeIdentifier, undefined);
        const localeNewImport = ts.createImportDeclaration(undefined, undefined, localeImportClause, ts.createLiteral(`@angular/common/locales/${locale}`));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), localeNewImport));
        // Create the import node for the registerLocaleData function.
        const regIdentifier = ts.createIdentifier(`registerLocaleData`);
        const regImportSpecifier = ts.createImportSpecifier(regIdentifier, regIdentifier);
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