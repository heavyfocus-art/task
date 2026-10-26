/* ראש שקט, a worker on his computer.
   This stands in for the phone app's Java side (WorkerSync): w.html is the app's own worker screen,
   and this file gives it the same window.Android calls, working in the browser.
   The manager's phone posts his tasks, sealed with his key, to his private ntfy topic; reports go back
   to the manager's inbox sealed with the task's own token. Nothing leaves unsealed. */
(function(){
  "use strict";
  var VERSION = "26";
  var CFG = "rsw-cfg", TASKS = "rsw-tasks", WEEK = "rsw-weekly", LAST = "rsw-last";
  function ld(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch(e){ return null; } }
  function sv(k, v){ try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  var cfg = ld(CFG);
  if(!cfg || !cfg.w || !cfg.key || !cfg.m || !cfg.id){ location.replace("./"); return; }

  var S = crypto.subtle, TE = new TextEncoder(), TD = new TextDecoder();
  function b64u(buf){ var b=new Uint8Array(buf), x=""; for(var i=0;i<b.length;i++) x+=String.fromCharCode(b[i]); return btoa(x).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
  function unb64u(v){ v=String(v).replace(/-/g,"+").replace(/_/g,"/"); while(v.length%4) v+="="; var r=atob(v), b=new Uint8Array(r.length); for(var i=0;i<r.length;i++) b[i]=r.charCodeAt(i); return b; }
  function sha(s){ return S.digest("SHA-256", TE.encode(s)); }
  function seal(key, obj){ var iv = crypto.getRandomValues(new Uint8Array(12));
    return S.importKey("raw", key, "AES-GCM", false, ["encrypt"]).then(function(k){ return S.encrypt({name:"AES-GCM", iv:iv}, k, TE.encode(JSON.stringify(obj))); })
      .then(function(c){ return {v:2, iv:b64u(iv), c:b64u(c)}; }); }
  function open(key, env){ try{ return S.importKey("raw", key, "AES-GCM", false, ["decrypt"]).then(function(k){ return S.decrypt({name:"AES-GCM", iv:unb64u(env.iv)}, k, unb64u(env.c)); })
      .then(function(p){ return JSON.parse(TD.decode(p)); }, function(){ return null; }); }catch(e){ return Promise.resolve(null); } }
  function post(topic, env){ return fetch("https://ntfy.sh/"+topic, {method:"POST", body:JSON.stringify(env)}).then(function(r){ return r.ok; }, function(){ return false; }); }

  var tasks = ld(TASKS) || {};
  function save(){ sv(TASKS, tasks); }
  function poke(){ if(window.onNativePending) window.onNativePending(); }

  /* to the manager, sealed with my key: {v:2, w:<my id>, iv, c} */
  function toManager(obj){ return seal(unb64u(cfg.key), obj).then(function(env){ env.w = cfg.id; return post(cfg.m, env); }); }

  function leave(msg){
    [CFG, TASKS, WEEK, LAST].forEach(function(k){ sv(k, null); });
    try{ sessionStorage.setItem("rs-msg", msg || ""); }catch(e){}
    location.replace("./");
  }

  /* the same rules as the phone app (WorkerSync.apply) */
  function apply(msg){
    var op = msg.op;
    if(op==="up"){
      var t = msg.t; if(!t || !t.id) return;
      var old = tasks[t.id], n = old || {};
      n.id = t.id; n.title = String(t.title||"");
      if(t.tok) n.tok = t.tok;
      if(t.due!=null) n.due = +t.due; else delete n.due;
      if(t.xd!=null) n.xd = +t.xd; else delete n.xd;
      if(t.u===1) n.u = 1; else delete n.u;
      if(Array.isArray(t.ck) && t.ck.length){ if(JSON.stringify(t.ck)!==JSON.stringify(n.ck||null)) delete n.cd; n.ck = t.ck; } else { delete n.ck; delete n.cd; }
      if(t.ph===1) n.ph = 1; else delete n.ph;
      if(t.rp) n.rp = String(t.rp); else delete n.rp;
      var st = t.st || "open", was = old ? (old.st || "open") : "";
      // the manager's view wins, except that my own fresh report isn't undone by an older echo
      var ownFresh = old && (was==="done" || was==="no" || was==="ext") && Date.now() - (old.at||0) <= 10*60000;
      if(!old || st!=="open" || !ownFresh) n.st = st;
      tasks[t.id] = n;
    } else if(op==="rm"){ delete tasks[msg.id]; }
    else if(op==="ids"){ if(!Array.isArray(msg.ids)) return; var keep = {}; msg.ids.forEach(function(i){ keep[i] = 1; });
      Object.keys(tasks).forEach(function(k){ if(!keep[k]) delete tasks[k]; }); }
    else if(op==="wk"){ var r = msg.r; if(!r || !(r.ws>0)) return; var old2 = ld(WEEK) || [], next = [r];
      old2.forEach(function(x){ if(x && x.ws!==r.ws && next.length < 8) next.push(x); }); sv(WEEK, next); }
    else if(op==="bye"){ leave("המנהל ניתק את החיבור. כדי לחבר שוב צריך קוד חדש ממנו."); return "stop"; }
    else if(op==="pcbye"){ leave("המנהל ניתק את המחשב הזה. כדי לחבר שוב צריך קוד חדש ממנו."); return "stop"; }
    else if(op==="mgr" && /^[A-Za-z0-9_-]{12,64}$/.test(msg.mt||"")){
      // he is now a manager: this computer moves to his manager screen (same key, his own topic)
      ["rspc-snap","rspc-pend","rspc-out"].forEach(function(k){ sv(k, null); });
      sv("rspc-cfg", {m:cfg.m, t:msg.mt, id:cfg.id, key:cfg.key, w:cfg.w, mgr:1, role:String(msg.role||"dept"), name:cfg.name||"", mName:cfg.mName||"", at:Date.now()});
      sv(CFG, null); location.replace("./"); return "stop"; }
  }

  var polling = false;
  function since(){ var last = +ld(LAST) || 0, floor = Math.floor(Date.now()/1000) - 12*3600;
    return last ? String(Math.max(floor, Math.floor(last/1000) - 180)) : "12h"; }
  function poll(){
    if(polling) return; polling = true;
    var key = unb64u(cfg.key);
    fetch("https://ntfy.sh/"+cfg.w+"/json?poll=1&since="+since()).then(function(r){ if(!r.ok) throw 0; return r.text(); }).then(function(txt){
      var envs = [];
      txt.split("\n").forEach(function(l){ if(!l.trim()) return; try{ var m = JSON.parse(l); if(m.event==="message") envs.push(JSON.parse(m.message)); }catch(e){} });
      return envs.reduce(function(p, env){ return p.then(function(stop){ if(stop || !env || env.v!==2) return stop; return open(key, env).then(function(o){ return o ? apply(o)==="stop" : false; }); }); }, Promise.resolve(false));
    }).then(function(stop){ if(stop) return; save(); sv(LAST, Date.now()); polling = false; poke(); }, function(){ polling = false; });
  }

  /* status: done | no | ext */
  function reply(id, status, note, extDue){
    var t = tasks[id]; if(!t || !t.tok || t.tok.length < 8) return Promise.resolve(false);
    var s = status==="no" ? "no" : status==="ext" ? "ext" : "done";
    if(s==="ext" && !(extDue > Date.now())) return Promise.resolve(false);
    var plain = {s:s, n:String(note||"").trim()}; if(s==="ext") plain.d = extDue;
    if(s!=="ext" && Array.isArray(t.ck)) plain.c = (t.cd||[]).filter(function(i){ return i>=0 && i<t.ck.length; });
    return Promise.all([sha("rs-task:"+t.tok), sha("rs-kid:"+t.tok)]).then(function(r){
      return seal(new Uint8Array(r[0]), plain).then(function(env){ env.k = b64u(r[1]).slice(0,10); return post(cfg.m, env); });
    }).then(function(ok){
      if(!ok) return false;
      var x = tasks[id]; if(x){ x.st = s; x.note = plain.n; x.at = Date.now(); if(s==="ext") x.xd = extDue; else delete x.xd; save(); }
      return true;
    }, function(){ return false; });
  }

  function done(id, ok){ setTimeout(function(){ if(window.onWorkerReplied) window.onWorkerReplied(id, ok); }, 0); }
  window.Android = {
    workerState: function(){ return JSON.stringify({joined:true, name:cfg.name||"", mName:cfg.mName||"", tasks:Object.keys(tasks).map(function(k){ return tasks[k]; }),
      lastSync:+ld(LAST)||0, approved:"[]", weekly:JSON.stringify(ld(WEEK)||[])}); },
    workerJoin: function(){}, setMode: function(){ location.href = "./"; },
    workerReply: function(id, status, note){ reply(id, status, note, 0).then(function(ok){ done(id, ok); }); },
    workerExt: function(id, due, note){ reply(id, "ext", note, +due||0).then(function(ok){ done(id, ok); }); },
    workerCheck: function(id, i, on){ var t = tasks[id]; if(!t || !Array.isArray(t.ck) || i<0 || i>=t.ck.length) return;
      var cd = (t.cd||[]).filter(function(x){ return x!==i && x>=0 && x<t.ck.length; }); if(on) cd.push(i); t.cd = cd; save(); },
    openUrl: function(u){ window.open(u, "_blank", "noopener"); },
    workerPoll: function(resync){ if(resync) toManager({r:1, pc:1}); poll(); },
    workerLeave: function(){ leave(""); },
    notificationsAllowed: function(){ return true; }, fixNotifications: function(){},
    takeOpenWeekly: function(){ return false; }, appVersion: function(){ return VERSION; }
  };

  // first visit after pairing: tell the manager's phone this computer joined (it then sends my tasks)
  if(!cfg.joinSent){ toManager({j:1, pc:1}).then(function(ok){ if(ok){ cfg.joinSent = Date.now(); sv(CFG, cfg); } }); }
  poll();
  setInterval(function(){ if(!document.hidden) poll(); }, 15000);
  setInterval(function(){ if(document.hidden) poll(); }, 60000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) poll(); });
})();
