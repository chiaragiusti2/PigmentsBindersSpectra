#!/usr/bin/env python3
"""
Generate a manifest.json file that lists all pigments, instruments, and data files.
This enables the website to work on GitHub Pages without directory listing support.
"""

import os
import json
from pathlib import Path

def generate_manifest():
    pigments_dir = Path('data/pigments')
    manifest = {}
    
    if not pigments_dir.exists():
        print(f"Error: {pigments_dir} does not exist")
        return
    
    # Scan all pigment directories
    for pigment_dir in sorted(pigments_dir.iterdir()):
        if not pigment_dir.is_dir():
            continue
            
        pigment_name = pigment_dir.name
        manifest[pigment_name] = {}
        
        # Scan all instrument directories within each pigment
        for instrument_dir in sorted(pigment_dir.iterdir()):
            if not instrument_dir.is_dir():
                continue
                
            instrument_name = instrument_dir.name
            
            # List all data files in the instrument directory
            files = []
            for file in sorted(instrument_dir.iterdir()):
                if file.is_file() and not file.name.startswith('.'):
                    files.append(file.name)
            
            if files:  # Only include instruments that have files
                manifest[pigment_name][instrument_name] = files
    
    # Write manifest to data/manifest.json
    output_path = Path('data/manifest.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    
    print(f"✓ Generated {output_path}")
    print(f"  Found {len(manifest)} pigments")
    total_instruments = sum(len(v) for v in manifest.values())
    total_files = sum(len(files) for instr in manifest.values() for files in instr.values())
    print(f"  Found {total_instruments} instrument folders")
    print(f"  Found {total_files} data files")

if __name__ == '__main__':
    generate_manifest()
