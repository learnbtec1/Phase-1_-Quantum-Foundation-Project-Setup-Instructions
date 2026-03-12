import struct, json, math
path = r'e:/Phase 1_ Quantum Foundation Project Setup Instructions/frontend/public/assets/3d_tv_white_cabinet_with_decoration.glb'
with open(path,'rb') as f:
    buf = f.read()
print('size KB:', len(buf)//1024)
chunk_len = struct.unpack_from('<I', buf, 12)[0]
data = json.loads(buf[20:20+chunk_len].decode('utf-8'))
print('meshes:', len(data.get('meshes',[])))
print('nodes:', len(data.get('nodes',[])))

# Overall bounds from all VEC3 POSITION accessors
gmin = [math.inf,math.inf,math.inf]
gmax = [-math.inf,-math.inf,-math.inf]
for a in data.get('accessors',[]):
    if a.get('type')=='VEC3' and a.get('min') and a.get('max'):
        for i in range(3):
            gmin[i] = min(gmin[i], a['min'][i])
            gmax[i] = max(gmax[i], a['max'][i])
size = [gmax[i]-gmin[i] for i in range(3)]
print(f'Overall bounds: min={[round(v,3) for v in gmin]} max={[round(v,3) for v in gmax]}')
print(f'Overall size W={size[0]:.3f} H={size[1]:.3f} D={size[2]:.3f}')
for i,n in enumerate(data.get('nodes',[])[:6]):
    print(f'  node{i}: name={n.get("name")} t={n.get("translation")} s={n.get("scale")}')
print('Materials:', [m.get('name') for m in data.get('materials',[])])
