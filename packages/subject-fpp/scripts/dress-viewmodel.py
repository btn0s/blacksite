import argparse
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OLIVE = np.array([0.50, 0.52, 0.36])


def read_glb(path):
    blob = Path(path).read_bytes()
    size = struct.unpack_from('<I', blob, 12)[0]
    document = json.loads(blob[20:20 + size])
    data = blob[28 + size:]
    views = []
    for view in document['bufferViews']:
        start = view.get('byteOffset', 0)
        views.append(bytes(data[start:start + view['byteLength']]))
    return document, views


def write_glb(path, document, views):
    payload = bytearray()
    for index, chunk in enumerate(views):
        while len(payload) % 4:
            payload.append(0)
        document['bufferViews'][index]['byteOffset'] = len(payload)
        document['bufferViews'][index]['byteLength'] = len(chunk)
        payload.extend(chunk)
    while len(payload) % 4:
        payload.append(0)
    document['buffers'] = [{'byteLength': len(payload)}]
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * ((-len(text)) % 4)
    total = 12 + 8 + len(text) + 8 + len(payload)
    Path(path).write_bytes(struct.pack('<4sII', b'glTF', 2, total) + struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(payload), 0x004E4942) + bytes(payload))


def image(document, views, texture):
    source = document['textures'][texture]['source']
    return source, Image.open(io.BytesIO(views[document['images'][source]['bufferView']])).convert('RGB')


def encode(picture, size, quality):
    out = io.BytesIO()
    picture.resize((size, size), Image.LANCZOS).save(out, 'JPEG', quality=quality, optimize=True, progressive=False)
    return out.getvalue()


def blurred_fill(pixels, mask, radius):
    keep = (~mask).astype(np.float32)
    weighted = Image.fromarray(np.uint8(np.clip(pixels * keep[..., None], 0, 255)))
    weight = Image.fromarray(np.uint8(keep * 255))
    numerator = np.asarray(weighted.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)
    denominator = np.asarray(weight.filter(ImageFilter.GaussianBlur(radius)), dtype=np.float32)[..., None] / 255
    return numerator / np.maximum(denominator, 1e-3)


def clean_glove(picture):
    pixels = np.asarray(picture, dtype=np.float32)
    luminance = pixels @ np.array([0.2126, 0.7152, 0.0722])
    mask = Image.fromarray(np.uint8(luminance > 150) * 255).filter(ImageFilter.MaxFilter(7))
    mask = np.asarray(mask) > 0
    filled = blurred_fill(pixels, mask, 10)
    pixels = np.where(mask[..., None], filled, pixels)
    return Image.fromarray(np.uint8(np.clip(pixels, 0, 255)))


def olive_sleeve(picture, detail=1.4):
    pixels = np.asarray(picture, dtype=np.float32) / 255
    luminance = pixels @ np.array([0.2126, 0.7152, 0.0722])
    broad = np.asarray(Image.fromarray(np.uint8(luminance * 255)).filter(ImageFilter.GaussianBlur(24)), dtype=np.float32) / 255
    fine = luminance - np.asarray(Image.fromarray(np.uint8(luminance * 255)).filter(ImageFilter.GaussianBlur(2)), dtype=np.float32) / 255
    luminance = broad + (luminance - broad - fine) * 0.3 + fine * detail
    tone = np.clip(luminance * 1.55 + 0.03, 0, 1)[..., None] * (OLIVE / (OLIVE @ np.array([0.2126, 0.7152, 0.0722])))
    rust = np.clip((pixels[..., 0] - pixels[..., 2]) * 4, 0, 1)[..., None]
    mixed = tone * (1 - 0.35 * rust) + pixels * 1.4 * 0.35 * rust
    return Image.fromarray(np.uint8(np.clip(mixed, 0, 1) * 255))


