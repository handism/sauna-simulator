import { getSecureRandom } from './src/utils/saunaUtils.js';

const ITERATIONS = 10_000_000;

console.time('Baseline: getSecureRandom');
let sum = 0;
for (let i = 0; i < ITERATIONS; i++) {
  sum += getSecureRandom();
}
console.timeEnd('Baseline: getSecureRandom');
console.log('Sum:', sum);
