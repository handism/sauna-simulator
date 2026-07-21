import { getSecureRandom } from './saunaUtils';

/**
 * Generates a cryptographically secure random number between 0 (inclusive) and 1 (exclusive).
 * This is a drop-in replacement for Math.random() that uses the Web Crypto API.
 * @returns A random number between 0 (inclusive) and 1 (exclusive).
 */
export const secureRandom = (): number => {
  return getSecureRandom();
};
