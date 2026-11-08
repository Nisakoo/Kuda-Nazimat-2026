"""Turn a locally generated image-to-3D mesh into rig-ready avatar parts.

The raw mesh comes from TripoSR (MIT), run offline on docs/game/images/<id>.png outside this
repository; see client/scripts/character-assets.md. This script never downloads anything.

Run from the repository root (Blender 4.2+):
  blender -b --factory-startup -P client/scripts/blender/convert-generated-avatar.py -- <mesh.obj> <id> [out_dir]

Output: client/scripts/avatar-parts/<id>.json in the format read by generate-avatar-models.mjs
(three.js convention: metres, +Y up, +Z forward; every part in its joint's local space) plus the
measured joint positions. Steps: orient, scale to the shared leg rig, simplify to a low-poly
surface, snap face colours to the character palette, split by nearest bone, close the cuts and
add crisp geometric facial features on the generated face.
"""
import bmesh
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, AVATAR = ARGS[0], ARGS[1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else os.path.join(HERE, '..', 'avatar-parts')
TARGET_TRIANGLES = 5600

PALETTES = {
    'lukas': dict(skin='#f2bb91', hair='#dcb36a', tunic='#2f7f88', cream='#efe2c4', pants='#ede0c4',
                  belt='#d29a3a', boot='#7a4a2d', ink='#1f2124'),
    'nic': dict(skin='#f2bb91', hair='#9a6a42', tunic='#6f7a47', cream='#efe2c4', pants='#ede0c4',
                belt='#bb6440', boot='#7a4a2d', ink='#2a1d16'),
    'dan': dict(skin='#f2bb91', hair='#4d3427', tunic='#b9553a', cream='#efe2c4', pants='#ede0c4',
                belt='#3f8081', boot='#7a4a2d', ink='#2a1d16'),
    'ksu': dict(skin='#f2bb91', hair='#5e3d2c', tunic='#8ba8cf', cream='#efe2c4', pants='#ede0c4',
                belt='#c08a3e', boot='#7a4a2d', ink='#2a1d16'),
}
FEATURES = {
    'lukas': dict(brow='#7d5630', glasses='#1d2023', frame=.0115, lens=(.09, .062, .014)),
    'nic': dict(brow='#5c3d24', glasses='#b4b3a9', frame=.0055, lens=(.088, .06, .02)),
    'dan': dict(brow='#2f2017', glasses='#bdbab0', frame=.0055, lens=(.092, .058, .012)),
    'ksu': dict(brow='#3b271d', lashes=True),
}
INK, WHITE, MOUTH, NOSE = '#2a1d16', '#ffffff', '#9c4f37', '#e3a07e'
PAL = PALETTES[AVATAR]

# Shared rig (generate-avatar-models.mjs): torso pivot, hips, knee and ankle offsets are fixed by the clips.
TORSO_Y, HIP = .95, (.126, .78)
KNEE_Y, ANKLE_Y = HIP[1] - .32, HIP[1] - .62
HEM_Y = .5  # The generated tunic hem is placed just above the knee.


def rgb(hexa):
    return Vector([int(hexa[i:i + 2], 16) / 255 for i in (1, 3, 5)])


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=SRC, forward_axis='Y', up_axis='Z')
    obj = bpy.context.selected_objects[0]
    bpy.context.view_layer.objects.active = obj
    for name, settings in (('smooth', dict(factor=.6, iterations=12)), ('dec', None)):
        mod = obj.modifiers.new(name, 'SMOOTH' if settings else 'DECIMATE')
        if settings:
            mod.factor, mod.iterations = settings['factor'], settings['iterations']
        else:
            mod.ratio = TARGET_TRIANGLES / len(obj.data.polygons)
        bpy.ops.object.modifier_apply(modifier=name)
    return obj


def faces_and_colours(obj):
    """Triangles in three.js axes (x, z, -y) with averaged sRGB colours."""
    me = obj.data
    me.calc_loop_triangles()
    attr = me.color_attributes[0]
    corner = attr.domain == 'CORNER'
    verts = [Vector((v.co.x, v.co.z, -v.co.y)) for v in me.vertices]
    tris, colours = [], []
    for tri in me.loop_triangles:
        tris.append(tuple(tri.vertices))
        acc = Vector((0, 0, 0))
        for loop in tri.loops:
            c = attr.data[loop if corner else me.loops[loop].vertex_index].color
            acc += Vector((max(0, c[0]), max(0, c[1]), max(0, c[2]))) / 3
        colours.append(Vector([min(1, a ** (1 / 2.2) * 1.25) for a in acc]))
    return verts, tris, colours


def centroid(verts, tri):
    return (verts[tri[0]] + verts[tri[1]] + verts[tri[2]]) / 3


