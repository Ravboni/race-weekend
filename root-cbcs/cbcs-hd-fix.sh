#!/bin/sh
# cbcs-hd-fix.sh - enable 1080p on old LG webOS TVs by repairing the CBCS
# per-subsample counter bug in the TV's own Widevine modular decryptor.
#
# This script NEVER redistributes or downloads any LG binary. It reads the
# library already present on *your* TV, confirms its SHA256 against a table of
# known-good originals, applies a 28-byte in-place correction, confirms the
# result's SHA256, and installs it as a read-only bind-mount overlay plus a
# webosbrew boot hook. The firmware file on disk is never overwritten, and a
# full backup of the original is kept. Run `disable` to roll back.
#
# Scope: HD / 1080p only. UHD / 2160p is NOT fixed by this patch.
# Requires: root, a rooted webOS TV (Homebrew Channel / webosbrew), busybox.
#
# Usage:
#   sh cbcs-hd-fix.sh check     # inspect only, change nothing (default)
#   sh cbcs-hd-fix.sh apply     # back up, patch, bind-mount, install boot hook
#   sh cbcs-hd-fix.sh status    # report current state
#   sh cbcs-hd-fix.sh disable   # detach overlay and stop the boot hook
#   sh cbcs-hd-fix.sh enable    # re-enable after a disable
set -eu

TARGET=/usr/lib/svp/libwidevine-modular_decryptor.so
STATE=/var/lib/webos-cbcs-hd-fix
HOOK_DIR=/var/lib/webosbrew/init.d
HOOK="$HOOK_DIR/02-webos-cbcs-hd-fix"
PAYLOAD="$STATE/libwidevine-modular_decryptor.patched.so"
BACKUP="$STATE/libwidevine-modular_decryptor.original.so"
MAP="$STATE/originals.map"
STATUS="$STATE/status.log"
MARKER="$STATE/DISABLED"
LOCK="$STATE/.lock"

RO_STATE=unknown

# ---------------------------------------------------------------------------
# Known-firmware table. One record per recognized library. Fields:
#   <original_sha256> <patched_sha256> <size_bytes> <patch_offset_dec> \
#   <new_bytes_octal> <label>
# The patch resets the CBCS pattern cryptor's byte counter for each protected
# subsample (only when cipher_mode==CBC(1) and encrypt_blocks!=0), matching
# Shaka Packager's public constant-IV CBCS behaviour. See KNOWN_FIRMWARES.md
# for the matching hex and reproduce/ for how the bytes were derived.
# To support another TV/firmware, add a line here and to KNOWN_FIRMWARES.md.
# ---------------------------------------------------------------------------
known_firmwares() {
	cat <<'EOF'
d35a1b16ab053305773a072540d1ab9dfd9d23d61d41dc48b552c2fe4bc0112c 979d468696825745f24b844991eec575ce724542af9f902e50599b1baf2db5df 8260 4976 \007\232\134\106\125\370\010\074\032\104\331\370\020\000\001\050\003\321\331\370\024\000\000\261\000\042\007\222 LG_OLED_C9_OLED55C9PSA_fw05.50.00_webOS4.5_Widevine14
EOF
}

sha() { sha256sum "$1" | cut -d ' ' -f 1; }

lookup_original() {
	# print the record whose first field matches $1, or nothing.
	# printf (not echo) so the octal field's backslashes are never mangled.
	known_firmwares | awk -v s="$1" '$1==s { print; exit }'
}

is_known_patched() {
	known_firmwares | awk -v s="$1" '$2==s { f=1 } END { exit !f }'
}

is_mounted() {
	awk -v p="$TARGET" '$2==p { f=1 } END { exit !f }' /proc/mounts 2>/dev/null
}

mount_is_ro() {
	awk -v p="$TARGET" '$2==p { if ($4 ~ /(^|,)ro(,|$)/) f=1 } END { exit !f }' /proc/mounts 2>/dev/null
}

# Split a table record (passed as $1) into REC_* without using echo, so the
# octal byte field is preserved verbatim on every POSIX shell (dash included).
REC_OSHA='' REC_PSHA='' REC_SIZE='' REC_OFF='' REC_OCT='' REC_LBL=''
parse_record() {
	IFS=' ' read -r REC_OSHA REC_PSHA REC_SIZE REC_OFF REC_OCT REC_LBL <<REC_EOF
$1
REC_EOF
}

need_root() {
	[ "$(id -u 2>/dev/null || echo 0)" = 0 ] || {
		echo "ERROR: run as root." >&2
		exit 1
	}
}

