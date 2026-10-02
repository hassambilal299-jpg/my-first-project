import { createServer } from "http";
const BAD = `<!doctype html><html><head><title>Home</title></head>
<body><div style="width:1200px"><h1>Welcome</h1><h1>Services</h1>
<img src="/a.jpg"><img src="/b.jpg"><img src="/c.jpg">
<p>We do plumbing in Austin. Been in business 20 years.</p></div></body></html>`;
createServer((q,s)=>{s.writeHead(200,{"Content-Type":"text/html"});s.end(BAD);}).listen(4030,()=>console.log("fixture on 4030"));
