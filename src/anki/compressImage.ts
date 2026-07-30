/** Raster formats we re-encode for Anki upload (never writes vault files). */
const COMPRESSIBLE_EXT = new Set([
	'png',
	'jpg',
	'jpeg',
	'webp',
	'bmp',
]);

export function isCompressibleImageExt(ext: string): boolean {
	return COMPRESSIBLE_EXT.has(ext.toLowerCase());
}

function mimeForExt(ext: string): string {
	switch (ext.toLowerCase()) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'webp':
			return 'image/webp';
		case 'bmp':
			return 'image/bmp';
		default:
			return 'application/octet-stream';
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunk = 0x8000;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Re-encode a raster image to JPEG for AnkiConnect upload only.
 * Returns null if the format is skipped or encoding fails (caller keeps original).
 */
export async function compressImageForAnki(
	data: ArrayBuffer,
	sourceExt: string,
	qualityPercent: number,
): Promise<{ data: ArrayBuffer; ext: string; dataBase64: string } | null> {
	const ext = sourceExt.toLowerCase();
	if (!isCompressibleImageExt(ext)) {
		return null;
	}

	const q = Math.min(100, Math.max(1, Math.round(qualityPercent))) / 100;
	const blob = new Blob([data], { type: mimeForExt(ext) });
	const url = URL.createObjectURL(blob);

	try {
		const img = await loadImage(url);
		const w = img.naturalWidth || img.width;
		const h = img.naturalHeight || img.height;
		if (w < 1 || h < 1) {
			return null;
		}

		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return null;
		}
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, w, h);
		ctx.drawImage(img, 0, 0);

		const outBlob = await canvasToJpegBlob(canvas, q);
		if (!outBlob || outBlob.size < 1) {
			return null;
		}

		const out = await outBlob.arrayBuffer();
		return {
			data: out,
			ext: 'jpg',
			dataBase64: arrayBufferToBase64(out),
		};
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image decode failed'));
		img.src = url;
	});
}

function canvasToJpegBlob(
	canvas: HTMLCanvasElement,
	quality: number,
): Promise<Blob | null> {
	return new Promise((resolve) => {
		canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
	});
}
