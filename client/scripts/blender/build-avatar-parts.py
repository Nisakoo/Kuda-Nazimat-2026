"""TASK-125: original player-avatar sculpture authored with Blender. No imported art or textures.

Run from the repository root (Blender 4.2+):
  blender -b --factory-startup -P client/scripts/blender/build-avatar-parts.py -- [out_dir] [ids...]

Coordinates are written exactly as authored, in the three.js convention used by
generate-avatar-models.mjs: metres, +Y up, +Z forward. Every part is modelled in the
local space of its rig joint (torso, neck, head, face, hair, shoulder-*, elbow-*, wrist-*,
hip-*, knee-*, ankle-*). The Node generator keeps the rig, clips and final proportions and
uses these surfaces instead of its procedural fallback.
"""
import bmesh
import bpy
import json
import math
import os
import random
import sys
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.join(HERE, '..', 'avatar-parts')
IDS = ARGS[1:] or ['lukas', 'nic', 'dan', 'ksu']

LOOKS = {
    'lukas': dict(tunic='#2f7f88', belt='#d19f3b', hair='#e2c077', hair_dark='#bf9449', brow='#7d5630',
                  glasses='#1d2023', frame=.0105, lens='rect', style='spiky', broad=True),
    'nic': dict(tunic='#6f7a47', belt='#bb6440', hair='#ad7d4c', hair_dark='#8a6139', brow='#5c3d24',
                glasses='#b8b7ad', frame=.0048, lens='rect-soft', style='short'),
    'dan': dict(tunic='#b9553a', belt='#3f8081', hair='#5a3a29', hair_dark='#3d281d', brow='#2f2017',
                glasses='#c3c0b0', frame=.0048, lens='rect', style='tousled'),
    'ksu': dict(tunic='#8ba8cf', belt='#d19f3b', hair='#614030', hair_dark='#452d22', brow='#3b271d',
                style='long', cuffs=True, lashes=True),
}
SKIN, SKIN_SHADE, BLUSH = '#f4c39b', '#e5a582', '#f0ad92'
CREAM, PANTS, BOOT, BOOT_DARK = '#f1e0bc', '#eedcb6', '#7a4a2d', '#56351f'
INK, WHITE, MOUTH = '#2a1d16', '#ffffff', '#9c4f37'


PARTS = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def from_bm(bm, name, closed=True):
    if closed:
        # Orient closed shells outward by signed volume; recalc_face_normals was unreliable here.
        volume = 0.0
        for face in bm.faces:
            first = face.verts[0].co
            for a, b in zip(face.verts[1:-1], face.verts[2:]):
                volume += first.dot(a.co.cross(b.co))
        if volume < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def add(part, obj, color, smooth=True, subsurf=0):
    if obj.type == 'MESH':
        for poly in obj.data.polygons:
            poly.use_smooth = smooth
    else:
        for spline in obj.data.splines:
            spline.use_smooth = smooth
    if subsurf:
        mod = obj.modifiers.new('subsurf', 'SUBSURF')
        mod.levels = mod.render_levels = subsurf
    PARTS.setdefault(part, []).append((obj, color))
    return obj


# ---------------------------------------------------------------- primitives

