"""Derive Lukas from the hand-built Ksu figure so all players share one body and style.

Opens the Ksu source .blend, edits a copy and saves it to <out.blend>; the source is untouched.
Following docs/game/images/lukas.png: short spiky sandy hair made of leaf-shaped tufts on a skull
cap (ears left visible), black rectangular glasses, dark oval eyes without whites, fuller brows,
a teal tunic with teal turned cuffs. Body, trousers, boots, sash and face proportions stay.
Then run round-blend-avatar.py and import-blend-avatar.py with the id "lukas".

Run (Blender 4.2+):
  blender -b <ksu source.blend> -P client/scripts/blender/make-lukas-from-blend.py -- <out.blend>
"""
import bmesh
import bpy
import math
import random
import sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1]
HEAD_CENTRE = Vector((0, .02, 3.88))
CAP = Vector((.66, .54, .7))  # skull-cap radii: the hair mass sits a little off the head
HAIR_TONES = ('#c29a50', '#ab8240', '#d0a860')
random.seed(125)


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


def link_mesh(name, verts, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def curve(name, points, depth, material, closed=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions, data.bevel_depth, data.bevel_resolution, data.use_fill_caps = '3D', depth, 1, True
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (*p, 1)
    spline.use_cyclic_u = closed
    data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def points(o):
    if o.type == 'MESH':
        return [o.matrix_world @ v.co for v in o.data.vertices]
    return [o.matrix_world @ p.co for s in o.data.splines for p in s.bezier_points]


def centre(o):
    p = points(o)
    return sum(p, Vector()) / len(p)


def remove(o):
    bpy.data.objects.remove(o, do_unlink=True)


objects = bpy.data.objects
head = objects['Head • sculpted cheeks and tapered jaw']
tree = BVHTree.FromObject(head, bpy.context.evaluated_depsgraph_get())


def head_front(x, z):
    hit = tree.ray_cast(head.matrix_world.inverted() @ Vector((x, -3, z)), Vector((0, 1, 0)))
    return (head.matrix_world @ hit[0]).y if hit[0] else -.4


# ---- colours: teal tunic and cuffs, sandy brows
recolour('Tunic • dusty blue', '#3f8b88')
cuff = new_material('Tunic • teal cuff', '#357a77')
for letter in ('L', 'R'):
    sleeve = objects['Sleeve %s cream turned cuff' % letter]
    sleeve.data.materials.clear()
    sleeve.data.materials.append(cuff)
recolour('Brows', '#8a6638')

# ---- hair: skull cap with a short hairline (ears visible) and leaf-shaped spiky tufts
for o in [o for o in objects if o.name.startswith('Hair')]:
    remove(o)
tones = [new_material('Hair • sandy tone %d' % i, hexa) for i, hexa in enumerate(HAIR_TONES)]


def on_cap(direction, inset=0.0):
    d = direction.normalized()
    scale = 1 / math.sqrt((d.x / CAP.x) ** 2 + (d.y / CAP.y) ** 2 + (d.z / CAP.z) ** 2)
    return HEAD_CENTRE + d * scale * (1 - inset)


def hairline(p):
    front = max(0.0, min(1.0, -(p.y - HEAD_CENTRE.y) / .42)) * max(0.0, min(1.0, (.5 - abs(p.x)) / .16))
    back = max(0.0, min(1.0, (p.y - HEAD_CENTRE.y) / .45))
    return 3.93 + .22 * front - .58 * back


bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1)
for v in bm.verts:
    v.co = on_cap(v.co)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < hairline(f.calc_center_median())], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
cap = bpy.data.meshes.new('Hair • sandy cap')
bm.to_mesh(cap)
bm.free()
cap.materials.append(tones[0])
cap_obj = bpy.data.objects.new('Hair • sandy cap', cap)
bpy.context.scene.collection.objects.link(cap_obj)


def tuft(name, base, normal, direction, length, radius, material, sides=6):
    """A flat, leaf-shaped clump lying along the head and bending towards its tip."""
    axis = direction.normalized()
    side = axis.cross(normal)
    if side.length < 1e-3:
        side = axis.cross(Vector((0, 0, 1)))
    side.normalize()
    other = side.cross(axis)  # thickness, roughly along the head normal
    bend = (axis - normal * axis.dot(normal)) * .0 + Vector((0, .12, .05))
    rings = [(-.1, radius * .9), (.3, radius), (.62, radius * .62), (.85, radius * .3)]
    verts = []
    for along, r in rings:
        middle = base + axis * (along * length) + bend * (along ** 2) * length
        verts += [middle + (side * math.cos(2 * math.pi * i / sides) + other * math.sin(2 * math.pi * i / sides) * .45) * r
                  for i in range(sides)]
    verts.append(base + axis * length + bend * length)
    tip = len(verts) - 1
    faces = [tuple(range(sides))[::-1]]
    for ring in range(len(rings) - 1):
        a, b = ring * sides, (ring + 1) * sides
        faces += [(a + i, a + (i + 1) % sides, b + (i + 1) % sides, b + i) for i in range(sides)]
    last = (len(rings) - 1) * sides
    faces += [(last + i, last + (i + 1) % sides, tip) for i in range(sides)]
    return link_mesh(name, verts, faces, material)


