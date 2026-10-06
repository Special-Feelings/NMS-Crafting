const $=s=>document.querySelector(s);

const prettyArea={
 products:"Products",base:"Base",corvette:"Corvette",exosuit:"Exosuit",
 starship:"Starship",multitool:"Multi-Tool",exocraft:"Exocraft",
 freighter:"Freighter",deployable:"Deployables"
};

let db=null;
let recipeIds=[];
let consumedItems=new Set();
let duplicateNames=new Map();
let selectedId=null;
let productFilter="final";
let areaFilter="all";

const search=$("#search"), opts=$("#opts");

function emptyStore(){return {items:{},recipes:{}}}
function safeNum(v){
 const n=Number(v); return Number.isFinite(n)?n:null;
}
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function escapeHtml(s){
 return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function glyphText(id){
 const n=(db?.items?.[id]?.name||id||"?").trim();
 const words=n.split(/\s+/).filter(Boolean);
 if(words.length>=2)return (words[0][0]+words[1][0]).toUpperCase();
 return n.slice(0,2).toUpperCase();
}
function glyphMarkup(id,className="sf-glyph"){
 return `<span class="${className}" aria-hidden="true">${escapeHtml(glyphText(id))}</span>`;
}
function ensureItem(store,id,patch={}){
 if(!id)return null;
 let row=store.items[id]||(store.items[id]={id,name:id,value:null,area:null,source:null});
 if(patch.name && (row.name===id || !row.name))row.name=patch.name;
 if(patch.forceName && patch.name)row.name=patch.name;
 if(patch.value!==undefined && patch.value!==null)row.value=patch.value;
 if(patch.area)row.area=patch.area;
 if(patch.source)row.source=patch.source;
 return row;
}
function registerRecipe(store,id,row){
 if(!id || !row || !row.ingredients)return;
 const item=ensureItem(store,id,{
   name:row.name||id,forceName:true,value:row.value,area:row.area,source:row.source
 });
 item.area=row.area;
 store.recipes[id]={
   id,
   ingredients:row.ingredients,
   output:Math.max(1,Number(row.output)||1),
   area:row.area,
   source:row.source
 };
 Object.keys(row.ingredients).forEach(x=>ensureItem(store,x));
}
function ingredientMap(required){
 const out={};
 (required||[]).forEach(x=>{
   if(!x?.Id)return;
   const q=Number(x.Quantity??x.Amount??1);
   out[x.Id]=(out[x.Id]||0)+(Number.isFinite(q)?q:1);
 });
 return out;
}

function buildFallbackStore(){ return emptyStore(); }

function areaForBuilding(v){
 const id=v.Id||"";
 const name=(v.Name||"").toLowerCase();
 const group=(v.Group||"").toLowerCase();
 const tags=(v.Groups||[]).map(g=>`${g.Group||""} ${g.SubGroupName||""}`).join(" ").toLowerCase();

 if(v.BuildableOnFreighter===true || group.includes("freighter") || tags.includes("freighter"))return "freighter";
 if(tags.includes("exocraft") || /geobay/.test(name))return "exocraft";
 if(/base computer/.test(name))return "base";

 const deployableIds=new Set([
   "BUILD_REFINER1","BUILDSIGNAL","BUILDBEACON","BUILDSAVE","BUILDHARVESTER",
   "BUILDHARVESTER2","BP_ANALYSER","COOKER","MESSAGEMODULE","BUILDANTIMATTER",
   "BUILD_MINER","BUILDMINER","BUILD_GASHARVEST"
 ]);
 if(tags.includes("portable") || deployableIds.has(id) ||
    /portable refiner|signal booster|save point|save beacon|atmosphere harvester|autonomous mining unit/.test(name)){
   return "deployable";
 }
 return "base";
}

function areaForTechnology(v){
 const c=v.Category||"";
 if(c==="Suit")return "exosuit";
 if(c==="Weapon")return "multitool";
 if(c==="Freighter")return "freighter";
 if(["Ship","AllShipsExceptAlien","AllShips","AlienShip","RobotShip"].includes(c))return "starship";
 if(["Exocraft","AllVehicles","Colossus","Submarine","Mech"].includes(c))return "exocraft";
 if(c==="Corvette")return "corvette";
 return null;
}

function indexRows(store,rows,source){
 (rows||[]).forEach(v=>{
   if(!v?.Id)return;
   let value=safeNum(v.BaseValueUnits);
   ensureItem(store,v.Id,{
     name:v.Name||v.NameLower||v.Id,forceName:true,value,source
   });
 });
}
function addRemoteRecipe(store,v,area,source,opts={}){
 if(!v?.Id || !area)return;
 const ingredients=ingredientMap(v.RequiredItems);
 if(!Object.keys(ingredients).length)return;
 let value=safeNum(v.BaseValueUnits);
 if(opts.noSaleValue)value=null;
 registerRecipe(store,v.Id,{
   name:v.Name||v.NameLower||v.Id,
   value,area,ingredients,
   output:Math.max(1,Number(v.DefaultCraftAmount)||1),
   source
 });
 if(opts.noSaleValue)store.items[v.Id].value=null;
}

async function fetchJson(url){
 const res=await fetch(url,{cache:"no-store"});
 if(!res.ok)throw new Error(`${res.status} ${res.statusText}`);
 return res.json();
}
async function loadRemoteDatabase(){
 const cfg=window.NMS_REMOTE_SOURCES;
 if(!cfg)return;
 const defs=Object.entries(cfg.files);
 const settled=await Promise.allSettled(defs.map(async([key,file])=>[key,await fetchJson(cfg.base+file)]));
 const loaded={},failed=[];
 settled.forEach((r,i)=>{
   const key=defs[i][0];
   if(r.status==="fulfilled")loaded[key]=r.value[1];
   else failed.push(key);
 });
 const recipeSourceCount=["products","buildings","technology","exocraft","corvette"].filter(k=>loaded[k]).length;
 if(!loaded.raw || recipeSourceCount===0){
   $("#dataStatus").textContent=`Full database could not load. Missing: ${failed.join(", ")||"core data"}.`;
   return;
 }
 const store=emptyStore();

 ["raw","products","buildings","technology","exocraft","corvette","curiosities","constructed","trade"].forEach(k=>{
   if(loaded[k])indexRows(store,loaded[k],k);
 });

 (loaded.products||[]).forEach(v=>{
   if(v.ProductCategory==="BuildingPart")return;
   addRemoteRecipe(store,v,"products","Products.json");
 });

 (loaded.curiosities||[]).forEach(v=>{
   if(v.WikiCategory!=="Crafting")return;
   addRemoteRecipe(store,v,"products","Curiosities.json");
 });

 const advancedCraftFallback={
   MEGAPROD1:{name:"Portable Reactor",value:4200000,ingredients:{FARMPROD7:1,COMPOUND4:1}},
   MEGAPROD2:{name:"Quantum Processor",value:4400000,ingredients:{FARMPROD9:1,COMPOUND5:1}},
   MEGAPROD3:{name:"Cryogenic Chamber",value:3800000,ingredients:{FARMPROD8:1,COMPOUND6:1}}
 };
 Object.entries(advancedCraftFallback).forEach(([id,row])=>{
   if(!store.recipes[id] && store.items[id]){
     registerRecipe(store,id,{...row,area:"products",output:1,source:"craft-chain fallback"});
   }
 });

 (loaded.buildings||[]).forEach(v=>{
   if(v.ShowInBuildMenu===false)return;
   addRemoteRecipe(store,v,areaForBuilding(v),"Buildings.json",{noSaleValue:true});
 });

 (loaded.technology||[]).forEach(v=>{
   const area=areaForTechnology(v);
   if(!area || v.Category==="Maintenance")return;
   addRemoteRecipe(store,v,area,"Technology.json",{noSaleValue:true});
 });

 (loaded.exocraft||[]).forEach(v=>{
   let area="exocraft";
   if(v.Category==="Suit")area="exosuit";
   addRemoteRecipe(store,v,area,"Exocraft.json",{
     noSaleValue:v.CurrencyType==="None" || v.ProductCategory==="BuildingPart" || !!v.Category
   });
 });

 (loaded.corvette||[]).forEach(v=>{
   if(v.IsCraftable===false)return;
   addRemoteRecipe(store,v,"corvette","Corvette.json");
 });

 if(Object.keys(store.recipes).length===0){
   $("#dataStatus").textContent="Remote data returned no usable recipes.";
   return;
 }

 const previousName=selectedId&&db?.items[selectedId]?.name;
 db=store;
 rebuildIndexes();
 if(previousName){
   selectedId=recipeIds.find(id=>db.items[id]?.name===previousName)||null;
 }
 if(!selectedId && db.recipes.ULTRAPROD2)selectedId="ULTRAPROD2";
 resetSearchDefault();
 calculate();

 const gameVersion=loaded.manifest?.gameVersion ? `game ${loaded.manifest.gameVersion}` : "current source data";
 const counts=Object.fromEntries(Object.keys(prettyArea).map(a=>[a,recipeIds.filter(id=>db.recipes[id].area===a).length]));
 const missing=failed.length?` Missing datasets: ${failed.join(", ")}.`:"";
 const chainIssues=validateCoreCraftChains(store);
 const integrity=chainIssues.length?` Craft-chain warning: ${chainIssues.join("; ")}.`:"";
 $("#dataStatus").textContent=
   `Loaded ${recipeIds.length.toLocaleString()} recipes from ${gameVersion}. `+
   `Products ${counts.products}, Base ${counts.base}, Corvette ${counts.corvette}, Exosuit ${counts.exosuit}, `+
   `Starship ${counts.starship}, Multi-Tool ${counts.multitool}, Exocraft ${counts.exocraft}, `+
   `Freighter ${counts.freighter}, Deployables ${counts.deployable}.${missing}${integrity}`;
}

function validateCoreCraftChains(store){
 const issues=[];
 const mustBeRecipes=["MEGAPROD1","MEGAPROD2","MEGAPROD3"];
 mustBeRecipes.forEach(id=>{
   if(store.items[id] && !store.recipes[id])issues.push(`${store.items[id].name||id} has no loaded recipe`);
 });
 return issues;
}

function rebuildIndexes(){
 recipeIds=Object.keys(db.recipes).sort((a,b)=>{
   const an=db.items[a]?.name||a,bn=db.items[b]?.name||b;
   return an.localeCompare(bn)||a.localeCompare(b);
 });
 consumedItems=new Set();
 Object.values(db.recipes).forEach(r=>Object.keys(r.ingredients).forEach(id=>{
   if(db.recipes[id])consumedItems.add(id);
 }));
 duplicateNames=new Map();
 recipeIds.forEach(id=>{
   const n=db.items[id]?.name||id;
   duplicateNames.set(n,(duplicateNames.get(n)||0)+1);
 });
}
function productType(id){return consumedItems.has(id)?"mid":"final"}
function filteredIds(queryOverride){
 const q=(queryOverride!==undefined?queryOverride:search.value).trim().toLowerCase();
 return recipeIds.filter(id=>{
   const r=db.recipes[id],item=db.items[id]||{name:id};
   if(areaFilter!=="all"&&r.area!==areaFilter)return false;
   if(productFilter!=="all"&&productType(id)!==productFilter)return false;
   return !q || item.name.toLowerCase().includes(q) || id.toLowerCase().includes(q);
 });
}
function resetSearchDefault(){
 const a=filteredIds("");
 selectedId=a[0]||null;
 search.value="";
 search.placeholder=selectedId?(db.items[selectedId]?.name||selectedId):"No recipes in this filter";
 search.classList.add("default-search");
}
function showOptions(){
 const a=filteredIds();
 opts.innerHTML=a.map(id=>{
   const item=db.items[id]||{name:id};
   const type=productType(id)==="final"?"Final":"Mid-step";
   const area=prettyArea[db.recipes[id].area]||db.recipes[id].area;
   const duplicate=duplicateNames.get(item.name)>1?` · ${id}`:"";
   return `<div class="opt" data-id="${escapeHtml(id)}">${glyphMarkup(id,"opt-glyph")}<span class="opt-name">${escapeHtml(item.name)}</span><span class="opt-meta">${type} ${escapeHtml(area)}${escapeHtml(duplicate)}</span></div>`;
 }).join("")||'<div class="opt no-match">No matches in this filter</div>';
 opts.classList.remove("hidden");
 opts.querySelectorAll("[data-id]").forEach(x=>x.onmousedown=e=>{
   e.preventDefault();
   selectedId=x.dataset.id;
   search.value=db.items[selectedId]?.name||selectedId;
   search.placeholder="";
   search.classList.remove("default-search");
   opts.classList.add("hidden");
   calculate();
 });
}

document.querySelectorAll(".area-filter").forEach(btn=>btn.onclick=()=>{
 areaFilter=btn.dataset.area;
 document.querySelectorAll(".area-filter").forEach(b=>b.classList.toggle("active",b===btn));
 resetSearchDefault();search.focus();showOptions();
});
document.querySelectorAll(".filter").forEach(btn=>btn.onclick=()=>{
 productFilter=btn.dataset.filter;
 document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b===btn));
 resetSearchDefault();search.focus();showOptions();
});
search.onfocus=showOptions;
search.oninput=()=>{selectedId=null;search.classList.remove("default-search");showOptions()};
document.addEventListener("click",e=>{
 if(e.target.closest(".combo")||e.target.closest(".area-filter")||e.target.closest(".filter"))return;
 opts.classList.add("hidden");
});
$("#calc").onclick=calculate;

