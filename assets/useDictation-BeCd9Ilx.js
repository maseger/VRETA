import{c as d}from"./index-BWDt-KCv.js";import{r as i}from"./react-DzM-vIyI.js";/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p={name:"mic-off",size:24,node:[["path",{d:"M12 19v3",key:"npa21l"}],["path",{d:"M15 9.34V5a3 3 0 0 0-5.68-1.33",key:"1gzdoj"}],["path",{d:"M16.95 16.95A7 7 0 0 1 5 12v-2",key:"cqa7eg"}],["path",{d:"M18.89 13.23A7 7 0 0 0 19 12v-2",key:"16hl24"}],["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M9 9v3a3 3 0 0 0 5.12 2.12",key:"r2i35w"}]]};p.node;const y=d(p);/**
 * @license lucide-react v1.52.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f={name:"mic",size:24,node:[["path",{d:"M12 19v3",key:"npa21l"}],["path",{d:"M19 10v2a7 7 0 0 1-14 0v-2",key:"1vc78b"}],["rect",{x:"9",y:"2",width:"6",height:"13",rx:"3",key:"s6n7sd"}]]};f.node;const M=d(f);function v(c){const[s,o]=i.useState(!1),l=i.useRef(null),e=window.SpeechRecognition??window.webkitSpeechRecognition,h=!!e,g=i.useCallback(()=>{var u;if(!e)return;if(s){(u=l.current)==null||u.stop();return}const t=new e;t.lang="sv-SE",t.continuous=!0,t.interimResults=!1,t.onresult=r=>{let a="";for(let n=0;n<r.results.length;n++)r.results[n].isFinal&&(a+=r.results[n][0].transcript);a&&c(a.trim())},t.onend=()=>o(!1),t.onerror=()=>o(!1),l.current=t,t.start(),o(!0)},[e,s,c]);return{supported:h,listening:s,toggle:g}}export{y as M,M as a,v as u};
