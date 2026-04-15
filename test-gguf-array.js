const fs = require('fs');

const fd = fs.openSync('data/bitnet-model.gguf', 'r');
const buf = Buffer.alloc(1024 * 1024); // 1 MB
fs.readSync(fd, buf, 0, buf.length, 0);
console.log('First 100 bytes:');
for (let i = 0; i < 100; i += 16) {
  let line = i.toString(16).padStart(4, '0') + ': ';
  for (let j = 0; j < 16; j++) {
    if (i + j < 100) {
      line += buf[i + j].toString(16).padStart(2, '0') + ' ';
    } else {
      line += '   ';
    }
  }
  line += ' ';
  for (let j = 0; j < 16; j++) {
    if (i + j < 100) {
      const b = buf[i + j];
      line += (b >= 32 && b < 127) ? String.fromCharCode(b) : '.';
    }
  }
  console.log(line);
}

// parse header
let off = 0;
const magic = buf.readUInt32LE(off); off += 4;
const version = buf.readUInt32LE(off); off += 4;
const nTensors = Number(buf.readBigUInt64LE(off)); off += 8;
const nKv = Number(buf.readBigUInt64LE(off)); off += 8;
console.log(`magic=0x${magic.toString(16)} version=${version} nTensors=${nTensors} nKv=${nKv}`);

// skip KV pairs
for (let i = 0; i < nKv; i++) {
  const lenKey = Number(buf.readBigUInt64LE(off)); off += 8;
  off += lenKey;
  const vtype = buf.readUInt32LE(off); off += 4;
  // skip value
  switch (vtype) {
    case 0: case 1: case 7: off += 1; break;
    case 2: case 3: off += 2; break;
    case 4: case 5: case 6: off += 4; break;
    case 8: {
      const len = Number(buf.readBigUInt64LE(off)); off += 8 + len;
      break;
    }
    case 9: {
      const elemType = buf.readUInt32LE(off); off += 4;
      const n = Number(buf.readBigUInt64LE(off)); off += 8;
      if (elemType === 8) { // string array
        console.log(`String array at off=${off}, n=${n}`);
        // read first 5 lengths
        for (let j = 0; j < Math.min(5, n); j++) {
          const len = Number(buf.readBigUInt64LE(off + j * 8));
          console.log(`  length[${j}]=${len}`);
        }
        // skip the rest
        off += n * 8;
        let totalBytes = 0;
        for (let j = 0; j < n; j++) {
          const len = Number(buf.readBigUInt64LE(off - n*8 + j*8));
          totalBytes += len;
        }
        off += totalBytes;
        console.log(`  totalBytes=${totalBytes}, new off=${off}`);
        break;
      }
      // other array types
      const sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8};
      off += n * (sizes[elemType] || 1);
      break;
    }
    case 10: case 11: case 12: off += 8; break;
    default: throw new Error(`unknown vtype ${vtype}`);
  }
}
console.log(`After KV parsing: off=${off}`);

// now read tensor infos
for (let i = 0; i < nTensors; i++) {
  const lenName = Number(buf.readBigUInt64LE(off)); off += 8;
  off += lenName;
  const nDims = buf.readUInt32LE(off); off += 4;
  for (let j = 0; j < nDims; j++) {
    off += 8;
  }
  off += 4; // ggml_type
  off += 8; // rel_off
}
console.log(`After tensor infos: off=${off}`);
fs.closeSync(fd);