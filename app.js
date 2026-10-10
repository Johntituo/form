const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const PERSONAL_KEY = "form_public_personal_v1";
const DAY_NAMES = ["周日","周一","周二","周三","周四","周五","周六"];
const DEFAULT_PROFILE = {name:"",weight:72,height:"",age:"",goal:"fatloss",experience:"intermediate",place:"both",equipment:"mixed",days:4,duration:45,cardio:"balanced",start:1};
let site = null;
let profile = {...DEFAULT_PROFILE};
let personal = {checks:{},records:[]};
let selectedDay = new Date().getDay();
let currentWorkout = null;
let adminAuthenticated = false;
let toastTimer;

function localDate(d=new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function dateFromISO(s) { return new Date(s+"T12:00:00"); }
function prettyDate(s) { return dateFromISO(s).toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit",weekday:"short"}); }
function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function showToast(message) {
  const el=$("#toast"); el.textContent=message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2400);
}
function readPersonal() {
  try { const parsed=JSON.parse(localStorage.getItem(PERSONAL_KEY)||"null"); if(parsed) { profile={...DEFAULT_PROFILE,...parsed.profile}; personal={checks:parsed.checks||{},records:Array.isArray(parsed.records)?parsed.records:[]}; } }
  catch { /* corrupted local preferences are ignored */ }
}
function savePersonal() {
  try { localStorage.setItem(PERSONAL_KEY,JSON.stringify({profile,checks:personal.checks,records:personal.records})); }
  catch { showToast("当前浏览器无法保存数据，请导出备份。"); }
}
async function fetchSite() {
  const r=await fetch("/api/site",{cache:"no-store"});
  if(!r.ok) throw new Error("无法读取网站配置。");
  site=await r.json();
}
function workoutById(id) { return site.workouts.find(w=>w.id===id) || site.workouts[0]; }
function exerciseName(e, day) {
  if (profile.equipment === "bodyweight" || profile.place === "home" || profile.equipment === "dumbbells") return e.nameHome || e.nameGym;
  if (profile.equipment === "fullgym" || profile.place === "gym") return e.nameGym || e.nameHome;
  // The "both" option alternates equipment assumptions by weekday/weekend.
  return ([0,6].includes(Number(day)) ? (e.nameHome || e.nameGym) : (e.nameGym || e.nameHome));
}
function adjustedSets(value) {
  const s=String(value||"");
  const m=s.match(/^(\d+)\s*组/);
  if(!m) return s;
  let n=Number(m[1]);
  if(profile.experience==="beginner") n=Math.max(2,n-1);
  if(profile.experience==="advanced") n=Math.min(5,n+1);
  return s.replace(/^\d+\s*组/,`${n} 组`);
}
function adjustExercise(e, workout, index, allCount, day, activeTarget, baseTotal) {
  const baseMinutes=Math.max(1,Number(e.minutes)||5);
  const minutes=baseMinutes*(activeTarget/Math.max(1,baseTotal));
  const met=Number(e.met||workout.met||4);
  const weight=Number(profile.weight)||70;
  const kcal=met*3.5*weight/200*minutes;
  return {...e,displayName:exerciseName(e,day),sets:adjustedSets(e.sets),minutes,kcal,met};
}
function workoutTypesForDays(days) {
  const patterns={
    3:["full","lower","upper"],
    4:["upper","lower","full","cardio"],
    5:["upper","lower","cardio","full","upper"],
    6:["upper","lower","cardio","upper","lower","full"]
  };
  return patterns[Number(days)]||patterns[4];
}
function scheduledDays(count,startDay=1) {
  const patterns={
    3:[1,3,5],
    4:[1,2,4,6],
    5:[1,2,3,5,6],
    6:[1,2,3,4,5,6]
  };
  return (patterns[Number(count)]||patterns[4]).map(day=>(day+(Number(startDay)===0?6:0))%7);
}
function selectedWorkoutId(day) {
  const days=scheduledDays(profile.days,profile.start);
  const i=days.indexOf(day);
  if(i<0) return "recovery";
  const types=workoutTypesForDays(profile.days);
  let type=types[i%types.length];
  if(profile.cardio==="more"&&i===types.length-1) type="cardio";
  if(profile.cardio==="less"&&type==="cardio") type="full";
  if(profile.goal==="strength"&&type==="cardio") type="full";
  return site.workouts.some(w=>w.id===type)?type:(site.workouts.find(w=>w.id!=="recovery")||site.workouts[0]).id;
}
function getSession(day) {
  const w=workoutById(selectedWorkoutId(day));
  const target=Number(profile.duration)||45;
  let items=[...w.exercises];
  if(profile.cardio==="less"&&w.id!=="cardio") {
    const withoutCardio=items.filter(e=>!(e.area||"").includes("有氧"));
    if(withoutCardio.length>=2) items=withoutCardio;
  }
  const maxCount=target<=30?3:target<=45?4:target<=60?5:7;
  if(w.id==="recovery") items=[...w.exercises];
  else if(w.id==="cardio"&&target<=30) items=items.slice(0,2);
  else if(items.length>maxCount) items=items.slice(0,maxCount);
  if(profile.cardio==="more"&&w.id!=="recovery") {
    let aerobic=items.find(e=>(e.area||"").includes("有氧"));
    if(!aerobic) {
      const cardioTemplate=site.workouts.find(x=>x.id==="cardio");
      aerobic=cardioTemplate?.exercises.find(e=>(e.area||"").includes("有氧"));
      if(aerobic&&items.length) items[items.length-1]=aerobic;
      else if(aerobic) items.push(aerobic);
    }
  }
  const activeRatio=profile.cardio==="more"?0.78:profile.cardio==="less"?0.62:0.70;
  const activeTarget=Math.max(8,target*activeRatio);
  const baseTotal=items.reduce((sum,item)=>sum+(Number(item.minutes)||5),0);
  const exs=items.map((e,i)=>adjustExercise(e,w,i,items.length,day,activeTarget,baseTotal));
  const weight=Number(profile.weight)||70;
  const warmupKcal=3.5*3.5*weight/200*5;
  const cooldownKcal=2.3*3.5*weight/200*3;
  const listCalories=exs.reduce((sum,e)=>sum+e.kcal,0);
  return {template:w,title:w.title,focus:w.focus||w.title,description:w.description||"",duration:target,exercises:exs,warmupKcal,cooldownKcal,totalKcal:Math.round(listCalories+warmupKcal+cooldownKcal),exerciseKcal:Math.round(listCalories),day};
}
function weekPlan() { return Array.from({length:7},(_,d)=>getSession(d)); }
function checkKey(day) { return localDate(dateForDayOfWeek(day)); }
function dateForDayOfWeek(day) {
  const d=new Date(), delta=day-d.getDay(); d.setDate(d.getDate()+delta); return d;
}
function currentCheckKey() { return localDate(); }
function currentSession() { return getSession(new Date().getDay()); }
function applyBranding() {
  $("#brandSide").textContent=site.brand; $("#brandMobile").textContent=site.brand;
  $("#userAvatar").textContent=(profile.name||site.brand||"F").slice(0,1).toUpperCase();
  $("#mainTitle").innerHTML=`${escapeHtml(site.brand)}<br><span>${escapeHtml(site.tagline||"训练有计划，改变看得见。")}</span>`;
  $("#mainTagline").textContent="根据你的目标与实际时间，生成可以执行的训练安排。";
  $("#announcement").innerHTML=`<span class="announce-icon">i</span><span>${escapeHtml(site.announcement||"循序渐进，给身体足够的恢复时间。")}</span>`;
  $("#footerBrand").textContent=`${site.brand} · ${site.tagline}`;
}
function renderOverview() {
  applyBranding();
  const today=getSession(new Date().getDay()), key=currentCheckKey(), checked=personal.checks[key]||[];
  $("#todayFocus").textContent=(today.focus||"TODAY").toUpperCase();
  $("#todayWorkoutTitle").textContent=today.title;
  $("#todayWorkoutSub").textContent=today.template.id==="recovery"?"恢复日 · 轻松活动或完全休息":`约 ${today.duration} 分钟 · ${profile.place==="home"?"居家动作":profile.place==="gym"?"健身房动作":"健身房 / 居家适配"}`;
  $("#todayKcal").textContent=today.totalKcal;
  $("#todayProgress").textContent=`${checked.length} / ${today.exercises.length}`;
  $("#todayProgressBar").style.width=`${checked.length/Math.max(1,today.exercises.length)*100}%`;
  $("#todayExercises").innerHTML=today.exercises.map((e,i)=>`<label class="exercise-item"><input class="exercise-check" type="checkbox" data-today-check="${i}" ${checked.includes(e.id)? "checked":""}><span class="ex-info"><span class="ex-name">${escapeHtml(e.displayName)}</span><span class="ex-meta">${escapeHtml(e.sets||"按舒适节奏完成")} · ${e.minutes.toFixed(1)} 分钟 · MET ${e.met.toFixed(1)}</span></span><span class="ex-kcal">${Math.round(e.kcal)}<small>kcal</small></span></label>`).join("");
  const currentWeek=personal.records.filter(r=>isThisWeek(r.date));
  const sessions=currentWeek.length;
  const weekCalories=weekPlan().filter(s=>s.template.id!=="recovery").reduce((sum,s)=>sum+s.totalKcal,0);
  $("#metricSessions").innerHTML=`${sessions} <small>次</small>`;
  $("#metricFrequency").textContent=`目标每周 ${profile.days} 次`;
  $("#frequencyBar").style.width=`${Math.min(100,sessions/Number(profile.days)*100)}%`;
  $("#metricCalories").innerHTML=`${Math.round(weekCalories)} <small>kcal</small>`;
  $("#metricWeight").innerHTML=`${profile.weight||"—"} <small>kg</small>`;
  $("#weightMeta").textContent=profile.height?`身高 ${profile.height} cm · 持续记录趋势`:"在个人参数中填写身高";
  $("#weekLabel").textContent=`${profile.days} SESSIONS`;
  $("#weekSchedule").innerHTML=weekPlan().map(s=>{
    const isToday=s.day===new Date().getDay();
    const comp=(personal.checks[checkKey(s.day)]||[]).length;
    return `<div class="week-row ${isToday?"today":""}"><div class="day-letter">${DAY_NAMES[s.day].replace("周","")}<b>${dateForDayOfWeek(s.day).getDate()}</b></div><div><div class="week-name">${escapeHtml(s.title)}</div><div class="week-sub">${s.template.id==="recovery"?"恢复 / 休息":`${s.duration} 分钟 · ${s.totalKcal} kcal`}</div></div><div class="week-status">${comp&&comp===s.exercises.length?"✓":isToday?"●":""}</div></div>`;
  }).join("");
  $("#weeklyTip").textContent=profile.goal==="fatloss"?"减脂更依赖长期可持续的饮食、日常活动与训练组合；不要只追求单次热量数字。":"保持动作质量和恢复节奏，根据实际感受循序渐进。";
  $("#completeToday").textContent=checked.length===today.exercises.length?"今日训练已完成 ✓":"完成今日训练 ↗";
  $("#completeToday").disabled=checked.length===today.exercises.length;
}
function renderPlan() {
  const plan=weekPlan(), s=plan[selectedDay];
  const trainDays=plan.filter(x=>x.template.id!=="recovery");
  $("#planSummary").innerHTML=`<div class="summary-item"><span>每周训练目标</span><b>${profile.days} 天</b></div><div class="summary-item"><span>单次安排</span><b>${profile.duration} 分钟</b></div><div class="summary-item"><span>预计周消耗</span><b>${Math.round(trainDays.reduce((n,x)=>n+x.totalKcal,0))} kcal</b></div>`;
  $("#planTabs").innerHTML=plan.map(p=>`<button class="day-tab ${p.day===selectedDay?"selected":""}" data-select-day="${p.day}"><small>${DAY_NAMES[p.day]}</small><b>${dateForDayOfWeek(p.day).getDate()}</b><small>${p.template.id==="recovery"?"恢复":`${p.totalKcal} kcal`}</small></button>`).join("");
  $("#planDetail").innerHTML=`<div class="overline">${escapeHtml(s.focus).toUpperCase()}</div><h3>${escapeHtml(s.title)}</h3><p class="plan-desc">${escapeHtml(s.description)}<br>预计总时长 ${s.duration} 分钟，已为热身、动作转换和放松预留时间。</p><div class="plan-exercises">${s.exercises.map((e,i)=>`<div class="plan-exercise"><div class="plan-num">${String(i+1).padStart(2,"0")}</div><div class="plan-ex-info"><b>${escapeHtml(e.displayName)}</b><p>${escapeHtml(e.sets||"按计划完成")} · ${e.minutes.toFixed(1)} 分钟 · MET ${e.met.toFixed(1)}</p><p>${escapeHtml((e.cues||[])[0]||"动作保持稳定可控。")}</p></div><div class="plan-ex-kcal">${Math.round(e.kcal)} kcal</div></div>`).join("")}<div class="plan-exercise"><div class="plan-num">＋</div><div class="plan-ex-info"><b>热身与放松</b><p>热身约 5 分钟 + 放松约 3 分钟（计入消耗估算）</p></div><div class="plan-ex-kcal">${Math.round(s.warmupKcal+s.cooldownKcal)} kcal</div></div></div>`;
  $("#energyBreakdown").innerHTML=s.exercises.map(e=>`<div class="energy-row"><div>${escapeHtml(e.displayName)}<span>${e.minutes.toFixed(1)} 分钟 · MET ${e.met.toFixed(1)}</span></div><b>${Math.round(e.kcal)} kcal</b></div>`).join("")+`<div class="energy-row"><div>热身 + 放松<span>约 8 分钟</span></div><b>${Math.round(s.warmupKcal+s.cooldownKcal)} kcal</b></div>`;
  $("#sessionEnergy").textContent=`${s.totalKcal} kcal`;
}
function allExercises() {
  const map=new Map();
  for(const w of site.workouts) for(const e of w.exercises) if(!map.has(e.id)) map.set(e.id,{...e,workout:w.title,workoutId:w.id});
  return [...map.values()];
}
function renderLibrary() {
  const q=($("#exerciseSearch").value||"").trim().toLowerCase(), filt=$("#exerciseFilter").value;
  let items=allExercises().filter(e=>{
    const name=(e.nameGym+" "+e.nameHome+" "+e.area+" "+e.workout+" "+(e.cues||[]).join(" ")).toLowerCase();
    if(q&&!name.includes(q))return false;
    if(filt==="home"&&!e.nameHome)return false;
    if(filt==="gym"&&!e.nameGym)return false;
    if(filt==="video"&&!e.videoUrl)return false;
    return true;
  });
  $("#exerciseLibrary").innerHTML=items.length?items.map(e=>`<article class="exercise-card"><div class="exercise-card-top"><div class="exercise-symbol">${symbolForArea(e.area)}</div><span class="exercise-label">${escapeHtml((e.area||"TRAINING").toUpperCase())}</span></div><div class="exercise-card-body"><h3>${escapeHtml(e.nameGym||e.nameHome)}</h3><p>${escapeHtml(e.nameHome&&e.nameHome!==e.nameGym?"居家替代："+e.nameHome:"适用场景：健身房 / 居家可调整")}</p><div class="exercise-tags"><span>${escapeHtml(e.sets||"按计划完成")}</span><span>MET ${Number(e.met||4).toFixed(1)}</span>${e.videoUrl?'<span>教学视频</span>':""}</div><button class="button ghost full-width" data-guide="${escapeHtml(e.id)}">${e.videoUrl?"观看动作教学 ↗":"查看姿势要点 →"}</button></div></article>`).join(""):'<div class="empty">没有找到匹配动作，试试其他关键词。</div>';
}
function symbolForArea(area="") {return area.includes("腿")||area.includes("下肢")?"↗":area.includes("胸")?"◇":area.includes("背")?"⇄":area.includes("核心")?"◎":area.includes("有氧")?"⌁":area.includes("臀")?"◌":"＋";}
function openGuide(id) {
  const e=allExercises().find(x=>x.id===id); if(!e)return;
  $("#modalTitle").textContent=e.nameGym||e.nameHome;
  $("#modalMeta").textContent=`${e.workout} · ${e.area||"训练动作"} · ${e.sets||"按计划完成"}`;
  const video=toEmbed(e.videoUrl||"");
  $("#modalVideo").innerHTML=video?`<iframe src="${video}" title="${escapeHtml(e.nameGym||e.nameHome)} 动作教学视频" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`:`<div class="no-video">此动作暂未配置可嵌入视频。<br>你仍可按照下方文字要点学习，或由开发者在动作模板中添加 YouTube 链接。</div>`;
  $("#modalCues").innerHTML=(e.cues||["保持动作稳定，选择自己可控且无痛的活动范围。"]).map(c=>`<li>${escapeHtml(c)}</li>`).join("");
  $("#modalShade").classList.remove("hidden"); document.body.style.overflow="hidden";
}
function toEmbed(raw) {
  try {
    const u=new URL(raw);
    if(!["https:","http:"].includes(u.protocol))return "";
    if(["youtu.be"].includes(u.hostname)){const id=u.pathname.slice(1).split("/")[0];return /^[\w-]{11}$/.test(id)?`https://www.youtube-nocookie.com/embed/${id}`:"";}
    if(["youtube.com","www.youtube.com","m.youtube.com"].includes(u.hostname)){const id=u.searchParams.get("v");return /^[\w-]{11}$/.test(id||"")?`https://www.youtube-nocookie.com/embed/${id}`:"";}
  }catch{}
  return "";
}
function closeModal(id) {$(id).classList.add("hidden");document.body.style.overflow="";if(id==="#modalShade")$("#modalVideo").innerHTML="";}
function isThisWeek(date) {
  const d=dateFromISO(date), now=new Date(), start=new Date(now); start.setDate(now.getDate()-((now.getDay()+6)%7));start.setHours(0,0,0,0);
  const end=new Date(start);end.setDate(start.getDate()+7);return d>=start&&d<end;
}
function renderRecords() {
  const records=[...personal.records].sort((a,b)=>b.date.localeCompare(a.date));
  $("#recordCount").innerHTML=`${records.length} <small>次</small>`;
  $("#recordMinutes").innerHTML=`${records.reduce((n,r)=>n+(Number(r.minutes)||0),0)} <small>分钟</small>`;
  const latest=records.find(r=>r.weight);
  $("#recordWeight").innerHTML=`${latest?.weight||profile.weight||"—"} <small>kg</small>`;
  $("#recordWeightDate").textContent=latest?prettyDate(latest.date):"填写体重后显示";
  $("#historyList").innerHTML=records.length?records.map(r=>`<div class="history-item"><div class="history-date">${prettyDate(r.date)}</div><div class="history-main"><b>${escapeHtml(r.type)}</b><small>${r.minutes?escapeHtml(r.minutes)+" 分钟":"时长未填写"}${r.note?" · "+escapeHtml(r.note):""}</small></div><div class="history-kcal">${r.kcal?`${Math.round(r.kcal)} kcal`:r.weight?`${escapeHtml(r.weight)} kg`:""}</div><button class="delete-record" data-delete-record="${escapeHtml(r.id)}">删除</button></div>`).join(""):'<div class="empty">暂时还没有训练记录。完成一次训练后，这里会显示历史。</div>';
  $("#recType").innerHTML=site.workouts.map(w=>`<option value="${escapeHtml(w.id)}">${escapeHtml(w.title)}</option>`).join("");
}
function populateSettings() {
  $("#pName").value=profile.name||"";$("#pWeight").value=profile.weight||"";$("#pHeight").value=profile.height||"";$("#pAge").value=profile.age||"";
  $("#pGoal").value=profile.goal;$("#pExperience").value=profile.experience;$("#pPlace").value=profile.place;$("#pEquipment").value=profile.equipment;
  $("#pDays").value=String(profile.days);$("#pDuration").value=String(profile.duration);$("#pCardio").value=profile.cardio;$("#pStart").value=String(profile.start);
}
function applyProfileFromForm() {
  const n=Number($("#pWeight").value);
  if(!Number.isFinite(n)||n<25||n>350){showToast("请输入 25–350 kg 范围内的体重。");return false}
  profile={...profile,name:$("#pName").value.trim(),weight:n,height:$("#pHeight").value?Number($("#pHeight").value):"",age:$("#pAge").value?Number($("#pAge").value):"",goal:$("#pGoal").value,experience:$("#pExperience").value,place:$("#pPlace").value,equipment:$("#pEquipment").value,days:Number($("#pDays").value),duration:Number($("#pDuration").value),cardio:$("#pCardio").value,start:Number($("#pStart").value)};
  savePersonal();renderAll();return true;
}
function renderAll(){renderOverview();renderPlan();renderLibrary();renderRecords();$("#userAvatar").textContent=(profile.name||site.brand||"F").slice(0,1).toUpperCase();}
function switchView(name) {
  $$(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  $$("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  window.scrollTo({top:0,behavior:"smooth"});
  if(name==="plan")renderPlan(); if(name==="records")renderRecords(); if(name==="library")renderLibrary();
}
function setFormFromProfile() {
  $("#pName").value=profile.name;$("#pWeight").value=profile.weight;$("#pHeight").value=profile.height;$("#pAge").value=profile.age;
  $("#pGoal").value=profile.goal;$("#pExperience").value=profile.experience;$("#pPlace").value=profile.place;$("#pEquipment").value=profile.equipment;
  $("#pDays").value=String(profile.days);$("#pDuration").value=String(profile.duration);$("#pCardio").value=profile.cardio;$("#pStart").value=String(profile.start);
}
function openDev() {
  $("#devShade").classList.remove("hidden");$("#devMessage").classList.add("hidden");document.body.style.overflow="hidden";
  verifyAdminSession();
}
function closeDev() {$("#devShade").classList.add("hidden");document.body.style.overflow="";}
function setDevMessage(text,error=false){const m=$("#devMessage");m.textContent=text;m.classList.remove("hidden","error");if(error)m.classList.add("error")}
async function verifyAdminSession() {
  try {
    const r=await fetch("/api/admin/session",{cache:"no-store"}),d=await r.json();adminAuthenticated=!!d.authenticated;
    $("#devLoginPanel").classList.toggle("hidden",adminAuthenticated);$("#devEditorPanel").classList.toggle("hidden",!adminAuthenticated);
    if(adminAuthenticated)fillEditor();
  }catch{setDevMessage("无法连接服务器。",true)}
}
function fillEditor() {
  $("#siteBrand").value=site.brand;$("#siteTagline").value=site.tagline||"";$("#siteAnnouncement").value=site.announcement||"";
  $("#workoutsJson").value=JSON.stringify(site.workouts,null,2);
}
async function loginAdmin(e) {
  e.preventDefault();const btn=$("#devLoginForm button");btn.disabled=true;
  try {
    const r=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:$("#devPassword").value})});
    const data=await r.json();if(!r.ok)throw new Error(data.error||"登录失败。");
    adminAuthenticated=true;$("#devPassword").value="";$("#devLoginPanel").classList.add("hidden");$("#devEditorPanel").classList.remove("hidden");fillEditor();setDevMessage("验证成功。修改公共内容后点击保存，所有访客刷新后即可看到新配置。");
  }catch(err){setDevMessage(err.message,true)}
  finally{btn.disabled=false}
}
async function logoutAdmin() {
  try {await fetch("/api/admin/logout",{method:"POST"});}catch{}
  adminAuthenticated=false;$("#devLoginPanel").classList.remove("hidden");$("#devEditorPanel").classList.add("hidden");setDevMessage("已退出开发者模式。");
}
async function saveSite(e) {
  e.preventDefault();if(!adminAuthenticated){setDevMessage("请先登录开发者模式。",true);return}
  let workouts;try{workouts=JSON.parse($("#workoutsJson").value)}catch(err){setDevMessage("JSON 格式错误："+err.message,true);return}
  const config={brand:$("#siteBrand").value.trim(),tagline:$("#siteTagline").value.trim(),announcement:$("#siteAnnouncement").value.trim(),workouts};
  const btn=$("#siteEditor button[type=submit]");btn.disabled=true;
  try{
    const r=await fetch("/api/admin/site",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)});
    const data=await r.json();if(!r.ok)throw new Error(data.error||"保存失败。");
    site=data.site;renderAll();fillEditor();setDevMessage("已保存到服务器。公共页面内容已经更新，其他访客刷新后可看到。");showToast("公共网页配置已保存");
  }catch(err){setDevMessage(err.message,true)}
  finally{btn.disabled=false}
}
function downloadJSON(filename,obj){const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function addCurrentRecord() {
  const s=currentSession(), key=currentCheckKey();
  const record={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date:localDate(),type:s.title,minutes:s.duration,kcal:s.totalKcal,weight:"",note:"从今日训练完成按钮添加"};
  if(!personal.records.some(r=>r.date===record.date&&r.type===record.type)){personal.records.push(record)}
  personal.checks[key]=s.exercises.map(e=>e.id);savePersonal();renderAll();showToast("今日训练已记录");
}
function initEvents() {
  document.addEventListener("click",e=>{
    const nav=e.target.closest("[data-view]");if(nav)switchView(nav.dataset.view);
    const jump=e.target.closest("[data-jump]");if(jump)switchView(jump.dataset.jump);
    const tab=e.target.closest("[data-select-day]");if(tab){selectedDay=Number(tab.dataset.selectDay);renderPlan();}
    const guide=e.target.closest("[data-guide]");if(guide)openGuide(guide.dataset.guide);
    const del=e.target.closest("[data-delete-record]");if(del&&confirm("确定删除这条记录吗？")){personal.records=personal.records.filter(r=>r.id!==del.dataset.deleteRecord);savePersonal();renderRecords();renderOverview();showToast("记录已删除")}
  });
  $("#todayExercises").addEventListener("change",e=>{
    const input=e.target.closest("[data-today-check]");if(!input)return;
    const s=currentSession(),eObj=s.exercises[Number(input.dataset.todayCheck)],key=currentCheckKey(),prev=personal.checks[key]||[];
    personal.checks[key]=input.checked?[...new Set([...prev,eObj.id])]:prev.filter(x=>x!==eObj.id);
    savePersonal();renderOverview();
  });
  $("#completeToday").addEventListener("click",addCurrentRecord);
  $("#settingsForm").addEventListener("submit",e=>{e.preventDefault();if(applyProfileFromForm())showToast("个人参数已保存，计划已同步更新");});
  // Update the plan preview as each profile variable changes.
  $("#settingsForm").addEventListener("change",()=>{if($("#pWeight").value && Number($("#pWeight").value)>=25 && Number($("#pWeight").value)<=350){applyProfileFromForm();}});
  $("#recordForm").addEventListener("submit",e=>{
    e.preventDefault();const date=$("#recDate").value,minutes=Number($("#recMinutes").value)||0,weight=$("#recWeight").value?Number($("#recWeight").value):"";
    if(!date){showToast("请选择记录日期");return}
    const typeId=$("#recType").value,w=workoutById(typeId),session=getSession(new Date(date+"T12:00:00").getDay());
    const kcal=minutes>0?Math.round(session.totalKcal*(minutes/(profile.duration||45))):0;
    personal.records.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date,type:w.title,minutes,kcal,weight,note:$("#recNote").value.trim()});
    if(weight)profile.weight=weight;savePersonal();$("#recMinutes").value="";$("#recWeight").value="";$("#recNote").value="";renderAll();populateSettings();showToast("记录已保存");
  });
  $("#exerciseSearch").addEventListener("input",renderLibrary);$("#exerciseFilter").addEventListener("change",renderLibrary);
  $("#exportPersonal").addEventListener("click",()=>downloadJSON(`form-personal-backup-${localDate()}.json`,{profile,personal}));
  $("#developerOpen").addEventListener("click",openDev);$("#mobileDeveloper").addEventListener("click",openDev);
  $("#closeDev").addEventListener("click",closeDev);$("#closeModal").addEventListener("click",()=>closeModal("#modalShade"));
  $("#devShade").addEventListener("click",e=>{if(e.target===$("#devShade"))closeDev()});
  $("#modalShade").addEventListener("click",e=>{if(e.target===$("#modalShade"))closeModal("#modalShade")});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeDev();closeModal("#modalShade")}});
  $("#devLoginForm").addEventListener("submit",loginAdmin);$("#logoutAdmin").addEventListener("click",logoutAdmin);$("#siteEditor").addEventListener("submit",saveSite);
  $("#downloadConfig").addEventListener("click",()=>downloadJSON("form-site-config.json",{brand:$("#siteBrand").value,tagline:$("#siteTagline").value,announcement:$("#siteAnnouncement").value,workouts:JSON.parse($("#workoutsJson").value)}));
  $("#importConfig").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.workouts))throw new Error("缺少 workouts 数组");$("#siteBrand").value=data.brand||site.brand;$("#siteTagline").value=data.tagline||"";$("#siteAnnouncement").value=data.announcement||"";$("#workoutsJson").value=JSON.stringify(data.workouts,null,2);setDevMessage("配置已载入编辑器。检查无误后点击“保存公共网页配置”。")}catch(err){setDevMessage("导入失败："+err.message,true)}e.target.value=""});
}
async function init() {
  readPersonal();
  $("#todayDate").textContent=new Date().toLocaleDateString("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"});
  $("#recDate").value=localDate();
  setFormFromProfile();
  initEvents();
  try{await fetchSite();renderAll();}
  catch(err){document.body.innerHTML=`<div style="max-width:650px;margin:10vh auto;padding:30px;color:#eef5ff;font:16px/1.7 system-ui"><h1>FORM 暂时无法加载</h1><p>${escapeHtml(err.message)}</p><p>请确认服务端已经启动，并且 <code>/api/site</code> 可以正常访问。</p></div>`;}
}
init();
