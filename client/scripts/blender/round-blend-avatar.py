"""TASK-125: soften a faceted hand-built figure into rounder, smooth-shaded shapes for the game.

Opens the source .blend, edits a copy and saves it to <out.blend>; the source file is untouched.
Every part is baked to a mesh, the low-poly body parts get one Catmull-Clark subdivision and are
then decimated back to a per-part budget (rounder silhouettes, jagged hair tips softened), the
over-dense arms and curve features are thinned, and all parts are smooth-shaded by angle so only
real creases stay sharp. The stick-like two-ring neck and the floating, lopsided V collar are
rebuilt first: a tapered neck that flares into the tunic and a symmetric V lying on the cloth.
The result is then imported with import-blend-avatar.py.

An optional body scale (e.g. 1.12 for Lukas) enlarges everything below the head about the soles
and lifts the head onto the longer neck unchanged, so a character can be bigger than another
while keeping the shared head size. An optional width factor (e.g. .94 for Dan) narrows the body
the same way without changing its height. --no-collar removes the V neckline pieces.

Run (Blender 4.2+):
  blender -b <source.blend> -P client/scripts/blender/round-blend-avatar.py -- <out.blend> [body_scale] [body_width] [--no-collar]
"""
import bmesh
import bpy
import math
import sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
FLAGS = {a for a in ARGS if a.startswith('--')}
ARGS = [a for a in ARGS if not a.startswith('--')]
OUT = ARGS[0]
BODY_SCALE = float(ARGS[1]) if len(ARGS) > 1 else 1.0
BODY_WIDTH = float(ARGS[2]) if len(ARGS) > 2 else 1.0  # extra width/depth factor for a slimmer or broader build
COLLAR = '--no-collar' not in FLAGS  # --no-collar: a plain closed neckline without the V
BUDGET = 7600  # leaves room under the importer's 7800 triangle budget
SKIP = ('studio floor', 'pedestal', 'backdrop')  # staging, not the character
FEATURES = ('eye', 'ear', 'nose', 'mouth', 'glasses')
HEAD_PARTS = ('hair', 'head', 'glasses') + FEATURES  # small facial parts: keep their shape exactly
# Parts rounded by subdivision, with their share of the budget relative to the source count.
ROUND = {'hair': 1.25, 'head': 1.6, 'tunic': 1.1, 'shirt': 1.1, 'sleeve': 1.3, 'sash': 1.3, 'linen': 1.7}
# Parts that only need thinning: dense arms, and small accessories whose stitching curves and
# round freckles/buttons cost far more triangles than they show. Boots keep their crisp shape.
THIN = {'arm': .32, 'freckle': .35, 'satchel': .45, 'vest': .5, 'compass': .5, 'notebook': .6,
        'left wrist': .6, 'right wrist': .6, 'apron': .5, 'pocket': .4, 'patch': .4, 'ruler': .4,
        'folding ruler': .5, 'hammer': .6, 'brooch': .8, 'belt': .7}


def triangles(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def make_active(o):
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def bake(o):
    """Turn curves and modifier stacks into a plain mesh (curves at a lighter resolution)."""
    if o.type == 'CURVE':
        glasses = o.name.lower().startswith('glasses')  # chunky frames read fine with a square section
        o.data.resolution_u = max(2, o.data.resolution_u // (4 if glasses else 3))
        o.data.bevel_resolution = 0 if glasses else min(o.data.bevel_resolution, 1)
    make_active(o)
    bpy.ops.object.convert(target='MESH')


def apply(o, kind, **settings):
    make_active(o)
    mod = o.modifiers.new(kind.lower(), kind)
    for key, value in settings.items():
        setattr(mod, key, value)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def key(o):
    lower = o.name.lower()
    return next((k for k in (*ROUND, *THIN) if lower.startswith(k)), None)


def replace_mesh(name, verts, faces, front=False):
    """Swap an object's geometry for world-space verts/faces, keeping its name and materials."""
    o = bpy.data.objects[name]
    inverse = o.matrix_world.inverted()
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(inverse @ Vector(v)) for v in verts], [], faces)
    for material in o.data.materials:
        mesh.materials.append(material)
    o.data = mesh
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if front:  # flat cloth pieces must face the viewer (-Y) for single-sided game materials
        flip = [f for f in bm.faces if (o.matrix_world.to_3x3() @ f.normal).y > 0]
        bmesh.ops.reverse_faces(bm, faces=flip)
    bm.to_mesh(mesh)
    bm.free()


def rebuild_neck():
    rings = NECK_RINGS
    seg, cy = 16, NECK_Y
    verts = [(math.cos(2 * math.pi * i / seg) * rx, cy + math.sin(2 * math.pi * i / seg) * ry, z)
             for z, rx, ry in rings for i in range(seg)]
    faces = [(r * seg + i, r * seg + (i + 1) % seg, (r + 1) * seg + (i + 1) % seg, (r + 1) * seg + i)
             for r in range(len(rings) - 1) for i in range(seg)]
    replace_mesh('Neck', verts, faces)


def neck_front(x, z):
    """Front surface (y) of the rebuilt neck at height z and side offset x."""
    below = max((r for r in NECK_RINGS if r[0] <= z), default=NECK_RINGS[0])
    above = min((r for r in NECK_RINGS if r[0] >= z), default=NECK_RINGS[-1])
    t = 0.0 if above[0] == below[0] else (z - below[0]) / (above[0] - below[0])
    rx, ry = below[1] + (above[1] - below[1]) * t, below[2] + (above[2] - below[2]) * t
    return NECK_Y - ry * math.sqrt(max(0.0, 1 - (x / rx) ** 2))


