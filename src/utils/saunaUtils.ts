export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + (humidity * 0.45);
};
