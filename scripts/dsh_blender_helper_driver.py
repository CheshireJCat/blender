"""Run one bundled helper inside Blender with a clean argparse namespace."""

from __future__ import annotations

import argparse
import json
import runpy
import sys


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--script", required=True)
    parser.add_argument("--arguments-json", required=True)
    args = parser.parse_args(argv)
    helper_arguments = json.loads(args.arguments_json)
    if not isinstance(helper_arguments, list) or not all(isinstance(item, str) for item in helper_arguments):
        raise ValueError("helper arguments must decode to a string array")
    sys.argv = [args.script, *helper_arguments]
    runpy.run_path(args.script, run_name="__main__")


if __name__ == "__main__":
    main()
