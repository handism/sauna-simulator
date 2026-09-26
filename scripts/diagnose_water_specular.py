"""Compare specular candidates with the Cycles glossy of water endpoints (NumPy, no Blender).

python3 scripts/diagnose_water_specular.py docs/3d-qa/water-radiance/radiance.json --out DIR

Mirrors the shipped browser specular of an underwater surface on the CPU: the reflection probe
(reflection.ts, water grid) along three's dominant direction, times three's split-sum Fresnel
with the DFG LUT, plus the multiple-scattering term with the irradiance probe. The view
direction is either the last ray segment of the refracted path ("probe_path", the proposed
approximation) or the unrefracted line from the camera ("probe_camera", what the product does
today). "omit" drops the specular. Geometric normals only: the stone normal map, the
derivative roughness term and the water surface Fresnel/absorption are not modelled.
This is a local colour diagnostic, not a GPU measurement.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re

import numpy as np

from probe_sampling import basis, interpolate

ROOT = Path(__file__).resolve().parent.parent
# Underwater fragments use the water grid only (interiorLights.ts WATER_BOX, glTF axes).
WATER_BOX = (np.array([-.2, .15, -4.12]), np.array([2.56, .771, -.86]))
IRRADIANCE_BANDS = np.array([np.pi, 2 * np.pi / 3, np.pi / 4])


def to_gltf(vector):
    """Blender Z-up (x, y, z) to glTF Y-up (x, z, -y)."""
    x, y, z = vector
    return np.array([x, z, -y], float)


def load_dfg(path=ROOT / 'node_modules/three/src/renderers/shaders/DFGLUTData.js'):
    """three's 16x16 RG half-float DFG LUT; rows are dot(N, V), columns roughness."""
    source = Path(path).read_text()
    body = source[source.index('new Uint16Array( ['):source.index('] );')]
    values = np.array([int(v, 16) for v in re.findall(r'0x([0-9a-fA-F]{4})', body)], np.uint16)
    return values.view(np.float16).astype(float).reshape(16, 16, 2)


def sample_dfg(lut, roughness, dot_nv):
    """texture2D with LinearFilter and ClampToEdge at (roughness, dotNV)."""
    size = np.array(lut.shape[1::-1], float)  # (width, height)
    coordinate = np.clip(np.array([roughness, dot_nv]) * size - .5, 0, size - 1)
    lower = np.floor(coordinate).astype(int)
    upper = np.minimum(lower + 1, size.astype(int) - 1)
    fx, fy = coordinate - lower
    row = lambda y: (1 - fx) * lut[y, lower[0]] + fx * lut[y, upper[0]]
    return (1 - fy) * row(lower[1]) + fy * row(upper[1])


def multiscattering(fab, specular_color, specular_f90):
    """three's computeMultiscattering (single, multiple)."""
    fss_ess = specular_color * fab[0] + specular_f90 * fab[1]
    ems = 1 - (fab[0] + fab[1])
    favg = specular_color + (1 - specular_color) * 0.047619
    return fss_ess, fss_ess * favg / (1 - ems * favg) * ems


def material_parameters(material):
    """three's PhysicalMaterial inputs from a glTF material (lights_physical_fragment)."""
    pbr = material.get('pbrMetallicRoughness', {})
    specular = material.get('extensions', {}).get('KHR_materials_specular')
    roughness = min(max(pbr.get('roughnessFactor', 1.), .0525), 1.)
    metalness = pbr.get('metallicFactor', 1.)
    if specular is None:  # MeshStandardMaterial: no IOR define.
        f0, f90 = np.full(3, .04), 1.
    else:  # MeshPhysicalMaterial, glTF default IOR 1.5.
        intensity = specular.get('specularFactor', 1.)
        f0 = np.minimum(((1.5 - 1) / (1.5 + 1)) ** 2 * np.array(specular.get('specularColorFactor', [1, 1, 1])), 1) * intensity
        f90 = intensity + (1 - intensity) * metalness
    return {'roughness': roughness, 'metalness': metalness, 'f0': f0, 'f90': f90,
            'textured_base': 'baseColorTexture' in pbr,
            'base_color': np.array(pbr.get('baseColorFactor', [1, 1, 1, 1])[:3], float)}


