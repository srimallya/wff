import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.app import app
from backend.services.essay_titles import backfill_essay_titles


def main():
    parser = argparse.ArgumentParser(description='Backfill WFF essay titles with Cerebras.')
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()

    with app.app_context():
        result = backfill_essay_titles(limit=args.limit, force=args.force)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
