"""Explicit preparation steps for the project's pinned MLX candidate, never runtime."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

REPO = 'Qwen/Qwen3.5-2B'
REVISION = '15852e8c16360a2fea060d615a32b45270f8a8fc'
IDENTITY = {'repo': REPO, 'revision': REVISION}
SOURCE = 'qwen35-2b-source'
OUTPUT = 'qwen35-2b-text-4bit'
MARKER = '.kuda-source.json'


def source_directory(root, create=False):
    source = root / SOURCE
    if source.is_symlink():
        raise ValueError('Source must be a regular directory')
    if source.exists():
        marker = source / MARKER
        if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 4096:
            raise ValueError('Existing source has no valid revision marker; use another --root')
        if json.loads(marker.read_text()) != IDENTITY:
            raise ValueError('Existing source belongs to a different revision')
    elif create:
        source.mkdir(parents=True)
        with (source / MARKER).open('x') as out:
            json.dump(IDENTITY, out)
    else:
        raise ValueError('Download the pinned source first')
    return source


def download(root, offline=False):
    from huggingface_hub import snapshot_download
    source = source_directory(root, create=True)
    snapshot_download(repo_id=REPO, revision=REVISION, local_dir=str(source),
                      local_files_only=offline,
                      allow_patterns=['*.json', '*.safetensors', '*.jinja', '*.txt',
                                      '*.model', 'README.md', 'LICENSE*'])
    print('Pinned source prepared:', source)


def check(root):
    model = root / OUTPUT
    if model.is_symlink() or not model.is_dir():
        raise ValueError('Converted model directory is missing or is a symlink')
    if any(p.is_symlink() or p.suffix == '.py' for p in model.rglob('*')):
        raise ValueError('Model must contain ordinary data files, without symlinks or Python sources')
    repo_root = Path(__file__).resolve().parents[4]
    sys.path.insert(0, str(repo_root / 'server/llm'))
    from mlx_worker import Runtime
    Runtime._check_artifact(model)
    print('Artifact structure OK; actual model loading, RAM and quality remain unverified')


def convert(root):
    if platform.system() != 'Darwin' or platform.machine().lower() != 'arm64':
        raise ValueError('MLX conversion requires macOS Apple Silicon')
    if importlib.metadata.version('mlx-lm') != '0.32.2':
        raise ValueError('Use the locked mlx-lm 0.32.2 environment')
    source = source_directory(root)
    output = root / OUTPUT
    if os.path.lexists(output):
        raise ValueError('Output already exists; preserve it and use another --root')
    subprocess.run([sys.executable, '-m', 'mlx_lm.convert', '--hf-path', str(source),
                    '--mlx-path', str(output), '-q', '--q-bits', '4', '--q-group-size', '64'],
                   check=True, env={**os.environ, 'HF_HUB_OFFLINE': '1',
                                    'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'})
    for license_file in source.glob('LICENSE*'):
        if license_file.is_file() and not license_file.is_symlink():
            shutil.copyfile(license_file, output / license_file.name)
    readme = source / 'README.md'
    if readme.is_file() and not readme.is_symlink():
        shutil.copyfile(readme, output / 'SOURCE_README.md')
    with (output / 'provenance.json').open('x') as out:
        json.dump({**IDENTITY, 'converter': 'mlx-lm==0.32.2', 'bits': 4, 'group_size': 64}, out, indent=2)
        out.write('\n')
    check(root)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['download', 'convert', 'check'])
    parser.add_argument('--root', type=Path, default=Path.home() / 'kuda-llm')
    parser.add_argument('--offline', action='store_true', help='Download step: use existing HF cache only')
    args = parser.parse_args()
    if not args.root.is_absolute():
        parser.error('--root must be absolute')
    if args.offline and args.action != 'download':
        parser.error('--offline is only for download; conversion already runs offline')
    if args.action == 'download':
        download(args.root, args.offline)
    elif args.action == 'convert':
        convert(args.root)
    else:
        check(args.root)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        sys.exit(f'MLX preparation failed: {error}')
