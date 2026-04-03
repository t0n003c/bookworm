"""Temporary diagnostic: test route registration with List[int] = Form(default=[])."""
from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse
from typing import List

router = APIRouter()
print('=== route registration test ===', flush=True)

@router.patch('/test/{item_id}', response_class=HTMLResponse)
async def test_patch(
    item_id: int,
    name: str = Form(...),
    category_ids: List[int] = Form(default=[]),
):
    return 'ok'

print(f'routes after @patch: {len(router.routes)}', flush=True)
for r in router.routes:
    print(f'  {getattr(r, "path", "?")} {getattr(r, "methods", "?")}', flush=True)

@router.post('/test/form', response_class=HTMLResponse)
async def test_form_post(
    name: str = Form(...),
    category_ids: List[int] = Form(default=[]),
):
    return 'ok'

print(f'routes after @post/form: {len(router.routes)}', flush=True)
for r in router.routes:
    print(f'  {getattr(r, "path", "?")} {getattr(r, "methods", "?")}', flush=True)

print('=== done ===', flush=True)
