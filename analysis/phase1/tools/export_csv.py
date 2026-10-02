import json,csv,sys
S=sys.argv[1]; out=sys.argv[2]
for fn,name in [("facc.json","F_ACC"),("pacc.json","P_ACCOUNT"),("fins.json","F_INSMENT"),("pins.json","P_INSMENT")]:
    o=json.load(open(f"{S}/{fn}"))
    keys=[]
    for r in o:
        for k in r:
            if k not in keys: keys.append(k)
    with open(f"{out}/{name}.csv","w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=keys); w.writeheader()
        for r in o:
            row={}
            for k in keys:
                v=r.get(k,"")
                if isinstance(v,str):
                    if k in("RNO_raw","IM_raw"): v=" ".join(f"{ord(c):02X}" for c in v)
                    else: v=v.replace("\x7f"," ").strip()
                elif isinstance(v,(list,dict)): v=json.dumps(v)
                row[k]=v
            w.writerow(row)
    print(name,len(o))
