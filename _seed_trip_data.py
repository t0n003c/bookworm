"""
Seed rich example data into trip page 91 (user 1 — t0n003c).
Safe to re-run: clears existing seed data first.
"""
import sqlite3, json

PAGE_ID = 91
USER_ID = 1

db = sqlite3.connect('bookworm.db')
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys = ON")

# ── helpers ──────────────────────────────────────────────────────────────────
def _next_sort(table, col='sort_order', where='', params=()):
    where_sql = f"WHERE {where}" if where else ""
    r = db.execute(f"SELECT COALESCE(MAX({col}),0)+10 FROM {table} {where_sql}", params).fetchone()
    return r[0]


# ── 0. wipe existing data for this page so re-runs are idempotent ─────────────
print("Clearing old seed data …")
db.execute("DELETE FROM trip_day_blocks  WHERE day_id  IN (SELECT id FROM trip_days  WHERE page_id=?)", (PAGE_ID,))
db.execute("DELETE FROM trip_day_spots   WHERE day_id  IN (SELECT id FROM trip_days  WHERE page_id=?)", (PAGE_ID,))
db.execute("DELETE FROM trip_days        WHERE page_id=?", (PAGE_ID,))
db.execute("DELETE FROM trip_plan_panels WHERE page_id=?", (PAGE_ID,))
db.execute("DELETE FROM trip_plans       WHERE page_id=?", (PAGE_ID,))
db.execute("DELETE FROM trip_spot_attrs  WHERE spot_id IN (SELECT id FROM trip_spots WHERE page_id=?)", (PAGE_ID,))
db.execute("DELETE FROM trip_spots       WHERE page_id=?", (PAGE_ID,))
db.execute("DELETE FROM trip_location_attrs WHERE location_id IN (SELECT id FROM trip_locations WHERE page_id=?)", (PAGE_ID,))
db.execute("DELETE FROM trip_locations   WHERE page_id=?", (PAGE_ID,))
db.commit()
print("  Done.\n")


# ── 1. LOCATIONS ──────────────────────────────────────────────────────────────
print("Inserting locations …")

locations = [
    # (name, priority, notes, cover_url)
    ("Paris, France", 1,
     "City of lights! Must-do: Eiffel Tower at sunset, Seine River cruise, "
     "world-class cuisine. Book main attractions at least 2 weeks ahead.",
     ""),
    ("Kyoto, Japan", 2,
     "Ancient capital, stunning temples and bamboo groves. "
     "Best during cherry blossom season (late March – early April). "
     "Get an IC card for trains.",
     ""),
    ("Bali, Indonesia", 3,
     "Lush rice terraces, temple culture, surf-ready beaches. "
     "May–September is dry season — ideal for beach + outdoor activities.",
     ""),
]

loc_ids = {}
for idx, (name, priority, notes, cover_url) in enumerate(locations):
    cur = db.execute(
        "INSERT INTO trip_locations (page_id, user_id, name, priority, notes, cover_url, sort_order)"
        " VALUES (?,?,?,?,?,?,?)",
        (PAGE_ID, USER_ID, name, priority, notes, cover_url, idx * 10)
    )
    loc_ids[name.split(',')[0]] = cur.lastrowid  # key by city

db.commit()
print(f"  {len(locations)} locations → IDs {list(loc_ids.values())}\n")


# ── 1a. LOCATION ATTRS ────────────────────────────────────────────────────────
print("Inserting location attrs …")

loc_attrs = {
    "Paris": [
        ("Est. Budget",   "$2,000 / person"),
        ("Best Season",   "Apr – Oct"),
        ("Language",      "French"),
        ("Currency",      "EUR (€)"),
        ("Visa",          "Schengen (90 days)"),
        ("Flight (approx)", "~14 hrs from Dallas"),
    ],
    "Kyoto": [
        ("Est. Budget",   "$1,500 / person"),
        ("Best Season",   "Mar – May, Oct – Nov"),
        ("Language",      "Japanese"),
        ("Currency",      "JPY (¥)"),
        ("Visa",          "Visa-free (90 days, US passport)"),
        ("Flight (approx)", "~15 hrs from Dallas"),
        ("IC Card",       "Get Suica / PASMO at airport"),
    ],
    "Bali": [
        ("Est. Budget",   "$800 / person"),
        ("Best Season",   "May – Sep"),
        ("Language",      "Indonesian / Balinese"),
        ("Currency",      "IDR (Rp)"),
        ("Visa",          "Visa on Arrival (30 days)"),
        ("Flight (approx)", "~22 hrs from Dallas"),
    ],
}

