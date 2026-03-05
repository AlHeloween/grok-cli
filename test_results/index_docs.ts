#!/usr/bin/env bun
import { indexProject } from '../src/rag/indexer.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for hash embeddings (no external API needed)
  process.env.GROK_EMBEDDINGS_PROVIDER = 'hash';
  process.env.GROK_EMBEDDINGS_HASH_DIMENSION = '256';
  process.env.GROK_RAG_QUANTIZE = 'false';
  process.env.GROK_RAG_QUANTIZE_PRELOAD = 'false';
  
  const docsDir = path.join(__dirname, 'extracted_docs');
  console.log(`Indexing documents from: ${docsDir}`);
  
  try {
    const result = await indexProject({
      cwd: docsDir,
      force: true, // Recreate index
      chunkLines: 20,
      overlapLines: 5,
      quantize: false,
      quantizePreload: false,
      includeExtensions: ['.txt'],
      extractor: 'native',
    });
    
    console.log('\n✅ Indexing completed!');
    console.log(`   Database: ${result.dbPath}`);
    console.log(`   Files indexed: ${result.filesIndexed}`);
    console.log(`   Chunks indexed: ${result.chunksIndexed}`);
    
    // Save indexing result to file
    const fs = await import('fs');
    const resultPath = path.join(__dirname, 'indexing_result.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(`   Result saved to: ${resultPath}`);
    
  } catch (error) {
    console.error('❌ Indexing failed:', error);
    process.exit(1);
  }
}

main();