def lab(c):
    """sRGB (0..1) to CIE Lab."""
    lin = [((v + .055) / 1.055) ** 2.4 if v > .04045 else v / 12.92 for v in c]
    x = (.4124 * lin[0] + .3576 * lin[1] + .1805 * lin[2]) / .9505
    y = .2126 * lin[0] + .7152 * lin[1] + .0722 * lin[2]
    z = (.0193 * lin[0] + .1192 * lin[1] + .9505 * lin[2]) / 1.089
    f = [t ** (1 / 3) if t > .008856 else 7.787 * t + 16 / 116 for t in (x, y, z)]
    return Vector((116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])))


LAB = {}


def label_of(colour, allowed):
    """Nearest palette entry in Lab, with lightness down-weighted: baked lighting varies brightness."""
    key = tuple(round(v, 3) for v in colour)
    c = LAB.get(key) or LAB.setdefault(key, lab(colour))

    def distance(name):
        ref = LAB.get(name) or LAB.setdefault(name, lab(rgb(PAL[name])))
        d = c - ref
        return (d.x * .45) ** 2 + d.y ** 2 + d.z ** 2
    return min(allowed, key=distance)


def orient(verts, tris, colours):
    """Rotate about +Y so the shoulders run along X and the face looks along +Z; feet on y=0."""
    ys = [v.y for v in verts]
    y0, height = min(ys), max(ys) - min(ys)
    band = [v for v in verts if y0 + .5 * height < v.y < y0 + .56 * height]
    mx = sum(v.x for v in band) / len(band)
    mz = sum(v.z for v in band) / len(band)
    sxx = sum((v.x - mx) ** 2 for v in band)
    szz = sum((v.z - mz) ** 2 for v in band)
    sxz = sum((v.x - mx) * (v.z - mz) for v in band)
    shoulder_angle = .5 * math.atan2(2 * sxz, sxx - szz)  # major axis angle in the x-z plane

    def rotated(angle):
        c, s = math.cos(angle), math.sin(angle)
        return [Vector((v.x * c + v.z * s, v.y, -v.x * s + v.z * c)) for v in verts]
    best = None
    for flip in (0, math.pi):
        candidate = rotated(shoulder_angle + flip)
        # The face (skin) must be in front of the hair in the head band.
        head = [(centroid(candidate, t), colours[i]) for i, t in enumerate(tris)]
        head = [(c, col) for c, col in head if c.y > y0 + .78 * height]
        skin = [c.z for c, col in head if label_of(col, ('skin', 'hair')) == 'skin']
        hair = [c.z for c, col in head if label_of(col, ('skin', 'hair')) == 'hair']
        face = sum(skin) / max(1, len(skin)) - sum(hair) / max(1, len(hair))
        # Toes point forward: the sole band reaches further forward than the boot shafts.
        sole = [v.z for v in candidate if v.y < y0 + .035 * height]
        shaft = [v.z for v in candidate if y0 + .08 * height < v.y < y0 + .13 * height]
        toes = max(sole) - max(shaft)
        score = toes * 4 + face
        print('orient', round(flip, 2), 'toes', round(toes, 4), 'face', round(face, 4))
        if best is None or score > best[0]:
            best = (score, candidate)
    verts = best[1]
    feet = [v for v in verts if v.y < y0 + .06 * height]
    fx = (min(v.x for v in feet) + max(v.x for v in feet)) / 2
    fz = (min(v.z for v in feet) + max(v.z for v in feet)) / 2
    return [Vector((v.x - fx, v.y - y0, v.z - fz)) for v in verts]


def neighbours(tris):
    edges = {}
    for i, t in enumerate(tris):
        for a, b in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])):
            edges.setdefault((min(a, b), max(a, b)), []).append(i)
    result = [[] for _ in tris]
    for faces in edges.values():
        for f in faces:
            result[f].extend(g for g in faces if g != f)
    return result


