#!/usr/bin/env bun
import { GrokAgent } from '../src/agent/grok-agent.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Set environment variables for GloVe embeddings
  const gloveDbPath = path.resolve(__dirname, '..', 'data', 'glove', 'glove_50d.db');
  process.env.GROK_EMBEDDINGS_PROVIDER = 'glove';
  process.env.GROK_EMBEDDINGS_GLOVE_MODEL_PATH = gloveDbPath;
  process.env.GROK_RAG_ENABLED = '1';
  process.env.GROK_RAG_QUANTIZE = 'false';
  process.env.GROK_RAG_QUANTIZE_PRELOAD = 'false';
  process.env.GROK_MODEL = 'grok-4-latest';
  
  // Dummy API key (won't actually call API)
  const apiKey = 'dummy-key';
  const docsDir = path.join(__dirname, 'extracted_docs');
  
  console.log('Changing directory to:', docsDir);
  process.chdir(docsDir);
  
  const agent = new GrokAgent(apiKey, undefined, 'grok-4-latest');
  
  // Inspect initial system message
  const messagesBefore = (agent as any).chatHistoryManager.getMessages();
  console.log('Initial system message (first 500 chars):');
  const initialContent = messagesBefore[0]?.content;
  const preview = typeof initialContent === 'string' ? initialContent.substring(0, 500) : '[Non-string content]';
  console.log(preview || 'No system message');
  console.log('---');
  
  const question = 'What is optimal foraging theory when compared to automotive theft?';
  console.log(`Processing question: ${question}`);
  
  // We'll monkey-patch the API call to avoid actual request
  const originalChat = (agent as any).grokClient.chat;
  (agent as any).grokClient.chat = async (messages: any[], tools: any[], options: any) => {
    console.log('\n=== Messages sent to API ===');
    console.log('Number of messages:', messages.length);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      console.log(`\n--- Message ${i} (${msg.role}) ---`);
      if (msg.role === 'system') {
        console.log('System content (first 1000 chars):');
        const content = msg.content;
        const preview = typeof content === 'string' ? content.substring(0, 1000) : '[Non-string content]';
        console.log(preview || 'empty');
      } else {
        const content = msg.content;
        const preview = typeof content === 'string' ? content.substring(0, 200) + '...' : '[Non-string content]';
        console.log('Content:', preview);
      }
    }
    console.log('\n=== End Messages ===');
    
    // Return a mock response to avoid error
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Mock response - RAG context should be visible above.',
        }
      }]
    };
  };
  
  const originalChatWithAgentTools = (agent as any).grokClient.chatWithAgentTools;
  (agent as any).grokClient.chatWithAgentTools = async (messages: any[], tools: any[], options: any, includeWebSearch: boolean) => {
    console.log('\n=== Agent Tools Messages sent to API ===');
    console.log('Number of messages:', messages.length);
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      console.log(`\n--- Message ${i} (${msg.role}) ---`);
      if (msg.role === 'system') {
        console.log('System content (first 1000 chars):');
        const content = msg.content;
        const preview = typeof content === 'string' ? content.substring(0, 1000) : '[Non-string content]';
        console.log(preview || 'empty');
      } else {
        const content = msg.content;
        const preview = typeof content === 'string' ? content.substring(0, 200) + '...' : '[Non-string content]';
        console.log('Content:', preview);
      }
    }
    console.log('\n=== End Messages ===');
    
    // Return a mock response
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: 'Mock response',
        }
      }]
    };
  };
  
  try {
    const entries = await agent.processUserMessage(question);
    console.log('\n✅ Processed successfully (mock).');
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);