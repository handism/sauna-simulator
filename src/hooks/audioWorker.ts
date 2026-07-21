self.onmessage = function(e: MessageEvent) {
  const { id, type, length } = e.data;
  const data = new Float32Array(length);
  const maxElements = 16384;
  const randomValues = new Uint32Array(maxElements);

  let lastOut = 0;
  if (type === 'saunaNoise') {
    for (let i = 0; i < length; i += maxElements) {
      const chunkLength = Math.min(maxElements, length - i);
      const chunk = chunkLength === maxElements ? randomValues : new Uint32Array(chunkLength);
      self.crypto.getRandomValues(chunk);
      for (let j = 0; j < chunkLength; j++) {
        const white = (chunk[j] / 4294967295) * 2 - 1;
        data[i + j] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i + j];
        data[i + j] *= 3.5;
      }
    }
  } else if (type === 'windNoise') {
    for (let i = 0; i < length; i += maxElements) {
      const chunkLength = Math.min(maxElements, length - i);
      const chunk = chunkLength === maxElements ? randomValues : new Uint32Array(chunkLength);
      self.crypto.getRandomValues(chunk);
      for (let j = 0; j < chunkLength; j++) {
        const white = (chunk[j] / 4294967295) * 2 - 1;
        data[i + j] = (lastOut + (0.015 * white)) / 1.015;
        lastOut = data[i + j];
        data[i + j] *= 5.0;
      }
    }
  } else {
    for (let i = 0; i < length; i += maxElements) {
      const chunkLength = Math.min(maxElements, length - i);
      const chunk = chunkLength === maxElements ? randomValues : new Uint32Array(chunkLength);
      self.crypto.getRandomValues(chunk);
      for (let j = 0; j < chunkLength; j++) {
        const white = (chunk[j] / 4294967295) * 2 - 1;
        data[i + j] = white;
      }
    }
  }
  self.postMessage({ id, data }, [data.buffer]);
};
