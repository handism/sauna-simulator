const maxElements = 16384;
function generateSecureWhiteNoise(length: number): Float32Array {
  const data = new Float32Array(length);
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

function simulateSaunaNoise() {
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

const start = performance.now();
for (let i = 0; i < 100; i++) {
  simulateSaunaNoise();
}
const end = performance.now();
console.log(`Baseline time for 100 iterations: ${end - start} ms`);
