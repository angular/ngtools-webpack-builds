"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const ts = require("typescript");
const refactor_1 = require("./refactor");
function _getContentOfKeyLiteral(_source, node) {
    if (node.kind == ts.SyntaxKind.Identifier) {
        return node.text;
    }
    else if (node.kind == ts.SyntaxKind.StringLiteral) {
        return node.text;
    }
    else {
        return null;
    }
}
function findLazyRoutes(filePath, host, program, compilerOptions) {
    if (!compilerOptions && program) {
        compilerOptions = program.getCompilerOptions();
    }
    const fileName = refactor_1.resolve(filePath, host, compilerOptions).replace(/\\/g, '/');
    let sourceFile;
    if (program) {
        sourceFile = program.getSourceFile(fileName);
    }
    if (!sourceFile && host.fileExists(fileName)) {
        sourceFile = ts.createSourceFile(fileName, host.readFile(fileName), ts.ScriptTarget.Latest, true);
    }
    if (!sourceFile) {
        throw new Error(`Source file not found: '${fileName}'.`);
    }
    return refactor_1.findAstNodes(null, sourceFile, ts.SyntaxKind.ObjectLiteralExpression, true)
        .map((node) => {
        return refactor_1.findAstNodes(node, sourceFile, ts.SyntaxKind.PropertyAssignment, false);
    })
        .reduce((acc, props) => {
        return acc.concat(props.filter(literal => {
            return _getContentOfKeyLiteral(sourceFile, literal.name) == 'loadChildren';
        }));
    }, [])
        .filter((node) => node.initializer.kind == ts.SyntaxKind.StringLiteral)
        .map((node) => node.initializer.text)
        .map((routePath) => {
        const moduleName = routePath.split('#')[0];
        const compOptions = program ? program.getCompilerOptions() : compilerOptions;
        const resolvedModuleName = moduleName[0] == '.'
            ? {
                resolvedModule: { resolvedFileName: path_1.join(path_1.dirname(filePath), moduleName) + '.ts' }
            }
            : ts.resolveModuleName(moduleName, filePath, compOptions, host);
        if (resolvedModuleName.resolvedModule
            && resolvedModuleName.resolvedModule.resolvedFileName
            && host.fileExists(resolvedModuleName.resolvedModule.resolvedFileName)) {
            return [routePath, resolvedModuleName.resolvedModule.resolvedFileName];
        }
        else {
            return [routePath, null];
        }
    })
        .reduce((acc, [routePath, resolvedModuleName]) => {
        acc[routePath] = resolvedModuleName;
        return acc;
    }, {});
}
exports.findLazyRoutes = findLazyRoutes;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/lazy_routes.js.map