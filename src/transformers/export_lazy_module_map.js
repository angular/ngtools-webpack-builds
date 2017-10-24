"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const make_transform_1 = require("./make_transform");
function exportLazyModuleMap(sourceFile, lazyRoutes) {
    const ops = [];
    const dirName = path.normalize(path.dirname(sourceFile.fileName));
    const modules = Object.keys(lazyRoutes)
        .map((loadChildrenString) => {
        let [, moduleName] = loadChildrenString.split('#');
        let modulePath = lazyRoutes[loadChildrenString];
        if (modulePath.endsWith('.ngfactory.ts')) {
            modulePath = modulePath.replace('.ngfactory', '');
            moduleName = moduleName.replace('NgFactory', '');
            loadChildrenString = loadChildrenString
                .replace('.ngfactory', '')
                .replace('NgFactory', '');
        }
        return {
            modulePath,
            moduleName,
            loadChildrenString
        };
    });
    modules.forEach((module, index) => {
        const relativePath = path.relative(dirName, module.modulePath).replace(/\\/g, '/');
        // Create the new namespace import node.
        const namespaceImport = ts.createNamespaceImport(ts.createIdentifier(`__lazy_${index}__`));
        const importClause = ts.createImportClause(undefined, namespaceImport);
        const newImport = ts.createImportDeclaration(undefined, undefined, importClause, ts.createLiteral(relativePath));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), newImport));
    });
    const lazyModuleObjectLiteral = ts.createObjectLiteral(modules.map((mod, idx) => ts.createPropertyAssignment(ts.createLiteral(mod.loadChildrenString), ts.createPropertyAccess(ts.createIdentifier(`__lazy_${idx}__`), mod.moduleName))));
    const lazyModuleVariableStmt = ts.createVariableStatement([ts.createToken(ts.SyntaxKind.ExportKeyword)], [ts.createVariableDeclaration('LAZY_MODULE_MAP', undefined, lazyModuleObjectLiteral)]);
    ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getLastNode(sourceFile), undefined, lazyModuleVariableStmt));
    return ops;
}
exports.exportLazyModuleMap = exportLazyModuleMap;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/export_lazy_module_map.js.map