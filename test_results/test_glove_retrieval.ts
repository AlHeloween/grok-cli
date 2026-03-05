#!/usr/bin/env bun
import { retrieveTopK } from '../src/rag/retriever.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for GloVe embeddings
  process.env.GROK_EMBEDDINGS_PROVIDER = 'glove';
  process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = path.join(__dirname, '..', 'data', 'glove', 'glove_50d.db');
  
  const docsDir = path.join(__dirname, 'extracted_docs');
  
  // Test with a question that should have semantic matches
  const testQuestion = 'What are the core differences between fundamental analysis and technical analysis?';
  
  console.log(`Testing GloVe retrieval for question: ${testQuestion}`);
  console.log(`GloVe database: ${process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH}`);
  
  try {
    const chunks = await retrieveTopK(testQuestion, { cwd: docsDir });
    console.log(`\nRetrieved ${chunks.length} chunks`);
    
    // Show top 3 chunks
    for (let i = 0; i < Math.min(3, chunks.length); i++) {
      const chunk = chunks[i];
      console.log(`\n--- Chunk ${i + 1} ---`);
      console.log(`File: ${chunk.path}`);
      console.log(`Distance: ${chunk.distance}`);
      console.log(`Text preview: ${chunk.text.substring(0, 200)}...`);
    }
    
    // Check if any chunk seems relevant (contains words from question)
    const questionWords = new Set(testQuestion.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    let relevantCount = 0;
    
    for (const chunk of chunks.slice(0, 5)) {
      const chunkText = chunk.text.toLowerCase();
      const matchingWords = Array.from(questionWords).filter(word => chunkText.includes(word));
      if (matchingWords.length > 0) {
        relevantCount++;
        console.log(`\nChunk matches words: ${matchingWords.join(', ')}`);
      }
    }
    
    console.log(`\nSummary: ${relevantCount} of top 5 chunks contain words from question`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);