def tuck_cords():
    """Necklace cords were drawn around the old, thinner neck: end them inside the base of the new
    one so they lie on the chest instead of standing up beside it."""
    for o in bpy.data.objects:
        if o.type != 'CURVE' or 'necklace' not in o.name.lower():
            continue
        world, inverse = o.matrix_world, o.matrix_world.inverted()
        for spline in o.data.splines:
            for p in (spline.bezier_points[0], spline.bezier_points[-1]):
                w = world @ p.co
                x, z = math.copysign(.17, w.x), 3.0  # the base of the neck, just above the collar
                delta = Vector((x, neck_front(x, z) + .03, z)) - w
                for attr in ('co', 'handle_left', 'handle_right'):
                    setattr(p, attr, inverse @ (world @ getattr(p, attr) + delta))


# Neck rings (height, half width, half depth): wide where it meets the shoulders, slimmest
# mid-way, widening again into the jaw; the lowest ring stays hidden inside the tunic.
NECK_RINGS = [(2.88, .24, .17), (2.98, .215, .165), (3.06, .18, .155), (3.16, .158, .15),
             (3.28, .155, .152), (3.4, .17, .165)]
NECK_Y = .015


def rebuild_collar():
    """Symmetric V neckline lying on the tunic: a skin wedge framed by a cream band."""
    tunic = bpy.data.objects['Tunic • continuous shoulders and bodice']
    tree = BVHTree.FromObject(tunic, bpy.context.evaluated_depsgraph_get())
    inverse = tunic.matrix_world.inverted()

    def on_cloth(x, z, lift):
        hit = tree.ray_cast(inverse @ Vector((x, -3, z)), Vector((0, 1, 0)))
        y = (tunic.matrix_world @ hit[0]).y if hit[0] else -.2
        return (x, y - lift, z)
    top, tip, steps = 2.975, 2.83, 6
    inner = [(t, .1 * (1 - t), tip + (top - tip) * (1 - t)) for t in (i / steps for i in range(steps + 1))]
    skin_verts = [on_cloth(side * x, z, .012) for _, x, z in inner for side in (-1, 1)]
    skin_faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(steps)]
    replace_mesh('Neckline skin inset', skin_verts, skin_faces, front=True)
    band, verts, faces = .045, [], []
    for side in (-1, 1):
        start = len(verts)
        for _, x, z in inner:
            verts += [on_cloth(side * x, z, .018), on_cloth(side * (x + band), z, .018)]
        faces += [(start + 2 * i, start + 2 * i + 1, start + 2 * i + 3, start + 2 * i + 2) for i in range(steps)]
    replace_mesh('Cream neckline facing', verts, faces, front=True)


def face_forward(prefixes=('eyebrow',)):
    """Flat one-sided features must face the viewer (-Y): the game material culls back faces,
    and in the source files the left brow polygon faces into the head, so it vanished in game."""
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.name.lower().startswith(prefixes):
            continue
        normals = o.matrix_world.to_3x3().inverted().transposed()
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.reverse_faces(bm, faces=[f for f in bm.faces if (normals @ f.normal).y > 0])
        bm.to_mesh(o.data)
        bm.free()


rebuild_neck()
tuck_cords()
face_forward()
def scale_body(objects, factor, width):
    """Grow the body about the soles; the head and neck keep their size and ride up with the
    shoulders, so the visible neck stays as long as on the other characters."""
    sole = min((o.matrix_world @ Vector(c)).z for o in objects for c in o.bound_box)
    tunic = bpy.data.objects['Tunic • continuous shoulders and bodice']
    shoulders = max((tunic.matrix_world @ v.co).z for v in tunic.data.vertices)
    lift = (shoulders - sole) * (factor - 1)
    for o in objects:
        if o.name.lower().startswith(HEAD_PARTS + ('neck',)) and 'neckline' not in o.name.lower():
            o.matrix_world = Matrix.Translation((0, 0, lift)) @ o.matrix_world
        else:
            grow = Matrix.Diagonal((factor * width, factor * width, factor, 1))
            o.matrix_world = Matrix.Translation((0, 0, sole)) @ grow @ Matrix.Translation((0, 0, -sole)) @ o.matrix_world


objects = [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE') and o.visible_get()
           and not any(word in o.name.lower() for word in SKIP)]
if BODY_SCALE != 1.0 or BODY_WIDTH != 1.0:
    scale_body(objects, BODY_SCALE, BODY_WIDTH)
for o in objects:
    bake(o)
source = {o.name: triangles(o) for o in objects}
targets = {}
for o in objects:
    k = key(o)
    share = ROUND.get(k) or THIN.get(k) or 1.0
    targets[o.name] = source[o.name] * share
fixed = sum(source[o.name] for o in objects if key(o) is None)
flexible = sum(targets[o.name] for o in objects if key(o) is not None)
fit = min(1.0, (BUDGET - fixed) / flexible)

for o in objects:
    k = key(o)
    if k in ROUND:
        apply(o, 'SUBSURF', levels=1, render_levels=1, quality=3)
    if k is not None:
        target = targets[o.name] * fit
        count = triangles(o)
        if count > max(target, 24):  # tiny panels would collapse into stray triangles
            apply(o, 'DECIMATE', ratio=target / count)
    make_active(o)
    angle = 30 if o.name.lower().startswith(FEATURES) else 55
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))

if COLLAR:
    rebuild_collar()  # last, so the V lies on the final rounded and scaled tunic surface
else:
    for name in ('Neckline skin inset', 'Cream neckline facing'):
        if name in bpy.data.objects:
            objects.remove(bpy.data.objects[name])
            bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
total = sum(triangles(o) for o in objects)
print('rounded', len(objects), 'parts, triangles', sum(source.values()), '->', total, 'fit', round(fit, 3))
bpy.ops.wm.save_as_mainfile(filepath=OUT, copy=True)
print('saved', OUT)
