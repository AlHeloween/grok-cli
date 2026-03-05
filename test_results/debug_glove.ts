#!/usr/bin/env bun
import { GloveEmbeddingProvider } from '../src/rag/embedding-providers/glove-provider.js';
import { tokenize } from '../src/rag/semantic-vector.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const dbPath = path.join(__dirname, '..', 'data', 'glove', 'glove_50d.db');
  console.log(`Using database: ${dbPath}`);
  
  const provider = new GloveEmbeddingProvider(dbPath);
  
  console.log(`Provider dimension (before init): ${provider.getDimension()}`);
  
  // Test query
  const query = 'What are the core differences between fundamental analysis and technical analysis?';
  console.log(`Query: ${query}`);
  
  const tokens = tokenize(query);
  console.log(`Tokens: ${JSON.stringify(tokens)}`);
  
  // Compute embedding (will initialize loader)
  const embedding = await provider.embed(query);
  console.log(`\nEmbedding length: ${embedding.length}`);
  console.log(`Embedding first 5 values: ${embedding.slice(0, 5).join(', ')}`);
  
  // Compute norm
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  console.log(`Embedding norm: ${norm}`);
  
  // Check if zero vector
  if (norm === 0) {
    console.error('ERROR: Embedding is zero vector!');
    // Check tokens in loader
    const loader = (provider as any).loader;
    if (loader) {
      console.log('\nChecking token vectors:');
      for (const token of tokens) {
        const vector = loader.getVectorAsArray(token);
        console.log(`  "${token}": ${vector ? `found (len=${vector.length})` : 'NOT FOUND'}`);
      }
    }
  } else {
    console.log('Embedding seems non-zero.');
  }
  
  // Also test a simple word known to exist: "analysis"
  console.log('\n--- Testing single word "analysis" ---');
  const embedAnalysis = await provider.embed('analysis');
  const normAnalysis = Math.sqrt(embedAnalysis.reduce((s, v) => s + v * v, 0));
  console.log(`Norm for "analysis": ${normAnalysis}`);
}

main().catch(console.error);