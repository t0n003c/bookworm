"""Test the new category panel endpoints."""
import urllib.request, urllib.parse, urllib.error, sys

def test(label, url, data, method='POST'):
    try:
        body = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(
            url, data=body, method=method,
            headers={'Content-Type': 'application/x-www-form-urlencoded'}
        )
        r = urllib.request.urlopen(req, timeout=5)
        print(f'{label}: STATUS {r.status}')
    except urllib.error.HTTPError as e:
        print(f'{label}: HTTP {e.code} {e.reason}')
    except Exception as e:
        print(f'{label}: ERR {type(e).__name__} {e}')

print('=== Testing new category panel routes ===')
test('POST rename',       'http://127.0.0.1:8001/categories/1/rename',       {'name': 'TestRename', 'color': '#0053e2', 'workspace_id': '1'})
test('POST panel/add',    'http://127.0.0.1:8001/categories/panel/add',       {'name': 'DoggoCat',   'color': '#0053e2', 'workspace_id': '1'})
test('POST panel-remove', 'http://127.0.0.1:8001/categories/1/panel-remove',  {'workspace_id': '1'})
print('=== Done ===')
