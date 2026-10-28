import * as THREE from 'three';
import { applyAutumnGround } from './autumnGround';
import { surfaceDetailOf } from './surfaceDetails';
import { applyWinterSnow, receivesWinterSnow } from './winterSnow';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

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

function springColor(name: string): THREE.Color {
  const tone = Number(/(\d+)(?: card)?$/.exec(name)?.[1] ?? 1);
  const palette = [0x668d3f, 0x80a54c, 0x9dbb62, 0xb3c976, 0x779947];
  return new THREE.Color(palette[tone % palette.length]);
}

const colorSeason = (season: Season) => (season === 'winter' ? 'summer' : season);

/**
 * Winter dulls the woodland's evergreen crowns (evergreenWoodland.ts) and the body's evergreen
 * trees to a deep blue-green: kept at their summer color they stood out bright among the bare
 * trees and the snow, as summer broadleaf crowns (0.5–0.58 still read as light green).
 */
export const EVERGREEN_WINTER = new THREE.Color(0.36, 0.46, 0.47);
const EVERGREEN_CARD = /card evergreen$|^Evergreen foliage$/;

/**
 * Not in the source: the ferns' autumn hue over their noise ramp, by fern 0–2 (noiseColor.ts
 * SUI_NOISE_TINT keeps the ramp's luminance, these colors' own luminance about 1.2 brightens the
 * drying fronds a little). Kept green they stood bright among the turned crowns and the dried
 * meadow. Two turn yellow-brown and rust, one stays olive, so the fronds do not turn as one.
 */
export const FERN_AUTUMN = [
  new THREE.Color(1.9, 1.15, 0.45),
  new THREE.Color(2.2, 0.95, 0.4),
  new THREE.Color(1.3, 1.2, 0.55),
];
const FERN = /^V3 \| fern ([0-2])$/;
const fernColor = (name: string, season: Season) =>
  season === 'autumn' ? FERN_AUTUMN[Number(FERN.exec(name)![1])] : new THREE.Color(1, 1, 1);

/** Reuses model surfaces; the settled snow is a shared uniform, independent of weather. */
export function createSeasonColors() {
  const colors = new Map<
    THREE.MeshStandardMaterial,
    { spring: THREE.Color; summer: THREE.Color; autumn: THREE.Color }
  >();
  const snow = { value: 0 };
  const snowy = new Set<THREE.MeshStandardMaterial>();
  // The meadow and forest floor dry and gather fallen leaves in autumn (autumnGround.ts).
  const autumnGround = { value: 0 };
  const grounds = new Set<THREE.MeshStandardMaterial>();
  const flowers = new Map<THREE.Mesh, number>();
  const leaves = new Map<THREE.Mesh, boolean>();
  const evergreens = new Map<THREE.MeshStandardMaterial, { summer: THREE.Color; winter: THREE.Color }>();
  const evergreenColor = (season: Season) => (season === 'winter' ? 'winter' : 'summer');
  const ferns = new Set<THREE.MeshStandardMaterial>();
  return {
    get snowMaterials() {
      return snowy.size;
    },
    get autumnGroundMaterials() {
      return grounds.size;
    },
    get hiddenLeaves() {
      return [...leaves.keys()].filter((mesh) => !mesh.visible).length;
    },
    get flowerCount() {
      let count = 0;
      for (const [mesh, flowersCount] of flowers) if (mesh.visible) count += flowersCount;
      return count;
    },
    get size() {
      return colors.size;
    },
    add(root: THREE.Object3D, season: Season) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.userData.suiSpringFlowers) {
          flowers.set(object, object.userData.suiSpringFlowers as number);
          object.visible = season === 'spring';
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material) => autumnColor(material.name) !== null) && !leaves.has(object)) {
          leaves.set(object, object.visible);
          object.visible = season === 'winter' ? false : object.visible;
        }
        for (const material of materials) {
          // Before the snow, which is drawn over it.
          if (
            material instanceof THREE.MeshStandardMaterial &&
            surfaceDetailOf(material.name) === 'ground' &&
            !grounds.has(material)
          ) {
            applyAutumnGround(material, autumnGround);
            grounds.add(material);
          }
          if (
            material instanceof THREE.MeshStandardMaterial &&
            receivesWinterSnow(material.name) &&
            !snowy.has(material)
          ) {
            applyWinterSnow(material, snow);
            snowy.add(material);
          }
          if (
            material instanceof THREE.MeshStandardMaterial &&
            EVERGREEN_CARD.test(material.name) &&
            !evergreens.has(material)
          ) {
            const summer = material.color.clone();
            const palette = { summer, winter: summer.clone().multiply(EVERGREEN_WINTER) };
            evergreens.set(material, palette);
            material.color.copy(palette[evergreenColor(season)]);
          }
          if (
            material instanceof THREE.MeshStandardMaterial &&
            material.defines?.SUI_NOISE_TINT !== undefined &&
            FERN.test(material.name) &&
            !ferns.has(material)
          ) {
            ferns.add(material);
            material.color.copy(fernColor(material.name, season));
          }
          if (!(material instanceof THREE.MeshStandardMaterial) || colors.has(material)) continue;
          const autumn = autumnColor(material.name);
          if (!autumn) continue;
          const summer = material.color.clone();
          const palette = { spring: springColor(material.name), summer, autumn };
          colors.set(material, palette);
          material.color.copy(palette[colorSeason(season)]);
        }
      });
      snow.value = season === 'winter' ? 1 : 0;
      autumnGround.value = season === 'autumn' ? 1 : 0;
    },
    update(season: Season) {
      const amount = season === 'winter' ? 1 : 0;
      const autumn = season === 'autumn' ? 1 : 0;
      let changed = snow.value !== amount || autumnGround.value !== autumn;
      snow.value = amount;
      autumnGround.value = autumn;
      for (const mesh of flowers.keys()) {
        const next = season === 'spring';
        if (mesh.visible !== next) {
          mesh.visible = next;
          changed = true;
        }
      }
      for (const [mesh, visible] of leaves) {
        const next = season === 'winter' ? false : visible;
        if (mesh.visible !== next) {
          mesh.visible = next;
          changed = true;
        }
      }
      for (const [material, palette] of colors) {
        if (material.color.equals(palette[colorSeason(season)])) continue;
        material.color.copy(palette[colorSeason(season)]);
        changed = true;
      }
      for (const material of ferns) {
        const next = fernColor(material.name, season);
        if (material.color.equals(next)) continue;
        material.color.copy(next);
        changed = true;
      }
      for (const [material, palette] of evergreens) {
        if (material.color.equals(palette[evergreenColor(season)])) continue;
        material.color.copy(palette[evergreenColor(season)]);
        changed = true;
      }
      return changed;
    },
  };
}
