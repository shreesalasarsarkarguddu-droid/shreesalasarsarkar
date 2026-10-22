/**
 * Client-side image shrinking before upload: every image ends up at most `targetKB` (200 KB, the server's limit).
 * JPEG quality goes down first, then the picture gets smaller, until it fits. A 12 MP phone photo (~4–6 MB) usually
 * fits at 1600px / q0.7 (~150 KB). PDFs and images that already fit pass through untouched.
 * If the browser cannot read the image (e.g. HEIC on desktop Chrome) the original is sent and the server shrinks it.
 */
export async function compressImage(file, opts) {
    try {
        return await compress(file, opts);
    } catch {
        return file;
    }
}

const QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.42];

async function compress(file, { maxSize = 1600, targetKB = 200 } = {}) {
    if (!file || !file.type.startsWith('image/')) return file;
    const limit = targetKB * 1024;
    if (file.size <= limit && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;

    let bitmap;
    try {
        // imageOrientation honours EXIF rotation so portrait shots stay upright.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        bitmap = await loadViaImg(file);
    }

    let side = Math.min(maxSize, Math.max(bitmap.width, bitmap.height));
    let best = null;
    try {
        while (side >= 320) {
            const scale = side / Math.max(bitmap.width, bitmap.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff'; // transparent PNG parts become white, not black
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            for (const q of QUALITIES) {
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
                if (!blob) return file;
                best = blob;
                if (blob.size <= limit) return asFile(file, blob);
            }
            side = Math.floor(side * 0.8);
        }
    } finally {
        bitmap.close?.();
    }
    // Could not reach the limit (very unusual): send the smallest try; the server shrinks it further or says why.
    return best ? asFile(file, best) : file;
}

function asFile(original, blob) {
    const name = original.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}

function loadViaImg(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = reject;
        img.src = url;
    });
}
