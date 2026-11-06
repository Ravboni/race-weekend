#!/bin/sh
# Fixed-command root companion. No caller-provided paths, URLs or shell fragments.
# Hooks are installed only in /tmp; reboot or deactivate restores the stock jobs.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
APP=com.ravboni.raceweekend
RUNTIME=/tmp/race-weekend-pip
PACKAGE=/media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-pip
WAM_CONF=/etc/init/WebAppMgr.conf
SUPPORTED=false
READY=false
INSTALLED=false
ACTIVE=false
ROOT=false
REASON=unavailable

reply() {
    printf '{"protocol":1,"root":%s,"supported":%s,"ready":%s,"installed":%s,"active":%s,"reason":"%s","profile":"c9-avc-50"}\n' "$ROOT" "$SUPPORTED" "$READY" "$INSTALLED" "$ACTIVE" "$REASON"
}
root_check() {
    if [ "$(id -u)" != 0 ]; then REASON=root-required; return 1; fi
    ROOT=true
}
owned_runtime() {
    [ -d "$RUNTIME" ] && [ ! -L "$RUNTIME" ] && [ "$(stat -c %u "$RUNTIME" 2>/dev/null)" = 0 ] && [ "$(stat -c %a "$RUNTIME" 2>/dev/null)" = 711 ]
}
lock_lifecycle() {
    owned_runtime || return 1
    [ ! -L "$RUNTIME/lifecycle.lock" ] || return 1
    umask 077
    exec 8>"$RUNTIME/lifecycle.lock" || return 1
    flock -n -x 8 || { exec 8>&-; return 1; }
}
watchdog_alive() {
    [ -f "$RUNTIME/watchdog.pid" ] || return 1
    guard_pid=$(cat "$RUNTIME/watchdog.pid")
    case "$guard_pid" in ''|*[!0-9]*) return 1;; esac
    kill -0 "$guard_pid" 2>/dev/null &&
        tr '\0' ' ' < "/proc/$guard_pid/cmdline" 2>/dev/null | grep -Fq "$RUNTIME/control.sh watch"
}
lock_session() {
    owned_runtime || return 1
    [ ! -L "$RUNTIME/session.lock" ] || return 1
    umask 077
    exec 9>"$RUNTIME/session.lock" || return 1
    flock -x -w 8 9 || { exec 9>&-; return 1; }
}
unlock_session() { flock -u 9; exec 9>&-; }
foreground() {
    luna-send -n 1 -w 2000 luna://com.webos.applicationManager/getForegroundAppInfo '{}' </dev/null 2>/dev/null | grep -q '"appId" *: *"com.ravboni.raceweekend"'
}
profile_check() {
    # C9 runs ARM32 services on an aarch64 kernel; pinned ELF hashes guard the ABI.
    case "$(uname -m)" in armv7l|aarch64) ;; *) REASON=unsupported-platform; return 1;; esac
    model=$(luna-send -n 1 -w 2000 luna://com.webos.service.tv.systemproperty/getSystemInfo '{"keys":["modelName"]}' </dev/null 2>/dev/null) || { REASON=identity-unavailable; return 1; }
    printf '%s' "$model" | grep -Eq '"modelName" *: *"OLED[0-9][0-9]C9[A-Za-z0-9. -]*"' || { REASON=unsupported-model; return 1; }
    [ -r "$PACKAGE/profile.sha256" ] && sha256sum -c "$PACKAGE/profile.sha256" >/dev/null 2>&1 || { REASON=unsupported-firmware; return 1; }
    SUPPORTED=true
}
mapped() {
    pids=$(pidof "$1" 2>/dev/null) || return 1
    [ -n "$pids" ] || return 1
    for pid in $pids; do
        grep -Fq "$RUNTIME/lib/$2" "/proc/$pid/maps" 2>/dev/null || return 1
    done
}
lease_active() {
    owned_runtime && [ -f "$RUNTIME/lease" ] && [ ! -L "$RUNTIME/lease" ] || return 1
    expiry=$(cat "$RUNTIME/lease" 2>/dev/null)
    case "$expiry" in ''|*[!0-9]*) return 1;; esac
    now=$(date +%s)
    [ "$expiry" -gt "$now" ] && [ "$expiry" -le "$((now + 15))" ]
}
own_wam_bind() {
    grep -q " $WAM_CONF " /proc/mounts && [ -f "$RUNTIME/WebAppMgr.conf" ] &&
        [ "$(stat -c '%d:%i' "$RUNTIME/WebAppMgr.conf")" = "$(stat -c '%d:%i' "$WAM_CONF")" ]
}
inspect_runtime() {
    READY=false
    INSTALLED=false
    ACTIVE=false
    REASON=activation-required
    if ! owned_runtime; then return; fi
    if own_wam_bind || mapped WebAppMgr librw-pip-wam.so || mapped AcbService librw-pip-acb.so; then INSTALLED=true; fi
    if ! cmp -s "$PACKAGE/control.sh" "$RUNTIME/control.sh" || ! cmp -s "$PACKAGE/hooks.sha256" "$RUNTIME/hooks.sha256" || ! (cd "$RUNTIME/lib" && sha256sum -c "$RUNTIME/hooks.sha256" >/dev/null 2>&1); then
        if [ "$INSTALLED" = true ]; then REASON=stale-build; fi
        return
    fi
    if own_wam_bind && mapped WebAppMgr librw-pip-wam.so && mapped AcbService librw-pip-acb.so && watchdog_alive; then
        READY=true
        REASON=ready
        if lease_active; then ACTIVE=true; fi
    elif [ "$INSTALLED" = true ]; then REASON=incomplete-activation
    fi
}
reset_routes() {
    luna-send -n 1 -w 2000 luna://com.webos.service.acb/resetDualMode '{"appId":"com.ravboni.raceweekend"}' </dev/null >/dev/null 2>&1 || :
    luna-send -n 1 -w 2000 luna://com.webos.service.tv.display/setSubWindowProperties '{"appId":"com.ravboni.raceweekend","purpose":"none","windowMode":"none"}' </dev/null >/dev/null 2>&1 || :
}
clear_session() {
    if owned_runtime; then rm -f "$RUNTIME/lease" "$RUNTIME/lease.next"; fi
    ACTIVE=false
}
renew_lease() {
    owned_runtime || return 1
    umask 077
    printf '%s\n' "$(($(date +%s) + 12))" > "$RUNTIME/lease.next" && chmod 644 "$RUNTIME/lease.next" && mv "$RUNTIME/lease.next" "$RUNTIME/lease"
}
stop_guard() {
    if owned_runtime && [ -f "$RUNTIME/watchdog.pid" ]; then
        pid=$(cat "$RUNTIME/watchdog.pid")
        case "$pid" in ''|*[!0-9]*) ;; *)
            if [ "$pid" != "$$" ] && [ -r "/proc/$pid/cmdline" ] && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -Fq "$RUNTIME/control.sh watch"; then kill "$pid" 2>/dev/null || :; fi
        esac
        rm -f "$RUNTIME/watchdog.pid"
    fi
}
restore_jobs() {
    lock_session || return 1
    clear_session
    unlock_session
    stop_guard
    # Keep restart intent across failed unmount/start attempts. Only our bind
    # is detached, and a failed detach still restarts the stopped WAM.
    if own_wam_bind; then
        : > "$RUNTIME/restore-wam"
        initctl stop WebAppMgr >/dev/null 2>&1 || :
        if ! umount "$WAM_CONF"; then
            initctl start WebAppMgr >/dev/null 2>&1 || :
            return 1
        fi
        initctl reload-configuration >/dev/null 2>&1
    fi
    if [ -f "$RUNTIME/restore-wam" ]; then
        if ! initctl status WebAppMgr 2>/dev/null | grep -q 'start/running'; then
            initctl start WebAppMgr >/dev/null 2>&1 || return 1
        fi
        rm -f "$RUNTIME/restore-wam"
    fi
    for pid in $(pidof AcbService 2>/dev/null); do
        if grep -Fq "$RUNTIME/lib/librw-pip-acb.so" "/proc/$pid/maps" 2>/dev/null; then kill "$pid" 2>/dev/null || :; fi
    done
    sleep 1
    if ! initctl status AcbService 2>/dev/null | grep -q 'start/running'; then
        initctl start AcbService >/dev/null 2>&1 || return 1
    fi
    sleep 6
    reset_routes
}

