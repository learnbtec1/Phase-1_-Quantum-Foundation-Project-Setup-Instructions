import { readFileSync } from 'fs';

const path = 'frontend/public/assets/office.glb';
const buf = readFileSync(path);

const size = buf.length;
console.log(`File size: ${(size/1024/1024).toFixed(1)} MB`);

// GLB header: magic(4) version(4) length(4)
const magic = buf.readUInt32LE(0);
const ver   = buf.readUInt32LE(4);
console.log(`Magic: 0x${magic.toString(16)}, Version: ${ver}`);

// Chunk 0 header: chunkLength(4) chunkType(4)
const chunkLen  = buf.readUInt32LE(12);
const chunkType = buf.readUInt32LE(16);
const jsonStr   = buf.subarray(20, 20 + chunkLen).toString('utf8');
const gltf      = JSON.parse(jsonStr);

const meshes = gltf.meshes  || [];
const nodes  = gltf.nodes   || [];
const mats   = gltf.materials || [];

console.log(`\nMeshes (${meshes.length}):`);
meshes.forEach(m => console.log(`  "${m.name || 'unnamed'}"`));

console.log(`\nMaterials (${mats.length}):`);
mats.forEach(mat => {
  const pbr  = mat.pbrMetallicRoughness || {};
  const base = pbr.baseColorFactor;
  console.log(`  "${mat.name || 'unnamed'}"  base=${JSON.stringify(base)}`);
});

const meshNodes = nodes.filter(n => n.mesh !== undefined);
console.log(`\nNodes with mesh (${meshNodes.length}):`);
meshNodes.forEach(n => {
  const meshName = n.mesh < meshes.length ? meshes[n.mesh].name : '?';
  console.log(`  node: "${n.name || 'unnamed'}" -> mesh: "${meshName}"`);
});
