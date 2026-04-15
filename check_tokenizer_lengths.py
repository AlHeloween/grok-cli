import sys

sys.path.insert(0, "llama.orig/evaluation/bitnet_purepy")
from gguf import GGUF
import mmap
import struct


def main():
    gguf = GGUF("data/bitnet-model.gguf")

    # Find tokenizer vocab
    vocab = None
    for key, val in gguf.kv.items():
        if key == "tokenizer.ggml.vocab":
            vocab = val
            break

    if vocab is None:
        print("No tokenizer.ggml.vocab found in KV")
        return

    print(f"Tokenizer vocab length: {len(vocab)}")
    print("First 5 items:", vocab[:5])
    print("Last 5 items:", vocab[-5:])

    # Now manually parse file to get exact lengths
    with open("data/bitnet-model.gguf", "rb") as f:
        mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
        off = 0
        magic = struct.unpack_from("=I", mm, off)[0]
        off += 4
        version = struct.unpack_from("=I", mm, off)[0]
        off += 4
        n_tensors = struct.unpack_from("=Q", mm, off)[0]
        off += 8
        n_kv = struct.unpack_from("=Q", mm, off)[0]
        off += 8

        print(
            f"\nHeader: magic={magic:08x}, version={version}, n_kv={n_kv}, n_tensors={n_tensors}"
        )

        # Skip to tokenizer vocab
        for i in range(n_kv):
            key_len = struct.unpack_from("=Q", mm, off)[0]
            off += 8
            key = mm[off : off + key_len].decode("utf-8")
            off += key_len
            vtype = struct.unpack_from("=I", mm, off)[0]
            off += 4

            if key == "tokenizer.ggml.vocab":
                print(f"\nFound 'tokenizer.ggml.vocab' at offset {off - 4}")
                print(f"Value type: {vtype} (ARRAY=9)")

                elem_type = struct.unpack_from("=I", mm, off)[0]
                off += 4
                n = struct.unpack_from("=Q", mm, off)[0]
                off += 8
                print(f"Element type: {elem_type} (STRING=8)")
                print(f"Number of strings: {n}")

                # Read lengths and strings
                lengths = []
                strings = []
                for j in range(min(20, n)):  # First 20 only
                    length = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    lengths.append(length)
                    string = mm[off : off + length].decode("utf-8")
                    off += length
                    strings.append(string)

                print("\nFirst 20 string lengths and strings:")
                for j, (l, s) in enumerate(zip(lengths, strings)):
                    print(f"  [{j}] length={l}: {repr(s)}")

                # Continue to sum total bytes
                total_bytes = sum(lengths)
                for j in range(20, n):
                    length = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    total_bytes += length
                    off += length

                print(f"\nTotal bytes for {n} strings: {total_bytes}")
                print(f"Offset after array: {off}")
                break
            else:
                # Skip value
                if vtype in (0, 1, 7):
                    off += 1
                elif vtype in (2, 3):
                    off += 2
                elif vtype in (4, 5, 6):
                    off += 4
                elif vtype in (10, 11, 12):
                    off += 8
                elif vtype == 8:  # STRING
                    s_len = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    off += s_len
                elif vtype == 9:  # ARRAY
                    elem_type = struct.unpack_from("=I", mm, off)[0]
                    off += 4
                    arr_n = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    if elem_type == 8:  # STRING
                        for _ in range(arr_n):
                            s_len = struct.unpack_from("=Q", mm, off)[0]
                            off += 8
                            off += s_len
                    else:
                        dt_sizes = {
                            0: 1,
                            1: 1,
                            2: 2,
                            3: 2,
                            4: 4,
                            5: 4,
                            6: 4,
                            7: 1,
                            10: 8,
                            11: 8,
                            12: 8,
                        }
                        off += arr_n * dt_sizes[elem_type]

        mm.close()

    gguf.close()


if __name__ == "__main__":
    main()
