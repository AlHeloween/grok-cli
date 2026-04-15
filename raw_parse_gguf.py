import mmap
import struct


def skip_value(mm, off, vtype):
    if vtype in (0, 1, 7):  # UINT8, INT8, BOOL
        return off + 1
    elif vtype in (2, 3):  # UINT16, INT16
        return off + 2
    elif vtype in (4, 5, 6):  # UINT32, INT32, FLOAT32
        return off + 4
    elif vtype in (10, 11, 12):  # UINT64, INT64, FLOAT64
        return off + 8
    elif vtype == 8:  # STRING
        s_len = struct.unpack_from("=Q", mm, off)[0]
        return off + 8 + s_len
    elif vtype == 9:  # ARRAY
        elem_type = struct.unpack_from("=I", mm, off)[0]
        off += 4
        n = struct.unpack_from("=Q", mm, off)[0]
        off += 8
        if elem_type == 8:  # STRING
            for _ in range(n):
                s_len = struct.unpack_from("=Q", mm, off)[0]
                off += 8
                off += s_len
            return off
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
            return off + n * dt_sizes[elem_type]
    else:
        raise ValueError(f"Unknown vtype {vtype}")


def read_string(mm, off):
    length = struct.unpack_from("=Q", mm, off)[0]
    s = mm[off + 8 : off + 8 + length].decode("utf-8")
    return s, off + 8 + length


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

        print(f"Magic: 0x{magic:08x}, version: {version}")
        print(f"n_kv: {n_kv}, n_tensors: {n_tensors}")

        # Read all KV
        for i in range(n_kv):
            key, off = read_string(mm, off)
            vtype = struct.unpack_from("=I", mm, off)[0]
            off += 4

            print(f"\n[{i}] Key: {key}")
            print(f"  Type: {vtype}")

            # Skip value but maybe print if interesting
            if key.startswith("tokenizer"):
                # Read value
                if vtype == 8:
                    s, off = read_string(mm, off)
                    print(f"  Value (string): {s}")
                elif vtype == 9:
                    elem_type = struct.unpack_from("=I", mm, off)[0]
                    off += 4
                    n = struct.unpack_from("=Q", mm, off)[0]
                    off += 8
                    print(f"  Array element type: {elem_type}, count: {n}")
                    if elem_type == 8:
                        for j in range(min(5, n)):
                            s_len = struct.unpack_from("=Q", mm, off)[0]
                            off += 8
                            s = mm[off : off + s_len].decode("utf-8")
                            off += s_len
                            print(f"    [{j}] len={s_len}: {repr(s)}")
                        # Skip rest
                        for j in range(5, n):
                            s_len = struct.unpack_from("=Q", mm, off)[0]
                            off += 8
                            off += s_len
                    else:
                        # numeric
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
                        off += n * dt_sizes[elem_type]
                else:
                    off = skip_value(mm, off, vtype)
            else:
                off = skip_value(mm, off, vtype)

        print(f"\nOffset after KV: {off}")

        # Read tensor infos
        tensor_infos = []
        for i in range(n_tensors):
            name, off = read_string(mm, off)
            n_dims = struct.unpack_from("=I", mm, off)[0]
            off += 4
            dims = []
            for _ in range(n_dims):
                dim = struct.unpack_from("=Q", mm, off)[0]
                off += 8
                dims.append(dim)
            ggml_type = struct.unpack_from("=I", mm, off)[0]
            off += 4
            rel_off = struct.unpack_from("=Q", mm, off)[0]
            off += 8
            tensor_infos.append((name, dims, ggml_type, rel_off))

        print(f"\nFirst 5 tensors:")
        for i, (name, dims, ggml_type, rel_off) in enumerate(tensor_infos[:5]):
            print(f"  {name}: dims={dims}, type={ggml_type}, rel_off={rel_off}")

        mm.close()


if __name__ == "__main__":
    main()
