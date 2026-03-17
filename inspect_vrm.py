import json, struct, os, sys

path = sys.argv[1] if len(sys.argv) > 1 else r'frontend/public/models/teach.vrm'
print(f'Inspecting: {path}')
print(f'File size: {os.path.getsize(path)/1024/1024:.1f} MB')

with open(path, 'rb') as f:
    magic, ver, length = struct.unpack('<III', f.read(12))
    print(f'Magic: {magic:#010x}, Version: {ver}')
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_bytes = f.read(chunk_len)
    gltf = json.loads(json_bytes)

# VRM 0.x blendShapeMaster
vrm0 = gltf.get('extensions', {}).get('VRM', {})
bsm = vrm0.get('blendShapeMaster', {})
groups = bsm.get('blendShapeGroups', [])
print(f'\n=== VRM 0.x blendShapeGroups ({len(groups)}) ===')
for g in groups:
    print(f'  presetName={g.get("presetName","?")}  name={g.get("name","?")}  binds={len(g.get("binds",[]))}')

# VRM 1.0 expressions
vrm1 = gltf.get('extensions', {}).get('VRMC_vrm', {})
exps = vrm1.get('expressions', {})
prst = exps.get('preset', {})
cust = exps.get('custom', {})
print(f'\n=== VRM 1.0 expressions ===')
print(f'  preset: {list(prst.keys())}')
print(f'  custom: {list(cust.keys())}')

# Also check mesh morph targets
meshes = gltf.get('meshes', [])
morph_meshes = [(m.get('name','?'), [t.get('name','?') for t in m.get('primitives', [{}])[0].get('targets', [])]) for m in meshes if m.get('primitives', [{}])[0].get('targets')]
print(f'\n=== Meshes with morph targets ({len(morph_meshes)}) ===')
for name, targets in morph_meshes[:20]:
    print(f'  {name}: {targets}')
