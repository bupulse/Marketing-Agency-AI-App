#!/usr/bin/env python3
"""Prints the address ranges for lib/platform/rwanda-ranges.ts from RIPEstat (public, no key):
the blocks registered to Rwanda plus the prefixes announced by every network registered in Rwanda, merged.
Usage: python3 scripts/rwanda-ranges.py  (then paste the list into RWANDA_RANGES and update the date)."""
import ipaddress, json, urllib.request

def get(path):
    return json.load(urllib.request.urlopen(f"https://stat.ripe.net/data/{path}", timeout=60))["data"]

res = get("country-resource-list/data.json?resource=RW&v4_format=prefix")["resources"]
nets = [ipaddress.ip_network(p) for p in res["ipv4"] + res["ipv6"]]
for asn in res["asn"]:
    nets += [ipaddress.ip_network(p["prefix"]) for p in get(f"announced-prefixes/data.json?resource=AS{asn}")["prefixes"]]
for version in (4, 6):
    for net in ipaddress.collapse_addresses(n for n in nets if n.version == version):
        print(f'  "{net}",')
