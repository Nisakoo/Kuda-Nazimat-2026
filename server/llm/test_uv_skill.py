"""Install skill preparation invariants, without downloading weights or importing MLX."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / '.agents/skills/install-local-ai/scripts/mlx_model.py'
spec = importlib.util.spec_from_file_location('mlx_model_setup', SCRIPT)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class MlxSkillTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def artifact(self, vision=False):
        model = self.root / setup.OUTPUT
        model.mkdir()
        (model / 'config.json').write_text(json.dumps({
            'model_type': 'qwen3_5', 'quantization': {'bits': 4, 'group_size': 64}}))
        header = json.dumps({'model.visual.weight' if vision else 'text.weight': {}}).encode()
        (model / 'model.safetensors').write_bytes(struct.pack('<Q', len(header)) + header)
        return model

    def test_download_pins_source_resumes_same_revision_and_preserves_offline_mode(self):
        download = Mock()
        with patch.dict('sys.modules', {'huggingface_hub': types.SimpleNamespace(snapshot_download=download)}), contextlib.redirect_stdout(io.StringIO()):
            setup.download(self.root)
            setup.download(self.root, offline=True)
        self.assertEqual(download.call_count, 2)
        args = download.call_args.kwargs
        self.assertEqual(args['revision'], setup.REVISION)
        self.assertEqual(args['repo_id'], 'Qwen/Qwen3.5-2B')
        self.assertTrue(args['local_files_only'])
        self.assertNotIn('*.py', args['allow_patterns'])

    def test_foreign_or_different_revision_source_is_not_overwritten(self):
        source = self.root / setup.SOURCE
        source.mkdir()
        (source / 'valuable').write_text('keep')
        with self.assertRaisesRegex(ValueError, 'revision marker'):
            setup.source_directory(self.root, create=True)
        (source / setup.MARKER).write_text(json.dumps({'repo': setup.REPO, 'revision': 'different'}))
        with self.assertRaisesRegex(ValueError, 'different revision'):
            setup.source_directory(self.root, create=True)
        self.assertEqual((source / 'valuable').read_text(), 'keep')

    def test_conversion_is_local_pinned_and_retains_provenance(self):
        source = setup.source_directory(self.root, create=True)
        (source / 'LICENSE').write_text('license fixture')
        (source / 'README.md').write_text('source card')
        def convert(*args, **kwargs):
            self.assertEqual(kwargs['env']['HF_HUB_OFFLINE'], '1')
            self.assertEqual(kwargs['env']['TRANSFORMERS_OFFLINE'], '1')
            self.assertNotIn('--trust-remote-code', args[0])
            self.assertEqual(args[0][-5:], ['-q', '--q-bits', '4', '--q-group-size', '64'])
            self.artifact()
        with patch.object(setup.platform, 'system', return_value='Darwin'), patch.object(setup.platform, 'machine', return_value='arm64'), patch.object(setup.importlib.metadata, 'version', return_value='0.32.2'), patch.object(setup.subprocess, 'run', side_effect=convert) as run, contextlib.redirect_stdout(io.StringIO()):
            setup.convert(self.root)
            with self.assertRaisesRegex(ValueError, 'already exists'):
                setup.convert(self.root)
            self.assertEqual(run.call_count, 1)
        model = self.root / setup.OUTPUT
        self.assertEqual((model / 'LICENSE').read_text(), 'license fixture')
        self.assertEqual(json.loads((model / 'provenance.json').read_text())['revision'], setup.REVISION)

    def test_rejects_vision_tensors_and_symlink_artifacts(self):
        model = self.artifact(vision=True)
        with self.assertRaisesRegex(Exception, 'Invalid text-only'):
            setup.check(self.root)
        (model / 'linked').symlink_to(model / 'config.json')
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            setup.check(self.root)

    def test_refuses_non_apple_platform_before_conversion(self):
        with patch.object(setup.platform, 'system', return_value='Linux'), patch.object(setup.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'Apple Silicon'):
                setup.convert(self.root)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
