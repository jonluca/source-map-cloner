const encoder = new TextEncoder();

/**
 * Return the UTF-8 size of a string. String.length counts UTF-16 code units,
 * which under-reports non-ASCII output when statistics are displayed as bytes.
 */
export function getUtf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}
