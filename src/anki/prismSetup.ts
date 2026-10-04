/**
 * Load Prism core and expose it on `window` before any language components run.
 * Component scripts are UMD-style `(function (Prism) { ... })(Prism)` and expect
 * a free `Prism` binding.
 */
import Prism from 'prismjs';

const prismWindow = window as Window & { Prism?: typeof Prism };
prismWindow.Prism = Prism;

export { Prism };
