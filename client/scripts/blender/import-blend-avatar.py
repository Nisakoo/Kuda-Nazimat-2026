"""Import a hand-built Blender character into rig-ready avatar parts.

The source .blend is a static, unrigged figure made of named parts with plain material colours
(no textures), Z up, facing -Y. This script splits it onto the shared avatar rig by part name and
cutting planes, and writes client/scripts/avatar-parts/<id>.json for generate-avatar-models.mjs.

Run (Blender 4.2+):
  blender -b <source.blend> -P client/scripts/blender/import-blend-avatar.py -- <id> [out_dir]
"""
import bpy
import json
import os
import sys
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
AVATAR = ARGS[0]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else os.path.join(HERE, '..', 'avatar-parts')
TORSO_Y, HIP_X, HIP_Y = .95, .126, .78
KNEE_Y = HIP_Y - .32
HEM_Y = .5
NECK_TOP_Y = 1.501  # where the tunic hem rule puts the top of the neck on the shared base body
TRIANGLE_BUDGET = 7800
FLAP_TOP = HIP_Y + .02  # cloth hanging below the hip pivots follows the skirt panels
HANGING = ('sash • long', 'sash • shorter', 'apron', 'pocket', 'patch')
SKIP = ('studio floor', 'pedestal', 'backdrop')  # staging, not the character


def to_three(v):
    return Vector((v.x, v.z, -v.y))


def srgb_hex(linear):
    def channel(c):
        c = max(0.0, min(1.0, c))
        return 12.92 * c if c <= .0031308 else 1.055 * c ** (1 / 2.4) - .055
    return '#' + ''.join('%02x' % round(channel(c) * 255) for c in linear[:3])


def material_colour(material):
    if material is None:
        return '#ff00ff'
    if material.use_nodes:
        bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            return srgb_hex(bsdf.inputs['Base Color'].default_value)
    return srgb_hex(material.diffuse_color)


def character_objects():
    return [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE') and o.visible_get()
            and not any(word in o.name.lower() for word in SKIP)]


def evaluated_triangles(o):
    graph = bpy.context.evaluated_depsgraph_get()
    evaluated = o.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def simplify(objects):
    """Decimate the densest body parts (never the small facial features) until the evaluated
    figure, curves and modifiers included, fits the avatar triangle budget."""
    for _ in range(12):
        counts = {o.name: evaluated_triangles(o) for o in objects}
        total = sum(counts.values())
        print('triangles', total)
        if total <= TRIANGLE_BUDGET:
            return
        candidates = [o for o in objects if o.type == 'MESH' and counts[o.name] > 300
                      and not o.name.lower().startswith(('eye', 'mouth', 'nose', 'ear', 'glasses', 'freckle'))]
        o = max(candidates, key=lambda c: counts[c.name])
        mod = o.modifiers.get('budget') or o.modifiers.new('budget', 'DECIMATE')
        mod.ratio *= max(.6, 1 - (total - TRIANGLE_BUDGET) / counts[o.name])


def extract(objects):
    """Triangles per object in three.js axes with per-triangle colours and corner normals."""
    graph = bpy.context.evaluated_depsgraph_get()
    result = []
    for o in objects:
        evaluated = o.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        normals = mesh.corner_normals
        world = o.matrix_world
        rotation = world.to_3x3().inverted().transposed()
        materials = [material_colour(m) for m in (o.data.materials or [None])]
        tris = []
        for tri in mesh.loop_triangles:
            points = [to_three(world @ mesh.vertices[mesh.loops[l].vertex_index].co) for l in tri.loops]
            corner = [to_three((rotation @ normals[l].vector).normalized()) for l in tri.loops]
            tris.append((points, corner, materials[min(tri.material_index, len(materials) - 1)]))
        evaluated.to_mesh_clear()
        result.append((o.name, tris))
    return result


def seg_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (p - (a + ab * t)).length


def rot_xyz(x, y, z):
    return Matrix.Rotation(x, 4, 'X') @ Matrix.Rotation(y, 4, 'Y') @ Matrix.Rotation(z, 4, 'Z')


