const fs = require('fs');

const fd = fs.openSync('data/bitnet-model.gguf', 'r');
const buf = Buffer.alloc(24);
fs.readSync(fd, buf, 0, 24, 0);
console.log('First 24 bytes:', buf.toString('hex'));
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const nTensors = buf.readBigUInt64LE(8);
const nKv = buf.readBigUInt64LE(16);
console.log(`magic=0x${magic.toString(16)} version=${version} nTensors=${nTensors} nKv=${nKv}`);
fs.closeSync(fd);