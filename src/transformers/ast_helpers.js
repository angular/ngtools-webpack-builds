"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
/**
 * Find all nodes from the AST in the subtree of node of SyntaxKind kind.
 * @param node The root node to check, or null if the whole tree should be searched.
 * @param sourceFile The source file where the node is.
 * @param kind The kind of nodes to find.
 * @param recursive Whether to go in matched nodes to keep matching.
 * @param max The maximum number of items to return.
 * @return all nodes of kind, or [] if none is found
 */
function findAstNodes(node, sourceFile, kind, recursive = false, max = Infinity) {
    // TODO: refactor operations that only need `refactor.findAstNodes()` to use this instead.
    if (max == 0) {
        return [];
    }
    if (!node) {
        node = sourceFile;
    }
    let arr = [];
    if (node.kind === kind) {
        // If we're not recursively looking for children, stop here.
        if (!recursive) {
            return [node];
        }
        arr.push(node);
        max--;
    }
    if (max > 0) {
        for (const child of node.getChildren(sourceFile)) {
            findAstNodes(child, sourceFile, kind, recursive, max)
                .forEach((node) => {
                if (max > 0) {
                    arr.push(node);
                }
                max--;
            });
            if (max <= 0) {
                break;
            }
        }
    }
    return arr;
}
exports.findAstNodes = findAstNodes;
function getFirstNode(sourceFile) {
    const syntaxList = findAstNodes(null, sourceFile, ts.SyntaxKind.SyntaxList, false, 1)[0] || null;
    if (syntaxList) {
        return (syntaxList && syntaxList.getChildCount() > 0) ? syntaxList.getChildAt(0) : null;
    }
    return null;
}
exports.getFirstNode = getFirstNode;
function getLastNode(sourceFile) {
    const syntaxList = findAstNodes(null, sourceFile, ts.SyntaxKind.SyntaxList, false, 1)[0] || null;
    if (syntaxList) {
        const childCount = syntaxList.getChildCount();
        return childCount > 0 ? syntaxList.getChildAt(childCount - 1) : null;
    }
    return null;
}
exports.getLastNode = getLastNode;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/ast_helpers.js.map