for city, attrs in loc_attrs.items():
    loc_id = loc_ids[city]
    for sort, (key, val) in enumerate(attrs):
        db.execute(
            "INSERT INTO trip_location_attrs (location_id, attr_key, attr_value, sort_order)"
            " VALUES (?,?,?,?)",
            (loc_id, key, val, sort * 10)
        )

db.commit()
print("  Done.\n")


# ── 2. SPOTS ──────────────────────────────────────────────────────────────────
print("Inserting spots …")

# spot_type options (from the app): attraction | restaurant | hotel | activity | other
spots_data = [
    # Paris spots
    ("Eiffel Tower",       "attraction", "Paris", 1,  0.0,   "USD",
     "Iconic iron lattice tower — go at golden hour for the best light. "
     "Book skip-the-line tickets online! Summit access is worth it.",
     "https://maps.google.com/?q=Eiffel+Tower+Paris"),
    ("Louvre Museum",      "attraction", "Paris", 1,  0.0,   "USD",
     "World's largest art museum. Allow at least 4 hrs. "
     "Wednesday & Friday open until 21:45. Download the app for the audio guide.",
     "https://maps.google.com/?q=Louvre+Museum+Paris"),
    ("Palace of Versailles","attraction","Paris", 2,  27.0,  "EUR",
     "Day trip from Paris — 40 min by RER C train. "
     "Book the full estate pass. Garden shows are spectacular in summer.",
     "https://maps.google.com/?q=Palace+of+Versailles"),
    ("Café de Flore",      "restaurant", "Paris", 2,  35.0,  "EUR",
     "Historic Left Bank café — Sartre & Picasso used to hang here. "
     "Go for a café au lait and croissant in the morning.",
     "https://maps.google.com/?q=Cafe+de+Flore+Paris"),
    ("L'Ami Louis",        "restaurant", "Paris", 1,  120.0, "EUR",
     "Old-school Parisian bistro, legendary roast chicken. "
     "Reserve at least 2 weeks ahead — this place fills fast.",
     "https://maps.google.com/?q=L+Ami+Louis+Paris"),
    ("Hôtel Le Marais",    "hotel",      "Paris", 1,  280.0, "EUR",
     "Boutique hotel in the heart of Le Marais — perfect walkable location. "
     "Ask for a room facing the courtyard for a quieter sleep.",
     "https://maps.google.com/?q=Le+Marais+Paris"),

    # Kyoto spots
    ("Fushimi Inari Taisha","attraction","Kyoto", 1,  0.0,   "USD",
     "10,000 vermilion torii gates winding up Mt. Inari. "
     "Go at 6 AM to beat the crowds. Full hike is ~4 hrs round trip.",
     "https://maps.google.com/?q=Fushimi+Inari+Taisha"),
    ("Arashiyama Bamboo Grove","attraction","Kyoto",1, 0.0,  "USD",
     "Towering bamboo forest — serene in the early morning. "
     "Combine with the Tenryu-ji temple garden next door.",
     "https://maps.google.com/?q=Arashiyama+Bamboo+Grove+Kyoto"),
    ("Kinkaku-ji (Golden Pavilion)","attraction","Kyoto",1,500.0,"JPY",
     "Three-story Zen temple covered in gold leaf — stunning reflection pool. "
     "One of the most visited sites in Japan. Morning = fewer crowds.",
     "https://maps.google.com/?q=Kinkaku-ji+Kyoto"),
    ("Nishiki Market",     "restaurant", "Kyoto", 2,  20.0,  "USD",
     "5-block covered market — 'Kyoto's Kitchen'. "
     "Try yuba (tofu skin), matcha mochi, and fresh dashi. "
     "Most stalls close by 6 PM.",
     "https://maps.google.com/?q=Nishiki+Market+Kyoto"),
    ("Kikunoi Honten",     "restaurant", "Kyoto", 1,  180.0, "USD",
     "Three-Michelin-star kaiseki restaurant. "
     "Seasonal 8-course menu — book months in advance for cherry blossom season.",
     "https://maps.google.com/?q=Kikunoi+Honten+Kyoto"),
    ("Ryokan Hiiragiya",   "hotel",      "Kyoto", 1,  450.0, "USD",
     "240-year-old traditional inn in the heart of Kyoto. "
     "Includes in-room kaiseki dinner and onsen bath. Pure bucket-list stuff.",
     "https://maps.google.com/?q=Ryokan+Hiiragiya+Kyoto"),

    # Bali spots
    ("Tanah Lot Temple",   "attraction", "Bali",  1,  60000.0,"IDR",
     "Sea temple perched on a rock formation — incredible at sunset. "
     "Arrive 1 hr before sunset to get a good spot.",
     "https://maps.google.com/?q=Tanah+Lot+Bali"),
    ("Tegallalang Rice Terraces","attraction","Bali",2, 0.0,  "USD",
     "Gorgeous stepped rice terraces north of Ubud. "
     "Swing experience available for stunning photos. "
     "Bring cash — small donation requested at entry.",
     "https://maps.google.com/?q=Tegallalang+Rice+Terraces+Bali"),
    ("Locavore",           "restaurant", "Bali",  1,  85.0,  "USD",
     "Best restaurant in Southeast Asia (several years running). "
     "Farm-to-table tasting menu. Book 2–3 months in advance — no joke.",
     "https://maps.google.com/?q=Locavore+Ubud+Bali"),
    ("Warung Babi Guling", "restaurant", "Bali",  2,  5.0,   "USD",
     "Legendary suckling pig warung in Ubud. "
     "Get there by 11 AM — they sell out. Cash only.",
     "https://maps.google.com/?q=Warung+Babi+Guling+Ubud"),
    ("Four Seasons Bali Sayan","hotel", "Bali",   1,  750.0, "USD",
     "Jaw-dropping resort above the Ayung River in the jungle. "
     "Infinity pool, in-villa breakfast, daily yoga. Total splurge — worth it.",
     "https://maps.google.com/?q=Four+Seasons+Bali+Sayan"),
]

