#!/usr/bin/env bun
import { retrieveTopK, formatRagChunksForPrompt } from '../src/rag/retriever.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for GloVe embeddings
  const gloveDbPath = path.resolve(__dirname, '..', 'data', 'glove', 'glove_50d.db');
  process.env.GROK_EMBEDDINGS_PROVIDER = 'glove';
  process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = gloveDbPath;
  
  const docsDir = path.join(__dirname, 'extracted_docs');
  const question = 'What is optimal foraging theory when compared to automotive theft?';
  
  console.log(`Question: ${question}`);
  console.log(`Working directory: ${docsDir}`);
  
  const rows = await retrieveTopK(question, { cwd: docsDir });
  console.log(`Retrieved ${rows.length} chunks`);
  
  // Display each chunk
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const row = rows[i];
    console.log(`\n--- Chunk ${i + 1} ---`);
    console.log(`File: ${row.path}`);
    console.log(`Distance: ${row.distance}`);
    console.log(`Text: ${row.text.substring(0, 300)}...`);
  }
  
  const formatted = formatRagChunksForPrompt(rows);
  console.log('\n=== Formatted RAG Context ===');
  console.log(formatted);
  console.log('=== End Context ===');
  
  // Simulate system prompt
  const baseSystemPrompt = 'You are a helpful assistant.';
  const fullSystemPrompt = baseSystemPrompt + '\n\nRELEVANT PROJECT CONTEXT (use when answering; prefer citing file paths):\n' + formatted;
  console.log('\n=== Full System Prompt (first 1000 chars) ===');
  console.log(fullSystemPrompt.substring(0, 1000));
}

main().catch(console.error);