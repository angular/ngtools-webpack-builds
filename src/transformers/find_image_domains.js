"use strict";
/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findImageDomains = void 0;
const ts = __importStar(require("typescript"));
const TARGET_TEXT = '@NgModule';
const BUILTIN_LOADERS = new Set([
    'provideCloudflareLoader',
    'provideCloudinaryLoader',
    'provideImageKitLoader',
    'provideImgixLoader',
]);
const URL_REGEX = /(https?:\/\/[^/]*)\//g;
function findImageDomains(imageDomains) {
    return (context) => {
        return (sourceFile) => {
            const isBuiltinImageLoader = (node) => {
                return BUILTIN_LOADERS.has(node.expression.getText());
            };
            const findDomainString = (node) => {
                if (ts.isStringLiteral(node) ||
                    ts.isTemplateHead(node) ||
                    ts.isTemplateMiddle(node) ||
                    ts.isTemplateTail(node)) {
                    const domain = node.text.match(URL_REGEX);
                    if (domain && domain[0]) {
                        imageDomains.add(domain[0]);
                        return node;
                    }
                }
                ts.visitEachChild(node, findDomainString, context);
                return node;
            };
            function isImageProviderKey(property) {
                return (ts.isPropertyAssignment(property) &&
                    property.name.getText() === 'provide' &&
                    property.initializer.getText() === 'IMAGE_LOADER');
            }
            function isImageProviderValue(property) {
                return ts.isPropertyAssignment(property) && property.name.getText() === 'useValue';
            }
            function checkForDomain(node) {
                if (node.properties.find(isImageProviderKey)) {
                    const value = node.properties.find(isImageProviderValue);
                    if (value && ts.isPropertyAssignment(value)) {
                        if (ts.isArrowFunction(value.initializer) ||
                            ts.isFunctionExpression(value.initializer)) {
                            ts.visitEachChild(node, findDomainString, context);
                        }
                    }
                }
            }
            function findImageLoaders(node) {
                if (ts.isCallExpression(node)) {
                    if (isBuiltinImageLoader(node)) {
                        const firstArg = node.arguments[0];
                        if (ts.isStringLiteralLike(firstArg)) {
                            imageDomains.add(firstArg.text);
                        }
                    }
                }
                else if (ts.isObjectLiteralExpression(node)) {
                    checkForDomain(node);
                }
                return node;
            }
            function findPropertyAssignment(node) {
                if (ts.isPropertyAssignment(node)) {
                    if (ts.isIdentifier(node.name) && node.name.escapedText === 'providers') {
                        ts.visitEachChild(node.initializer, findImageLoaders, context);
                    }
                }
                return node;
            }
            function findPropertyDeclaration(node) {
                if (ts.isPropertyDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.name.escapedText === 'ɵinj' &&
                    node.initializer &&
                    ts.isCallExpression(node.initializer) &&
                    node.initializer.arguments[0]) {
                    ts.visitEachChild(node.initializer.arguments[0], findPropertyAssignment, context);
                }
                return node;
            }
            // Continue traversal if node is ClassDeclaration and has name "AppModule"
            function findClassDeclaration(node) {
                if (ts.isClassDeclaration(node)) {
                    ts.visitEachChild(node, findPropertyDeclaration, context);
                }
                return node;
            }
            ts.visitEachChild(sourceFile, findClassDeclaration, context);
            return sourceFile;
        };
    };
}
exports.findImageDomains = findImageDomains;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmluZF9pbWFnZV9kb21haW5zLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vLi4vLi4vLi4vcGFja2FnZXMvbmd0b29scy93ZWJwYWNrL3NyYy90cmFuc2Zvcm1lcnMvZmluZF9pbWFnZV9kb21haW5zLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQTs7Ozs7O0dBTUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBRUgsK0NBQWlDO0FBRWpDLE1BQU0sV0FBVyxHQUFHLFdBQVcsQ0FBQztBQUNoQyxNQUFNLGVBQWUsR0FBRyxJQUFJLEdBQUcsQ0FBQztJQUM5Qix5QkFBeUI7SUFDekIseUJBQXlCO0lBQ3pCLHVCQUF1QjtJQUN2QixvQkFBb0I7Q0FDckIsQ0FBQyxDQUFDO0FBQ0gsTUFBTSxTQUFTLEdBQUcsdUJBQXVCLENBQUM7QUFFMUMsU0FBZ0IsZ0JBQWdCLENBQUMsWUFBeUI7SUFDeEQsT0FBTyxDQUFDLE9BQWlDLEVBQUUsRUFBRTtRQUMzQyxPQUFPLENBQUMsVUFBeUIsRUFBRSxFQUFFO1lBQ25DLE1BQU0sb0JBQW9CLEdBQUcsQ0FBQyxJQUF1QixFQUFXLEVBQUU7Z0JBQ2hFLE9BQU8sZUFBZSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDeEQsQ0FBQyxDQUFDO1lBRUYsTUFBTSxnQkFBZ0IsR0FBRyxDQUFDLElBQWEsRUFBRSxFQUFFO2dCQUN6QyxJQUNFLEVBQUUsQ0FBQyxlQUFlLENBQUMsSUFBSSxDQUFDO29CQUN4QixFQUFFLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQztvQkFDdkIsRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQztvQkFDekIsRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsRUFDdkI7b0JBQ0EsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7b0JBQzFDLElBQUksTUFBTSxJQUFJLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRTt3QkFDdkIsWUFBWSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFFNUIsT0FBTyxJQUFJLENBQUM7cUJBQ2I7aUJBQ0Y7Z0JBQ0QsRUFBRSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBRW5ELE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQyxDQUFDO1lBRUYsU0FBUyxrQkFBa0IsQ0FBQyxRQUFxQztnQkFDL0QsT0FBTyxDQUNMLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxRQUFRLENBQUM7b0JBQ2pDLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEtBQUssU0FBUztvQkFDckMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsS0FBSyxjQUFjLENBQ2xELENBQUM7WUFDSixDQUFDO1lBRUQsU0FBUyxvQkFBb0IsQ0FBQyxRQUFxQztnQkFDakUsT0FBTyxFQUFFLENBQUMsb0JBQW9CLENBQUMsUUFBUSxDQUFDLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxVQUFVLENBQUM7WUFDckYsQ0FBQztZQUVELFNBQVMsY0FBYyxDQUFDLElBQWdDO2dCQUN0RCxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEVBQUU7b0JBQzVDLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUM7b0JBQ3pELElBQUksS0FBSyxJQUFJLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsRUFBRTt3QkFDM0MsSUFDRSxFQUFFLENBQUMsZUFBZSxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUM7NEJBQ3JDLEVBQUUsQ0FBQyxvQkFBb0IsQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLEVBQzFDOzRCQUNBLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFLE9BQU8sQ0FBQyxDQUFDO3lCQUNwRDtxQkFDRjtpQkFDRjtZQUNILENBQUM7WUFFRCxTQUFTLGdCQUFnQixDQUFDLElBQWE7Z0JBQ3JDLElBQUksRUFBRSxDQUFDLGdCQUFnQixDQUFDLElBQUksQ0FBQyxFQUFFO29CQUM3QixJQUFJLG9CQUFvQixDQUFDLElBQUksQ0FBQyxFQUFFO3dCQUM5QixNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUNuQyxJQUFJLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsRUFBRTs0QkFDcEMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7eUJBQ2pDO3FCQUNGO2lCQUNGO3FCQUFNLElBQUksRUFBRSxDQUFDLHlCQUF5QixDQUFDLElBQUksQ0FBQyxFQUFFO29CQUM3QyxjQUFjLENBQUMsSUFBSSxDQUFDLENBQUM7aUJBQ3RCO2dCQUVELE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztZQUVELFNBQVMsc0JBQXNCLENBQUMsSUFBYTtnQkFDM0MsSUFBSSxFQUFFLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLEVBQUU7b0JBQ2pDLElBQUksRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLEtBQUssV0FBVyxFQUFFO3dCQUN2RSxFQUFFLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLENBQUM7cUJBQ2hFO2lCQUNGO2dCQUVELE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztZQUVELFNBQVMsdUJBQXVCLENBQUMsSUFBYTtnQkFDNUMsSUFDRSxFQUFFLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDO29CQUM5QixFQUFFLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7b0JBQzFCLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxLQUFLLE1BQU07b0JBQ2hDLElBQUksQ0FBQyxXQUFXO29CQUNoQixFQUFFLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztvQkFDckMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQzdCO29CQUNBLEVBQUUsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUUsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLENBQUM7aUJBQ25GO2dCQUVELE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztZQUVELDBFQUEwRTtZQUMxRSxTQUFTLG9CQUFvQixDQUFDLElBQWE7Z0JBQ3pDLElBQUksRUFBRSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxFQUFFO29CQUMvQixFQUFFLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRSxPQUFPLENBQUMsQ0FBQztpQkFDM0Q7Z0JBRUQsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQsRUFBRSxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsb0JBQW9CLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFN0QsT0FBTyxVQUFVLENBQUM7UUFDcEIsQ0FBQyxDQUFDO0lBQ0osQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQTFHRCw0Q0EwR0MiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEBsaWNlbnNlXG4gKiBDb3B5cmlnaHQgR29vZ2xlIExMQyBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGFuIE1JVC1zdHlsZSBsaWNlbnNlIHRoYXQgY2FuIGJlXG4gKiBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGF0IGh0dHBzOi8vYW5ndWxhci5pby9saWNlbnNlXG4gKi9cblxuaW1wb3J0ICogYXMgdHMgZnJvbSAndHlwZXNjcmlwdCc7XG5cbmNvbnN0IFRBUkdFVF9URVhUID0gJ0BOZ01vZHVsZSc7XG5jb25zdCBCVUlMVElOX0xPQURFUlMgPSBuZXcgU2V0KFtcbiAgJ3Byb3ZpZGVDbG91ZGZsYXJlTG9hZGVyJyxcbiAgJ3Byb3ZpZGVDbG91ZGluYXJ5TG9hZGVyJyxcbiAgJ3Byb3ZpZGVJbWFnZUtpdExvYWRlcicsXG4gICdwcm92aWRlSW1naXhMb2FkZXInLFxuXSk7XG5jb25zdCBVUkxfUkVHRVggPSAvKGh0dHBzPzpcXC9cXC9bXi9dKilcXC8vZztcblxuZXhwb3J0IGZ1bmN0aW9uIGZpbmRJbWFnZURvbWFpbnMoaW1hZ2VEb21haW5zOiBTZXQ8c3RyaW5nPik6IHRzLlRyYW5zZm9ybWVyRmFjdG9yeTx0cy5Tb3VyY2VGaWxlPiB7XG4gIHJldHVybiAoY29udGV4dDogdHMuVHJhbnNmb3JtYXRpb25Db250ZXh0KSA9PiB7XG4gICAgcmV0dXJuIChzb3VyY2VGaWxlOiB0cy5Tb3VyY2VGaWxlKSA9PiB7XG4gICAgICBjb25zdCBpc0J1aWx0aW5JbWFnZUxvYWRlciA9IChub2RlOiB0cy5DYWxsRXhwcmVzc2lvbik6IEJvb2xlYW4gPT4ge1xuICAgICAgICByZXR1cm4gQlVJTFRJTl9MT0FERVJTLmhhcyhub2RlLmV4cHJlc3Npb24uZ2V0VGV4dCgpKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGZpbmREb21haW5TdHJpbmcgPSAobm9kZTogdHMuTm9kZSkgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdHMuaXNTdHJpbmdMaXRlcmFsKG5vZGUpIHx8XG4gICAgICAgICAgdHMuaXNUZW1wbGF0ZUhlYWQobm9kZSkgfHxcbiAgICAgICAgICB0cy5pc1RlbXBsYXRlTWlkZGxlKG5vZGUpIHx8XG4gICAgICAgICAgdHMuaXNUZW1wbGF0ZVRhaWwobm9kZSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY29uc3QgZG9tYWluID0gbm9kZS50ZXh0Lm1hdGNoKFVSTF9SRUdFWCk7XG4gICAgICAgICAgaWYgKGRvbWFpbiAmJiBkb21haW5bMF0pIHtcbiAgICAgICAgICAgIGltYWdlRG9tYWlucy5hZGQoZG9tYWluWzBdKTtcblxuICAgICAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIGZpbmREb21haW5TdHJpbmcsIGNvbnRleHQpO1xuXG4gICAgICAgIHJldHVybiBub2RlO1xuICAgICAgfTtcblxuICAgICAgZnVuY3Rpb24gaXNJbWFnZVByb3ZpZGVyS2V5KHByb3BlcnR5OiB0cy5PYmplY3RMaXRlcmFsRWxlbWVudExpa2UpOiBib29sZWFuIHtcbiAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICB0cy5pc1Byb3BlcnR5QXNzaWdubWVudChwcm9wZXJ0eSkgJiZcbiAgICAgICAgICBwcm9wZXJ0eS5uYW1lLmdldFRleHQoKSA9PT0gJ3Byb3ZpZGUnICYmXG4gICAgICAgICAgcHJvcGVydHkuaW5pdGlhbGl6ZXIuZ2V0VGV4dCgpID09PSAnSU1BR0VfTE9BREVSJ1xuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBpc0ltYWdlUHJvdmlkZXJWYWx1ZShwcm9wZXJ0eTogdHMuT2JqZWN0TGl0ZXJhbEVsZW1lbnRMaWtlKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiB0cy5pc1Byb3BlcnR5QXNzaWdubWVudChwcm9wZXJ0eSkgJiYgcHJvcGVydHkubmFtZS5nZXRUZXh0KCkgPT09ICd1c2VWYWx1ZSc7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGNoZWNrRm9yRG9tYWluKG5vZGU6IHRzLk9iamVjdExpdGVyYWxFeHByZXNzaW9uKSB7XG4gICAgICAgIGlmIChub2RlLnByb3BlcnRpZXMuZmluZChpc0ltYWdlUHJvdmlkZXJLZXkpKSB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBub2RlLnByb3BlcnRpZXMuZmluZChpc0ltYWdlUHJvdmlkZXJWYWx1ZSk7XG4gICAgICAgICAgaWYgKHZhbHVlICYmIHRzLmlzUHJvcGVydHlBc3NpZ25tZW50KHZhbHVlKSkge1xuICAgICAgICAgICAgaWYgKFxuICAgICAgICAgICAgICB0cy5pc0Fycm93RnVuY3Rpb24odmFsdWUuaW5pdGlhbGl6ZXIpIHx8XG4gICAgICAgICAgICAgIHRzLmlzRnVuY3Rpb25FeHByZXNzaW9uKHZhbHVlLmluaXRpYWxpemVyKVxuICAgICAgICAgICAgKSB7XG4gICAgICAgICAgICAgIHRzLnZpc2l0RWFjaENoaWxkKG5vZGUsIGZpbmREb21haW5TdHJpbmcsIGNvbnRleHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBmdW5jdGlvbiBmaW5kSW1hZ2VMb2FkZXJzKG5vZGU6IHRzLk5vZGUpIHtcbiAgICAgICAgaWYgKHRzLmlzQ2FsbEV4cHJlc3Npb24obm9kZSkpIHtcbiAgICAgICAgICBpZiAoaXNCdWlsdGluSW1hZ2VMb2FkZXIobm9kZSkpIHtcbiAgICAgICAgICAgIGNvbnN0IGZpcnN0QXJnID0gbm9kZS5hcmd1bWVudHNbMF07XG4gICAgICAgICAgICBpZiAodHMuaXNTdHJpbmdMaXRlcmFsTGlrZShmaXJzdEFyZykpIHtcbiAgICAgICAgICAgICAgaW1hZ2VEb21haW5zLmFkZChmaXJzdEFyZy50ZXh0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodHMuaXNPYmplY3RMaXRlcmFsRXhwcmVzc2lvbihub2RlKSkge1xuICAgICAgICAgIGNoZWNrRm9yRG9tYWluKG5vZGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRQcm9wZXJ0eUFzc2lnbm1lbnQobm9kZTogdHMuTm9kZSkge1xuICAgICAgICBpZiAodHMuaXNQcm9wZXJ0eUFzc2lnbm1lbnQobm9kZSkpIHtcbiAgICAgICAgICBpZiAodHMuaXNJZGVudGlmaWVyKG5vZGUubmFtZSkgJiYgbm9kZS5uYW1lLmVzY2FwZWRUZXh0ID09PSAncHJvdmlkZXJzJykge1xuICAgICAgICAgICAgdHMudmlzaXRFYWNoQ2hpbGQobm9kZS5pbml0aWFsaXplciwgZmluZEltYWdlTG9hZGVycywgY29udGV4dCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIGZ1bmN0aW9uIGZpbmRQcm9wZXJ0eURlY2xhcmF0aW9uKG5vZGU6IHRzLk5vZGUpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHRzLmlzUHJvcGVydHlEZWNsYXJhdGlvbihub2RlKSAmJlxuICAgICAgICAgIHRzLmlzSWRlbnRpZmllcihub2RlLm5hbWUpICYmXG4gICAgICAgICAgbm9kZS5uYW1lLmVzY2FwZWRUZXh0ID09PSAnybVpbmonICYmXG4gICAgICAgICAgbm9kZS5pbml0aWFsaXplciAmJlxuICAgICAgICAgIHRzLmlzQ2FsbEV4cHJlc3Npb24obm9kZS5pbml0aWFsaXplcikgJiZcbiAgICAgICAgICBub2RlLmluaXRpYWxpemVyLmFyZ3VtZW50c1swXVxuICAgICAgICApIHtcbiAgICAgICAgICB0cy52aXNpdEVhY2hDaGlsZChub2RlLmluaXRpYWxpemVyLmFyZ3VtZW50c1swXSwgZmluZFByb3BlcnR5QXNzaWdubWVudCwgY29udGV4dCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbm9kZTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29udGludWUgdHJhdmVyc2FsIGlmIG5vZGUgaXMgQ2xhc3NEZWNsYXJhdGlvbiBhbmQgaGFzIG5hbWUgXCJBcHBNb2R1bGVcIlxuICAgICAgZnVuY3Rpb24gZmluZENsYXNzRGVjbGFyYXRpb24obm9kZTogdHMuTm9kZSkge1xuICAgICAgICBpZiAodHMuaXNDbGFzc0RlY2xhcmF0aW9uKG5vZGUpKSB7XG4gICAgICAgICAgdHMudmlzaXRFYWNoQ2hpbGQobm9kZSwgZmluZFByb3BlcnR5RGVjbGFyYXRpb24sIGNvbnRleHQpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5vZGU7XG4gICAgICB9XG5cbiAgICAgIHRzLnZpc2l0RWFjaENoaWxkKHNvdXJjZUZpbGUsIGZpbmRDbGFzc0RlY2xhcmF0aW9uLCBjb250ZXh0KTtcblxuICAgICAgcmV0dXJuIHNvdXJjZUZpbGU7XG4gICAgfTtcbiAgfTtcbn1cbiJdfQ==