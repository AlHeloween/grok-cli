import * as fs from 'fs';
import { promisify } from 'util';

const open = promisify(fs.open);
const read = promisify(fs.read);
const close = promisify(fs.close);

const GGUF_MAGIC = 0x46554747; // 'GGUF'

enum GGMLType {
  F32 = 0,
  F16 = 1,
  I2_S = 36,
}

enum GGUFValueType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

const DEFAULT_KV_INTEREST = new Set([
  'general.alignment',
  'general.architecture',
  'bitnet-b1.58.embedding_length',
  'bitnet-b1.58.attention.head_count',
  'bitnet-b1.58.attention.head_count_kv',
  'bitnet-b1.58.rope.dimension_count',
  'bitnet-b1.58.rope.freq_base',
  'bitnet-b1.58.rope.freq_scale',
  'bitnet-b1.58.rope.ext_factor',
  'bitnet-b1.58.rope.attn_factor',
  'bitnet-b1.58.rope.beta_fast',
  'bitnet-b1.58.rope.beta_slow',
  'bitnet-b1.58.attention.layer_norm_rms_epsilon',
  'bitnet-b1.58.context_length',
  'tokenizer.ggml.model',
  'tokenizer.ggml.tokens',
  'tokenizer.ggml.scores',
  'tokenizer.ggml.token_type',
  'tokenizer.ggml.merges',
  'tokenizer.ggml.bos_token_id',
  'tokenizer.ggml.eos_token_id',
  'tokenizer.ggml.padding_token_id',
  'tokenizer.ggml.add_bos_token',
]);

interface TensorInfo {
  dims: number[];
  ggmlType: GGMLType;
  dataOff: number; // offset from start of file
}

/**
 * Minimal GGUF reader focused on BitNet models.
 * Only reads metadata and tensor information needed for embedding extraction.
 */
export class GGUF {
  private fd: number;
  private alignment: number = 32;
  private dataStart: number = 0;
  public kv: Map<string, any> = new Map();
  public tensors: Map<string, TensorInfo> = new Map();

  private constructor(fd: number) {
    this.fd = fd;
  }

  static async open(path: string): Promise<GGUF> {
    const fd = await open(path, 'r');
    const gguf = new GGUF(fd);
    await gguf.parse();
    return gguf;
  }

  async close(): Promise<void> {
    await close(this.fd);
  }

  private async readUint32(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(4);
    await read(this.fd, buf, 0, 4, off);
    return { value: buf.readUInt32LE(0), nextOff: off + 4 };
  }

  private async readUint64(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(8);
    await read(this.fd, buf, 0, 8, off);
    // JavaScript numbers are safe up to 2^53 - 1; assume GGUF sizes fit.
    const value = Number(buf.readBigUInt64LE(0));
    return { value, nextOff: off + 8 };
  }

  private async readInt32(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(4);
    await read(this.fd, buf, 0, 4, off);
    return { value: buf.readInt32LE(0), nextOff: off + 4 };
  }

  private async readInt64(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(8);
    await read(this.fd, buf, 0, 8, off);
    const value = Number(buf.readBigInt64LE(0));
    return { value, nextOff: off + 8 };
  }

  private async readFloat32(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(4);
    await read(this.fd, buf, 0, 4, off);
    return { value: buf.readFloatLE(0), nextOff: off + 4 };
  }

  private async readFloat64(off: number): Promise<{ value: number; nextOff: number }> {
    const buf = Buffer.alloc(8);
    await read(this.fd, buf, 0, 8, off);
    return { value: buf.readDoubleLE(0), nextOff: off + 8 };
  }

  private async readString(off: number): Promise<{ value: string; nextOff: number }> {
    const { value: len, nextOff: off1 } = await this.readUint64(off);
    const buf = Buffer.alloc(len);
    await read(this.fd, buf, 0, len, off1);
    return { value: buf.toString('utf-8'), nextOff: off1 + len };
  }

  private async skipString(off: number): Promise<number> {
    const { value: len, nextOff: off1 } = await this.readUint64(off);
    return off1 + len;
  }