function money(n){return n==null?"—":Math.round(n).toLocaleString()+" u"}
function fmt(n){return Number(n).toLocaleString()}
function itemName(id){return db.items[id]?.name||id}
function itemValue(id){return db.items[id]?.value??null}

function reachableGraph(target){
 const seen=new Set(),edges={};
 function visit(id){
   if(seen.has(id)||!db.recipes[id])return;
   seen.add(id);
   edges[id]=Object.keys(db.recipes[id].ingredients).filter(x=>db.recipes[x]);
   edges[id].forEach(visit);
 }
 visit(target);
 return {seen,edges};
}
function buildPlan(target,qty){
 const {seen,edges}=reachableGraph(target);
 const indegree={};
 seen.forEach(id=>indegree[id]=0);
 Object.entries(edges).forEach(([p,children])=>children.forEach(c=>indegree[c]=(indegree[c]||0)+1));
 const queue=[...seen].filter(id=>indegree[id]===0).sort((a,b)=>itemName(a).localeCompare(itemName(b)));
 const order=[];
 while(queue.length){
   const id=queue.shift();order.push(id);
   (edges[id]||[]).forEach(c=>{
     indegree[c]--;
     if(indegree[c]===0){
       queue.push(c);queue.sort((a,b)=>itemName(a).localeCompare(itemName(b)));
     }
   });
 }
 [...seen].forEach(id=>{if(!order.includes(id))order.push(id)});

 const demand={[target]:qty},craft={},raw={};
 order.forEach(id=>{
   const need=demand[id]||0,r=db.recipes[id];
   const output=Math.max(1,r.output||1);
   const batches=Math.ceil(need/output);
   const produced=batches*output;
   craft[id]={need,batches,produced,output};
   Object.entries(r.ingredients).forEach(([ing,perBatch])=>{
     const amount=perBatch*batches;
     if(db.recipes[ing])demand[ing]=(demand[ing]||0)+amount;
     else raw[ing]=(raw[ing]||0)+amount;
   });
 });
 return {order,craft,raw};
}