def classify(verts, tris, colours):
    centres = [centroid(verts, t) for t in tris]
    top = max(v.y for v in verts)
    # Spatial priors: dark hair and dark boots share colours, so each is allowed only in its band.
    labels = []
    for c, col in zip(centres, colours):
        y = c.y / top
        allowed = [k for k in PAL if not (k == 'boot' and y > .2) and not (k == 'hair' and y < .5)
                   and not (k == 'pants' and y > .45) and not (k in ('tunic', 'cream') and y > .72)
                   and not (k == 'belt' and not .3 < y < .66) and not (k == 'ink' and y < .66)]
        labels.append(label_of(col, allowed))
    # Measure hem and boot tops from these labels, robustly (percentiles).
    tunic_y = sorted(c.y for c, l in zip(centres, labels) if l == 'tunic' and .15 * top < c.y < .7 * top)
    boot_y = sorted(c.y for c, l in zip(centres, labels) if l == 'boot')
    hem = tunic_y[int(len(tunic_y) * .03)]
    boot_top = boot_y[int(len(boot_y) * .95)]
    neck = None
    for i, (c, col) in enumerate(zip(centres, colours)):
        y = c.y
        if y < boot_top:
            labels[i] = label_of(col, ('boot', 'skin'))
        elif y < hem:
            labels[i] = label_of(col, ('pants', 'skin', 'boot'))
        elif labels[i] == 'pants':
            labels[i] = label_of(col, ('cream', 'skin', 'tunic'))
    # The neckline is the highest clothing point near the centre line.
    collar = sorted(c.y for c, l in zip(centres, labels) if l in ('tunic', 'cream') and abs(c.x) < .25 * (top - hem))
    neck = collar[int(len(collar) * .98)]
    print('labels', {k: labels.count(k) for k in PAL}, 'hem', round(hem / top, 3), 'boot', round(boot_top / top, 3), 'neck', round(neck / top, 3))
    # Head: cluster this character's own colours (hair / skin / dark marks) instead of trusting the
    # palette distance; blond hair and skin are too close for that. The higher cluster is the hair.
    head = [i for i, c in enumerate(centres) if c.y > neck]
    points = {i: lab(colours[i]) for i in head}

    def weighted(v):
        return Vector((v.x * .6, v.y, v.z))
    means = [weighted(lab(rgb(PAL[k]))) for k in ('hair', 'skin', 'ink')]
    for _ in range(12):
        groups = [[], [], []]
        for i in head:
            p = weighted(points[i])
            groups[min(range(3), key=lambda g: (p - means[g]).length_squared)].append(i)
        means = [sum((weighted(points[i]) for i in g), Vector()) / len(g) if g else means[n] for n, g in enumerate(groups)]
    heights = [sum(centres[i].y for i in g) / max(1, len(g)) for g in groups[:2]]
    hair_group = 0 if heights[0] >= heights[1] else 1
    for n, g in enumerate(groups):
        for i in g:
            labels[i] = 'hair' if n == hair_group else ('skin' if n != 2 or centres[i].z > 0 else 'hair')
    chest_half = sorted(abs(c.x) for c, l in zip(centres, labels) if l == 'tunic' and hem < c.y < neck - .1 * (top - hem))
    chest_half = chest_half[int(len(chest_half) * .9)] if chest_half else 1
    for i, c in enumerate(centres):
        # Cream trims exist only at the collar (and Ksu's sleeve cuffs); elsewhere it is lit cloth.
        if labels[i] == 'cream' and c.y < neck - .08 * (top - hem) and not (AVATAR == 'ksu' and abs(c.x) > chest_half * .85):
            labels[i] = label_of(colours[i], ('tunic', 'skin', 'belt'))
    for i, c in enumerate(centres):
        if c.y > neck:
            pass
        elif labels[i] == 'ink':
            labels[i] = label_of(colours[i], tuple(k for k in PAL if k != 'ink'))
    near = neighbours(tris)
    for _ in range(8):
        updated = labels[:]
        for i, ns in enumerate(near):
            counts = {}
            for n in ns:
                counts[labels[n]] = counts.get(labels[n], 0) + 1
            if counts:
                winner = max(counts, key=counts.get)
                if counts[winner] >= 2 and winner != labels[i]:
                    updated[i] = winner
        labels = updated
    return labels, dict(hem=hem, boot_top=boot_top, neck=neck, top=top)


def seg_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def measure_joints(verts, tris, labels, marks):
    centres = [centroid(verts, t) for t in tris]
    joints = {}
    neck = marks['neck']
    chest = [c for c, l in zip(centres, labels) if l in ('tunic', 'cream') and neck - .3 < c.y < neck - .12]
    half = sorted(abs(c.x) for c in chest)[int(len(chest) * .97)]
    hem = marks['hem']
    for side, name in ((-1, 'left'), (1, 'right')):
        # Fists are the outermost skin between the hem and the shoulders.
        skin = [c for c, l in zip(centres, labels) if l == 'skin' and c.x * side > 0 and hem + .05 < c.y < neck - .2]
        reach = sorted(c.x * side for c in skin)
        cut = reach[int(len(reach) * .9)]
        fist = [c for c in skin if c.x * side >= cut]
        fist_c = sum(fist, Vector()) / len(fist)
        low = min(c.y for c in fist)

        def outline(y, radius):
            band = [c for c in centres if abs(c.y - y) < .03 and c.x * side > 0]
            outer = max(band, key=lambda c: c.x * side)
            row = [c for c in band if c.x * side > outer.x * side - radius * 2]
            return Vector((outer.x - side * radius, y, sum(c.z for c in row) / len(row)))
        shoulder = outline(neck - .1, .09)
        wrist = Vector((fist_c.x - side * .01, fist_c.y + .06, fist_c.z))
        elbow = outline((shoulder.y + wrist.y) / 2, .06)
        joints[name] = dict(shoulder=shoulder, elbow=elbow, wrist=wrist, fist=Vector((fist_c.x, low - .02, fist_c.z)))
        print('arm', name, {k: tuple(round(x, 3) for x in v) for k, v in joints[name].items()})
    joints['neck'] = neck
    joints['head'] = Vector((0, neck + .02, 0))
    for side, name in ((-1, 'left'), (1, 'right')):
        boots = [c for c, l in zip(centres, labels) if l == 'boot' and c.x * side > 0]
        joints['leg-' + name] = sum((c.x for c in boots), 0.0) / len(boots)
        joints['toe-' + name] = max(c.z for c in boots)
    return joints


