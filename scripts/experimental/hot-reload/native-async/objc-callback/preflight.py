#!/usr/bin/env python3
"""Read-only, bounded Mach-O ObjC category inventory for this experimental lane.

Supports thin little-endian arm64 dylibs with classic pointer dyld info or
64/64_OFFSET chained fixups and relative Objective-C method lists. All other
formats fail closed. Never dlopen.
"""
import argparse
import hashlib
import json
import pathlib
import struct


class Rejected(ValueError):
    pass


def inventory(path):
    with pathlib.Path(path).open("rb") as artifact:
        data = artifact.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024:
        raise Rejected("artifact exceeds experimental inventory limit")

    def unpack(fmt, offset):
        size = struct.calcsize(fmt)
        if offset < 0 or offset + size > len(data):
            raise Rejected("out-of-bounds metadata")
        return struct.unpack_from(fmt, data, offset)

    magic, cpu, _, kind, commands, command_size, _, _ = unpack("<8I", 0)
    if (magic, cpu, kind) != (0xFEEDFACF, 0x0100000C, 6) or commands > 256:
        raise Rejected("only thin arm64 MH_DYLIB is qualified")
    segments, sections, fixups, classic = [], {}, None, None
    cursor = 32
    for _ in range(commands):
        command, size = unpack("<II", cursor)
        if size < 8 or cursor + size > 32 + command_size:
            raise Rejected("invalid load command")
        if command == 0x19:
            name, vm, vmsize, offset, filesize, _, _, count, _ = unpack("<16sQQQQIIII", cursor + 8)
            if count > 128 or size != 72 + count * 80:
                raise Rejected("invalid segment sections")
            segments.append((vm, vmsize, offset, filesize))
            for index in range(count):
                section, seg, address, length, fileoff = unpack("<16s16sQQI", cursor + 72 + index * 80)
                key = (seg.split(b"\0")[0].decode(), section.split(b"\0")[0].decode())
                if key in sections:
                    raise Rejected("duplicate section")
                sections[key] = (address, length, fileoff)
        elif command == 0x80000034:
            if fixups is not None:
                raise Rejected("duplicate chained fixup command")
            fixups = unpack("<II", cursor + 8)
        elif command == 0x1A:
            raise Rejected("LC_ROUTINES_64 initializer is not admitted")
        elif command in [0x22, 0x80000022]:
            if classic is not None:
                raise Rejected("duplicate classic dyld info")
            classic = unpack("<10I", cursor + 8)
        cursor += size
    if cursor != 32 + command_size or (fixups is None and classic is None):
        raise Rejected("incomplete Mach-O metadata")
    if any(length for (_, name), (_, length, _) in sections.items()
           if name in ["__mod_init_func", "__mod_term_func", "__objc_nlcatlist", "__objc_nlclslist"]):
        raise Rejected("initializer/non-lazy Objective-C entries are not admitted")

    def file_offset(address):
        for vm, _, offset, size in segments:
            if vm <= address < vm + size:
                return offset + address - vm
        raise Rejected(f"metadata pointer {address:#x} is outside file-backed segments")

    def string_at_offset(offset):
        if offset < 0 or offset >= len(data):
            raise Rejected("string pointer out of bounds")
        end = data.find(b"\0", offset, min(offset + 4096, len(data)))
        if end < 0:
            raise Rejected("unterminated or oversized metadata string")
        return data[offset:end].decode("utf8", errors="strict")

    def string(address):
        return string_at_offset(file_offset(address))

    def classic_pointers(info):
        result = {}
        for binding, start, length in [(False, info[0], info[1]), (True, info[2], info[3])]:
            if start + length > len(data) or length > 1024 * 1024:
                raise Rejected("classic dyld stream out of bounds")
            position, end, address, symbol, pointer_type, addend = start, start + length, None, None, None, 0

            def leb(signed=False):
                nonlocal position
                value, shift = 0, 0
                for _ in range(10):
                    if position >= end:
                        raise Rejected("truncated dyld integer")
                    byte = data[position]
                    position += 1
                    value |= (byte & 127) << shift
                    shift += 7
                    if not byte & 128:
                        return value - (1 << shift) if signed and byte & 64 else value
                raise Rejected("oversized dyld integer")

            def record(count=1, skip=0):
                nonlocal address
                if count > 65536 or pointer_type != 1 or address is None or addend or (binding and symbol is None):
                    raise Rejected("unqualified classic pointer state")
                for _ in range(count):
                    if address in result:
                        raise Rejected("duplicate classic pointer fixup")
                    raw, = unpack("<Q", file_offset(address))
                    result[address] = symbol if binding else raw
                    address = (address + 8 + skip) & 0xFFFFFFFFFFFFFFFF

            while position < end:
                byte = data[position]
                position += 1
                opcode, immediate = byte & 0xF0, byte & 15
                if opcode == 0:
                    if any(data[position:end]):
                        raise Rejected("trailing classic stream operations")
                    break
                if binding:
                    if opcode in [0x10, 0x30]:
                        pass  # Dylib ordinal does not change the imported symbol identity.
                    elif opcode == 0x20:
                        leb()
                    elif opcode == 0x40:
                        stop = data.find(b"\0", position, end)
                        if stop < 0 or stop - position > 4096:
                            raise Rejected("invalid bind symbol")
                        symbol = data[position:stop].decode("utf8", errors="strict")
                        position = stop + 1
                    elif opcode == 0x50:
                        pointer_type = immediate
                    elif opcode == 0x60:
                        addend = leb(signed=True)
                    elif opcode == 0x70:
                        if immediate >= len(segments):
                            raise Rejected("invalid bind segment")
                        address = segments[immediate][0] + leb()
                    elif opcode == 0x80:
                        if address is None:
                            raise Rejected("missing bind address")
                        address = (address + leb()) & 0xFFFFFFFFFFFFFFFF
                    elif opcode == 0x90:
                        record()
                    elif opcode == 0xA0:
                        skip = leb()
                        record(skip=skip)
                    elif opcode == 0xB0:
                        record(skip=immediate * 8)
                    elif opcode == 0xC0:
                        count, skip = leb(), leb()
                        record(count, skip)
                    else:
                        raise Rejected("unqualified classic binding opcode")
                else:
                    if opcode == 0x10:
                        pointer_type = immediate
                    elif opcode == 0x20:
                        if immediate >= len(segments):
                            raise Rejected("invalid rebase segment")
                        address = segments[immediate][0] + leb()
                    elif opcode in [0x30, 0x40]:
                        if address is None:
                            raise Rejected("missing rebase address")
                        address = (address + (leb() if opcode == 0x30 else immediate * 8)) & 0xFFFFFFFFFFFFFFFF
                    elif opcode == 0x50:
                        record(immediate)
                    elif opcode == 0x60:
                        record(leb())
                    elif opcode == 0x70:
                        record(skip=leb())
                    elif opcode == 0x80:
                        count, skip = leb(), leb()
                        record(count, skip)
                    else:
                        raise Rejected("unqualified classic rebase opcode")
        return result

    base = next(vm for vm, _, offset, size in segments if offset == 0 and size)
    if fixups is None:
        pointers = classic_pointers(classic)
    else:
        fixup_offset, fixup_size = fixups
        if fixup_offset + fixup_size > len(data):
            raise Rejected("fixup payload out of bounds")
        version, starts, imports, symbols, import_count, import_format, symbol_format = unpack("<7I", fixup_offset)
        if version or symbol_format or import_format != 1 or import_count > 16384:
            raise Rejected("unqualified chained import encoding")
        bindings = []
        for index in range(import_count):
            raw, = unpack("<I", fixup_offset + imports + index * 4)
            bindings.append(string_at_offset(fixup_offset + symbols + (raw >> 9)))
        start_base = fixup_offset + starts
        segment_count, = unpack("<I", start_base)
        if segment_count != len(segments):
            raise Rejected("chained segment mismatch")
        pointers = {}
        for index in range(segment_count):
            relative, = unpack("<I", start_base + 4 + index * 4)
            if not relative:
                continue
            segment_start = start_base + relative
            size, page_size, pointer_format, segment_offset, _, pages = unpack("<IHHQIH", segment_start)
            if pointer_format not in [2, 6] or page_size not in [4096, 16384] or pages > 16384 or size < 22 + 2 * pages:
                raise Rejected("unqualified chained pointer format")
            for page in range(pages):
                start, = unpack("<H", segment_start + 22 + page * 2)
                if start == 0xFFFF:
                    continue
                if start & 0x8000 or start >= page_size:
                    raise Rejected("multi-start/invalid chain unsupported")
                page_base = base + segment_offset + page * page_size
                address = page_base + start
                for _ in range(page_size // 4):
                    raw, = unpack("<Q", file_offset(address))
                    if address in pointers:
                        raise Rejected("duplicate chained pointer")
                    if raw >> 63:
                        ordinal = raw & 0xFFFFFF
                        if ordinal >= len(bindings) or ((raw >> 24) & 0x7FFFFFF):
                            raise Rejected("unsupported bind ordinal/addend/reserved bits")
                        pointers[address] = bindings[ordinal]
                    else:
                        if ((raw >> 36) & 0x7FFF):
                            raise Rejected("unsupported high address/reserved pointer bits")
                        pointers[address] = (raw & ((1 << 36) - 1)) + (base if pointer_format == 6 else 0)
                    stride = ((raw >> 51) & 0xFFF) * 4
                    if not stride:
                        break
                    address += stride
                    if address + 8 > page_base + page_size:
                        raise Rejected("chain crosses page boundary")
                else:
                    raise Rejected("unbounded fixup chain")

    def pointer(address):
        raw, = unpack("<Q", file_offset(address))
        if address in pointers:
            return pointers[address]
        if raw == 0:
            return 0
        if address not in pointers:
            raise Rejected("untracked metadata pointer")
        return pointers[address]

    categories = []
    for (_, name), (address, size, _) in sections.items():
        if name != "__objc_catlist":
            continue
        if size % 8 or size // 8 > 256:
            raise Rejected("invalid category list")
        for slot in range(size // 8):
            category = pointer(address + slot * 8)
            class_symbol = pointer(category + 8)
            if not isinstance(class_symbol, str):
                raise Rejected("category must target an imported baseline class")
            if any(pointer(category + offset) for offset in [24, 32, 40]):
                raise Rejected("class methods, protocols or properties are not admitted")
            methods_address = pointer(category + 16)
            flags, method_count = unpack("<II", file_offset(methods_address))
            if not flags & 0x80000000 or (flags & 0xFFFF) != 12 or method_count > 256:
                raise Rejected("only bounded relative method lists are qualified")
            methods = []
            for method in range(method_count):
                field = methods_address + 8 + method * 12
                selector, encoding, imp = unpack("<iii", file_offset(field))
                selector_address = field + selector
                if not flags & 0x40000000:
                    selector_address = pointer(selector_address)
                imp_address = field + 8 + imp
                if not any(vm <= imp_address < vm + length for (segment, section), (vm, length, _) in sections.items()
                           if segment == "__TEXT" and section == "__text"):
                    raise Rejected("method implementation is outside artifact code")
                methods.append({"selector": string(selector_address), "encoding": string(field + 4 + encoding),
                                "implementation": imp_address})
            categories.append({"name": string(pointer(category)), "classSymbol": class_symbol, "methods": methods})
    return {"schema": 1, "artifactSHA256": hashlib.sha256(data).hexdigest(), "categories": categories, "loaded": False}


def validate(result, expected):
    actual = {}
    for category in result["categories"]:
        for method in category["methods"]:
            key = (category["classSymbol"], method["selector"])
            if key in actual:
                raise Rejected("duplicate category selector")
            actual[key] = method
    required = set()
    for item in expected:
        original = (item["classSymbol"], item["selector"])
        replacement = (item["classSymbol"], item["replacementSelector"])
        if original == replacement or original in required or replacement in required:
            raise Rejected("duplicate/ambiguous expected mapping")
        required.update([original, replacement])
        if original not in actual or replacement not in actual:
            raise Rejected("missing exact category selector pair")
        if actual[original]["implementation"] != actual[replacement]["implementation"]:
            raise Rejected("original/replacement selector implementations differ")
        if any(actual[key]["encoding"] != item["encoding"] for key in [original, replacement]):
            raise Rejected("Objective-C ABI encoding mismatch")
    if set(actual) != required:
        raise Rejected("artifact contains unapproved category methods")
    return dict(result, validatedReplacements=len(expected))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=pathlib.Path)
    parser.add_argument("--expect", type=pathlib.Path, required=True)
    args = parser.parse_args()
    print(json.dumps(validate(inventory(args.artifact), json.loads(args.expect.read_text())), indent=2))
