import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyPoolTiles, patchPoolTileShader, TILE_BOUNDS, TILE_GRID, TILE_MATERIAL } from './poolTiles';

const mesh = (name: string) => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }));

describe('pool tiles', () => {
  it('varies only the plunge floor tiles, once, composing earlier hooks', () => {
    const root = new THREE.Group();
    const tiles = mesh(TILE_MATERIAL);
    const stone = mesh('V10 | submerged light / V9 | quiet honed stone / V2 | mineral c');
    root.add(tiles, stone);
    const material = tiles.material as THREE.MeshStandardMaterial;
    material.customProgramCacheKey = () => 'earlier';
    expect(applyPoolTiles(root)).toBe(1);
    expect(applyPoolTiles(root)).toBe(0);
    expect(material.customProgramCacheKey()).toBe('earlier|pool-tiles');
    expect((stone.material as THREE.Material).customProgramCacheKey()).not.toContain('pool-tiles');
  });

  it('shades after the base color and before the roughness, from the true position', () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchPoolTileShader(shader);
    const at = (text: string) => shader.fragmentShader.indexOf(text);
    expect(at('suiTileTone = suiTileHash')).toBeGreaterThan(at('#include <color_fragment>'));
    expect(at('( suiTileTone - 0.5 ) * 0.12')).toBeGreaterThan(at('#include <roughnessmap_fragment>'));
    expect(shader.vertexShader.indexOf('vSuiTilePosition = ( modelMatrix')).toBeGreaterThan(
      shader.vertexShader.indexOf('#include <project_vertex>'),
    );
    expect(shader.fragmentShader.match(/sampler/g)?.length).toBe(
      THREE.ShaderLib.standard.fragmentShader.match(/sampler/g)?.length,
    );
    expect(() => patchPoolTileShader({ vertexShader: '', fragmentShader: '' })).toThrow('shader chunks');
  });

  it('spans the exported 13 × 16 tiles', () => {
    expect(TILE_BOUNDS[0]).toBeCloseTo(2.4895, 3);
    expect(TILE_BOUNDS[1]).toBeCloseTo(-0.8702, 3);
    expect(TILE_GRID.origin).toEqual([-0.169, -4.067]);
  });
});
