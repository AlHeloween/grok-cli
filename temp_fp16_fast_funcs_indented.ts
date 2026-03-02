    /**
     * Optimized FP32 to FP16 conversion using integer arithmetic (no DataView).
     * Faster for bulk operations.
     */
    export function f32ToFp16Fast(value: number): number {
      // Handle special cases
      if (isNaN(value)) return 0x7e00;
      if (!isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
      
      // Extract bits using typed array (faster than DataView for single value)
      const buf = new ArrayBuffer(4);
      const f32 = new Float32Array(buf);
      f32[0] = value;
      const view = new Uint32Array(buf);
      const bits = view[0];
      
      const sign = (bits >> 31) & 0x1;
      let exponent = (bits >> 23) & 0xff;
      let mantissa = bits & 0x7fffff;
      
      // Special case: zero or denormal
      if (exponent === 0 && mantissa === 0) {
        return sign << 15;
      }
      
      // Convert exponent from FP32 bias (127) to FP16 bias (15)
      let exp16 = exponent - 127 + 15;
      
      // Handle overflow/underflow
      if (exp16 >= 31) {
        // Overflow -> infinity
        return (sign << 15) | 0x7c00;
      }
      if (exp16 <= 0) {
        // Underflow -> denormal (may flush to zero)
        if (exp16 < -10) {
          // Too small, flush to zero
          return sign << 15;
        }
        // Denormal
        mantissa |= 0x800000; // implicit leading 1
        const shift = 1 - exp16;
        mantissa >>= shift;
        exp16 = 0;
      } else {
        // Normal number
        mantissa >>= 13; // Keep 10 bits
      }
      
      // Combine
      return (sign << 15) | (exp16 << 10) | (mantissa & 0x3ff);
    }
    
    /**
     * Optimized FP16 to FP32 conversion using integer arithmetic.
     */
    export function fp16ToF32Fast(fp16: number): number {
      const sign = (fp16 >> 15) & 0x1;
      const exponent = (fp16 >> 10) & 0x1f;
      const mantissa = fp16 & 0x3ff;
      
      if (exponent === 0x1f) {
        // Infinity or NaN
        if (mantissa === 0) {
          return sign === 0 ? Infinity : -Infinity;
        }
        return NaN;
      }
      
      let exp32: number;
      let mant32: number;
      
      if (exponent === 0) {
        // Denormal or zero
        if (mantissa === 0) {
          return sign === 0 ? 0 : -0;
        }
        exp32 = 1 - 15; // exponent bias adjustment
        mant32 = mantissa << 13;
      } else {
        // Normal number
        exp32 = exponent - 15;
        mant32 = (mantissa | 0x400) << 13; // add implicit leading 1
      }
      
      // Convert to FP32 bias (127)
      exp32 += 127;
      
      // Combine bits
      const bits = (sign << 31) | ((exp32 & 0xff) << 23) | (mant32 & 0x7fffff);
      const buf = new ArrayBuffer(4);
      const view = new Uint32Array(buf);
      view[0] = bits;
      const f32 = new Float32Array(buf);
      return f32[0];
    }