import openpyxl,re,collections,sys,json
FIELDS=[("DEL",0,1),("SNO",1,5),("FCODE",6,3),("FNO",9,5),("PNO",14,6),("ZONE",20,20),("FINANCER",40,40),("BCODE",80,5),("BNAME",85,40),("BFNAME",125,40),("BVCP",165,20),("BTAH",185,20),("BDISTT",205,20),("BSTATE",225,20),("BADD",245,254),("BSMS1",499,1),("BMNO1",500,22),("BSMS2",522,1),("BMNO2",523,11),("GNAME",534,40),("GFNAME",574,40),("GVCP",614,20),("GTAH",634,20),("GDISTT",654,20),("GSTATE",674,20),("GADD",694,254),("GMNO1",948,22),("GMNO2",970,11),("NU",981,4),("SBY",985,5),("MODEL",990,20),("COLOR",1010,10),("CNO",1020,20),("ENO",1040,20),("MAKE",1060,4),("VNO",1064,14),("KNO",1078,10),("ADATE",1088,8),("IEDATE",1096,8),("TMONTHS",1104,4),("PIVAL",1108,2),("FAMT",1110,12),("IAMT",1122,12),("AAMT",1134,12),("HPAMT",1146,12),("TAMT",1158,12),("IRATE",1170,12),("SEZIED",1182,1),("ACTIVE",1183,1)]
R=1184
def mid_ok(m):  # m = text for offsets 499..694 (195 chars)
    return (m[0] in " 01" and m[23] in " 01" and re.fullmatch(r"[\d ]*",m[1:23]) and re.fullmatch(r"[\d ]*",m[24:35])
            and re.fullmatch(r"[A-Za-z0-9 .,/()&'-]*",m[35:195]) is not None)
def run(f):
    ws=openpyxl.load_workbook(f,data_only=True).active
    parts=[str(c) for r in ws.iter_rows(values_only=True) for c in r if c is not None]
    s="\x01".join(parts); i=s.find("ACTIVEN"); data=s[i+9:].lstrip("\x01")
    clean=[];marks=[]
    for ch in data:
        if ch=="\x01": marks.append(len(clean))
        else: clean.append(ch)
    clean="".join(clean)
    END=re.compile(r"(?:\d{8}| {8})(?:\d{8}| {8})[ \d]{4}[ \d]{2}(?:[ \d-]{9}\.\d\d){6}[TF ?][ \d]")
    ends=[m.end() for m in END.finditer(clean)]
    out=[]; stats=collections.Counter()
    for k,(a,b) in enumerate(zip([0]+ends,ends)):
        seg=clean[a:b]; ms=[x-a for x in marks if a<x<b]
        miss=R-len(seg)
        q={"src_index":k+1,"lost_bytes":miss,"split_points":ms}
        if miss==0:
            r=seg; q["recovery"]="exact"
        else:
            # tail from end: offsets 694+254=948.. -> seg[-(236):] reliable; head 0..245 reliable unless markers there
            def valid(x):
                if x<0 or x>miss: return False
                if any(499-x<=p<694-x for p in ms): return False
                if x>254: return False
                return bool(mid_ok(seg[499-x:694-x]))
            bm=[p for p in ms if p<499-miss]; gm=[p for p in ms if p>=694]
            hyp=None
            if ms and len(bm)==len(ms): hyp=miss
            elif ms and len(gm)==len(ms): hyp=0
            if hyp is not None and valid(hyp):
                ok=[hyp]; q["recovery"]="realigned"
            else:
                ok=[x for x in range(miss+1) if valid(x)]
                vals={seg[499-x:694-x] for x in ok}
                if not ok: q["recovery"]="PARTIAL"; ok=[min(miss,254)]; q["unreliable_fields"]="BADD,BSMS1,BMNO1,BSMS2,BMNO2,GNAME,GFNAME,GVCP,GTAH,GDISTT,GSTATE,GADD"
                elif len(vals)>1:
                    def score(x):
                        m=seg[499-x:694-x]
                        return ((m[0] in "01")+(m[1].isdigit())+(m[23] in "01")+(m[24].isdigit() or m[24:35].strip()=="")
                                +(m[35].isalpha())+(m[75].isalpha() or m[75:115].strip()=="")+(m[34]==" ")+(m[22]==" "))
                    sc=sorted(((score(x),x) for x in ok),reverse=True)
                    top=[x for s_,x in sc if s_==sc[0][0]]
                    if len({seg[499-x:694-x] for x in top})==1: ok=top; q["recovery"]="realigned-scored"
                    else: q["recovery"]="AMBIGUOUS"; q["candidates"]=top; ok=top; q["unreliable_fields"]="BSMS1,BMNO1,BSMS2,BMNO2,GNAME,GFNAME"
                else: q["recovery"]="realigned"
            if ok:
                    x=ok[0]; y=miss-x
                    # insert x filler inside BADD (at last BADD marker or BADD end), y inside GADD
                    bm=[p for p in ms if 245<=p<499-x]; gm=[p for p in ms if 694-x<=p<=948-miss]
                    bp = min(bm[-1] if bm else 499-x, 499-x)
                    badd = seg[245:bp]+" "*x+seg[bp:499-x]
                    gp = min((gm[-1] if gm else 948-miss) - (694-x), 948-miss-(694-x))
                    gseg = seg[694-x:948-miss]
                    gadd = gseg[:gp]+" "*y+gseg[gp:]
                    r = seg[:245]+badd+seg[499-x:694-x]+gadd+seg[948-miss:]
                    q["bytes_restored_in"]={"BADD":x,"GADD":y}
                    if any(p<245 or 948-miss<=p for p in ms): q["split_outside_address"]=True; stats["outside"]+=1
        if r is not None:
            assert len(r)==R,(k,len(r))
            q.update({n:r[o:o+l] for n,o,l in FIELDS})
        stats[q["recovery"]]+=1
        out.append(q)
    return out,stats
if __name__ == "__main__":
    for f,o in [("F_ACC(1).xlsx","facc.json"),("P_ACCOUNT(1).xlsx","pacc.json")]:
        out,st=run(f); json.dump(out,open(sys.argv[1]+"/"+o,"w"))
        print(f,len(out),dict(st))
