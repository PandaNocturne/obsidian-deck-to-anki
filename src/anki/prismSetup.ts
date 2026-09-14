/**
 * Load Prism core and expose it as a global before any language components run.
 * Component scripts are UMD-style `(function (Prism) { ... })(Prism)` and expect
 * a free `Prism` binding (typically `globalThis.Prism`).
 */
import Prism from 'prismjs';

const prismGlobal = globalThis as typeof globalThis & { Prism?: typeof Prism };
prismGlobal.Prism = Prism;

export { Prism };
