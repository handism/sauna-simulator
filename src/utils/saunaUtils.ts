export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + (humidity * 0.45);
};

export const getSecureRandom = (): number => {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return array[0] / (0xffffffff + 1);
};
