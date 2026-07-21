export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + (humidity * 0.45);
};

/**
 * Cryptographically secure random number generator in [0, 1) range,
 * equivalent to Math.random() but using Web Crypto API when available.
 */
export const getSecureRandom = (): number => {
  const cryptoObj = typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto : (typeof window !== 'undefined' ? window.crypto : undefined);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const array = new Uint32Array(1);
    cryptoObj.getRandomValues(array);
    return array[0] / 4294967296;
  }
  return Math.random();
};

