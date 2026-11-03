"""MongoDB for chat logs and feedback. If MONGODB_URI is not set (local dev), the connection
fails, or MongoDB goes down later, documents are kept in memory so the chat keeps working;
/health reports it, the app retries every 30 seconds, and held documents are saved on reconnect."""
import logging
import threading
import time
from collections import deque
from datetime import datetime, timezone

from bson import ObjectId
from django.conf import settings
from pymongo import MongoClient

log = logging.getLogger(__name__)
RETRY_SECONDS = 30
MAX_IN_MEMORY = 1000

_lock = threading.Lock()
_db = None
_client = None
_last_error = None
_memory = {'chat_logs': deque(maxlen=MAX_IN_MEMORY), 'feedback': deque(maxlen=MAX_IN_MEMORY)}
_started = False


def _connect_once():
    global _db, _client, _last_error
    try:
        _client = _client or MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000, appname='eventease')
        _client.admin.command('ping')
        db = _client[settings.MONGODB_DB]
        db.chat_logs.create_index([('sessionId', 1), ('createdAt', -1)])
        db.feedback.create_index('messageId')
        _db, _last_error = db, None
        log.info('[mongo] connected')
        _flush_memory()
        return True
    except Exception as err:  # noqa: BLE001 - any failure means "use memory and retry"
        _db, _last_error = None, str(err)
        log.warning('[mongo] connection failed, using in-memory store, retrying in %ss: %s', RETRY_SECONDS, err)
        return False


def start():
    """Connect in the background so a slow or missing MongoDB never blocks start-up."""
    global _started, _last_error
    with _lock:
        if _started:
            return
        _started = True
    if not settings.MONGODB_URI:
        _last_error = 'MONGODB_URI not set - using in-memory store'
        log.warning('[mongo] %s', _last_error)
        return

    def loop():
        while not _connect_once():
            time.sleep(RETRY_SECONDS)

    threading.Thread(target=loop, name='mongo-connect', daemon=True).start()


def _flush_memory():
    for name, held in _memory.items():
        if not held or _db is None:
            continue
        pending = list(held)
        held.clear()
        try:
            _db[name].insert_many(pending)
            log.info('[mongo] saved %s %s record(s) kept during the outage', len(pending), name)
        except Exception:  # noqa: BLE001
            held.extend(pending)


def insert(collection, doc):
    record = {**doc, 'createdAt': datetime.now(timezone.utc)}
    if _db is not None:
        try:
            result = _db[collection].insert_one(record)
            _flush_memory()
            return str(result.inserted_id)
        except Exception as err:  # noqa: BLE001
            global _last_error
            _last_error = f'last write failed: {err}'
            log.warning('[mongo] insert into %s failed, kept in memory: %s', collection, err)
    record['_id'] = ObjectId()
    _memory[collection].append(record)
    return str(record['_id'])


def count(collection):
    held = len(_memory[collection])
    if _db is not None:
        return _db[collection].estimated_document_count() + held
    return held


def feedback_summary():
    summary = {}
    for f in _memory['feedback']:
        summary[f['rating']] = summary.get(f['rating'], 0) + 1
    if _db is not None:
        for row in _db.feedback.aggregate([{'$group': {'_id': '$rating', 'n': {'$sum': 1}}}]):
            summary[row['_id']] = summary.get(row['_id'], 0) + row['n']
    return summary


def ping():
    if _db is None:
        return {'ok': False, 'mode': 'memory', 'detail': _last_error}
    started = time.monotonic()
    try:
        _db.command('ping')
    except Exception as err:  # noqa: BLE001
        return {'ok': False, 'mode': 'mongodb', 'detail': str(err),
                'unsavedInMemory': len(_memory['chat_logs']) + len(_memory['feedback'])}
    return {'ok': True, 'mode': 'mongodb', 'latencyMs': round((time.monotonic() - started) * 1000)}
