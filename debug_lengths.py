import mmap
import struct


def main():
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

        # Skip to tokenizer.ggml.tokens
        for i in range(n_kv):
            key_len = struct.unpack_from("=Q", mm, off)[0]
            off += 8
            key = mm[off : off + key_len].decode("utf-8")
            off += key_len
            vtype = struct.unpack_from("=I", mm, off)[0]
            off += 4

            if key == "tokenizer.ggml.tokens":
                print(f"Found {key} at offset {off - 4}")
                elem_type = struct.unpack_from("=I", mm, off)[0]
                off += 4
                n = struct.unpack_from("=Q", mm, off)[0]
                off += 8
                print(f"elem_type={elem_type}, n={n}, data offset={off}")

                # Read first 10 lengths
                for j in range(10):
                    length = struct.unpack_from("=Q", mm, off)[0]
                    print(f"  length[{j}] = {length} (0x{length:x})")
                    # show raw bytes
                    raw = mm[off : off + 8]
                    print(f"    raw bytes: {raw.hex()}")
                    off += 8
                    # skip string content
                    off += length
                break
            else:
                # skip value
                if vtype in (0, 1, 7):
                    off += 1
                elif vtype in (2, 3):
                    off += 2
                elif vtype in (4, 5, 6):
                    off += 4
                elif vtype in (10, 11, 12):
                    off += 8
                elif vtype == 8:
                    s_len = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    off += s_len
                elif vtype == 9:
                    elem_type = struct.unpack_from("=I", mm, off)[0]
                    off += 4
                    arr_n = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    if elem_type == 8:
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


if __name__ == "__main__":
    main()
