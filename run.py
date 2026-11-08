#!/usr/bin/env python3
"""Start the one server for the whole app (server/SPEC.md, server/README.md).

    python run.py [--port 8765] [--https-port 8443] [--no-https] [--host 0.0.0.0] [--db data/rfn.sqlite]

It serves the app, the phone pages, the AirPods / Apple Watch / phone motion streams and the walk test from
one address, and saves everything that arrives to a local SQLite database. Stop it with Ctrl+C.
"""
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_app_server():
    path = os.path.join(HERE, "server", "app_server.py")
    spec = importlib.util.spec_from_file_location("rfn_app_server", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main(argv=None) -> int:
    try:
        app_server = load_app_server()
    except ImportError as err:
        print(f"Could not start: {err}", file=sys.stderr, flush=True)
        return 1
    args = app_server.parse_args(argv)
    return app_server.serve(args)


if __name__ == "__main__":
    sys.exit(main())
