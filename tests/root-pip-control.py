"""Control protocol contract, with shell command boundaries replaced by fixtures.

No /proc, TV paths, upstart jobs or mounts are changed. Each invocation runs the
real control script with constants redirected into a temporary fake filesystem.
"""
import json
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'root-pip'
with tempfile.TemporaryDirectory(prefix='rw-control-') as temporary:
    temp = pathlib.Path(temporary)
    binary = temp / 'bin'
    package = temp / 'package'
    runtime = temp / 'runtime'
    proc = temp / 'proc'
    for folder in [binary, package / 'lib', runtime / 'lib', proc / '100', proc / '200']:
        folder.mkdir(parents=True, exist_ok=True)
    runtime.chmod(0o711)

    def command(name, text):
        script = binary / name
        script.write_text('#!/bin/sh\n' + text + '\n')
        script.chmod(0o755)

    command('id', 'echo "${TEST_UID:-0}"')
    command('uname', 'echo "${TEST_ARCH:-armv7l}"')
    command('stat', 'if [ "$2" = %u ]; then echo 0; else exec /usr/bin/stat "$@"; fi')
    command('pidof', 'case "$1" in WebAppMgr) echo 100;; AcbService) echo 200;; esac')
    command('luna-send', '''case "$*" in
*getSystemInfo*) printf '{"modelName":"%s"}\n' "${TEST_MODEL:-OLED55C9PSA}";;
*getForegroundAppInfo*) if [ -n "${TEST_FOREGROUND_MARK:-}" ]; then touch "$TEST_FOREGROUND_MARK"; sleep 0.3; fi; printf '{"appId":"%s"}\n' "${TEST_FOREGROUND:-com.ravboni.raceweekend}";;
*) printf '{"returnValue":%s}\n' "${TEST_DUAL:-true}";;
esac''')
    command('sha256sum', 'case "$2" in */profile.sha256) exit "${TEST_PROFILE_FAIL:-0}";; *) exec /usr/bin/sha256sum "$@";; esac')
    # If a forbidden lifecycle mutation is reached this fixture fails loudly.
    for name in ['initctl', 'mount', 'umount', 'nohup']:
        command(name, 'echo "unexpected mutation: ' + name + '" >&2; exit 99')

    conf = temp / 'WebAppMgr.conf'
    conf.write_text('    export LD_PRELOAD=/usr/lib/libsystrim.so.3\n')
    (runtime / 'WebAppMgr.conf').hardlink_to(conf)
    (proc / 'mounts').write_text('fixture ' + str(conf) + ' none rw 0 0\n')
    for name, pid in [('wam', '100'), ('acb', '200')]:
        (proc / pid / 'maps').write_text(str(runtime / 'lib' / ('librw-pip-' + name + '.so')))
        data = (SOURCE / 'lib' / ('librw-pip-' + name + '.so')).read_bytes()
        (runtime / 'lib' / ('librw-pip-' + name + '.so')).write_bytes(data)
        (package / 'lib' / ('librw-pip-' + name + '.so')).write_bytes(data)
    for target in [runtime, package]:
        (target / 'hooks.sha256').write_bytes((SOURCE / 'hooks.sha256').read_bytes())
    (package / 'profile.sha256').write_bytes((SOURCE / 'profile.sha256').read_bytes())
    source = (SOURCE / 'control.sh').read_text()
    source = source.replace('PATH=/usr/sbin:/usr/bin:/sbin:/bin', f'PATH={binary}:/usr/bin:/bin')
    source = source.replace('RUNTIME=/tmp/race-weekend-pip', f'RUNTIME={runtime}')
    source = source.replace('PACKAGE=/media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-pip', f'PACKAGE={package}')
    source = source.replace('WAM_CONF=/etc/init/WebAppMgr.conf', f'WAM_CONF={conf}')
    source = source.replace('/proc/', str(proc) + '/')
    script = temp / 'control.sh'
    script.write_text(source)
    for target in [runtime, package]:
        (target / 'control.sh').write_text(source)
    guard = proc / str(os.getpid())
    guard.mkdir()
    (guard / 'cmdline').write_text(str(runtime / 'control.sh') + ' watch')
    (runtime / 'watchdog.pid').write_text(str(os.getpid()))

    def call(action, **options):
        result = subprocess.run(['sh', str(script), action], env=dict(os.environ, **options), capture_output=True, text=True)
        assert not result.stderr, result.stderr
        return json.loads(result.stdout), result.returncode

    status, code = call('status', TEST_UID='1000')
    assert code == 0 and not status['root'] and status['reason'] == 'root-required'
    assert not (runtime / 'lease').exists()
    status, code = call('activate', TEST_ARCH='x86_64')
    assert code == 1 and status['reason'] == 'unsupported-platform'
    status, code = call('activate', TEST_MODEL='OLED55C8PSA')
    assert code == 1 and status['reason'] == 'unsupported-model'
    status, code = call('activate', TEST_PROFILE_FAIL='1')
    assert code == 1 and status['reason'] == 'unsupported-firmware'
    status, code = call('status', TEST_ARCH='aarch64')
    assert code == 0 and status['ready'] and not status['active']
    status, code = call('begin', TEST_FOREGROUND='other.app')
    assert code == 1 and status['reason'] == 'not-foreground' and not (runtime / 'lease').exists()
    status, code = call('begin', TEST_DUAL='false')
    assert code == 1 and status['reason'] == 'dual-mode-failed' and not (runtime / 'lease').exists()
    status, code = call('begin')
    assert code == 0 and status['active'] and int((runtime / 'lease').read_text()) > int(time.time())
    status, code = call('heartbeat')
    assert code == 0 and status['active']
    status, code = call('heartbeat', TEST_FOREGROUND='other.app')
    assert code == 1 and not status['active'] and not (runtime / 'lease').exists()
    call('begin')
    (runtime / 'lease').write_text(str(int(time.time()) - 1))
    status, code = call('heartbeat')
    assert code == 1 and status['reason'] == 'session-ended' and not (runtime / 'lease').exists()
    call('begin')
    status, code = call('end')
    assert code == 0 and status['ready'] and not status['active'] and not (runtime / 'lease').exists()
    # A delayed foreground response must not renew a lease after end finishes.
    call('begin')
    mark = temp / 'foreground-request'
    heartbeat = subprocess.Popen(['sh', str(script), 'heartbeat'], env=dict(os.environ, TEST_FOREGROUND_MARK=str(mark)), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 3
    while not mark.exists() and time.time() < deadline:
        time.sleep(0.01)
    assert mark.exists()
    status, code = call('end')
    output, errors = heartbeat.communicate(timeout=5)
    assert heartbeat.returncode == 0 and not errors and code == 0
    assert not (runtime / 'lease').exists(), 'late heartbeat recreated closed lease'
    # The mapped libraries alone do not establish a functioning safety guard.
    (runtime / 'watchdog.pid').write_text('99999999')
    status, code = call('status')
    assert not status['ready'] and status['installed']
    (runtime / 'watchdog.pid').write_text(str(os.getpid()))
    (package / 'control.sh').write_text(source + '\n# upgraded control protocol\n')
    status, code = call('status')
    assert not status['ready'] and status['reason'] == 'stale-build'
    (package / 'control.sh').write_text(source)
    # App upgrades must never approve old mapped hook versions.
    (package / 'hooks.sha256').write_text('different build\n')
    status, code = call('status')
    assert code == 0 and not status['ready'] and status['installed'] and status['reason'] == 'stale-build'
    status, code = call('status', TEST_MODEL='OLED55C8PSA')
    assert not status['supported'] and not status['ready'] and status['installed']
    status, code = call('invented-command')
    assert code == 2 and status['reason'] == 'unknown-action'
    # Lifecycle lock is held by the worker, so concurrent activation cannot copy
    # new libraries over a running activation. A stale marker alone is harmless.
    (proc / 'mounts').write_text('')
    for pid in ['100', '200']:
        (proc / pid / 'maps').write_text('')
    with (runtime / 'lifecycle.lock').open('w') as held:
        fcntl.flock(held, fcntl.LOCK_EX)
        status, code = call('activate')
        assert code == 0 and status['reason'] == 'activating'
    (runtime / 'activating').write_text('dead worker')
    (package / 'hooks.sha256').write_bytes((SOURCE / 'hooks.sha256').read_bytes())
    # Block at validation after acquiring the lock, before any job mutation.
    (package / 'lib' / 'librw-pip-wam.so').write_bytes(b'invalid')
    status, code = call('activate')
    assert code == 1 and status['reason'] == 'invalid-hook-build'
    assert not (runtime / 'activating').exists()

    # Execute the real recovery function against fake jobs/mounts. Never kill a
    # host process or change a real mount. First start fails after unmount; retry
    # must still restart WAM using the preserved intent marker.
    (runtime / 'watchdog.pid').unlink()
    command('pidof', 'exit 1')
    command('sleep', 'exit 0')
    events = temp / 'events'
    running = temp / 'wam-running'
    fail = temp / 'fail-start'
    fail.touch()
    command('initctl', f'''echo "$*" >> "{events}"
case "$*" in
'status WebAppMgr') [ -e "{running}" ] && echo 'WebAppMgr start/running' || echo 'WebAppMgr stop/waiting';;
'status AcbService') echo 'AcbService start/running';;
'stop WebAppMgr') rm -f "{running}";;
'start WebAppMgr') if [ -e "{fail}" ]; then rm -f "{fail}"; exit 1; fi; touch "{running}";;
esac''')
    command('umount', f'if [ "${{TEST_UNMOUNT_FAIL:-0}}" = 1 ]; then exit 1; fi; : > "{proc / "mounts"}"')
    (proc / 'mounts').write_text('fixture ' + str(conf) + ' none rw 0 0\n')
    recovery = temp / 'recover.sh'
    recovery.write_text(source.split('case "${1:-status}" in')[0] + '\nrestore_jobs\n')
    first = subprocess.run(['sh', str(recovery)], capture_output=True, text=True)
    assert first.returncode == 1 and not first.stderr
    assert (runtime / 'restore-wam').exists() and not running.exists()
    retry = subprocess.run(['sh', str(recovery)], capture_output=True, text=True)
    assert retry.returncode == 0 and not retry.stderr and running.exists()
    assert not (runtime / 'restore-wam').exists()
    (proc / 'mounts').write_text('fixture ' + str(conf) + ' none rw 0 0\n')
    failed_unmount = subprocess.run(['sh', str(recovery)], env=dict(os.environ, TEST_UNMOUNT_FAIL='1'), capture_output=True, text=True)
    assert failed_unmount.returncode == 1 and running.exists()
print('Control protocol: unsupported/nonroot refusal, read-only status, foreground, dual-mode failure, lease renewal/expiry/end and stale-build rejection passed.')
