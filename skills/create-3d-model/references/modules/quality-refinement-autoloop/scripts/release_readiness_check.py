#!/usr/bin/env python3
"""Lightweight release-readiness checks for the Codex skill package."""
import argparse, json, re
from pathlib import Path

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--repo-root', required=True)
    ap.add_argument('--expected-version', required=True)
    ap.add_argument('--out')
    args=ap.parse_args()
    root=Path(args.repo_root)
    manifest_path=root/'manifest.json'
    if not manifest_path.exists():
        manifest_path=root/'plugin/manifest.json'
    manifest=json.loads(manifest_path.read_text())
    content_root=manifest_path.parent
    checks=[]
    def check(name, ok, detail=''):
        checks.append({'name':name,'ok':bool(ok),'detail':detail})
    check('manifest_version', manifest.get('version')==args.expected_version, manifest.get('version'))
    missing=[]
    for s in manifest.get('skills',[]):
        if not (content_root/s['path']).exists(): missing.append(s['path'])
    check('manifest_paths_exist', not missing, ', '.join(missing[:10]))
    if manifest_path.parent == root:
        for required in ['SKILL.md','LICENSE','agents/openai.yaml','references/upstream.md','references/capability-map.md']:
            p=root/required
            check(f'{required}_exists', p.exists(), required)
        connector=root/'connectors/ahujasid-blender-mcp'
        check('connector_lock_exists', (connector/'uv.lock').exists(), 'connectors/ahujasid-blender-mcp/uv.lock')
        check('connector_entry_exists', (connector/'main.py').exists(), 'connectors/ahujasid-blender-mcp/main.py')
    else:
        for doc in ['README.md','plugin/README.md','CHANGELOG.md']:
            p=root/doc
            check(f'{doc}_mentions_version', p.exists() and args.expected_version in p.read_text(errors='ignore'), doc)
    report={'schema':'blender_skill_release_readiness.v2','expected_version':args.expected_version,'manifest':str(manifest_path),'checks':checks,'passed':all(c['ok'] for c in checks)}
    txt=json.dumps(report,indent=2)
    if args.out: open(args.out,'w').write(txt)
    print(txt)
    raise SystemExit(0 if report['passed'] else 2)
if __name__=='__main__': main()