spot_ids = {}
for idx, (name, stype, city, priority, cost, currency, notes, map_url) in enumerate(spots_data):
    loc_id = loc_ids.get(city)
    cur = db.execute(
        "INSERT INTO trip_spots "
        "(page_id, user_id, location_id, name, spot_type, cover_url, map_url,"
        " notes, priority, estimated_cost, currency, sort_order)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (PAGE_ID, USER_ID, loc_id, name, stype, "", map_url,
         notes, priority, cost, currency, idx * 10)
    )
    spot_ids[name] = cur.lastrowid

db.commit()
print(f"  {len(spots_data)} spots inserted.\n")


# ── 2a. SPOT ATTRS ────────────────────────────────────────────────────────────
print("Inserting spot attrs …")

spot_attrs = {
    "Eiffel Tower": [
        ("Hours",       "9:00 AM – 12:45 AM"),
        ("Ticket",      "€29.40 (summit)"),
        ("Book Ahead",  "Yes — sells out weeks in advance"),
        ("Tip",         "Go 30 min before sunset for golden hour"),
    ],
    "Louvre Museum": [
        ("Hours",       "9:00 AM – 6:00 PM (Fri to 9:45 PM)"),
        ("Ticket",      "€22"),
        ("Closed",      "Tuesdays"),
        ("Tip",         "Enter via Richelieu wing to skip the pyramid line"),
    ],
    "Fushimi Inari Taisha": [
        ("Hours",       "24/7 (gates open all day)"),
        ("Cost",        "Free"),
        ("Hike Time",   "~4 hrs full loop"),
        ("Best Time",   "5:30 – 7:30 AM"),
    ],
    "Ryokan Hiiragiya": [
        ("Check-in",    "3:00 PM"),
        ("Includes",    "Kaiseki dinner + breakfast"),
        ("Onsen",       "Yes — indoor + outdoor"),
        ("Dress Code",  "Yukata provided"),
    ],
    "Four Seasons Bali Sayan": [
        ("Check-in",    "3:00 PM"),
        ("Pool",        "Infinity pool + river pool"),
        ("Included",    "Yoga, cultural activities, shuttle to Ubud"),
        ("Tip",         "Book the tree-house villa"),
    ],
}