activate_worker() {
    # Executed from the root-owned copy; the app/package may be replaced later.
    trap 'restore_jobs >/dev/null 2>&1' HUP INT TERM
    sleep 2
    pid=$(pidof AcbService 2>/dev/null)
    case "$pid" in ''|*' '*) return 1;; esac
    cat "/proc/$pid/environ" > "$RUNTIME/acb.env" || return 1
    initctl stop AcbService >/dev/null 2>&1 || return 1
    (exec 8>&-; xargs -0 sh -c 'exec env -i "$@" LD_PRELOAD=/tmp/race-weekend-pip/lib/librw-pip-acb.so /usr/sbin/AcbService' acb-env < "$RUNTIME/acb.env" > "$RUNTIME/acb.log" 2>&1 &)
    sleep 2
    mapped AcbService librw-pip-acb.so || { restore_jobs; return 1; }
    mount --bind "$RUNTIME/WebAppMgr.conf" "$WAM_CONF" || { restore_jobs; return 1; }
    initctl reload-configuration >/dev/null 2>&1
    initctl stop WebAppMgr >/dev/null 2>&1 || :
    initctl start WebAppMgr >/dev/null 2>&1 || { restore_jobs; return 1; }
    sleep 6
    mapped WebAppMgr librw-pip-wam.so || { restore_jobs; return 1; }
    nohup sh "$RUNTIME/control.sh" watch 8>&- </dev/null > "$RUNTIME/watchdog.log" 2>&1 &
    echo "$!" > "$RUNTIME/watchdog.pid"
    luna-send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.ravboni.raceweekend"}' </dev/null >/dev/null 2>&1 || :
}

