import { TokenCounter } from './src/utils/token-counter.js';

const counter = new TokenCounter('gpt-4');
const text = "This is a test string that we will count tokens for multiple times.";

const iterations = 100000;

console.log(`Benchmarking TokenCounter.countTokens with ${iterations} iterations...`);

const start = performance.now();
for (let i = 0; i < iterations; i++) {
  counter.countTokens(text);
}
const end = performance.now();

const duration = end - start;
const opsPerSec = (iterations / duration) * 1000;

console.log(`Duration: ${duration.toFixed(2)}ms`);
console.log(`Ops/sec: ${opsPerSec.toFixed(2)}`);

counter.dispose();
