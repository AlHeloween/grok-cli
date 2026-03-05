#!/usr/bin/env bun
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runGrok(question: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Set environment variables for GloVe
    const gloveDbPath = path.resolve(__dirname, '..', 'data', 'glove', 'glove_50d.db');
    const env = {
      ...process.env,
      GROK_EMBEDDINGS_PROVIDER: 'glove',
      GROK_EMBEDDINGS_GLOVE_MODEL_PATH: gloveDbPath,
      GROK_RAG_ENABLED: '1',
      GROK_RAG_QUANTIZE: 'false',
      GROK_RAG_QUANTIZE_PRELOAD: 'false',
      GROK_MODEL: 'grok-4-latest',
    };
    
    console.log(`Running: grok -p "${question.substring(0, 50)}..."`);
    const proc = spawn('grok', ['-p', question], { cwd, env });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`grok exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  const docsDir = path.join(__dirname, 'extracted_docs');
  const questionsPath = path.join(__dirname, 'selected_questions.json');
  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf-8'));
  
  // Test with questions that had correct retrieval
  const testIds = ['doc_026', 'doc_760']; // These had exact document matches
  const testQuestions = questionsData.filter(q => testIds.includes(q.id));
  
  const results: Array<{
    id: string;
    question: string;
    answer?: string;
    error?: string;
  }> = [];
  
  for (const q of testQuestions) {
    console.log(`\n=== Testing ${q.id} ===`);
    try {
      const answer = await runGrok(q.question, docsDir);
      results.push({ id: q.id, question: q.question, answer });
      console.log(`Answer (first 200 chars): ${answer.substring(0, 200)}...`);
      
      // Check if answer contains keywords from the expected document
      const expectedDocPath = path.join(docsDir, `${q.id}.txt`);
      if (fs.existsSync(expectedDocPath)) {
        const docContent = fs.readFileSync(expectedDocPath, 'utf-8').toLowerCase();
        const answerLower = answer.toLowerCase();
        // Look for unique phrases from the document
        const phrases = [
          'los angeles car thieves',
          'prey selection',
          'annual meeting of stockholders',
          'tripadvisor',
          'vote',
        ];
        let matches = 0;
        for (const phrase of phrases) {
          if (docContent.includes(phrase) && answerLower.includes(phrase)) {
            matches++;
          }
        }
        console.log(`Found ${matches} phrase matches with context document`);
      }
    } catch (error) {
      console.error(`Error: ${error}`);
      results.push({ id: q.id, question: q.question, error: error instanceof Error ? error.message : String(error) });
    }
  }
  
  // Save results
  const outputPath = path.join(__dirname, 'grok_glove_qa_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✅ Saved results to: ${outputPath}`);
  
  // Generate report
  const reportPath = path.join(__dirname, 'grok_glove_qa_report.md');
  let report = '# Grok-CLI Q/A Test with GloVe RAG\n\n';
  report += `Generated: ${new Date().toISOString()}\n\n`;
  
  for (const result of results) {
    report += `## ${result.id}\n\n`;
    report += `**Question:** ${result.question}\n\n`;
    if (result.error) {
      report += `**Error:** ${result.error}\n\n`;
    } else {
      report += `**Answer:**\n\n${result.answer}\n\n`;
    }
    report += '---\n\n';
  }
  
  fs.writeFileSync(reportPath, report);
  console.log(`✅ Created report: ${reportPath}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});