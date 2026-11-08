#!/usr/bin/env python3
"""Build and submit one extension ZIP to Chrome Web Store and Edge Add-ons."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_DIRS = {'.git', '.github', '.venv', 'venv', 'node_modules', 'dist', 'build', 'tests', '__pycache__', 'scripts'}
EXCLUDE_FILES = {'.env', '.DS_Store', 'Thumbs.db', '.gitignore', '.npmrc'}
CHROME = 'https://chromewebstore.googleapis.com'
EDGE = 'https://api.addons.microsoftedge.microsoft.com'


def fail(message):
    raise RuntimeError(message)


def request(method, url, *, expected=(200,), **kwargs):
    for attempt in range(4):
        try:
            response = requests.request(method, url, timeout=120, **kwargs)
        except requests.RequestException:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
            continue
        if response.status_code in (429, 500, 502, 503, 504) and attempt < 3:
            time.sleep(2 ** attempt * 3)
            continue
        if response.status_code not in expected:
            fail(f'{method} {url.split("?")[0]}: HTTP {response.status_code}: {response.text[:1200]}')
        return response
    fail('Request retry limit exceeded')


def build(source):
    manifest_path = source / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    version = manifest.get('version', '')
    if manifest.get('manifest_version') != 3:
        fail('Expected Manifest V3')
    if not re.fullmatch(r'\d+(\.\d+){0,3}', version):
        fail(f'Invalid manifest version: {version!r}')
    expected = os.getenv('EXPECTED_VERSION', '').strip()
    if expected and expected != version:
        fail(f'Expected version {expected}, got {version}')
    files = []
    for path in source.rglob('*'):
        if not path.is_file():
            continue
        relative = path.relative_to(source)
        if any(part in EXCLUDE_DIRS or part.startswith('.') for part in relative.parts[:-1]):
            continue
        if path.name in EXCLUDE_FILES or path.name.startswith('.') or path.suffix in {'.pyc', '.pem', '.key', '.crx'}:
            continue
        files.append((relative.as_posix(), path))
    if not files or not any(name == 'manifest.json' for name, _ in files):
        fail('No valid extension files')
    out = ROOT / 'dist' / f'astral-{version}.zip'
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, path in sorted(files):
            z.write(path, name)
    with zipfile.ZipFile(out) as z:
        if len(z.namelist()) != len(set(z.namelist())):
            fail('Duplicate ZIP entries')
        packed = json.loads(z.read('manifest.json'))
        if packed['version'] != version:
            fail('Packaged version mismatch')
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f'Package: {out.relative_to(ROOT)}; files={len(files)}; SHA256={digest}')
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as f:
            f.write(f'version={version}\nzip_path={out}\nsha256={digest}\n')
    return out, version


def chrome_token():
    keys = ['CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN']
    for key in keys:
        if not os.getenv(key):
            fail(f'Missing {key}')
    response = request('POST', 'https://oauth2.googleapis.com/token', data={
        'client_id': os.environ['CHROME_CLIENT_ID'],
        'client_secret': os.environ['CHROME_CLIENT_SECRET'],
        'refresh_token': os.environ['CHROME_REFRESH_TOKEN'],
        'grant_type': 'refresh_token',
    })
    return response.json()['access_token']


def chrome_status(name, headers):
    return request('GET', f'{CHROME}/v2/{name}:fetchStatus', headers=headers).json()


def chrome_publish(package, version, upload_only):
    name = f"publishers/{os.environ['CHROME_PUBLISHER_ID']}/items/{os.environ['CHROME_EXTENSION_ID']}"
    headers = {'Authorization': f'Bearer {chrome_token()}'}
    before = chrome_status(name, headers)
    published = before.get('publishedItemRevisionStatus', {}).get('distributionChannels', [])
    submitted = before.get('submittedItemRevisionStatus', {}).get('distributionChannels', [])
    if any(x.get('crxVersion') == version for x in published + submitted):
        print('Chrome: version already published/submitted; skipping')
        return
    with package.open('rb') as stream:
        response = request('POST', f'{CHROME}/upload/v2/{name}:upload?uploadType=media',
                           headers={**headers, 'Content-Type': 'application/zip'},
                           data=stream.read())
    result = response.json()
    state = result.get('uploadState')
    print(f'Chrome upload: {state}')
    for _ in range(40):
        if state != 'UPLOAD_IN_PROGRESS':
            break
        time.sleep(10)
        state = chrome_status(name, headers).get('lastAsyncUploadState')
    if state != 'SUCCESS':
        fail(f'Chrome upload did not succeed: {state}; response={result}')
    if result.get('crxVersion') and result['crxVersion'] != version:
        fail('Chrome returned unexpected uploaded version')
    if upload_only:
        print('Chrome: upload complete (not submitted)')
        return
    submitted_result = request('POST', f'{CHROME}/v2/{name}:publish', headers=headers,
                               json={'publishType': 'DEFAULT_PUBLISH', 'skipReview': False, 'blockOnWarnings': True}).json()
    print(f"Chrome submitted: {submitted_result.get('state')}")


def edge_headers():
    return {'Authorization': f"ApiKey {os.environ['EDGE_API_KEY']}",
            'X-ClientID': os.environ['EDGE_CLIENT_ID']}


def edge_poll(url, headers, label):
    for _ in range(60):
        response = request('GET', url, expected=(200, 202), headers=headers)
        data = response.json()
        state = str(data.get('status', '')).lower()
        print(f'Edge {label}: {state or "pending"}')
        if state in {'succeeded', 'success', 'completed'}:
            return
        if state in {'failed', 'error', 'cancelled', 'canceled'}:
            fail(f'Edge {label} failed: {data}')
        time.sleep(10)
    fail(f'Edge {label} polling timed out; inspect Partner Center')


def edge_publish(package, upload_only):
    product = os.environ['EDGE_PRODUCT_ID']
    base = f'{EDGE}/v1/products/{product}/submissions'
    headers = edge_headers()
    with package.open('rb') as stream:
        response = request('POST', f'{base}/draft/package', expected=(202,),
                           headers={**headers, 'Content-Type': 'application/zip'}, data=stream)
    location = response.headers.get('Location')
    if not location:
        fail('Edge upload response lacks Location')
    from urllib.parse import urljoin, urlparse
    url = urljoin(EDGE, location)
    if urlparse(url).netloc != urlparse(EDGE).netloc:
        fail('Unexpected Edge operation URL host')
    edge_poll(url, headers, 'upload')
    if upload_only:
        print('Edge: upload complete (not submitted)')
        return
    response = request('POST', base, expected=(202,), headers={**headers, 'Content-Type': 'application/json'},
                       json={'notes': f'Automated release from GitHub Actions'})
    location = response.headers.get('Location')
    if not location:
        fail('Edge publish response lacks Location')
    url = urljoin(EDGE, location)
    if urlparse(url).netloc != urlparse(EDGE).netloc:
        fail('Unexpected Edge publish operation URL host')
    edge_poll(url, headers, 'submission')
    print('Edge: submission accepted (store review may still be pending)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['build', 'chrome', 'edge'])
    parser.add_argument('--source', default='.')
    parser.add_argument('--upload-only', action='store_true')
    parser.add_argument('--package', help='Use ZIP produced by package job')
    args = parser.parse_args()
    source = (ROOT / args.source).resolve()
    if not source.is_dir() or not source.is_relative_to(ROOT):
        fail('Source must be a directory inside the repository')
    if args.package and args.command != 'build':
        package = Path(args.package).resolve()
        if not package.is_file():
            fail('Package artifact missing')
        with zipfile.ZipFile(package) as z:
            version = json.loads(z.read('manifest.json'))['version']
        if os.getenv('EXPECTED_VERSION') and version != os.environ['EXPECTED_VERSION']:
            fail('Artifact version mismatch')
        print(f'Using shared package: {package}; SHA256={hashlib.sha256(package.read_bytes()).hexdigest()}')
    else:
        package, version = build(source)
    if args.command == 'chrome':
        chrome_publish(package, version, args.upload_only)
    elif args.command == 'edge':
        edge_publish(package, args.upload_only)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError, requests.RequestException, ValueError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
