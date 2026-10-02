"""Create a login for a staff member (or give an existing login staff access).

Usage (from the project root):
    python scripts/create_staff.py you@example.com "Your Name" admin
The password is asked for interactively and never stored in a file.
"""
import os
import sys
import json
import getpass
import urllib.request
from db_connect import connect, load_env

if len(sys.argv) < 3:
    raise SystemExit(__doc__)
email, name = sys.argv[1].strip().lower(), sys.argv[2].strip()
role = sys.argv[3] if len(sys.argv) > 3 else "staff"
if role not in ("admin", "staff"):
    raise SystemExit("role must be admin or staff")
load_env()

with connect() as conn:
    row = conn.execute("select id from auth.users where lower(email) = %s", (email,)).fetchone()
    if row is None:
        pw = os.environ.get("STAFF_PASSWORD") or getpass.getpass(f"New password for {email} (min 8 chars): ")
        if len(pw) < 8:
            raise SystemExit("password must be at least 8 characters")
        req = urllib.request.Request(
            os.environ["NEXT_PUBLIC_SUPABASE_URL"] + "/auth/v1/admin/users",
            data=json.dumps({"email": email, "password": pw, "email_confirm": True,
                             "user_metadata": {"full_name": name}}).encode(),
            headers={"apikey": os.environ["SUPABASE_SECRET_KEY"],
                     "Authorization": "Bearer " + os.environ["SUPABASE_SECRET_KEY"],
                     "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            user_id = json.load(resp)["id"]
        print("login created")
    else:
        user_id = row[0]
    conn.execute(
        "insert into public.staff (user_id, full_name, role) values (%s, %s, %s)"
        " on conflict (user_id) do update set full_name = excluded.full_name, role = excluded.role",
        (user_id, name, role),
    )
    print(f"{email} is now {role}")
