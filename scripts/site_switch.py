"""The whole Next.js site on / off from this computer (when nobody can sign in at /power), or make the power admin.

Usage (from the project root):
    python scripts/site_switch.py status
    python scripts/site_switch.py on
    python scripts/site_switch.py off "Back at 6 PM"
    python scripts/site_switch.py poweradmin you@example.com
The power admin must be a login already (python scripts/create_staff.py you@example.com "Name" admin).
"""
import sys
from db_connect import connect

cmd = sys.argv[1] if len(sys.argv) > 1 else ""
with connect() as conn:
    if cmd == "status":
        off, msg = conn.execute("select site_off, site_off_message from public.app_settings where id = 1").fetchone()
        print("OFF" if off else "ON", f"({msg})" if off and msg else "")
    elif cmd in ("on", "off"):
        off = cmd == "off"
        msg = sys.argv[2] if off and len(sys.argv) > 2 else None
        conn.execute("update public.app_settings set site_off = %s, site_off_message = %s, site_off_changed_at = now(), site_off_changed_by = null where id = 1",
                     (off, msg))
        conn.execute("select app_private.log(%s, null, null, jsonb_build_object('message', %s::text, 'from', 'server script'))",
                     ("site_off" if off else "site_on", msg))
        conn.commit()
        print("The site is", "OFF" if off else "ON")
    elif cmd == "poweradmin" and len(sys.argv) > 2:
        email = sys.argv[2].strip().lower()
        row = conn.execute("""update public.staff s set is_poweradmin = true, role = 'admin', active = true, archived_at = null
                               from auth.users u where u.id = s.user_id and lower(u.email) = %s returning s.full_name""", (email,)).fetchone()
        conn.commit()
        if row is None:
            raise SystemExit(f"No login {email}. First: python scripts/create_staff.py {email} \"Name\" admin")
        print(f"{row[0]} ({email}) is the power admin. Sign in at /power.")
    else:
        raise SystemExit(__doc__)
