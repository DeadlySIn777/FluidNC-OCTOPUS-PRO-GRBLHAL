"""Build the portable guide. The public board image is an official online reference.

Use --board-image PATH only for a private offline build with the exact reviewed
image. No network, browser, hardware access or test execution occurs here.
"""
from pathlib import Path
from hashlib import sha256
from html.parser import HTMLParser
import argparse
import base64
import runpy
import json
import re

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
OUTPUT = REPOSITORY / 'docs' / 'wiring' / 'visual'
BOARD_IMAGE_URL = 'https://raw.githubusercontent.com/bigtreetech/BIGTREETECH-OCTOPUS-Pro/60a01f412959b62c349ba00da15b45232b7d90c5/Hardware/BIGTREETECH%20Octopus%20Pro%20V1.1-Pin.jpg'
BOARD_IMAGE_SHA256 = 'd360491ad8e1f738b1e784bfd62cc2c0f2b4c396d6cd069b9743d62aab0ee285'

class DocumentCheck(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.duplicates = set()
        self.references = []
        self.remote_requests = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids: self.duplicates.add(attrs['id'])
            self.ids.add(attrs['id'])
        for attr in ('aria-controls', 'aria-labelledby', 'for'):
            if attr in attrs: self.references.extend(attrs[attr].split())
        if tag in ('script', 'img', 'link', 'image'):
            for key in ('src', 'href'):
                if attrs.get(key, '').startswith(('http:', 'https:', '//')):
                    self.remote_requests.append(attrs[key])

def read_json(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8-sig'))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT, help='generated directory (default: docs/wiring/visual)')
    parser.add_argument('--board-image', type=Path, help='exact official image for a private offline build only')
    args = parser.parse_args()
    output = args.output.resolve()
    if output == ROOT or output.is_relative_to(ROOT):
        raise SystemExit('Choose a generated output directory outside tools/visual-wiring.')
    if args.board_image and (output == OUTPUT or output.is_relative_to(OUTPUT)):
        raise SystemExit('Private embedded images require --output outside the public docs/wiring/visual directory.')
    cables, routes, layout = [read_json(name) for name in ('cable-data.json', 'route-content.json', 'asset-layout.json')]
    current_cables = runpy.run_path(str(ROOT / 'cable-data.py'))['build_dataset']()
    if cables != current_cables:
        raise SystemExit('Cable references changed. Run python tools/visual-wiring/cable-data.py before building.')
    assert len(cables['cables']) == 56 and len(routes['routes']) == 29
    assert len(set(cable['cable_id'] for cable in cables['cables'])) == 56
    assert all(cable['may_energize'] is False for cable in cables['cables'])
    assert routes['physicalMotionPermitted'] is False
    metadata = layout['assets']['cabinet']
    cabinet = (ROOT / metadata['file']).read_bytes()
    assert sha256(cabinet).hexdigest() == metadata['sha256']
    images = {'cabinet': 'data:image/jpeg;base64,' + base64.b64encode(cabinet).decode('ascii')}
    assert layout['assets']['board']['url'] == BOARD_IMAGE_URL
    assert layout['assets']['board']['sha256'] == BOARD_IMAGE_SHA256
    if args.board_image:
        board = args.board_image.read_bytes()
        if sha256(board).hexdigest() != BOARD_IMAGE_SHA256:
            raise SystemExit('The supplied board image does not match the exact reviewed official image.')
        images['board'] = 'data:image/jpeg;base64,' + base64.b64encode(board).decode('ascii')
    else:
        images['board'] = BOARD_IMAGE_URL
    board_reference = dict(mode='embedded-private' if args.board_image else 'external-reference',
        url=BOARD_IMAGE_URL, expectedSha256=BOARD_IMAGE_SHA256, buildBytesVerified=bool(args.board_image),
        runtimeBytesVerified=False, physicalConnectionVerified=False)
    coverage = read_json('coverage.json')
    covered_ids = [cid for group in coverage['groups'] for cid in group['cableIds']]
    assert len(covered_ids) == len(set(covered_ids)) == 56
    assert set(covered_ids) == {cable['cable_id'] for cable in cables['cables']}
    board_content, board_regions = read_json('board-content.json'), read_json('board-regions.json')
    assert board_content['sourceBoard']['sha256'] == layout['assets']['board']['sha256']
    assert board_content['physicalCheckComplete'] is False
    assert board_content['mayEnergize'] is False and board_content['mayMachine'] is False
    board_ids = [group['id'] for group in board_content['groups']]
    assert len(board_ids) == len(set(board_ids))
    for region in board_regions['regions']:
        assert set(region['groups']) <= set(board_ids)
        x,y,w,height = region['rect']
        assert x >= 0 and y >= 0 and w > 0 and height > 0
        assert x+w <= layout['assets']['board']['width'] and y+height <= layout['assets']['board']['height']
    known_cable_ids = {cable['cable_id'] for cable in cables['cables']}
    for group in board_content['groups']:
        for row in group['rows']:
            assert set(row.get('cableIds',[])+row.get('relatedCableIds',[])) <= known_cable_ids
    # These hashes identify repository files, not physical acceptance.
    for source in routes['sources'] + board_content['sources']:
        if source.get('path', '').startswith('docs/wiring/'):
            reference = (REPOSITORY / source['path']).resolve()
            assert reference.is_relative_to(REPOSITORY / 'docs' / 'wiring')
            source['sha256'] = sha256(reference.read_bytes()).hexdigest()
    bundle = dict(cables=cables, routes=routes, layout=layout, images=images, coverage=coverage,
        boardContent=board_content, boardRegions=board_regions, boardReference=board_reference)
    data = json.dumps(bundle, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    assert not re.search(r'\b[A-Za-z]:(?:\\|/(?!/))|/(?:Users|home)/', data), 'Local absolute paths must not be embedded.'
    model = (ROOT / 'model.mjs').read_text(encoding='utf-8')
    app = (ROOT / 'app.js').read_text(encoding='utf-8')
    assert app.startswith('import ') and app.splitlines()[0].endswith("from './model.mjs';")
    script = "'use strict';\n(() => {\n" + re.sub(r'^export ', '', model, flags=re.M) + '\n' + '\n'.join(app.splitlines()[1:]) + '\n})();\n'
    assert '</script' not in script.lower()
    template = (ROOT / 'index.template.html').read_text(encoding='utf-8')
    values = {'/*__STYLE__*/': (ROOT/'style.css').read_text(encoding='utf-8'), '/*__DATA__*/': data, '/*__APP__*/': script}
    for marker, value in values.items():
        assert template.count(marker) == 1
        template = template.replace(marker, value, 1)
    check = DocumentCheck(); check.feed(template)
    assert not check.duplicates, check.duplicates
    assert all(ref in check.ids for ref in check.references), set(check.references) - check.ids
    assert not check.remote_requests
    used_ids = set(re.findall(r"\$\('([^']+)'\)", app)) - {'view-'}
    assert used_ids <= check.ids, used_ids - check.ids
    assert not re.search(r'\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(', script)
    output.mkdir(parents=True, exist_ok=True)
    previous = output / 'index.html'
    temp = output / 'index.pending.html'
    temp.write_text(template, encoding='utf-8', newline='\n')
    temp.replace(previous)
    sources = {name: sha256((ROOT/name).read_bytes()).hexdigest() for name in ('build.py','cable-data.py','app.js','model.mjs','style.css','index.template.html','cable-data.json','route-content.json','asset-layout.json','coverage.json','board-content.json','board-regions.json')}
    manifest = dict(schemaVersion=1, product='MR1 Visual Wiring Guide',
        stage='Unpowered cable preparation; physical connection/electrical acceptance pending',
        sourceFiles=sources, sourceScheduleSha256=cables['source']['csv']['sha256'],
        cables=len(cables['cables']), defaultVisibleCables=len(cables['active_ids']), functionalViews=len(routes['routes']),
        explicitlyMappedCableIds=len({route['cableLabel'] for route in routes['routes'] if route['labelKind']=='source-cable-id'}),
        systemGroups=len(coverage['groups']), pendingCoverageCategories=len(coverage['gaps']),
        boardSchematicGroups=len(board_ids), boardLocationRegions=len(board_regions['regions']),
        sourcePhotos={name:layout['assets'][name]['sha256'] for name in images}, boardReference=board_reference,
        files=[dict(path='index.html',bytes=previous.stat().st_size,sha256=sha256(previous.read_bytes()).hexdigest())],
        physicalMotionPermitted=False,
        checks=dict(duplicateIds=len(check.duplicates),missingLabelTargets=sum(ref not in check.ids for ref in check.references),
            externalRuntimeResources=[value for value in images.values() if value.startswith('https:')]),
        unitTests='Run separately; this builder does not execute or certify the test suites.',
        browserVisualVerification='Not performed by this builder.')
    (output/'BUILD-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8',newline='\n')
    (output/'SHA256.txt').write_text(manifest['files'][0]['sha256']+'  index.html\n',encoding='ascii',newline='\n')
    print(json.dumps({key:manifest[key] for key in ('cables','defaultVisibleCables','functionalViews','files','checks')}))

if __name__ == '__main__': main()
