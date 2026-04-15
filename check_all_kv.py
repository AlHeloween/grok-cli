import sys

sys.path.insert(0, "llama.orig/evaluation/bitnet_purepy")
from gguf import GGUF


def main():
    # Create GGUF with no filter (pass empty set)
    gguf = GGUF("data/bitnet-model.gguf", kv_interest=[])

    print(f"Total KV entries: {len(gguf.kv)}")
    for key, val in gguf.kv.items():
        if isinstance(val, list):
            print(f"{key}: list length {len(val)}")
            if len(val) > 0:
                print(f"  First item: {repr(val[0])}")
                print(f"  Last item: {repr(val[-1])}")
        else:
            print(f"{key}: {val}")

    gguf.close()


if __name__ == "__main__":
    main()
