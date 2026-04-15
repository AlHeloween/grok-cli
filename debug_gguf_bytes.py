import struct

with open('data/bitnet-model.gguf', 'rb') as f:
    data = f.read(200)
    for i in range(0, len(data), 16):
        line = f'{i:04x}: '
        for j in range(16):
            if i + j < len(data):
                line += f'{data[i + j]:02x} '
            else:
                line += '   '
        line += ' '
        for j in range(16):
            if i + j < len(data):
                b = data[i + j]
                if 32 <= b < 127:
                    line += chr(b)
                else:
                    line += '.'
        print(line)
    
    # parse header
    f.seek(0)
    magic = struct.unpack('<I', f.read(4))[0]
    version = struct.unpack('<I', f.read(4))[0]
    n_tensors = struct.unpack('<Q', f.read(8))[0]
    n_kv = struct.unpack('<Q', f.read(8))[0]
    print(f'magic=0x{magic:x} version={version} n_tensors={n_tensors} n_kv={n_kv}')
    off = 24
    for i in range(n_kv):
        f.seek(off)
        len_key = struct.unpack('<Q', f.read(8))[0]
        off += 8
        key = f.read(len_key).decode('utf-8')
        off += len_key
        vtype = struct.unpack('<I', f.read(4))[0]
        off += 4
        print(f'KV {i}: key="{key}" vtype={vtype} at off={off-len_key-8-4}')
        # skip value
        if vtype == 0:  # uint8
            off += 1
        elif vtype == 1:  # int8
            off += 1
        elif vtype == 2:  # uint16
            off += 2
        elif vtype == 3:  # int16
            off += 2
        elif vtype == 4:  # uint32
            off += 4
        elif vtype == 5:  # int32
            off += 4
        elif vtype == 6:  # float32
            off += 4
        elif vtype == 7:  # bool
            off += 1
        elif vtype == 8:  # string
            len_str = struct.unpack('<Q', f.read(8))[0]
            off += 8 + len_str
        elif vtype == 9:  # array
            elem_type = struct.unpack('<I', f.read(4))[0]
            n = struct.unpack('<Q', f.read(8))[0]
            off += 12
            if elem_type == 8:  # string array
                for _ in range(n):
                    len_str = struct.unpack('<Q', f.read(8))[0]
                    off += 8 + len_str
            else:
                # numeric array element size
                sizes = {0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
                off += n * sizes.get(elem_type, 1)
        elif vtype == 10:  # uint64
            off += 8
        elif vtype == 11:  # int64
            off += 8
        elif vtype == 12:  # float64
            off += 8
        else:
            raise ValueError(f'unknown vtype {vtype}')
    print(f'After KV parsing: off={off}')
    # tensor infos
    for i in range(n_tensors):
        f.seek(off)
        len_name = struct.unpack('<Q', f.read(8))[0]
        off += 8
        name = f.read(len_name).decode('utf-8')
        off += len_name
        n_dims = struct.unpack('<I', f.read(4))[0]
        off += 4
        dims = []
        for _ in range(n_dims):
            dim = struct.unpack('<Q', f.read(8))[0]
            dims.append(dim)
            off += 8
        ggml_type = struct.unpack('<I', f.read(4))[0]
        off += 4
        tensor_off = struct.unpack('<Q', f.read(8))[0]
        off += 8
        print(f'Tensor {i}: name="{name}" dims={dims} type={ggml_type} rel_off={tensor_off}')
    alignment = 32
    data_start = (off + alignment - 1) // alignment * alignment
    print(f'Expected data start: {data_start} (aligned from {off})')