for spot_name, attrs in spot_attrs.items():
    sid = spot_ids.get(spot_name)
    if not sid:
        continue
    for sort, (key, val) in enumerate(attrs):
        db.execute(
            "INSERT INTO trip_spot_attrs (spot_id, attr_key, attr_value, sort_order)"
            " VALUES (?,?,?,?)",
            (sid, key, val, sort * 10)
        )

db.commit()
print("  Done.\n")


# ── 3. PLANS ──────────────────────────────────────────────────────────────────
print("Inserting plans …")

plans = [
    # (plan_name, plan_desc, start_date, end_date)
    ("Paris Long Weekend",
     "5 days in the City of Lights — art, food, and the Eiffel Tower at golden hour. "
     "Flying into CDG, staying in Le Marais.",
     "2026-09-10", "2026-09-14"),
    ("Japan Cherry Blossom",
     "8-day adventure through Tokyo and Kyoto during peak sakura season. "
     "JR Pass recommended — book before departing.",
     "2027-03-25", "2027-04-01"),
]

plan_ids = {}
for idx, (pname, pdesc, start, end) in enumerate(plans):
    cur = db.execute(
        "INSERT INTO trip_plans (page_id, user_id, plan_name, plan_desc,"
        " start_date, end_date, sort_order, cover_url)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (PAGE_ID, USER_ID, pname, pdesc, start, end, idx * 10, "")
    )
    plan_ids[pname] = cur.lastrowid

db.commit()
print(f"  {len(plans)} plans → IDs {list(plan_ids.values())}\n")


# ── 4. DAYS ───────────────────────────────────────────────────────────────────
print("Inserting days …")

paris_plan = plan_ids["Paris Long Weekend"]
japan_plan = plan_ids["Japan Cherry Blossom"]

# (plan_id, day_label, day_date)
days_data = [
    (paris_plan, "Day 1 — Arrival & Eiffel Tower",   "2026-09-10"),
    (paris_plan, "Day 2 — Louvre & Left Bank",        "2026-09-11"),
    (paris_plan, "Day 3 — Versailles Day Trip",       "2026-09-12"),
    (paris_plan, "Day 4 — Montmartre & Markets",      "2026-09-13"),
    (paris_plan, "Day 5 — Departure",                 "2026-09-14"),
    (japan_plan, "Day 1 — Tokyo Arrival",             "2027-03-25"),
    (japan_plan, "Day 2 — Tokyo Sightseeing",         "2027-03-26"),
    (japan_plan, "Day 3 — Shinkansen to Kyoto",       "2027-03-27"),
    (japan_plan, "Day 4 — Fushimi Inari & Nishiki",   "2027-03-28"),
    (japan_plan, "Day 5 — Arashiyama & Golden Temple","2027-03-29"),
    (japan_plan, "Day 6 — Tea Ceremony & Gion",       "2027-03-30"),
    (japan_plan, "Day 7 — Osaka Day Trip",            "2027-03-31"),
    (japan_plan, "Day 8 — Departure from KIX",        "2027-04-01"),
]

day_ids = {}
for sort_idx, (plan_id, label, date) in enumerate(days_data):
    cur = db.execute(
        "INSERT INTO trip_days (page_id, user_id, plan_id, day_label, day_date, sort_order)"
        " VALUES (?,?,?,?,?,?)",
        (PAGE_ID, USER_ID, plan_id, label, date, sort_idx * 10)
    )
    day_ids[(plan_id, label)] = cur.lastrowid

db.commit()
print(f"  {len(days_data)} days inserted.\n")


# ── 5. DAY → SPOT assignments ─────────────────────────────────────────────────
print("Assigning spots to days …")