function calculate(){
 let id=selectedId;
 if(!id && search.value.trim()){
   const q=search.value.trim().toLowerCase();
   id=filteredIds("").find(x=>itemName(x).toLowerCase()===q||x.toLowerCase()===q);
 }
 const qty=Math.max(1,parseInt($("#qty").value)||1);
 if(!id||!db.recipes[id]){$("#msg").textContent="Choose a recipe from the list.";return}
 selectedId=id;
 search.value=itemName(id);
 $("#msg").textContent="";
 const plan=buildPlan(id,qty);

 $("#finalName").textContent=itemName(id);
 $("#finalQty").textContent=qty+" requested";
 const finalVal=itemValue(id);
 $("#finalValue").textContent=finalVal==null?"—":money(finalVal*qty);

 let rawCost=0,known=true;
 Object.entries(plan.raw).forEach(([x,n])=>{
   const v=itemValue(x);
   if(v==null)known=false;else rawCost+=v*n;
 });
 $("#materialValue").textContent=known?money(rawCost):"—";
 $("#difference").textContent=known&&finalVal!=null?money(finalVal*qty-rawCost):"—";
 $("#materialChips").innerHTML=Object.entries(plan.raw)
   .sort((a,b)=>itemName(a[0]).localeCompare(itemName(b[0])))
   .map(([x,n])=>`<span class="material-chip">${glyphMarkup(x,"chip-glyph")}<span><b>${fmt(n)}</b> ${escapeHtml(itemName(x))}${itemValue(x)!=null?` · ${money(itemValue(x)*n)}`:""}</span></span>`).join("");
 const finalGlyph=$("#finalGlyph");
 finalGlyph.textContent=glyphText(id);
 $("#tree").innerHTML="";
 $("#tree").append(treeNode(id,qty,new Set()));
 renderSteps(plan);
}