# ---------------------------------------------------------------- rig frames

def rot_xyz(x, y, z):
    """three.js Euler 'XYZ' (Rx * Ry * Rz)."""
    return Matrix.Rotation(x, 4, 'X') @ Matrix.Rotation(y, 4, 'Y') @ Matrix.Rotation(z, 4, 'Z')


def frames(joints):
    m = {'avatar': Matrix.Identity(4)}
    m['torso'] = Matrix.Translation((0, TORSO_Y, 0))
    m['neck'] = m['torso'] @ Matrix.Translation((0, joints['neck'] - TORSO_Y, 0))
    h = joints['head']
    m['head'] = m['torso'] @ Matrix.Translation((h.x, h.y - TORSO_Y, h.z))
    m['face'] = m['hair'] = m['head']
    nodes = {'head': [h.x, h.y - TORSO_Y, h.z], 'neck': [0, joints['neck'] - TORSO_Y, 0]}
    for side, name in ((-1, 'left'), (1, 'right')):
        j = joints[name]
        local_shoulder = j['shoulder'] - Vector((0, TORSO_Y, 0))
        shoulder = m['torso'] @ Matrix.Translation(local_shoulder) @ rot_xyz(-.055, 0, side * .19)
        elbow_pos = shoulder.inverted() @ j['elbow']
        elbow = shoulder @ Matrix.Translation(elbow_pos) @ rot_xyz(-.07, 0, 0)
        wrist_pos = elbow.inverted() @ j['wrist']
        wrist = elbow @ Matrix.Translation(wrist_pos)
        m['shoulder-' + name], m['elbow-' + name], m['wrist-' + name] = shoulder, elbow, wrist
        nodes['shoulder-' + name] = list(local_shoulder)
        nodes['elbow-' + name] = list(elbow_pos)
        nodes['wrist-' + name] = list(wrist_pos)
        hip = Matrix.Translation((side * HIP[0], HIP[1], 0))
        m['hip-' + name] = hip
        m['knee-' + name] = hip @ Matrix.Translation((0, -.32, 0))
        m['ankle-' + name] = m['knee-' + name] @ Matrix.Translation((0, -.3, 0))
    return m, {k: [round(v, 5) for v in vals] for k, vals in nodes.items()}


def assign(verts, tris, labels, joints, marks):
    """Rigid parts. Arms are cut by planes at the shoulder, elbow and wrist (perpendicular to the
    limb) within a radius of the limb axis; legs by nearest leg bone below the hem; the rest of the
    tunic follows the torso. A connectivity pass then hands stray islands to their neighbours."""
    head_y, hem = joints['neck'], marks['hem']
    legs = {}
    for side, name in ((-1, 'left'), (1, 'right')):
        leg_x = joints['leg-' + name]
        legs['hip-' + name] = (Vector((leg_x, HIP[1], 0)), Vector((leg_x, KNEE_Y, 0)))
        legs['knee-' + name] = (Vector((leg_x, KNEE_Y, 0)), Vector((leg_x, ANKLE_Y, 0)))
        legs['ankle-' + name] = (Vector((leg_x, ANKLE_Y, 0)), Vector((leg_x, .03, joints['toe-' + name] * .6)))

    def arm_part(c, label):
        for name in ('left', 'right'):
            j = joints[name]
            s_, e_, w_, f_ = j['shoulder'], j['elbow'], j['wrist'], j['fist']
            if (c - s_).dot((e_ - s_).normalized()) < -.015:
                continue
            reach = min(seg_distance(c, s_, e_), seg_distance(c, e_, w_), seg_distance(c, w_, f_))
            if reach > (.14 if c.y > e_.y else .1):
                continue
            if label in ('pants', 'boot', 'hair'):
                continue
            past_elbow = (c - e_).dot((w_ - e_).normalized()) > 0
            past_wrist = (c - w_).dot((f_ - w_).normalized()) > -.01
            if label in ('tunic', 'belt') and past_elbow and not (past_wrist and reach < .07):
                continue  # the skirt beside a hanging forearm stays with the body
            return ('wrist-' if past_wrist else 'elbow-' if past_elbow else 'shoulder-') + name
        return None
    parts = []
    for t, label in zip(tris, labels):
        c = centroid(verts, t)
        if label == 'hair' and c.y > head_y - (.5 if AVATAR == 'ksu' else .02):
            parts.append('hair')
        elif c.y > head_y:
            parts.append('head')
        elif c.y < hem - .01 and label in ('pants', 'boot', 'skin'):
            parts.append(min(legs, key=lambda k: seg_distance(c, *legs[k])))
        else:
            parts.append(arm_part(c, label) or 'torso')
    # Connectivity: small islands of a part join the part that surrounds them.
    near = neighbours(tris)
    for _ in range(3):
        seen = [False] * len(tris)
        islands = []
        for start in range(len(tris)):
            if seen[start]:
                continue
            island, stack = [], [start]
            seen[start] = True
            while stack:
                f = stack.pop()
                island.append(f)
                for n in near[f]:
                    if not seen[n] and parts[n] == parts[start]:
                        seen[n] = True
                        stack.append(n)
            islands.append((parts[start], island))
        largest = {}
        for part, island in islands:
            largest[part] = max(largest.get(part, 0), len(island))
        for part, island in islands:
            # Body and limb parts must be one piece; head and hair may have separate locks.
            stray = len(island) < 40 or (part not in ('head', 'hair') and len(island) < largest[part])
            if stray:
                counts = {}
                for f in island:
                    for n in near[f]:
                        if parts[n] != part:
                            counts[parts[n]] = counts.get(parts[n], 0) + 1
                if counts:
                    winner = max(counts, key=counts.get)
                    for f in island:
                        parts[f] = winner
    return parts


