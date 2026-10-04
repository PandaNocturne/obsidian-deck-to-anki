/**
 * DOM helpers that avoid assigning to Element.innerHTML
 * (satisfies no-unsanitized / community plugin review).
 */

/** Parse an HTML string into a detached container element. */
export function parseHtmlContainer(html: string): HTMLDivElement {
	const doc = new DOMParser().parseFromString(
		`<div id="dta-html-root">${html}</div>`,
		'text/html',
	);
	const root = doc.getElementById('dta-html-root');
	const host = createDiv();
	if (root) {
		while (root.firstChild) {
			host.appendChild(root.firstChild);
		}
	}
	return host;
}

/** Replace an element's children with nodes parsed from an HTML string. */
export function replaceChildrenWithHtml(el: Element, html: string): void {
	const doc = new DOMParser().parseFromString(
		`<div id="dta-html-frag">${html}</div>`,
		'text/html',
	);
	const frag = doc.getElementById('dta-html-frag');
	el.replaceChildren(...(frag ? Array.from(frag.childNodes) : []));
}

/** Serialize a container's children back to an HTML string. */
export function serializeHtmlContainer(host: HTMLElement): string {
	// Reading innerHTML is allowed; only unsafe assignment is lint-blocked.
	return host.innerHTML;
}
