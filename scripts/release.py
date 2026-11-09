#!/usr/bin/env python3
"""Astral extension release helper. Requires requests."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import zipfile
from urllib.parse import urlparse
import requests

CHROME = 'https://chromewebstore.googleapis.com'
EDGE = 'https://api.addons.microsoftedge.microsoft.com'
SESSION = requests.Session()
EXCLUDED_DIRS = {'.git', '.github', 'node_modules', '__pycache__', '.venv', 'venv', 'tests', 'scripts'}
EXCLUDED_FILES = {'.DS_Store', 'Thumbs.db', '.env'}

def required(key):
    value = os.getenv(key, '').strip()
    if not value:
        raise RuntimeError(f'Missing configuration: {key}')
    return value

def version_from_zip(path):
    with zipfile.ZipFile(path) as z:
        if 'manifest.json' not in z.namelist():
            raise RuntimeError('ZIP must contain manifest.json at its root')
        manifest = json.loads(z.read('manifest.json'))
        version = str(manifest['version'])
        if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version):
            raise RuntimeError(f'Invalid manifest version: {version}')
        return version

def verify_version(version):
    expected = os.getenv('EXPECTED_VERSION', '').strip()
    if expected and version != expected:
        raise RuntimeError(f'Version mismatch: expected {expected}, got {version}')

def package_info(path):
    path = Path(path)
    if not path.is_file():
        raise RuntimeError(f'Package not found: {path}')
    version = version_from_zip(path)
    verify_version(version)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    print(f'Using shared package: {path.resolve()}; version={version}; SHA256={sha}', flush=True)
    return version

def build(source, output):
    source = Path(source)
    manifest = source / 'manifest.json'
    if not manifest.is_file():
        raise RuntimeError(f'Missing {manifest}')
    version = str(json.loads(manifest.read_text(encoding='utf-8'))['version'])
    verify_version(version)
    output = Path(output or f'dist/astral-{version}.zip')
    output.parent.mkdir(parents=True, exist_ok=True)
    files = []
    for path in source.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(source)
        if any(part in EXCLUDED_DIRS or part.startswith('.') for part in rel.parts[:-1]):
            continue
        if rel.name in EXCLUDED_FILES or rel.name.startswith('.env'):
            continue
        files.append((rel.as_posix(), path))
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, path in sorted(files):
            z.write(path, rel)
    package_info(output)
    print(f'Built: {output}')

def request(method, url, *, expected=(200,), **kwargs):
    try:
        resp = SESSION.request(method, url, timeout=(20, 180), allow_redirects=False, **kwargs)
    except requests.RequestException as exc:
        raise RuntimeError(f'{method} {url} network error: {exc}') from exc
    if resp.status_code not in expected:
        raise RuntimeError(f'{method} {url} HTTP {resp.status_code}: {resp.text[:1500]}')
    return resp

def as_json(resp):
    try:
        return resp.json()
    except ValueError:
        raise RuntimeError(f'Expected JSON from {resp.url}: {resp.text[:500]}')

def chrome_token():
    resp = request('POST', 'https://oauth2.googleapis.com/token', data={
        'client_id': required('CHROME_CLIENT_ID'),
        'client_secret': required('CHROME_CLIENT_SECRET'),
        'refresh_token': required('CHROME_REFRESH_TOKEN'),
        'grant_type': 'refresh_token',
    })
    return as_json(resp)['access_token']

def chrome(package, upload_only):
    version = package_info(package)
    item = f"publishers/{required('CHROME_PUBLISHER_ID')}/items/{required('CHROME_EXTENSION_ID')}"
    headers = {'Authorization': f'Bearer {chrome_token()}'}
    with open(package, 'rb') as stream:
        resp = request('POST', f'{CHROME}/upload/v2/{item}:upload',
                       expected=(200,), headers={**headers, 'Content-Type': 'application/zip'}, data=stream)
    data = as_json(resp)
    state = str(data.get('uploadState', '')).upper()
    if state in ('IN_PROGRESS', 'UPLOAD_IN_PROGRESS'):
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            time.sleep(10)
            status = as_json(request('GET', f'{CHROME}/v2/{item}:fetchStatus', headers=headers))
            # fetchStatus describes the most recent asynchronous upload separately.
            state = str(status.get('lastAsyncUploadState', '')).upper()
            if state in ('SUCCEEDED', 'SUCCESS'):
                break
            if state in ('FAILED', 'NOT_FOUND'):
                raise RuntimeError(f'Chrome asynchronous upload failed: {status}')
        else:
            raise RuntimeError('Chrome upload status timed out')
    elif state not in ('SUCCEEDED', 'SUCCESS'):
        raise RuntimeError(f'Chrome upload did not succeed: {state}; response={data}')
    uploaded_version = data.get('crxVersion')
    if uploaded_version and uploaded_version != version:
        raise RuntimeError(f'Chrome uploaded version {uploaded_version} != {version}')
    print(f'Chrome upload SUCCEEDED: {version}')
    if upload_only:
        print('Chrome upload-only: review submission skipped')
        return
    result = as_json(request('POST', f'{CHROME}/v2/{item}:publish',
                             headers={**headers, 'Content-Type': 'application/json'},
                             json={'publishType': 'DEFAULT_PUBLISH', 'skipReview': False}))
    print(f'Chrome publish request accepted: {json.dumps(result, ensure_ascii=False)}')

def edge_operation_id(location):
    # Edge may return a bare operation ID, relative URL or full URL.
    if not location:
        raise RuntimeError('Edge response missing Location operation ID')
    path = urlparse(location).path.rstrip('/')
    op_id = path.rsplit('/', 1)[-1]
    if not re.fullmatch(r'[A-Za-z0-9_-]+', op_id):
        raise RuntimeError(f'Invalid Edge operation ID in Location: {location!r}')
    return op_id

def edge_poll(url, headers, label):
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        result = as_json(request('GET', url, headers=headers))
        state = str(result.get('status', '')).lower()
        print(f'Edge {label} status: {state or "unknown"}; message={result.get("message", "")}')
        if state == 'succeeded':
            return
        if state in ('failed', 'cancelled', 'canceled'):
            raise RuntimeError(f'Edge {label} failed: {json.dumps(result, ensure_ascii=False)}')
        if state not in ('inprogress', 'pending', 'notstarted'):
            raise RuntimeError(f'Unexpected Edge {label} status: {json.dumps(result, ensure_ascii=False)}')
        time.sleep(10)
    raise RuntimeError(f'Edge {label} timed out')

def edge(package, upload_only):
    package_info(package)
    product = required('EDGE_PRODUCT_ID')
    base = f'{EDGE}/v1/products/{product}/submissions'
    headers = {'Authorization': f"ApiKey {required('EDGE_API_KEY')}",
               'X-ClientID': required('EDGE_CLIENT_ID')}
    with open(package, 'rb') as stream:
        resp = request('POST', f'{base}/draft/package', expected=(202,),
                       headers={**headers, 'Content-Type': 'application/zip'}, data=stream)
    op_id = edge_operation_id(resp.headers.get('Location'))
    print(f'Edge upload accepted: operation={op_id}')
    edge_poll(f'{base}/draft/package/operations/{op_id}', headers, 'upload')
    if upload_only:
        print('Edge upload-only: review submission skipped')
        return
    resp = request('POST', base, expected=(202,),
                   headers={**headers, 'Content-Type': 'application/json'},
                   json={'notes': 'Automated Astral extension update'})
    op_id = edge_operation_id(resp.headers.get('Location'))
    print(f'Edge submission accepted: operation={op_id}')
    edge_poll(f'{base}/operations/{op_id}', headers, 'submission')
    print('Edge review submission succeeded')

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('--source', default='src')
    b.add_argument('--output')
    for name in ('chrome', 'edge'):
        p = sub.add_parser(name)
        p.add_argument('--package', required=True)
        p.add_argument('--upload-only', action='store_true')
    args = parser.parse_args()
    if args.command == 'build':
        build(args.source, args.output)
    elif args.command == 'chrome':
        chrome(args.package, args.upload_only)
    else:
        edge(args.package, args.upload_only)

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyError, zipfile.BadZipFile, requests.RequestException) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