count = 0


def spray(elevation, azimuths, length, radius, out, target, only=None):
    """Clumps rooted on a band of the cap, combed along the head towards `target` and lifted
    off it by `out` (0 lies flat, 1 points straight out), so only the tips stand up."""
    global count
    goal = Vector(target).normalized()
    for az in azimuths:
        az += random.uniform(-.12, .12)
        el = math.radians(elevation + random.uniform(-6, 6))
        d = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
        if only and not only(d):
            continue
        tangent = goal - d * goal.dot(d)
        if tangent.length < 1e-3:
            tangent = Vector((0, 1, 0)) - d * d.y
        direction = (tangent.normalized() + d * out).normalized()
        tuft('Hair • sandy tuft %d' % count, on_cap(d, .07), d, direction, length * random.uniform(.85, 1.15),
             radius * random.uniform(.9, 1.1), tones[count % len(tones)])
        count += 1


ring = lambda n, offset=0.0: [2 * math.pi * (i + offset) / n for i in range(n)]
up_back, down = (0, .45, 1), (0, .3, -1)
spray(28, ring(13), .36, .24, .35, up_back)                                     # lower band, combed up
spray(52, ring(10, .5), .4, .24, .55, up_back)                                  # upper band
spray(76, ring(5, .2), .42, .23, .9, up_back)                                   # crown spikes
spray(38, [-.55, -.2, .15, .5], .42, .24, .6, (0, .1, 1), lambda d: d.y < 0)    # forelock rising off the brow
spray(-8, ring(10, .5), .24, .2, .3, down, lambda d: d.y > .1)                  # short back, combed down
spray(14, [-1.4, 1.4, -1.85, 1.85], .22, .18, .25, (0, .5, -.3))                # above the ears, combed back

# ---- eyes: dark ovals without whites, small glints; fuller, straighter brows
glint = new_material('Eyes • glint', '#ffffff')
for side, letter in ((-1, 'L'), (1, 'R')):
    remove(objects['Eye %s ivory' % letter])
    remove(objects['Eye %s upper lid' % letter])
    oval = objects['Eye %s dark oval' % letter]
    c = centre(oval)
    back = max(p.y for p in points(oval))
    surface = head_front(c.x, c.z)
    shift = surface + .012 - back
    for v in oval.data.vertices:
        w = oval.matrix_world @ v.co
        w = Vector((c.x + (w.x - c.x) * .82, w.y + shift, c.z + (w.z - c.z) * .82))
        v.co = oval.matrix_world.inverted() @ w
    front = min(p.y for p in points(oval))
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1)
    for v in bm.verts:
        v.co = Vector((c.x + side * .025 + v.co.x * .022, front - .002 + v.co.y * .006, c.z + .04 + v.co.z * .024))
    mesh = bpy.data.meshes.new('Eye %s glint' % letter)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(glint)
    o = bpy.data.objects.new('Eye %s glint' % letter, mesh)
    bpy.context.scene.collection.objects.link(o)
    brow = objects['Eyebrow %s' % letter]
    b = centre(brow)
    for v in brow.data.vertices:
        w = brow.matrix_world @ v.co
        w = Vector((w.x, w.y, b.z - .015 + (w.z - b.z) * 1.5))
        v.co = brow.matrix_world.inverted() @ w

# ---- glasses: black rectangular frames, a bridge and temples back to the ears
black = new_material('Glasses • black', '#1b1817')
frame_y = -.5
for side, letter in ((-1, 'L'), (1, 'R')):
    cx, cz, hw, hh, r = side * .24, 3.86, .19, .135, .04
    corners = []
    for qx, qz, start in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(3):
            a = math.radians(start + 45 * k)
            corners.append((cx + qx * (hw - r) + math.cos(a) * r, frame_y, cz + qz * (hh - r) + math.sin(a) * r))
    curve('Eye glasses %s frame' % letter, corners, .028, black, closed=True)
    outer = (side * (.24 + .19), frame_y, 3.9)
    curve('Eye glasses %s temple' % letter, [outer, (side * .52, -.3, 3.9), (side * .57, -.02, 3.86)], .016, black)
curve('Eye glasses bridge', [(-.05, frame_y, 3.9), (0, frame_y - .01, 3.92), (.05, frame_y, 3.9)], .024, black)

bpy.ops.wm.save_as_mainfile(filepath=OUT, copy=True)
print('lukas tufts', count, 'saved', OUT)
