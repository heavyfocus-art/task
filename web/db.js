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
        return fetch(base+"/functions/v1/"+name, {method:"POST", headers:{"apikey":key, "Authorization":"Bearer "+(t || key), "Content-Type":"application/json"}, body:JSON.stringify(body || {})})
          .then(function(r){ return readJson(r).then(function(j){
            if(!r.ok) return {data:null, error:err(j && (j.error || j.message || j.msg) || ("HTTP "+r.status), r.status)};
            return {data:j, error:null}; }); },
            function(e){ return {data:null, error:err("Failed to fetch: "+(e && e.message || ""), 0)}; });
      });
    };
    this.session = function(){ return sess; };
  }
  window.RSDB = RSDB;
})();
