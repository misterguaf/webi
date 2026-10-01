// Payment evidence optimisation in the family's browser (Gestió 3.5F, REGISTRATIONS.md §15.5).
// Large photos of receipts are downscaled and re-encoded as JPEG before upload: the longest side is
// limited, EXIF metadata (location, device) is dropped by re-encoding, and the camera orientation is
// applied. PDFs and small images are sent untouched. If anything fails or the result is not smaller,
// the original file is sent; the server still validates type and size (4 MiB) on its own.
(function (root) {
  "use strict";

  var POLICY = Object.freeze({ maxSide: 2000, quality: 0.82, thresholdBytes: 1.5 * 1024 * 1024 });
  var IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function shouldOptimize(file, policy) {
    var p = policy || POLICY;
    return !!file && IMAGE_TYPES.indexOf(file.type) >= 0 && file.size >= p.thresholdBytes;
  }
  function targetSize(width, height, policy) {
    var p = policy || POLICY, longest = Math.max(width, height);
    if (!(width > 0 && height > 0) || longest <= p.maxSide) return { width: width, height: height };
    var scale = p.maxSide / longest;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function jpegName(name) {
    var base = String(name || "comprovant").replace(/\.[^./\\]*$/, "") || "comprovant";
    return base.slice(0, 110) + ".jpg";
  }

  function decode(file) {
    // imageOrientation "from-image" applies the EXIF orientation while decoding.
    if (typeof createImageBitmap === "function") return createImageBitmap(file, { imageOrientation: "from-image" });
    return Promise.reject(new Error("decode_unavailable"));
  }
  function encode(bitmap, size, quality) {
    if (typeof OffscreenCanvas === "function") {
      var off = new OffscreenCanvas(size.width, size.height), offCtx = off.getContext("2d");
      offCtx.fillStyle = "#fff"; offCtx.fillRect(0, 0, size.width, size.height);
      offCtx.drawImage(bitmap, 0, 0, size.width, size.height);
      return off.convertToBlob({ type: "image/jpeg", quality: quality });
    }
    var canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    // White background: transparent PNG areas would otherwise turn black in JPEG.
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error("encode_failed")); }, "image/jpeg", quality);
    });
  }

  /** Resolves to the file to upload (optimised or the original). Never rejects. */
  function optimize(file, policy) {
    var p = policy || POLICY;
    if (!shouldOptimize(file, p)) return Promise.resolve(file);
    return decode(file).then(function (bitmap) {
      var size = targetSize(bitmap.width, bitmap.height, p);
      return encode(bitmap, size, p.quality).then(function (blob) {
        if (bitmap.close) bitmap.close();
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
      });
    }).catch(function () { return file; });
  }

  root.ParpalloEvidence = Object.freeze({ POLICY: POLICY, shouldOptimize: shouldOptimize, targetSize: targetSize, jpegName: jpegName, optimize: optimize });
})(typeof window !== "undefined" ? window : globalThis);