class WaterProbes:
    """The shipped water grid of irradiance.bin and reflection.bin."""

    def __init__(self, directory=ROOT / 'public/models'):
        self.grids, self.hashes = {}, {}
        for kind in ('irradiance', 'reflection'):
            header = json.loads((Path(directory) / f'{kind}.json').read_text())
            binary = (Path(directory) / f'{kind}.bin').read_bytes()
            self.hashes[kind] = hashlib.sha256(binary).hexdigest()
            if self.hashes[kind] != header['bin_sha256']:
                raise ValueError(f'{kind} binary hash does not match header')
            grid = next(g for g in header['grids'] if g['name'] == 'water')
            data = np.frombuffer(binary, dtype='<f2').astype(float)
            res = np.array(grid['resolution'])
            count = int(np.prod(res)) * 27
            self.grids[kind] = {'min': np.array(grid['min']), 'max': np.array(grid['max']), 'res': res,
                                'values': {s: data[o:o + count].reshape(*res[::-1], 9, 3)
                                           for s, o in grid['offset'].items()}}

    def evaluate(self, kind, scene, position, normal, direction, bands):
        """suiGridSH: half a spacing off the surface, clamped, evaluated along direction."""
        grid = self.grids[kind]
        lo, hi, res = grid['min'], grid['max'], grid['res']
        coordinate = (position + normal * .5 * (hi - lo) / (res - 1) - lo) / (hi - lo) * (res - 1)
        coefficients = interpolate(grid['values'][scene], coordinate)
        weights = basis(direction) * np.repeat(bands, [1, 3, 5])
        return np.maximum((coefficients * weights[:, None]).sum(axis=0), 0)


# Diagnostic radiance sources along the dominant direction (the product uses 'probe').
# 'hann' windows bands 1 and 2 by (1 + cos(pi l / 3)) / 2 against L2 ringing; 'irradiance'
# uses the cosine-convolved irradiance probe / pi, a very wide but non-negative lobe.
SOURCES = {'probe': ('reflection', None), 'hann': ('reflection', np.array([1, .75, .25])),
           'irradiance': ('irradiance', IRRADIANCE_BANDS / np.pi)}


def browser_specular(probes, lut, scene, material, position, normal, view, source='probe'):
    """Underwater indirect specular of three 0.186 + irradiance.ts/reflection.ts (glTF axes).

    view points from the surface toward the eye. Returns the specular RGB and its terms.
    """
    normal = normal / np.linalg.norm(normal)
    view = view / np.linalg.norm(view)
    if np.dot(normal, view) < 0:  # Double-sided materials shade the side facing the eye.
        normal = -normal
    roughness = material['roughness']
    alpha = roughness * roughness
    reflected = 2 * np.dot(normal, view) * normal - view
    dominant = reflected + (normal - reflected) * roughness ** 4
    dominant /= np.linalg.norm(dominant)
    kind, window = SOURCES[source]
    bands = np.array([1, *np.exp(-np.array([.5, 1.5]) * alpha * alpha)]) if window is None else window
    if kind == 'reflection' and window is not None:
        bands = bands * np.array([1, *np.exp(-np.array([.5, 1.5]) * alpha * alpha)])
    radiance = probes.evaluate(kind, scene, position, normal, dominant, bands)
    irradiance = probes.evaluate('irradiance', scene, position, normal, normal, IRRADIANCE_BANDS)
    fab = sample_dfg(lut, roughness, np.clip(np.dot(normal, view), 0, 1))
    dielectric = multiscattering(fab, material['f0'], material['f90'])
    metallic = multiscattering(fab, material['base_color'], material['f90'])
    m = material['metalness']
    single, multiple = (d * (1 - m) + c * m for d, c in zip(dielectric, metallic))
    specular = radiance * single + multiple * irradiance / np.pi
    return specular, {'radiance': radiance, 'irradiance': irradiance, 'single': single,
                      'multiple': multiple, 'dfg': fab, 'dot_nv': float(np.dot(normal, view))}


