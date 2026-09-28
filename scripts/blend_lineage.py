"""Source blend revisions that keep the geometry of their parent.

Fixtures made from traced geometry (endpoints, paths, probe positions) stay
valid across these revisions; anything rendered by Cycles does not.
"""

# SUI_Retreat.blend after scripts/flatten_water_sides.py -> before (V11 as rendered in blender/renders/).
SHADING_ONLY = {
    'f1ee4ddda36d6532420fc12107d24bd1eedcbaa13fd5466f476f612e8f005ed0':
        'edf3c35b93e162afe66786f626423bb42aeeb813c049930681586ee1fdfba6af',
}
# SUI_Retreat.blend after scripts/build_sky_world.py -> before (SUI_Retreat_v12.blend). Only the
# worlds changed, and only on paths without a diffuse bounce.
WORLD_ONLY = {
    'f8fa0a979149fd8cd6c62f1c920e2ea7a19c1ec0b603ec1724b5bb7242b19901':
        'f1ee4ddda36d6532420fc12107d24bd1eedcbaa13fd5466f476f612e8f005ed0',
}

# SUI_Retreat.blend -> (the revision before a scene was added, that scene's key). The other scenes,
# their worlds and all objects are unchanged (scripts/build_night_scene.py compares them).
ADDED_SCENE = {
    # scripts/build_night_scene.py, then scripts/build_sky_world.py --keys night (SUI_Retreat_v13.blend).
    'd7969b95d153e78c7675db1fc66fa5f220f79dbab43bc3cd18ca642c518fe753':
        ('f8fa0a979149fd8cd6c62f1c920e2ea7a19c1ec0b603ec1724b5bb7242b19901', 'night'),
}


def geometry_root(sha):
    """Oldest revision with the same geometry as `sha`."""
    while sha in SHADING_ONLY or sha in WORLD_ONLY or sha in ADDED_SCENE:
        sha = SHADING_ONLY.get(sha) or WORLD_ONLY.get(sha) or ADDED_SCENE[sha][0]
    return sha


def same_geometry(a, b):
    return geometry_root(a) == geometry_root(b)
