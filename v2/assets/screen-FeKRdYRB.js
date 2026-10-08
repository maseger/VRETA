let n=null;function t(e){n=e?{...e,at:Date.now()}:null}function l(e=15*6e4){return n&&Date.now()-n.at<e?n:null}export{l as r,t as s};