def seed_means(report):
    """Two-seed means of the valid local renders per (scene, index, mode)."""
    samples = defaultdict(dict)
    for render in report['renders']:
        if render.get('valid_position'):
            samples[(render['scene'], render['index'], render['mode'])][render['seed']] = render
    means = {}
    for key, seeds in samples.items():
        if set(seeds) == set(report['seeds']):
            means[key] = {part: np.mean([r['colors'][part] for r in seeds.values()], axis=0)
                          for part in ('diffuse_emission', 'glossy', 'combined')}
            means[key]['direction'] = np.array(next(iter(seeds.values()))['direction'])
            means[key]['seed_glossy'] = [np.array(seeds[s]['colors']['glossy']) for s in report['seeds']]
            # Cycles glossy = (GlossDir + GlossInd) * GlossCol: the BSDF albedo and its light.
            means[key]['gloss_color'] = np.mean([r['passes']['GlossCol'] for r in seeds.values()], axis=0)
            means[key]['gloss_light'] = np.mean([np.add(r['passes']['GlossDir'], r['passes']['GlossInd'])
                                                 for r in seeds.values()], axis=0)
    return means


def stats(values):
    return dict(zip(('median', 'p90', 'max'), map(float, np.percentile(values, [50, 90, 100])))) if values else None