  private async skipValue(off: number, vtype: GGUFValueType): Promise<number> {
    switch (vtype) {
      case GGUFValueType.UINT8:
      case GGUFValueType.INT8:
      case GGUFValueType.BOOL:
        return off + 1;
      case GGUFValueType.UINT16:
      case GGUFValueType.INT16:
        return off + 2;
      case GGUFValueType.UINT32:
      case GGUFValueType.INT32:
      case GGUFValueType.FLOAT32:
        return off + 4;
      case GGUFValueType.UINT64:
      case GGUFValueType.INT64:
      case GGUFValueType.FLOAT64:
        return off + 8;
      case GGUFValueType.STRING: {
        return await this.skipString(off);
      }
            case GGUFValueType.ARRAY: {
  let { value: elemType, nextOff: off1 } = await this.readUint32(off);
  let { value: n, nextOff: off2 } = await this.readUint64(off1);
  console.log(`skipValue ARRAY: elemType=${elemType}, n=${n}, off2=${off2}`);
  if (elemType === GGUFValueType.STRING) {
    console.log(`skipValue ARRAY STRING: skipping ${n} strings`);
    for (let i = 0; i < n; ++i) {
      if (i % 10000 === 0) console.log(`skipValue ARRAY STRING: progress ${i}/${n}`);
      off2 = await this.skipString(off2);
    }
    console.log(`skipValue ARRAY STRING: done, off2=${off2}`);
    return off2;
  }
  const elemSizes: Record<number, number> = {
    [GGUFValueType.UINT8]: 1,
    [GGUFValueType.INT8]: 1,
    [GGUFValueType.UINT16]: 2,
    [GGUFValueType.INT16]: 2,
    [GGUFValueType.UINT32]: 4,
    [GGUFValueType.INT32]: 4,
    [GGUFValueType.FLOAT32]: 4,
    [GGUFValueType.BOOL]: 1,
    [GGUFValueType.UINT64]: 8,
    [GGUFValueType.INT64]: 8,
    [GGUFValueType.FLOAT64]: 8,
  };
  if (!(elemType in elemSizes)) {
    throw new Error(`Unsupported GGUF array elem_type: ${elemType}`);
  }
  return off2 + n * elemSizes[elemType];
}
      default:
        throw new Error(`Unsupported GGUF value type: ${vtype}`);
    }
  }

