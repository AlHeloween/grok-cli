import { generateSierpinskiCentroids } from './src/aurora/fractal/sierpinski.js';

const options = { nDim: 2, depth: 1 };
console.log('Generating centroids...');
try {
  const centroids = generateSierpinskiCentroids(options);
  console.log('Success, centroids:', centroids);
} catch (e) {
  console.error('Error:', e);
  console.error(e.stack);
}