function treeNode(id,need,path){
 const node=document.createElement("div");node.className="node";
 const line=document.createElement("div");line.className="node-line";
 const btn=document.createElement("button");btn.className="toggle";
 const q=document.createElement("span");q.className="node-qty";q.textContent=fmt(need)+" ×";
 const icon=document.createElement("span");icon.className="tree-glyph sf-glyph";icon.textContent=glyphText(id);
 const name=document.createElement("span");name.className="node-name";name.textContent=itemName(id);
 const unit=document.createElement("span");unit.className="node-value";unit.textContent=itemValue(id)==null?"—":money(itemValue(id))+" each";
 const total=document.createElement("span");total.className="node-total";total.textContent=itemValue(id)==null?"—":money(itemValue(id)*need);
 const r=db.recipes[id];

 if(!r || path.has(id)){
   btn.textContent="•";btn.disabled=true;
   const badge=document.createElement("span");badge.className="badge";badge.textContent=r?"CYCLE":"BASE";
   line.append(btn,q,icon,name,badge,unit,total);node.append(line);return node;
 }

 btn.textContent="−";line.append(btn,q,icon,name,unit,total);node.append(line);
 const kids=document.createElement("div");kids.className="children";
 const batches=Math.ceil(need/Math.max(1,r.output||1));
 const nextPath=new Set(path);nextPath.add(id);
 Object.entries(r.ingredients).forEach(([x,m])=>kids.append(treeNode(x,m*batches,nextPath)));
 btn.onclick=()=>{const hidden=kids.classList.toggle("hidden");btn.textContent=hidden?"+":"−"};
 node.append(kids);return node;
}