acquire_lock() {
	mkdir -p "$STATE" 2>/dev/null || true
	i=0
	while ! mkdir "$LOCK" 2>/dev/null; do
		i=$((i + 1))
		[ "$i" -ge 30 ] && {
			echo "ERROR: another cbcs-hd-fix operation is in progress ($LOCK)." >&2
			exit 1
		}
		sleep 1
	done
	trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT INT TERM
}

log_status() { printf '%s\n' "$1" >"$STATUS" 2>/dev/null || true; }

# Bind-mount the payload over the target and try to enforce read-only.
# Sets RO_STATE to ro or rw. Returns non-zero only if the bind itself fails.
do_bind_ro() {
	mount --bind "$PAYLOAD" "$TARGET" || return 1
	if mount -o remount,bind,ro "$TARGET" 2>/dev/null && mount_is_ro; then
		RO_STATE=ro
	else
		RO_STATE=rw
	fi
	return 0
}

# Build the corrected payload from the TV's own original library.
# Always re-verifies the result SHA256; aborts before installing if it differs.
build_payload() {
	actual_size=$(wc -c <"$TARGET" | tr -d ' ')
	[ "$actual_size" = "$REC_SIZE" ] || {
		echo "ERROR: unexpected library size ($actual_size, want $REC_SIZE)." >&2
		exit 1
	}

	tmp="$STATE/payload.tmp"
	rm -f "$tmp"
	cp "$TARGET" "$tmp"
	printf "$REC_OCT" >"$STATE/newbytes.bin"
	nb=$(wc -c <"$STATE/newbytes.bin" | tr -d ' ')
	[ "$nb" = 28 ] || {
		echo "ERROR: patch block is $nb bytes, expected 28 (shell printf issue)." >&2
		rm -f "$tmp" "$STATE/newbytes.bin"
		exit 1
	}
	dd if="$STATE/newbytes.bin" of="$tmp" bs=1 seek="$REC_OFF" conv=notrunc 2>/dev/null
	rm -f "$STATE/newbytes.bin"

	got=$(sha "$tmp")
	[ "$got" = "$REC_PSHA" ] || {
		echo "ERROR: built payload SHA256 $got != expected $REC_PSHA. Aborting; nothing installed." >&2
		rm -f "$tmp"
		exit 1
	}
	mv "$tmp" "$PAYLOAD"
	chmod 755 "$PAYLOAD"
}

install_hook() {
	mkdir -p "$HOOK_DIR"
	cat >"$HOOK" <<'HOOK_EOF'
#!/bin/sh
# webOS CBCS HD fix - boot hook. Hash-guarded, never MAC-locked.
# Re-applies the verified read-only overlay only if the live library is a
# recognized original that the staged payload is known to correct. Never
# stacks onto an existing mount.
set -eu
root=/var/lib/webos-cbcs-hd-fix
target=/usr/lib/svp/libwidevine-modular_decryptor.so
payload="$root/libwidevine-modular_decryptor.patched.so"
[ -e "$root/DISABLED" ] && exit 0
[ -e "$target" ] || exit 0
[ -f "$payload" ] || exit 0
lock="$root/.lock"
i=0
while ! mkdir "$lock" 2>/dev/null; do
	i=$((i + 1))
	[ "$i" -ge 20 ] && exit 0
	sleep 1
done
trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM
if awk -v p="$target" '$2==p { f=1 } END { exit !f }' /proc/mounts 2>/dev/null; then
	printf 'already mounted; left as-is\n' >"$root/status.log"
	exit 0
fi
cur=$(sha256sum "$target" | cut -d ' ' -f 1)
want=$(sha256sum "$payload" | cut -d ' ' -f 1)
[ "$cur" = "$want" ] && exit 0
exp=$(awk -v s="$cur" '$1==s { print $2; exit }' "$root/originals.map" 2>/dev/null || true)
[ -n "$exp" ] || { printf 'skipped: library %s not recognized\n' "$cur" >"$root/status.log"; exit 0; }
[ "$exp" = "$want" ] || { printf 'skipped: payload/firmware mismatch\n' >"$root/status.log"; exit 0; }
if mount --bind "$payload" "$target"; then
	mount -o remount,bind,ro "$target" 2>/dev/null || true
	printf 'applied: HD CBCS fix overlay mounted; firmware file preserved\n' >"$root/status.log"
else
	printf 'mount failed\n' >"$root/status.log"
fi
HOOK_EOF
	chmod 755 "$HOOK"
}

