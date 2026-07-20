/**
 * Generates a cryptographically secure random number between 0 (inclusive) and 1 (exclusive).
 * This is a drop-in replacement for Math.random() that uses the Web Crypto API.
 * @returns A random number between 0 (inclusive) and 1 (exclusive).
 */
export const secureRandom = (): number => {
  const randomBuffer = new Uint32Array(1);
  window.crypto.getRandomValues(randomBuffer);
  // Divide by the maximum possible value for a Uint32 to get a value between 0 and 1
  return randomBuffer[0] / (0xffffffff + 1);
};
