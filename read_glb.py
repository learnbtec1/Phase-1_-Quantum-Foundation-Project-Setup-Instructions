import json, struct, os

path = r'e:\Phase 1_ Quantum Foundation Project Setup Instructions\frontend\public\assets\office.glb'
size = os.path.getsize(path)
print(f'File size: {size/1024/1024:.1f} MB')

with open(path, 'rb') as f:
    magic, ver, length = struct.unpack('<III', f.read(12))
    print(f'Magic: {magic:#010x}, Version: {ver}')
    chunk_len, chunk_type = struct.unpack('<II', f.read(8))
    json_bytes = f.read(chunk_len)
    gltf = json.loads(json_bytes)

meshes = gltf.get('meshes', [])
nodes  = gltf.get('nodes', [])
mats   = gltf.get('materials', [])

print(f'\nMeshes ({len(meshes)}):')
for m in meshes:
    print(f'  {m.get("name","unnamed")}')

print(f'\nMaterials ({len(mats)}):')
for mat in mats:
    pbr = mat.get('pbrMetallicRoughness', {})
    base = pbr.get('baseColorFactor', None)
    print(f'  {mat.get("name","unnamed")}  base={base}')

print(f'\nNodes with mesh ({len([n for n in nodes if "mesh" in n])}):')
for n in nodes:
    if 'mesh' in n:
        mesh_name = meshes[n['mesh']].get('name','unnamed') if n['mesh'] < len(meshes) else '?'
        print(f'  node: {n.get("name","unnamed")} -> mesh: {mesh_name}')