def day(plan_id, label):
    return day_ids[(plan_id, label)]

def spot(name):
    return spot_ids.get(name)

day_spots = [
    # Paris Day 1
    (day(paris_plan,"Day 1 — Arrival & Eiffel Tower"),  spot("Hôtel Le Marais"),       "15:00", 0),
    (day(paris_plan,"Day 1 — Arrival & Eiffel Tower"),  spot("Eiffel Tower"),           "19:30", 10),
    # Paris Day 2
    (day(paris_plan,"Day 2 — Louvre & Left Bank"),      spot("Louvre Museum"),          "09:00", 0),
    (day(paris_plan,"Day 2 — Louvre & Left Bank"),      spot("Café de Flore"),          "14:00", 10),
    (day(paris_plan,"Day 2 — Louvre & Left Bank"),      spot("L'Ami Louis"),            "20:00", 20),
    # Paris Day 3
    (day(paris_plan,"Day 3 — Versailles Day Trip"),     spot("Palace of Versailles"),   "09:30", 0),
    # Paris Day 4
    (day(paris_plan,"Day 4 — Montmartre & Markets"),    spot("Café de Flore"),          "09:00", 0),
    # Kyoto Day 4
    (day(japan_plan,"Day 4 — Fushimi Inari & Nishiki"), spot("Fushimi Inari Taisha"),   "06:00", 0),
    (day(japan_plan,"Day 4 — Fushimi Inari & Nishiki"), spot("Nishiki Market"),         "12:00", 10),
    (day(japan_plan,"Day 4 — Fushimi Inari & Nishiki"), spot("Kikunoi Honten"),         "19:00", 20),
    # Kyoto Day 5
    (day(japan_plan,"Day 5 — Arashiyama & Golden Temple"), spot("Arashiyama Bamboo Grove"), "08:00", 0),
    (day(japan_plan,"Day 5 — Arashiyama & Golden Temple"), spot("Kinkaku-ji (Golden Pavilion)"), "13:00", 10),
    # Kyoto Day 3 (arrival)
    (day(japan_plan,"Day 3 — Shinkansen to Kyoto"),     spot("Ryokan Hiiragiya"),       "15:00", 0),
]

for (did, sid, time_lbl, sort) in day_spots:
    if did and sid:
        db.execute(
            "INSERT INTO trip_day_spots (day_id, spot_id, time_label, sort_order)"
            " VALUES (?,?,?,?)",
            (did, sid, time_lbl, sort)
        )

db.commit()
print(f"  {len(day_spots)} day-spot assignments done.\n")


# ── 6. DAY BLOCKS (notes within a day) ───────────────────────────────────────
print("Inserting day blocks …")

