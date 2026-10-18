"""Deterministic web-export geometry for the heater, cedar pail and wooden ladle.

Called before material conversion by export_web_glb.py. Never saves the blend.
Coordinates are Blender metres; the heater/steam and pail centres stay fixed.
"""
import math
import random

import bpy
import bmesh
from mathutils import Vector


def refine_loyly_props():
    rng = random.Random(1927)
    removed = []
    exact = {'Cedar water pail', 'Dark pail interior', 'Ladle handle', 'Torus', 'Torus.001'}
    for obj in list(bpy.context.scene.objects):
        if obj.name in exact or obj.name.startswith(('Heater inner vessel', 'Heater vertical cage', 'Olivine sauna stone')):
            # The two generically named hoops are only accepted at the known pail.
            if obj.name.startswith('Torus'):
                assert (obj.location - Vector((-2.1, 1.74, obj.location.z))).length < 1e-5
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)
    assert len(removed) == 76, removed
    created = []

    def material(name, color, roughness, metal=0):
        mat = bpy.data.materials.new('Loyly | ' + name)
        mat.use_nodes = True
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metal
        return mat

    iron = material('blackened iron', (.042, .047, .05), .39, .82)
    band = material('brushed iron bands', (.095, .105, .11), .34, .85)
    water = material('recessed pail water', (.012, .02, .017), .12)
    wood = bpy.data.materials['V2 | warm open-grain timber'].copy()
    wood.name = 'Loyly | cedar grain'
    for node in wood.node_tree.nodes:
        if node.type == 'VALTORGB':
            for stop in node.color_ramp.elements:
                c = stop.color
                if abs(c[0] - c[1]) + abs(c[1] - c[2]) > .005:
                    stop.color = (c[0] * .72, c[1] * .83, c[2] * .98, c[3])
    stone = bpy.data.materials['V2 | mineral charcoal stone'].copy()
    stone.name = 'Loyly | split olivine'
    # Keep the packed stone images, but use a cooler charcoal colour ramp.
    for node in stone.node_tree.nodes:
        if node.type == 'VALTORGB':
            for stop in node.color_ramp.elements:
                c = stop.color
                if abs(c[0] - c[1]) + abs(c[1] - c[2]) > .005:
                    grey = sum(c[:3]) / 3
                    stop.color = (grey * .37, grey * .42, grey * .45, c[3])

    def finish(obj, name, mat, bevel=0):
        obj.name = 'Loyly ' + name
        obj.data.materials.clear()
        obj.data.materials.append(mat)
        if bevel:
            mod = obj.modifiers.new('Small manufactured edge', 'BEVEL')
            mod.width = bevel
            mod.segments = 2
        created.append(obj)
        return obj

    def lathe(name, profile, center, mat, segments=48, start=0, sweep=math.tau):
        # Closed profile in (radius, height), ordered along the exterior upwards.
        closed = abs(sweep - math.tau) < 1e-6
        columns = segments if closed else segments + 1
        vertices = [(r * math.cos(start + sweep * i / segments),
                     r * math.sin(start + sweep * i / segments), z)
                    for i in range(columns) for r, z in profile]
        size = len(profile)
        faces = []
        for i in range(segments):
            j = (i + 1) % columns
            for k in range(size):
                n = (k + 1) % size
                faces.append((i * size + k, j * size + k, j * size + n, i * size + n))
        if not closed:
            faces.extend([tuple(reversed(range(size))), tuple(segments * size + k for k in range(size))])
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        uv = mesh.uv_layers.new()
        for face in mesh.polygons:
            for loop in face.loop_indices:
                index = mesh.loops[loop].vertex_index
                col, row = divmod(index, size)
                uv.data[loop].uv = (col / segments * sweep / math.tau, profile[row][1] * 1.7)
            face.use_smooth = closed and abs(face.normal.z) < .95
        # Merge lathe poles; no collapsed rings/zero-area faces at the bowl bottom.
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.location = center
        return finish(obj, name, mat)

    def ring(name, radius, bottom, height, thickness, center, mat):
        return lathe(name, [(radius, bottom), (radius, bottom + height),
                            (radius - thickness, bottom + height), (radius - thickness, bottom)], center, mat)

    heater = (-1.25, 1.28, 0)
    ring('heater foot', .356, .102, .065, .027, heater, iron)
    # Solid lower shield and open stone basket above; no flat lid behind the stones.
    ring('heater lower shield', .358, .16, .43, .016, heater, iron)
    ring('heater lower collar', .395, .17, .035, .018, heater, band)
    ring('heater upper collar', .397, 1.008, .035, .018, heater, band)
    ring('heater basket collar', .395, .58, .025, .015, heater, iron)
    for i in range(24):
        a = math.tau * i / 24
        bpy.ops.mesh.primitive_cube_add(size=1, location=(heater[0] + .38 * math.cos(a), heater[1] + .38 * math.sin(a), .62))
        obj = bpy.context.object
        obj.scale = (.026, .017, .82)
        obj.rotation_euler.z = a
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        finish(obj, f'heater rib {i:02}', iron, .003)
    for layer, z in enumerate((.66, .81, .96, 1.055)):
        # Staggered packing keeps the basket full, with a broken, uneven top silhouette.
        for i in range(10 if layer < 3 else 8):
            a = math.tau * i / (10 if layer < 3 else 8) + layer * .39
            r = .25 + rng.uniform(-.025, .025)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1,
                location=(heater[0] + r * math.cos(a), heater[1] + r * math.sin(a), z + rng.uniform(-.025, .025)))
            obj = bpy.context.object
            for vertex in obj.data.vertices:
                vertex.co *= rng.uniform(.84, 1.12)
            obj.scale = (rng.uniform(.087, .115), rng.uniform(.074, .105), rng.uniform(.065, .09))
            obj.rotation_euler = (rng.random(), rng.random(), a)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            finish(obj, f'olivine {layer}-{i}', stone, .005)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=.14, location=(heater[0], heater[1], z))
        finish(bpy.context.object, f'olivine core {layer}', stone, .003)

    pail = (-2.1, 1.74, 0)
    # Eighteen separate tapered staves: real inner walls and a bevelled end-grain rim.
    for i in range(18):
        profile = [(.181, .108), (.187, .113), (.224, .443), (.222, .454),
                   (.201, .454), (.199, .443), (.164, .139), (.164, .108)]
        lathe(f'cedar stave {i:02}', profile, pail, wood, 3,
              start=i * math.tau / 18 + .002, sweep=math.tau / 18 - .004)
    lathe('pail bottom', [(0, .11), (.177, .11), (.177, .14), (0, .14)], pail, wood)
    for height, radius in ((.175, .197), (.371, .219)):
        ring('pail hoop', radius, height, .027, .005, pail, band)
    # Single alpha-blended surface: see the real bottom through it, without a
    # second underside layer. Reflections use the existing soft probe approximation.
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=.19, fill_type='NGON',
                                     location=(pail[0], pail[1], .355))
    finish(bpy.context.object, 'pail water', water)
    # Shallow hollow bowl, oval in plan. The raised handle rests on the opposite rim.
    bowl = lathe('ladle bowl', [(0, 0), (.031, .004), (.057, .021), (.07, .044),
                              (.073, .052), (.067, .056), (.061, .044), (.046, .025), (.024, .014), (0, .014)],
                 (-2.195, 1.74, .399), wood, 32)
    bowl.scale = (1.14, 1, 1)
    handle = lathe('ladle shaped handle', [(0, 0), (.013, 0), (.018, .09), (.014, .35),
                                         (.021, .49), (.018, .515), (0, .522)],
                   (-2.13, 1.74, .438), wood, 12)
    direction = Vector((.51, 0, .115))
    handle.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    return {'removed': removed, 'created': [o.name for o in created],
            'seed': 1927, 'heater_center': list(heater), 'pail_center': list(pail),
            'water': 'alpha-blended recessed surface with reflection probes; no refraction or simulation',
            'preserve_geometry': [o.name for o in created]}