def relabel(verts, tris, labels, parts, colours, joints):
    """Final colours by body part: each part may only use its own palette entries, so shading baked
    into the generated colours can no longer turn a shadowed tunic into hair or a lit one into skin."""
    neck = joints['neck']
    cents = [centroid(verts, t) for t in tris]
    normals = []
    for t in tris:
        n = (verts[t[1]] - verts[t[0]]).cross(verts[t[2]] - verts[t[0]])
        normals.append(n.normalized() if n.length > 1e-12 else Vector((0, 0, 1)))
    head = [i for i, part in enumerate(parts) if part in ('head', 'hair')]
    top = max(cents[i].y for i in head)
    front = sorted((cents[i] for i in head if labels[i] == 'skin' and normals[i].z > .45), key=lambda c: c.y)
    chin = front[int(len(front) * .02)].y if front else neck
    cx = sorted(c.x for c in front)[len(front) // 2] if front else 0
    head_h = top - chin

    def pick(col, allowed, bias=None):
        c = lab(col)
        def distance(name):
            ref = lab(rgb(PAL[name]))
            d = c - ref
            return ((d.x * .45) ** 2 + d.y ** 2 + d.z ** 2) * (bias or {}).get(name, 1)
        return min(allowed, key=distance)
    long_hair = AVATAR == 'ksu'
    for i, part in enumerate(parts):
        c, n, col = cents[i], normals[i], colours[i]
        if part == 'hair':
            labels[i] = 'hair'
        elif part == 'head':
            face = n.z > .25 and c.y < chin + .66 * head_h and abs(c.x - cx) < .21
            if face:
                labels[i] = pick(col, ('skin', 'hair'), {'skin': .7})
            elif c.y < chin + .4 * head_h and not long_hair:
                labels[i] = pick(col, ('skin', 'hair'))
            else:
                labels[i] = 'hair'
        elif part == 'torso':
            allowed, bias = ['tunic', 'belt'], {'tunic': .75}
            if c.y > neck - .11 and c.z > 0 and abs(c.x) < .14:
                allowed += ['cream', 'skin']
            if long_hair and c.y > neck - .45 and (c.z < -.02 or abs(c.x) > .13):
                allowed.append('hair')
                bias['hair'] = 1.3
            labels[i] = pick(col, allowed, bias)
        elif part.startswith(('shoulder-', 'elbow-')):
            labels[i] = pick(col, ['tunic', 'skin'] + (['cream'] if long_hair else []))
        elif part.startswith('wrist-'):
            labels[i] = 'skin'
        elif part.startswith(('hip-', 'knee-')):
            labels[i] = pick(col, ('pants', 'skin'), {'pants': .7})
        elif part.startswith('ankle-'):
            labels[i] = 'boot'
    near = neighbours(tris)
    for _ in range(6):
        updated = labels[:]
        for i, ns in enumerate(near):
            counts = {}
            for m in ns:
                if parts[m] == parts[i]:
                    counts[labels[m]] = counts.get(labels[m], 0) + 1
            if counts:
                winner = max(counts, key=counts.get)
                if counts[winner] >= 2 and winner != labels[i]:
                    updated[i] = winner
        labels[:] = updated


# ---------------------------------------------------------------- export helpers

def flat_surfaces(points, faces, face_colours, frame):
    """Per-colour indexed surfaces with flat normals, in the joint frame."""
    inverse = frame.inverted()
    rotation = inverse.to_3x3()
    groups = {}
    for face, colour in zip(faces, face_colours):
        local = [inverse @ points[i] for i in face]
        normal = (local[1] - local[0]).cross(local[2] - local[0])
        if normal.length < 1e-12:
            continue
        normal.normalize()
        g = groups.setdefault(colour, {'color': colour, 'position': [], 'normal': [], 'index': [], 'seen': {}})
        for p in local:
            key = (round(p.x, 5), round(p.y, 5), round(p.z, 5), round(normal.x, 3), round(normal.y, 3), round(normal.z, 3))
            index = g['seen'].get(key)
            if index is None:
                index = g['seen'][key] = len(g['position']) // 3
                g['position'].extend(key[:3])
                g['normal'].extend(key[3:])
            g['index'].append(index)
    del rotation
    return [{k: v for k, v in g.items() if k != 'seen'} for g in groups.values()]


def close_part(points, faces, colours):
    """Cap the open cut loops of a split part so no gap shows through when joints bend."""
    bm = bmesh.new()
    lookup = {}
    for face in faces:
        for i in face:
            if i not in lookup:
                lookup[i] = bm.verts.new(points[i])
    layer = bm.faces.layers.int.new('colour')
    palette = sorted(set(colours))
    for face, colour in zip(faces, colours):
        try:
            f = bm.faces.new([lookup[i] for i in face])
            f[layer] = palette.index(colour)
        except ValueError:
            pass
    boundary = [e for e in bm.edges if e.is_boundary]
    before = set(bm.faces)
    if boundary:
        bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    for f in bm.faces:
        if f not in before:
            neighbour = next((g for e in f.edges for g in e.link_faces if g in before), None)
            f[layer] = neighbour[layer] if neighbour else 0
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.index_update()
    out_points = [v.co.copy() for v in bm.verts]
    out_faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    out_colours = [palette[f[layer]] for f in bm.faces]
    bm.free()
    return out_points, out_faces, out_colours


# ---------------------------------------------------------------- facial features

FEATURE_OBJECTS = []


def feature_mesh(bm, colour):
    FEATURE_OBJECTS.append((bm, colour))


def ellipsoid_bm(center, radii, seg=14, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * radii[0], v.co.z * radii[1], -v.co.y * radii[2])) + Vector(center)
    return bm


