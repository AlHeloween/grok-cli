#!/usr/bin/env python3
"""
Generate ADID descriptor for Aurora integration files.
"""

import xml.etree.ElementTree as ET
from xml.dom import minidom
import hashlib
import datetime
import sys


def escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def create_descriptor():
    """Create ADID descriptor with multiple create blocks."""
    timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S")

    # Create root element
    updates = ET.Element("updates")

    # Metadata
    metadata = ET.SubElement(updates, "metadata")
    ET.SubElement(metadata, "created_at").text = (
        datetime.datetime.utcnow().isoformat() + "+00:00"
    )
    ET.SubElement(
        metadata, "goal"
    ).text = "Create Aurora integration components (reference implementation)"
    ET.SubElement(metadata, "owner").text = "opencode"

    created_with = ET.SubElement(metadata, "created_with")
    ET.SubElement(
        created_with, "git_head"
    ).text = "c0de9e2b6bc73647ac10f15180f08d3799da8d4a"
    ET.SubElement(created_with, "uv_lock_md5").text = "missing"
    ET.SubElement(created_with, "python").text = "3.13.12"
    ET.SubElement(created_with, "semgrep").text = "unknown"
    ET.SubElement(created_with, "tree_sitter").text = "absent"
    ET.SubElement(created_with, "tree_sitter_language_pack").text = "absent"

    scripts = ET.SubElement(metadata, "scripts")
    ET.SubElement(
        scripts, "script", name=f"{timestamp}_cli_update.py"
    ).text = "Apply Aurora integration files"

    logging = ET.SubElement(metadata, "logging")
    ET.SubElement(logging, "progress_log", path="_progress_log.md", mode="append")
    ET.SubElement(logging, "manifest", enabled="true")

    verification = ET.SubElement(metadata, "verification")
    ET.SubElement(verification, "verify_all", root=".", reports_path="logs")
    ET.SubElement(
        verification,
        "diagram",
        generator="docs/documentation_uml_generator.py",
        output="docs/uml_diagram.md",
    )

    hints = ET.SubElement(metadata, "hints")
    for name in [
        "text_anchor_example",
        "text_insert_example",
        "binary_patch_example",
        "rust_regex_example",
        "sed_script_example",
        "structured_rule_example",
    ]:
        ET.SubElement(hints, "name").text = name

    # 1. GloVe loader
    glove_content = """import * as fs from "fs";
import * as path from "path";

export interface GloVeVector {
  word: string;
  vector: number[];
  norm: number;
}

export class GloVeLoader {
  private vectors: Map<string, number[]> = new Map();
  private norms: Map<string, number> = new Map();
  private dimension: number = 0;

  /**
   * Load GloVe vectors from a text file (space-separated, first token is word).
   */
  async loadFromFile(filePath: string): Promise<void> {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\\n").filter(line => line.trim());
    
    for (const line of lines) {
      const parts = line.split(" ");
      if (parts.length < 2) continue;
      
      const word = parts[0];
      const vector = parts.slice(1).map(Number);
      
      if (this.dimension === 0) {
        this.dimension = vector.length;
      } else if (vector.length !== this.dimension) {
        continue; // skip malformed lines
      }
      
      // Normalize vector to unit length
      const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
      const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
      
      this.vectors.set(word, normalized);
      this.norms.set(word, norm);
    }
  }

  /**
   * Load GloVe vectors from a URL (fetches and caches locally).
   */
  async loadFromUrl(url: string, cacheDir?: string): Promise<void> {
    // For reference implementation, we'll just throw
    throw new Error("loadFromUrl not implemented in reference version");
  }

  getDimension(): number {
    return this.dimension;
  }

  getVector(word: string): number[] | undefined {
    return this.vectors.get(word.toLowerCase());
  }

  getNorm(word: string): number {
    return this.norms.get(word.toLowerCase()) || 0;
  }

  hasWord(word: string): boolean {
    return this.vectors.has(word.toLowerCase());
  }

  /**
   * Cosine similarity between two words.
   */
  similarity(word1: string, word2: string): number {
    const v1 = this.getVector(word1);
    const v2 = this.getVector(word2);
    if (!v1 || !v2) return 0;
    
    let dot = 0;
    for (let i = 0; i < this.dimension; i++) {
      dot += v1[i] * v2[i];
    }
    return dot; // vectors are already normalized
  }

  /**
   * Find top K words most similar to a target vector.
   */
  findSimilarWords(targetVector: number[], topK: number = 10): Array<{word: string, score: number}> {
    const results: Array<{word: string, score: number}> = [];
    
    for (const [word, vector] of this.vectors.entries()) {
      let dot = 0;
      for (let i = 0; i < this.dimension; i++) {
        dot += targetVector[i] * vector[i];
      }
      results.push({ word, score: dot });
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Find top K words most similar to a target word.
   */
  findSimilarToWord(targetWord: string, topK: number = 10): Array<{word: string, score: number}> {
    const targetVector = this.getVector(targetWord);
    if (!targetVector) return [];
    return this.findSimilarWords(targetVector, topK);
  }

  /**
   * Get all words in vocabulary.
   */
  getVocabulary(): string[] {
    return Array.from(this.vectors.keys());
  }
}

/**
 * Create a GloVe loader with a small test vocabulary (for reference/testing).
 */
export function createTestGloVeLoader(): GloVeLoader {
  // Create a mini loader with a few words for testing
  const loader = new GloVeLoader();
  // Mock vectors for testing
  const mockVectors: Record<string, number[]> = {
    "apple": [0.1, 0.2, 0.3],
    "banana": [0.2, 0.3, 0.4],
    "fruit": [0.15, 0.25, 0.35],
    "computer": [0.9, 0.8, 0.7],
    "technology": [0.85, 0.75, 0.65],
  };
  
  for (const [word, vector] of Object.entries(mockVectors)) {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    const normalized = norm > 0 ? vector.map(v => v / norm) : vector;
    loader.vectors.set(word, normalized);
    loader.norms.set(word, norm);
  }
  loader.dimension = 3;
  
  return loader;
}
"""

    # 2. Sierpinski fractal centroid generator
    sierpinski_content = """/**
 * Sierpinski N‑simplex fractal centroid generator (reference implementation).
 * Based on Aurora‑Genesis fractal/sierpinski.py (chaos‑game iteration).
 */

export interface SierpinskiOptions {
  /** Number of dimensions (N‑simplex has N+1 vertices) */
  nDim: number;
  /** Depth of chaos‑game iteration */
  depth: number;
  /** Random seed for deterministic generation */
  seed?: number;
  /** Maximum number of centroids to generate (if depth would produce too many) */
  maxCentroids?: number;
}

/**
 * Generate vertices of a regular N‑simplex centered at origin.
 */
function regularSimplexVertices(nDim: number): number[][] {
  if (nDim < 1) throw new Error(`nDim must be >= 1, got ${nDim}`);
  
  // Small dimensions: explicit formulas
  if (nDim === 1) {
    return [[-1.0], [1.0]];
  }
  if (nDim === 2) {
    const sqrt3 = Math.sqrt(3);
    return [
      [-1.0, -sqrt3 / 3],
      [1.0, -sqrt3 / 3],
      [0.0, 2 * sqrt3 / 3],
    ];
  }
  if (nDim === 3) {
    const sqrt3 = Math.sqrt(3);
    const sqrt6 = Math.sqrt(6);
    return [
      [-1.0, -1.0 / sqrt3, -1.0 / sqrt6],
      [1.0, -1.0 / sqrt3, -1.0 / sqrt6],
      [0.0, 2.0 / sqrt3, -1.0 / sqrt6],
      [0.0, 0.0, 3.0 / sqrt6],
    ];
  }
  
  // General case: generate using QR decomposition analogue
  const vertices: number[][] = [];
  for (let i = 0; i < nDim + 1; i++) {
    const vertex: number[] = new Array(nDim).fill(-1.0 / (nDim + 1));
    if (i === 0) {
      vertex[0] = 1.0;
    } else {
      vertex[i - 1] = 1.0 - (1.0 / (nDim + 1));
    }
    vertices.push(vertex);
  }
  
  // Normalize to unit sphere
  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    const norm = Math.sqrt(vertex.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let j = 0; j < nDim; j++) {
        vertex[j] /= norm;
      }
    }
  }
  
  return vertices;
}

/**
 * Generate Sierpinski N‑simplex centroids using chaos‑game iteration.
 * Deterministic, based on LCG random sequence.
 */
export function generateSierpinskiCentroids(
  options: SierpinskiOptions
): number[][] {
  const { nDim, depth, seed = 1234, maxCentroids = 65536 } = options;
  
  if (nDim < 1) throw new Error(`nDim must be >= 1, got ${nDim}`);
  if (depth < 1) throw new Error(`depth must be >= 1, got ${depth}`);
  
  // Generate simplex vertices
  const vertices = regularSimplexVertices(nDim);
  const nVertices = vertices.length; // nDim + 1
  
  // Number of centroids: 2^(nDim * depth) is intractable for large values
  let nCentroidsTarget = 2 ** (nDim * depth);
  if (nCentroidsTarget > maxCentroids) {
    // Use depth=1 and generate maxCentroids instead (bounded runtime)
    nCentroidsTarget = maxCentroids;
  }
  
  const nCentroids = Math.min(nCentroidsTarget, maxCentroids);
  
  // LCG constants (matches Aurora CUDA header)
  const LCG_MULT = 1664525;
  const LCG_ADD = 1013904223;
  
  // Initialize centroids at origin
  const centroids: number[][] = Array.from({ length: nCentroids }, () => 
    new Array(nDim).fill(0)
  );
  
  // Initialize LCG states per centroid
  const states: number[] = Array.from({ length: nCentroids }, (_, idx) => {
    return ((seed & 0xFFFFFFFF) ^ ((idx * 747796405) & 0xFFFFFFFF)) & 0xFFFFFFFF;
  });
  
  // Chaos‑game iteration
  for (let iter = 0; iter < depth; iter++) {
    for (let c = 0; c < nCentroids; c++) {
      // Update LCG state
      states[c] = ((states[c] * LCG_MULT) + LCG_ADD) & 0xFFFFFFFF;
      // Choose random vertex
      const vertexIdx = states[c] % nVertices;
      const vertex = vertices[vertexIdx];
      
      // Move to midpoint between current centroid and chosen vertex
      const centroid = centroids[c];
      for (let d = 0; d < nDim; d++) {
        centroid[d] = (centroid[d] + vertex[d]) * 0.5;
      }
    }
  }
  
  return centroids;
}

/**
 * Generate centroids and map them to a specific range (e.g., [-1, 1]^N).
 */
export function generateSierpinskiCentroidsNormalized(
  options: SierpinskiOptions,
  rangeMin: number = -1,
  rangeMax: number = 1
): number[][] {
  const centroids = generateSierpinskiCentroids(options);
  
  // Find bounding box
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const centroid of centroids) {
    for (const val of centroid) {
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
  }
  
  // Normalize to range
  const scale = (rangeMax - rangeMin) / (maxVal - minVal);
  const offset = rangeMin - minVal * scale;
  
  return centroids.map(centroid => 
    centroid.map(val => val * scale + offset)
  );
}

/**
 * Utility: compute Euclidean distance between two vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Find nearest centroid for a given vector.
 */
export function findNearestCentroid(
  vector: number[],
  centroids: number[][]
): { index: number; distance: number } {
  let bestIdx = 0;
  let bestDist = Infinity;
  
  for (let i = 0; i < centroids.length; i++) {
    const dist = euclideanDistance(vector, centroids[i]);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  
  return { index: bestIdx, distance: bestDist };
}
"""

    # 3. Text-fractal memory bank (simplified)
    text_fractal_content = """/**
 * Text‑fractal memory bank (reference implementation).
 * Based on Aurora‑Genesis memory/text_fractal_memory.py.
 * Uses hash‑based deterministic embedding and Sierpinski centroids for clustering.
 */

import { generateSierpinskiCentroids, findNearestCentroid } from "../fractal/sierpinski.js";

export interface TextEntry {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, any>;
  timestamp?: number;
}

export interface TextFractalMemoryOptions {
  /** Number of dimensions for embedding space */
  dim: number;
  /** Number of hierarchical levels */
  nLevels: number;
  /** Number of centroids per level */
  nPerLevel: number;
  /** Seed for deterministic centroid generation */
  seed?: number;
}

/**
 * Deterministic embedding via hashing (reference implementation).
 * In production, use a proper embedding model.
 */
function hashEmbedding(text: string, dim: number): number[] {
  // Simple deterministic hash-based embedding for reference
  const hash = (str: string): number => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0; // Convert to 32-bit integer
    }
    return h;
  };
  
  const embedding: number[] = new Array(dim).fill(0);
  for (let i = 0; i < dim; i++) {
    const seed = hash(text + i.toString());
    // Map to [-1, 1]
    embedding[i] = (seed % 10000) / 5000 - 1;
  }
  
  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      embedding[i] /= norm;
    }
  }
  
  return embedding;
}

export class TextFractalMemoryBank {
  private entries: Map<string, TextEntry> = new Map();
  private centroids: number[][][] = []; // [level][centroidIndex][dim]
  private levelToEntries: Map<number, Set<string>> = new Map();
  private options: TextFractalMemoryOptions;
  
  constructor(options: TextFractalMemoryOptions) {
    this.options = options;
    this.initCentroids();
  }
  
  private initCentroids(): void {
    const { dim, nLevels, nPerLevel, seed } = this.options;
    
    for (let level = 0; level < nLevels; level++) {
      // Generate centroids for this level
      const centroids = generateSierpinskiCentroids({
        nDim: dim,
        depth: 1,
        seed: (seed || 1234) + level * 1000,
        maxCentroids: nPerLevel,
      });
      this.centroids[level] = centroids;
      this.levelToEntries.set(level, new Set());
    }
  }
  
  /**
   * Add a text entry to memory.
   */
  add(text: string, metadata?: Record<string, any>): string {
    const id = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const embedding = hashEmbedding(text, this.options.dim);
    
    const entry: TextEntry = {
      id,
      text,
      embedding,
      metadata,
      timestamp: Date.now(),
    };
    
    this.entries.set(id, entry);
    
    // Assign to nearest centroid at each level
    for (let level = 0; level < this.options.nLevels; level++) {
      const centroids = this.centroids[level];
      const { index } = findNearestCentroid(embedding, centroids);
      // Store mapping (in reference implementation, just track)
      // In full implementation, would maintain inverted index
    }
    
    return id;
  }
  
  /**
   * Query similar entries by text.
   */
  query(
    text: string,
    k: number = 5,
    level?: number
  ): Array<{ entry: TextEntry; similarity: number }> {
    const queryEmbedding = hashEmbedding(text, this.options.dim);
    
    // Simple linear scan (reference implementation)
    const results: Array<{ entry: TextEntry; similarity: number }> = [];
    
    for (const entry of this.entries.values()) {
      // Cosine similarity
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.options.dim; i++) {
        dot += queryEmbedding[i] * entry.embedding[i];
        normA += queryEmbedding[i] * queryEmbedding[i];
        normB += entry.embedding[i] * entry.embedding[i];
      }
      
      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
      results.push({ entry, similarity });
    }
    
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }
  
  /**
   * Query by embedding vector.
   */
  queryByEmbedding(
    embedding: number[],
    k: number = 5
  ): Array<{ entry: TextEntry; similarity: number }> {
    const results: Array<{ entry: TextEntry; similarity: number }> = [];
    
    for (const entry of this.entries.values()) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.options.dim; i++) {
        dot += embedding[i] * entry.embedding[i];
        normA += embedding[i] * embedding[i];
        normB += entry.embedding[i] * entry.embedding[i];
      }
      
      const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
      results.push({ entry, similarity });
    }
    
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }
  
  /**
   * Get entry by ID.
   */
  get(id: string): TextEntry | undefined {
    return this.entries.get(id);
  }
  
  /**
   * Delete entry by ID.
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }
  
  /**
   * Get statistics.
   */
  getStats(): {
    totalEntries: number;
    entriesPerLevel: Record<number, number>;
  } {
    const entriesPerLevel: Record<number, number> = {};
    for (let level = 0; level < this.options.nLevels; level++) {
      entriesPerLevel[level] = this.levelToEntries.get(level)?.size || 0;
    }
    
    return {
      totalEntries: this.entries.size,
      entriesPerLevel,
    };
  }
}
"""

    # Create update blocks
    updates_data = [
        ("src/aurora/glove/loader.ts", glove_content),
        ("src/aurora/fractal/sierpinski.ts", sierpinski_content),
        ("src/aurora/memory/text-fractal-memory.ts", text_fractal_content),
    ]

    for file_path, content in updates_data:
        # Compute MD5 (adm will recompute, but we need placeholder)
        content_md5 = hashlib.md5(content.encode("utf-8")).hexdigest()
        size = len(content.encode("utf-8"))

        update_elem = ET.SubElement(updates, "update_md5_" + content_md5)
        update_elem.set(
            "name", "create_" + file_path.replace("/", "_").replace(".", "_")
        )
        update_elem.set("md5", content_md5)
        update_elem.set("size", str(size))

        ET.SubElement(update_elem, "file").text = file_path
        ET.SubElement(update_elem, "update_type").text = "text"
        ET.SubElement(update_elem, "mode").text = "create"
        ET.SubElement(update_elem, "encoding").text = "utf-8"
        ET.SubElement(
            update_elem, "semantics"
        ).text = f"Create {file_path} (Aurora reference implementation)"

        content_elem = ET.SubElement(update_elem, "content_md5_" + content_md5)
        content_elem.text = content

    # Convert to pretty XML
    rough_string = ET.tostring(updates, encoding="utf-8")
    reparsed = minidom.parseString(rough_string)
    pretty_xml = reparsed.toprettyxml(indent="  ")

    # Fix CDATA escaping (adm expects escaped XML, not CDATA)
    # For simplicity, we'll just write as is; adm --fix-xml will fix

    output_path = f"updates/{timestamp}_aurora_integration.xml"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(pretty_xml)

    print(f"Generated descriptor at {output_path}")
    print("Run: tools/adm.exe --fix-xml " + output_path)
    print("Then: tools/adm.exe --apply " + output_path)


if __name__ == "__main__":
    create_descriptor()
