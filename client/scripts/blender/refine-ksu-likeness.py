"""TASK-125: refine the hand-built Ksu figure towards the player's own look (requested by her).

Opens the source .blend, edits a copy and saves it to <out.blend>; the source file is untouched.
Changes: lighter warm skin with blush, almond brown eyes with pupils, glints and lash wings,
softer thinner brows, pink lips, a smaller nose, shoulder-length wavy darker-brown hair with
lighter ends tucked behind the right ear (with a small stud), a slimmer figure and a longer neck.
No photo is stored or read here; the values below are hand-picked.

Run (Blender 4.2+):
  blender -b <source.blend> -P client/scripts/blender/refine-ksu-likeness.py -- <out.blend>
"""
import bmesh
import bpy
import math
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1]
NECK = .035  # extra neck length; everything on the head moves up by this much


def linear(hexa):
    def channel(c):
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return tuple(channel(int(hexa[i:i + 2], 16) / 255) for i in (1, 3, 5))


def set_colour(material, hexa, factor=1.0):
    rgb = tuple(min(1.0, c * factor) for c in linear(hexa))
    material.diffuse_color = (*rgb, 1)
    if material.use_nodes:
        for node in material.node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                node.inputs['Base Color'].default_value = (*rgb, 1)


def recolour(prefix, hexa, spread=.05):
    for material in bpy.data.materials:
        if material.name.startswith(prefix):
            tone = material.name.rsplit('tone ', 1)
            index = int(tone[1]) if len(tone) == 2 and tone[1].isdigit() else 1.5
            set_colour(material, hexa, 1 + (index - 1.5) * spread)


def new_material(name, hexa):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    set_colour(material, hexa)
    return material


def edit(obj, fn):
    """Apply a world-space point function to a mesh's vertices or a curve's control points."""
    world, inverse = obj.matrix_world, obj.matrix_world.inverted()
    if obj.type == 'MESH':
        for v in obj.data.vertices:
            v.co = inverse @ fn(world @ v.co)
        obj.data.update()
    else:
        for spline in obj.data.splines:
            for p in spline.bezier_points:
                for attr in ('co', 'handle_left', 'handle_right'):
                    setattr(p, attr, inverse @ fn(world @ getattr(p, attr)))
            for p in spline.points:
                co = inverse @ fn(world @ Vector(p.co[:3]))
                p.co = (*co, p.co[3])


def world_points(obj):
    if obj.type == 'MESH':
        return [obj.matrix_world @ v.co for v in obj.data.vertices]
    return [obj.matrix_world @ p.co for s in obj.data.splines for p in s.bezier_points]


def centre(obj):
    pts = world_points(obj)
    return sum(pts, Vector()) / len(pts)


