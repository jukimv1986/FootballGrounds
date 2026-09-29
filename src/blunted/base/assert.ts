// C/C++ assert() replacement. Failing asserts log (and throw in dev builds with ?strict in the URL).

let strict = false;
if (typeof location !== 'undefined') strict = new URLSearchParams(location.search).has('strict');

export function assert(condition: unknown, message = 'assertion failed'): asserts condition {
  if (!condition) {
    if (strict) throw new Error(message);
    console.warn(message);
  }
}
