// @ts-check

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
    this.code = "BODY_TOO_LARGE";
  }
}

/**
 * Llig un cos WHATWG amb un límit real en bytes. Content-Length és una guarda
 * ràpida, però el comptador del stream és l'autoritat perquè la capçalera pot
 * faltar o ser falsa.
 *
 * @param {Request} request
 * @param {number} maxBytes
 */
export async function readRequestBody(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel("body limit exceeded");
      throw new BodyTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

/** @param {string | null | undefined} value */
export function isJsonContentType(value) {
  return /^application\/json(?:\s*;|$)/i.test(String(value || "").trim());
}

/** @param {string | null | undefined} value */
export function isFormContentType(value) {
  return /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(String(value || "").trim());
}

/** @param {string | null | undefined} value */
export function isAcceptedFormContentType(value) {
  return isJsonContentType(value) || isFormContentType(value);
}
