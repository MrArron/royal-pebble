#!/usr/bin/env python3
"""Watch app size report for Royal Pebble (Pebble Time 2 / emery).

Reads build/emery/pebble-app.elf (pure Python, no readelf needed) and prints:
- static size (.text + .data + .bss): the SDK refuses a build above 65,535
  bytes because PebbleProcessInfo.virtual_size is a uint16_t
  (sdk/tools/inject_metadata.py);
- heap left at launch: emery gives an app 128 KB (0x20000) in all;
- with --map build/pebble-app.map, the biggest object files.

Exit code 1 when static size is over --budget (default 63,488 = 62 KB), so a
PR that eats the last of the room fails loudly before the SDK's hard wall.
Usage: python3 tools/watch_size.py [--elf PATH] [--map PATH] [--budget N]
"""
import argparse, collections, re, struct, sys

HARD_LIMIT = 0xFFFF
APP_RAM = 0x20000


def sections(path):
    f = open(path, 'rb').read()
    shoff = struct.unpack_from('<I', f, 0x20)[0]
    entsize, num, strndx = struct.unpack_from('<HHH', f, 0x2E)
    secs = [struct.unpack_from('<IIIIIIIIII', f, shoff + i * entsize) for i in range(num)]
    names = secs[strndx]

    def name(o):
        b = f[names[4] + o:]
        return b[:b.index(b'\0')].decode()
    return {name(s[0]): (s[3], s[5]) for s in secs if s[2] & 2}  # SHF_ALLOC


def by_object(map_path, top):
    t = open(map_path).read()
    t = t[t.find('Linker script and memory map'):]
    sizes = collections.Counter()
    for m in re.finditer(r'^ \.(text|rodata|data|bss)\S*\s*\n?\s+0x[0-9a-f]+\s+0x([0-9a-f]+)\s+(\S+)', t, re.M):
        sizes[m.group(3).split('/')[-1]] += int(m.group(2), 16)
    return sizes.most_common(top)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--elf', default='build/emery/pebble-app.elf')
    ap.add_argument('--map', default=None)
    ap.add_argument('--budget', type=int, default=62 * 1024)
    a = ap.parse_args()
    s = sections(a.elf)
    end = max(addr + size for addr, size in s.values())
    parts = {k: s[k][1] for k in ('.text', '.data', '.bss') if k in s}
    print('static (virtual_size): %6d B  %s' % (end, '  '.join('%s %d' % kv for kv in parts.items())))
    print('room to SDK limit    : %6d B  (limit %d)' % (HARD_LIMIT - end, HARD_LIMIT))
    print('room to budget       : %6d B  (budget %d)' % (a.budget - end, a.budget))
    print('heap at launch       : %6d B  (128 KB minus static)' % (APP_RAM - end))
    if a.map:
        print('biggest objects (map, approximate):')
        for o, n in by_object(a.map, 12):
            print('  %6d  %s' % (n, o))
    if end > a.budget:
        print('OVER BUDGET by %d B' % (end - a.budget))
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