def main():
    objects = character_objects()
    simplify(objects)
    parts = extract(objects)
    every = [p for _, tris in parts for t in tris for p in t[0]]
    sole = min(p.y for p in every)
    skirt = [p for name, tris in parts if 'skirt' in name.lower() for t in tris for p in t[0]]
    if skirt:
        scale = HEM_Y / (min(p.y for p in skirt) - sole)
    else:  # a short shirt instead of a tunic: the shared base body sets the neck height instead
        neck_top = max(p.y for name, tris in parts if name.lower() == 'neck' for t in tris for p in t[0])
        scale = NECK_TOP_Y / (neck_top - sole)
    feet = [p for name, tris in parts if name.lower().startswith('boot') for t in tris for p in t[0]]
    cx = (min(p.x for p in feet) + max(p.x for p in feet)) / 2
    cz = (min(p.z for p in feet) + max(p.z for p in feet)) / 2

    def place(p):
        return Vector(((p.x - cx) * scale, (p.y - sole) * scale, (p.z - cz) * scale))
    parts = [(name, [([place(p) for p in pts], nrm, col) for pts, nrm, col in tris]) for name, tris in parts]

    # Joints measured on the figure: arms from the arm meshes, the head pivot at the top of the neck.
    joints = {}
    for side, suffix in ((-1, 'left'), (1, 'right')):
        arm = [p for name, tris in parts if name.lower().startswith('arm') for t in tris for p in t[0] if p.x * side > 0]
        top, bottom = max(p.y for p in arm), min(p.y for p in arm)
        span = top - bottom
        shoulder_pts = [p for p in arm if p.y > top - .08 * span]
        fist_pts = [p for p in arm if p.y < bottom + .12 * span]
        s = sum(shoulder_pts, Vector()) / len(shoulder_pts) - Vector((0, .02, 0))
        f = sum(fist_pts, Vector()) / len(fist_pts)
        joints[suffix] = dict(shoulder=s, elbow=s.lerp(f, .47), wrist=s.lerp(f, .76), fist=Vector((f.x, bottom, f.z)))
    neck = [p for name, tris in parts if name.lower() == 'neck' for t in tris for p in t[0]]
    neck_top = max(p.y for p in neck)
    head_y = neck_top - .06

    def arm_part(c, side_name, sleeve_only):
        j = joints[side_name]
        s, e, w, f = j['shoulder'], j['elbow'], j['wrist'], j['fist']
        if (c - s).dot((e - s).normalized()) < -.01:
            return None
        if min(seg_distance(c, s, e), seg_distance(c, e, w), seg_distance(c, w, f)) > .16:
            return None
        if sleeve_only:
            return 'shoulder-' + side_name
        if (c - w).dot((f - w).normalized()) > 0:
            return 'wrist-' + side_name
        if (c - e).dot((w - e).normalized()) > 0:
            return 'elbow-' + side_name
        return 'shoulder-' + side_name

    groups = {}
    for name, tris in parts:
        lower = name.lower()
        zs = [p.z for t in tris for p in t[0]] or [0.0]
        mid_z = (min(zs) + max(zs)) / 2  # split hems through their own middle, i.e. the side slits
        for pts, nrm, col in tris:
            c = (pts[0] + pts[1] + pts[2]) / 3
            side = 'left' if c.x < 0 else 'right'
            if lower.startswith('hair'):
                part = 'hair'
            elif lower.startswith('head'):
                part = 'head'
            elif lower.startswith(('eye', 'ear', 'nose', 'mouth', 'glasses', 'freckle')):
                part = 'face'
            elif lower == 'neck':
                part = 'neck'
            elif lower.startswith(('arm', 'left wrist', 'right wrist')):  # wrist bands ride the hand
                part = arm_part(c, side, False) or 'shoulder-' + side
            elif lower.startswith('sleeve'):
                part = 'shoulder-' + side
            elif lower.startswith('tunic') and 'shoulder' in lower:
                part = arm_part(c, side, True) or 'torso'  # the sleeves follow the upper arm
            elif lower.startswith('linen') and 'trousers' in lower:
                part = ('hip-' if c.y > KNEE_Y else 'knee-') + side
            elif lower.startswith(('linen', 'ankle')):
                part = 'knee-' + side
            elif lower.startswith('boot'):
                part = 'ankle-' + side
            elif 'skirt' in lower or (lower.startswith(('tunic', 'shirt')) and 'hem' in lower):
                # The hem splits at its side slits into panels that swing with the thighs.
                part = 'skirt-front' if c.z > mid_z else 'skirt-back'
            elif lower.startswith(HANGING) and c.y < FLAP_TOP and c.z > 0:
                part = 'skirt-front'  # hanging sash ends and apron skirts ride the front panel
            else:
                part = 'torso'
            groups.setdefault(part, []).append((pts, nrm, col))

    # Rig frames (same rest transforms as generate-avatar-models.mjs).
    frames = {'torso': Matrix.Translation((0, TORSO_Y, 0))}
    frames['neck'] = frames['torso'] @ Matrix.Translation((0, neck_top - .12 - TORSO_Y, 0))
    # Each panel hinges on its own surface at hip height, so it tilts like cloth hanging from the
    # waist instead of also lifting (which opened a gap below the bodice).
    hem = [p for name, tris in parts if 'skirt' in name.lower() or (name.lower().startswith(('tunic', 'shirt')) and 'hem' in name.lower())
           for t in tris for p in t[0] if abs(p.y - HIP_Y) < .06]
    hinge = {'skirt-front': max((p.z for p in hem), default=.12), 'skirt-back': min((p.z for p in hem), default=-.12)}
    for panel, z in hinge.items():
        frames[panel] = frames['torso'] @ Matrix.Translation((0, HIP_Y - TORSO_Y, z))
    frames['head'] = frames['face'] = frames['hair'] = frames['torso'] @ Matrix.Translation((0, head_y - TORSO_Y, 0))
    nodes = {'skirt-front': [0, round(HIP_Y - TORSO_Y, 5), round(hinge['skirt-front'], 5)],
             'skirt-back': [0, round(HIP_Y - TORSO_Y, 5), round(hinge['skirt-back'], 5)],
             'head': [0, round(head_y - TORSO_Y, 5), 0], 'neck': [0, round(neck_top - .12 - TORSO_Y, 5), 0]}
    for side, suffix in ((-1, 'left'), (1, 'right')):
        j = joints[suffix]
        local = j['shoulder'] - Vector((0, TORSO_Y, 0))
        shoulder = frames['torso'] @ Matrix.Translation(local) @ rot_xyz(-.055, 0, side * .19)
        elbow_pos = shoulder.inverted() @ j['elbow']
        elbow = shoulder @ Matrix.Translation(elbow_pos) @ rot_xyz(-.07, 0, 0)
        wrist_pos = elbow.inverted() @ j['wrist']
        frames['shoulder-' + suffix], frames['elbow-' + suffix] = shoulder, elbow
        frames['wrist-' + suffix] = elbow @ Matrix.Translation(wrist_pos)
        nodes['shoulder-' + suffix] = [round(v, 5) for v in local]
        nodes['elbow-' + suffix] = [round(v, 5) for v in elbow_pos]
        nodes['wrist-' + suffix] = [round(v, 5) for v in wrist_pos]
        hip = Matrix.Translation((side * HIP_X, HIP_Y, 0))
        frames['hip-' + suffix] = hip
        frames['knee-' + suffix] = hip @ Matrix.Translation((0, -.32, 0))
        frames['ankle-' + suffix] = frames['knee-' + suffix] @ Matrix.Translation((0, -.3, 0))

    output, triangles = {}, 0
    for part, tris in groups.items():
        inverse = frames[part].inverted()
        rotation = inverse.to_3x3()
        merged = {}
        for pts, nrm, col in tris:
            g = merged.setdefault(col, {'color': col, 'position': [], 'normal': [], 'index': [], 'seen': {}})
            for p, n in zip(pts, nrm):
                local, ln = inverse @ p, (rotation @ n).normalized()
                key = (round(local.x, 5), round(local.y, 5), round(local.z, 5), round(ln.x, 3), round(ln.y, 3), round(ln.z, 3))
                index = g['seen'].get(key)
                if index is None:
                    index = g['seen'][key] = len(g['position']) // 3
                    g['position'].extend(key[:3])
                    g['normal'].extend(key[3:])
                g['index'].append(index)
            triangles += 1
        output[part] = [{k: v for k, v in g.items() if k != 'seen'} for g in merged.values()]
    source = os.path.basename(bpy.data.filepath)
    document = {'generator': 'client/scripts/blender/import-blend-avatar.py', 'source': source, 'id': AVATAR,
                'units': 'metres', 'up': '+Y', 'forward': '+Z', 'triangles': triangles, 'uniformScale': True,
                'nodes': nodes, 'parts': output}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, AVATAR + '.json'), 'w', encoding='utf8') as handle:
        json.dump(document, handle, separators=(',', ':'))
        handle.write('\n')
    print('imported', AVATAR, 'from', source, 'triangles', triangles, 'parts', sorted(output), 'scale', round(scale, 4))


main()
