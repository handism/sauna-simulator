function generateSecureWhiteNoise(length: number): Float32Array {
  const data = new Float32Array(length);
  const maxElements = 16384;
  const randomValues = new Uint32Array(maxElements);

  for (let i = 0; i < length; i += maxElements) {
    const chunkLength = Math.min(maxElements, length - i);
    const chunk = chunkLength === maxElements ? randomValues : new Uint32Array(chunkLength);
    crypto.getRandomValues(chunk);
    for (let j = 0; j < chunkLength; j++) {
      data[i + j] = (chunk[j] / 4294967295) * 2 - 1;
    }
  }
  return data;
}

function generateFastWhiteNoise(length: number): Float32Array {
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return data;
}

function simulateSaunaNoiseOld() {
  const bufferSize = 48000 * 2;
  const data = new Float32Array(bufferSize);
  const whiteNoise = generateSecureWhiteNoise(bufferSize);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = whiteNoise[i];
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5;
  }
}

function simulateSaunaNoiseNew() {
  const bufferSize = 48000 * 2;
  const data = new Float32Array(bufferSize);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5;
  }
}

const startOld = performance.now();
for (let i = 0; i < 100; i++) {
  simulateSaunaNoiseOld();
}
const endOld = performance.now();
console.log(`Baseline time: ${endOld - startOld} ms`);

const startNew = performance.now();
for (let i = 0; i < 100; i++) {
  simulateSaunaNoiseNew();
}
const endNew = performance.now();
console.log(`Optimized time: ${endNew - startNew} ms`);
