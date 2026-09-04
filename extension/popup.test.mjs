import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile(new URL('./popup.js',import.meta.url),'utf8');
const settle=()=>new Promise(r=>setImmediate(r));
function harness({query=async()=>[{id:3}],send=async()=>({ok:true,enabled:false})}={}) {
  const nodes=new Map();
  for(const key of ['enabledToggle','statusDot','modeDescription','message','retryStatus']) nodes.set(key,{checked:false,disabled:false,hidden:false,textContent:'',events:{},attributes:{},
    classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,v){this.events[k]=v;}});
  const chrome={tabs:{query},runtime:{sendMessage:send}};
  vm.runInNewContext(source,{chrome,document:{getElementById:id=>nodes.get(id)}});
  return {chrome,node:id=>nodes.get(id)};
}
test('初始化状态读取完才允许切换；读取失败可重试',async()=>{
  const env=harness({send:async()=>({ok:false,error:'状态不可用'})});
  assert.equal(env.node('enabledToggle').disabled,true);
  await settle();
  assert.equal(env.node('enabledToggle').disabled,true);
  assert.equal(env.node('retryStatus').hidden,false);
  assert.equal(env.node('message').textContent,'状态不可用');
  env.chrome.runtime.sendMessage=async()=>({ok:true,enabled:true});
  await env.node('retryStatus').events.click();
  assert.equal(env.node('enabledToggle').checked,true);
  assert.equal(env.node('enabledToggle').disabled,false);
  assert.equal(env.node('retryStatus').hidden,true);
});
test('浏览器消息抛错后恢复开关，不永久卡在禁用状态',async()=>{
  const env=harness(); await settle();
  env.chrome.runtime.sendMessage=async()=>{throw new Error('连接已断开');};
  env.node('enabledToggle').checked=true;
  await env.node('enabledToggle').events.change();
  assert.equal(env.node('enabledToggle').checked,false);
  assert.equal(env.node('enabledToggle').disabled,false);
  assert.equal(env.node('message').textContent,'连接已断开');
  assert.equal(env.node('statusDot').attributes['aria-label'],'未启用');
});
test('查询页面异常不会产生未处理拒绝，并提供重试',async()=>{
  const env=harness({query:async()=>{throw new Error('页面不可用');}}); await settle();
  assert.equal(env.node('message').textContent,'页面不可用');
  assert.equal(env.node('retryStatus').hidden,false);
});
test('快速重复切换只发一个请求，以后端确认状态为准',async()=>{
  const env=harness(); await settle(); let finish,calls=0;
  env.chrome.runtime.sendMessage=()=>{calls++;return new Promise(r=>finish=r);};
  env.node('enabledToggle').checked=true;
  const first=env.node('enabledToggle').events.change();
  await env.node('enabledToggle').events.change();
  assert.equal(calls,1);
  finish({ok:true,enabled:true}); await first;
  assert.equal(env.node('enabledToggle').checked,true);
  assert.equal(env.node('enabledToggle').disabled,false);
});
