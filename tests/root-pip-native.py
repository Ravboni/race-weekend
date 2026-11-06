"""Linux/WSL tests of real hooks with LS2 fixtures; never accesses a TV."""
import ctypes
import ctypes.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
if '--child' not in sys.argv:
    with tempfile.TemporaryDirectory(prefix='rw-pip-test-') as temp:
        temp = pathlib.Path(temp)
        (temp / 'lease').write_text(str(int(time.time()) + 12))
        mock = r'''
#include <stdlib.h>
#include <sys/stat.h>
static int original_calls;
int rw_test_fstat(int fd, struct stat *st) { int r=fstat(fd,st); if(!r) st->st_uid=getenv("TEST_NONROOT")?1000:0; return r; }
const char *LSMessageGetPayload(void *m) { return (const char *)m; }
void LSMessageUnref(void *m) { (void)m; }
void *rw_test_return_address(unsigned n) { (void)n; return getenv("TEST_OTHER_UNREF")?(void *)0x1234:(void *)0x51742; }
const char *LSMessageGetMethod(void *m) { (void)m; return getenv("TEST_METHOD")?getenv("TEST_METHOD"):"register"; }
void *_ZNK7content19RenderFrameObserver12render_frameEv(void *s) { return s; }
void *_ZN7content15RenderFrameImpl13GetRenderViewEv(void *s) { return (char *)s+640; }
#define ORIGINAL(n) void n(void*s,void*p){(void)s;(void)p; original_calls++;}
ORIGINAL(_ZN5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE)
ORIGINAL(_ZThn16_N5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE)
ORIGINAL(_ZN7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE)
ORIGINAL(_ZThn640_N7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE)
int calls(void){return original_calls;}
'''
        (temp / 'mock.c').write_text(mock)
        (temp / 'mock-decl.h').write_text('void *rw_test_return_address(unsigned);')
        subprocess.run(['gcc', '-shared', '-fPIC', str(temp / 'mock.c'), '-o', str(temp / 'mock.so')], check=True)
        for name in ['wam', 'acb']:
            subprocess.run(['gcc', '-shared', '-fPIC', '-Wall', '-Wextra', '-Werror', '-Dfstat=rw_test_fstat', '-D__builtin_return_address=rw_test_return_address', '-include', str(temp / 'mock-decl.h'),
                            '-DRW_PIP_LEASE="' + str(temp / 'lease') + '"',
                            str(ROOT / 'root-pip' / f'{name}-hook.c'), '-ldl', '-o', str(temp / f'{name}.so')], check=True)
        json_c = ctypes.util.find_library('json-c')
        if not json_c: raise RuntimeError('Host json-c runtime is required')
        env = dict(os.environ, LD_PRELOAD=f'{temp}/wam.so:{temp}/acb.so:{temp}/mock.so:{json_c}', TEST_LEASE=str(temp / 'lease'))
        subprocess.run([sys.executable, __file__, '--child'], env=env, check=True)
    sys.exit(0)

lib = ctypes.CDLL(None)
lease = pathlib.Path(os.environ['TEST_LEASE'])
get = lib.LSMessageGetPayload
get.argtypes = [ctypes.c_void_p]
get.restype = ctypes.c_void_p
buffers = []


def route(payload):
    buf = ctypes.create_string_buffer(json.dumps(payload).encode())
    buffers.append(buf)
    return json.loads(ctypes.string_at(get(ctypes.addressof(buf))))


base = {'appId': 'com.ravboni.raceweekend', 'displayOutput': {'width': 480}, 'dassAction': 'auto', 'muteAudio': False}
sub = route(base)
assert sub['vsmSinkType'] == 'sub' and sub['dassAction'] == 'manual' and sub['muteAudio'] is True
main = route(dict(base, displayOutput={'width': 1920}))
assert main['vsmSinkType'] == 'main' and main['dassAction'] == 'auto' and main['muteAudio'] is False
for item in [dict(base, appId='another.app'), dict(base, displayOutput={'width': 0}), dict(base, displayOutput={})]:
    assert route(item) == item
os.environ['TEST_METHOD'] = 'unregister'
assert route(base) == base
del os.environ['TEST_METHOD']
lease.write_text(str(int(time.time()) - 1))
assert route(base) == base
lease.write_text(str(int(time.time()) + 12))
os.environ['TEST_NONROOT'] = '1'
assert route(base) == base
del os.environ['TEST_NONROOT']
# Return values remain valid across other LS2 unrefs. Wrapper unref reclaims slots.
unref = lib.LSMessageUnref
unref.argtypes = [ctypes.c_void_p]
for i in range(2000):
    item = dict(base, pipelineId=str(i))
    buf = ctypes.create_string_buffer(json.dumps(item).encode())
    rewritten = get(ctypes.addressof(buf))
    assert json.loads(ctypes.string_at(rewritten))['vsmSinkType'] == 'sub'
    os.environ['TEST_OTHER_UNREF'] = '1'
    unref(ctypes.addressof(buf))
    assert json.loads(ctypes.string_at(rewritten))['vsmSinkType'] == 'sub'
    del os.environ['TEST_OTHER_UNREF']
    unref(ctypes.addressof(buf))
# Returned pointers survive subsequent messages; concurrent exhaustion passes through.
first = ctypes.create_string_buffer(json.dumps(base).encode())
ptr = get(ctypes.addressof(first))
saved = ctypes.string_at(ptr)
for i in range(150):
    route(dict(base, pipelineId=str(i)))
assert ctypes.string_at(ptr) == saved
assert route(dict(base, pipelineId='overflow')) == dict(base, pipelineId='overflow')

# ARM's verified layout has 32-bit string pointer/length at 0x534/0x538.
lib.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_long]
lib.mmap.restype = ctypes.c_void_p
low = lib.mmap(None, 4096, 3, 0x62, -1, 0)  # Linux x86_64 MAP_PRIVATE|ANON|MAP_32BIT
assert low and low < 2 ** 32
view = ctypes.create_string_buffer(2048)
addr = ctypes.addressof(view)


def identity(value):
    ctypes.memmove(low, value, len(value))
    ctypes.c_uint32.from_address(addr + 0x534).value = low
    ctypes.c_uint32.from_address(addr + 0x538).value = len(value)


identity(b'com.ravboni.raceweekend')
symbols = [
    ('_ZN5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE', 0),
    ('_ZThn16_N5media30RendererWebMediaPlayerDelegate22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE', 16),
    ('_ZN7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE', 0),
    ('_ZThn640_N7content14RenderViewImpl22SuspendPreviousPlayersEPN5blink14WebMediaPlayerE', 640)]


def invoke():
    for name, adjust in symbols:
        fn = getattr(lib, name)
        fn.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        fn.restype = None
        fn(addr + adjust, None)


invoke()
assert lib.calls() == 0
identity(b'other.app')
invoke()
assert lib.calls() == 4
identity(b'com.ravboni.raceweekend')
lease.write_text(str(int(time.time()) - 1))
invoke()
assert lib.calls() == 8
lease.write_text(str(int(time.time()) + 12))
os.environ['TEST_NONROOT'] = '1'
invoke()
assert lib.calls() == 12
print('Native hooks: app scoping, four thunks, audio ownership, expired/nonroot lease, payload lifetime and cache bound passed.')
