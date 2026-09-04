import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

// Development-only preview. Reads evidence from an existing export if supplied;
// never modifies that report, browser state, or extension records.
const source = await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const listener = { addListener() {} };
const context = vm.createContext({ Blob, fetch, URL, TextEncoder, btoa, chrome: {
  runtime:{onInstalled:listener,onMessage:listener},commands:{onCommand:listener},
  action:{onClicked:listener},tabs:{onRemoved:listener,onUpdated:listener}
}});
vm.runInContext(source.replace(/^import[^\n]+\n/, ''), context);
const oldHtml = process.argv[2] ? await readFile(resolve(process.argv[2]), 'utf8') : '';
const images = [...oldHtml.matchAll(/<img[^>]+src="(data:image\/[^"]+)"/g)].slice(0,2).map(m => m[1]);
const issues = [
  {
    id:'preview-1',displayId:'UI-001',type:'ui',severity:'cosmetic',priority:'queued',
    title:'周期计划投入的内边距偏大',
    description:'周期计划投入的内边距偏大\n收紧上下留白，让数字和标题更紧凑。与相邻统计项保持一致。',
    pageSnapshot:{title:'项目管理平台',route:'/delivery/',url:'https://example.test/delivery/'},
    elementAnchor:{preferredSelector:'article:nth-of-type(1) > b',tag:'b',text:'387.4 h',rect:{width:244.7,height:34.5,x:264,y:347}},
    webSnapshot:{layout:{display:'block'},spacing:{padding:{top:'0px',right:'0px',bottom:'0px',left:'0px'},gap:'normal'},
      typography:{fontFamily:'DM Sans, Microsoft YaHei, sans-serif',fontSize:'23px',lineHeight:'34.5px',fontWeight:'700',color:'rgb(14, 17, 21)'},
      appearance:{backgroundColor:'#ffffff',borderRadius:'0px'}},
    changeProposal:{changes:[{property:'padding',before:'24px 16px',after:'16px'}]}
  },
  {
    id:'preview-2',displayId:'UI-002',type:'content',severity:'degraded',priority:'soon',
    title:'统一空状态文案',description:'没有数据时使用简短说明，并提供清晰的下一步操作。',
    pageSnapshot:{title:'项目管理平台 · 成员列表与工时管理',route:'/delivery/team',url:'https://example.test/delivery/team'},
    elementAnchor:{preferredSelector:'.empty-state',rect:{width:360,height:128,x:0,y:482}}
  }
];
const assets = images.map((dataUrl,index) => ({id:'preview-image-'+index,issueId:'preview-1',kind:index?'detail':'context',dataUrl}));
const html = await context.buildHtmlReport({id:'html-redesign-preview-v1',name:'项目管理平台 · 设计预览'},issues,assets,'2026-09-04T07:12:00Z');
const directory = new URL('../.qa/', import.meta.url);
await mkdir(directory, {recursive:true});
const output = new URL('html-report-redesign.html', directory);
await writeFile(output, html);
console.log(output.pathname);
