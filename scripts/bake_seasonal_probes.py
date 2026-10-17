"""Paired seasonal calibration of existing SH grids; never saves the source blend.

Called by bake_irradiance_probes.py -- --seasonal --out <diagnostic-dir>.
The RGB gains describe a grid-wide change in low-frequency energy, not a new
directional/visibility bake. The detailed summer SH and its occlusion stay intact.
"""
import hashlib
import json
import math
import re
import time

import bpy
import numpy as np


def linear(hex_color):
    rgb = [(hex_color >> s & 255) / 255 for s in (16, 8, 0)]
    return [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]


def bake(g):
    started = time.time()
    out = g['OUT']
    out.mkdir(parents=True, exist_ok=True)
    # Per-material controls retain one compiled shader as the seasons change.
    controls = []
    foliage = set()
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        name = g['base_name'](material.name)
        nodes, links = material.node_tree.nodes, material.node_tree.links
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        maple = re.search(r'maple leaf (\d+)$', name)
        leaf = re.search(r'(?:Forest leaf tone|V5 forest leaf|V6 woodland leaf) (\d+)$', name)
        if maple or leaf or name == 'V7 | maple fresh olive':
            tone = int((maple or leaf).group(1)) if maple or leaf else 1
            spring = [0x668d3f, 0x80a54c, 0x9dbb62, 0xb3c976, 0x779947][tone % 5]
            palette = [0x943623, 0xc45a26, 0xd18a37] if maple or not leaf else [0x795328, 0xa26b2e, 0xbe883b, 0x9b4729, 0xc49b49]
            mix = nodes.new('ShaderNodeMixRGB')
            base = bsdf.inputs['Base Color']
            if base.is_linked:
                links.new(base.links[0].from_socket, mix.inputs[1])
            else:
                mix.inputs[1].default_value = base.default_value
            links.new(mix.outputs[0], base)
            controls.append(('leaf', mix, linear(spring), linear(palette[tone % len(palette)])))
            foliage.add(material)
        if re.search(r'moss|woodland earth|garden gravel|tree bark|mineral charcoal stone|pale mineral paving|quiet honed stone|outdoor ash|locally damp ash|warm open-grain timber|fern \d', name, re.I):
            # A mean cover for the calibration. Browser drifts, ripples and tiny
            # garden decorations are not reproduced by this source-scene proxy.
            geometry = nodes.new('ShaderNodeNewGeometry')
            normal = nodes.new('ShaderNodeSeparateXYZ')
            position = nodes.new('ShaderNodeSeparateXYZ')
            links.new(geometry.outputs['Normal'], normal.inputs[0])
            links.new(geometry.outputs['Position'], position.inputs[0])

            def op(kind, a, b):
                node = nodes.new('ShaderNodeMath'); node.operation = kind
                for socket, value in zip(node.inputs, [a, b]):
                    if isinstance(value, (float, int)):
                        socket.default_value = value
                    else:
                        links.new(value, socket)
                return node.outputs[0]

            up = nodes.new('ShaderNodeMapRange')
            up.interpolation_type = 'SMOOTHSTEP'
            links.new(normal.outputs['Z'], up.inputs['Value'])
            up.inputs['From Min'].default_value = .42
            up.inputs['From Max'].default_value = .88
            inside = op('MULTIPLY', op('GREATER_THAN', position.outputs['X'], -7.1), op('LESS_THAN', position.outputs['X'], 7.1))
            inside = op('MULTIPLY', inside, op('MULTIPLY', op('GREATER_THAN', position.outputs['Y'], -2.9), op('LESS_THAN', position.outputs['Y'], 5.3)))
            inside = op('MULTIPLY', inside, op('LESS_THAN', position.outputs['Z'], 3.35))
            cover = op('MULTIPLY', up.outputs['Result'], op('SUBTRACT', 1, inside))
            amount = nodes.new('ShaderNodeValue')
            cover = op('MULTIPLY', cover, amount.outputs[0])
            mix = nodes.new('ShaderNodeMixRGB')
            base = bsdf.inputs['Base Color']
            if base.is_linked:
                links.new(base.links[0].from_socket, mix.inputs[1])
            else:
                mix.inputs[1].default_value = base.default_value
            mix.inputs[2].default_value = [.74, .79, .85, 1]
            links.new(cover, mix.inputs[0]); links.new(mix.outputs[0], base)
            controls.append(('snow', amount, None, None))
        if re.search(r'moss|woodland earth|garden gravel', name, re.I):
            mix = nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'
            base = bsdf.inputs['Base Color']
            if base.is_linked:
                links.new(base.links[0].from_socket, mix.inputs[1])
            else:
                mix.inputs[1].default_value = base.default_value
            mix.inputs[2].default_value = [1.12, .78, .52, 1]
            links.new(mix.outputs[0], base)
            controls.append(('ground', mix, None, None))

    original = {o: o.hide_render for o in bpy.data.objects}
    hidden = []
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.data.materials or not all(m in foliage for m in o.data.materials):
            continue
        maple = any('maple' in m.name for m in o.data.materials)
        # The web woodland retains about 35% evergreen; this source proxy uses
        # deterministic whole trees, without changing the original saved model.
        keep = not maple and int(hashlib.sha256(o.name.encode()).hexdigest()[:8], 16) / 2**32 < .35
        if not keep:
            hidden.append(o)

    points = {
        'room': [[x, 1.4, z] for z in [-3.6, -1.0] for x in [-4.8, -1.2]],
        'courtyard': [[x, 1.5, z] for z in [3.0, 8.0] for x in [-5., 0., 5.]],
        'outer': [[18 * math.cos(i * math.pi / 4), 4., 18 * math.sin(i * math.pi / 4)] for i in range(8)],
        'water': [[.5, .2085, -3.4], [1.9, .2085, -1.5]],
    }
    raw = {}
    # These helpers are defined below the dispatch in the normal bake; use the
    # same world gate nodes directly, restoring them per scene.
    for key, scene_name in g['ALL_SCENES']:
        scene = bpy.data.scenes[scene_name]
        g['composite_backface'](scene)
        visible = {o: o.visible_camera for o in scene.objects if o.type == 'LIGHT'}
        world_camera = scene.world.cycles_visibility.camera
        gates = {name: scene.world.node_tree.nodes.get(name) for name in ['SUI sky gate', 'SUI sun disk gate']}
        old_gates = {name: node.inputs[1].default_value for name, node in gates.items() if node}
        for kind in ['irradiance', 'reflection']:
            g['REFLECTION'] = kind == 'reflection'
            for o in visible:
                o.visible_camera = g['in_panorama'](o, key)
            scene.world.cycles_visibility.camera = scene.world.cycles_visibility.glossy if g['REFLECTION'] else world_camera
            for name, node in gates.items():
                if node:
                    node.inputs[1].default_value = float(name == 'SUI sky gate' and g['REFLECTION'])
            for current in ['summer', 'spring', 'autumn', 'winter']:
                for mode, node, spring, autumn in controls:
                    if mode == 'leaf':
                        node.inputs[0].default_value = float(current in ['spring', 'autumn'])
                        node.inputs[2].default_value = [*(spring if current == 'spring' else autumn), 1]
                    elif mode == 'snow':
                        node.outputs[0].default_value = float(current == 'winter')
                    else:
                        node.inputs[0].default_value = float(current == 'autumn')
                for o in hidden:
                    o.hide_render = original[o] or current == 'winter'
                g['configure'](scene, 64, backface=True)
                scene.cycles.seed = 7319
                for grid, positions in points.items():
                    p = np.asarray(positions)
                    if grid == 'water' and kind == 'irradiance':
                        coefficients, valid, _ = g['receiver_sh'](scene, p)
                        l0 = coefficients[:, :3]
                    else:
                        # Match the regular reflection bake's transmission exclusions.
                        off = [o for o in scene.objects if grid == 'water' and kind == 'reflection' and o.type == 'LIGHT' and not g['in_panorama'](o, key) and o.visible_transmission]
                        for o in off:
                            o.visible_transmission = False
                        rgba = g['render_all'](scene, p, f'{key} {kind} {current} {grid}')
                        for o in off:
                            o.visible_transmission = True
                        coefficients = np.einsum('pk,npc->nkc', g['basis'], rgba[:, :, :3])
                        l0 = coefficients[:, 0, :]
                        valid = np.einsum('np,p->n', rgba[:, :, 3], g['weights']) < .5 * 4 * math.pi
                    if not np.all(valid) or not np.all(np.isfinite(l0)) or np.any(l0 <= 0):
                        raise ValueError(f'invalid seasonal reference {key}/{kind}/{current}/{grid}: {valid}, {l0}')
                    raw.setdefault(current, {}).setdefault(kind, {}).setdefault(key, {})[grid] = l0.tolist()
                print('SEASONAL', key, kind, current, flush=True)
                (out / 'seasonal-partial.json').write_text(json.dumps(raw, indent=2))
        for o, value in visible.items():
            o.visible_camera = value
        scene.world.cycles_visibility.camera = world_camera
        for name, value in old_gates.items():
            gates[name].inputs[1].default_value = value
    gains = {}
    held_out = []
    for current in ['spring', 'autumn', 'winter']:
        gains[current] = {}
        for kind in ['irradiance', 'reflection']:
            rows = []
            for grid in points:
                for key, _ in g['ALL_SCENES']:
                    before = np.asarray(raw['summer'][kind][key][grid])
                    after = np.asarray(raw[current][kind][key][grid])
                    # Last location is held out of the fit, then used for review.
                    ratio = np.mean(after[:-1], axis=0) / np.mean(before[:-1], axis=0)
                    gain = np.clip(ratio, .6, 1.8)
                    rows.append([round(float(x), 6) for x in gain])
                    held_out.append(dict(season=current, kind=kind, grid=grid, scene=key, raw_gain=ratio.tolist(), gain=gain.tolist(),
                        before=before[-1].tolist(), reference=after[-1].tolist(), corrected=(before[-1] * gain).tolist()))
            gains[current][kind] = rows
    data = dict(version=1, grids=list(points), scenes=[key for key, _ in g['ALL_SCENES']], gains=gains)
    (out / 'seasonal-light.json').write_text(json.dumps(data, indent=2) + '\n')
    report = dict(input=g['source'].name, input_sha256=g['source_hash'], script_sha256=hashlib.sha256(open(__file__, 'rb').read()).hexdigest(),
        blender=bpy.app.version_string, samples=64, seed=7319, points=points, measurements=raw, held_out=held_out,
        seconds=time.time()-started, mode='grid-wide paired L0 RGB gain; original summer angular SH and occlusion retained',
        limits=['source seasonal proxy: mean snow, whole-tree evergreen selection, no procedural browser garden',
                'not a seasonal directional/visibility rebake; gains bounded to 0.6..1.8', 'one held-out point per grid, one seed'])
    assert hashlib.sha256(g['source'].read_bytes()).hexdigest() == g['source_hash']
    (out / 'seasonal-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('SEASONAL_DONE', report['seconds'], flush=True)