def tube_bm(points, radius, closed=False, sides=6):
    bm = bmesh.new()
    rings = []
    count = len(points)
    for i, p in enumerate(points):
        p = Vector(p)
        prev = Vector(points[(i - 1) % count] if closed else points[max(0, i - 1)])
        nxt = Vector(points[(i + 1) % count] if closed else points[min(count - 1, i + 1)])
        t = (nxt - prev).normalized()
        n = Vector((0, 0, 1)) if abs(t.z) < .9 else Vector((1, 0, 0))
        b = t.cross(n).normalized()
        n = b.cross(t).normalized()
        rings.append([bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radius)
                      for a in (k * 2 * math.pi / sides for k in range(sides))])
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def build_features(verts, tris, labels, parts, joints, colours):
    head_tris = [t for t, p in zip(tris, parts) if p in ('head', 'hair')]
    tree = BVHTree.FromPolygons(verts, head_tris)

    def surface(x, y):
        hit = tree.ray_cast(Vector((x, y, 2.0)), Vector((0, 0, -1)))
        return hit[0]
    skin = [centroid(verts, t) for t, l, p in zip(tris, labels, parts) if p == 'head' and l == 'skin']
    zmax = max(c.z for c in skin)
    front = [c for c in skin if c.z > zmax - .09]  # the face plane, not the neck behind it
    chin = min(c.y for c in front if abs(c.x) < .08)
    hairs = [centroid(verts, t) for t, p in zip(tris, parts) if p == 'hair']
    hairline = min((c.y for c in hairs if abs(c.x) < .08 and c.z > zmax - .12 and c.y > chin + .12), default=chin + .36)
    head_top = max(verts[i].y for t in head_tris for i in t)
    head_h = head_top - chin
    face_h = .62 * head_h
    eye_y = chin + .33 * head_h
    row = [c.x for c in front if abs(c.y - eye_y) < .04]
    width = max(row) - min(row)
    cx = sum(row) / len(row)
    k = face_h / .3
    # The generator paints its own eyes as two dark patches on the face: find them, repaint them
    # as skin and put the crisp geometric eyes exactly there.
    window = []
    for i, (t, part) in enumerate(zip(tris, parts)):
        if part not in ('head', 'hair'):
            continue
        c = centroid(verts, t)
        col = colours[i]
        if c.z > zmax - .08 and chin + .18 * head_h < c.y < chin + .5 * head_h and abs(c.x - cx) < .16:
            window.append((i, c, .3 * col.x + .59 * col.y + .11 * col.z))
    lums = sorted(w[2] for w in window)
    threshold = min(.5, lums[int(len(lums) * .18)]) if lums else 0
    dark = [(i, c) for i, c, lum in window if lum <= threshold]
    left = [c for i, c in dark if c.x < cx]
    right = [c for i, c in dark if c.x >= cx]
    print('face', dict(chin=round(chin, 3), hairline=round(hairline, 3), zmax=round(zmax, 3), cx=round(cx, 3), left=len(left), right=len(right)))
    if len(left) >= 3 and len(right) >= 3:
        lc, rc = sum(left, Vector()) / len(left), sum(right, Vector()) / len(right)
        sep = rc.x - lc.x
        if .08 < sep < .34:
            eye_y, cx, k = (lc.y + rc.y) / 2, (lc.x + rc.x) / 2, sep / .2
            for i, c in dark:
                labels[i], parts[i] = 'skin', 'head'
            print('eyes detected', round(sep, 3), round(eye_y, 3))
    look = FEATURES[AVATAR]

    def at(dx, y, lift):
        p = surface(cx + dx, y)
        return (p.x, p.y, p.z + lift) if p else (cx + dx, y, .2)
    for side in (-1, 1):
        ex = side * .1 * k
        feature_mesh(ellipsoid_bm(at(ex, eye_y, .003 * k), (.031 * k, .045 * k, .014 * k), 16, 10), INK)
        feature_mesh(ellipsoid_bm(at(ex + side * .01 * k, eye_y + .018 * k, .009 * k), (.01 * k, .012 * k, .005 * k), 8, 5), WHITE)
        brow = [at(side * x * k, eye_y + y * k, .006 * k) for x, y in ((.055, .082), (.095, .094), (.135, .086))]
        feature_mesh(tube_bm(brow, (.007 if look.get('lashes') else .011) * k), look['brow'])
        if look.get('lashes'):
            lash = [at(side * x * k, eye_y + y * k, .007 * k) for x, y in ((.07, .03), (.094, .043), (.12, .04), (.142, .024))]
            feature_mesh(tube_bm(lash, .0055 * k), INK)
    feature_mesh(ellipsoid_bm(at(0, eye_y - .07 * k, .0), (.021 * k, .016 * k, .015 * k), 10, 6), NOSE)
    smile = [at(x * k, eye_y - .14 * k + .02 * k * (x / .045) ** 2, .003 * k) for x in (i * .01125 - .045 for i in range(9))]
    feature_mesh(tube_bm(smile, .0045 * k), MOUTH)
    if 'glasses' in look:
        hw, hh, r = (v * k for v in look['lens'])
        for side in (-1, 1):
            lx = side * .1 * k
            depth = max(at(lx + dx * hw, eye_y + dy * hh, .03 * k)[2] for dx in (-1, 0, 1) for dy in (-1, 0, 1))
            ring = []
            for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
                ox, oy = qx * (hw - r), qy * (hh - r)
                for s in range(4):
                    a = math.radians(a0 + 30 * s)
                    x, y = ox + math.cos(a) * r, oy + math.sin(a) * r
                    ring.append((cx + lx + x, eye_y + y, depth - 1.2 * x * x))
            feature_mesh(tube_bm(ring, look['frame'] * k, closed=True), look['glasses'])
            edge = cx + lx + side * hw
            ear = surface(cx + side * width * .5, eye_y)
            back = (ear.z if ear else 0) - .06 * k
            temple = [(edge, eye_y + .03 * k, depth - 1.2 * hw * hw), (cx + side * width * .52, eye_y + .03 * k, back + .05 * k),
                      (cx + side * width * .53, eye_y + .01 * k, back)]
            feature_mesh(tube_bm(temple, look['frame'] * .75 * k), look['glasses'])
        bridge_z = at(0, eye_y + .01 * k, .045 * k)[2]
        bridge = [(cx - .02 * k, eye_y + .005 * k, bridge_z - .004 * k), (cx, eye_y + .014 * k, bridge_z), (cx + .02 * k, eye_y + .005 * k, bridge_z - .004 * k)]
        feature_mesh(tube_bm(bridge, look['frame'] * .85 * k), look['glasses'])
    return dict(eye_y=eye_y, width=width, chin=chin, hairline=hairline)


