"""DB helpers for the Subscriptions homespace page.

Business logic (Wallos-inspired):
  get_price_per_month(cycle, frequency, amount)  -> float
  get_subscription_progress(cycle, frequency, next_payment_date) -> int 0-100

All DB access via get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

import datetime

from database import get_db


# ── Pure business-logic helpers ───────────────────────────────────────────────

def get_price_per_month(cycle: int, frequency: int, amount: float) -> float:
    """Normalise any billing schedule to a monthly-equivalent cost.

    Wallos algorithm:
      daily   → amount * (30 / frequency)
      weekly  → amount * (4.35 / frequency)
      monthly → amount / frequency
      yearly  → amount / (12 * frequency)
    """
    if frequency <= 0:
        return 0.0
    if cycle == 1:                          # daily
        return amount * (30.0 / frequency)
    if cycle == 2:                          # weekly
        return amount * (4.35 / frequency)
    if cycle == 3:                          # monthly
        return amount / frequency
    if cycle == 4:                          # yearly
        return amount / (12.0 * frequency)
    return 0.0


def get_subscription_progress(
    cycle: int,
    frequency: int,
    next_payment_date: str | None,
) -> int:
    """Return 0-100 progress through the current billing period.

    0  = just billed / no date set.
    100 = payment due today or overdue.
    """
    if not next_payment_date:
        return 0
    try:
        next_dt = datetime.date.fromisoformat(next_payment_date)
    except ValueError:
        return 0

    period_days_map = {1: frequency, 2: frequency * 7, 3: frequency * 30, 4: frequency * 365}
    period_days = period_days_map.get(cycle, frequency * 30)
    if period_days <= 0:
        return 0

    days_remaining = (next_dt - datetime.date.today()).days
    days_remaining = max(0, min(period_days, days_remaining))
    return max(0, min(100, int(100 * (1 - days_remaining / period_days))))


def _days_until(next_payment_date: str | None) -> int | None:
    """Days from today until next_payment_date, or None if not set."""
    if not next_payment_date:
        return None
    try:
        return (datetime.date.fromisoformat(next_payment_date) - datetime.date.today()).days
    except ValueError:
        return None


_CYCLE_LABELS = {1: "Daily", 2: "Weekly", 3: "Monthly", 4: "Yearly"}


def _enrich(row: dict) -> dict:
    """Attach computed fields to a raw subscription row."""
    cycle = row.get("cycle", 3)
    frequency = row.get("frequency", 1)
    amount = row.get("amount", 0.0)
    npd = row.get("next_payment_date")

    row["monthly_equiv"] = round(get_price_per_month(cycle, frequency, amount), 2)
    row["progress_pct"] = get_subscription_progress(cycle, frequency, npd)
    row["days_until_due"] = _days_until(npd)
    freq = frequency or 1
    label = _CYCLE_LABELS.get(cycle, "")
    row["cycle_label"] = (f"Every {freq} {label.lower()}s" if freq > 1 else label)
    return row


# ── DB helpers ────────────────────────────────────────────────────────────────

async def get_subscriptions(page_id: int, user_id: int) -> list[dict]:
    """Return all subscriptions for page_id ordered by name, with computed fields."""
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT s.* FROM subscriptions s
            JOIN home_pages hp ON hp.id = s.page_id
            WHERE s.page_id = ? AND hp.user_id = ?
            ORDER BY s.name ASC
            """,
            (page_id, user_id),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    return [_enrich(r) for r in rows]


async def add_subscription(
    page_id: int,
    name: str,
    amount: float,
    currency: str,
    cycle: int,
    frequency: int,
    category: str,
    color: str,
    next_payment_date: str | None,
    notes: str,
    website_url: str = "",
) -> int:
    """INSERT a new subscription, return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO subscriptions
              (page_id, name, amount, currency, cycle, frequency,
               category, color, next_payment_date, notes, website_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                page_id, name, amount, currency, cycle, frequency,
                category, color, next_payment_date or None, notes,
                website_url.strip(),
            ),
        )
        await db.commit()
        return cur.lastrowid


async def update_subscription(
    sub_id: int,
    page_id: int,
    user_id: int,
    name: str,
    amount: float,
    currency: str,
    cycle: int,
    frequency: int,
    category: str,
    color: str,
    next_payment_date: str | None,
    notes: str,
    active: int,
    website_url: str = "",
) -> bool:
    """UPDATE subscription; triple ownership guard. Returns True on success."""
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE subscriptions
               SET name=?, amount=?, currency=?, cycle=?, frequency=?,
                   category=?, color=?, next_payment_date=?, notes=?, active=?,
                   website_url=?
             WHERE id=? AND page_id=?
               AND page_id IN (SELECT id FROM home_pages WHERE user_id=?)
            """,
            (
                name, amount, currency, cycle, frequency,
                category, color, next_payment_date or None, notes, active,
                website_url.strip(),
                sub_id, page_id, user_id,
            ),
        )
        await db.commit()
        return cur.rowcount == 1


async def delete_subscription(sub_id: int, page_id: int, user_id: int) -> bool:
    """Hard-delete subscription with triple ownership guard. Returns True on success."""
    async with get_db() as db:
        cur = await db.execute(
            """
            DELETE FROM subscriptions
             WHERE id=? AND page_id=?
               AND page_id IN (SELECT id FROM home_pages WHERE user_id=?)
            """,
            (sub_id, page_id, user_id),
        )
        await db.commit()
        return cur.rowcount == 1


async def get_summary_data(page_id: int, user_id: int) -> dict:
    """Compute analytics summary for the subscriptions page.

    Returns:
        monthly_total  float
        yearly_total   float
        active_count   int
        total_count    int
        by_category    list[{category, monthly_total}] sorted desc
        upcoming       list[{id,name,amount,currency,next_payment_date,days_until}] ≤5 rows
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT s.* FROM subscriptions s
            JOIN home_pages hp ON hp.id = s.page_id
            WHERE s.page_id = ? AND hp.user_id = ?
            """,
            (page_id, user_id),
        )
        rows = [dict(r) for r in await cur.fetchall()]

    monthly_total = 0.0
    active_count = 0
    cat_totals: dict[str, float] = {}

    for r in rows:
        if r.get("active"):
            active_count += 1
            m = get_price_per_month(r["cycle"], r["frequency"], r["amount"])
            monthly_total += m
            cat = r.get("category") or "Uncategorized"
            cat_totals[cat] = cat_totals.get(cat, 0.0) + m

    by_category = [
        {"category": k, "monthly_total": round(v, 2)}
        for k, v in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)
    ]

    # Upcoming: subs with a date set, sorted by date, first 5
    with_dates = [
        r for r in rows
        if r.get("next_payment_date") and r.get("active")
    ]
    with_dates.sort(key=lambda r: r["next_payment_date"])
    upcoming = [
        {
            "id":                r["id"],
            "name":              r["name"],
            "amount":            r["amount"],
            "currency":          r["currency"],
            "next_payment_date": r["next_payment_date"],
            "days_until":        _days_until(r["next_payment_date"]),
            "color":             r.get("color", "#0053e2"),
        }
        for r in with_dates[:5]
    ]

    return {
        "monthly_total": round(monthly_total, 2),
        "yearly_total":  round(monthly_total * 12, 2),
        "active_count":  active_count,
        "total_count":   len(rows),
        "by_category":   by_category,
        "upcoming":      upcoming,
    }
