"""Port a Next.js server page of the old app to the React app (used once per page while moving them).

The data-loading statement(s) (from `const supabase = await createClient();` to the line before END) run inside a
useQuery; everything before stays (made synchronous), everything after stays as it is.

    python SSS/scripts/port_page.py SRC DST END_MARKER RETURN_NAMES [TITLE_ROOT_CLASS]
"""
import re
import sys

src, dst, end_marker, names = sys.argv[1:5]
s = open(src, encoding="utf-8").read()
title = re.search(r'export const metadata(?:: Metadata)? = \{ title: "([^"]*)" \};', s)
title = title.group(1) if title else None
s = re.sub(r'export const metadata(?:: Metadata)? = \{ title: "([^"]*)" \};\n\n?', "", s)
s = s.replace('import type { Metadata } from "next";\n', "")
s = re.sub(r'import \{ (?:requirePerm|getStaff|requireAdmin) \} from "@/lib/staff";\n', "", s)
s = s.replace('import { notFound, redirect } from "next/navigation";\n', "")
s = s.replace('import { notFound } from "next/navigation";\n', "")
s = 'import { useQuery } from "@tanstack/react-query";\nimport { useSearchParams } from "next/navigation";\nimport { useStaff } from "@/lib/auth";\nimport Loading from "@/app/loading";\n' + s

# signature + guards
s = re.sub(r'export default async function (\w+)\(\{ searchParams \}: PageProps<"[^"]*">\) \{', r'export default function \1() {', s)
s = re.sub(r'export default async function (\w+)\(\) \{', r'export default function \1() {', s)
s = re.sub(r'  const staff = await getStaff\(\);\n  if \(!staff\) notFound\(\);\n  if \([^\n]*\) redirect\(homeFor\(staff\)\);\n', "  const staff = useStaff();\n", s)
s = re.sub(r'  (?:const staff = )?await (?:requirePerm\("[a-z_]+"\)|requireAdmin\(\));\n', "", s)
s = s.replace("  const sp = await searchParams;\n", "")
# every page reads the URL the same way
body = s.index("export default function")
brace = s.index("{\n", body) + 2
s = s[:brace] + '  const search = useSearchParams();\n  const sp = Object.fromEntries(search) as Record<string, string | undefined>;\n  void sp;\n' + s[brace:]
if "const staff = useStaff();" not in s:
    s = s[:brace] + "  const staff = useStaff();\n  void staff;\n" + s[brace:]

a = s.index("  const supabase = await createClient();")
b = s.index(end_marker, a)
load = s[a:b].rstrip("\n")
load = "\n".join("    " + l if l else l for l in load.split("\n"))
block = (
    f'  const page = useQuery({{\n    queryKey: ["page", "{dst}", search.toString()],\n    queryFn: async () => {{\n{load}\n'
    f'      return {{ {names} }};\n    }},\n  }});\n  if (page.isPending) return <Loading />;\n  if (page.error) throw page.error;\n'
    f'  const {{ {names} }} = page.data;\n'
)
s = s[:a] + block + s[b:]
if title:
    s = re.sub(r'(  return \(\n    <div className="[^"]*">)', r'\1\n      <title>' + title + "</title>", s, count=1)
open(dst, "w", encoding="utf-8", newline="").write(s)
print("ported", dst)
