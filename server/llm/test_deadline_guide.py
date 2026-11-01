"""Execute only the config migration heredoc, inside temporary fixture directories.

No daemon, model, network, tokenizer or Mac runtime is started.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


class DeadlineGuideTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        (self.home / 'kuda-llm').mkdir(parents=True)
        (self.root / 'server').mkdir()
        self.target = self.root / 'server/config.json'
        self.backup = self.home / 'kuda-llm/config-before-30s.json'
        self.config = {'port': 8080, 'npc': {'adapter': 'ollama', 'timeoutMs': 8000,
                       'options': {'model': 'qwen3.5:0.8b-q8_0', 'modelDigest': 'a' * 64,
                                   'tokenizerDir': '/prepared/08b', 'numGpu': 0}}}
        self.raw = json.dumps(self.config, indent=4).encode() + b'\n'
        self.target.write_bytes(self.raw)
        guide = Path(__file__).with_name('MAC-30S.md').read_text()
        bodies = re.findall(r"<<'PY'\n(.*?)\nPY(?:\n|$)", guide, re.S)
        self.assertEqual(len(bodies), 1)
        self.body = bodies[0]

    def run_migration(self):
        return subprocess.run([sys.executable, '-B', '-c', self.body], cwd=self.root,
                              env={**os.environ, 'HOME': str(self.home)},
                              capture_output=True, text=True, timeout=5)

    def test_changes_only_timeout_and_preserves_original_bytes_in_private_backup(self):
        result = self.run_migration()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = json.loads(self.raw)
        expected['npc']['timeoutMs'] = 30000
        self.assertEqual(json.loads(self.target.read_bytes()), expected)
        self.assertEqual(self.backup.read_bytes(), self.raw)
        if os.name == 'posix':
            self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.target.parent.glob('.config-30s-*')), [])
        self.assertIn('NPC timeout: 30000 ms; model/pins unchanged;', result.stdout)

    def test_existing_backup_refuses_without_changing_config_or_backup(self):
        self.backup.write_bytes(b'approved original config')
        result = self.run_migration()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.target.read_bytes(), self.raw)
        self.assertEqual(self.backup.read_bytes(), b'approved original config')

    def test_already_migrated_config_does_not_overwrite_original_backup(self):
        self.assertEqual(self.run_migration().returncode, 0)
        current = self.target.read_bytes()
        result = self.run_migration()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.target.read_bytes(), current)
        self.assertEqual(self.backup.read_bytes(), self.raw)
        self.assertIn('stop and review', result.stderr)

    @unittest.skipUnless(os.name == 'posix', 'symlink fixture')
    def test_symlinked_config_is_rejected_before_backup(self):
        external = self.root / 'external-config.json'
        self.target.replace(external)
        self.target.symlink_to(external)
        result = self.run_migration()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(external.read_bytes(), self.raw)
        self.assertFalse(self.backup.exists())


if __name__ == '__main__':
    unittest.main()
