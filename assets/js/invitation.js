import {getStoreData,getInvitation} from "./data.js";import {renderInvitation} from "./template-renderer.js";import {getPriceRange, money} from "./pricing.js";
const $ = (s) => document.querySelector(s);
const p=new URLSearchParams(location.search),id=p.get("id");try{const data=await getStoreData(),inv=getInvitation(data,id);if(!inv)throw new Error("This invitation is not available.");document.title=inv.title;document.querySelector("#detailTitle").textContent=inv.title;document.querySelector("#detailDescription").textContent=inv.description;document.querySelectorconst; const range = getPriceRange(inv);

$("#detailPrice").textContent = range
  ? `${money(range.min)}–${money(range.max)} per invitation`
  : "Contact us for pricing";
const priceNote = document.createElement("small");
priceNote.className = "muted";
//priceNote.textContent = "Per-invitation price varies by quantity.";
$("#detailPrice").insertAdjacentElement("afterend", priceNote);
document.querySelector("#detailMeta").innerHTML=[["Occasions",inv.occasions],["Styles",inv.styles],["Formats",inv.formats]].map(([k,v])=>`<p><b>${k}:</b> ${v.map(esc).join(", ")}</p>`).join("");const target=document.querySelector("#detailPages");const rendered=await renderInvitation({invitation:inv,target});target.classList.add("detail-pages");const link=new URL("../customize/",location.href);link.searchParams.set("id",id);if(p.get("occasion"))link.searchParams.set("occasion",p.get("occasion"));if(p.get("style"))link.searchParams.set("style",p.get("style"));document.querySelector("#customizeLink").href=link;const back=new URL("../catalog/",location.href);if(p.get("occasion"))back.searchParams.set("occasion",p.get("occasion"));if(p.get("style"))back.searchParams.set("style",p.get("style"));document.querySelector("#backToCatalog").href=back;}catch(e){document.querySelector("#detailTitle").textContent="Invitation unavailable";document.querySelector("#detailDescription").textContent=e.message;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
