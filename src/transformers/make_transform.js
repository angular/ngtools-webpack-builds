"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ts = require("typescript");
var OPERATION_KIND;
(function (OPERATION_KIND) {
    OPERATION_KIND[OPERATION_KIND["Remove"] = 0] = "Remove";
    OPERATION_KIND[OPERATION_KIND["Add"] = 1] = "Add";
    OPERATION_KIND[OPERATION_KIND["Replace"] = 2] = "Replace";
})(OPERATION_KIND = exports.OPERATION_KIND || (exports.OPERATION_KIND = {}));
class TransformOperation {
    constructor(kind, sourceFile, target) {
        this.kind = kind;
        this.sourceFile = sourceFile;
        this.target = target;
    }
}
exports.TransformOperation = TransformOperation;
class RemoveNodeOperation extends TransformOperation {
    constructor(sourceFile, target) {
        super(OPERATION_KIND.Remove, sourceFile, target);
    }
}
exports.RemoveNodeOperation = RemoveNodeOperation;
class AddNodeOperation extends TransformOperation {
    constructor(sourceFile, target, before, after) {
        super(OPERATION_KIND.Add, sourceFile, target);
        this.before = before;
        this.after = after;
    }
}
exports.AddNodeOperation = AddNodeOperation;
class ReplaceNodeOperation extends TransformOperation {
    constructor(sourceFile, target, replacement) {
        super(OPERATION_KIND.Replace, sourceFile, target);
        this.replacement = replacement;
    }
}
exports.ReplaceNodeOperation = ReplaceNodeOperation;
// TODO: add symbol workaround for https://github.com/Microsoft/TypeScript/issues/17551 and
// https://github.com/Microsoft/TypeScript/issues/17384
function makeTransform(ops) {
    const sourceFiles = ops.reduce((prev, curr) => prev.includes(curr.sourceFile) ? prev : prev.concat(curr.sourceFile), []);
    const removeOps = ops.filter((op) => op.kind === OPERATION_KIND.Remove);
    const addOps = ops.filter((op) => op.kind === OPERATION_KIND.Add);
    const replaceOps = ops
        .filter((op) => op.kind === OPERATION_KIND.Replace);
    return (context) => {
        const transformer = (sf) => {
            const visitor = (node) => {
                let modified = false;
                let modifiedNodes = [node];
                // Check if node should be dropped.
                if (removeOps.find((op) => op.target === node)) {
                    modifiedNodes = [];
                    modified = true;
                }
                // Check if node should be replaced (only replaces with first op found).
                const replace = replaceOps.find((op) => op.target === node);
                if (replace) {
                    modifiedNodes = [replace.replacement];
                    modified = true;
                }
                // Check if node should be added to.
                const add = addOps.filter((op) => op.target === node);
                if (add.length > 0) {
                    modifiedNodes = [
                        ...add.filter((op) => op.before).map(((op) => op.before)),
                        ...modifiedNodes,
                        ...add.filter((op) => op.after).map(((op) => op.after))
                    ];
                    modified = true;
                }
                // If we changed anything, return modified nodes without visiting further.
                if (modified) {
                    return modifiedNodes;
                }
                else {
                    // Otherwise return node as is and visit children.
                    return ts.visitEachChild(node, visitor, context);
                }
            };
            // Only visit source files we have ops for.
            return sourceFiles.includes(sf) ? ts.visitNode(sf, visitor) : sf;
        };
        return transformer;
    };
}
exports.makeTransform = makeTransform;
//# sourceMappingURL=/home/travis/build/angular/angular-cli/src/transformers/make_transform.js.map