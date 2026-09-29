"""Isolate the source dusk disk and tile to calibrate radiance and GGX, without water.

Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1
  --python scripts/diagnose_water_gloss_calibration.py -- --out DIR --samples 2048

A new scene holds only a copied source lamp and a flat tile plane, viewed orthographically.
Two seeds render the source Principled material with black base (gloss only), and a white
Lambert material (power calibration). Linear EXR pixels are compared to numerical disk
integration in the same directions. No source blend or product assets are written.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_water_floor_disk import ggx, ALPHA  # noqa: E402


def integrate(p, view, light, steps=401):
    """Dry disk integral: RGB radiance is applied by the caller; no water or visibility."""
    center, facing, radius = light
    n = np.asarray(facing, dtype=float)
    n /= np.linalg.norm(n)
    c = center - p
    c /= np.linalg.norm(c)
    u = np.cross(c, [1., 0., 0.] if abs(c[1]) > .99 else [0., 1., 0.])
    u /= np.linalg.norm(u)
    w = np.cross(c, u)
    span = 1.3 * np.tan(np.arcsin(radius / np.linalg.norm(center - p)))
    g = np.linspace(-span, span, steps)
    x, y = np.meshgrid(g, g)
    d = c + x[..., None] * u + y[..., None] * w
    length = np.linalg.norm(d, axis=-1)
    d /= length[..., None]
    toward = d @ n
    t = ((center - p) @ n) / np.where(toward < 0, toward, -1.)
    hit = p + t[..., None] * d
    inside = (np.linalg.norm(hit - center, axis=-1) < radius) & (toward < 0) & (d[..., 1] > 0)
    weight = inside * (g[1] - g[0])**2 / length**3 * d[..., 1]
    brdf = ggx(d, view, ALPHA)
    half = d + view
    half /= np.linalg.norm(half, axis=-1, keepdims=True)
    cosine = np.clip(half @ view, 0., 1.)
    transmitted = np.sqrt(1. - (1. - cosine**2) / 1.5**2)
    fresnel = .5 * (((cosine - 1.5 * transmitted) / (cosine + 1.5 * transmitted))**2
                    + ((1.5 * cosine - transmitted) / (1.5 * cosine + transmitted))**2)
    schlick = .04 + .96 * (1. - cosine)**5
    return np.array([(weight / np.pi).sum(), (weight * brdf).sum(),
                     (weight * brdf * fresnel / schlick).sum()])


def read(path):
    import OpenImageIO as oiio
    im = oiio.ImageBuf(str(path))
    s = im.spec()
    pixels = im.get_pixels(oiio.FLOAT).reshape(s.height, s.width, -1)
    def channel(layer, axes):
        return pixels[..., [s.channelnames.index(f'ViewLayer.{layer}.{a}') for a in axes]]
    return channel('Combined_lamp', 'RGB'), channel('Position', 'XYZ')


def main():
    import bpy
    from mathutils import Vector
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=2048)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    original = bpy.data.objects['V10 lounge dusk fill / dusk']
    lamp = original.copy()
    lamp.data = original.data.copy()
    # matrix_basis is reliable even for a non-active source scene in background mode.
    lamp.matrix_world = original.matrix_basis.copy()
    scene = bpy.data.scenes.new('Gloss calibration')
    scene.collection.objects.link(lamp)
    bpy.context.window.scene = scene
    scene.render.engine = 'CYCLES'
    lamp.visible_camera = lamp.visible_glossy = lamp.visible_diffuse = True
    scene.world = bpy.data.worlds.new('Black calibration world')
    scene.world.use_nodes = True
    next(n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND').inputs['Strength'].default_value = 0
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    scene.cycles.device = 'GPU'
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = scene.cycles.use_adaptive_sampling = False
    scene.cycles.sample_clamp_direct = scene.cycles.sample_clamp_indirect = 0
    scene.cycles.pixel_filter_type = 'BOX'
    scene.render.resolution_x = scene.render.resolution_y = 96
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    scene.render.image_settings.color_depth = '32'
    scene.view_layers[0].name = 'ViewLayer'
    scene.view_layers[0].use_pass_position = True
    scene.view_layers[0].lightgroups.add(name='lamp')
    lamp.lightgroup = 'lamp'
    mesh = bpy.data.meshes.new('Calibration plane')
    mesh.from_pydata([(-4,-4,.202), (8,-4,.202), (8,9,.202), (-4,9,.202)], [], [(0,1,2,3)])
    plane = bpy.data.objects.new('Calibration plane', mesh)
    scene.collection.objects.link(plane)
    tile = bpy.data.materials['V10 | submerged light / Teal glazed pool tile'].copy()
    bsdf = next(n for n in tile.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    params = {key: float(bsdf.inputs[key].default_value) for key in ('Roughness','IOR','Specular IOR Level','Metallic')}
    assert not any(bsdf.inputs[k].is_linked for k in ('Base Color','Normal','Roughness'))
    assert abs(params['Roughness'] - .3) < 1e-6 and abs(params['IOR'] - 1.5) < 1e-6
    bsdf.inputs['Base Color'].default_value = (0,0,0,1)
    diffuse = bpy.data.materials.new('White Lambert')
    diffuse.use_nodes = True
    nodes = diffuse.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    lambert = nodes.new('ShaderNodeBsdfDiffuse')
    lambert.inputs['Color'].default_value = (1,1,1,1)
    lambert.inputs['Roughness'].default_value = 0
    diffuse.node_tree.links.new(lambert.outputs[0], output.inputs['Surface'])
    single = tile.copy()
    next(n for n in single.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').distribution = 'GGX'
    mesh.materials.append(tile)
    center = Vector((1.18,2.5,.202))
    toward = lamp.matrix_world.translation - center
    view = Vector((-toward.x,-toward.y,toward.z)).normalized()
    camdata = bpy.data.cameras.new('Calibration ortho')
    camdata.type, camdata.ortho_scale = 'ORTHO', 2.0
    camera = bpy.data.objects.new('Calibration ortho', camdata)
    scene.collection.objects.link(camera)
    camera.location = center + view * 12
    camera.rotation_euler = (-view).to_track_quat('-Z','Y').to_euler()
    scene.camera = camera
    def gltf(v):
        return np.array([v[0],v[2],-v[1]])
    light = (gltf(lamp.matrix_world.translation), gltf(lamp.matrix_world.to_quaternion() @ Vector((0,0,-1))), lamp.data.size / 2)
    radiance = np.array(lamp.data.color) * lamp.data.energy / (np.pi**2 * light[2]**2)
    results = {}
    for name, mat in [('diffuse',diffuse), ('gloss',tile), ('glossSingle',single)]:
        plane.data.materials[0] = mat
        for seed in (17,53):
            scene.cycles.seed = seed
            path = args.out / f'{name}-{seed}.exr'
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            values, positions = read(path)
            results[name,seed] = values
            np.save(args.out / f'{name}-{seed}.npy', values)
    samples = []
    for y in range(12,85,12):
        for x in range(12,85,12):
            p = gltf(positions[y,x])
            assert abs(p[1] - .202) < 1e-4
            exact = integrate(p,gltf(view),light)
            lower = integrate(p,gltf(view),light,201)
            samples.append({'pixel':[x,y], 'position':p.tolist(), 'analytic':(exact[:,None]*radiance).tolist(),
                            'integration201':(lower[:,None]*radiance).tolist(),
                            'cycles':{name:[results[name,seed][y,x].tolist() for seed in (17,53)] for name in ('diffuse','gloss','glossSingle')}})
    scores = {}
    for i,name,measured_name in ((0,'diffuse','diffuse'), (1,'gloss','gloss'),
                                 (2,'glossExactFresnel','gloss'), (2,'singleExactFresnel','glossSingle')):
        exact = np.array([s['analytic'][i] for s in samples])
        measured = np.array([s['cycles'][measured_name] for s in samples])
        scores[name] = {'cyclesOverAnalyticBySeed':(measured.sum((0,2))/exact.sum()).tolist(),
                        'l1Relative':float(np.abs(measured.mean(1)-exact).sum()/exact.sum()),
                        'integration201Over401':float(np.array([s['integration201'][i] for s in samples]).sum()/exact.sum())}
    assert before == hashlib.sha256(source.read_bytes()).hexdigest()
    report = {'blendSha256':before,'blender':bpy.app.version_string,'samples':args.samples,
              'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'integratorSha256':hashlib.sha256(Path(__file__).with_name('diagnose_water_floor_disk.py').read_bytes()).hexdigest(),
              'material':params,'emissionLinked':bsdf.inputs['Emission Color'].is_linked,'distribution':bsdf.distribution,'light':{'energy':lamp.data.energy,'color':list(lamp.data.color), 'shape':lamp.data.shape,
              'size':lamp.data.size,'spread':lamp.data.spread,'normalize':getattr(lamp.data,'normalize',None)},
              'view':gltf(view).tolist(),'scores':scores,'points':samples}
    (args.out/'calibration.json').write_text(json.dumps(report,indent=1)+'\n')
    print('CALIBRATION',json.dumps(scores),flush=True)


if __name__ == '__main__':
    main()