def feature_surfaces(frame):
    surfaces = []
    for bm, colour in FEATURE_OBJECTS:
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.verts.index_update()
        points = [v.co.copy() for v in bm.verts]
        faces = [tuple(v.index for v in f.verts) for f in bm.faces]
        surfaces.extend(flat_surfaces(points, faces, [colour] * len(faces), frame))
        bm.free()
    merged = {}
    for s in surfaces:
        g = merged.setdefault(s['color'], {'color': s['color'], 'position': [], 'normal': [], 'index': []})
        base = len(g['position']) // 3
        g['position'] += s['position']
        g['normal'] += s['normal']
        g['index'] += [i + base for i in s['index']]
    return list(merged.values())


# ---------------------------------------------------------------- main

# Characters whose generated head is too rough (blond spikes read as skin-coloured lumps) get the
# procedural Blender head instead, fitted to the generated head's size and position.
SCULPTED_HEAD = {'lukas', 'nic'}


def sculpted_head(verts, tris, parts, joints):
    import random
    import tempfile
    pts = [verts[i] for t, p in zip(tris, parts) if p in ('head', 'hair') for i in t]
    neck, top = joints['neck'], max(v.y for v in pts)
    xs, zs = [v.x for v in pts], [v.z for v in pts]
    s = (top - neck) / .68  # the sculpture spans about chin -0.26 .. crown +0.42 around the skull centre
    centre = Vector(((min(xs) + max(xs)) / 2, neck + .26 * s, (min(zs) + max(zs)) / 2 - .02 * s))
    path = os.path.join(HERE, 'build-avatar-parts.py')
    source = open(path, encoding='utf8').read().split('\nfor avatar_id in IDS:')[0]
    folder = tempfile.mkdtemp()
    saved, sys.argv = sys.argv, ['blender', '--', folder, AVATAR]
    namespace = {'__name__': 'sculpture', '__file__': path}
    try:
        exec(compile(source, path, 'exec'), namespace)
    finally:
        sys.argv = saved
    namespace['reset']()
    look = namespace['LOOKS'][AVATAR]
    namespace['build_head'](look)
    namespace['build_hair'](look, random.Random('kuda-' + AVATAR))
    namespace['export'](AVATAR)
    with open(os.path.join(folder, AVATAR + '.json'), encoding='utf8') as handle:
        sculpture = json.load(handle)['parts']
    for surfaces in sculpture.values():
        for surface in surfaces:
            surface['position'] = [round(v * s, 5) for v in surface['position']]
    return {name: sculpture.get(name, []) for name in ('head', 'face', 'hair')}, centre


