// RFC-4180-style CSV parser: quoted commas, escaped quotes and newlines are supported.
export function parseCSV(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
    if(quoted){if(c==='"'&&n==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;}else{cell+=c;}}
    else if(c==='"'&&cell===""){quoted=true;}
    else if(c===","){row.push(cell);cell="";}
    else if(c==="\n"){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
    else{cell+=c;}
  }
  if(cell.length||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}
  if(!rows.length)return [];
  const headers=rows.shift().map(h=>h.trim());
  return rows.filter(r=>r.some(v=>v!=="")).map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]??"").trim()])));
}
export async function loadCSV(url){if(!url||url.includes("REPLACE_WITH"))throw new Error("Configure the published Google Sheets CSV URL in assets/js/config.js.");const res=await fetch(url,{cache:"no-store"});if(!res.ok)throw new Error(`CSV request failed (${res.status}).`);return parseCSV(await res.text());}
export function parseJSON(value,fallback=[]){try{return value?JSON.parse(value):fallback;}catch(e){throw new Error("Invalid JSON in spreadsheet metadata: "+e.message);}}
