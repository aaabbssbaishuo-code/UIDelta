import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./content.js',import.meta.url),'utf8');
function fixture(){
  class Node {
    constructor(){this.children=[];this.style={};this.dataset={};this.attributes={};this.classList={add(){}};}
    appendChild(node){this.children.push(node);node.parentNode=this;}
    replaceChildren(){for(const node of [...this.children])node.remove();}
    remove(){this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
  }
  const window={innerWidth:900,innerHeight:700,scrollX:0,scrollY:0};
  const context=vm.createContext({window,document:{createElement:()=>new Node(),createTextNode:text=>text}});
  vm.runInContext(source.slice(source.indexOf('  const ROOT_ATTRIBUTE'),source.indexOf('  const review = new UIDeltaReview();'))+'\nglobalThis.Review=UIDeltaReview;',context);
  const target={rect:{left:100,top:200,right:300,bottom:250,width:200,height:50},visible:true,getBoundingClientRect(){return this.rect;},checkVisibility(){return this.visible;}};
  const review=Object.assign(Object.create(context.Review.prototype),{enabled:true,session:{status:'active'},browseMode:true,currentView:'inspect',pinsLayer:new Node(),issues:[{id:'a',sequence:16,displayId:'UI-016',pageSnapshot:{route:'/one'},elementAnchor:{}}],currentRoute:()=>'/one',resolveAnchor:()=>target,visibleComposerRect:(_,rect)=>rect});
  return {review,target,window};
}
test('浏览、标注、UI 和清单均保留编号；浏览标记不占用点击与 Tab',()=>{
  const {review}=fixture(), original=JSON.stringify(review.issues);
  for(const [browse,mode,view] of [[true,'ui','inspect'],[false,'annotation','inspect'],[false,'ui','inspect'],[false,'ui','inbox']]){
    Object.assign(review,{browseMode:browse,inspectMode:mode,currentView:view});review.renderPins();
    assert.equal(review.pinsLayer.children.length,1);const pin=review.pinsLayer.children[0];
    assert.equal(pin.textContent,'16');assert.equal(pin.style.width,pin.style.height);
    assert.equal(pin.tabIndex,browse?-1:0);assert.equal(pin.style.pointerEvents,browse?'none':'auto');
  }
  assert.equal(JSON.stringify(review.issues),original);
});
test('重绘复用节点，目标移动更新坐标，隐藏和跨路由清除标记',()=>{
  const {review,target}=fixture();review.renderPins();const pin=review.pinsLayer.children[0];
  target.rect.top-=60;target.rect.bottom-=60;review.renderPins();
  assert.equal(review.pinsLayer.children[0],pin);assert.equal(pin.style.top,'128px');
  target.visible=false;review.renderPins();assert.equal(review.pinsLayer.children.length,0);
  target.visible=true;review.renderPins();review.currentRoute=()=>'/two';review.renderPins();assert.equal(review.pinsLayer.children.length,0);
});
test('同目标的多个编号错开；禁用走查清理标记但不删除问题',()=>{
  const {review}=fixture();review.issues.push({...review.issues[0],id:'b',sequence:128});review.renderPins();
  const [a,b]=review.pinsLayer.children;assert.notEqual(a.style.left,b.style.left);assert.equal(b.style.width,'30px');
  review.enabled=false;review.renderPins();assert.equal(review.pinsLayer.children.length,0);assert.equal(review.issues.length,2);
});
test('自由框选按记录时的页面滚动位置换算，不固定在视口',()=>{
  const {review,window,target}=fixture();review.issues[0].region={...target.rect};review.issues[0].pageSnapshot.scroll={x:20,y:200};
  window.scrollY=280;window.scrollX=40;review.renderPins();
  assert.equal(review.pinsLayer.children[0].style.top,'108px');assert.equal(review.pinsLayer.children[0].style.left,'268px');
});

test('浏览点击穿透时 hover 同步显示完整描述，移出即收起且没有原生 title',()=>{
  const {review}=fixture();review.issues[0].description='完整描述\n第二行';review.renderPins();
  const pin=review.pinsLayer.children[0];pin.getBoundingClientRect=()=>({left:288,top:188,right:312,bottom:212,width:24,height:24});
  review.tooltip={dataset:{},style:{},offsetWidth:200,offsetHeight:60,replaceChildren(text){this.text=text;},getBoundingClientRect:()=>({left:288,right:488,top:220,bottom:280})};
  const event={clientX:300,clientY:200,composedPath:()=>[]};
  assert.equal(review.updatePinHover(event),true);
  assert.equal(review.tooltip.text,'UI-016\n完整描述\n第二行');assert.equal(review.tooltip.style.display,'block');
  assert.equal(pin.attributes.title,undefined);assert.equal(pin.style.pointerEvents,'none');
  assert.equal(review.updatePinHover({...event,clientX:10,clientY:10}),false);
  assert.equal(review.tooltip.style.display,'none');
});
