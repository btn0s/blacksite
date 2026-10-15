import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import shutil
import sys
import urllib.error
import urllib.parse


class FabError(Exception):
    pass


def main(request):
    script_value = os.environ.get('FAB_SYNC_SCRIPT', 'fab-sync')
    script = Path(script_value)
    if not script.is_file():
        found = shutil.which(script_value)
        if found:
            script = Path(found)
    if not script.is_file():
        raise FabError('Existing fab-sync script is unavailable on this host. Configure FAB_SYNC_SCRIPT or FAB_AUTH_BROKER.')
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        fab = runpy.run_path(str(script), run_name='fab_studio_bridge')
        if request['operation'] == 'session-status':
            return {'signedIn': fab['SESSION'].is_file()}
        if request['operation'] == 'session-secure':
            fab['SESSION'].chmod(0o600)
            return True
        if request['operation'] == 'session-remove':
            fab['SESSION'].unlink(missing_ok=True)
            return True
        if not fab['SESSION'].is_file():
            raise FabError('Existing fab-sync session is unavailable on this host.')
        saved = json.loads(fab['SESSION'].read_text())
        access, account = fab['token']({'grant_type': 'refresh_token', 'refresh_token': saved['refresh_token']})
    headers = {'Authorization': 'bearer ' + access}
    assets = []
    cursor = None
    while True:
        query = 'count=100' + ('&cursor=' + urllib.parse.quote(cursor) if cursor else '')
        page = fab['request'](f'https://www.fab.com/e/accounts/{account}/ue/library?{query}', headers=headers)
        assets.extend(page.get('results', []))
        cursor = page.get('cursors', {}).get('next')
        if not cursor:
            break
    if request['operation'] == 'library':
        return [{'id': 'fab_' + a['assetId'], 'source': 'fab', 'assetId': a['assetId'], 'namespace': a['assetNamespace'], 'title': a['title'], 'seller': a.get('seller', ''), 'url': a.get('url', '').split('?')[0], 'categories': [c['name'] for c in a.get('categories', [])], 'formats': ['Unreal Engine'] if a.get('projectVersions') else [], 'owned': True, 'downloaded': False, 'inProject': False, 'thumbnail': next((i['url'].split('?')[0] for i in a.get('images', []) if i.get('url')), None)} for a in assets]
    item = request['item']
    asset = next((a for a in assets if a['assetId'] == item.get('assetId') or a.get('url') == item.get('url')), None)
    if not asset:
        raise FabError('Item was not found in the authenticated Fab UE library. Download its non-UE format through the Fab browser.')
    versions = asset.get('projectVersions', [])
    formats = []
    listing = asset.get('url', '').rstrip('/').split('/')[-1]
    if '/listings/' in asset.get('url', '') and (request['operation'] == 'formats' or ':' in (request.get('formatId') or '')):
        try:
            formats = fab['request'](f'https://www.fab.com/i/listings/{listing}/asset-formats', headers=headers)
        except urllib.error.HTTPError:
            if request['operation'] != 'formats':
                raise
    if request['operation'] == 'formats':
        result = [{'id': v['artifactId'], 'name': 'Unreal Engine — ' + ', '.join(v.get('engineVersions', [])), 'kind': 'ue', 'available': True} for v in reversed(versions)]
        for entry in formats:
            code = entry['assetFormatType']['code']
            if code == 'unreal-engine':
                continue
            for file in sorted(entry.get('files', []), key=lambda f: f.get('fileSize') or 0):
                kind = code if code in ('glb', 'gltf', 'fbx', 'usd') else 'archive' if file['name'].endswith(('.zip', '.7z')) else 'other'
                format = {'id': code + ':' + file['uid'], 'name': entry['assetFormatType']['name'] + ' — ' + file['name'], 'kind': kind, 'available': True}
                size = file.get('fileSize')
                if type(size) is int and size >= 0:
                    format['sizeBytes'] = size
                result.append(format)
        return result
    if ':' in (request.get('formatId') or ''):
        code, uid = request['formatId'].split(':', 1)
        entry = next((e for e in formats if e['assetFormatType']['code'] == code), None)
        file = next((f for f in entry.get('files', []) if f['uid'] == uid), None) if entry else None
        if not file:
            raise FabError('Requested file is not present in this listing format.')
        data = fab['request'](f'https://www.fab.com/i/listings/{listing}/asset-formats/{code}/files/{uid}/download-info', headers=headers)
        info = next(iter(data.get('downloadInfo', [])), None)
        if not info or not info.get('downloadUrl'):
            raise FabError('Fab did not return a download for this owned format.')
        return {'kind': 'http', 'itemId': item['id'], 'filename': file['name'], 'size': file.get('fileSize'), 'url': info['downloadUrl'], 'expires': info.get('expires')}
    version = next((v for v in versions if v['artifactId'] == request.get('formatId')), None) if request.get('formatId') else next(iter(reversed(versions)), None)
    if not version:
        raise FabError('Selected format is not present in the authenticated Fab library.')
    variants = [(asset['assetNamespace'], asset['assetId'])]
    if asset.get('legacyItemId'):
        variants.insert(0, ('ue', asset['legacyItemId']))
    for namespace, catalog in variants:
        endpoint = f'https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/public/assets/v2/platform/Windows/namespace/{namespace}/catalogItem/{catalog}/app/{version["artifactId"]}/label/Live'
        try:
            data = fab['request'](endpoint, headers=headers)
        except urllib.error.HTTPError as error:
            if error.code in (403, 404):
                continue
            raise
        element = next(iter(data.get('elements', [])), {})
        manifests = []
        for entry in element.get('manifests', []):
            url = entry['uri']
            query = entry.get('queryParams', [])
            if query:
                url += ('&' if '?' in url else '?') + urllib.parse.urlencode({p['name']: p['value'] for p in query})
            manifests.append(url)
        if manifests:
            return {'kind': 'buildpatch', 'itemId': item['id'], 'artifactId': version['artifactId'], 'manifestUrls': manifests, 'buildVersion': element.get('buildVersion', '')}
    raise FabError('Epic did not issue a manifest for this owned format. Use the authenticated Fab browser or Epic Launcher.')


try:
    request = json.loads(sys.stdin.read())
    result = main(request)
    sys.stdout.write(json.dumps({'value': result}))
except FabError as error:
    sys.stdout.write(json.dumps({'error': str(error)}))
except urllib.error.HTTPError as error:
    sys.stdout.write(json.dumps({'error': f'Epic/Fab request returned HTTP {error.code}. Refresh the existing fab-sync session if authentication expired.'}))
except BaseException:
    sys.stdout.write(json.dumps({'error': 'Fab runtime authentication or API request failed. Existing session values were not logged.'}))
