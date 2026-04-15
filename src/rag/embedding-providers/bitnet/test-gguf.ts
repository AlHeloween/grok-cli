import { GGUF } from './gguf.js';

async function main() {
  const gguf = await GGUF.open('data/bitnet-model.gguf');
  console.log('KV entries:', gguf.kv.size);
  for (const [key, value] of gguf.kv) {
    console.log(`  ${key}: ${value}`);
  }
  console.log('Tensors:', gguf.tensors.size);
  for (const [name, info] of gguf.tensors) {
    console.log(`  ${name}: dims=${info.dims}, type=${info.ggmlType}, off=${info.dataOff}`);
  }
  await gguf.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
