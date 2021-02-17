/// <reference types="node" />
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as ts from 'typescript';
import { InputFileSystem } from 'webpack';
export interface InputFileSystemSync extends InputFileSystem {
    readFileSync(path: string): Buffer;
    statSync(path: string): {
        size: number;
        mtime: Date;
        isDirectory(): boolean;
        isFile(): boolean;
    };
}
export declare function createWebpackSystem(input: InputFileSystemSync, currentDirectory: string): ts.System;
