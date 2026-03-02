    #!/usr/bin/env bun
    
    /**
     * Benchmark FP16 storage conversion and memory usage.
     */
    
    import { float32ArrayToFp16, fp16ToFloat32Array, benchmarkConversion } from '../src/aurora/utils/fp16.js';
    
    function randomVector(dim: number): Float32Array {
      const arr = new Float32Array(dim);
      for (let i = 0; i <lt; dim; i++) {
        arr[i] = Math.random() * 2 - 1; // [-1, 1]
      }
      // Normalize (optional)
      let norm = 0;
      for (const x of arr) norm += x * x;
      norm = Math.sqrt(norm);
      if (norm >gt; 0) {
        for (let i = 0; i <lt; dim; i++) arr[i] /= norm;
      }
      return arr;
    }
    
    function measureMemory(vec: Float32Array, fp16: Uint16Array): void {
      const fp32Bytes = vec.byteLength;
      const fp16Bytes = fp16.byteLength;
      const ratio = fp16Bytes / fp32Bytes;
      console.log(`  FP32 size: ${fp32Bytes} bytes`);
      console.log(`  FP16 size: ${fp16Bytes} bytes`);
      console.log(`  Ratio: ${ratio.toFixed(2)} (expected 0.5)`);
    }
    
    function runBenchmark() {
      console.log('=== FP16 Storage Benchmark ===\n');
    
      const dimensions = [50, 100, 300, 1536]; // Typical GloVe and OpenAI embedding dimensions
      const iterations = 1000;
    
      for (const dim of dimensions) {
        console.log(`\nDimension ${dim}:`);
        
        // Generate test vector
        const vec = randomVector(dim);
        
        // Convert to FP16 and back
        const startEncode = performance.now();
        const fp16 = float32ArrayToFp16(vec);
        const endEncode = performance.now();
        
        const startDecode = performance.now();
        const reconstructed = fp16ToFloat32Array(fp16);
        const endDecode = performance.now();
        
        // Verify reconstruction error
        let maxAbsError = 0;
        let totalSqError = 0;
        for (let i = 0; i <lt; dim; i++) {
          const err = Math.abs(vec[i] - reconstructed[i]);
          maxAbsError = Math.max(maxAbsError, err);
          totalSqError += err * err;
        }
        const rmse = Math.sqrt(totalSqError / dim);
        
        console.log(`  Encode time: ${(endEncode - startEncode).toFixed(2)} ms`);
        console.log(`  Decode time: ${(endDecode - startDecode).toFixed(2)} ms`);
        console.log(`  Max absolute error: ${maxAbsError.toFixed(6)}`);
        console.log(`  RMSE: ${rmse.toFixed(6)}`);
        
        // Memory measurement
        measureMemory(vec, fp16);
        
        // Run built-in benchmark
        const bench = benchmarkConversion(vec, 100);
        console.log(`  Benchmark (100 iterations):`);
        console.log(`    Encode throughput: ${bench.encodeThroughput.toFixed(1)} elements/sec`);
        console.log(`    Decode throughput: ${bench.decodeThroughput.toFixed(1)} elements/sec`);
      }
      
      // Simulate retrieval pipeline with FP16 storage
      console.log('\n=== Simulated retrieval pipeline ===');
      const dim = 1536;
      const numVectors = 1000;
      const vectors = Array.from({ length: numVectors }, () =>gt; randomVector(dim));
      
      // FP32 storage memory
      const fp32Memory = vectors.reduce((sum, v) =>gt; sum + v.byteLength, 0);
      console.log(`FP32 total memory: ${fp32Memory} bytes (${(fp32Memory / 1024 / 1024).toFixed(2)} MB)`);
      
      // Convert to FP16
      const start = performance.now();
      const fp16Vectors = vectors.map(v =>gt; float32ArrayToFp16(v));
      const conversionTime = performance.now() - start;
      const fp16Memory = fp16Vectors.reduce((sum, v) =>gt; sum + v.byteLength, 0);
      console.log(`FP16 total memory: ${fp16Memory} bytes (${(fp16Memory / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`Conversion time: ${conversionTime.toFixed(2)} ms`);
      console.log(`Memory saving: ${((fp32Memory - fp16Memory) / fp32Memory * 100).toFixed(1)}%`);
    }
    
    runBenchmark();