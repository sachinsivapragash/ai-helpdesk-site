"""Render's free plan sleeps after 15 minutes without incoming requests. On Render the app
visits its own public address every 10 minutes (a static file, so the database isn't woken),
which keeps it awake. RENDER_EXTERNAL_URL is set by Render; set KEEP_AWAKE=false to turn it off."""
import logging
import os
import threading
import time

import requests

log = logging.getLogger(__name__)
INTERVAL_SECONDS = 10 * 60
_started_pid = None


def start():
    global _started_pid
    base = os.environ.get('RENDER_EXTERNAL_URL')
    if _started_pid == os.getpid() or not base or os.environ.get('KEEP_AWAKE', '').lower() == 'false':
        return
    _started_pid = os.getpid()

    def loop():
        while True:
            time.sleep(INTERVAL_SECONDS)
            try:
                requests.get(f'{base}/static/favicon.svg', timeout=15)
            except requests.RequestException as err:
                log.warning('[keep-awake] ping failed: %s', err)

    threading.Thread(target=loop, name='keep-awake', daemon=True).start()
    log.info('[keep-awake] pinging %s every 10 minutes', base)
