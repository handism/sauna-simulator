"""Source blend revisions that differ from their parent only in shading flags.

Fixtures made from traced geometry (endpoints, paths, probe positions) stay
valid across these revisions; anything rendered by Cycles does not.
"""

# SUI_Retreat.blend after scripts/flatten_water_sides.py -> before (V11 as rendered in blender/renders/).
SHADING_ONLY = {
    'f1ee4ddda36d6532420fc12107d24bd1eedcbaa13fd5466f476f612e8f005ed0':
        'edf3c35b93e162afe66786f626423bb42aeeb813c049930681586ee1fdfba6af',
}


def geometry_root(sha):
    """Oldest revision with the same geometry as `sha`."""
    while sha in SHADING_ONLY:
        sha = SHADING_ONLY[sha]
    return sha


def same_geometry(a, b):
    return geometry_root(a) == geometry_root(b)
