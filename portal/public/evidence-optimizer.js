// Payment evidence optimisation in the family's browser (Gestió 3.5F, REGISTRATIONS.md §15.5).
// Large photos of receipts are downscaled and re-encoded as JPEG before upload: the longest side is
// limited, EXIF metadata (location, device) is dropped by re-encoding, and the camera orientation is
// applied. PDFs and small images are sent untouched. If anything fails or the result is not smaller,
// the original file is sent; the server still validates type and size (4 MiB) on its own.
//
// Synthetic provenance (Gestió DATA_MODE=SYNTHETIC_ONLY): synthetic test files declare themselves in
// their first KiB. Re-encoding drops every original metadata block, so when — and only when — the
// original carried that declaration, the optimised JPEG gets one fresh JPEG comment segment stating it
// again. No EXIF or other original metadata is kept; real photos never get a comment.
(function (root) {
  "use strict";

  var POLICY = Object.freeze({ maxSide: 2000, quality: 0.82, thresholdBytes: 1.5 * 1024 * 1024 });
  var SYNTHETIC_MARKER = "synthetic";
  var PROVENANCE_COMMENT = "synthetic test receipt - optimised for upload";
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

  function latin1(bytes) { var text = ""; for (var i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]); return text; }
  /** Same rule as the server: the declaration must appear in the first KiB. */
  function declaresSynthetic(file) {
    return Promise.resolve().then(function () { return file.slice(0, 1024).arrayBuffer(); }).then(function (buffer) {
      return latin1(new Uint8Array(buffer)).toLowerCase().indexOf(SYNTHETIC_MARKER) >= 0;
    }).catch(function () { return false; });
  }
  /** Inserts a JPEG COM segment right after SOI (FF D8): first KiB, no EXIF, image data untouched. */
  function withProvenanceComment(blob) {
    return blob.arrayBuffer().then(function (buffer) {
      var bytes = new Uint8Array(buffer);
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not_jpeg");
      var text = PROVENANCE_COMMENT, length = text.length + 2, segment = new Uint8Array(4 + text.length);
      segment[0] = 0xff; segment[1] = 0xfe; segment[2] = length >> 8; segment[3] = length & 0xff;
      for (var i = 0; i < text.length; i++) segment[4 + i] = text.charCodeAt(i);
      return new Blob([bytes.subarray(0, 2), segment, bytes.subarray(2)], { type: "image/jpeg" });
    });
  }

  /**
   * Resolves to the file to upload (optimised or the original). Never rejects.
   * `codec` ({decode, encode}) is injectable for tests; the browser implementation is the default.
   */
  function optimize(file, policy, codec) {
    var p = policy || POLICY, c = codec || { decode: decode, encode: encode };
    if (!shouldOptimize(file, p)) return Promise.resolve(file);
    return Promise.all([Promise.resolve().then(function () { return c.decode(file); }), declaresSynthetic(file)]).then(function (decoded) {
      var bitmap = decoded[0], synthetic = decoded[1];
      var size = targetSize(bitmap.width, bitmap.height, p);
      return c.encode(bitmap, size, p.quality).then(function (blob) {
        if (bitmap.close) bitmap.close();
        return synthetic && blob ? withProvenanceComment(blob) : blob;
      }).then(function (blob) {
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: Date.now() });
      });
    }).catch(function () { return file; });
  }

  root.ParpalloEvidence = Object.freeze({ POLICY: POLICY, shouldOptimize: shouldOptimize, targetSize: targetSize, jpegName: jpegName,
    declaresSynthetic: declaresSynthetic, withProvenanceComment: withProvenanceComment, optimize: optimize });
})(typeof window !== "undefined" ? window : globalThis);