def ellipsoid(name, center, radii, seg=16, rings=10, shape=None):
    """Unit sphere with poles on +-Y, optionally reshaped in unit space, then scaled."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
    for v in bm.verts:
        u = Vector((v.co.x, v.co.z, -v.co.y))
        p = shape(u) if shape else Vector((u.x * radii[0], u.y * radii[1], u.z * radii[2]))
        v.co = p + Vector(center)
    return from_bm(bm, name)


def loft(name, rings, seg=12, caps=True):
    """Horizontal elliptical rings: (y, rx, rz, cx=0, cz=0), listed top to bottom or bottom to top."""
    bm = bmesh.new()
    loops = []
    for ring in rings:
        y, rx, rz = ring[:3]
        cx = ring[3] if len(ring) > 3 else 0
        cz = ring[4] if len(ring) > 4 else 0
        loops.append([bm.verts.new((cx + math.sin(a) * rx, y, cz + math.cos(a) * rz))
                      for a in (i * 2 * math.pi / seg for i in range(seg))])
    for a, b in zip(loops, loops[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(loops[0])
        bm.faces.new(list(reversed(loops[-1])))
    return from_bm(bm, name)


def sheet(name, columns):
    """Open quad sheet from a list of point columns (each a list of equal length)."""
    bm = bmesh.new()
    grid = [[bm.verts.new(p) for p in col] for col in columns]
    for a, b in zip(grid, grid[1:]):
        for i in range(len(a) - 1):
            bm.faces.new((a[i], b[i], b[i + 1], a[i + 1]))
    return from_bm(bm, name, closed=False)


def blade(name, points, widths, thickness, outward, sides=4):
    """Tapered clump along a path. Width lies across the surface, thickness along `outward`.
    A zero final width closes the clump to a single sharp tip."""
    bm = bmesh.new()
    rings = []
    count = len(points)
    for j, p in enumerate(points):
        p = Vector(p)
        prev, nxt = Vector(points[max(0, j - 1)]), Vector(points[min(count - 1, j + 1)])
        t = (nxt - prev).normalized()
        n = Vector(outward[j] if isinstance(outward, list) else outward)
        n = (n - t * n.dot(t)).normalized()
        b = t.cross(n).normalized()
        if widths[j] <= 0:
            rings.append([bm.verts.new(p)])
            continue
        if sides == 3:
            # Leaf section: flat underside on the scalp, one ridge outward (a lit and a shaded face).
            section = ((1, -.25), (0, 1), (-1, -.25))
        else:
            section = [(math.cos(k * 2 * math.pi / sides), math.sin(k * 2 * math.pi / sides)) for k in range(sides)]
        rings.append([bm.verts.new(p + b * (cx * widths[j]) + n * (cy * thickness[j])) for cx, cy in section])
    for a, b in zip(rings, rings[1:]):
        if len(b) == 1:
            for i in range(len(a)):
                bm.faces.new((a[i], a[(i + 1) % len(a)], b[0]))
        else:
            for i in range(len(a)):
                k = (i + 1) % len(a)
                bm.faces.new((a[i], a[k], b[k], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    return from_bm(bm, name)


def tube(name, points, depth, closed=False, resolution=1):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = depth
    curve.bevel_resolution = resolution
    curve.use_fill_caps = not closed
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p[0], p[1], p[2], 1)
    spline.use_cyclic_u = closed
    return link(bpy.data.objects.new(name, curve))


def polygon(name, points):
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in points])
    return from_bm(bm, name, closed=False)


# ---------------------------------------------------------------- head and face
# Round child head: widest at the cheeks, soft short chin, gently flattened face.

HEAD = dict(rx=.262, ry=.272, rz=.242)


def face_flat(c):
    return c if c < .8 else c - (c - .8) ** 2 / .4 * .6


def jaw(uy):
    below = max(0.0, -uy - .25)
    return 1 - .42 * below * below, 1 - .2 * below * below


def skull_shape(u):
    tx, tz = jaw(u.y)
    z = HEAD['rz'] * tz * (face_flat(u.z) if u.z > 0 else u.z)
    return Vector((u.x * HEAD['rx'] * tx, u.y * HEAD['ry'], z))


def head_z(x, y):
    uy = max(-1.0, min(1.0, y / HEAD['ry']))
    tx, tz = jaw(uy)
    ux = x / (HEAD['rx'] * tx)
    c = math.sqrt(max(0.0, 1 - ux * ux - uy * uy))
    return HEAD['rz'] * tz * face_flat(c)


def on_face(x, y, lift):
    return (x, y, head_z(x, y) + lift)


def rounded_rect(cx, cy, hw, hh, r, steps=3):
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + qx * (hw - r), cy + qy * (hh - r)
        for s in range(steps + 1):
            a = math.radians(a0 + 90 * s / steps)
            pts.append((ox + math.cos(a) * r, oy + math.sin(a) * r))
    return pts


def build_head(look):
    add('head', ellipsoid('skull', (0, 0, 0), None, 28, 16, skull_shape), SKIN)
    for side in (-1, 1):
        add('face', ellipsoid('ear', (side * .255, -.04, -.01), (.04, .062, .046), 12, 8), SKIN)
        add('face', ellipsoid('ear-in', (side * .28, -.04, .004), (.018, .036, .024), 10, 6), SKIN_SHADE)
        ex, ey = side * .092, -.022
        add('face', ellipsoid('eye', on_face(ex, ey, -.002), (.03, .043, .013), 16, 10), INK)
        add('face', ellipsoid('glint', on_face(ex + side * .009, ey + .017, .01), (.01, .012, .004), 8, 5), WHITE)
        add('face', ellipsoid('blush', on_face(side * .15, -.082, -.006), (.036, .02, .01), 12, 6), BLUSH)
        brow = [on_face(side * x, y, .005) for x, y in ((.052, .06), (.088, .073), (.128, .066))]
        add('face', tube('brow', brow, .0068 if look.get('lashes') else .0105), look['brow'])
        if look.get('lashes'):
            lash = [on_face(side * x, y, .007) for x, y in ((.066, .012), (.088, .024), (.112, .021), (.132, .006))]
            add('face', tube('lash', lash, .0055), INK)
    add('face', ellipsoid('nose', on_face(0, -.066, .002), (.02, .015, .013), 10, 6), SKIN_SHADE)
    smile = [on_face(x, -.118 + .02 * (x / .042) ** 2, .002) for x in (i * .0105 - .042 for i in range(9))]
    add('face', tube('mouth', smile, .0042), MOUTH)
    if 'glasses' in look:
        build_glasses(look)


def build_glasses(look):
    color, frame = look['glasses'], look['frame']
    for side in (-1, 1):
        cx, cy = side * .094, -.02
        depth = head_z(cx, cy) + .034
        hw, hh = (.08, .054) if look['lens'] == 'rect' else (.078, .056)
        corner = .012 if look['lens'] == 'rect' else .024
        ring = [(x, y, depth - 1.4 * (x - cx) ** 2) for x, y in rounded_rect(cx, cy, hw, hh, corner)]
        add('face', tube('lens', ring, frame, closed=True, resolution=2), color, smooth=False)
        edge = cx + side * hw
        temple = [(edge, cy + .03, depth - 1.4 * hw * hw), (side * .262, cy + .03, .08), (side * .268, cy + .01, -.03)]
        add('face', tube('temple', temple, frame * .75), color)
    bridge = head_z(0, .0) + .04
    add('face', tube('bridge', [(-.016, -.004, bridge - .004), (0, .004, bridge), (.016, -.004, bridge - .004)], frame * .85), color)


# ---------------------------------------------------------------- hair
# A voluminous shell plus big layered clumps, the way stylised low-poly hair is built.

CAP = dict(rx=HEAD['rx'] + .03, ry=HEAD['ry'] + .036, rz=HEAD['rz'] + .024)
UP, DOWN = Vector((0, 1, 0)), Vector((0, -1, 0))


def hairline(theta):
    """Lowest hair Y at an azimuth (0 = forward): forehead, ear tops, nape."""
    front = (1 + math.cos(theta)) / 2
    return -.2 + .33 * front ** 1.5


def cap_point(theta, phi, grow=0.0):
    s = 1 + grow
    return Vector((math.sin(theta) * math.sin(phi) * CAP['rx'] * s, math.cos(phi) * CAP['ry'] * s,
                   math.cos(theta) * math.sin(phi) * CAP['rz'] * s))


def cap_normal(p):
    return Vector((p.x / CAP['rx'] ** 2, p.y / CAP['ry'] ** 2, p.z / CAP['rz'] ** 2)).normalized()


def build_cap(look):
    def shape(u):
        return Vector((u.x * CAP['rx'], u.y * CAP['ry'], u.z * CAP['rz']))
    cap = ellipsoid('cap', (0, 0, 0), None, 24, 16, shape)
    bm = bmesh.new()
    bm.from_mesh(cap.data)
    doomed = [v for v in bm.verts if v.co.y < hairline(math.atan2(v.co.x, v.co.z)) - .02]
    bmesh.ops.delete(bm, geom=doomed, context='VERTS')
    bm.to_mesh(cap.data)
    bm.free()
    add('hair', cap, look['hair'], smooth=False)


def clump(look, base, flow, lift, length, width, thick, color, curl=0.0):
    """Leaf-shaped lock: rooted in the shell, running along `flow` (a tangent direction),
    rising by `lift` radians towards the tip, which closes to a point."""
    n = cap_normal(base)
    t = (flow - n * flow.dot(n)).normalized()
    side = t.cross(n).normalized()
    pts = []
    for s, rise in ((0, -.03), (.34, .2), (.7, .55), (1.0, 1.0)):
        a = lift * rise
        d = t * math.cos(a) + n * math.sin(a)
        pts.append(base + t * (length * s * math.cos(lift * .5)) + n * (length * s * math.sin(lift * rise) + (-.03 if s == 0 else .012))
                   + side * (curl * length * s * s))
    add('hair', blade('clump', pts, [width, width * .95, width * .62, 0], [thick, thick, thick * .7, 0], n, sides=3),
        color, smooth=False)


CLUMP_STYLES = {
    # rows: (polar angle from the crown, clump count)
    'spiky': dict(rows=((.12, 3), (.45, 7), (.8, 10), (1.15, 12), (1.5, 13), (1.85, 12)), width=.12, thick=.05),
    'short': dict(rows=((.15, 3), (.55, 7), (.95, 10), (1.35, 12), (1.75, 12)), width=.13, thick=.046),
    'tousled': dict(rows=((.15, 4), (.5, 8), (.85, 11), (1.2, 13), (1.55, 14), (1.9, 12)), width=.11, thick=.05),
}


def build_clumps(look, rng, style):
    p = CLUMP_STYLES[style]
    sweep = Vector((1, 0, 0))
    for row, (phi, count) in enumerate(p['rows']):
        for i in range(count):
            theta = (i + .5 * (row % 2)) * 2 * math.pi / count + rng.uniform(-.08, .08)
            base = cap_point(theta, phi)
            if base.y < hairline(theta) + .012:
                continue
            downhill = (cap_point(theta, phi + .06) - base).normalized()
            forward = math.cos(theta)
            color = look['hair'] if rng.random() > .3 else look['hair_dark']
            jitter = rng.uniform(.92, 1.08)
            if style == 'spiky':
                if phi < .6:
                    # Crown: tall points rising and swept to one side.
                    flow, lift, length, curl = (sweep + UP * .2 - downhill * .3), 1.05, .17, .1
                elif forward > .55 and phi > 1.05:
                    # Fringe: a few locks over the forehead, swept sideways, ending above the brows.
                    flow, lift, length, curl = downhill + sweep * .8, .2, .12, .15
                elif forward > -.2 and phi < 1.3:
                    # Front and top: brushed up towards the crown, tips lifting.
                    flow, lift, length, curl = -downhill + sweep * .5, .7, .16, .12
                else:
                    flow, lift, length, curl = downhill + sweep * .15, .3, .12, .05
            elif style == 'short':
                part = Vector((-1, 0, 0))
                if forward > .55 and phi > .95:
                    flow, lift, length, curl = downhill + part * .45, .22, .13, -.1
                else:
                    flow, lift, length, curl = downhill + part * .12 * max(0.0, forward), rng.uniform(.3, .45), .15, rng.uniform(-.12, .06)
            else:
                twist = Vector((math.cos(theta), 0, -math.sin(theta))) * rng.uniform(-.7, .7)
                if forward > .55 and phi > .95:
                    flow, lift, length, curl = downhill + twist * .5, .3, .11, rng.uniform(-.2, .2)
                else:
                    flow, lift, length, curl = downhill + twist, rng.uniform(.4, .65), .13, rng.uniform(-.25, .25)
            if forward < -.45 and style != 'spiky' or (style == 'spiky' and forward < -.45 and phi > .6):
                lift *= .6  # Keep the back compact: the shared depth envelope is fixed.
            clump(look, base, flow, lift, length * jitter, p['width'] * jitter, p['thick'], color, curl)


def build_long(look, rng):
    # Centre parting: wide locks follow the scalp, then fall past the shoulders with soft waves.
    for side in (-1, 1):
        for k in range(11):
            theta = side * (.9 + k * (math.pi - .94) / 10)
            tip = -.44 + rng.uniform(-.03, .02) if k > 1 else -.36
            pts, outs = [], []
            for phi in (.08, .42, .82, 1.22, 1.58):
                q = cap_point(theta, phi, .03)
                pts.append(q)
                outs.append(cap_normal(q))
            last = pts[-1]
            for i, y in enumerate((last.y - .12, (last.y + tip) / 2 - .04, tip + .05, tip)):
                spread = 1 + .06 * (i + 1)
                wave = .016 * math.sin(i * 1.9 + k * 1.3)
                pts.append(Vector((last.x * spread + wave * math.cos(theta), y, last.z * spread - wave * math.sin(theta))))
                outs.append(Vector((math.sin(theta), 0, math.cos(theta))))
            widths = [.04, .068, .08, .084, .082, .08, .072, .05, 0]
            thick = [.02, .026, .028, .028, .028, .026, .024, .018, 0]
            color = look['hair'] if k % 3 else look['hair_dark']
            add('hair', blade('lock', pts, widths, thick, outs), color, smooth=False)


def build_hair(look, rng):
    build_cap(look)
    if look['style'] == 'long':
        build_long(look, rng)
    else:
        build_clumps(look, rng, look['style'])


# ---------------------------------------------------------------- body
# Torso-local tunic profile (y, rx, rz), top to bottom. The checks mirror this profile.

def tunic_profile(broad):
    w = 1.0 if broad else .9
    return [(.36, .12 * w, .095), (.33, .205 * w, .135), (.22, .245 * w, .17), (.05, .228 * w, .165),
            (-.05, .232 * w, .17), (-.25, .272 * w, .22), (-.44, .305 * w, .29)]


def ring_at(rings, y):
    for (y0, rx0, rz0), (y1, rx1, rz1) in zip(rings, rings[1:]):
        if y1 <= y <= y0:
            t = (y0 - y) / (y0 - y1)
            return rx0 + (rx1 - rx0) * t, rz0 + (rz1 - rz0) * t
    return rings[-1][1], rings[-1][2]


def build_torso(look):
    profile = tunic_profile(look.get('broad'))
    upper = profile[:5]
    add('torso', loft('tunic-body', upper, 16), look['tunic'], smooth=False)
    # Skirt: front and back panels joined under the belt, opening into side slits at the hem.
    skirt = profile[4:]
    for front in (True, False):
        columns = []
        for i in range(9):
            row = []
            for y, rx, rz in skirt:
                gap = .16 * max(0.0, (-.2 - y) / .24)
                a = (-math.pi / 2 + gap + (math.pi - 2 * gap) * i / 8) + (0 if front else math.pi)
                row.append((math.sin(a) * rx, y, math.cos(a) * rz))
            columns.append(row)
        panel = sheet('skirt', columns)
        mod = panel.modifiers.new('solid', 'SOLIDIFY')
        mod.thickness, mod.offset = .014, 1
        add('torso', panel, look['tunic'], smooth=False)

    def surface(x, y, lift):
        rx, rz = ring_at(profile, y)
        return (x, y, rz * math.sqrt(max(0.0, 1 - (x / rx) ** 2)) + lift)
    # Wide sash with a knot and a long end hanging at the wearer's left.
    w = 1.0 if look.get('broad') else .9
    add('torso', loft('belt', [(.045, .236 * w, .178), (-.055, .24 * w, .182)], 16), look['belt'], smooth=False)
    kx = .095 * w
    kz = surface(kx, -.005, .014)[2]
    add('torso', ellipsoid('knot', (kx, -.005, kz), (.036, .034, .018), 10, 6), look['belt'], smooth=False)
    end = [(kx, -.03, kz), (kx + .01, -.16, surface(kx + .01, -.16, .016)[2]), (kx + .016, -.33, surface(kx + .016, -.33, .02)[2])]
    add('torso', blade('belt-end', end, [.036, .04, .036], [.009, .009, .008], [Vector((0, 0, 1))] * 3), look['belt'], smooth=False)
    if look.get('cuffs'):
        for s in (-1, 1):
            bow = [(kx, -.005, kz), (kx + s * .05, .025, kz + .006), (kx + s * .075, -.02, kz)]
            add('torso', blade('bow', bow, [.022, .032, 0], [.009, .011, 0], [Vector((0, 0, 1))] * 3), look['belt'], smooth=False)
    # Neckline: cream band round the neck and a short V slit with a skin inset.
    add('torso', loft('collar', [(.375, .118 * w, .1), (.34, .132 * w, .112)], 16), CREAM, smooth=False)
    add('torso', polygon('slit-skin', [surface(-.03, .345, .003), surface(0, .262, .003), surface(.03, .345, .003)]), SKIN)
    trim = [surface(x, y, .006) for x, y in ((-.04, .35), (0, .256), (.04, .35))]
    add('torso', tube('slit', trim, .01), CREAM, smooth=False)
    add('neck', loft('neck', [(-.03, .078, .072), (.07, .075, .07)], 12), SKIN)


def build_arm(look, side):
    s = 'left' if side < 0 else 'right'
    sleeve = [(.065, .05, .05), (.045, .092, .09), (0, .108, .104), (-.08, .112, .108), (-.145, .116, .11)]
    add('shoulder-' + s, loft('sleeve', sleeve, 12), look['tunic'], smooth=False)
    if look.get('cuffs'):
        add('shoulder-' + s, loft('cuff', [(-.14, .12, .114), (-.165, .118, .112)], 12), CREAM, smooth=False)
    add('shoulder-' + s, loft('upper-arm', [(-.08, .07, .068), (-.2, .066, .065), (-.232, .062, .062)], 12), SKIN)
    add('elbow-' + s, loft('forearm', [(.03, .066, .065), (-.1, .062, .062), (-.178, .057, .058)], 12), SKIN)
    hand = 'wrist-' + s
    add(hand, ellipsoid('fist', (0, -.058, .008), (.064, .07, .064), 14, 10), SKIN)
    add(hand, ellipsoid('knuckles', (0, -.104, .02), (.056, .026, .046), 12, 6), SKIN)
    add(hand, ellipsoid('thumb', (-side * .046, -.05, .045), (.022, .036, .025), 10, 6), SKIN)


def build_leg(side):
    s = 'left' if side < 0 else 'right'
    add('hip-' + s, loft('thigh', [(.07, .084, .084), (0, .094, .094), (-.15, .11, .11), (-.3, .118, .116),
                                    (-.34, .11, .108)], 12), PANTS, smooth=False)
    # Puffy trousers balloon below the knee and gather into the boot.
    add('knee-' + s, loft('calf', [(.04, .112, .11), (-.05, .132, .128), (-.14, .124, .12), (-.2, .095, .094),
                                   (-.22, .088, .088)], 14), PANTS, smooth=False)
    ankle = 'ankle-' + s
    add(ankle, loft('shaft', [(.115, .094, .096), (.09, .088, .09), (0, .084, .088), (-.04, .088, .1, 0, .015)], 14),
        BOOT, smooth=False)
    add(ankle, loft('foot', [(-.03, .088, .105, 0, .03), (-.085, .1, .158, 0, .052), (-.128, .102, .17, 0, .056)], 14),
        BOOT, smooth=False)
    add(ankle, loft('sole', [(-.126, .104, .173, 0, .056), (-.16, .104, .173, 0, .056)], 14), BOOT_DARK, smooth=False)


# ---------------------------------------------------------------- export

def export(avatar_id):
    graph = bpy.context.evaluated_depsgraph_get()
    parts, triangles = {}, 0
    for part, items in PARTS.items():
        merged = {}
        for obj, color in items:
            evaluated = obj.evaluated_get(graph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            normals = mesh.corner_normals
            group = merged.setdefault(color, {'color': color, 'position': [], 'normal': [], 'index': [], 'seen': {}})
            for tri in mesh.loop_triangles:
                for loop in tri.loops:
                    co = mesh.vertices[mesh.loops[loop].vertex_index].co
                    n = normals[loop].vector
                    key = (round(co.x, 5), round(co.y, 5), round(co.z, 5), round(n.x, 3), round(n.y, 3), round(n.z, 3))
                    index = group['seen'].get(key)
                    if index is None:
                        index = group['seen'][key] = len(group['position']) // 3
                        group['position'].extend(key[:3])
                        group['normal'].extend(key[3:])
                    group['index'].append(index)
                triangles += 1
            evaluated.to_mesh_clear()
        parts[part] = [{k: v for k, v in g.items() if k != 'seen'} for g in merged.values()]
    os.makedirs(OUT, exist_ok=True)
    document = {'generator': 'client/scripts/blender/build-avatar-parts.py', 'id': avatar_id,
                'units': 'metres', 'up': '+Y', 'forward': '+Z', 'triangles': triangles, 'parts': parts}
    with open(os.path.join(OUT, avatar_id + '.json'), 'w', encoding='utf8') as handle:
        json.dump(document, handle, separators=(',', ':'))
        handle.write('\n')
    print('avatar-parts', avatar_id, 'triangles', triangles)


for avatar_id in IDS:
    reset()
    look = LOOKS[avatar_id]
    rng = random.Random('kuda-' + avatar_id)
    build_head(look)
    build_hair(look, rng)
    build_torso(look)
    for side in (-1, 1):
        build_arm(look, side)
        build_leg(side)
    export(avatar_id)
