"""Isolate light/view refraction and Cycles clamping with a flat, air-backed water slab.

Run in Blender with the source blend, Blue hour scene, -- --out DIR --samples 4096.
No source file or product asset is saved. EXR/NPY stay local; slab.json records evidence.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_water_floor_disk import ALPHA, FLOOR, exact_direction, ggx, run
from diagnose_water_gloss_calibration import integrate, read
from water_gloss import BOTTOM, IOR, LEVEL


def fresnel(cosine, ior):
    c = np.clip(cosine, 0., 1.)
    t = np.sqrt(1. - (1. - c*c) / ior**2)
    return .5 * (((c-ior*t)/(c+ior*t))**2 + ((ior*c-t)/(ior*c+t))**2)


def floor_position(dry, view, ior=IOR):
    """Same orthographic pixel through a parallel slab; both endpoints are in air."""
    sine = np.hypot(view[0], view[2])
    if sine < 1e-12:
        return np.array(dry, float)
    shift = (LEVEL-FLOOR)*sine/view[1] - run(sine, FLOOR, ior)
    return np.asarray(dry) + np.array([view[0], 0., view[2]]) / sine * shift


def slab_integral(p, view, light, steps=401, transmission=True, ior=IOR):
    """Direct transmitted lamp path only; no reflected slab branches or clamp."""
    center, facing, radius = light
    n = np.asarray(facing, float); n /= np.linalg.norm(n)
    c = exact_direction(p, center, ior)
    u = np.cross(c, [0.,1.,0.] if abs(c[1]) < .99 else [1.,0.,0.]); u /= np.linalg.norm(u)
    w = np.cross(c,u)
    span = 1.8*np.arctan(radius/np.linalg.norm(center-p)) + .05
    g = np.linspace(-span,span,steps)
    x,y = np.meshgrid(g,g)
    d = c + x[...,None]*u + y[...,None]*w
    length = np.linalg.norm(d,axis=-1)
    d /= length[...,None]
    sine = np.clip(np.hypot(d[...,0],d[...,2]),1e-12,1-1e-12)
    horizontal = run(sine,p[1],ior)
    exit_ = p + np.stack([d[...,0]/sine*horizontal, np.full_like(sine,LEVEL-p[1]), d[...,2]/sine*horizontal],-1)
    toward = d@n
    t = ((center-exit_)@n) / np.where(toward < 0,toward,-1.)
    hit = exit_ + t[...,None]*d
    inside = (np.linalg.norm(hit-center,axis=-1)<radius)&(toward<0)&(t>0)&(d[...,1]>0)
    half = d+view; half /= np.linalg.norm(half,axis=-1,keepdims=True)
    cosine = np.clip(half@view,0.,1.)
    brdf = ggx(d,view,ALPHA)*fresnel(cosine,1.5)/(.04+.96*(1-cosine)**5)
    weight = inside*(g[1]-g[0])**2/length**3*d[...,1]
    if transmission:
        weight *= (1-fresnel(d[...,1],ior))**2
    return float((weight*brdf).sum())


def main():
    import bpy
    from mathutils import Vector
    parser = argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--samples',type=int,default=4096)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    args.out.mkdir(parents=True,exist_ok=True)
    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    source_cycles = {k:getattr(bpy.context.scene.cycles,k) for k in ('sample_clamp_direct','sample_clamp_indirect','blur_glossy','max_bounces','transmission_bounces','glossy_bounces','min_light_bounces','caustics_reflective','caustics_refractive')}
    original = bpy.data.objects['V10 lounge dusk fill / dusk']
    lamp = original.copy(); lamp.data = original.data.copy(); lamp.matrix_world = original.matrix_basis.copy()
    scene = bpy.data.scenes.new('Flat slab calibration')
    scene.collection.objects.link(lamp); bpy.context.window.scene = scene
    scene.render.engine = 'CYCLES'
    lamp.visible_camera = lamp.visible_diffuse = lamp.visible_transmission = True
    scene.world = bpy.data.worlds.new('Black slab world'); scene.world.use_nodes=True
    next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND').inputs['Strength'].default_value=0
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'; prefs.get_devices()
    for device in prefs.devices: device.use=device.type=='METAL'
    scene.cycles.device='GPU'; scene.cycles.samples=args.samples
    scene.cycles.use_denoising=scene.cycles.use_adaptive_sampling=False
    scene.cycles.max_bounces=scene.cycles.transmission_bounces=scene.cycles.glossy_bounces=16
    scene.cycles.min_light_bounces=8
    scene.cycles.caustics_reflective=scene.cycles.caustics_refractive=True
    scene.cycles.pixel_filter_type='BOX'
    scene.render.resolution_x=scene.render.resolution_y=96; scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='OPEN_EXR_MULTILAYER'; scene.render.image_settings.color_depth='32'
    scene.view_layers[0].name='ViewLayer'; scene.view_layers[0].use_pass_position=True
    scene.view_layers[0].lightgroups.add(name='lamp'); lamp.lightgroup='lamp'
    mesh=bpy.data.meshes.new('Slab floor')
    mesh.from_pydata([(-30,-30,FLOOR),(30,-30,FLOOR),(30,30,FLOOR),(-30,30,FLOOR)],[],[(0,1,2,3)])
    plane=bpy.data.objects.new('Slab floor',mesh); scene.collection.objects.link(plane)
    tile=bpy.data.materials['V10 | submerged light / Teal glazed pool tile'].copy()
    bsdf=next(n for n in tile.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for key,value in [('Base Color',(0,0,0,1)),('Emission Color',(0,0,0,1)),('Emission Strength',0.)]:
        for link in list(bsdf.inputs[key].links): tile.node_tree.links.remove(link)
        bsdf.inputs[key].default_value=value
    bsdf.distribution='GGX'; mesh.materials.append(tile)
    assert abs(bsdf.inputs['Roughness'].default_value-.3)<1e-6
    # Closed slab, top and bottom normals point outward; sides far from every tested path.
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,(BOTTOM+LEVEL)/2))
    slab=bpy.context.object; slab.name='Flat water slab'; slab.scale=(50,50,LEVEL-BOTTOM)
    water=bpy.data.materials.new('Ideal flat water'); water.use_nodes=True
    nodes=water.node_tree.nodes; nodes.clear(); output=nodes.new('ShaderNodeOutputMaterial')
    refract=nodes.new('ShaderNodeBsdfRefraction'); glass=nodes.new('ShaderNodeBsdfGlass')
    for node in (refract,glass):
        node.inputs['Color'].default_value=(1,1,1,1); node.inputs['Roughness'].default_value=0.; node.inputs['IOR'].default_value=IOR
    slab.data.materials.append(water)
    center=Vector((1.18,2.5,FLOOR)); toward=lamp.matrix_world.translation-center
    view=Vector((-toward.x,-toward.y,toward.z)).normalized()
    camdata=bpy.data.cameras.new('Slab ortho'); camdata.type='ORTHO'; camdata.ortho_scale=2.
    camera=bpy.data.objects.new('Slab ortho',camdata); scene.collection.objects.link(camera)
    camera.location=center+view*12; camera.rotation_euler=(-view).to_track_quat('-Z','Y').to_euler(); scene.camera=camera
    def gltf(v): return np.array([v[0],v[2],-v[1]])
    light=(gltf(lamp.matrix_world.translation),gltf(lamp.matrix_world.to_quaternion()@Vector((0,0,-1))),lamp.data.size/2)
    radiance=np.array(lamp.data.color)*lamp.data.energy/(np.pi**2*light[2]**2)
    conditions=('dry','lightRefraction','bothRefraction','bothGlass','bothGlassClamp','bothGlassFilter','bothGlassSource')
    results={}; backgrounds={}; settings={}
    for name in conditions:
        slab.hide_render=name=='dry'; slab.visible_camera=name!='lightRefraction'
        # Prevent the slab's own reflected lamp image; transmitted tile paths remain visible.
        lamp.visible_glossy=name in ('dry','lightRefraction')
        water.node_tree.links.new((glass if 'Glass' in name else refract).outputs[0],output.inputs['Surface'])
        scene.cycles.sample_clamp_direct=scene.cycles.sample_clamp_indirect=scene.cycles.blur_glossy=0
        if name in ('bothGlassClamp','bothGlassFilter','bothGlassSource'):
            for k in ('sample_clamp_direct','sample_clamp_indirect'): setattr(scene.cycles,k,source_cycles[k])
        if name=='bothGlassFilter':
            scene.cycles.blur_glossy=source_cycles['blur_glossy']
        if name=='bothGlassSource':
            for k,v in source_cycles.items(): setattr(scene.cycles,k,v)
        settings[name]={k:getattr(scene.cycles,k) for k in source_cycles}
        for seed in (17,53):
            scene.cycles.seed=seed; path=args.out/f'{name}-{seed}.exr'; scene.render.filepath=str(path)
            bpy.ops.render.render(write_still=True)
            values,positions=read(path); results[name,seed]=values
            np.save(args.out/f'{name}-{seed}.npy',values)
            if name=='dry' and seed==17: dry_positions=positions.copy()
            if 'Glass' in name:
                # The bottom-reflected lamp survives visible_glossy=False after transmission.
                # Subtract a black, non-specular floor control to isolate the tile.
                bsdf.inputs['Specular IOR Level'].default_value=0.
                control=args.out/f'{name}-black-{seed}.exr'; scene.render.filepath=str(control)
                bpy.ops.render.render(write_still=True)
                background,_=read(control); backgrounds[name,seed]=background
                results[name,seed]=values-background
                np.save(args.out/f'{name}-tile-{seed}.npy',values-background)
                bsdf.inputs['Specular IOR Level'].default_value=.5
    points=[]; v=gltf(view)
    for y in range(12,85,12):
        for x in range(12,85,12):
            p=gltf(dry_positions[y,x]); wet=floor_position(p,v)
            analytic={}; low={}
            for steps,dest in ((401,analytic),(201,low)):
                dry=integrate(p,v,light,steps)[2]
                l=slab_integral(p,v,light,steps,False)
                both=slab_integral(wet,v,light,steps,False)
                glass_value=slab_integral(wet,v,light,steps,True)*(1-fresnel(v[1],IOR))**2
                dest.update({k:(a*radiance).tolist() for k,a in zip(conditions,(dry,l,both,glass_value,glass_value,glass_value,glass_value))})
            points.append({'pixel':[x,y],'dryPosition':p.tolist(),'wetPosition':wet.tolist(),'analytic':analytic,'integration201':low,
                           'cycles':{name:[results[name,seed][y,x].tolist() for seed in (17,53)] for name in conditions},
                           'blackFloor':{name:[backgrounds[name,seed][y,x].tolist() for seed in (17,53)] for name in conditions if 'Glass' in name}})
    scores={}
    for name in conditions:
        expected=np.array([p['analytic'][name] for p in points]); measured=np.array([p['cycles'][name] for p in points])
        scores[name]={'cyclesOverAnalyticBySeed':(measured.sum((0,2))/expected.sum()).tolist(),
                      'relativeL1':float(np.abs(measured.mean(1)-expected).sum()/expected.sum()),
                      'integration201Over401':float(np.array([p['integration201'][name] for p in points]).sum()/expected.sum()),
                      'sumBySeed':measured.sum((0,2)).tolist()}
    assert before==hashlib.sha256(source.read_bytes()).hexdigest()
    here=Path(__file__).resolve().parent
    report={'blendSha256':before,'blender':bpy.app.version_string,'samples':args.samples,'seeds':[17,53],
            'scripts':{f:hashlib.sha256((here/f).read_bytes()).hexdigest() for f in ('diagnose_water_gloss_slab.py','diagnose_water_gloss_calibration.py','diagnose_water_floor_disk.py','water_gloss.py')},
            'sourceCycles':source_cycles,'settings':settings,'view':v.tolist(),'waterIOR':IOR,'slabBounds':[BOTTOM,LEVEL],
            'tileDistribution':bsdf.distribution,'lightRadiance':radiance.tolist(),'scores':scores,'points':points}
    (args.out/'slab.json').write_text(json.dumps(report,indent=1)+'\n')
    print('SLAB',json.dumps(scores),flush=True)


if __name__=='__main__': main()