# Confirm the installed state is internally consistent for the given live hash.
# Used before claiming an already-patched install is persistent. $1 = live sha.
installed_state_valid() {
	_cur=$1
	[ -f "$PAYLOAD" ] || return 1
	[ "$(sha "$PAYLOAD")" = "$_cur" ] || return 1
	is_known_patched "$_cur" || return 1
	[ -f "$BACKUP" ] || return 1
	_bsha=$(sha "$BACKUP")
	_rec=$(lookup_original "$_bsha")
	[ -n "$_rec" ] || return 1
	parse_record "$_rec"
	[ "$REC_PSHA" = "$_cur" ] || return 1
	[ -f "$MAP" ] || return 1
	awk -v o="$_bsha" -v p="$_cur" '$1==o && $2==p { f=1 } END { exit !f }' "$MAP" || return 1
	return 0
}

cmd_check() {
	echo "Target: $TARGET"
	[ -e "$TARGET" ] || {
		echo "  NOT FOUND - this TV has no modular Widevine decryptor at that path."
		exit 2
	}
	cur=$(sha "$TARGET")
	echo "  current SHA256: $cur"
	if is_mounted; then
		if mount_is_ro; then echo "  overlay: ACTIVE (read-only bind-mount)"; else echo "  overlay: ACTIVE (bind-mount, not read-only)"; fi
	else
		echo "  overlay: not mounted"
	fi
	if is_known_patched "$cur"; then
		echo "  status: already carries a known patched library (HD fix active)."
		return 0
	fi
	rec=$(lookup_original "$cur")
	if [ -n "$rec" ]; then
		parse_record "$rec"
		echo "  status: RECOGNIZED original -> $REC_LBL"
		echo "  this library can be patched. Run: sh cbcs-hd-fix.sh apply"
		return 0
	fi
	echo "  status: NOT RECOGNIZED."
	echo "  Refusing to patch an unknown library. Nothing was changed."
	echo "  Please report this SHA256 (and your TV model/firmware/webOS/Widevine"
	echo "  version) at the issue tracker so support can be added safely."
	return 3
}

cmd_status() {
	echo "State dir: $STATE"
	[ -f "$STATUS" ] && { echo "Last hook status:"; sed 's/^/  /' "$STATUS"; }
	[ -e "$MARKER" ] && echo "DISABLED marker present (fix is turned off)."
	[ -f "$BACKUP" ] && echo "Original backup present: $BACKUP"
	[ -f "$PAYLOAD" ] && echo "Patched payload present: $PAYLOAD ($(sha "$PAYLOAD"))"
	[ -f "$HOOK" ] && echo "Boot hook installed: $HOOK"
	if is_mounted; then
		if mount_is_ro; then echo "Overlay: ACTIVE (read-only)"; else echo "Overlay: ACTIVE (not read-only)"; fi
	else
		echo "Overlay: not mounted"
	fi
	[ -e "$TARGET" ] && echo "Live library SHA256: $(sha "$TARGET")"
}

cmd_apply() {
	need_root
	[ -e "$TARGET" ] || {
		echo "ERROR: $TARGET not found; nothing to do." >&2
		exit 2
	}
	acquire_lock
	cur=$(sha "$TARGET")

	if is_known_patched "$cur"; then
		echo "Live library is already a known patched build."
		if installed_state_valid "$cur"; then
			install_hook
			rm -f "$MARKER"
			echo "Boot hook (re)installed; HD fix will persist across reboots."
			log_status "applied: already patched; hook ensured"
			return 0
		fi
		echo "ERROR: library is patched but the local install state is incomplete or" >&2
		echo "       inconsistent (payload/backup/originals.map). Run 'disable' to" >&2
		echo "       restore the original first, then 'apply' again." >&2
		exit 1
	fi

	rec=$(lookup_original "$cur")
	[ -n "$rec" ] || {
		echo "ERROR: library SHA256 $cur is not recognized." >&2
		echo "Refusing to patch an unknown library. Nothing changed." >&2
		echo "Report this SHA256 with your TV model/firmware to add support." >&2
		exit 3
	}
	parse_record "$rec"
	echo "Recognized: $REC_LBL"

	# Never stack onto an existing mount.
	if is_mounted; then
		echo "ERROR: $TARGET already has a bind-mount. Run 'disable' first." >&2
		exit 1
	fi

	# Back up the untouched original exactly once, and verify it.
	[ -f "$BACKUP" ] || cp -p "$TARGET" "$BACKUP"
	[ "$(sha "$BACKUP")" = "$cur" ] || {
		echo "ERROR: existing backup does not match the live original. Aborting." >&2
		exit 1
	}

	build_payload
	printf '%s %s %s\n' "$cur" "$REC_PSHA" "$REC_LBL" >"$MAP"

	install_hook
	rm -f "$MARKER"

	# Re-check mount state immediately before mounting (lock already held).
	if is_mounted; then
		echo "ERROR: $TARGET became mounted during apply. Run 'disable' first." >&2
		exit 1
	fi
	if do_bind_ro; then
		echo "HD CBCS fix applied (bind-mount overlay, $RO_STATE). Original firmware file preserved."
		[ "$RO_STATE" = rw ] && echo "NOTE: kernel did not accept a read-only bind remount; overlay is writable but hash-guarded at every boot."
		echo "Restart your streaming app and try a 1080p stream."
		log_status "applied: HD CBCS fix overlay mounted ($RO_STATE); firmware file preserved"
	else
		echo "ERROR: bind-mount failed. The firmware file was not modified." >&2
		log_status "mount failed"
		exit 1
	fi
}

