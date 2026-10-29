/* ראש שקט · a small client for the database (Supabase REST + sign-in). No outside libraries. */
(function(){
  "use strict";
  function RSDB(url, key, opts){
    opts = opts || {};
    var SK = opts.storageKey || "rs-db-auth", base = String(url).replace(/\/+$/, ""), self = this, refreshing = null;
    function load(){ try{ return JSON.parse(localStorage.getItem(SK) || "null"); }catch(e){ return null; } }
    function save(s){ try{ if(s) localStorage.setItem(SK, JSON.stringify(s)); else localStorage.removeItem(SK); }catch(e){} }
    var sess = load();
    function keep(d){
      if(!d || !d.access_token) return null;
      sess = {access_token:d.access_token, refresh_token:d.refresh_token, user:d.user || (sess && sess.user) || null,
        expires_at:d.expires_at || (Math.floor(Date.now()/1000) + (+d.expires_in || 3600))};
      save(sess); return sess;
    }
    function err(message, status, code){ return {message:String(message || "error"), status:status || 0, code:code || null}; }
    function readJson(r){ return r.text().then(function(t){ if(!t) return null; try{ return JSON.parse(t); }catch(e){ return t; } }); }
    function authCall(path, body, method, token){
      var h = {"apikey":key, "Content-Type":"application/json"};
      h.Authorization = "Bearer "+(token || key);
      return fetch(base+"/auth/v1/"+path, {method:method || "POST", headers:h, body:body ? JSON.stringify(body) : undefined})
        .then(function(r){ return readJson(r).then(function(j){
          if(!r.ok) return {data:null, error:err(j && (j.error_description || j.msg || j.message || j.error) || ("HTTP "+r.status), r.status, j && j.error_code)};
          return {data:j, error:null}; }); },
          function(e){ return {data:null, error:err("Failed to fetch: "+(e && e.message || ""), 0)}; });
    }
    function refresh(){
      if(!sess || !sess.refresh_token) return Promise.resolve(null);
      if(refreshing) return refreshing;
      refreshing = authCall("token?grant_type=refresh_token", {refresh_token:sess.refresh_token}).then(function(r){
        refreshing = null;
        if(r.error){ if(r.error.status >= 400 && r.error.status < 500){ sess = null; save(null); } return null; }
        return keep(r.data);
      });
      return refreshing;
    }
    function token(){
      if(!sess) return Promise.resolve(null);
      if((sess.expires_at || 0) - 90 > Date.now()/1000) return Promise.resolve(sess.access_token);
      return refresh().then(function(s){ return s ? s.access_token : null; });
    }
    this.auth = {
      signInWithPassword: function(c){
        return authCall("token?grant_type=password", {email:c.email, password:c.password}).then(function(r){
          if(r.error) return {data:{session:null}, error:r.error};
          return {data:{session:keep(r.data)}, error:null}; });
      },
      getSession: function(){
        if(!sess) return Promise.resolve({data:{session:null}, error:null});
        return token().then(function(t){ return {data:{session:t ? sess : null}, error:null}; });
      },
      signOut: function(){
        var t = sess && sess.access_token; sess = null; save(null);
        if(!t) return Promise.resolve({error:null});
        return authCall("logout", null, "POST", t).then(function(){ return {error:null}; });
      },
      updateUser: function(attrs){
        return token().then(function(t){ if(!t) return {data:null, error:err("not signed in", 401)};
          return authCall("user", attrs, "PUT", t); });
      }
    };
    function rest(method, path, body, prefer, retried){
      return token().then(function(t){
        var h = {"apikey":key, "Authorization":"Bearer "+(t || key), "Content-Type":"application/json", "Accept":"application/json"};
        if(prefer) h.Prefer = prefer;
        return fetch(base+"/rest/v1/"+path, {method:method, headers:h, body:body===undefined ? undefined : JSON.stringify(body)})
          .then(function(r){ return readJson(r).then(function(j){
            if(r.status===401 && t && !retried) return refresh().then(function(s){ return s ? rest(method, path, body, prefer, true) : {data:null, error:err("JWT expired", 401)}; });
            if(!r.ok) return {data:null, error:err(j && (j.message || j.hint || j.details) || ("HTTP "+r.status), r.status, j && j.code)};
            return {data:j, error:null}; }); },
            function(e){ return {data:null, error:err("Failed to fetch: "+(e && e.message || ""), 0)}; });
      });
    }
    function val(v){ return v===null ? "null" : v===true ? "true" : v===false ? "false" : String(v); }
    function Q(table){ this.t = table; this.m = "GET"; this.p = []; this.b = undefined; this.pref = null; }
    Q.prototype.select = function(c){ this.p.push("select="+encodeURIComponent(c || "*")); return this; };
    Q.prototype.insert = function(rows){ this.m = "POST"; this.b = rows; this.pref = "return=minimal"; return this; };
    Q.prototype.upsert = function(rows){ this.m = "POST"; this.b = rows; this.pref = "resolution=merge-duplicates,return=minimal"; return this; };
    Q.prototype.update = function(o){ this.m = "PATCH"; this.b = o; this.pref = "return=minimal"; return this; };
    Q.prototype["delete"] = function(){ this.m = "DELETE"; this.pref = "return=minimal"; return this; };
    Q.prototype.eq = function(c, v){ this.p.push(encodeURIComponent(c)+"=eq."+encodeURIComponent(val(v))); return this; };
    Q.prototype["in"] = function(c, a){ this.p.push(encodeURIComponent(c)+"=in.("+a.map(function(x){ return encodeURIComponent('"'+String(x).replace(/"/g,'\\"')+'"'); }).join(",")+")"); return this; };
    Q.prototype.or = function(s){ this.p.push("or=("+encodeURIComponent(s)+")"); return this; };
    Q.prototype.order = function(c, o){ this.p.push("order="+encodeURIComponent(c)+"."+(o && o.ascending===false ? "desc" : "asc")); return this; };
    Q.prototype.limit = function(n){ this.p.push("limit="+(+n)); return this; };
    Q.prototype.then = function(ok, bad){
      var path = this.t + (this.p.length ? "?"+this.p.join("&") : "");
      return rest(this.m, path, this.b, this.pref).then(ok, bad);
    };
    this.from = function(t){ return new Q(t); };
    this.rpc = function(fn, args){ return rest("POST", "rpc/"+fn, args || {}); };
    /* a server function (Supabase Edge Function), called as the signed-in person */
    this.fn = function(name, body){
      return token().then(function(t){
        var ac = window.AbortController ? new AbortController() : null, tm = ac ? setTimeout(function(){ ac.abort(); }, 30000) : null;
        return fetch(base+"/functions/v1/"+name, {method:"POST", headers:{"apikey":key, "Authorization":"Bearer "+(t || key), "Content-Type":"application/json"}, body:JSON.stringify(body || {}), signal:ac ? ac.signal : undefined})
          .then(function(r){ clearTimeout(tm); return readJson(r).then(function(j){
            if(!r.ok) return {data:null, error:err(j && (j.error || j.message || j.msg) || ("HTTP "+r.status), r.status)};
            return {data:j, error:null}; }); },
            function(e){ clearTimeout(tm); return {data:null, error:err(e && e.name==="AbortError" ? "timeout" : "Failed to fetch: "+(e && e.message || ""), 0)}; });
      });
    };
    this.session = function(){ return sess; };
    /* ---- version 34: two-step sign-in. After the password, a 6-digit code from an authenticator app
       (Google Authenticator / Microsoft Authenticator). The first time, the person sets the app up here. ---- */
    function claims(){
      try{ var p = String(sess && sess.access_token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(decodeURIComponent(escape(atob(p + "===".slice((p.length + 3) % 4))))); }catch(e){ return {}; }
    }
    this.aal = function(){ return claims().aal || null; };
    function authTok(path, body, method){
      return token().then(function(t){ if(!t) return {data:null, error:err("not signed in", 401)}; return authCall(path, body, method, t); });
    }
    this.mfa = {
      factors: function(){
        return authTok("user", null, "GET").then(function(r){ if(r.error) return r;
          return {data:((r.data && r.data.factors) || []).filter(function(f){ return f.factor_type==="totp"; }), error:null}; });
      },
      enroll: function(){ return authTok("factors", {factor_type:"totp", issuer:"Rosh Shaket", friendly_name:"rs-"+Date.now()}); },
      unenroll: function(id){ return authTok("factors/"+encodeURIComponent(id), null, "DELETE"); },
      verify: function(id, code){
        var f = "factors/"+encodeURIComponent(id);
        return authTok(f+"/challenge", {}).then(function(c){
          if(c.error) return c;
          return authTok(f+"/verify", {challenge_id:c.data && c.data.id, code:String(code)}).then(function(v){
            if(v.error) return v; keep(v.data); return {data:sess, error:null}; });
        });
      }
    };
    /* the code window. Resolves true once the session is two-step, false if the person chose to sign out;
       rejects (with .status) when the server can't be reached or the sign-in has expired. */
    this.mfaGate = function(opt){
      opt = opt || {};
      if(claims().aal==="aal2") return Promise.resolve(true);
      var mfa = self.mfa;
      return mfa.factors().then(function(r){
        if(r.error) throw r.error;
        var ver = r.data.filter(function(f){ return f.status==="verified"; })[0] || null;
        var stale = r.data.filter(function(f){ return f.status!=="verified"; });
        var clean = stale.reduce(function(p, f){ return p.then(function(){ return mfa.unenroll(f.id); }); }, Promise.resolve());
        return clean.then(function(){ return ver ? {id:ver.id} : mfa.enroll().then(function(e){
          /* two-step sign-in switched off on the server: let the person in rather than lock everyone out */
          if(e.error && e.error.status >= 400 && e.error.status < 500 && /not.?enabled|disabled/i.test(String(e.error.message || "") + " " + String(e.error.code || ""))){ self.mfaOff = true; return null; }
          if(e.error) throw e.error; return e.data; }); });
      }).then(function(f){ if(!f) return true; return new Promise(function(done){ gateUi(f, opt, done); }); });
    };
    function gateUi(f, opt, done){
      var setup = !!(f && f.totp), d = document, C = {ink:"#14213D", muted:"#4A5568", line:"#D5DAE3", acc:"#2D4BE0", bad:"#B42318"};
      var ov = d.createElement("div");
      ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "rs-mfa-h"); ov.dir = "rtl";
      ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(15,20,35,.6);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:inherit";
      function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
      var secret = setup ? String(f.totp.secret || "").replace(/(.{4})/g, "$1 ").trim() : "";
      var h = '<div style="background:#FBFBF8;color:'+C.ink+';border-radius:16px;max-width:420px;width:100%;padding:22px;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);margin:auto">' +
        '<h2 id="rs-mfa-h" style="margin:0;font-size:22px">🔐 '+(setup ? "הגדרת אימות דו-שלבי" : "קוד אבטחה")+'</h2>';
      if(setup){
        h += '<p style="margin:0;color:'+C.muted+';font-size:15px;line-height:1.5">פעם אחת בלבד: מחברים את ראש שקט לאפליקציית אימות בטלפון. מעכשיו, בכל כניסה, אחרי הסיסמה יתבקש גם הקוד מהאפליקציה.</p>' +
          '<ol style="margin:0;padding-inline-start:20px;font-size:15px;line-height:1.6"><li>מתקינים בטלפון <b>Google Authenticator</b> או <b>Microsoft Authenticator</b> (חינם, מחנות האפליקציות).</li>' +
          '<li>'+(opt.phone ? 'לוחצים "פתיחה באפליקציית האימות", או מוסיפים חשבון ומקלידים את המפתח.' : 'באפליקציה לוחצים + וסורקים את הקוד.')+'</li>' +
          '<li>מקלידים כאן את 6 הספרות שמופיעות באפליקציה תחת Rosh Shaket.</li></ol>' +
          (opt.phone ? '<a href="'+esc(f.totp.uri)+'" style="display:block;text-align:center;padding:12px;border-radius:12px;background:'+C.acc+';color:#fff;text-decoration:none;font-weight:700">פתיחה באפליקציית האימות</a>'
                     : '<img alt="קוד לסריקה באפליקציית האימות" src="'+esc(f.totp.qr_code)+'" style="width:200px;height:200px;align-self:center;background:#fff;border-radius:8px;padding:6px">') +
          '<div style="font-size:13px;color:'+C.muted+'">אין אפשרות לסרוק? בוחרים "הקלדת מפתח" ומקלידים:</div>' +
          '<div dir="ltr" style="font-family:monospace;font-size:15px;background:#EEF1F6;border-radius:8px;padding:8px 10px;text-align:center;user-select:all;-webkit-user-select:all;word-break:break-all">'+esc(secret)+'</div>';
      } else {
        h += '<p style="margin:0;color:'+C.muted+';font-size:15px;line-height:1.5">פתח את אפליקציית האימות בטלפון (Google Authenticator או Microsoft Authenticator) והקלד את הקוד בן 6 הספרות של Rosh Shaket.</p>';
      }
      h += '<form id="rs-mfa-f" style="display:flex;flex-direction:column;gap:10px;margin:0" autocomplete="off">' +
        '<label for="rs-mfa-c" style="font-size:14px;font-weight:600">הקוד מהאפליקציה</label>' +
        '<input id="rs-mfa-c" inputmode="numeric" autocomplete="one-time-code" maxlength="8" dir="ltr" placeholder="123456" style="font:inherit;font-size:24px;letter-spacing:6px;text-align:center;padding:10px;border:1px solid '+C.line+';border-radius:12px;background:#fff;color:'+C.ink+'">' +
        '<p id="rs-mfa-e" role="alert" style="margin:0;min-height:1.2em;color:'+C.bad+';font-size:14px"></p>' +
        '<button id="rs-mfa-go" type="submit" style="font:inherit;font-weight:700;font-size:16px;padding:12px;border:0;border-radius:12px;background:'+C.acc+';color:#fff;cursor:pointer">'+(setup ? "אישור והפעלה" : "כניסה")+'</button>' +
        '<button id="rs-mfa-out" type="button" style="font:inherit;font-size:14px;padding:8px;border:0;background:transparent;color:'+C.muted+';cursor:pointer;text-decoration:underline">יציאה</button>' +
        '</form></div>';
      ov.innerHTML = h; d.body.appendChild(ov);
      var inp = d.getElementById("rs-mfa-c"), e = d.getElementById("rs-mfa-e"), go = d.getElementById("rs-mfa-go");
      setTimeout(function(){ try{ inp.focus(); }catch(x){} }, 50);
      function finish(ok){ if(ov.parentNode) ov.parentNode.removeChild(ov); done(ok); }
      d.getElementById("rs-mfa-out").addEventListener("click", function(){ finish(false); });
      d.getElementById("rs-mfa-f").addEventListener("submit", function(ev){
        ev.preventDefault();
        var code = String(inp.value || "").replace(/\D/g, "");
        if(code.length !== 6){ e.textContent = "הקלד את 6 הספרות שמופיעות באפליקציה."; inp.focus(); return; }
        go.disabled = true; go.textContent = "בודק…"; e.textContent = "";
        self.mfa.verify(f.id, code).then(function(r){
          go.disabled = false; go.textContent = setup ? "אישור והפעלה" : "כניסה";
          if(!r.error){ finish(true); return; }
          var m = String(r.error.message || "");
          e.textContent = /fetch|network/i.test(m) ? "אין חיבור לאינטרנט. נסה שוב."
            : r.error.status===429 ? "יותר מדי ניסיונות. חכה דקה ונסה שוב."
            : "הקוד לא נכון או שפג תוקפו. הקלד את הקוד שמופיע עכשיו באפליקציה.";
          inp.select();
        });
      });
    }
    /* storage: upload one file, and short-lived links to view private files */
    function spath(p){ return String(p).split("/").map(encodeURIComponent).join("/"); }
    this.storageUpload = function(bucket, path, blob, ctype){
      return token().then(function(t){
        return fetch(base+"/storage/v1/object/"+bucket+"/"+spath(path), {method:"POST", headers:{"apikey":key, "Authorization":"Bearer "+(t || key), "Content-Type":ctype || "application/octet-stream", "x-upsert":"true"}, body:blob})
          .then(function(r){ return readJson(r).then(function(j){ return r.ok ? {data:j, error:null} : {data:null, error:err(j && (j.message || j.error) || ("HTTP "+r.status), r.status)}; }); },
            function(e){ return {data:null, error:err("Failed to fetch: "+(e && e.message || ""), 0)}; });
      });
    };
    this.storageSign = function(bucket, paths, expiresIn){
      return token().then(function(t){
        return fetch(base+"/storage/v1/object/sign/"+bucket, {method:"POST", headers:{"apikey":key, "Authorization":"Bearer "+(t || key), "Content-Type":"application/json"}, body:JSON.stringify({expiresIn:expiresIn || 3600, paths:paths})})
          .then(function(r){ return readJson(r).then(function(j){
            if(!r.ok || !Array.isArray(j)) return {data:null, error:err(j && (j.message || j.error) || ("HTTP "+r.status), r.status)};
            return {data:j.filter(function(x){ return x && x.signedURL; }).map(function(x){ return {path:x.path, url:/^https?:/.test(x.signedURL) ? x.signedURL : base+"/storage/v1"+x.signedURL}; }), error:null}; }); },
            function(e){ return {data:null, error:err("Failed to fetch: "+(e && e.message || ""), 0)}; });
      });
    };
  }
  window.RSDB = RSDB;
})();
