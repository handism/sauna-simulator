"""Summarize and plot geometry-only water-ray endpoints (Python, NumPy, Pillow)."""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

COLORS = {
    'direct inside': (40, 120, 220),
    'TIR then surface': (230, 55, 35),
    'bottom exit then surface': (40, 190, 180),
    'other exit then surface': (230, 185, 35),
    'unresolved': (220, 40, 210),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    report = json.loads((args.directory / 'trace-summary.json').read_text())
    with gzip.open(args.directory / 'trace-rays.json.gz', 'rt') as stream:
        traces = json.load(stream)
    width, height = report['resolution']
    canvas = Image.new('RGB', (width * 2, height + 130), '#151515')
    draw = ImageDraw.Draw(canvas)
    for index, (name, rays) in enumerate(traces.items()):
        pixels = np.full((height, width, 3), 12, dtype=np.uint8)
        for ray in rays:
            category = 'unresolved'
            if ray['terminal'] == 'surface_inside':
                category = 'direct inside'
            elif ray['terminal'] == 'surface_outside':
                category = 'bottom exit then surface' if ray['events'][-1]['face'] == 'bottom' else 'other exit then surface'
            if ray.get('hit') and any(e['kind'] == 'tir' for e in ray['events']):
                category = 'TIR then surface'
            col, row = ray['pixel']
            pixels[row, col] = COLORS[category]
        canvas.paste(Image.fromarray(pixels), (index * width, 25))
        draw.text((index * width + 10, 7), name, fill='white')
    for i, (label, color) in enumerate(COLORS.items()):
        x, y = (i % 2) * width + 10, height + 40 + (i // 2) * 25
        draw.rectangle((x, y, x + 12, y + 12), fill=color)
        draw.text((x + 20, y), label, fill='white')
    canvas.save(args.directory / 'endpoints.png')
    original, candidate = traces['original'], traces['wave_box']
    if [r['pixel'] for r in original] != [r['pixel'] for r in candidate]:
        raise ValueError('Mismatched pixel mask')
    comparison = {}
    for label in ['all', 'side_tir', 'side_transmit', 'bottom']:
        pairs = [(a, b) for a, b in zip(original, candidate) if label == 'all' or a['first_exit'] == label]
        distances = [float(np.linalg.norm(np.array(a['hit']['position']) - b['hit']['position']))
                     for a, b in pairs if a.get('hit') and b.get('hit')]
        comparison[label] = {
            'count': len(pairs),
            'same_terminal': sum(a['terminal'] == b['terminal'] for a, b in pairs),
            'same_material_with_hits': sum(bool(a.get('hit') and b.get('hit')) and a['hit']['material'] == b['hit']['material'] for a, b in pairs),
            'both_hit_count': len(distances),
            'endpoint_distance_m_percentiles_50_90_99_max': [float(v) for v in np.percentile(distances, [50, 90, 99, 100])] if distances else [],
        }
    (args.directory / 'endpoint-comparison.json').write_text(json.dumps(comparison, indent=2) + '\n')
    print(json.dumps(comparison, indent=2))


if __name__ == '__main__':
    main()