  private async readValue(off: number, vtype: GGUFValueType): Promise<{ value: any; nextOff: number }> {
    switch (vtype) {
      case GGUFValueType.UINT8: {
        const buf = Buffer.alloc(1);
        await read(this.fd, buf, 0, 1, off);
        return { value: buf.readUInt8(0), nextOff: off + 1 };
      }
      case GGUFValueType.INT8: {
        const buf = Buffer.alloc(1);
        await read(this.fd, buf, 0, 1, off);
        return { value: buf.readInt8(0), nextOff: off + 1 };
      }
      case GGUFValueType.UINT16: {
        const buf = Buffer.alloc(2);
        await read(this.fd, buf, 0, 2, off);
        return { value: buf.readUInt16LE(0), nextOff: off + 2 };
      }
      case GGUFValueType.INT16: {
        const buf = Buffer.alloc(2);
        await read(this.fd, buf, 0, 2, off);
        return { value: buf.readInt16LE(0), nextOff: off + 2 };
      }
      case GGUFValueType.UINT32:
        return this.readUint32(off);
      case GGUFValueType.INT32:
        return this.readInt32(off);
      case GGUFValueType.FLOAT32:
        return this.readFloat32(off);
      case GGUFValueType.BOOL: {
        const buf = Buffer.alloc(1);
        await read(this.fd, buf, 0, 1, off);
        return { value: buf.readUInt8(0) !== 0, nextOff: off + 1 };
      }
      case GGUFValueType.STRING:
        return this.readString(off);
      case GGUFValueType.UINT64:
        return this.readUint64(off);
      case GGUFValueType.INT64:
        return this.readInt64(off);
      case GGUFValueType.FLOAT64:
        return this.readFloat64(off);
      case GGUFValueType.ARRAY: {
        let { value: elemType, nextOff: off1 } = await this.readUint32(off);
        let { value: n, nextOff: off2 } = await this.readUint64(off1);
        if (elemType === GGUFValueType.STRING) {
          const arr: string[] = [];
          for (let i = 0; i < n; ++i) {
            const { value, nextOff } = await this.readString(off2);
            arr.push(value);
            off2 = nextOff;
          }
          return { value: arr, nextOff: off2 };
        }
        // numeric array: read whole block
        const elemSizes: Record<number, number> = {
          [GGUFValueType.UINT8]: 1,
          [GGUFValueType.INT8]: 1,
          [GGUFValueType.UINT16]: 2,
          [GGUFValueType.INT16]: 2,
          [GGUFValueType.UINT32]: 4,
          [GGUFValueType.INT32]: 4,
          [GGUFValueType.FLOAT32]: 4,
          [GGUFValueType.BOOL]: 1,
          [GGUFValueType.UINT64]: 8,
          [GGUFValueType.INT64]: 8,
          [GGUFValueType.FLOAT64]: 8,
        };
        if (!(elemType in elemSizes)) {
          throw new Error(`Unsupported GGUF array elem_type: ${elemType}`);
        }
        const elemSize = elemSizes[elemType];
        const buf = Buffer.alloc(n * elemSize);
        await read(this.fd, buf, 0, buf.length, off2);
        // Convert buffer to appropriate typed array
        let value: any;
        switch (elemType) {
          case GGUFValueType.UINT8:
            value = new Uint8Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.INT8:
            value = new Int8Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.UINT16:
            value = new Uint16Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.INT16:
            value = new Int16Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.UINT32:
            value = new Uint32Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.INT32:
            value = new Int32Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.FLOAT32:
            value = new Float32Array(buf.buffer, buf.byteOffset, n);
            break;
          case GGUFValueType.BOOL:
            value = Array.from(new Uint8Array(buf.buffer, buf.byteOffset, n), (v) => v !== 0);
            break;
          case GGUFValueType.UINT64:
          case GGUFValueType.INT64:
          case GGUFValueType.FLOAT64:
            // keep as Buffer for now
            value = buf;
            break;
        }
        return { value, nextOff: off2 + buf.length };
      }
      default:
        throw new Error(`Unsupported GGUF value type: ${vtype}`);
    }
  }

  private async parse(): Promise<void> {
    let off = 0;
    console.log('GGUF parse start');
    const { value: magic, nextOff: off1 } = await this.readUint32(off);
    if (magic !== GGUF_MAGIC) {
      throw new Error('GGUF magic invalid');
    }
    const { value: version, nextOff: off2 } = await this.readUint32(off1);
    if (version !== 2 && version !== 3) {
      throw new Error(`Unsupported GGUF version: ${version}`);
    }
    const { value: nTensors, nextOff: off3 } = await this.readUint64(off2);
    const { value: nKv, nextOff: off4 } = await this.readUint64(off3);
    console.log(`GGUF parse: nKv=${nKv}, nTensors=${nTensors}, off=${off}`);

    // key-value pairs
    off = off4;
    for (let i = 0; i < nKv; ++i) {
      console.log(`KV ${i}: reading key at off=${off}`);
      const { value: key, nextOff: off5 } = await this.readString(off);
      off = off5;
      const { value: vtype, nextOff: off6 } = await this.readUint32(off);
      off = off6;
      console.log(`KV ${i}: key='${key}', vtype=${vtype}, off=${off}`);
      if (!DEFAULT_KV_INTEREST.has(key)) {
        console.log(`KV ${i}: skipping (not interested)`);
        off = await this.skipValue(off, vtype);
        console.log(`KV ${i}: after skip off=${off}`);
        continue;
      }
      console.log(`KV ${i}: reading value`);
      const { value, nextOff } = await this.readValue(off, vtype);
      off = nextOff;
      if (key === 'general.alignment') {
        this.alignment = Number(value);
      }
      this.kv.set(key, value);
      console.log(`KV ${i}: stored`);
    }

    // tensor infos
    const tensorInfos: Array<{ name: string; dims: number[]; ggmlType: number; relOff: number }> = [];
    for (let i = 0; i < nTensors; ++i) {
      const { value: name, nextOff: off7 } = await this.readString(off);
      off = off7;
      const { value: nDims, nextOff: off8 } = await this.readUint32(off);
      off = off8;
      const dims: number[] = [];
      for (let j = 0; j < nDims; ++j) {
        const { value: dim, nextOff: off9 } = await this.readUint64(off);
        off = off9;
        dims.push(dim);
      }
      const { value: ggmlType, nextOff: off10 } = await this.readUint32(off);
      off = off10;
      const { value: relOff, nextOff: off11 } = await this.readUint64(off);
      off = off11;
      tensorInfos.push({ name, dims, ggmlType, relOff });
    }

    // align to alignment
    this.dataStart = Math.ceil(off / this.alignment) * this.alignment;

    for (const { name, dims, ggmlType, relOff } of tensorInfos) {
      this.tensors.set(name, {
        dims,
        ggmlType,
        dataOff: this.dataStart + relOff,
      });
    }
  }

