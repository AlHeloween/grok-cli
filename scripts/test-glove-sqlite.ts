import { createSqliteGloVeLoader } from "../src/aurora/glove/sqlite-loader.js";
import * as path from "path";

async function main() {
  const dbPath = path.resolve(process.cwd(), "data/glove/glove_50d.db");
  console.log(`Testing SQLite GloVe loader at: ${dbPath}`);
  
  try {
    const loader = await createSqliteGloVeLoader(dbPath);
    console.log(`Loader opened, dimension: ${loader.dimension}`);
    
    // Test some common words
    const testWords = ["the", "and", "computer", "science", "language"];
    
    for (const word of testWords) {
      const vector = loader.getVector(word);
      const norm = loader.getNorm(word);
      console.log(`Word "${word}": ${vector ? "found" : "not found"}, norm=${norm.toFixed(4)}`);
      if (vector) {
        console.log(`  Vector length: ${vector.length}, first 3 values: ${vector.slice(0, 3).map(v => v.toFixed(4)).join(", ")}`);
      }
    }
    
    // Test similarity
    const word1 = "computer";
    const word2 = "science";
    const similarity = loader.similarity(word1, word2);
    console.log(`Similarity "${word1}" ↔ "${word2}": ${similarity.toFixed(4)}`);
    
    // Test find similar words
    const similar = loader.findSimilarToWord("computer", 5);
    console.log(`Words similar to "computer":`);
    similar.forEach(({word, score}) => {
      console.log(`  ${word}: ${score.toFixed(4)}`);
    });
    
    // Test vocabulary size
    const vocab = loader.getVocabulary();
    console.log(`Vocabulary size: ${vocab.length}`);
    
    loader.close();
    console.log("Test passed!");
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});