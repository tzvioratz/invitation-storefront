// Field definitions live in HTML/SVG data-field attributes, never in the catalog sheet.
export function discoverFields(pageElements){const registry=new Map();pageElements.forEach(({page,element}, index)=>{element.querySelectorAll("[data-field]").forEach(node=>{const id=node.getAttribute("data-field");if(!id||!/^[A-Za-z0-9_-]{1,80}$/.test(id))return;const existing=registry.get(id);const field={id,label:node.getAttribute("data-label")||humanize(id),defaultValue:node.textContent||"",required:node.getAttribute("data-required")==="true",placeholder:node.getAttribute("data-placeholder")||"",maxLength:Number(node.getAttribute("data-maxlength"))||500,multiline:node.getAttribute("data-multiline")==="true",pageIndex:index,pageLabel:page.label};if(existing){existing.occurrences.push({pageIndex:index,node});}else{registry.set(id,{...field,occurrences:[{pageIndex:index,node}]});}});});return [...registry.values()];}
function humanize(s){return s.replace(/[_-]/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\b\w/g,c=>c.toUpperCase());}
export function setFieldValue(node, value) {
    const safe = String(value ?? "");
    const SVG_NS = "http://www.w3.org/2000/svg";

    if (node.namespaceURI !== SVG_NS) {
        node.textContent = safe;
        return;
    }

    // Inline field inside a larger <text> line: just replace the text.
    // No newlines, no x/dy, so the surrounding label/suffix stay in the same chunk.
    if (node.localName === "tspan") {
        node.textContent = safe.replace(/\n/g, " ");
        return;
    }

    // Whole <text> element: supports multi-line values.
    while (node.firstChild) node.removeChild(node.firstChild);

    const x = node.getAttribute("x");
    safe.split(/\n/).forEach((line, i) => {
        const t = document.createElementNS(SVG_NS, "tspan");
        if (x !== null) t.setAttribute("x", x);
        if (i) t.setAttribute("dy", "1.2em");
        t.textContent = line;
        node.appendChild(t);
    });
}export function applyWording(fields,values){fields.forEach(f=>f.occurrences.forEach(o=>setFieldValue(o.node,values[f.id]??f.defaultValue??"")));}
