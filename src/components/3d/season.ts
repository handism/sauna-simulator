import * as THREE from 'three';

export type Season = 'summer' | 'autumn';

// Only the named broadleaf groups in the shipped models. Evergreen foliage,
// ferns, moss, bark and ground materials retain their original colors.
function autumnColor(name: string): THREE.Color | null {
  const maple = /maple leaf (\d+)$/.exec(name);
  if (maple || name === 'V7 | maple fresh olive') {
    const palette = [0x943623, 0xc45a26, 0xd18a37];
    return new THREE.Color(palette[Number(maple?.[1] ?? 1) % palette.length]);
  }
  const woodland = /(?:Forest leaf tone|V5 forest leaf|V6 woodland leaf) (\d+)(?: card)?$/.exec(name);
  if (!woodland) return null;
  const palette = [0x795328, 0xa26b2e, 0xbe883b, 0x9b4729, 0xc49b49];
  return new THREE.Color(palette[Number(woodland[1]) % palette.length]);
}

/** Changes existing color uniforms; no new geometry, textures or shader variants. */
export function createSeasonColors() {
  const colors = new Map<THREE.MeshStandardMaterial, { summer: THREE.Color; autumn: THREE.Color }>();
  return {
    get size() {
      return colors.size;
    },
    add(root: THREE.Object3D, season: Season) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial) || colors.has(material)) continue;
          const autumn = autumnColor(material.name);
          if (!autumn) continue;
          const summer = material.color.clone();
          colors.set(material, { summer, autumn });
          material.color.copy(season === 'autumn' ? autumn : summer);
        }
      });
    },
    update(season: Season) {
      let changed = false;
      for (const [material, palette] of colors) {
        if (material.color.equals(palette[season])) continue;
        material.color.copy(palette[season]);
        changed = true;
      }
      return changed;
    },
  };
}
