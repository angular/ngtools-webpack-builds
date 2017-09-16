import * as ts from 'typescript';
import { LazyRouteMap } from '../lazy_routes';
import { TransformOperation } from './make_transform';
export declare function exportLazyModuleMap(sourceFile: ts.SourceFile, lazyRoutes: LazyRouteMap): TransformOperation[];