case "${1:-status}" in
status)
    if root_check; then
        inspect_runtime
        if profile_check; then inspect_runtime; else READY=false; ACTIVE=false; fi
    fi
    reply
    ;;
activate)
    if ! root_check || ! profile_check; then reply; exit 1; fi
    inspect_runtime
    if [ "$READY" = true ]; then reply; exit 0; fi
    if [ "$INSTALLED" = true ]; then REASON=deactivate-required; reply; exit 1; fi
    if grep -q " $WAM_CONF " /proc/mounts; then REASON=configuration-in-use; reply; exit 1; fi
    if [ -e "$RUNTIME" ] || [ -L "$RUNTIME" ]; then
        if ! owned_runtime; then REASON=unsafe-runtime; reply; exit 1; fi
    else
        (umask 066; mkdir -m 711 "$RUNTIME") || { REASON=runtime-unavailable; reply; exit 1; }
    fi
    # The worker inherits this lock. Process death releases it automatically;
    # an abandoned marker cannot permanently block a retry.
    lock_lifecycle || { REASON=activating; reply; exit 0; }
    inspect_runtime
    if [ "$READY" = true ]; then reply; exit 0; fi
    if [ "$INSTALLED" = true ]; then REASON=deactivate-required; reply; exit 1; fi
    rm -f "$RUNTIME/activating"
    if ! grep -q '^    export LD_PRELOAD=/usr/lib/libsystrim.so.3$' "$WAM_CONF"; then REASON=unsupported-configuration; reply; exit 1; fi
    if ! (cd "$PACKAGE/lib" && sha256sum -c "$PACKAGE/hooks.sha256" >/dev/null 2>&1); then REASON=invalid-hook-build; reply; exit 1; fi
    umask 077
    mkdir -p "$RUNTIME/lib"
    cp "$PACKAGE/lib/librw-pip-wam.so" "$PACKAGE/lib/librw-pip-acb.so" "$RUNTIME/lib/" || exit 1
    chmod 755 "$RUNTIME/lib"
    chmod 644 "$RUNTIME/lib/"*.so
    cp "$PACKAGE/control.sh" "$RUNTIME/control.sh" || exit 1
    cp "$PACKAGE/hooks.sha256" "$RUNTIME/hooks.sha256" || exit 1
    sed 's#^    export LD_PRELOAD=/usr/lib/libsystrim.so.3$#    export LD_PRELOAD="/usr/lib/libsystrim.so.3 /tmp/race-weekend-pip/lib/librw-pip-wam.so"#' "$WAM_CONF" > "$RUNTIME/WebAppMgr.conf"
    : > "$RUNTIME/activating"
    nohup sh "$RUNTIME/control.sh" worker </dev/null > "$RUNTIME/activation.log" 2>&1 &
    REASON=activating
    reply
    ;;
