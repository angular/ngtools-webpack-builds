"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const make_transform_1 = require("./make_transform");
function exportNgFactory(sourceFile, entryModule) {
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
        if (entryModuleIdentifier.parent.kind !== ts.SyntaxKind.ExportSpecifier) {
            return;
        }
        const exportSpec = entryModuleIdentifier.parent;
        const moduleSpecifier = exportSpec.parent.parent.moduleSpecifier;
        if (moduleSpecifier.kind !== ts.SyntaxKind.StringLiteral) {
            return;
        }
        modulePath = moduleSpecifier.text;
        // Add the transform operations.
        const factoryClassName = entryModule.className + 'NgFactory';
        const factoryModulePath = modulePath + '.ngfactory';
        const namedExports = ts.createNamedExports([ts.createExportSpecifier(undefined, ts.createIdentifier(factoryClassName))]);
        const newImport = ts.createExportDeclaration(undefined, undefined, namedExports, ts.createLiteral(factoryModulePath));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), newImport));
    });
    return ops;
}
exports.exportNgFactory = exportNgFactory;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/export_ngfactory.js.map