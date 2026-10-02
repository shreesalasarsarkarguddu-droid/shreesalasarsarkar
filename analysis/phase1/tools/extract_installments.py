import openpyxl,re,collections,sys,json
AMT=r"(?:[ \d-]{9}\.\d\d| {12})"
MID=re.compile(r"(\d{8}| {8})([^\x01]{5})([^\x01]{12})("+AMT+r")([\s\S]{0,4}?)(\d{8}| {8})("+AMT+r")([ \d-]{5})(\d{8}| {8})([^\x01]{6})([^\x01]{6})(\d{8}| {8})([^\x01]{14})")
def run(f):
    ws=openpyxl.load_workbook(f,data_only=True).active
    parts=[str(c) for r in ws.iter_rows(values_only=True) for c in r if c is not None]
    s="\x01".join(parts); i=s.find("AGAINSTC"); data=s[i+9:].lstrip("\x01")
    ms=list(MID.finditer(data)); prev=0; out=[]; issues=collections.Counter()
    for k,m in enumerate(ms):
        p=data[prev:m.start()]; prev=m.end()
        ag_tail=""
        if k>0:
            ag_tail=p[:6]; p=p[6:]
            if out: out[-1]["AGAINST"]+=ag_tail
        q={"src_index":k+1}
        mm=re.fullmatch(r"([ *])([ \d]{7})(.)([ \d]{7})([\s\S]{0,4})([ \d]{4}\d)("+AMT+")",p)
        if not mm:
            q["parse_issue"]="prefix:"+repr(p); issues["prefix"]+=1
            mm2=re.search(r"([ \d]{4}\d)("+AMT+")$",p)
            if mm2: q["INO"],q["IAMT"]=mm2.groups()
        else:
            q.update(dict(zip(["DEL","SNO","FCODE","FNO","RNO_raw","INO","IAMT"],mm.groups())))
        q.update(dict(zip(["DDATE","BCODE","CHNO","PAMT","IM_raw","PDATE","BAMT","DDAYS","RCPT_DATE","MODE","CK_DD_NO","DATED","AGAINST"],m.groups())))
        out.append(q)
    tail=data[prev:]
    if out: out[-1]["AGAINST"]+=tail[:6]
    return out,issues,tail
if __name__ == "__main__":
    for f,o in [("F_INSMENT(1).xlsx","fins.json"),("P_INSMENT.xlsx","pins.json")]:
        out,iss,tail=run(f)
        json.dump(out,open(sys.argv[1]+"/"+o,"w"))
        print(f,"records",len(out),dict(iss),"tail",repr(tail))
        print("  RNO survivors",collections.Counter(len(x.get("RNO_raw","")) for x in out),"IM survivors",collections.Counter(len(x["IM_raw"]) for x in out))
        print("  FCODE",collections.Counter(x.get("FCODE") for x in out).most_common(8), "DEL",collections.Counter(x.get("DEL") for x in out))
        for x in [x for x in out if "parse_issue" in x][:3]: print("  ",x["parse_issue"])