def diagnose(report, materials, probes, lut):
    means = seed_means(report)
    rows = []
    for (scene, index, mode), path in sorted(means.items()):
        if mode != 'path':
            continue
        point = report['selected'][index]
        material = materials[point['hit']['material']]
        position = to_gltf(point['hit']['position'])
        normal = to_gltf(point['hit']['normal'])
        inside = np.all((position >= WATER_BOX[0]) & (position <= WATER_BOX[1]))
        # Diffuse+emission reference: overhead, or the surface-normal (wall map) direction
        # where a vertical surface cannot be seen from above.
        reference_mode = next((m for m in ('overhead', 'normal') if (scene, index, m) in means), None)
        # The camera direction is kept even when its render missed the endpoint (position check).
        camera = next((np.array(r['direction']) for r in report['renders']
                       if (r['scene'], r['index'], r['mode']) == (scene, index, 'camera') and 'direction' in r), None)
        denominator = max(1e-8, float(np.sum(path['combined'])))
        a, b = path['seed_glossy']
        row = {'scene': scene, 'index': index, 'group': point['group'], 'material': point['hit']['material'],
               'underwater_box': bool(inside), 'reference_mode': reference_mode,
               'path_glossy': path['glossy'].tolist(), 'path_combined': path['combined'].tolist(),
               'path_glossy_fraction': float(np.sum(path['glossy']) / denominator),
               'glossy_two_seed_over_total': float(np.sum(np.abs(a - b)) / denominator),
               'cycles_gloss_color': path['gloss_color'].tolist(), 'cycles_gloss_light': path['gloss_light'].tolist(),
               'candidates': {}}
        views = {'path': -to_gltf(path['direction'])}
        if camera is not None:
            views['camera'] = -to_gltf(camera)
        candidates = {'omit': (np.zeros(3), None)}
        for view_name, view in views.items():
            for source in SOURCES if view_name == 'path' else ('probe',):
                candidates[f'{source}_{view_name}'] = browser_specular(
                    probes, lut, scene, material, position, normal, view, source)
        for name, (specular, terms) in candidates.items():
            entry = {'specular': specular.tolist(),
                     'glossy_rgb_l1_over_path_total': float(np.sum(np.abs(specular - path['glossy'])) / denominator),
                     'glossy_sum_ratio': float(np.sum(specular) / max(1e-8, np.sum(path['glossy'])))}
            if terms is not None:
                entry['terms'] = {k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in terms.items()}
                # Split three's result into its albedo (single + multiple scattering) and the
                # light it effectively reflects, to compare with GlossCol and GlossDir + GlossInd.
                albedo = terms['single'] + terms['multiple']
                entry['albedo_sum_ratio'] = float(np.sum(albedo) / max(1e-8, np.sum(path['gloss_color'])))
                entry['light_sum_ratio'] = float(np.sum(specular / albedo) / max(1e-8, np.sum(path['gloss_light'])))
            if reference_mode is not None:
                hybrid = means[(scene, index, reference_mode)]['diffuse_emission'] + specular
                entry['hybrid_rgb_l1_over_path_total'] = float(np.sum(np.abs(hybrid - path['combined'])) / denominator)
            row['candidates'][name] = entry
        rows.append(row)
    names = ('omit', 'probe_camera', 'probe_path', 'hann_path', 'irradiance_path')
    aggregate = lambda subset: {name: {
        'count': sum(name in r['candidates'] for r in subset),
        'glossy': stats([r['candidates'][name]['glossy_rgb_l1_over_path_total'] for r in subset if name in r['candidates']]),
        'hybrid': stats([r['candidates'][name]['hybrid_rgb_l1_over_path_total'] for r in subset
                         if 'hybrid_rgb_l1_over_path_total' in r['candidates'].get(name, {})]),
        'glossy_sum_ratio': stats([r['candidates'][name]['glossy_sum_ratio'] for r in subset if name in r['candidates']]),
        **{key: stats([r['candidates'][name][key] for r in subset if key in r['candidates'].get(name, {})])
           for key in ('albedo_sum_ratio', 'light_sum_ratio')},
    } for name in names}
    # Endpoints outside WATER_BOX (a wall above the surface, seen by total internal reflection)
    # use the courtyard grids in the product, not the water grid modelled here.
    kept = [r for r in rows if r['underwater_box']]
    by_material = {m: aggregate([r for r in kept if r['material'] == m]) for m in sorted({r['material'] for r in kept})}
    by_scene = {s: aggregate([r for r in kept if r['scene'] == s]) for s in ('day', 'evening')}
    return {'points': len(rows), 'aggregated_points': len(kept),
            'excluded_outside_water_box': [(r['scene'], r['index']) for r in rows if not r['underwater_box']],
            'glossy_two_seed_over_total': stats([r['glossy_two_seed_over_total'] for r in kept]),
            'aggregates': aggregate(kept), 'by_scene': by_scene, 'by_material': by_material, 'rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('input', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--glb', type=Path, default=ROOT / 'public/models/sauna.glb')
    args = parser.parse_args()
    report = json.loads(args.input.read_text())
    glb = args.glb.read_bytes()
    length = int.from_bytes(glb[12:16], 'little')
    gltf = json.loads(glb[20:20 + length])
    names = {p['hit']['material'] for p in report['selected']}
    # The trace records the exported (merged, "a / b") material names.
    materials = {}
    for name in names:
        found = [m for m in gltf['materials'] if m['name'] == name]
        if len(found) != 1:
            raise ValueError(f'expected one glTF material for {name!r}, found {len(found)}')
        materials[name] = material_parameters(found[0]) | {'gltf_name': found[0]['name']}
    probes = WaterProbes()
    sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
    result = diagnose(report, materials, probes, load_dfg())
    result = {'input_sha256': sha(args.input), 'glb_sha256': hashlib.sha256(glb).hexdigest(),
              'probe_bin_sha256': probes.hashes, 'script_sha256': sha(__file__),
              'materials': {k: {kk: (vv.tolist() if isinstance(vv, np.ndarray) else vv) for kk, vv in v.items()}
                            for k, v in materials.items()}, **result}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'specular.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ('points', 'aggregated_points', 'excluded_outside_water_box',
                                             'glossy_two_seed_over_total',
                                             'aggregates', 'by_scene')}, indent=2))


if __name__ == '__main__':
    main()
