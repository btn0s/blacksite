import bpy, bmesh, math, sys
from mathutils import Vector
from pathlib import Path
args = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, args[0])
bpy.utils.extension_path_user = lambda *a, **kw: str(Path(args[1]).parent / 'mpfb-data')
import addon_utils
addon_utils.enable('mpfb', default_set=True)
from mpfb.services.humanservice import HumanService

OUT = args[1]
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
macro = {"gender": 1.0, "age": 0.5, "muscle": 0.68, "weight": 0.5, "height": 0.55, "proportions": 0.6,
         "race": {"african": 0.2, "asian": 0.2, "caucasian": 0.6}}
body = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=False, scale=0.1, macro_detail_dict=macro)
HumanService.add_builtin_rig(body, "game_engine", import_weights=True)
rig = body.parent if body.parent and body.parent.type == 'ARMATURE' else [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
for m in list(body.modifiers):
    if m.type != 'ARMATURE': body.modifiers.remove(m)
if body.data.shape_keys:
    body.shape_key_add(name='mix', from_mix=True)
    keys = body.data.shape_keys.key_blocks
    mix = keys['mix'].data
    for i, v in enumerate(body.data.vertices): v.co = mix[i].co.copy()
    body.shape_key_clear()

bones = {b.name: b for b in rig.data.bones}
def head(n): return rig.matrix_world @ bones[n].head_local
def tail(n): return rig.matrix_world @ bones[n].tail_local

SIDES = {'l': 1, 'r': -1}
ARM = {s: [f'upperarm_{s}', f'lowerarm_{s}', f'hand_{s}'] + [f'{f}_0{i}_{s}' for f in ('thumb', 'index', 'middle', 'ring', 'pinky') for i in (1, 2, 3)] for s in SIDES}
HAND = {s: set(ARM[s][2:]) for s in SIDES}
groups = {g.index: g.name for g in body.vertex_groups}
helper = {body.vertex_groups[n].index for n in ('HelperGeometry', 'JointCubes') if n in body.vertex_groups}

def weights(v):
    return {groups[g.group]: g.weight for g in v.groups if g.weight > 0}

def axis(s):
    shoulder, elbow, wrist = head(f'upperarm_{s}'), head(f'lowerarm_{s}'), head(f'hand_{s}')
    return shoulder, elbow, wrist

bm = bmesh.new()
bm.from_mesh(body.data)
deform = bm.verts.layers.deform.active
bm.verts.ensure_lookup_table()
part = {}
for v in bm.verts:
    w = {groups[k]: x for k, x in v[deform].items()}
    if any(groups.get(k) in ('HelperGeometry', 'JointCubes') for k in v[deform].keys()) and sum(w.get(n, 0) for n in ('HelperGeometry', 'JointCubes')) > 0:
        part[v.index] = None; continue
    tag = None
    for s in SIDES:
        arm = sum(w.get(n, 0) for n in ARM[s])
        if arm < 0.5: continue
        shoulder, elbow, wrist = axis(s)
        p = v.co
        fore = (wrist - elbow).normalized()
        along = (p - wrist).dot(fore)
        upper = (elbow - shoulder).normalized()
        from_elbow = (p - elbow).dot(upper)
        if from_elbow < -0.17: continue
        hand = sum(w.get(n, 0) for n in HAND[s])
        tag = (s, 'glove' if along > -0.055 else 'skin', along)
    part[v.index] = tag
import collections
print('ARM STATS', collections.Counter((t[0], t[1]) if t else None for t in part.values()), len(bm.verts))
vv = bm.verts[1000]; print('ARM SAMPLE', vv.co, {groups[k]: x for k, x in vv[deform].items()}, head('hand_r'))
geom = [v for v in bm.verts if part.get(v.index) is None]
bmesh.ops.delete(bm, geom=geom, context='VERTS')
bm.to_mesh(body.data)
bm.free()
print('ARM VERTS', len(body.data.vertices), 'POLYS', len(body.data.polygons))

body.data.materials.clear()
glove = bpy.data.materials.new('Glove'); sleeve = bpy.data.materials.new('Sleeve')
body.data.materials.append(glove); body.data.materials.append(sleeve)

def make_part(name, keep, offset, solid, subdivide=True):
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.duplicate()
    obj = bpy.context.active_object
    obj.name = name
    bm = bmesh.new(); bm.from_mesh(obj.data)
    remove = [f for f in bm.faces if not keep(f)]
    bmesh.ops.delete(bm, geom=remove, context='FACES')
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(obj.data); bm.free()
    if subdivide:
        sub = obj.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
        bpy.ops.object.modifier_apply(modifier='sub')
    obj.data.update()
    for v in obj.data.vertices:
        v.co += v.normal * offset(v.co)
    if solid:
        so = obj.modifiers.new('solid', 'SOLIDIFY'); so.thickness = solid; so.offset = -1; so.use_rim = True
        bpy.ops.object.modifier_apply(modifier='solid')
    return obj

def side_of(co):
    return 'l' if co.x > 0 else 'r'

def along_wrist(co):
    s = side_of(co); shoulder, elbow, wrist = axis(s)
    return (co - wrist).dot((wrist - elbow).normalized())

import random
random.seed(7)
def fold(co):
    s = side_of(co); shoulder, elbow, wrist = axis(s)
    a = along_wrist(co)
    ring = math.sin(a * 2 * math.pi / 0.045) * 0.5 + 0.5
    near_wrist = max(0, min(1, (a + 0.16) / 0.12))
    elbow_d = (co - elbow).length
    bunch = max(0, 1 - elbow_d / 0.09)
    return 0.016 + 0.006 * ring * (0.35 + 0.65 * near_wrist) + 0.008 * bunch + 0.003 * near_wrist

def glove_offset(co):
    a = along_wrist(co)
    cuff = max(0, min(1, (-a - 0.0) / 0.04))
    return 0.0018 + 0.0045 * cuff

def face_center(f):
    return sum((v.co for v in f.verts), Vector()) / len(f.verts)

gl = make_part('BlacksiteArmsGloves', lambda f: along_wrist(face_center(f)) > -0.06, glove_offset, 0.0, False)

arm_points = {sd: [] for sd in SIDES}
for v in body.data.vertices:
    arm_points[side_of(v.co)].append(v.co.copy())

def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

def build_sleeve(sd):
    shoulder, elbow, wrist = axis(sd)
    upper_len = (elbow - shoulder).length
    fore_len = (wrist - elbow).length
    start = 0.42 * upper_len
    end = upper_len + fore_len - 0.035
    rings, segs = 44, 22
    def frame(d):
        if d < upper_len:
            p = shoulder + (elbow - shoulder) * (d / upper_len)
        else:
            p = elbow + (wrist - elbow) * ((d - upper_len) / fore_len)
        k = smooth(upper_len - 0.06, upper_len + 0.06, d)
        t = ((elbow - shoulder).normalized() * (1 - k) + (wrist - elbow).normalized() * k).normalized()
        return p, t, k
    pts = arm_points[sd]
    rnd = random.Random(11 if sd == 'l' else 23)
    phase = [rnd.uniform(0, 6.28) for _ in range(6)]
    verts, weights, uvs, along = [], [], [], []
    raw = []
    frames = []
    for i in range(rings + 1):
        d = start + (end - start) * i / rings
        p, t, k = frame(d)
        ref = Vector((0, 0, 1)); ref = (ref - t * ref.dot(t)).normalized(); other = t.cross(ref)
        frames.append((d, p, t, k, ref, other))
        bins = []
        for j in range(segs):
            a = j / segs * 2 * math.pi
            dirv = ref * math.cos(a) + other * math.sin(a)
            hit = tree.ray_cast(p + dirv * 0.09, -dirv, 0.09)
            bins.append(0.09 - hit[3] if hit[0] is not None else None)
        raw.append(bins)
    for j in range(segs):
        col = [raw[i][j] for i in range(rings + 1)]
        known = [(i, x) for i, x in enumerate(col) if x is not None]
        for i in range(rings + 1):
            if col[i] is None:
                col[i] = min(known, key=lambda e: abs(e[0] - i))[1] if known else 0.04
        for i in range(rings + 1): raw[i][j] = col[i]
    smoothed = [[0.0] * segs for _ in range(rings + 1)]
    for i in range(rings + 1):
        for j in range(segs):
            acc, wsum = 0.0, 0.0
            for di in range(-3, 4):
                for dj in range(-1, 2):
                    ii = min(rings, max(0, i + di)); w = 1.0 / (1 + abs(di) + abs(dj))
                    acc += raw[ii][(j + dj) % segs] * w; wsum += w
            smoothed[i][j] = acc / wsum
    for i in range(rings + 1):
        d, p, t, k, ref, other = frames[i]
        bins = smoothed[i]
        near_cuff = smooth(end - 0.12, end - 0.01, d)
        near_elbow = max(0.0, 1 - abs(d - upper_len) / 0.07)
        ring = []
        for j in range(segs):
            a = j / segs * 2 * math.pi
            fold = 0.004 * math.sin(d / 0.028 * 6.28 + 2.5 * math.sin(a + phase[0])) * (0.4 + near_cuff) \
                + 0.003 * math.sin(a * 3 + d * 40 + phase[1]) + 0.005 * near_elbow * (0.5 + 0.5 * math.sin(a * 5 + phase[2]))
            radius = bins[j] + 0.011 + 0.006 * near_cuff + fold
            dirv = ref * math.cos(a) + other * math.sin(a)
            ring.append(p + dirv * radius)
        verts.append(ring)
        weights.append(k)
        along.append(d)
    hem_inner = []
    p, t, k = frame(end)
    for j in range(segs):
        c = verts[-1][j]
        hem_inner.append(p + (c - p) * 0.86 - t * 0.012)
    me = bpy.data.meshes.new(f'sleeve_{sd}')
    bm = bmesh.new()
    rows = [[bm.verts.new(v) for v in ring] for ring in verts]
    inner = [bm.verts.new(v) for v in hem_inner]
    uv_rows = []
    for i in range(rings):
        for j in range(segs):
            a, b, c, d2 = rows[i][j], rows[i][(j + 1) % segs], rows[i + 1][(j + 1) % segs], rows[i + 1][j]
            f = bm.faces.new((a, d2, c, b) if sd == 'l' else (a, b, c, d2))
    for j in range(segs):
        a, b, c, d2 = rows[-1][j], rows[-1][(j + 1) % segs], inner[(j + 1) % segs], inner[j]
        bm.faces.new((a, d2, c, b) if sd == 'l' else (a, b, c, d2))
    bm.normal_update()
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(f'sleeve_{sd}', me)
    bpy.context.scene.collection.objects.link(obj)
    gu = obj.vertex_groups.new(name=f'upperarm_{sd}'); gf = obj.vertex_groups.new(name=f'lowerarm_{sd}')
    for i in range(rings + 1):
        for j in range(segs):
            idx = i * segs + j
            gu.add([idx], 1 - weights[i], 'REPLACE'); gf.add([idx], weights[i], 'REPLACE')
    for j in range(segs):
        gf.add([(rings + 1) * segs + j], 1.0, 'REPLACE')
    me.calc_loop_triangles()
    uv = me.uv_layers.new(name='UVMap')
    circumference = 0.3
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            if vi >= (rings + 1) * segs:
                i, j = rings + 0.3, vi - (rings + 1) * segs
            else:
                i, j = vi // segs, vi % segs
            uv.data[li].uv = (j / segs * circumference / 0.35, (start + (end - start) * min(i, rings) / rings + (0.012 if i > rings else 0)) / 0.35)
        js = [me.loops[li].vertex_index % segs for li in poly.loop_indices]
        if max(js) == segs - 1 and min(js) == 0:
            for li in poly.loop_indices:
                if me.loops[li].vertex_index % segs == 0:
                    uv.data[li].uv.x += circumference / 0.35
    return obj

from mathutils.bvhtree import BVHTree
tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
parts = [build_sleeve('l'), build_sleeve('r')]
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
sl = bpy.context.active_object
sl.name = 'BlacksiteArmsSleeves'
bpy.ops.object.shade_smooth()
so = sl.modifiers.new('solid', 'SOLIDIFY'); so.thickness = 0.004; so.offset = -1; so.use_rim = True
bpy.ops.object.modifier_apply(modifier='solid')
bpy.data.objects.remove(body)
for o, mat in ((gl, 0), (sl, 1)):
    for p in o.data.polygons: p.material_index = 0
    o.data.materials.clear(); o.data.materials.append(glove if mat == 0 else sleeve)
def uv_sleeve(obj, tile=0.35):
    me = obj.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new()
    for p in me.polygons:
        coords = []
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            s = side_of(co); shoulder, elbow, wrist = axis(s)
            a = along_wrist(co)
            ax = (wrist - elbow).normalized()
            ref = Vector((0, 0, 1)) - ax * ax.z
            ref.normalize(); other = ax.cross(ref)
            d = co - wrist
            ang = math.atan2(d.dot(other), d.dot(ref))
            coords.append([ang, a])
        base = coords[0][0]
        for c in coords:
            while c[0] - base > math.pi: c[0] -= 2 * math.pi
            while c[0] - base < -math.pi: c[0] += 2 * math.pi
        for li, c in zip(p.loop_indices, coords):
            uv.data[li].uv = (c[0] * 0.055 / tile, c[1] / tile)

def uv_box(obj, tile=0.12):
    me = obj.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new()
    for p in me.polygons:
        n = p.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u, v = [(co.y, co.z), (co.x, co.z), (co.x, co.y)][ax]
            uv.data[li].uv = (u / tile, v / tile)

uv_box(gl)
for o in (gl,):
    while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])

scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48; scene.cycles.device = 'CPU'
for o in (gl, sl):
    o.data.color_attributes.new('ao', 'BYTE_COLOR', 'POINT')
    o.data.attributes.active_color = o.data.color_attributes['ao']
bpy.ops.object.select_all(action='DESELECT')
for o in (gl, sl): o.select_set(True)
bpy.context.view_layer.objects.active = gl
scene.render.bake.target = 'VERTEX_COLORS'
for mat in (glove, sleeve):
    mat.use_nodes = True
try:
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    print('AO baked')
except Exception as e:
    print('AO bake failed', e)

bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = rig; rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
keep = {n for s in SIDES for n in ARM[s]} | {'clavicle_l', 'clavicle_r', 'spine_03', 'Root'}
eb['spine_03'].parent = eb['Root']
for b in list(eb):
    if b.name not in keep: eb.remove(b)
bpy.ops.object.mode_set(mode='OBJECT')
names = {b.name for b in rig.data.bones}
for o in (gl, sl):
    for g in list(o.vertex_groups):
        if g.name not in names: o.vertex_groups.remove(g)
    o.parent = rig
    for m in o.modifiers:
        if m.type == 'ARMATURE': m.object = rig
    if not any(m.type == 'ARMATURE' for m in o.modifiers):
        m = o.modifiers.new('Armature', 'ARMATURE'); m.object = rig
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
rig.name = 'BlacksiteArms'
for o in list(bpy.data.objects):
    if o not in (rig, gl, sl): bpy.data.objects.remove(o)
for o in (gl, sl): print('PART', o.name, len(o.data.vertices), 'verts', sum(len(p.vertices) - 2 for p in o.data.polygons), 'tris')
for b in rig.data.bones: print('BONE', b.name, b.parent.name if b.parent else None)
bpy.ops.wm.save_as_mainfile(filepath=OUT.replace('.glb', '.blend'))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=False, export_animations=False, export_skins=True,
    export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_yup=True, export_apply=False, export_materials='EXPORT', export_image_format='NONE')
print('EXPORTED', OUT)
