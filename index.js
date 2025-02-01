"use strict";

/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

Object.defineProperty(exports, "__esModule", { value: true });

// Utility function to create bindings
const createBinding = (o, m, k, k2 = k) => {
    const desc = Object.getOwnPropertyDescriptor(m, k);
    Object.defineProperty(o, k2, desc && ("get" in desc ? !m.__esModule : desc.writable || desc.configurable) 
        ? desc 
        : { enumerable: true, get: () => m[k] });
};

// Function to export all properties from a module
const exportStar = (m, exports) => {
    for (const p in m) {
        if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) {
            createBinding(exports, m, p);
        }
    }
};

// Export all from the specified module
exportStar(require("./src/index"), exports);
