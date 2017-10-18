"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
const ast_helpers_1 = require("./ast_helpers");
const make_transform_1 = require("./make_transform");
function replaceResources(sourceFile) {
    const ops = [];
    // Find all object literals.
    ast_helpers_1.findAstNodes(null, sourceFile, ts.SyntaxKind.ObjectLiteralExpression, true)
        .map(node => ast_helpers_1.findAstNodes(node, sourceFile, ts.SyntaxKind.PropertyAssignment))
        .reduce((prev, curr) => curr ? prev.concat(curr) : prev, [])
        .filter((node) => {
        const key = _getContentOfKeyLiteral(node.name);
        if (!key) {
            // key is an expression, can't do anything.
            return false;
        }
        return key == 'templateUrl' || key == 'styleUrls';
    })
        .forEach((node) => {
        const key = _getContentOfKeyLiteral(node.name);
        if (key == 'templateUrl') {
            const requireCall = _createRequireCall(_getResourceRequest(node.initializer, sourceFile));
            const propAssign = ts.createPropertyAssignment('template', requireCall);
            ops.push(new make_transform_1.ReplaceNodeOperation(sourceFile, node, propAssign));
        }
        else if (key == 'styleUrls') {
            const arr = ast_helpers_1.findAstNodes(node, sourceFile, ts.SyntaxKind.ArrayLiteralExpression, false);
            if (!arr || arr.length == 0 || arr[0].elements.length == 0) {
                return;
            }
            const stylePaths = arr[0].elements.map((element) => {
                return _getResourceRequest(element, sourceFile);
            });
            const requireArray = ts.createArrayLiteral(stylePaths.map((path) => _createRequireCall(path)));
            const propAssign = ts.createPropertyAssignment('styles', requireArray);
            ops.push(new make_transform_1.ReplaceNodeOperation(sourceFile, node, propAssign));
        }
    });
    if (ops.length > 0) {
        // If we added a require call, we need to also add typings for it.
        // The typings need to be compatible with node typings, but also work by themselves.
        // interface NodeRequire {(id: string): any;}
        const nodeRequireInterface = ts.createInterfaceDeclaration([], [], 'NodeRequire', [], [], [
            ts.createCallSignature([], [
                ts.createParameter([], [], undefined, 'id', undefined, ts.createKeywordTypeNode(ts.SyntaxKind.StringKeyword))
            ], ts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
        ]);
        // declare var require: NodeRequire;
        const varRequire = ts.createVariableStatement([ts.createToken(ts.SyntaxKind.DeclareKeyword)], [ts.createVariableDeclaration('require', ts.createTypeReferenceNode('NodeRequire', []))]);
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), nodeRequireInterface));
        ops.push(new make_transform_1.AddNodeOperation(sourceFile, ast_helpers_1.getFirstNode(sourceFile), varRequire));
    }
    return ops;
}
exports.replaceResources = replaceResources;
function _getContentOfKeyLiteral(node) {
    if (!node) {
        return null;
    }
    else if (node.kind == ts.SyntaxKind.Identifier) {
        return node.text;
    }
    else if (node.kind == ts.SyntaxKind.StringLiteral) {
        return node.text;
    }
    else {
        return null;
    }
}
function _getResourceRequest(element, sourceFile) {
    if (element.kind == ts.SyntaxKind.StringLiteral) {
        const url = element.text;
        // If the URL does not start with ./ or ../, prepends ./ to it.
        return `${/^\.?\.\//.test(url) ? '' : './'}${url}`;
    }
    else {
        // if not string, just use expression directly
        return element.getFullText(sourceFile);
    }
}
function _createRequireCall(path) {
    return ts.createCall(ts.createIdentifier('require'), [], [ts.createLiteral(path)]);
}
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/replace_resources.js.map