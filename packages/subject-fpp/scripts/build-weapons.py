import bpy, bmesh, sys, math
from pathlib import Path
from mathutils import Matrix, Vector
args=sys.argv[sys.argv.index('--')+1:]
kind,source,output=args
bpy.ops.wm.open_mainfile(filepath=source)
if kind=='rifle':
    mesh=next(o for o in bpy.data.objects if o.type=='MESH')
    world=mesh.matrix_world.copy()
    transform=Matrix.Rotation(math.pi,4,'Z') @ Matrix.Translation((0,0.15,0.04))
    mesh.data.transform(transform @ world)
    mesh.matrix_world=Matrix.Identity(4)
    bm=bmesh.new();bm.from_mesh(mesh.data);bm.verts.ensure_lookup_table();todo=set(bm.verts);mag=[];bolt=[]
    while todo:
        stack=[todo.pop()];found=[]
        while stack:
            v=stack.pop();found.append(v)
            for edge in v.link_edges:
                other=edge.other_vert(v)
                if other in todo:todo.remove(other);stack.append(other)
        lo=[min(v.co[i]for v in found)for i in range(3)];hi=[max(v.co[i]for v in found)for i in range(3)]
        if lo[2]<-0.17:mag.extend(v.index for v in found)
        if lo[0]<-0.03 and hi[0]>0.01:bolt.extend(v.index for v in found)
    bm.free()
    for o in list(bpy.data.objects):
        if o!=mesh:bpy.data.objects.remove(o)
    data=bpy.data.armatures.new('BlacksiteRifle');rig=bpy.data.objects.new('BlacksiteRifle',data);bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
    for name,position in [('weapon',(0,0,0)),('magazine',(0,-0.12,0.01)),('charging_handle',(-0.02,-0.08,0.06)),('muzzle',(0,-0.6395,0.04))]:
        bone=data.edit_bones.new(name);bone.head=position;bone.tail=Vector(position)+Vector((0,0,0.03))
        if name!='weapon':bone.parent=data.edit_bones['weapon']
    bpy.ops.object.mode_set(mode='OBJECT')
    base=mesh.vertex_groups.new(name='weapon');base.add(list(range(len(mesh.data.vertices))),1,'REPLACE')
    for name,ids in [('magazine',mag),('charging_handle',bolt)]:
        if ids:base.remove(ids);mesh.vertex_groups.new(name=name).add(ids,1,'REPLACE')
    mesh.parent=rig;mod=mesh.modifiers.new('Armature','ARMATURE');mod.object=rig
    mesh.name='BlacksiteRifle'
    for image in bpy.data.images:
        if image.size[0]>1024:image.scale(1024,1024)
else:
    rig=next(o for o in bpy.data.objects if o.type=='ARMATURE');mesh=next(o for o in bpy.data.objects if o.type=='MESH')
    rig.animation_data_clear()
    for pose in rig.pose.bones:pose.matrix_basis.identity()
    bpy.context.view_layer.update()
    transform=Matrix.Rotation(-math.pi/2,4,'Z') @ Matrix.Scale(0.024,4) @ Matrix.Translation((2.9,0,0))
    mesh.data.transform(transform @ mesh.matrix_world)
    rig.data.transform(transform @ rig.matrix_world)
    mesh.parent=None;mesh.matrix_world=Matrix.Identity(4);rig.matrix_world=Matrix.Identity(4);mesh.parent=rig
    for name in ['Control','Slide','Trigger','Magazine']:
        new={'Control':'weapon','Slide':'slide','Trigger':'trigger','Magazine':'magazine'}[name]
        rig.data.bones[name].name=new
        if name in mesh.vertex_groups:mesh.vertex_groups[name].name=new
    bpy.context.view_layer.objects.active=rig;bpy.ops.object.mode_set(mode='EDIT')
    bone=rig.data.edit_bones.new('muzzle');bone.head=(0,-0.188,0.055);bone.tail=(0,-0.188,0.085);bone.parent=rig.data.edit_bones['weapon']
    bpy.ops.object.mode_set(mode='OBJECT')
    for mat in mesh.data.materials:
        mat.name='polymer' if mat.name in ['Wood','Magazine'] else 'steel'
        mat.use_nodes=True
        p=mat.node_tree.nodes.get('Principled BSDF')
        if p:p.inputs['Base Color'].default_value=(0.07,0.07,0.07,1)
    for o in list(bpy.data.objects):
        if o not in [rig,mesh]:bpy.data.objects.remove(o)
    mesh.name='BlacksitePistol'
    uv=mesh.data.uv_layers[0] if mesh.data.uv_layers else mesh.data.uv_layers.new(name='UVMap')
    for poly in mesh.data.polygons:
        axis=max(range(3),key=lambda i:abs(poly.normal[i]))
        for li in poly.loop_indices:
            co=mesh.data.vertices[mesh.data.loops[li].vertex_index].co
            a,b=[(co.y,co.z),(co.x,co.z),(co.x,co.y)][axis]
            uv.data[li].uv=(a/0.2,b/0.2)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=output,export_format='GLB',export_animations=False,export_skins=True,export_yup=True,export_materials='EXPORT',export_image_format='JPEG',export_jpeg_quality=88)
print('EXPORTED',output)
