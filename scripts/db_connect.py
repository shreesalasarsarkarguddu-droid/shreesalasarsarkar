"""Shared helper: open a Postgres connection to the Supabase project using .env.local."""
import os, pathlib, psycopg

REF = "gwfnneimgyvkftsjruxz"
REGIONS = ["ap-south-1", "ap-southeast-1", "ap-northeast-1", "ap-northeast-2", "ap-southeast-2",
           "us-east-1", "us-east-2", "us-west-1", "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3",
           "ca-central-1", "sa-east-1", "eu-north-1", "eu-central-2"]

def load_env():
    for line in pathlib.Path(__file__).resolve().parent.parent.joinpath(".env.local").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

def candidates():
    pw = os.environ["SUPABASE_DB_PASSWORD"]
    if os.environ.get("SUPABASE_DB_HOST"):
        yield dict(host=os.environ["SUPABASE_DB_HOST"], port=5432, user=os.environ.get("SUPABASE_DB_USER", f"postgres.{REF}"), password=pw)
        return
    yield dict(host=f"db.{REF}.supabase.co", port=5432, user="postgres", password=pw)
    for pre in ("aws-0", "aws-1"):
        for r in REGIONS:
            yield dict(host=f"{pre}-{r}.pooler.supabase.com", port=5432, user=f"postgres.{REF}", password=pw)

def connect(verbose=False):
    load_env()
    last = None
    for c in candidates():
        try:
            conn = psycopg.connect(dbname="postgres", connect_timeout=6, sslmode="require", **c)
            if verbose:
                print("connected via", c["host"])
            return conn
        except Exception as e:
            last = e
            if verbose:
                print("  no:", c["host"], str(e).splitlines()[0][:90])
    raise RuntimeError(f"could not connect: {last}")

if __name__ == "__main__":
    with connect(verbose=True) as conn:
        print(conn.execute("select version()").fetchone()[0])