function renderSteps(plan){
 const stepOrder=[...plan.order].reverse();
 $("#steps").innerHTML=stepOrder.map((id,i)=>{
   const s=plan.craft[id],r=db.recipes[id];
   const ingredients=Object.entries(r.ingredients)
     .map(([x,m])=>`${fmt(m*s.batches)} ${itemName(x)}`).join(" + ");
   const batchNote=s.produced!==s.need
     ? `${fmt(s.need)} needed · ${fmt(s.produced)} produced in ${fmt(s.batches)} batches`
     : (s.batches>1?`${fmt(s.batches)} batches`:"");
   return `<div class="step ${i===stepOrder.length-1?"final-step":""}">
     <div class="step-num">STEP ${i+1}</div>
     ${glyphMarkup(id,"step-glyph")}
     <div class="step-body">
       <b>Craft ${escapeHtml(itemName(id))}</b>
       <span class="step-ingredients">${escapeHtml(ingredients)}</span>
       ${batchNote?`<small>${escapeHtml(batchNote)}</small>`:""}
     </div>
     <div class="step-qty">${fmt(s.produced)}</div>
   </div>`;
 }).join("");
}

$("#collapseAll").onclick=()=>document.querySelectorAll(".children").forEach(x=>x.classList.add("hidden"));
$("#expandAll").onclick=()=>document.querySelectorAll(".children").forEach(x=>x.classList.remove("hidden"));

db=buildFallbackStore();
rebuildIndexes();
$("#dataStatus").textContent="Loading current recipe database…";
loadRemoteDatabase().catch(err=>{
 console.error(err);
 $("#dataStatus").textContent=`Recipe database load failed. ${err.message||err}`;
 $("#msg").textContent="The calculator shell loaded, but the external data source is currently unavailable.";
});
