#!/bin/sh
# Usage: sh root-pip/build.sh /path/to/C9/libc-and-libdl-directory
set -eu
cd "$(dirname "$0")"
SYS_LIBS=$(cd "${1:?Pass the directory containing C9 libc.so.6 and libdl.so.2}" && pwd)
CC=${CC:-arm-linux-gnueabi-gcc}
mkdir -p lib
for name in wam acb; do
    "$CC" -shared -nostdlib -fPIC -O2 -D_TIME_BITS=32 -D_FILE_OFFSET_BITS=32 -march=armv7-a -mfloat-abi=soft \
        -fno-stack-protector -fno-unwind-tables -fno-asynchronous-unwind-tables \
        -fvisibility=hidden -Wall -Wextra -Werror -Wl,--hash-style=sysv -Wl,--no-undefined \
        -Wl,-soname,librw-pip-$name.so "$name-hook.c" -L"$SYS_LIBS" \
        -Wl,--no-as-needed -l:libc.so.6 -l:libdl.so.2 -o "lib/librw-pip-$name.so"
done
(cd lib && sha256sum librw-pip-wam.so librw-pip-acb.so) > hooks.sha256