begin)
    if ! root_check || ! profile_check; then reply; exit 1; fi
    lock_session || { REASON=session-busy; reply; exit 1; }
    inspect_runtime
    if [ "$READY" != true ]; then reply; exit 1; fi
    if ! foreground; then clear_session; REASON=not-foreground; reply; exit 1; fi
    # ACB must know dual mode before either native player is registered.
    if ! luna-send -n 1 -w 3000 luna://com.webos.service.acb/setDualMode '{"appId":"com.ravboni.raceweekend"}' </dev/null 2>/dev/null | grep -q '"returnValue" *: *true'; then REASON=dual-mode-failed; reply; exit 1; fi
    renew_lease || { reset_routes; REASON=lease-failed; reply; exit 1; }
    ACTIVE=true
    reply
    ;;
heartbeat)
    if ! root_check; then reply; exit 1; fi
    # Serialize with end/watch so a delayed foreground reply cannot recreate
    # a lease after the viewer has closed PiP.
    lock_session || { REASON=session-busy; reply; exit 1; }
    # Hashes were checked at begin; avoid hashing the large browser every3s.
    inspect_runtime
    if [ "$READY" != true ] || ! lease_active || ! foreground; then
        clear_session; reset_routes; REASON=session-ended; reply; exit 1
    fi
    SUPPORTED=true
    renew_lease || { clear_session; REASON=lease-failed; reply; exit 1; }
    ACTIVE=true
    reply
    ;;
end)
    if ! root_check; then reply; exit 1; fi
    lock_session || { REASON=session-busy; reply; exit 1; }
    clear_session
    reset_routes
    inspect_runtime
    reply
    ;;
deactivate)
    if ! root_check; then reply; exit 1; fi
    if ! owned_runtime; then REASON=inactive; reply; exit 0; fi
    lock_lifecycle || { REASON=activating; reply; exit 1; }
    # Deferred restoration also restarts WAM; respond while the app still exists.
    lock_session || { REASON=session-busy; reply; exit 1; }
    clear_session
    unlock_session
    nohup sh "$RUNTIME/control.sh" restore </dev/null > "$RUNTIME/restoration.log" 2>&1 &
    REASON=deactivating
    reply
    ;;
worker)
    root_check && owned_runtime || exit 1
    activate_worker
    result=$?
    rm -f "$RUNTIME/activating"
    exit "$result"
    ;;
watch)
    root_check && owned_runtime || exit 1
    while owned_runtime; do
        sleep 2
        if [ -f "$RUNTIME/lease" ] && lock_session; then
            if ! lease_active || ! foreground; then clear_session; reset_routes; fi
            unlock_session
        fi
        if ! mapped WebAppMgr librw-pip-wam.so || ! mapped AcbService librw-pip-acb.so; then
            if lock_session; then clear_session; reset_routes; unlock_session; fi
            exit 0
        fi
    done
    ;;
restore)
    root_check && owned_runtime || exit 1
    sleep 2
    restore_jobs || exit 1
    for pid in $(pidof WebAppMgr 2>/dev/null) $(pidof AcbService 2>/dev/null); do
        if grep -Fq "$RUNTIME/lib/librw-pip-" "/proc/$pid/maps" 2>/dev/null; then exit 1; fi
    done
    rm -f "$RUNTIME/activating" "$RUNTIME/acb.env" "$RUNTIME/lease" "$RUNTIME/lease.next" "$RUNTIME/watchdog.pid" \
        "$RUNTIME/lib/librw-pip-wam.so" "$RUNTIME/lib/librw-pip-acb.so" "$RUNTIME/WebAppMgr.conf" \
        "$RUNTIME/session.lock" "$RUNTIME/lifecycle.lock" "$RUNTIME/restore-wam" \
        "$RUNTIME/control.sh" "$RUNTIME/hooks.sha256" "$RUNTIME/activation.log" "$RUNTIME/acb.log" "$RUNTIME/watchdog.log" "$RUNTIME/restoration.log"
    rmdir "$RUNTIME/lib" "$RUNTIME" 2>/dev/null || :
    luna-send -n 1 -w 3000 luna://com.webos.applicationManager/launch '{"id":"com.ravboni.raceweekend"}' </dev/null >/dev/null 2>&1 || :
    ;;
*) REASON=unknown-action; reply; exit 2;;
esac
