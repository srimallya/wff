import argparse
import json
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from backend.app import app
from backend.services.now_pipeline import refresh_now_stories


def main():
    parser = argparse.ArgumentParser(description='Populate WFF Now stories from configured RSS feeds.')
    parser.add_argument('--limit-per-source', type=int, default=8)
    parser.add_argument('--no-notify', action='store_true')
    args = parser.parse_args()

    with app.app_context():
        result = refresh_now_stories(
            limit_per_source=args.limit_per_source,
            notify=not args.no_notify,
        )
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
