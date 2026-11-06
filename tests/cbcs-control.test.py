"""Isolated shell behavior tests; no root, TV, real mount or LG binary needed.
Run on Linux/WSL: python3 tests/cbcs-control.test.py
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
ORIGINAL = 'd35a1b16ab053305773a072540d1ab9dfd9d23d61d41dc48b552c2fe4bc0112c'
PATCHED = '979d468696825745f24b844991eec575ce724542af9f902e50599b1baf2db5df'
UPSTREAM = '273275d01998176376265400b22a98b9de832901ac2e520a104b70757111ab30'

class Repair(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='rw-cbcs-test-')
        self.root = Path(self.temp.name)
        self.target = self.root / 'target.so'
        self.package = self.root / 'package'
        self.state = self.root / 'state'
        self.hooks = self.root / 'hooks'
        self.mounts = self.root / 'mounts'
        self.bin = self.root / 'bin'
        for directory in (self.package, self.hooks, self.bin): directory.mkdir(mode=0o700)
        self.mounts.write_text('')
        # Synthetic same-size fixture tests the real 28-byte patch operation.
        self.original = b'X' * 8260
        replacement = bytes.fromhex('079a5c4655f8083c1a44d9f81000012803d1d9f8140000b100220792')
        self.patched = self.original[:4976] + replacement + self.original[5004:]
        self.target.write_bytes(self.original)
        self.control = self.package / 'control.sh'
        upstream = (REPO / 'root-cbcs/cbcs-hd-fix.sh').read_text()
        control = (REPO / 'root-cbcs/control.sh').read_text()
        replacements = {
            '/media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-cbcs': str(self.package),
            '/usr/lib/svp/libwidevine-modular_decryptor.so': str(self.target),
            '/var/lib/webos-cbcs-hd-fix': str(self.state),
            '/var/lib/webosbrew/init.d': str(self.hooks),
            '/var/lib/c9-cbcs-fix/libwidevine-modular_decryptor.cbcs.so': str(self.root / 'legacy.so'),
            '/proc/mounts': str(self.mounts),
            ORIGINAL: hashlib.sha256(self.original).hexdigest(),
            PATCHED: hashlib.sha256(self.patched).hexdigest(),
        }
        for old, new in replacements.items():
            upstream = upstream.replace(old,new)
            control = control.replace(old,new)
        control = control.replace(UPSTREAM, hashlib.sha256(upstream.encode()).hexdigest())
        control = control.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin', 'PATH=' + str(self.bin) + ':/usr/sbin:/usr/bin:/sbin:/bin')
        self.control.write_text(control)
        (self.package / 'cbcs-hd-fix.sh').write_text(upstream)
        self.write_command('id', '#!/bin/sh\nif [ "$1" = -u ]; then echo "${RW_TEST_UID:-0}"; else exec /usr/bin/id "$@"; fi\n')
        self.write_command('stat', '#!/bin/sh\nif [ "$1" = -c ] && [ "$2" = %u ]; then echo 0; else exec /usr/bin/stat "$@"; fi\n')
        # The mount simulator is confined to this newly created temporary tree.
        script = '''#!/usr/bin/python3
from pathlib import Path
import os,sys,shutil
root=Path(os.environ['RW_TEST_ROOT']).resolve()
target=root/'target.so'; mounts=root/'mounts'; log=root/'operations'
with log.open('a') as stream: stream.write(Path(sys.argv[0]).name+' '+repr(sys.argv[1:])+'\\n')
if Path(sys.argv[0]).name=='mount':
    if sys.argv[1]=='--bind':
        source=Path(sys.argv[2]).resolve()
        assert source.is_relative_to(root) and Path(sys.argv[3]).resolve()==target
        assert not mounts.read_text()
        shutil.copyfile(target,root/'underlying.so');target.unlink();os.link(source,target)
        mounts.write_text(str(source)+' '+str(target)+' none rw,bind 0 0\\n')
    else:
        assert sys.argv[1:]==['-o','remount,bind,ro',str(target)]
        mounts.write_text(mounts.read_text().replace(' rw,bind ',' ro,bind '))
else:
    assert sys.argv[1:]==['-l',str(target)]
    target.unlink();shutil.copyfile(root/'underlying.so',target);mounts.write_text('')
'''
        self.write_command('mount', script)
        self.write_command('umount', script)
        self.env = dict(os.environ, RW_TEST_ROOT=str(self.root))

    def tearDown(self): self.temp.cleanup()
    def write_command(self,name,text):
        p=self.bin/name;p.write_text(text);p.chmod(0o700)
    def run_action(self,action='status',uid='0'):
        env=dict(self.env,RW_TEST_UID=uid)
        result=subprocess.run(['sh',str(self.control),action],env=env,text=True,capture_output=True)
        self.assertEqual(result.stderr,'',result.stderr)
        return result.returncode,json.loads(result.stdout)
    def test_known_original_status_is_read_only(self):
        _,status=self.run_action()
        self.assertTrue(status['needed']);self.assertTrue(status['canApply']);self.assertFalse(status['active'])
        self.assertFalse(self.state.exists());self.assertFalse((self.root/'operations').exists())
    def test_apply_real_patch_then_idempotent_apply_and_owned_disable(self):
        code,status=self.run_action('apply')
        self.assertEqual(code,0);self.assertTrue(status['active']);self.assertTrue(status['restartRequired'])
        self.assertEqual(self.target.read_bytes(),self.patched)
        self.assertEqual((self.state/'libwidevine-modular_decryptor.original.so').read_bytes(),self.original)
        self.assertTrue((self.hooks/'02-webos-cbcs-hd-fix').is_file())
        operations=(self.root/'operations').read_text()
        _,again=self.run_action('apply');self.assertFalse(again['restartRequired'])
        self.assertEqual((self.root/'operations').read_text(),operations)
        code,disabled=self.run_action('disable')
        self.assertEqual(code,0);self.assertFalse(disabled['active']);self.assertTrue(disabled['restartRequired'])
        self.assertEqual(self.target.read_bytes(),self.original)
        self.assertTrue((self.state/'DISABLED').exists())
    def test_failed_mount_does_not_enable_the_next_boot(self):
        self.write_command('mount', '#!/bin/sh\nexit 1\n')
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertFalse(status['active'])
        self.assertEqual(self.target.read_bytes(),self.original)
        self.assertTrue((self.state/'DISABLED').exists())
    def test_unknown_library_is_untouched(self):
        self.target.write_bytes(b'unknown')
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertFalse(status['supported']);self.assertFalse(status['canApply'])
        self.assertEqual(self.target.read_bytes(),b'unknown');self.assertFalse(self.state.exists())
    def test_no_root_prevents_apply(self):
        code,status=self.run_action('apply',uid='1000')
        self.assertNotEqual(code,0);self.assertEqual(status['reason'],'root-required');self.assertFalse(self.state.exists())
    def test_foreign_original_overlay_is_not_stacked(self):
        self.mounts.write_text('foreign '+str(self.target)+' none ro,bind 0 0\n')
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertEqual(status['reason'],'foreign-overlay');self.assertTrue(status['needed'])
        self.assertFalse((self.root/'operations').exists())
    def test_legacy_fix_is_recognized_and_preserved(self):
        legacy=self.root/'legacy.so';legacy.write_bytes(self.patched)
        self.target.unlink();os.link(legacy,self.target)
        self.mounts.write_text(str(legacy)+' '+str(self.target)+' none rw,bind 0 0\n')
        _,status=self.run_action('apply')
        self.assertTrue(status['active']);self.assertFalse(status['needed']);self.assertEqual(status['owner'],'legacy-c9')
        self.assertFalse(status['canDisable']);self.assertFalse(self.state.exists())
        code,status=self.run_action('disable');self.assertNotEqual(code,0)
        self.assertEqual(self.target.read_bytes(),self.patched);self.assertFalse((self.root/'operations').exists())
    def test_equal_bytes_are_not_mount_ownership(self):
        self.state.mkdir(mode=0o700)
        (self.state/'libwidevine-modular_decryptor.patched.so').write_bytes(self.patched)
        self.target.write_bytes(self.patched)
        self.mounts.write_text('foreign '+str(self.target)+' none ro,bind 0 0\n')
        code,status=self.run_action('disable')
        self.assertNotEqual(code,0);self.assertEqual(status['owner'],'external');self.assertFalse((self.root/'operations').exists())
    def test_symlink_or_writable_state_is_refused(self):
        self.state.mkdir(mode=0o777);self.state.chmod(0o777)
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertEqual(status['reason'],'unsafe-install-state')
        self.state.rmdir();self.state.symlink_to(self.hooks,target_is_directory=True)
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertEqual(status['reason'],'unsafe-install-state')
    def test_tampered_upstream_is_refused(self):
        with (self.package/'cbcs-hd-fix.sh').open('a') as file:file.write('\n# changed\n')
        code,status=self.run_action('apply')
        self.assertNotEqual(code,0);self.assertEqual(status['reason'],'invalid-repair-package');self.assertFalse(self.state.exists())
    def test_shipped_upstream_digest_is_pinned(self):
        self.assertEqual(hashlib.sha256((REPO/'root-cbcs/cbcs-hd-fix.sh').read_bytes()).hexdigest(),UPSTREAM)

if __name__=='__main__': unittest.main()
