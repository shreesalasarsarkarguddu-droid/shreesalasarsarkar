# shreesalasarsarkar

Finance management system for Shree Salasar Sarkar (Next.js + Supabase).

## Legacy data

The old software's tables (F_ACC, P_ACCOUNT, F_INSMENT, P_INSMENT) are FoxPro DBF files
that were dumped into `.xlsx` as raw text. They are reconstructed by the scripts in
`analysis/phase1/tools/`. The source files and reconstructed CSVs contain customer
personal data and are **not** committed to git.