def main():
    obj = load()
    verts, tris, colours = faces_and_colours(obj)
    verts = orient(verts, tris, colours)
    labels, marks = classify(verts, tris, colours)
    scale = HEM_Y / marks['hem']
    verts = [v * scale for v in verts]
    marks = {k: v * scale for k, v in marks.items()}
    joints = measure_joints(verts, tris, labels, marks)
    parts = assign(verts, tris, labels, joints, marks)
    relabel(verts, tris, labels, parts, colours, joints)
    sculpted = AVATAR in SCULPTED_HEAD
    if sculpted:
        head_parts, centre = sculpted_head(verts, tris, parts, joints)
        joints['head'] = centre
        face_info = {}
    else:
        face_info = build_features(verts, tris, labels, parts, joints, colours)
    matrices, nodes = frames(joints)
    if sculpted:
        nodes['head'] = [round(centre.x, 5), round(centre.y - TORSO_Y, 5), round(centre.z, 5)]
    output, triangles = {}, 0
    for name in sorted(set(parts) - ({'head', 'hair'} if sculpted else set())):
        faces = [t for t, p in zip(tris, parts) if p == name]
        cols = [PAL[l] for l, p in zip(labels, parts) if p == name]
        points, faces, cols = close_part(verts, faces, cols)
        group = 'head' if name == 'head' else name
        output[group] = flat_surfaces(points, faces, cols, matrices[group])
        triangles += len(faces)
    if sculpted:
        output.update(head_parts)
        triangles += sum(len(s['index']) // 3 for name in ('head', 'face', 'hair') for s in head_parts[name])
    else:
        output['face'] = feature_surfaces(matrices['face'])
        triangles += sum(len(s['index']) // 3 for s in output['face'])
    os.makedirs(OUT, exist_ok=True)
    document = {'generator': 'client/scripts/blender/convert-generated-avatar.py', 'source': 'TripoSR image-to-3D of docs/game/images/' + AVATAR + '.png',
                'id': AVATAR, 'units': 'metres', 'up': '+Y', 'forward': '+Z', 'triangles': triangles,
                'uniformScale': True, 'nodes': nodes, 'marks': {k: round(v, 4) for k, v in marks.items()},
                'face': {k: round(v, 4) for k, v in face_info.items()}, 'parts': output}
    with open(os.path.join(OUT, AVATAR + '.json'), 'w', encoding='utf8') as handle:
        json.dump(document, handle, separators=(',', ':'))
        handle.write('\n')
    print('converted', AVATAR, 'triangles', triangles, 'marks', document['marks'], 'nodes', nodes)


main()
