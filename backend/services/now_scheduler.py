import logging
import os
import threading
import time

from backend.services.now_pipeline import refresh_now_stories


_scheduler_started = False
_scheduler_lock = threading.Lock()


def _parse_bool(value, default=True):
    raw = str(value if value is not None else '').strip().lower()
    if raw in {'1', 'true', 'yes', 'on'}:
        return True
    if raw in {'0', 'false', 'no', 'off'}:
        return False
    return default


def _parse_int(value, default, minimum, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def now_scheduler_enabled(app):
    if app.config.get('TESTING'):
        return False
    return _parse_bool(os.environ.get('WFF_NOW_REFRESH_ENABLED'), default=True)


def start_now_refresh_scheduler(app):
    global _scheduler_started
    if not now_scheduler_enabled(app):
        return False

    with _scheduler_lock:
        if _scheduler_started:
            return False
        _scheduler_started = True

    interval_seconds = _parse_int(os.environ.get('WFF_NOW_REFRESH_INTERVAL_SECONDS'), 900, 300, 86400)
    initial_delay_seconds = _parse_int(os.environ.get('WFF_NOW_REFRESH_INITIAL_DELAY_SECONDS'), 60, 0, 3600)
    limit_per_source = _parse_int(os.environ.get('WFF_NOW_REFRESH_LIMIT_PER_SOURCE'), 1, 1, 20)

    def run():
        logger = getattr(app, 'logger', logging.getLogger(__name__))
        if initial_delay_seconds:
            time.sleep(initial_delay_seconds)
        while True:
            try:
                with app.app_context():
                    result = refresh_now_stories(limit_per_source=limit_per_source, notify=True)
                logger.info(
                    '[WFF Now] refresh created=%s updated=%s sources=%s errors=%s',
                    result.get('created'),
                    result.get('updated'),
                    result.get('source_count'),
                    len(result.get('errors') or []),
                )
            except Exception:
                logger.exception('[WFF Now] scheduled refresh failed')
            time.sleep(interval_seconds)

    thread = threading.Thread(target=run, name='wff-now-refresh', daemon=True)
    thread.start()
    return True
