import { createTokenCounter } from '../src/utils/token-counter.js';

const counter = createTokenCounter('grok-3-latest');

const repetitiveStrings = [
  'user',
  'assistant',
  'system',
  'You are a helpful assistant.',
  'What is the capital of France?',
  'The capital of France is Paris.',
];

const iterations = 100000;

console.log(`Benchmarking TokenCounter.countTokens with ${iterations} iterations...`);

// Warm up
for (let i = 0; i < 1000; i++) {
  for (const s of repetitiveStrings) {
    counter.countTokens(s);
  }
}

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  for (const s of repetitiveStrings) {
    counter.countTokens(s);
  }
}
const end = performance.now();

const totalTime = end - start;
const opsPerSec = (iterations * repetitiveStrings.length) / (totalTime / 1000);

console.log(`Total time: ${totalTime.toFixed(2)}ms`);
console.log(`Ops/sec: ${opsPerSec.toLocaleString()}`);

counter.dispose();
