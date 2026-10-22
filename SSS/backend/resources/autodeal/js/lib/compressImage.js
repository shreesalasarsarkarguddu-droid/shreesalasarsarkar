/**
 * Client-side image compression before upload.
 * A 12 MP phone photo (~4–6 MB) becomes ~150–350 KB at 1600px / q0.72,
 * which keeps uploads fast on mobile data and saves hosting disk/bandwidth.
 * Non-images (PDF) and already-small files pass through untouched.
 */
export async function compressImage(file, opts) {
    try {
        return await compress(file, opts);
    } catch {
        // Undecodable in this browser (e.g. HEIC on desktop Chrome): send the original
        // and let server-side validation give a clear message if the format is unsupported.
        return file;
    }
}

async function compress(file, { maxSize = 1600, quality = 0.72, skipBelowKB = 250 } = {}) {
    if (!file || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
    if (file.size / 1024 < skipBelowKB) return file;

    let bitmap;
    try {
        // imageOrientation honours EXIF rotation so portrait shots stay upright.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        bitmap = await loadViaImg(file);
    }

    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
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