  /** Read a 1D float32 tensor */
  async readF32_1D(name: string): Promise<Float32Array> {
    const info = this.tensors.get(name);
    if (!info) throw new Error(`Missing tensor: ${name}`);
    if (info.dims.length !== 1) throw new Error(`${name}: expected 1D, got dims=${info.dims}`);
    if (info.ggmlType !== GGMLType.F32) throw new Error(`${name}: expected F32`);
    const buf = Buffer.alloc(info.dims[0] * 4);
    await read(this.fd, buf, 0, buf.length, info.dataOff);
    return new Float32Array(buf.buffer, buf.byteOffset, info.dims[0]);
  }

  /** Read a single column from a 2D float16 tensor as float32 */
  async readF16ColAsF32(name: string, col: number): Promise<Float32Array> {
    const info = this.tensors.get(name);
    if (!info) throw new Error(`Missing tensor: ${name}`);
    if (info.dims.length !== 2) throw new Error(`${name}: expected 2D, got dims=${info.dims}`);
    if (info.ggmlType !== GGMLType.F16) throw new Error(`${name}: expected F16`);
    const [ne0, ne1] = info.dims;
    if (col < 0 || col >= ne1) throw new Error(`${name}: col out of range: ${col} (ne1=${ne1})`);
    const off = info.dataOff + col * ne0 * 2;
    const buf = Buffer.alloc(ne0 * 2);
    await read(this.fd, buf, 0, buf.length, off);
    // Convert float16 to float32 (simple implementation, assumes little‑endian)
    const f32 = new Float32Array(ne0);
    for (let i = 0; i < ne0; ++i) {
      const u16 = buf.readUInt16LE(i * 2);
      f32[i] = float16ToFloat32(u16);
    }
    return f32;
  }

  /** Read i2_s packed weight tensor */
  async readI2SPacked(name: string): Promise<{ packed: Uint8Array; k: number; m: number; wScale: number }> {
    const info = this.tensors.get(name);
    if (!info) throw new Error(`Missing tensor: ${name}`);
    if (info.dims.length !== 2) throw new Error(`${name}: expected 2D, got dims=${info.dims}`);
    if (info.ggmlType !== GGMLType.I2_S) throw new Error(`${name}: expected I2_S`);
    const [k, m] = info.dims;
    if ((k * m) % 4 !== 0) throw new Error(`${name}: nelements not divisible by 4`);
    const dataBytes = (k * m) / 4;
    const total = dataBytes + 32; // as in Python
    const buf = Buffer.alloc(total);
    await read(this.fd, buf, 0, total, info.dataOff);
    const packed = new Uint8Array(buf.buffer, buf.byteOffset, dataBytes);
    const wScale = buf.readFloatLE(dataBytes);
    return { packed, k, m, wScale };
  }
}

// Simple float16 to float32 conversion (no support for infinities/NaN)
function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  if (exponent === 0) {
    // subnormal
    return (sign ? -1 : 1) * fraction * 2 ** -24;
  } else if (exponent === 0x1f) {
    // infinity or NaN
    return fraction ? NaN : (sign ? -Infinity : Infinity);
  }
  const exp = exponent - 15 + 127;
  const bits = (sign << 31) | (exp << 23) | (fraction << 13);
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, bits, false);
  return view.getFloat32(0, false);
}

