import sys
sys.path.insert(0, 'llama.orig/evaluation/bitnet_purepy')
from gguf import GGUF

gguf = GGUF('data/bitnet-model.gguf')
print('Alignment:', gguf.alignment)
print('KV count:', len(gguf.kv))
for k, v in gguf.kv.items():
    if isinstance(v, (int, float, str, bool)):
        print(f'  {k}: {v}')
    else:
        print(f'  {k}: type {type(v).__name__}')
print('Tensor count:', len(gguf.tensors))
for name, info in gguf.tensors.items():
    print(f'  {name}: dims={info["dims"]}, type={info["ggml_type"]}, off={info["data_off"]}')
gguf.close()