cmd_disable() {
	need_root
	acquire_lock
	touch "$MARKER"
	if ! is_mounted; then
		echo "No active overlay; marker set so the boot hook stays off."
		log_status "disabled by user (no active overlay)"
		return 0
	fi
	cur=$(sha "$TARGET")
	if [ ! -f "$PAYLOAD" ] || [ "$cur" != "$(sha "$PAYLOAD")" ]; then
		echo "ERROR: $TARGET is bind-mounted but its content is not this tool's" >&2
		echo "       verified payload. Refusing to detach a foreign mount." >&2
		echo "       (live=$cur). DISABLED marker kept so the boot hook stays off." >&2
		log_status "disable refused: foreign mount at target"
		exit 1
	fi
	# Lazy detach: a running media process may keep the library mapped until it exits.
	if ! umount -l "$TARGET" 2>/dev/null; then
		echo "ERROR: umount failed; overlay still active. DISABLED marker kept." >&2
		log_status "disable failed: umount error"
		exit 1
	fi
	if is_mounted; then
		echo "ERROR: overlay still present after umount. DISABLED marker kept." >&2
		log_status "disable failed: still mounted"
		exit 1
	fi
	new=$(sha "$TARGET")
	if is_known_patched "$new"; then
		echo "ERROR: underlying library still reads as patched ($new). Keeping marker." >&2
		log_status "disable incomplete: underlying still patched"
		exit 1
	fi
	if [ -n "$(lookup_original "$new")" ]; then
		echo "Original firmware library restored ($new)."
	else
		echo "Overlay detached; underlying library SHA256 is now $new."
	fi
	echo "A running media process may keep the patched library mapped until it"
	echo "exits - restart your streaming app to fully release it."
	log_status "disabled by user; overlay detached"
}

cmd_enable() {
	need_root
	acquire_lock
	[ -f "$PAYLOAD" ] || {
		echo "ERROR: no payload present. Run 'apply' instead." >&2
		exit 1
	}
	cur=$(sha "$TARGET")
	if is_known_patched "$cur"; then
		echo "Already patched."
		rm -f "$MARKER"
		return 0
	fi
	if is_mounted; then
		if [ "$cur" = "$(sha "$PAYLOAD")" ]; then
			echo "Overlay already active."
			rm -f "$MARKER"
			return 0
		fi
		echo "ERROR: $TARGET is already bind-mounted with foreign content. Run 'disable' first." >&2
		exit 1
	fi
	rec=$(lookup_original "$cur")
	[ -n "$rec" ] || {
		echo "ERROR: live library SHA256 $cur is not recognized; refusing to overlay it." >&2
		exit 3
	}
	parse_record "$rec"
	[ "$REC_PSHA" = "$(sha "$PAYLOAD")" ] || {
		echo "ERROR: staged payload does not correct this firmware. Refusing." >&2
		exit 1
	}
	if do_bind_ro; then
		rm -f "$MARKER"
		echo "Overlay re-applied ($RO_STATE)."
		log_status "re-enabled by user ($RO_STATE)"
	else
		echo "ERROR: mount failed." >&2
		exit 1
	fi
}

case "${1:-check}" in
check) cmd_check ;;
apply) cmd_apply ;;
status) cmd_status ;;
disable) cmd_disable ;;
enable) cmd_enable ;;
*)
	echo "usage: sh cbcs-hd-fix.sh [check|apply|status|disable|enable]" >&2
	exit 64
	;;
esac
