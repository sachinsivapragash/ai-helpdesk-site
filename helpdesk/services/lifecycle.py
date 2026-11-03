"""Starts background work (MongoDB connection, keep-awake ping) once per server process.

gunicorn runs several worker processes, created by copying (forking) a parent process. Threads
and MongoDB connections do not survive that copy, so each process starts its own, the first time
it handles a request."""
import os
import threading

_lock = threading.Lock()
_started_pid = None


def ensure_started():
    global _started_pid
    if _started_pid == os.getpid():
        return
    with _lock:
        if _started_pid == os.getpid():
            return
        from . import keepawake, mongo
        mongo.start()
        keepawake.start()
        _started_pid = os.getpid()
