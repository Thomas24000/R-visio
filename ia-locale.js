/* IA locale (expérimental) : un petit modèle de langage qui tourne directement
   dans le navigateur, grâce à wllama (llama.cpp compilé en WebAssembly).
   - WebGPU (carte graphique) si disponible, sinon processeur.
   - Safari / iOS : build « compat » (pas de JSPI ni de Memory64 sur Safari).
   - Le modèle est téléchargé une fois depuis Hugging Face puis gardé en cache :
     ensuite tout fonctionne hors ligne.
   - La sortie est contrainte par une grammaire GBNF : même un petit modèle
     produit du JSON au bon format. */
(function () {
  "use strict";

  var HF = "https://huggingface.co/";
  var MODELS = {
    leger: {
      label: "Léger",
      size: "≈ 400 Mo",
      desc: "Qwen 2.5 · 0,5 milliard de paramètres. Le plus rapide, qualité basique.",
      url: HF + "Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
    },
    equilibre: {
      label: "Équilibré",
      size: "≈ 1,1 Go",
      desc: "Qwen 2.5 · 1,5 milliard de paramètres. Meilleurs résultats, plus lent. Téléphone récent conseillé.",
      url: HF + "Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
    }
  };
  var KEY = "revise.ai";
  var N_CTX = 4096;
  var CHUNK = 3500; // caractères de cours par appel (≈ 1 000 à 1 300 tokens)

  /* ---------- réglages ---------- */
  function getCfg() { try { var c = JSON.parse(localStorage.getItem(KEY) || "null"); return c && MODELS[c.model] ? c : null; } catch (e) { return null; } }
  function setCfg(c) { try { if (c) localStorage.setItem(KEY, JSON.stringify(c)); else localStorage.removeItem(KEY); } catch (e) {} }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function caps() { return { webgpu: !!navigator.gpu, ios: isIOS(), wasm: typeof WebAssembly === "object" }; }
  var gpuProbe = null;
  function probeGpu() { // vraie carte graphique utilisable ? (navigator.gpu peut exister sans adaptateur)
    if (!gpuProbe) gpuProbe = !navigator.gpu ? Promise.resolve(false) : navigator.gpu.requestAdapter().then(function (a) { return !!a; }).catch(function () { return false; });
    return gpuProbe;
  }
  function defaultModel() { return navigator.gpu && !isIOS() ? "equilibre" : "leger"; }

  /* ---------- moteur ---------- */
  var lib = null, wl = null, loadedUrl = null, usingGpu = null;
  function abs(p) { return new URL(p, document.baseURI).href; }
  async function getLib() { if (!lib) lib = await import(abs("vendor/wllama/index.js")); return lib; }
  async function newInstance() {
    var L = await getLib();
    var w = new L.Wllama({ default: abs("vendor/wllama/wllama.wasm") }, { allowOffline: true, suppressNativeLog: true, logger: L.LoggerWithoutDebug });
    w.setCompat({ wasm: abs("vendor/wllama-compat/wllama.wasm"), worker: abs("vendor/wllama-compat/wllama.js") });
    return w;
  }
  async function isDownloaded(id) {
    try { var w = wl || await newInstance(); var list = await w.cacheManager.list(); return list.some(function (e) { return e.metadata && e.metadata.originalURL === MODELS[id].url; }); }
    catch (e) { return false; }
  }
  async function removeAll() {
    if (wl) { try { await wl.exit(); } catch (e) {} wl = null; loadedUrl = null; }
    try { var w = await newInstance(); await w.cacheManager.clear(); } catch (e) {}
    setCfg(null);
  }
  async function load(id, onProgress) {
    var m = MODELS[id];
    if (wl && loadedUrl === m.url) return;
    if (wl) { try { await wl.exit(); } catch (e) {} wl = null; loadedUrl = null; }
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) {} }
    var params = { n_ctx: N_CTX, progressCallback: function (p) { if (onProgress && p.total) onProgress(p.loaded, p.total); } };
    wl = await newInstance();
    try {
      await wl.loadModelFromUrl(m.url, params);
      usingGpu = !!navigator.gpu;
    } catch (e) {
      // WebGPU indisponible ou mémoire graphique insuffisante : on retente sur le processeur.
      if (!navigator.gpu || isNetworkError(e)) { wl = null; throw e; }
      try { await wl.exit(); } catch (_) {}
      wl = await newInstance();
      params.n_gpu_layers = 0;
      await wl.loadModelFromUrl(m.url, params);
      usingGpu = false;
    }
    loadedUrl = m.url;
    keepEngineOffline();
  }
  // Fait passer les fichiers du moteur par le service worker pour qu'ils soient gardés hors ligne.
  function keepEngineOffline() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    var files = ["ia-locale.js", "vendor/wllama/index.js", needsCompat() ? "vendor/wllama-compat/wllama.js" : null, needsCompat() ? "vendor/wllama-compat/wllama.wasm" : "vendor/wllama/wllama.wasm"];
    files.forEach(function (f) { if (f) fetch(abs(f)).catch(function () {}); });
  }
  function needsCompat() { // même règle que wllama : pas de JSPI ou pas de Memory64
    if (!WebAssembly.Suspending) return true;
    try { new WebAssembly.Memory({ address: "i64", initial: BigInt(1) }); return false; } catch (e) { return true; }
  }
  function isNetworkError(e) { var s = String(e && (e.message || e)); return /fetch|network|download|Failed to load|HTTP|offline/i.test(s); }

  // Une partie qui échoue (hors arrêt demandé) : on réinitialise le moteur et on retente une fois.
  async function chat(system, user, opt) {
    try { return await chatOnce(system, user, opt); }
    catch (e) {
      if ((opt.signal && opt.signal.aborted) || !loadedUrl) throw e;
      var url = loadedUrl, id = Object.keys(MODELS).filter(function (k) { return MODELS[k].url === url; })[0];
      try { await wl.exit(); } catch (_) {}
      wl = null; loadedUrl = null;
      await load(id);
      return await chatOnce(system, user, opt);
    }
  }
  async function chatOnce(system, user, opt) {
    var out = "";
    await wl.createChatCompletion({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: opt.max_tokens || 800,
      temperature: 0.3, top_p: 0.9, top_k: 40,
      grammar: opt.grammar,
      stream: true,
      abortSignal: opt.signal,
      onData: function (c) {
        var d = c && c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content;
        if (d) { out += d; if (opt.onText) opt.onText(out); }
      }
    });
    return out;
  }

  /* ---------- grammaires GBNF ---------- */
  var G_STR = 'str ::= "\\"" ch{2,220} "\\""\nshort ::= "\\"" ch{1,80} "\\""\nch ::= [^"\\\\\\x00-\\x1f]\n';
  function rep(rule, min, max) { // min..max occurrences séparées par des virgules
    return rule + ' ("," ' + rule + "){" + Math.max(0, min - 1) + "," + Math.max(0, max - 1) + "}";
  }
  function gCards(min, max) { return 'root ::= "{\\"cards\\":[" ' + rep("card", min, max) + ' "]}"\ncard ::= "{\\"q\\":" str ",\\"a\\":" str "}"\n' + G_STR; }
  function gQuiz(min, max) { return 'root ::= "{\\"quiz\\":[" ' + rep("item", min, max) + ' "]}"\nitem ::= "{\\"q\\":" str ",\\"options\\":[" short "," short "," short "," short "],\\"answer\\":" [0-3] ",\\"explain\\":" str "}"\n' + G_STR; }
  function gPart() { return 'root ::= "{\\"title\\":" short ",\\"points\\":[" ' + rep("str", 2, 6) + ' "],\\"terms\\":[" ' + rep("term", 1, 4) + ' "]}"\nterm ::= "{\\"t\\":" short ",\\"d\\":" str "}"\n' + G_STR; }
  function gSummary() { return 'root ::= ch{60,600}\nch ::= [^\\x00-\\x09\\x0b-\\x1f]\n'; }

  /* ---------- découpage du cours ---------- */
  function chunks(text) {
    var paras = String(text).replace(/\r/g, "").split(/\n\s*\n/), out = [], cur = "";
    function push(s) { s = s.trim(); if (s) out.push(s); }
    paras.forEach(function (p) {
      p = p.trim(); if (!p) return;
      while (p.length > CHUNK) { // paragraphe trop long : coupe à une fin de phrase
        var cut = p.lastIndexOf(". ", CHUNK); if (cut < CHUNK / 2) cut = CHUNK;
        push(cur); cur = ""; push(p.slice(0, cut + 1)); p = p.slice(cut + 1).trim();
      }
      if ((cur + "\n\n" + p).length > CHUNK) { push(cur); cur = p; } else cur = cur ? cur + "\n\n" + p : p;
    });
    push(cur);
    return out;
  }
  function pick(list, max) { // garde au plus `max` parties, réparties sur tout le cours
    if (list.length <= max) return list;
    var out = []; for (var i = 0; i < max; i++) out.push(list[Math.round(i * (list.length - 1) / (max - 1))]);
    return out;
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* ---------- lecture tolérante du JSON ---------- */
  var S_ = '"([^"]*)"';
  function parseOr(txt, rx, map) {
    try { return JSON.parse(txt); } catch (e) {}
    var out = [], m; rx.lastIndex = 0;
    while ((m = rx.exec(txt))) out.push(map(m));
    return out;
  }
  var RX_CARD = new RegExp('\\{"q":' + S_ + ',"a":' + S_ + "\\}", "g");
  var RX_ITEM = new RegExp('\\{"q":' + S_ + ',"options":\\[' + S_ + "," + S_ + "," + S_ + "," + S_ + '\\],"answer":([0-3]),"explain":' + S_ + "\\}", "g");
  function shuffleQ(it) { // les petits modèles mettent souvent la bonne réponse en premier
    var idx = [0, 1, 2, 3].sort(function () { return Math.random() - 0.5; });
    return { q: it.q, options: idx.map(function (i) { return it.options[i]; }), answer: idx.indexOf(it.answer), explain: it.explain };
  }

  function parsePart(txt) { // fiche : lecture tolérante si la sortie a été coupée
    try { return JSON.parse(txt); } catch (e) {}
    var t = /"title":"([^"]*)"/.exec(txt), pts = [], terms = [], m;
    var ps = /"points":\[([^\]]*)/.exec(txt);
    if (ps) { var rx = /"([^"]*)"/g; while ((m = rx.exec(ps[1]))) if (m[1].trim()) pts.push(m[1]); }
    var rt = new RegExp('\\{"t":' + S_ + ',"d":' + S_ + "\\}", "g");
    while ((m = rt.exec(txt))) terms.push({ t: m[1], d: m[2] });
    return t || pts.length ? { title: t ? t[1] : "", points: pts, terms: terms } : null;
  }
  var SYS = "Tu aides un étudiant à réviser. Tu écris en français correct. Tu utilises UNIQUEMENT les informations du texte fourni, sans rien inventer.";
  function intro(title, part, i, n) { return "Extrait " + (i + 1) + "/" + n + " du cours « " + title + " » :\n\"\"\"\n" + part + "\n\"\"\"\n\n"; }

  /* ---------- génération ---------- */
  // kind : "cards" | "sheet" | "quiz". Renvoie le même format que la génération avec Claude.
  async function generate(kind, title, text, o) {
    o = o || {};
    var status = o.onStatus || function () {};
    var all = chunks(text);
    var max = kind === "sheet" ? 4 : 4;
    var parts = pick(all, max), partial = parts.length < all.length, n = parts.length;
    if (!n) throw new Error("empty");

    if (kind === "cards") {
      var per = clamp(Math.round(20 / n), 4, 8), cards = [];
      for (var i = 0; i < n; i++) {
        status("Partie " + (i + 1) + "/" + n + " · " + cards.length + " cartes");
        var base = cards.length;
        var t = await chat(SYS, intro(title, parts[i], i, n) + "Écris " + per + " flashcards sur les notions les plus importantes de cet extrait (définitions, dates, chiffres, causes, conséquences). Chaque question est courte et précise. Chaque réponse tient en une phrase. Format : {\"cards\":[{\"q\":\"question\",\"a\":\"réponse\"}]}",
          { grammar: gCards(per - 1, per), max_tokens: 130 * per, signal: o.signal, onText: function (s) { status("Partie " + (i + 1) + "/" + n + " · " + (base + (s.match(/"a":/g) || []).length) + " cartes"); } });
        var r = parseOr(t, RX_CARD, function (m) { return { q: m[1], a: m[2] }; });
        (Array.isArray(r) ? r : r.cards || []).forEach(function (x) { if (x.q && x.a) cards.push({ q: String(x.q), a: String(x.a) }); });
      }
      return { cards: cards, partial: partial };
    }

    if (kind === "quiz") {
      var perq = clamp(Math.round(10 / n), 3, 6), quiz = [];
      for (var j = 0; j < n; j++) {
        status("Partie " + (j + 1) + "/" + n + " · " + quiz.length + " questions");
        var baseq = quiz.length;
        var tq = await chat(SYS, intro(title, parts[j], j, n) + "Écris " + perq + " questions de QCM sur cet extrait. Chaque question a 4 options courtes et plausibles, une seule est correcte. \"answer\" est le numéro (0, 1, 2 ou 3) de la bonne option. \"explain\" explique en une phrase pourquoi elle est correcte. Format : {\"quiz\":[{\"q\":\"question\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"answer\":0,\"explain\":\"explication\"}]}",
          { grammar: gQuiz(perq - 1, perq), max_tokens: 190 * perq, signal: o.signal, onText: function (s) { status("Partie " + (j + 1) + "/" + n + " · " + (baseq + (s.match(/"explain":/g) || []).length) + " questions"); } });
        var rq = parseOr(tq, RX_ITEM, function (m) { return { q: m[1], options: [m[2], m[3], m[4], m[5]], answer: +m[6], explain: m[7] }; });
        (Array.isArray(rq) ? rq : rq.quiz || []).forEach(function (x) {
          if (x.q && Array.isArray(x.options) && x.options.length === 4 && x.answer >= 0 && x.answer <= 3) quiz.push(shuffleQ(x));
        });
      }
      return { quiz: quiz, partial: partial };
    }

    // fiche : une section par partie, puis un résumé global
    var sections = [], terms = [], seen = {};
    for (var k = 0; k < n; k++) {
      status("Partie " + (k + 1) + "/" + n);
      var ts = await chat(SYS, intro(title, parts[k], k, n) + "Fais la fiche de révision de cet extrait : un titre court, 3 à 6 idées clés (une phrase chacune) et 1 à 4 termes importants avec leur définition. Format : {\"title\":\"titre\",\"points\":[\"idée clé\"],\"terms\":[{\"t\":\"terme\",\"d\":\"définition\"}]}",
        { grammar: gPart(), max_tokens: 900, signal: o.signal });
      var p = parsePart(ts);
      if (p) {
        sections.push({ title: p.title || "Partie " + (k + 1), points: (p.points || []).map(String) });
        (p.terms || []).forEach(function (x) { var key = String(x.t || "").toLowerCase().trim(); if (key && !seen[key]) { seen[key] = 1; terms.push({ t: x.t, d: x.d }); } });
      }
    }
    var summary = "";
    if (sections.length) {
      status("Résumé");
      var digest = sections.map(function (s) { return "- " + s.title + " : " + s.points.join(" ; "); }).join("\n");
      summary = (await chat(SYS, "Voici les idées clés du cours « " + title + " » :\n" + digest + "\n\nÉcris un résumé de ce cours en 3 phrases.", { grammar: gSummary(), max_tokens: 220, signal: o.signal })).trim();
    }
    return { summary: summary, sections: sections, terms: terms, partial: partial };
  }

  window.LocalAI = {
    MODELS: MODELS, getCfg: getCfg, setCfg: setCfg, caps: caps, probeGpu: probeGpu, defaultModel: defaultModel,
    isDownloaded: isDownloaded, load: load, generate: generate, removeAll: removeAll,
    reset: async function () { var w = wl; wl = null; loadedUrl = null; if (w) { try { await Promise.race([w.exit(), new Promise(function (r) { setTimeout(r, 2000); })]); } catch (e) {} } },
    isLoaded: function (id) { return !!wl && loadedUrl === MODELS[id].url; },
    usingGpu: function () { return usingGpu; },
    _chunks: chunks
  };
})();