def ellipsoid(name, location, radii, hexa, seg=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    mesh.materials.append(new_material(name, hexa))
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def curve(name, points, depth, material):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions, data.bevel_depth, data.bevel_resolution, data.use_fill_caps = '3D', depth, 1, True
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (*p, 1)
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


objects = bpy.data.objects
head_parts = [o for o in objects if o.type in ('MESH', 'CURVE') and o.name.startswith(('Head', 'Hair', 'Eye', 'Ear', 'Nose', 'Mouth'))]

# ---- colours: fair warm skin, darker brown hair with lighter ends, softer brows
recolour('Skin • face', '#f4c9b0', .03)
recolour('Skin • warm peach', '#e9ae97', .03)
recolour('Hair • chestnut', '#3f2b22', .16)
recolour('Brows', '#5e402f')

# ---- longer neck: lift the whole head, stretch the top of the neck
for o in head_parts:
    edit(o, lambda w: w + Vector((0, 0, NECK)))
edit(objects['Neck'], lambda w: Vector((w.x * .96, w.y * .96, w.z + NECK * max(0.0, min(1.0, (w.z - 2.94) / .46)))))

# ---- hair: shoulder length, more volume, soft waves, tucked behind the right ear
SHOULDER_PIVOT = 3.55 + NECK


def hair_shape(w):
    x, y, z = w
    if z < SHOULDER_PIVOT:
        z = SHOULDER_PIVOT - (SHOULDER_PIVOT - z) * 1.5
    cy = .05
    r = math.hypot(x, y - cy)
    angle = math.atan2(y - cy, x)
    grow = 1.05 + max(0.0, 3.15 + NECK - z) * .5
    wave = .028 * math.sin((3.35 + NECK - z) * 13 + angle * 3) if z < 3.35 + NECK else 0
    r = r * grow + wave
    return Vector((math.cos(angle) * r, cy + math.sin(angle) * r, z))


for o in objects:
    if o.name.startswith('Hair'):
        edit(o, hair_shape)
ear_top = 3.9 + NECK


def tuck(w):
    if w.x > .28 and w.z < ear_top and w.y < .12:
        lift = min(1.0, (ear_top - w.z) / .25)
        return Vector((w.x - .03 * lift, w.y + .2 * lift, w.z))
    return w


for name in ('Hair R • cheek lock', 'Hair R • outer sweep', 'Hair R • layered lock 0', 'Hair • crown foundation'):
    edit(objects[name], tuck)
ellipsoid('Earring R stud', (.6, -.035, 3.6 + NECK), (.022, .022, .022), '#efe3c6', 10, 6)

# ---- face: eyes, brows, nose, lips, blush
head = objects['Head • sculpted cheeks and tapered jaw']
graph = bpy.context.evaluated_depsgraph_get()
tree = BVHTree.FromObject(head, graph)


def surface_y(x, z):
    hit = tree.ray_cast(head.matrix_world.inverted() @ Vector((x, -3, z)), Vector((0, 1, 0)))
    return (head.matrix_world @ hit[0]).y if hit[0] else -.42


espresso = bpy.data.materials['Eyes • espresso']
iris_material = new_material('Eyes • brown iris', '#5a3a27')
for side, letter in ((-1, 'L'), (1, 'R')):
    ivory, iris, lid = objects['Eye %s ivory' % letter], objects['Eye %s dark oval' % letter], objects['Eye %s upper lid' % letter]
    c = centre(ivory)

    def almond(w, c=c, side=side):
        dx = w.x - c.x
        return Vector((c.x + dx * 1.04, w.y, c.z + (w.z - c.z) * .74 + .03 * (dx * side / .115)))
    for o in (ivory, lid):
        edit(o, almond)
    lid.data.bevel_depth = .021
    edit(iris, lambda w, c=c: Vector((c.x + (w.x - c.x) * .92, w.y, c.z + .01 + (w.z - c.z) * .8)))
    iris.data.materials.clear()
    iris.data.materials.append(iris_material)
    ic = centre(iris)
    front = min(p.y for p in world_points(iris))
    ellipsoid('Eye %s pupil' % letter, (ic.x, front + .004, ic.z), (.034, .008, .044), '#1c120d')
    ellipsoid('Eye %s glint' % letter, (ic.x + side * .03, front - .002, ic.z + .045), (.017, .006, .019), '#ffffff', 8, 6)
    ends = sorted(world_points(lid), key=lambda p: p.x * side)
    outer, mid = ends[-1], ends[len(ends) // 2]
    curve('Eye %s lash wing' % letter, [tuple(outer), tuple(outer + Vector((side * .055, -.006, .045)))], .011, espresso)
    for t in (.35, .62):
        base = ends[int(len(ends) * t)]
        curve('Eye %s lash' % letter, [tuple(base), tuple(base + Vector((side * .02, -.012, .04)))], .007, espresso)
    brow = objects['Eyebrow %s' % letter]
    b = centre(brow)
    edit(brow, lambda w, b=b: Vector((w.x, w.y, b.z + .02 + (w.z - b.z) * .62 + .016 * (1 - ((w.x - b.x) / .12) ** 2))))
    by = surface_y(side * .31, 3.62 + NECK)
    ellipsoid('Blush %s' % letter, (side * .31, by + .006, 3.62 + NECK), (.085, .01, .042), '#f0aaa2')

nose = objects['Nose • small sculpted wedge']
nc = centre(nose)
edit(nose, lambda w: nc + (w - nc) * .82)
mouth = objects['Mouth • soft smile']
mc = centre(mouth)
edit(mouth, lambda w: Vector((mc.x + (w.x - mc.x) * .78, w.y, w.z)))
mouth.data.bevel_depth = .0065
set_colour(mouth.data.materials[0], '#a65a52')
lips_z = 3.552 + NECK
ellipsoid('Lip upper', (0, surface_y(0, lips_z + .016) + .004, lips_z + .016), (.072, .018, .019), '#d4877f')
ellipsoid('Lip lower', (0, surface_y(0, lips_z - .016) + .003, lips_z - .016), (.06, .02, .023), '#df988f')

# ---- slimmer figure: thinner arms, narrower waist
for letter in ('L', 'R'):
    arm = objects['Arm and hand %s' % letter]
    pts = world_points(arm)
    top_z, bottom_z = max(p.z for p in pts), min(p.z for p in pts)
    top = sum((p for p in pts if p.z > top_z - .08), Vector()) / len([p for p in pts if p.z > top_z - .08])
    bottom = sum((p for p in pts if p.z < bottom_z + .1), Vector()) / len([p for p in pts if p.z < bottom_z + .1])
    axis = (bottom - top).normalized()

    def slim(w, top=top, axis=axis, bottom_z=bottom_z):
        along = top + axis * (w - top).dot(axis)
        factor = .9 if w.z < bottom_z + .2 else .84
        return along + (w - along) * factor
    edit(arm, slim)


def waist(w):
    if abs(w.x) > .5:
        return w
    f = 1 - .1 * math.exp(-((w.z - 2.38) / .22) ** 2)
    return Vector((w.x * f * .97, w.y * f, w.z))


for o in objects:
    if o.type == 'MESH' and o.name.startswith(('Tunic', 'Sash', 'Cream neckline', 'Neckline')):
        edit(o, waist)

bpy.ops.wm.save_as_mainfile(filepath=OUT, copy=True)
print('saved', OUT)
