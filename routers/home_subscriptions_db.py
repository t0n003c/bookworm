"""DB helpers for the Subscriptions homespace page.

Business logic (Wallos-inspired):
  get_price_per_month(cycle, frequency, amount)  -> float
  get_subscription_progress(cycle, frequency, next_payment_date) -> int 0-100

All DB access via get_db() — never raw aiosqlite.connect().
"""
from __future__ import annotations

import calendar
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


def _advance_date(from_date: datetime.date, cycle: int, frequency: int) -> datetime.date:
    """Return the next billing date after from_date given cycle+frequency.

    cycle:  1=daily  2=weekly  3=monthly  4=yearly
    frequency: billing repeats every N cycles (e.g. freq=3,cycle=3 → every 3 months)
    """
    freq = max(1, frequency)
    if cycle == 1:   # daily
        return from_date + datetime.timedelta(days=freq)
    if cycle == 2:   # weekly
        return from_date + datetime.timedelta(weeks=freq)
    if cycle == 3:   # monthly — month-safe arithmetic
        month = from_date.month - 1 + freq
        year  = from_date.year + month // 12
        month = month % 12 + 1
        # Clamp day to last valid day of the target month (e.g. Jan 31 → Feb 28)
        day   = min(from_date.day, calendar.monthrange(year, month)[1])
        return datetime.date(year, month, day)
    if cycle == 4:   # yearly
        year = from_date.year + freq
        day  = min(from_date.day, calendar.monthrange(year, from_date.month)[1])
        return datetime.date(year, from_date.month, day)
    # Fallback: treat as monthly
    return _advance_date(from_date, 3, freq)





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
    start_date: str | None = None,
    notes: str = "",
    website_url: str = "",
    reminder_days: int = 0,
) -> int:
    """INSERT a new subscription, return its id."""
    async with get_db() as db:
        cur = await db.execute(
            """
            INSERT INTO subscriptions
              (page_id, name, amount, currency, cycle, frequency,
               category, color, next_payment_date, start_date, notes,
               website_url, reminder_days)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                page_id, name, amount, currency, cycle, frequency,
                category, color, next_payment_date or None, start_date or None,
                notes, website_url.strip(), max(0, reminder_days),
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
    start_date: str | None = None,
    notes: str = "",
    active: int = 1,
    website_url: str = "",
    reminder_days: int = 0,
) -> bool:
    """UPDATE subscription; triple ownership guard. Returns True on success."""
    async with get_db() as db:
        cur = await db.execute(
            """
            UPDATE subscriptions
               SET name=?, amount=?, currency=?, cycle=?, frequency=?,
                   category=?, color=?, next_payment_date=?, start_date=?,
                   notes=?, active=?, website_url=?, reminder_days=?
             WHERE id=? AND page_id=?
               AND page_id IN (SELECT id FROM home_pages WHERE user_id=?)
            """,
            (
                name, amount, currency, cycle, frequency,
                category, color, next_payment_date or None, start_date or None,
                notes, active, website_url.strip(), max(0, reminder_days),
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


async def clear_subscription(sub_id: int, page_id: int, user_id: int) -> bool:
    """Mark a renewal as paid and auto-advance next_payment_date one billing cycle.

    Sets cleared_date = old next_payment_date, then advances next_payment_date
    by the subscription's cycle + frequency so it reappears automatically in
    Upcoming Renewals at the correct future date.
    Returns True when the row was found and updated.
    """
    async with get_db() as db:
        # 1. Fetch the row (ownership-guarded)
        cur = await db.execute(
            """
            SELECT s.next_payment_date, s.cycle, s.frequency
              FROM subscriptions s
              JOIN home_pages hp ON hp.id = s.page_id
             WHERE s.id = ? AND s.page_id = ? AND hp.user_id = ?
            """,
            (sub_id, page_id, user_id),
        )
        row = await cur.fetchone()
        if not row:
            return False

        npd_str, cycle, frequency = row[0], row[1] or 3, row[2] or 1

        # 2. Parse current due date (fall back to today if unset)
        try:
            current_due = datetime.date.fromisoformat(npd_str) if npd_str else datetime.date.today()
        except ValueError:
            current_due = datetime.date.today()

        next_due = _advance_date(current_due, cycle, frequency)

        # 3. Write: cleared_date ← old due date, next_payment_date ← new due date
        await db.execute(
            """
            UPDATE subscriptions
               SET cleared_date      = ?,
                   next_payment_date = ?
             WHERE id = ? AND page_id = ?
            """,
            (current_due.isoformat(), next_due.isoformat(), sub_id, page_id),
        )
        await db.commit()
        return True


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

    # Upcoming: active subs with a date set, sorted by date, first 5.
    # Exclude any sub where cleared_date >= next_payment_date — the user
    # already marked it as paid this billing cycle.  It will reappear
    # automatically once next_payment_date advances to the next cycle.
    with_dates = [
        r for r in rows
        if r.get("next_payment_date") and r.get("active")
        and not (
            r.get("cleared_date")
            and r["cleared_date"] >= r["next_payment_date"]
        )
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


# ── Push notification helper ───────────────────────────────────────────────────────

async def get_due_subscription_reminders() -> list[dict]:
    """Return active subscriptions whose reminder window opens today.

    Conditions:
      - active = 1
      - reminder_days > 0
      - next_payment_date is set
      - 0 ≤ days_until_due ≤ reminder_days  (due today or within reminder window)
      - not already cleared for this billing cycle
        (cleared_date IS NULL OR cleared_date < next_payment_date)

    Joined with push_subscriptions so the caller has everything needed to
    send the push and record the dedup key.

    Dedup key format: "sub:{id}:{next_payment_date}" — one push per billing
    cycle.  The key changes automatically when next_payment_date advances.
    """
    async with get_db() as db:
        cur = await db.execute(
            """
            SELECT s.id, s.name, s.reminder_days,
                   s.next_payment_date, s.amount, s.currency,
                   hp.user_id,
                   ps.endpoint, ps.p256dh, ps.auth
            FROM   subscriptions s
            JOIN   home_pages hp ON hp.id = s.page_id
            JOIN   push_subscriptions ps ON ps.user_id = hp.user_id
            WHERE  s.active = 1
              AND  s.reminder_days > 0
              AND  s.next_payment_date IS NOT NULL
              AND  julianday(s.next_payment_date) - julianday('now') BETWEEN 0 AND s.reminder_days
              AND  (s.cleared_date IS NULL OR s.cleared_date < s.next_payment_date)
            """
        )
        rows = await cur.fetchall()
    return [
        {
            "sub_id":            r[0],
            "name":              r[1],
            "reminder_days":     r[2],
            "next_payment_date": r[3],
            "amount":            r[4],
            "currency":          r[5],
            "user_id":           r[6],
            "endpoint":          r[7],
            "p256dh":            r[8],
            "auth":              r[9],
            "dedup_key":         f"sub:{r[0]}:{r[3]}",
        }
        for r in rows
    ]