# block_type: 'note' | 'divider' | 'checklist'
day_blocks = [
    (day(paris_plan,"Day 1 — Arrival & Eiffel Tower"), "note", 0, "",
     "🛬 **Arrival tips:** CDG Terminal 2 → RER B train to city (35 min, €12.10). "
     "Get a Navigo Semaine pass if you're staying 5+ days — covers all zones!"),
    (day(paris_plan,"Day 1 — Arrival & Eiffel Tower"), "note", 10, "19:30",
     "🗼 **Eiffel Tower:** Pre-booked summit tickets. Meet at Champ de Mars lawn at "
     "19:00 for a golden-hour picnic before heading up. Grab wine from a nearby Monoprix."),
    (day(paris_plan,"Day 2 — Louvre & Left Bank"), "note", 0, "09:00",
     "🖼️ **Louvre strategy:** Enter via the Richelieu wing (shorter queue). "
     "Head straight to Denon Wing, Level 1 for the Mona Lisa early. "
     "Download the free Louvre app for room-by-room audio guides."),
    (day(paris_plan,"Day 2 — Louvre & Left Bank"), "note", 10, "13:30",
     "🥐 **Lunch break:** Duck into any *boulangerie* near the Seine — "
     "a jambon-beurre sandwich and a pain au chocolat is the perfect French lunch (€5 total)."),
    (day(paris_plan,"Day 3 — Versailles Day Trip"), "note", 0, "08:00",
     "🚂 **Getting there:** RER C from Musée d'Orsay (St-Michel direction → "
     "Versailles-Château-Rive Gauche stop). ~40 min. Train runs every 15 min."),
    (day(paris_plan,"Day 3 — Versailles Day Trip"), "note", 10, "09:30",
     "👑 **Palace tips:** The Hall of Mirrors is packed by 11 AM — head there first. "
     "The Grand Trianon and Marie-Antoinette's estate are far less crowded and equally stunning."),
    (day(japan_plan,"Day 1 — Tokyo Arrival"), "note", 0, "",
     "🛬 **Narita → Tokyo:** Narita Express (N'EX) is the easiest — ¥3,070, ~60 min to Shinjuku. "
     "Pick up your JR Pass at the airport before heading into the city!"),
    (day(japan_plan,"Day 3 — Shinkansen to Kyoto"), "note", 0, "09:00",
     "🚄 **Shinkansen:** Tokyo Station → Kyoto (~2 hrs 15 min on Nozomi/Hikari). "
     "Covered by JR Pass (Hikari only — Nozomi costs extra). "
     "Book seats in advance — reserved seating is free with JR Pass."),
    (day(japan_plan,"Day 4 — Fushimi Inari & Nishiki"), "note", 0, "05:45",
     "⛩️ **Fushimi Inari:** Leave the ryokan no later than 5:45 AM. "
     "20 min by JR Nara Line (Inari Station). The lower gates are empty at dawn — "
     "it transforms into a river of people by 9 AM."),
    (day(japan_plan,"Day 6 — Tea Ceremony & Gion"), "note", 0, "10:00",
     "🍵 **Tea ceremony:** Booked at Camellia Tea Ceremony (10 AM). "
     "English-speaking host, very relaxed. ¥2,000/person. ~45 min. "
     "Walk to Gion afterward — geiko (geisha) can sometimes be spotted near "
     "Hanamikoji Street around 5–6 PM."),
]

for (did, btype, order_idx, time_lbl, content) in day_blocks:
    db.execute(
        "INSERT INTO trip_day_blocks (day_id, block_type, order_idx, time_label, content)"
        " VALUES (?,?,?,?,?)",
        (did, btype, order_idx, time_lbl, content)
    )

db.commit()
print(f"  {len(day_blocks)} day blocks inserted.\n")


# ── 7. TRIP PLAN PANELS ───────────────────────────────────────────────────────
print("Inserting plan panels …")

