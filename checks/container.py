"""Build the production image and prove cached startup without network access."""
import subprocess
import sys
import time
import uuid

result = subprocess.run(['docker', 'build', '-t', 'composer:check', '.'], check=False)
if result.returncode:
    sys.exit(result.returncode)

volume = 'composer-check-' + uuid.uuid4().hex
container = None
mount = f'type=volume,src={volume},dst=/var/cache/composer'
seed = '''
import os
from pathlib import Path
import bars, server
assert os.getuid() == 65534
sources=[bars.Source(name,sec,repo,'a'*40,'snapshot-fixture.parquet','b'*64,1) for name,sec,repo in bars.TIMEFRAMES]
frames=[bars.Frame(name,sec,[1577836800],[100],[110],[90],[105],[1.0],[100.0],[10],[0.5]) for name,sec,_ in bars.TIMEFRAMES]
state=server.Bars(lambda:sources,lambda _:(bars.encode(frames),bars.encode_activity(frames)),Path(os.environ['COMPOSER_CACHE_DIR']))
state.refresh()
assert (Path(os.environ['COMPOSER_CACHE_DIR'])/'history.snapshot').exists()
'''
probe = '''
import json, urllib.request
health=json.load(urllib.request.urlopen('http://127.0.0.1:8488/healthz',timeout=2))
assert health['ready'] and len(health['files'])==5
for path,magic in [('bars',b'CBAR1'),('activity',b'CACT1')]:
    assert urllib.request.urlopen('http://127.0.0.1:8488/'+path,timeout=2).read().startswith(magic)
'''
try:
    subprocess.run(['docker', 'volume', 'create', volume], check=True, capture_output=True)
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--mount', mount,
                    'composer:check', 'python', '-c', seed], check=True)
    start = time.monotonic()
    container = subprocess.check_output(['docker', 'run', '-d', '--network', 'none', '--read-only',
                                         '--mount', mount, 'composer:check'], text=True).strip()
    while True:
        result = subprocess.run(['docker', 'exec', container, 'python', '-c', probe], capture_output=True, text=True)
        if result.returncode == 0:
            break
        if time.monotonic() - start > 10:
            subprocess.run(['docker', 'logs', container], check=False)
            raise RuntimeError('Cached server did not become ready without network: ' + result.stderr)
        time.sleep(.1)
    print(f'Non-root container restored its persistent snapshot without network in {time.monotonic()-start:.3f}s.', flush=True)
except subprocess.CalledProcessError as exc:
    sys.exit(exc.returncode)
finally:
    if container:
        subprocess.run(['docker', 'rm', '-f', container], check=False, capture_output=True)
    subprocess.run(['docker', 'volume', 'rm', volume], check=False, capture_output=True)