def olive_region(box):
    def dress(picture):
        pixels = np.asarray(picture, dtype=np.float32)
        height, width = pixels.shape[:2]
        left, top, right, bottom = int(box[0] * width), int(box[1] * height), int(box[2] * width), int(box[3] * height)
        region = pixels[top:bottom, left:right]
        mean = float((region @ np.array([0.2126, 0.7152, 0.0722])).mean()) / 255
        gamma = np.log(0.14) / np.log(min(max(mean, 0.01), 0.9))
        lifted = Image.fromarray(np.uint8(np.clip(255 * (pixels / 255) ** gamma, 0, 255)))
        toned = np.asarray(olive_sleeve(lifted.filter(ImageFilter.GaussianBlur(1)), 0.5), dtype=np.float32)
        weight = np.zeros((height, width), dtype=np.float32)
        weight[top:bottom, left:right] = 1
        weight = np.asarray(Image.fromarray(np.uint8(weight * 255)).filter(ImageFilter.GaussianBlur(4)), dtype=np.float32)[..., None] / 255
        return Image.fromarray(np.uint8(np.clip(pixels + (toned - pixels) * weight, 0, 255)))
    return dress


def main(source, output, olive, clean, size, sleeve):
    document, views = read_glb(source)
    replace = {}
    used = set()

    def keep(slot, texture, transform, edge, quality):
        if texture is None:
            return
        source_image, picture = image(document, views, texture['index'])
        replace[source_image] = encode(transform(picture), edge, quality)
        used.add(texture['index'])

    for material in document.get('materials', []):
        material.pop('extensions', None)
        material.pop('emissiveTexture', None)
        material.pop('emissiveFactor', None)
        pbr = material.get('pbrMetallicRoughness', {})
        name = material.get('name', '')
        dress = olive_sleeve if name in olive else clean_glove if name in clean else olive_region(sleeve[name]) if name in sleeve else (lambda picture: picture)
        keep('base', pbr.get('baseColorTexture'), dress, size, 88)
        keep('rough', pbr.get('metallicRoughnessTexture'), lambda picture: picture, size // 2, 90)
        keep('normal', material.get('normalTexture'), lambda picture: picture, size, 92)
        keep('occlusion', material.get('occlusionTexture'), lambda picture: picture, size // 2, 90)
    document.pop('extensionsUsed', None)
    document.pop('extensionsRequired', None)
    remap = {}
    textures = []
    for index in sorted(used):
        remap[index] = len(textures)
        textures.append(document['textures'][index])
    images = []
    image_remap = {}
    for texture in textures:
        old = texture['source']
        if old not in image_remap:
            image_remap[old] = len(images)
            entry = dict(document['images'][old])
            entry['mimeType'] = 'image/jpeg'
            views[entry['bufferView']] = replace[old]
            images.append(entry)
        texture['source'] = image_remap[old]
    document['textures'] = textures
    document['images'] = images

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key.endswith('Texture') and isinstance(value, dict) and 'index' in value:
                    value['index'] = remap[value['index']]
                else:
                    walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(document.get('materials', []))
    for material in document.get('materials', []):
        for key in [key for key, value in material.items() if key.endswith('Texture') and value['index'] is None]:
            material.pop(key)
    live = {entry['bufferView'] for entry in images}
    for accessor in document['accessors']:
        if 'bufferView' in accessor:
            live.add(accessor['bufferView'])
    order = sorted(live)
    view_remap = {old: new for new, old in enumerate(order)}
    for entry in images:
        entry['bufferView'] = view_remap[entry['bufferView']]
    for accessor in document['accessors']:
        if 'bufferView' in accessor:
            accessor['bufferView'] = view_remap[accessor['bufferView']]
    document['bufferViews'] = [document['bufferViews'][old] for old in order]
    document['asset']['generator'] = 'Blacksite viewmodel dress'
    write_glb(output, document, [views[old] for old in order])
    print(output, Path(output).stat().st_size)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--olive', action='append', default=[])
    parser.add_argument('--clean', action='append', default=[])
    parser.add_argument('--sleeve', action='append', default=[])
    parser.add_argument('--size', type=int, default=1024)
    options = parser.parse_args()
    sleeve = {entry.rsplit('@', 1)[0]: [float(value) for value in entry.rsplit('@', 1)[1].split(',')] for entry in options.sleeve}
    main(options.source, options.output, set(options.olive), set(options.clean), options.size, sleeve)
