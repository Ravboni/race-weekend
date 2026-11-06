#!/bin/sh
# Machine-readable adapter around the pinned, MIT-licensed CBCS HD repair.
# Reading status never mounts, writes, restarts an app or installs a boot hook.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
PACKAGE=/media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-cbcs
TARGET=/usr/lib/svp/libwidevine-modular_decryptor.so
STATE=/var/lib/webos-cbcs-hd-fix
LEGACY=/var/lib/c9-cbcs-fix/libwidevine-modular_decryptor.cbcs.so
HOOK_DIR=/var/lib/webosbrew/init.d
HOOK="$HOOK_DIR/02-webos-cbcs-hd-fix"
MOUNTS=/proc/mounts
UPSTREAM_SHA=273275d01998176376265400b22a98b9de832901ac2e520a104b70757111ab30
ORIGINAL=d35a1b16ab053305773a072540d1ab9dfd9d23d61d41dc48b552c2fe4bc0112c
PATCHED=979d468696825745f24b844991eec575ce724542af9f902e50599b1baf2db5df
ROOT=false SUPPORTED=false NEEDED=false ACTIVE=false CAN_APPLY=false CAN_DISABLE=false
RESTART=false OWNER=none REASON=unavailable

reply() {
    printf '{"protocol":1,"root":%s,"supported":%s,"needed":%s,"active":%s,"canApply":%s,"canDisable":%s,"owner":"%s","reason":"%s","restartRequired":%s}\n' \
        "$ROOT" "$SUPPORTED" "$NEEDED" "$ACTIVE" "$CAN_APPLY" "$CAN_DISABLE" "$OWNER" "$REASON" "$RESTART"
}
sha() { sha256sum "$1" 2>/dev/null | cut -d ' ' -f 1; }
mounted() { awk -v p="$TARGET" '$2==p {f=1} END {exit !f}' "$MOUNTS" 2>/dev/null; }
same_file() {
    [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%d:%i' "$1" 2>/dev/null)" = "$(stat -c '%d:%i' "$TARGET" 2>/dev/null)" ]
}
private_root_path() {
    [ ! -L "$1" ] && [ "$(stat -c %u "$1" 2>/dev/null)" = 0 ] || return 1
    mode=$(stat -c %a "$1" 2>/dev/null) || return 1
    case "$mode" in ''|*[!0-7]*) return 1;; esac
    [ "$((0$mode & 0022))" = 0 ]
}
state_safe() {
    if [ -e "$STATE" ] || [ -L "$STATE" ]; then
        [ -d "$STATE" ] && private_root_path "$STATE" || return 1
        for path in "$STATE"/* "$STATE"/.[!.]*; do
            [ -e "$path" ] || [ -L "$path" ] || continue
            private_root_path "$path" || return 1
        done
    fi
    if [ -e "$HOOK_DIR" ] || [ -L "$HOOK_DIR" ]; then
        [ -d "$HOOK_DIR" ] && private_root_path "$HOOK_DIR" || return 1
    fi
    if [ -e "$HOOK" ] || [ -L "$HOOK" ]; then private_root_path "$HOOK" || return 1; fi
    return 0
}
inspect() {
    SUPPORTED=false NEEDED=false ACTIVE=false CAN_APPLY=false CAN_DISABLE=false OWNER=none
    if [ "$(id -u 2>/dev/null)" = 0 ]; then ROOT=true; else ROOT=false; fi
    if [ ! -f "$TARGET" ]; then REASON=library-unavailable; return; fi
    current=$(sha "$TARGET")
    case "$current" in
    "$PATCHED")
        SUPPORTED=true ACTIVE=true REASON=already-active OWNER=external
        if mounted && same_file "$STATE/libwidevine-modular_decryptor.patched.so"; then
            OWNER=webos-cbcs-hd-fix
            if [ "$ROOT" = true ] && state_safe; then CAN_DISABLE=true; fi
        elif mounted && same_file "$LEGACY"; then
            OWNER=legacy-c9
        fi
        ;;
    "$ORIGINAL")
        SUPPORTED=true NEEDED=true REASON=affected-library
        if mounted; then REASON=foreign-overlay
        elif [ "$ROOT" != true ]; then REASON=root-required
        elif ! state_safe; then REASON=unsafe-install-state
        else CAN_APPLY=true
        fi
        ;;
    *) REASON=unsupported-library ;;
    esac
}
upstream_valid() {
    [ -f "$PACKAGE/cbcs-hd-fix.sh" ] && [ ! -L "$PACKAGE/cbcs-hd-fix.sh" ] &&
        [ "$(sha "$PACKAGE/cbcs-hd-fix.sh")" = "$UPSTREAM_SHA" ]
}
inspect
case "${1:-status}" in
status) reply ;;
apply)
    # Idempotent: an existing verified repair is recognized regardless of who
    # installed it. Never adopt it or replace its boot hook/backup.
    if [ "$ACTIVE" = true ]; then reply; exit 0; fi
    if [ "$CAN_APPLY" != true ]; then reply; exit 1; fi
    if ! upstream_valid; then REASON=invalid-repair-package; reply; exit 1; fi
    umask 077
    if sh "$PACKAGE/cbcs-hd-fix.sh" apply >/dev/null 2>&1; then
        inspect
        if [ "$ACTIVE" = true ]; then RESTART=true REASON=applied; reply; exit 0; fi
    fi
    inspect
    REASON=apply-failed
    # Upstream writes the boot hook before mounting. A failed apply must not
    # silently become an enabled repair on the next boot.
    if [ "$ACTIVE" = false ] && [ -d "$STATE" ] && state_safe; then
        (umask 077; : > "$STATE/DISABLED") || :
    fi
    # If mounting succeeded before another check failed, the app must still
    # release its old decoder process before it can use the resulting overlay.
    if [ "$ACTIVE" = true ]; then RESTART=true; fi
    reply
    exit 1
    ;;
disable)
    # Hash equality alone is NOT mount ownership. A legacy or foreign overlay
    # with identical bytes must remain untouched by this adapter.
    if [ "$CAN_DISABLE" != true ]; then REASON=not-owned-by-this-repair; reply; exit 1; fi
    if ! upstream_valid; then REASON=invalid-repair-package; reply; exit 1; fi
    umask 077
    if sh "$PACKAGE/cbcs-hd-fix.sh" disable >/dev/null 2>&1; then
        inspect
        if [ "$ACTIVE" = false ]; then RESTART=true REASON=disabled; reply; exit 0; fi
    fi
    inspect
    REASON=disable-failed
    reply
    exit 1
    ;;
*) REASON=unknown-action; reply; exit 2 ;;
esac
