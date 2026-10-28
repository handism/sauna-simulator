import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createSeasonColors, EVERGREEN_WINTER, FERN_AUTUMN } from './season';

function tree(...names: string[]) {
  const root = new THREE.Group();
  const materials = names.map((name) => {
    const material = new THREE.MeshStandardMaterial({ color: 0x456735 });
    material.name = name;
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    return material;
  });
  return { root, materials };
}

describe('season colors', () => {
  it('recolors broadleaves, preserves non-deciduous materials and restores exact summer colors', () => {
    const { root, materials } = tree(
      'V11 | maple leaf 0',
      'V6 woodland leaf 2 card',
      'Evergreen foliage',
      'V3 | fern 0',
      'Tree bark',
      'V9 | layered living moss',
    );
    const originals = materials.map((material) => material.color.clone());
    const seasons = createSeasonColors();
    seasons.add(root, 'summer');
    seasons.update('autumn');
    expect(seasons.size).toBe(2);
    expect(materials[0].color.r).toBeGreaterThan(materials[0].color.g);
    expect(materials[0].color.equals(materials[1].color)).toBe(false);
    materials.slice(2).forEach((material, i) => expect(material.color.equals(originals[i + 2])).toBe(true));
    seasons.update('summer');
    materials.forEach((material, i) => expect(material.color.equals(originals[i])).toBe(true));
  });
  it('applies the current choice to a late garden and does not overwrite originals on shared materials', () => {
    const { root, materials } = tree('Forest leaf tone 1');
    const original = materials[0].color.clone();
    const seasons = createSeasonColors();
    seasons.update('autumn');
    seasons.add(root, 'autumn');
    seasons.add(root, 'autumn');
    expect(seasons.size).toBe(1);
    expect(materials[0].color.equals(original)).toBe(false);
    seasons.update('summer');
    expect(materials[0].color.equals(original)).toBe(true);
    seasons.add(tree('V11 | maple leaf 1').root, 'autumn');
    expect(seasons.update('summer')).toBe(true);
    expect(seasons.update('summer')).toBe(false);
  });
  it('winter hides deciduous meshes and restores leaves and summer colors, keeping evergreen foliage', () => {
    const { root, materials } = tree('V11 | maple leaf 0', 'Evergreen foliage', 'V9 | layered living moss');
    const seasons = createSeasonColors();
    seasons.add(root, 'summer');
    const original = materials[0].color.clone();
    const evergreen = materials[1].color.clone();
    seasons.update('autumn');
    expect(seasons.update('winter')).toBe(true);
    expect(root.children[0].visible).toBe(false);
    expect(root.children[1].visible).toBe(true);
    expect(seasons.hiddenLeaves).toBe(1);
    // The moss and the evergreen trees, which take snow on their crowns and a winter green.
    expect(seasons.snowMaterials).toBe(2);
    expect(materials[1].color.equals(evergreen.clone().multiply(EVERGREEN_WINTER))).toBe(true);
    seasons.update('summer');
    expect(root.children[0].visible).toBe(true);
    expect(materials[0].color.equals(original)).toBe(true);
    expect(materials[1].color.equals(evergreen)).toBe(true);
    expect(seasons.update('summer')).toBe(false);
  });
  it('a late winter garden keeps initially hidden meshes hidden on restoration', () => {
    const { root } = tree('Forest leaf tone 1', 'V11 | maple leaf 0');
    root.children[1].visible = false;
    const seasons = createSeasonColors();
    seasons.add(root, 'winter');
    expect(root.children.every((mesh) => !mesh.visible)).toBe(true);
    seasons.update('autumn');
    expect(root.children[0].visible).toBe(true);
    expect(root.children[1].visible).toBe(false);
  });
  it('restores young leaves from winter, keeps evergreens unchanged and restores exact summer colors', () => {
    const { root, materials } = tree('V11 | maple leaf 0', 'V6 woodland leaf 2 card', 'Evergreen foliage');
    const originals = materials.map((material) => material.color.clone());
    const seasons = createSeasonColors();
    seasons.add(root, 'winter');
    seasons.update('spring');
    expect(root.children[0].visible).toBe(true);
    expect(materials[0].color.g).toBeGreaterThan(materials[0].color.r);
    expect(materials[0].color.equals(originals[0])).toBe(false);
    expect(materials[0].color.equals(materials[1].color)).toBe(false);
    expect(materials[2].color.equals(originals[2])).toBe(true);
    seasons.update('summer');
    materials.forEach((material, index) => expect(material.color.equals(originals[index])).toBe(true));
    seasons.add(tree('Forest leaf tone 0').root, 'spring');
    expect(seasons.update('summer')).toBe(true);
  });
  it('dulls the evergreen crowns in winter only and restores their color', () => {
    const { root, materials } = tree('V6 woodland leaf 2 card evergreen');
    const original = materials[0].color.clone();
    const seasons = createSeasonColors();
    seasons.add(root, 'summer');
    expect(materials[0].color.equals(original)).toBe(true);
    expect(seasons.update('winter')).toBe(true);
    expect(root.children[0].visible).toBe(true);
    expect(materials[0].color.equals(original.clone().multiply(EVERGREEN_WINTER))).toBe(true);
    expect(seasons.update('autumn')).toBe(true);
    expect(materials[0].color.equals(original)).toBe(true);
    seasons.update('winter');
    seasons.add(root, 'winter');
    seasons.update('spring');
    expect(materials[0].color.equals(original)).toBe(true);
  });

  it('turns the tinted fern ramps in autumn only and returns them to white', () => {
    const { root, materials } = tree('V3 | fern 1', 'V3 | fern 2');
    // Only ramps tinted by their color (modelMaterials.ts) take it.
    materials[0].defines = { SUI_NOISE_TINT: '' };
    materials[0].color.setScalar(1);
    const untinted = materials[1].color.clone();
    const seasons = createSeasonColors();
    seasons.add(root, 'summer');
    expect(materials[0].color.equals(new THREE.Color(1, 1, 1))).toBe(true);
    expect(seasons.update('autumn')).toBe(true);
    expect(materials[0].color.equals(FERN_AUTUMN[1])).toBe(true);
    expect(materials[1].color.equals(untinted)).toBe(true);
    expect(seasons.update('winter')).toBe(true);
    expect(materials[0].color.equals(new THREE.Color(1, 1, 1))).toBe(true);
  });
});
