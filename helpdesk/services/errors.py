"""Short, readable reasons for failed outgoing calls (requests' own messages are long URLs)."""
import requests


def short_reason(err, timeout_seconds=None):
    if isinstance(err, requests.Timeout):
        return f'timed out after {round(timeout_seconds * 1000)} ms' if timeout_seconds else 'timed out'
    if isinstance(err, requests.ConnectionError):
        return 'could not connect'
    if isinstance(err, requests.RequestException):
        return type(err).__name__
    message = str(err)
    return message if len(message) <= 160 else message[:157] + '...'