# panel_type: 'note' | 'settle' | 'checklist' | etc.
panels = [
    (paris_plan, "note", "Paris Packing List",
     "## Essentials\n"
     "- [ ] Passport (+ photocopy stored separately)\n"
     "- [ ] Euros — get ~€200 cash at home, rest from ATM\n"
     "- [ ] Plug adapter (Type E — round 2-pin)\n"
     "- [ ] Comfortable walking shoes — you'll walk 10+ miles/day\n"
     "- [ ] Lightweight scarf (for church visits + breezy evenings)\n\n"
     "## Apps to Download\n"
     "- **Citymapper** — best for Paris transit\n"
     "- **Google Translate** — camera mode for menus\n"
     "- **TheFork** — restaurant reservations\n"
     "- **Louvre Official App** — audio guides by room\n\n"
     "## Useful Phrases\n"
     "- Bonjour! *(Hello!)*\n"
     "- S'il vous plaît *(Please)*\n"
     "- L'addition, s'il vous plaît *(The check, please)*\n"
     "- Parlez-vous anglais? *(Do you speak English?)*",
     0),
    (paris_plan, "note", "Paris Budget Tracker",
     "## Estimated Costs (per person)\n"
     "| Category | Budget |\n"
     "|---|---|\n"
     "| Flights (round trip) | ~$800 |\n"
     "| Hotel (4 nights) | ~$1,120 |\n"
     "| Food & Drink | ~$400 |\n"
     "| Attractions | ~$120 |\n"
     "| Transport (Paris) | ~$50 |\n"
     "| Misc / Shopping | ~$200 |\n"
     "| **Total** | **~$2,690** |\n\n"
     "> 💡 Book flights 3–4 months out and use Google Flights price alerts.",
     10),
    (japan_plan, "note", "Japan Travel Tips",
     "## Money\n"
     "Japan is still largely cash-based. Convenience stores (7-Eleven, FamilyMart) "
     "have ATMs that accept foreign cards. Get ¥50,000–¥80,000 cash total.\n\n"
     "## IC Card (Must Have!)\n"
     "Get a **Suica** or **PASMO** card at Narita airport. Tap on/off for all "
     "trains, buses, and convenience store purchases. Load it with ¥5,000 to start.\n\n"
     "## JR Pass\n"
     "Buy online BEFORE you leave — must be purchased outside Japan. "
     "7-day pass (~$350) covers Tokyo → Kyoto bullet train both ways + all JR lines.\n\n"
     "## Etiquette\n"
     "- No eating while walking\n"
     "- Bow slightly when greeting\n"
     "- Trash cans are rare — carry a small bag\n"
     "- Both hands when giving/receiving business cards\n"
     "- Quiet in trains (no phone calls)\n\n"
     "## Must-Try Foods\n"
     "Ramen · Takoyaki · Taiyaki · Matcha everything · Convenience store onigiri "
     "(seriously, 7-Eleven Japan slaps) · Wagyu beef · Kaiseki",
     0),
    (japan_plan, "note", "Japan Budget Tracker",
     "## Estimated Costs (per person)\n"
     "| Category | Budget |\n"
     "|---|---|\n"
     "| Flights (round trip) | ~$900 |\n"
     "| JR Pass (7-day) | ~$350 |\n"
     "| Ryokan Hiiragiya (3 nights) | ~$1,350 |\n"
     "| Tokyo hotel (4 nights) | ~$600 |\n"
     "| Food & Drink | ~$500 |\n"
     "| Attractions | ~$80 |\n"
     "| IC Card / local transport | ~$80 |\n"
     "| Misc / Shopping / Gifts | ~$300 |\n"
     "| **Total** | **~$4,160** |\n\n"
     "> 🌸 Cherry blossom season is the most expensive time to visit. "
     "Book everything 4–6 months out — ryokans sell out first.",
     10),
]

for (plan_id, ptype, title, content, sort) in panels:
    db.execute(
        "INSERT INTO trip_plan_panels (page_id, user_id, plan_id, panel_type,"
        " title, content, sort_order)"
        " VALUES (?,?,?,?,?,?,?)",
        (PAGE_ID, USER_ID, plan_id, ptype, title, content, sort)
    )

db.commit()
print(f"  {len(panels)} panels inserted.\n")


# ── Summary ───────────────────────────────────────────────────────────────────
print("=" * 56)
print("Seed complete! Summary:")
print(f"  Trip page : id={PAGE_ID} ('The Next trip') — user {USER_ID}")
print(f"  Locations : {db.execute('SELECT COUNT(*) FROM trip_locations WHERE page_id=?',(PAGE_ID,)).fetchone()[0]}")
print(f"  Spots     : {db.execute('SELECT COUNT(*) FROM trip_spots WHERE page_id=?',(PAGE_ID,)).fetchone()[0]}")
print(f"  Plans     : {db.execute('SELECT COUNT(*) FROM trip_plans WHERE page_id=?',(PAGE_ID,)).fetchone()[0]}")
print(f"  Days      : {db.execute('SELECT COUNT(*) FROM trip_days WHERE page_id=?',(PAGE_ID,)).fetchone()[0]}")
print(f"  Day spots : {len(day_spots)}")
print(f"  Day blocks: {db.execute('SELECT COUNT(*) FROM trip_day_blocks WHERE day_id IN (SELECT id FROM trip_days WHERE page_id=?)',(PAGE_ID,)).fetchone()[0]}")
print(f"  Panels    : {db.execute('SELECT COUNT(*) FROM trip_plan_panels WHERE page_id=?',(PAGE_ID,)).fetchone()[0]}")
print("=" * 56)
print("\nOpen http://localhost:8000 → log in as t0n003c → open 'The Next trip' page 🗺️")

db.close()
