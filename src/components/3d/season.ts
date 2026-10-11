import * as THREE from 'three';
import { applyWinterSnow, receivesWinterSnow } from './winterSnow';

export type Season = 'summer' | 'autumn' | 'winter';

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

/** Reuses model surfaces; the settled snow is a shared uniform, independent of weather. */
export function createSeasonColors() {
  const colors = new Map<THREE.MeshStandardMaterial, { summer: THREE.Color; autumn: THREE.Color }>();
  const snow = { value: 0 };
  const snowy = new Set<THREE.MeshStandardMaterial>();
  const leaves = new Map<THREE.Mesh, boolean>();
  return {
    get snowMaterials() {
      return snowy.size;
    },
    get hiddenLeaves() {
      return [...leaves.keys()].filter((mesh) => !mesh.visible).length;
    },
    get size() {
      return colors.size;
    },
    add(root: THREE.Object3D, season: Season) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material) => autumnColor(material.name) !== null) && !leaves.has(object)) {
          leaves.set(object, object.visible);
          object.visible = season === 'winter' ? false : object.visible;
        }
        for (const material of materials) {
          if (
            material instanceof THREE.MeshStandardMaterial &&
            receivesWinterSnow(material.name) &&
            !snowy.has(material)
          ) {
            applyWinterSnow(material, snow);
            snowy.add(material);
          }
          if (!(material instanceof THREE.MeshStandardMaterial) || colors.has(material)) continue;
          const autumn = autumnColor(material.name);
          if (!autumn) continue;
          const summer = material.color.clone();
          colors.set(material, { summer, autumn });
          material.color.copy(season === 'autumn' ? autumn : summer);
        }
      });
      snow.value = season === 'winter' ? 1 : 0;
    },
    update(season: Season) {
      const amount = season === 'winter' ? 1 : 0;
      let changed = snow.value !== amount;
      snow.value = amount;
      for (const [mesh, visible] of leaves) {
        const next = season === 'winter' ? false : visible;
        if (mesh.visible !== next) {
          mesh.visible = next;
          changed = true;
        }
      }
      for (const [material, palette] of colors) {
        if (material.color.equals(palette[season === 'autumn' ? 'autumn' : 'summer'])) continue;
        material.color.copy(palette[season === 'autumn' ? 'autumn' : 'summer']);
        changed = true;
      }
      return changed;
    },
  };
}
