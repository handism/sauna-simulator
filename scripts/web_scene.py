"""Stable experience anchors in Blender meters, exported with glTF's axis conversion."""
import json
import hashlib
from pathlib import Path

def web(v):
    return [v[0], v[2], -v[1]]

def view(position, target, fov):
    return {'position': web(position), 'target': web(target), 'fov': fov}

def write_definition(out, reports=None):
    definition = {
        'units': 'meters', 'coordinateSystem': 'right-handed Y-up',
        'views': {
            'sauna': view((-4.9, 3.65, 2.12), (-1.25, 1.28, 1.1), 65),
            'water': view((1.18, 2.7, 1.12), (1.18, -3.5, 1.35), 68),
            'totonou': view((4.3, 2.0, 1.48), (2.8, -6, 2.3), 65),
        },
        'stove': web((-1.25, 1.28, 1.12)),
        'water': {'center': web((1.18, 2.5, .765)), 'size': [2.65, 3.17],
                  'inlet': web((1.18, 4.12, .79)), 'spout': web((1.18, 4.12, 1.12))},
    }
    scene_path = out / 'sauna.scene.json'
    scene_path.write_text(json.dumps(definition, indent=2) + '\n')
    report_path = (reports or out) / 'export-report.json'
    if report_path.exists():
        report = json.loads(report_path.read_text())
        report['scene_definition_sha256'] = hashlib.sha256(scene_path.read_bytes()).hexdigest()
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    write_definition(root / 'public/models', root / 'docs/3d-export')
