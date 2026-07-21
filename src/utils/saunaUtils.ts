export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + (humidity * 0.45);
};

export const getSecureRandom = (): number => {
  const cryptoObj =
    typeof globalThis !== 'undefined' && globalThis.crypto
      ? globalThis.crypto
      : typeof window !== 'undefined'
      ? window.crypto
      : undefined;

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const array = new Uint32Array(1);
    cryptoObj.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
  }

  return Math.random();
};
