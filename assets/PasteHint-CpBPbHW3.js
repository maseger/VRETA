import{c as i,u as y,j as n}from"./index-BWDt-KCv.js";import{C as b}from"./share-2-C4gTnH42.js";/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p={name:"chevron-down",size:24,node:[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]};p.node;const j=i(p);/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m={name:"clipboard-paste",size:24,node:[["path",{d:"M11 14h10",key:"1w8e9d"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v1.344",key:"1e62lh"}],["path",{d:"m17 18 4-4-4-4",key:"z2g111"}],["path",{d:"M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113",key:"bjbb7m"}],["rect",{x:"8",y:"2",width:"8",height:"4",rx:"1",key:"ublpy"}]]};m.node;const k=i(m);/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h={name:"shield-check",size:24,node:[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]};h.node;const v=i(h);/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};u.node;const C=i(u);function x(t){var r;if(!t)return Promise.resolve(!1);const o=()=>{try{const e=document.createElement("textarea");e.value=t,e.setAttribute("readonly",""),e.style.position="fixed",e.style.opacity="0",document.body.appendChild(e),e.select();const s=document.execCommand("copy");return e.remove(),s}catch{return!1}};return(r=navigator.clipboard)!=null&&r.writeText?navigator.clipboard.writeText(t).then(()=>!0,()=>o()):Promise.resolve(o())}const w=new Set(["facebook","instagram"]);async function z(t,o,r){var l;const e=r??x(t),s=o.map(a=>new File([a.blob],a.name,{type:"image/jpeg"})),d=s.length?{text:t,files:s}:{text:t};if(navigator.share&&(!s.length||(l=navigator.canShare)!=null&&l.call(navigator,d)))try{return await navigator.share(d),{outcome:"shared",textCopied:await e}}catch(a){if(a instanceof DOMException&&a.name==="AbortError")return{outcome:"cancelled",textCopied:await e}}for(const a of s){const c=document.createElement("a");c.href=URL.createObjectURL(a),c.download=a.name,c.click()}return{outcome:"copied",textCopied:await e}}function _({text:t,where:o,copied:r}){const{toast:e}=y();return n.jsxs("div",{className:"card mb-3 border-linolja/40 bg-linolja-pale/40 p-4",role:"status",children:[n.jsxs("p",{className:"mb-1 flex items-center gap-2 font-semibold",children:[n.jsx(k,{size:18,className:"text-linolja","aria-hidden":"true"})," Klistra in texten i ",o]}),n.jsxs("p",{className:"mb-3 text-sm text-sot-2",children:[o," tar bara med bilderna, inte texten. ",r?"Texten är kopierad – ":"Kopiera texten och ","tryck länge i textrutan i inlägget och välj ",n.jsx("strong",{children:"Klistra in"}),"."]}),n.jsxs("button",{type:"button",className:"btn-secondary text-sm",onClick:async()=>e(await x(t)?"Texten är kopierad":"Kunde inte kopiera – markera texten ovan och kopiera"),children:[n.jsx(b,{size:16,"aria-hidden":"true"})," ",r?"Kopiera texten igen":"Kopiera texten"]})]})}function D({where:t}){return n.jsxs("p",{className:"mt-2 text-center text-[12px] text-sot-3",children:[t," tar bara med bilderna – texten kopieras så att du kan klistra in den i inlägget."]})}export{j as C,w as D,_ as P,v as S,C as T,D as a,x as c,z as s};
