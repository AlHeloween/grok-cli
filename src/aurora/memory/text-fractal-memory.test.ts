import { describe, it, expect } from 'vitest';
import { TextFractalMemoryBank } from './text-fractal-memory.js';

describe('text-fractal-memory', () => {
  const defaultOptions = { dim: 8, nLevels: 2, nPerLevel: 4 };

  it('initializes with options', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    expect(memory).toBeDefined();
    const stats = memory.getStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.entriesPerLevel[0]).toBe(0);
    expect(stats.entriesPerLevel[1]).toBe(0);
  });

  it('adds text entry and returns id', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const id = memory.add('Hello world');
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    const entry = memory.get(id);
    expect(entry).toBeDefined();
    expect(entry?.text).toBe('Hello world');
    expect(entry?.embedding).toHaveLength(defaultOptions.dim);
    expect(entry?.timestamp).toBeGreaterThan(0);
  });

  it('adds with metadata', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const metadata = { source: 'test', priority: 1 };
    const id = memory.add('Sample text', metadata);
    const entry = memory.get(id);
    expect(entry?.metadata).toEqual(metadata);
  });

  it('query returns similar entries', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const id1 = memory.add('apple banana cherry');
    const _id2 = memory.add('dog cat elephant');
    const _id3 = memory.add('zebra giraffe lion');

    // Query with same text as first entry should return that entry as top result
    const results = memory.query('apple banana cherry', 3);
    expect(results).toHaveLength(3);
    // First result should be the identical entry (similarity ~1)
    expect(results[0].entry.id).toBe(id1);
    expect(results[0].similarity).toBeCloseTo(1.0, 2);
    // All results should have valid similarity scores
    results.forEach(result => {
      expect(typeof result.similarity).toBe('number');
      expect(result.similarity).toBeGreaterThanOrEqual(-1);
      expect(result.similarity).toBeLessThanOrEqual(1);
    });
  });

  it('queryByEmbedding works', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const id1 = memory.add('First');
    const _id2 = memory.add('Second');
    const entry = memory.get(id1);
    expect(entry).toBeDefined();
    const results = memory.queryByEmbedding(entry!.embedding, 2);
    expect(results).toHaveLength(2);
    // First result should be the same entry (similarity ~1)
    expect(results[0].entry.id).toBe(id1);
    expect(results[0].similarity).toBeCloseTo(1.0, 2);
  });

  it('deletes entry', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const id = memory.add('To be deleted');
    expect(memory.get(id)).toBeDefined();
    const deleted = memory.delete(id);
    expect(deleted).toBe(true);
    expect(memory.get(id)).toBeUndefined();
  });

  it('getStats reflects entry counts', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    expect(memory.getStats().totalEntries).toBe(0);
    memory.add('One');
    memory.add('Two');
    expect(memory.getStats().totalEntries).toBe(2);
    memory.delete('non-existent');
    expect(memory.getStats().totalEntries).toBe(2);
  });

  // Edge cases
  it('handles empty query', () => {
    const memory = new TextFractalMemoryBank(defaultOptions);
    const results = memory.query('anything', 5);
    expect(results).toHaveLength(0);
  });

  it('query returns at most k entries', () => {
    const memory = new TextFractalMemoryBank({ dim: 4, nLevels: 1, nPerLevel: 2 });
    for (let i = 0; i < 10; i++) {
      memory.add(`Text ${i}`);
    }
    const results = memory.query('Text', 3);
    expect(results).toHaveLength(3);
  });

  it('deterministic embedding', () => {
    const memory1 = new TextFractalMemoryBank(defaultOptions);
    const memory2 = new TextFractalMemoryBank(defaultOptions);
    const id1 = memory1.add('Same text');
    const id2 = memory2.add('Same text');
    const entry1 = memory1.get(id1)!;
    const entry2 = memory2.get(id2)!;
    // Hash embedding should be deterministic across instances
    for (let i = 0; i < defaultOptions.dim; i++) {
      expect(entry1.embedding[i]).toBeCloseTo(entry2.embedding[i], 5);
    }
  });
});

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/aurora/memory/text-fractal-memory.test.ts"
//   "update_script": "adm.exe"
//   "backup_path": "none"
//   "created_at": "2026-03-01T23:41:59.048363+00:00"
//   "new_hash": "cdebdaf6f925853c6996e087fa24a538"
//   "goal_id": "text_create_new_file"
//   "semantics": "Create unit test for text-fractal-memory module."
//   "update_attrs": {"relative_path": "src/aurora/memory/text-fractal-memory.test.ts", "update_type": "text", "mode": "overwrite", "encoding": "utf-8", "find_pattern": null, "find_text": "", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/aurora/memory/text-fractal-memory.test.ts\""
// }
