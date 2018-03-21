"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ignoreDep typescript
const path = require("path");
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
// TODO: replace this with collectDeepNodes and add limits to collectDeepNodes
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
function resolve(filePath, _host, compilerOptions) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    const basePath = compilerOptions.baseUrl || compilerOptions.rootDir;
    if (!basePath) {
        throw new Error(`Trying to resolve '${filePath}' without a basePath.`);
    }
    return path.join(basePath, filePath);
}
exports.resolve = resolve;
class TypeScriptFileRefactor {
    get fileName() { return this._fileName; }
    get sourceFile() { return this._sourceFile; }
    constructor(fileName, _host, _program, source) {
        fileName = resolve(fileName, _host, _program.getCompilerOptions()).replace(/\\/g, '/');
        this._fileName = fileName;
        if (_program) {
            if (source) {
                this._sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
            }
            else {
                this._sourceFile = _program.getSourceFile(fileName);
            }
        }
        if (!this._sourceFile) {
            this._sourceFile = ts.createSourceFile(fileName, source || _host.readFile(fileName), ts.ScriptTarget.Latest, true);
        }
    }
    /**
     * Find all nodes from the AST in the subtree of node of SyntaxKind kind.
     * @param node The root node to check, or null if the whole tree should be searched.
     * @param kind The kind of nodes to find.
     * @param recursive Whether to go in matched nodes to keep matching.
     * @param max The maximum number of items to return.
     * @return all nodes of kind, or [] if none is found
     */
    findAstNodes(node, kind, recursive = false, max = Infinity) {
        return findAstNodes(node, this._sourceFile, kind, recursive, max);
    }
}
exports.TypeScriptFileRefactor = TypeScriptFileRefactor;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/refactor.js.map