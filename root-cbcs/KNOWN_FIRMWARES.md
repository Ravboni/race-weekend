# Known firmware table

Each recognized decryptor library is identified by the SHA256 of the **original**
(unpatched) `/usr/lib/svp/libwidevine-modular_decryptor.so`. The tool refuses to
touch any library not listed here.

The patch is always 28 bytes at a single offset. The region holds the CBCS
counter-advance logic; the replacement resets the pattern cryptor's counter for
each protected subsample when `cipher_mode == CBC (1)` and `encrypt_blocks != 0`.

## Entries

### LG OLED C9 (OLED55C9PSA) — firmware 05.50.00 / webOS 4.5 / Widevine 14

| field | value |
|---|---|
| library | `/usr/lib/svp/libwidevine-modular_decryptor.so` |
| size | 8260 bytes |
| patch offset | `0x1370` (4976) |
| length | 28 bytes |
| original SHA256 | `d35a1b16ab053305773a072540d1ab9dfd9d23d61d41dc48b552c2fe4bc0112c` |
| patched SHA256 | `979d468696825745f24b844991eec575ce724542af9f902e50599b1baf2db5df` |
| original bytes | `fff7e0ed3b49a9230d9a7944fff794ed079a5c4655f8083c1a440792` |
| patched bytes | `079a5c4655f8083c1a44d9f81000012803d1d9f8140000b100220792` |

Status: **verified** — 1080p AVC and 1080p HEVC SDR play cleanly on this TV
after the fix (real on-device playback, not just API success). UHD/2160p is
**not** fixed.

## Adding a new TV / firmware

The counter bug is expected on other early webOS firmwares that use the same
modular decryptor design. To add support safely:

1. On your rooted TV, get the SHA256 and size of the original library:
   `sha256sum /usr/lib/svp/libwidevine-modular_decryptor.so`
2. Locate the equivalent counter-advance block (the analogue of offset `0x1370`
   on the C9) and derive the 28-byte reset replacement. See
   [`reproduce/`](reproduce/) for the Ghidra method used on the C9.
3. Compute the patched SHA256 of the corrected library.
4. Add a line to `known_firmwares()` in `cbcs-hd-fix.sh` (octal-escaped new
   bytes), a `KNOWN` entry in `verify.py` (hex), and a section here.
5. Verify end-to-end with `python3 verify.py` against your original copy before
   installing.

Please contribute new entries only for libraries you have verified on your own
hardware, and never commit an LG binary — only the hashes and the 28-byte
old/new blocks.
