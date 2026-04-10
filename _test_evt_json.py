"""Verify the tojson | safe fix: JSON in script tags must NOT be HTML-escaped."""
import sys
from templates_env import _jinja_env

tpl = _jinja_env.from_string(
    '<script type="application/json">{{ items | tojson | safe }}</script>'
)
items = [{"id": 1, "text": 'Test "Event" & <stuff>', "target_date": "2026-04-10"}]
result = tpl.render(items=items)

print("RENDERED OUTPUT:")
print(result)
print()

has_entity = "&quot;" in result or "&amp;" in result or "&lt;" in result
has_quotes = '"id"' in result  # raw JSON key = proof it's not escaped

print(f"❌ HTML entities present: {has_entity}")
print(f"✅ Raw JSON quotes present: {has_quotes}")

if has_entity:
    print("\nFAIL: JSON is still being HTML-escaped — &quot; will break JSON.parse()")
    sys.exit(1)
else:
    print("\nPASS: JSON is safe and parseable by JavaScript ✅")
