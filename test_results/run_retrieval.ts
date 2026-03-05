#!/usr/bin/env bun
import { retrieveTopK } from '../src/rag/retriever.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for hash embeddings
  process.env.GROK_EMBEDDINGS_PROVIDER = 'hash';
  process.env.GROK_EMBEDDINGS_HASH_DIMENSION = '256';
  
  const docsDir = path.join(__dirname, 'extracted_docs');
  const questionsPath = path.join(__dirname, 'selected_questions.json');
  const outputPath = path.join(__dirname, 'retrieval_results.json');
  
  console.log(`Reading questions from: ${questionsPath}`);
  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
  
  interface RetrievalResult {
    questionId: string;
    question: string;
    systemInstruction?: string;
    retrievedChunksCount?: number;
    topChunks?: Array<{path: string, text: string, distance?: number}>;
    error?: string;
  }
  
  const results: RetrievalResult[] = [];
  
  for (const [index, q] of questionsData.entries()) {
    console.log(`\n=== Question ${index + 1}: ${q.id} ===`);
    console.log(`Question: ${q.question.substring(0, 100)}...`);
    
    try {
      const chunks = await retrieveTopK(q.question, { cwd: docsDir });
      console.log(`Retrieved ${chunks.length} chunks`);
      
      const topChunks = chunks.slice(0, 3); // Top 3 chunks
      
      results.push({
        questionId: q.id,
        question: q.question,
        systemInstruction: q.system_instruction,
        retrievedChunksCount: chunks.length,
        topChunks: topChunks.map(chunk => ({
          path: chunk.path,
          text: chunk.text.substring(0, 200) + '...',
          distance: chunk.distance
        }))
      });
      
      // Print top chunk info
      if (topChunks.length > 0) {
        console.log(`Top chunk from: ${topChunks[0].path}`);
        console.log(`Text preview: ${topChunks[0].text.substring(0, 150)}...`);
        console.log(`Distance: ${topChunks[0].distance}`);
      }
    } catch (error) {
      console.error(`Error retrieving for question ${q.id}:`, error);
      results.push({
        questionId: q.id,
        question: q.question,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  
  // Save results
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Saved retrieval results to: ${outputPath}`);
  
  // Also create a human-readable report
  const reportPath = path.join(__dirname, 'retrieval_report.md');
  let report = '# RAG Retrieval Test Results\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  for (const result of results) {
    report += `## Question ${result.questionId}\n\n`;
    report += `**Question:** ${result.question}\n\n`;
    
    if (result.error) {
      report += `**Error:** ${result.error}\n\n`;
    } else {
      report += `**Retrieved chunks:** ${result.retrievedChunksCount}\n\n`;
      if (result.topChunks) {
        for (const [i, chunk] of result.topChunks.entries()) {
          report += `### Chunk ${i + 1}\n`;
          report += `**File:** ${chunk.path}\n`;
          report += `**Distance:** ${chunk.distance}\n`;
          report += `**Text:** ${chunk.text}\n\n`;
        }
      }
    }
    report += '---\n\n';
  }
  
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Created human-readable report: ${reportPath}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});