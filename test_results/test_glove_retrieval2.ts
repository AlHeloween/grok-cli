#!/usr/bin/env bun
import { retrieveTopK } from '../src/rag/retriever.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for GloVe embeddings
  process.env.GROK_EMBEDDINGS_PROVIDER = 'glove';
  process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = path.join(__dirname, '..', 'data', 'glove', 'glove_50d.db');
  process.env.GROK_RAG_ENABLED = '1';
  process.env.GROK_DEBUG_RAG = '1';
  
  const docsDir = path.join(__dirname, 'extracted_docs');
  
  // Test with the exact question from dataset
  const question = 'What are the core differences between fundamental analysis and technical analysis, in what they measure and how they are used? Include criticisms or downsides of each analysis to explain the differences in practice.';
  
  console.log(`Testing GloVe retrieval for question:`);
  console.log(`"${question}"`);
  console.log(`\nGloVe database: ${process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH}`);
  
  try {
    const chunks = await retrieveTopK(question, { cwd: docsDir });
    console.log(`\nRetrieved ${chunks.length} chunks`);
    
    // Show top 5 chunks with more detail
    for (let i = 0; i < Math.min(5, chunks.length); i++) {
      const chunk = chunks[i];
      console.log(`\n--- Chunk ${i + 1} ---`);
      console.log(`File: ${chunk.path}`);
      console.log(`Distance: ${chunk.distance}`);
      console.log(`Text preview (first 300 chars):`);
      console.log(`${chunk.text.substring(0, 300)}...`);
      
      // Check if this is the expected document (doc_655)
      if (chunk.path.includes('doc_655')) {
        console.log(`✅ This is the expected document for this question!`);
      }
    }
    
    // Count how many chunks are from expected document
    const expectedChunks = chunks.filter(c => c.path.includes('doc_655'));
    console.log(`\n📊 Summary: ${expectedChunks.length} of ${chunks.length} chunks are from the expected document (doc_655)`);
    
    // Show the content of doc_655 for comparison
    console.log(`\n📄 Content of doc_655 (first 500 chars):`);
    const fs = await import('fs');
    const docPath = path.join(docsDir, 'doc_655.txt');
    const content = fs.readFileSync(docPath, 'utf-8');
    console.log(content.substring(0, 500) + '...');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);