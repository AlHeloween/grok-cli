import { GGUF } from './gguf.js';

async function main() {
  const gguf = await GGUF.open('data/bitnet-model.gguf');
  console.log('KV entries:', gguf.kv.size);
  let count = 0;
  for (const [key, value] of gguf.kv) {
    console.log(`  ${key}: ${value}`);
    if (++count >= 5) break;
  }
  console.log('Tensor count:', gguf.tensors.size);
  let tensorCount = 0;
  for (const [name, info] of gguf.tensors) {
    console.log(`  ${name}: dims=${info.dims}, type=${info.ggmlType}, off=${info.dataOff}`);
    if (++tensorCount >= 5) break;
  }
  await gguf.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});