// ADID_ROLLBACK (from adm.exe)
// SDID_ROLLBACK {
//   "target_file": "D:\\zPython\\grok-cli\\src/rag/embedding-providers/bitnet/gguf.ts"
//   "update_script": "adm.exe"
//   "backup_path": "D:\\zPython\\grok-cli\\src/rag/embedding-providers/bitnet/gguf.ts.backup_20260308T064742_201214"
//   "created_at": "2026-03-07T22:47:42.216725+00:00"
//   "backup_hash": "176dd4190045f47e54f3687fbbd7cf07"
//   "new_hash": "ebfc16e8d9728336dae43b3adccf7725"
//   "goal_id": "fix_gguf_array_simple"
//   "semantics": "Replace batch logic with simple loop for string array skipping"
//   "update_attrs": {"relative_path": "src/rag/embedding-providers/bitnet/gguf.ts", "update_type": "text", "mode": "replace", "encoding": "utf-8", "find_pattern": null, "find_text": "case GGUFValueType.ARRAY: {\n  let { value: elemType, nextOff: off1 } = await this.readUint32(off);\n  let { value: n, nextOff: off2 } = await this.readUint64(off1);\n  console.log(`skipValue ARRAY: elemType=${elemType}, n=${n}, off2=${off2}`);\n  if (elemType === GGUFValueType.STRING) {\n    console.log(`skipValue ARRAY STRING: skipping ${n} strings`);\n    if (n > 1000) {\n      // batch read all length fields\n      const totalLengths = n * 8;\n      console.log(`skipValue ARRAY STRING: totalLengths=${totalLengths}, off2=${off2}`);\n      const buf = Buffer.alloc(totalLengths);\n      await read(this.fd, buf, 0, totalLengths, off2);\n      // Debug first 16 bytes\n      console.log(`  first 16 bytes hex: ${buf.slice(0, 16).toString('hex')}`);\n      let totalBytes = 0n;\n      // log first few lengths using both methods\n      for (let i = 0; i < Math.min(5, n); ++i) {\n        const len = buf.readBigUInt64LE(i * 8);\n        console.log(`  length[${i}]=${len} (0x${len.toString(16)})`);\n        totalBytes += len;\n      }\n      // sum remaining\n      for (let i = 5; i < n; ++i) {\n        totalBytes += buf.readBigUInt64LE(i * 8);\n      }\n      console.log(`skipValue ARRAY STRING: totalBytes=${totalBytes}, totalLengths=${totalLengths}`);\n      const newOff = off2 + totalLengths + Number(totalBytes);\n      console.log(`skipValue ARRAY STRING: batch skipped, newOff=${newOff}`);\n      return newOff;\n    } else {\n      for (let i = 0; i < n; ++i) {\n        if (i % 10000 === 0) console.log(`skipValue ARRAY STRING: progress ${i}/${n}`);\n        off2 = await this.skipString(off2);\n      }\n      console.log(`skipValue ARRAY STRING: done, off2=${off2}`);\n      return off2;\n    }\n  }\n  const elemSizes: Record<number, number> = {\n    [GGUFValueType.UINT8]: 1,\n    [GGUFValueType.INT8]: 1,\n    [GGUFValueType.UINT16]: 2,\n    [GGUFValueType.INT16]: 2,\n    [GGUFValueType.UINT32]: 4,\n    [GGUFValueType.INT32]: 4,\n    [GGUFValueType.FLOAT32]: 4,\n    [GGUFValueType.BOOL]: 1,\n    [GGUFValueType.UINT64]: 8,\n    [GGUFValueType.INT64]: 8,\n    [GGUFValueType.FLOAT64]: 8,\n  };\n  if (!(elemType in elemSizes)) {\n    throw new Error(`Unsupported GGUF array elem_type: ${elemType}`);\n  }\n  return off2 + n * elemSizes[elemType];\n}", "replace_present": true}
//   "restore_cmd": "uv run adm --rollback \"D:\\zPython\\grok-cli\\src/rag/embedding-providers/bitnet/gguf.ts\""
// }
